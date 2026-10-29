import { Announcement, DeadlineTask, TaskSubmissionUpdate } from '../types';
import { processAnnouncementsBatch, titleCourseKeyFor } from '../engine/hybridExtractor';
import {
  getSettings,
  getTasks,
  saveTasksMergingLatest,
  saveAnnouncements,
  getLastScanCheckpoint,
  saveLastScanCheckpoint,
  getUserCourses,
  autoRegisterDiscoveredCourses,
  setScanStatus
} from '../utils/storage';
import { parseCourseDetails, sanitizeDoctorAnnouncementText, isValidTask } from '../core/courseHelper';
import { parseUltraStreamEntries } from '../utils/streamParser';
import { deduplicateTaskList } from '../utils/taskMerge';
import {
  gradebookToUpdates,
  applySubmissionUpdates,
  purgeSyntheticGradebookTasks,
  gradebookReport,
  GradebookReportRow,
  GRADEBOOK_REPORT_KEY
} from '../utils/gradebook';
import { repairTaskWeightsAndRooms } from '../utils/taskRepair';
import { mergeStreamAndCourseAnnouncements } from '../utils/announcementMerge';
import { discoveredCoursesWithColors } from '../content/courseColorPainter';
import { SESSION_STATUS_KEY, isSessionExpiredResponse } from '../utils/sessionStatus';
import { getProfile } from '../utils/profile';
import { profileUniversity } from '../core/studentProfile';
import { getExtraSites } from '../utils/blackboardSites';
import { refreshExamSchedule, examRefreshNote } from './examRefresh';

const KNOWN_UOS_COURSES = [
  { courseId: '_87148_1', name: 'Introduction to Computer Eng.', code: '1502 101' },
  { courseId: '_86929_1', name: 'Calculus I for Engineering', code: '1440 133' },
  { courseId: '_87240_1', name: 'English for Academic Purposes', code: '0202 112' },
  { courseId: '_85276_1', name: 'Physics 1 Lab', code: '1430 116' },
  { courseId: '_88369_1', name: 'Physics 1', code: '1430 115' },
  { courseId: '_84837_1', name: 'Physics 1', code: '1430 115' },
  { courseId: '_87186_1', name: 'Islamic Culture', code: '0104 100' }
];

function isOrientationOrSandboxCourse(name?: string, externalId?: string): boolean {
  const n = String(name || '');
  const ext = String(externalId || '');
  return /^mock_exam/i.test(ext) || /student\s*hands-on\s*orientation|blackboard\s*orientation/i.test(n);
}

function extractCodeFromExternalId(externalId?: string): string {
  const s = String(externalId || '').trim();
  const m = s.match(/^(\d{4})\s*(\d{3})(?:[_\s-]|$)/) || s.match(/^([A-Za-z]{2,4}[-\s]?\d{3})(?:[_\s-]|$)/);
  if (!m) return '';
  return m[2] ? `${m[1]} ${m[2]}` : m[1].toUpperCase();
}

function stripHtmlToText(html: string): string {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export async function resolveBlackboardOrigin(): Promise<string> {
  try {
    const profile = await getProfile().catch(() => null);
    const uni = profileUniversity(profile);
    if (uni.blackboardUrl) {
      return new URL(uni.blackboardUrl).origin;
    }
    const extra = await getExtraSites().catch(() => []);
    if (extra.length > 0) {
      return new URL(extra[0]).origin;
    }
  } catch {}
  return 'https://elearning.sharjah.ac.ae';
}

let httpScanRunning = false;

export function isHttpScanRunning(): boolean {
  return httpScanRunning;
}

/**
 * Runs a complete Blackboard + Exam Schedule scan directly over HTTP from the service worker
 * using the student's browser cookies, with zero browser tabs required.
 */
export async function runHttpBlackboardScan(
  fullRescan: boolean = false,
  onSync?: () => Promise<any>
): Promise<{ ok: boolean; newCount?: number; message?: string }> {
  if (httpScanRunning) {
    return { ok: true, message: 'Scan already in progress.' };
  }
  httpScanRunning = true;

  try {
    await setScanStatus({
      state: 'running',
      message: fullRescan ? 'Full re-scan: reading Blackboard...' : 'Reading Blackboard...'
    });

    await getUserCourses().catch(() => {});
    const origin = await resolveBlackboardOrigin();
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest'
    };

    const httpFetch = (path: string, init?: RequestInit) =>
      fetch(new URL(path, origin).href, {
        ...init,
        credentials: 'include',
        headers: { ...headers, ...(init?.headers as Record<string, string> || {}) }
      });

    const getJson = async (path: string) => {
      const res = await httpFetch(path);
      if (!res.ok) throw new Error(`Blackboard ${res.status}`);
      return res.json();
    };

    // 1. Check session & get user ID
    let userId = '';
    let expired = false;
    try {
      const meRes = await httpFetch('/learn/api/v1/users/me');
      if (isSessionExpiredResponse(meRes.status, meRes.headers.get('content-type'))) {
        expired = true;
      } else if (meRes.ok) {
        userId = (await meRes.json())?.id || '';
      }
    } catch {}

    if (userId || expired) {
      await chrome.storage.local.set({
        [SESSION_STATUS_KEY]: { expired, checkedAt: new Date().toISOString() }
      }).catch(() => {});
    }

    if (!userId) {
      const msg = 'Sign in to Blackboard first, then click Scan.';
      await setScanStatus({ state: 'error', message: msg });
      return { ok: false, message: msg };
    }

    // 2. Discover courses and colors via HTTP
    const coursesById = new Map<string, { name: string; code: string }>();
    const skippedCourseIds = new Set<string>();
    if (origin.includes('sharjah.ac.ae')) {
      for (const k of KNOWN_UOS_COURSES) {
        coursesById.set(k.courseId, { name: k.name, code: k.code });
      }
    }

    try {
      const coursesRes = await httpFetch('/learn/api/public/v1/users/me/courses?expand=course');
      if (coursesRes.ok) {
        const data = await coursesRes.json();
        if (Array.isArray(data?.results)) {
          for (const item of data.results) {
            const cid = item?.courseId;
            if (typeof cid !== 'string' || !cid.startsWith('_')) continue;
            const rawName = typeof item.course?.name === 'string' ? item.course.name.trim() : '';
            const extId = String(item.course?.courseId || item.course?.externalId || '');
            if (isOrientationOrSandboxCourse(rawName, extId)) {
              skippedCourseIds.add(cid);
              coursesById.delete(cid);
              continue;
            }
            const extCode = extractCodeFromExternalId(extId);
            const parsed = parseCourseDetails(`${extCode} ${rawName}`.trim());
            const code = extCode || (parsed.code !== 'UOS' ? parsed.code : '');
            const name = parsed.name !== 'General Course' ? parsed.name : rawName;
            coursesById.set(cid, { name, code });
          }
        }
      }
    } catch {}

    await autoRegisterDiscoveredCourses(await discoveredCoursesWithColors(getJson)).catch(() => {});

    const courseIds = Array.from(coursesById.keys()).filter(cid => !skippedCourseIds.has(cid));
    const checkpoint = fullRescan
      ? { lastScannedAt: '', processedAnnouncementIds: [], processedDirectTaskIds: [], processedAnnouncementKeys: [] }
      : await getLastScanCheckpoint();
    const knownDirectIds = new Set(checkpoint.processedDirectTaskIds);
    const knownAnnIds = new Set(checkpoint.processedAnnouncementIds);

    const storedTombs = await chrome.storage.local.get(['bbs_tombstones']).catch(() => ({} as Record<string, any>));
    const tombstones = (storedTombs?.bbs_tombstones as Record<string, string>) || {};

    // 3. Fetch Ultra Stream, Course Announcements, and Course Gradebooks in parallel
    const streamPromise = httpFetch('/learn/api/v1/streams/ultra', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providers: {}, forOverview: false, retrieveOnly: true, flushCache: false })
    })
      .then(async r => (r.ok ? parseUltraStreamEntries(await r.json(), coursesById, origin) : { directTasks: [], announcements: [], submissionUpdates: [] }))
      .catch(() => ({ directTasks: [] as DeadlineTask[], announcements: [] as Announcement[], submissionUpdates: [] as TaskSubmissionUpdate[] }));

    const fetchCourseAnns = async (cid: string): Promise<Announcement[]> => {
      const meta = coursesById.get(cid) || { name: 'General Course', code: '' };
      for (const base of ['/learn/api/public/v1', '/learn/api/v1']) {
        try {
          const res = await httpFetch(`${base}/courses/${encodeURIComponent(cid)}/announcements`);
          if (!res.ok) continue;
          const data = await res.json();
          if (!Array.isArray(data?.results)) continue;
          return data.results.map((item: any, idx: number) => {
            const bodyHtml = typeof item.body === 'string' ? item.body : (item.body?.displayText || item.body?.rawText || '');
            const text = stripHtmlToText(bodyHtml);
            const cleanText = sanitizeDoctorAnnouncementText(text, meta.name, meta.code, item.title);
            return {
              id: `ann_api_${item.id || idx}`,
              courseCode: meta.code,
              courseName: meta.name || 'General Course',
              title: item.title || `Announcement ${idx + 1}`,
              postedAt: item.created || new Date().toISOString(),
              contentText: cleanText,
              contentHtml: bodyHtml,
              sourceUrl: `${origin}/ultra/courses/${cid}/outline`,
              scannedAt: new Date().toISOString()
            };
          }).filter((a: Announcement) => a.contentText && a.contentText.length > 5);
        } catch {}
      }
      return [];
    };

    const getAllPages = async (path: string): Promise<{ results: any[] } | null> => {
      try {
        const res = await httpFetch(path);
        if (!res.ok) return null;
        const first = await res.json();
        if (!Array.isArray(first?.results)) return null;
        const results = [...first.results];
        let next: string | undefined = first?.paging?.nextPage;
        for (let page = 0; next && page < 10; page++) {
          const moreRes = await httpFetch(next);
          if (!moreRes.ok) break;
          const more = await moreRes.json();
          if (!Array.isArray(more?.results)) break;
          results.push(...more.results);
          next = more?.paging?.nextPage;
        }
        return { results };
      } catch {
        return null;
      }
    };

    const report: GradebookReportRow[] = [];
    const skippedGrades: string[] = [];
    let coursesRead = 0;

    const [ultraStream, courseAnnLists, gradebookPerCourse] = await Promise.all([
      streamPromise,
      Promise.all(courseIds.map(cid => fetchCourseAnns(cid))),
      Promise.all(courseIds.map(async cid => {
        const meta = coursesById.get(cid) || { name: '', code: '' };
        if (isOrientationOrSandboxCourse(meta.name)) {
          return { updates: [] as TaskSubmissionUpdate[], columnTasks: [] as DeadlineTask[] };
        }
        const [cols, grades] = await Promise.all([
          getAllPages(`/learn/api/v1/courses/${encodeURIComponent(cid)}/gradebook/columns?includeInvisible=false&limit=200`),
          getAllPages(`/learn/api/v1/courses/${encodeURIComponent(cid)}/gradebook/grades?limit=200&userId=${encodeURIComponent(userId)}`)
        ]);
        if (!cols || !grades) {
          report.push({ course: meta.name || cid, column: '', note: 'gradebook not readable' });
          return { updates: [] as TaskSubmissionUpdate[] };
        }
        coursesRead++;
        report.push(...gradebookReport(cols.results, grades.results, meta.name || cid));
        const updates = gradebookToUpdates(cols.results, grades.results, {
          courseName: meta.name && meta.name !== 'General Course' ? meta.name : undefined,
          courseCode: meta.code
        }, skippedGrades);
        return { updates };
      }))
    ]);

    try {
      await chrome.storage.local.set({ [GRADEBOOK_REPORT_KEY]: { readAt: new Date().toISOString(), rows: report } });
    } catch {}

    const apiAnnouncements = courseAnnLists.flat();
    const announcements = mergeStreamAndCourseAnnouncements(
      ultraStream.announcements.filter(a => fullRescan || !knownAnnIds.has(a.id)),
      apiAnnouncements,
      null
    );
    const directStreamTasks = ultraStream.directTasks
      .filter(t => (fullRescan || !knownDirectIds.has(t.id)) && !tombstones[t.id]);
    const gradebookUpdates = gradebookPerCourse.flatMap(g => g.updates);
    const submissionUpdates = [...ultraStream.submissionUpdates, ...gradebookUpdates];

    const settings = await getSettings();
    let existingTasks = await getTasks();
    const { cleaned: cleanedExisting, purgedIds: purgedSyntheticIds } = purgeSyntheticGradebookTasks(existingTasks);
    if (purgedSyntheticIds.length > 0) {
      existingTasks = cleanedExisting;
      purgedSyntheticIds.forEach(id => {
        tombstones[id] = new Date().toISOString();
      });
      await new Promise<void>(resolve => {
        try {
          chrome.storage.local.set({ bbs_tombstones: tombstones }, () => resolve());
        } catch { resolve(); }
      });
    }

    if (announcements.length > 0) {
      await saveAnnouncements(announcements);
    }

    let lastProgressWrite = 0;
    const reportProgress = (done: number, total: number) => {
      const now = Date.now();
      if (done !== 0 && done !== total && now - lastProgressWrite < 400) return;
      lastProgressWrite = now;
      void setScanStatus({
        state: 'running',
        message: `Read ${announcements.length} announcements & ${directStreamTasks.length} stream items. Extracting ${done}/${total}...`,
        done,
        total
      });
    };

    const { newTasks: extractedTasks, allTasks: mergedAnnTasks } = await processAnnouncementsBatch(
      announcements,
      existingTasks,
      settings,
      fullRescan ? undefined : knownAnnIds,
      reportProgress
    );

    const existingIdMap = new Map<string, DeadlineTask>();
    const existingTitleCourseMap = new Map<string, DeadlineTask>();
    const existingDateKeySet = new Set<string>();

    for (const t of mergedAnnTasks) {
      existingIdMap.set(t.id, t);
      const tcKey = titleCourseKeyFor(t);
      if (tcKey) existingTitleCourseMap.set(tcKey, t);
      try {
        existingDateKeySet.add(`${t.courseCode}_${t.title}_${new Date(t.dueDate).toISOString().slice(0, 10)}`);
      } catch {}
    }

    const newlyAddedDirect: DeadlineTask[] = [];
    for (const dt of directStreamTasks) {
      const titleCourseKey = titleCourseKeyFor(dt);
      let dateKey = '';
      try {
        dateKey = `${dt.courseCode}_${dt.title}_${new Date(dt.dueDate).toISOString().slice(0, 10)}`;
      } catch {}

      const matched = existingIdMap.get(dt.id)
        || (titleCourseKey ? existingTitleCourseMap.get(titleCourseKey) : undefined)
        || (dateKey && existingDateKeySet.has(dateKey) ? true : undefined);

      if (matched && typeof matched === 'object') {
        if (!matched.userEdited && matched.extractedBy !== 'manual') {
          if (!matched.hasSpecificTime && dt.hasSpecificTime) {
            matched.dueDate = dt.dueDate;
            matched.hasSpecificTime = dt.hasSpecificTime;
            matched.updatedAt = new Date().toISOString();
          }
        }
      } else if (!matched) {
        newlyAddedDirect.push(dt);
        existingIdMap.set(dt.id, dt);
        if (titleCourseKey) existingTitleCourseMap.set(titleCourseKey, dt);
        if (dateKey) existingDateKeySet.add(dateKey);
      }
    }

    const finalTasks = deduplicateTaskList([...newlyAddedDirect, ...mergedAnnTasks]).filter(isValidTask);
    const marksChanged = applySubmissionUpdates(finalTasks, submissionUpdates);

    const gradebookMarks = submissionUpdates.filter(u => u.sourceId && u.submissionStatus === 'graded');
    const unmatchedMarks = gradebookMarks.filter(u =>
      !finalTasks.some(t => t.gradeSourceId === u.sourceId || (t.gradeSourcesBefore || []).includes(u.sourceId!))
    );
    const gradebookNote = coursesRead === 0
      ? ' Marks: gradebook not readable.'
      : ` Marks: ${gradebookMarks.length - unmatchedMarks.length} of ${gradebookMarks.length} matched${
        unmatchedMarks.length ? ` (no deadline for ${unmatchedMarks.slice(0, 4).map(u => u.title).join(', ')}${unmatchedMarks.length > 4 ? ', ...' : ''})` : ''}.${
        skippedGrades.length ? ` Not read: ${skippedGrades.slice(0, 3).join(', ')}.` : ''}`;

    repairTaskWeightsAndRooms(finalTasks);
    await autoRegisterDiscoveredCourses(finalTasks).catch(() => {});
    await saveTasksMergingLatest(finalTasks);

    const newAnnIds = announcements.map(a => a.id);
    const newDirectIds = directStreamTasks.map(d => d.id);
    const newKeys = announcements.flatMap(a => [
      a.title.toLowerCase().trim(),
      `${a.courseCode}_${a.title.toLowerCase().trim()}`
    ]);
    await saveLastScanCheckpoint({
      lastScannedAt: new Date().toISOString(),
      processedAnnouncementIds: newAnnIds,
      processedDirectTaskIds: newDirectIds,
      processedAnnouncementKeys: newKeys
    });

    const totalNewCount = newlyAddedDirect.length + extractedTasks.length;
    const baseMessage = (totalNewCount > 0
      ? `Added ${totalNewCount} new deadline${totalNewCount > 1 ? 's' : ''} to calendar!`
      : (marksChanged > 0
        ? `Up to date. Added or updated ${marksChanged} mark${marksChanged > 1 ? 's' : ''}.`
        : `Up to date. Read ${announcements.length + directStreamTasks.length} items with no new deadlines.`)) + gradebookNote;

    await setScanStatus({ state: 'running', message: `${baseMessage} Reading your exam schedule...` });
    const examRes = await refreshExamSchedule(fullRescan).catch(() => null);
    const examAdded = examRes?.state === 'read' ? examRes.added || 0 : 0;
    const finalMessage = baseMessage + examRefreshNote(examRes);
    const finalNewCount = totalNewCount + examAdded;

    await setScanStatus({
      state: 'done',
      message: finalMessage,
      newCount: finalNewCount
    });

    if (settings.autoSyncOnScan !== false && onSync) {
      await onSync().catch(() => {});
    }

    return { ok: true, newCount: finalNewCount, message: finalMessage };
  } catch (err) {
    console.error('[HTTP Scanner] Error during HTTP scan:', err);
    const msg = 'Could not reach Blackboard. Check your connection or sign in to Blackboard.';
    await setScanStatus({ state: 'error', message: msg });
    return { ok: false, message: msg };
  } finally {
    httpScanRunning = false;
  }
}
