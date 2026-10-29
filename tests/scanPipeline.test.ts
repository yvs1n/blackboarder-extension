import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Announcement, DeadlineTask, TaskSubmissionUpdate, TaskType } from '../src/types';
import { runScanPipeline, emptyCheckpoint } from '../src/scan/scanPipeline';
import { runHttpBlackboardScan } from '../src/background/httpScanner';
import { readBlackboardApi, fetchEnrolledCourses } from '../src/scan/blackboardApi';
import { processAnnouncementsBatch, titleCourseKeyFor } from '../src/engine/hybridExtractor';
import { getSettings, getTasks, saveTasksMergingLatest, saveAnnouncements, saveLastScanCheckpoint, autoRegisterDiscoveredCourses } from '../src/utils/storage';
import { isValidTask } from '../src/core/courseHelper';
import { deduplicateTaskList } from '../src/utils/taskMerge';
import { applySubmissionUpdates, purgeSyntheticGradebookTasks } from '../src/utils/gradebook';
import { repairTaskWeightsAndRooms } from '../src/utils/taskRepair';
import { mergeStreamAndCourseAnnouncements } from '../src/utils/announcementMerge';

/** chrome.storage.local in memory, callback and promise forms. */
function installChrome(initial: Record<string, any> = {}) {
  const data: Record<string, any> = JSON.parse(JSON.stringify(initial));
  const pick = (keys: any) => {
    const list = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
    return Object.fromEntries(list.filter((k: string) => k in data).map((k: string) => [k, JSON.parse(JSON.stringify(data[k]))]));
  };
  const local = {
    get: (keys: any, cb?: (r: any) => void) => {
      const r = pick(keys);
      if (cb) { cb(r); return undefined; }
      return Promise.resolve(r);
    },
    set: (items: Record<string, any>, cb?: () => void) => {
      Object.assign(data, JSON.parse(JSON.stringify(items)));
      if (cb) { cb(); return undefined; }
      return Promise.resolve();
    },
    remove: (_k: any, cb?: () => void) => { if (cb) cb(); return Promise.resolve(); }
  };
  vi.stubGlobal('chrome', {
    runtime: { id: 'test', lastError: undefined, sendMessage: vi.fn(), getManifest: () => ({}) },
    storage: { local, onChanged: { addListener: () => {} } }
  });
  return data;
}

const ann = (over: Partial<Announcement>): Announcement => ({
  id: 'ann_api_x',
  courseCode: '1440 133',
  courseName: 'Calculus I for Engineering',
  title: 'Announcement',
  postedAt: '2026-10-20T09:00:00.000Z',
  contentText: '',
  sourceUrl: 'https://elearning.sharjah.ac.ae/ultra/courses/_100_1/outline',
  scannedAt: '2026-10-20T09:00:00.000Z',
  ...over
});

const STREAM_ANNS: Announcement[] = [
  ann({ id: 'ann_ultra_s1', title: 'Quiz 3', contentText: 'Quiz 3 will be conducted on Thursday, 29 October 2026, during the lecture time.' })
];
const COURSE_ANNS: Announcement[] = [
  ann({ id: 'ann_api_c1', title: 'Quiz 3', contentText: 'Dear Students, Quiz 3 will be conducted on Thursday, 29 October 2026, during the lecture time. Quiz 3 will cover Modules 6 and 7.' }),
  ann({ id: 'ann_api_c2', courseCode: '1430 115', courseName: 'Physics 1', title: 'Midterm Exam', contentText: 'The midterm exam is on Monday, 2 November 2026 at 12:30 pm in room M5-101.' })
];
const DIRECT: DeadlineTask[] = [{
  id: 'stream_hw4', courseCode: '1430 115', courseName: 'Physics 1', title: 'Homework 4', description: 'Due Date: 11/05/26, 11:59 PM',
  dueDate: '2026-11-05T19:59:00.000Z', hasSpecificTime: true, type: 'assignment', priority: 'medium', status: 'pending',
  confidence: 1, extractedBy: 'local', sourceSnippet: 'Due Date: 11/05/26, 11:59 PM', createdAt: '2026-10-20T09:00:00.000Z', updatedAt: '2026-10-20T09:00:00.000Z'
}];
const UPDATES: TaskSubmissionUpdate[] = [
  { title: 'Homework 4', courseName: 'Physics 1', courseCode: '1430 115', submissionStatus: 'graded', score: 8, maxScore: 10, sourceId: 'gb:_501_1', gradedAt: '2026-10-25T10:00:00.000Z' } as TaskSubmissionUpdate,
  { title: 'Lab Report 2', courseName: 'Physics 1', courseCode: '1430 115', submissionStatus: 'graded', score: 9, maxScore: 10, sourceId: 'gb:_502_1', gradedAt: '2026-10-26T10:00:00.000Z' } as TaskSubmissionUpdate
];
const EDITED: DeadlineTask = {
  id: 'task_user_1', courseCode: '1440 133', courseName: 'Calculus I for Engineering', title: 'Quiz 2', description: 'my own note',
  dueDate: '2026-10-15T08:00:00.000Z', hasSpecificTime: true, type: 'quiz', priority: 'high', status: 'pending',
  confidence: 1, extractedBy: 'manual', userEdited: true, room: 'My Room', sourceSnippet: '', createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z'
};

/** The pipeline as runHttpBlackboardScan ran it before the scanners shared one (v1.4.11), kept to prove nothing changed. */
async function legacyPipeline(streamAnns: Announcement[], courseAnns: Announcement[], direct: DeadlineTask[], updates: TaskSubmissionUpdate[]) {
  const fullRescan = false;
  const checkpoint = emptyCheckpoint();
  const knownDirectIds = new Set(checkpoint.processedDirectTaskIds);
  const knownAnnIds = new Set(checkpoint.processedAnnouncementIds);
  const tombstones = ((await chrome.storage.local.get(['bbs_tombstones'])) as any).bbs_tombstones || {};
  const announcements = mergeStreamAndCourseAnnouncements(streamAnns.filter(a => fullRescan || !knownAnnIds.has(a.id)), courseAnns, null);
  const directStreamTasks = direct.filter(t => (fullRescan || !knownDirectIds.has(t.id)) && !tombstones[t.id]);
  const settings = await getSettings();
  let existingTasks = await getTasks();
  const { cleaned, purgedIds } = purgeSyntheticGradebookTasks(existingTasks);
  if (purgedIds.length > 0) {
    existingTasks = cleaned;
    purgedIds.forEach(id => { tombstones[id] = new Date().toISOString(); });
    await chrome.storage.local.set({ bbs_tombstones: tombstones });
  }
  if (announcements.length > 0) await saveAnnouncements(announcements);
  const { allTasks: mergedAnnTasks } = await processAnnouncementsBatch(announcements, existingTasks, settings, fullRescan ? undefined : knownAnnIds, () => {});
  const existingIdMap = new Map<string, DeadlineTask>();
  const existingTitleCourseMap = new Map<string, DeadlineTask>();
  const existingDateKeySet = new Set<string>();
  for (const t of mergedAnnTasks) {
    existingIdMap.set(t.id, t);
    const k = titleCourseKeyFor(t);
    if (k) existingTitleCourseMap.set(k, t);
    try { existingDateKeySet.add(`${t.courseCode}_${t.title}_${new Date(t.dueDate).toISOString().slice(0, 10)}`); } catch {}
  }
  const newlyAddedDirect: DeadlineTask[] = [];
  for (const dt of directStreamTasks) {
    const k = titleCourseKeyFor(dt);
    let dateKey = '';
    try { dateKey = `${dt.courseCode}_${dt.title}_${new Date(dt.dueDate).toISOString().slice(0, 10)}`; } catch {}
    const matched = existingIdMap.get(dt.id) || (k ? existingTitleCourseMap.get(k) : undefined) || (dateKey && existingDateKeySet.has(dateKey) ? true : undefined);
    if (matched && typeof matched === 'object') {
      if (!matched.userEdited && matched.extractedBy !== 'manual' && !matched.hasSpecificTime && dt.hasSpecificTime) {
        matched.dueDate = dt.dueDate;
        matched.hasSpecificTime = dt.hasSpecificTime;
        matched.updatedAt = new Date().toISOString();
      }
    } else if (!matched) {
      newlyAddedDirect.push(dt);
      existingIdMap.set(dt.id, dt);
      if (k) existingTitleCourseMap.set(k, dt);
      if (dateKey) existingDateKeySet.add(dateKey);
    }
  }
  const finalTasks = deduplicateTaskList([...newlyAddedDirect, ...mergedAnnTasks]).filter(isValidTask);
  applySubmissionUpdates(finalTasks, updates);
  const gradebookMarks = updates.filter(u => u.sourceId && u.submissionStatus === 'graded');
  const unmatched = gradebookMarks.filter(u => !finalTasks.some(t => t.gradeSourceId === u.sourceId || (t.gradeSourcesBefore || []).includes(u.sourceId!)));
  const ts = new Date().toISOString();
  for (const u of unmatched) {
    if (typeof u.score !== 'number' || !u.maxScore) continue;
    const courseKey = (u.courseCode || u.courseName || 'other').replace(/[^A-Za-z0-9_]/g, '');
    const colId = (u.sourceId || '').replace(/^gb:/, '');
    let type: TaskType = 'assignment';
    const low = (u.title || '').toLowerCase();
    if (/quiz|كويز|اختبار\s*قصير/i.test(low)) type = 'quiz';
    else if (/\b(?:exam|mid[\s_-]*term|final)\b|امتحان|اختبار\s*(?:نصفي|نهائي|فصلي)/i.test(low)) type = 'exam';
    else if (/project|مشروع|بحث/i.test(low)) type = 'project';
    else if (/lab|تقرير/i.test(low)) type = 'lab';
    finalTasks.push({
      id: `gbcol_${courseKey}_${colId || u.title.replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}`,
      courseCode: u.courseCode || '', courseName: u.courseName || u.courseCode || 'Other', title: u.title || 'Graded Item',
      description: '', dueDate: '', hasSpecificTime: false, type, priority: type === 'exam' || type === 'quiz' ? 'high' : 'medium',
      status: 'completed', submissionStatus: 'graded', score: u.score, maxScore: u.maxScore, scoreDisplay: u.scoreDisplay,
      gradeSourceId: u.sourceId, gradedAt: u.gradedAt, sourceSnippet: 'gradebook', confidence: 1.0, extractedBy: 'local', createdAt: ts, updatedAt: ts
    });
  }
  repairTaskWeightsAndRooms(finalTasks);
  await autoRegisterDiscoveredCourses(finalTasks).catch(() => {});
  await saveTasksMergingLatest(finalTasks);
  await saveLastScanCheckpoint({
    lastScannedAt: new Date().toISOString(),
    processedAnnouncementIds: announcements.map(a => a.id),
    processedDirectTaskIds: directStreamTasks.map(d => d.id),
    processedAnnouncementKeys: announcements.flatMap(a => [a.title.toLowerCase().trim(), `${a.courseCode}_${a.title.toLowerCase().trim()}`])
  });
}

/** Ids made from Date.now() and Math.random() repeat when both are fixed. */
function deterministic() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T08:00:00.000Z'));
  let seed = 1;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  });
}

const STORE = () => ({ bbs_settings: { useAiExtraction: false, autoSyncOnScan: false }, bbs_tasks: [EDITED] });

describe('the shared scan pipeline', () => {
  beforeEach(() => vi.spyOn(console, 'info').mockImplementation(() => {}));
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('saves exactly what the scanner saved before, for the same inputs', async () => {
    deterministic();
    const before = installChrome(STORE());
    await legacyPipeline(STREAM_ANNS, COURSE_ANNS, DIRECT, UPDATES);
    const legacyTasks = before.bbs_tasks;
    const legacyCheckpoint = before.bbs_last_scanned;
    expect(legacyCheckpoint?.processedAnnouncementIds?.length).toBeGreaterThan(0);

    vi.restoreAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    deterministic();
    const after = installChrome(STORE());
    const result = await runScanPipeline({
      streamAnnouncements: STREAM_ANNS,
      courseAnnouncements: COURSE_ANNS,
      directTasks: DIRECT,
      submissionUpdates: UPDATES,
      gradebook: { courses: 2, coursesRead: 2, skipped: [] },
      checkpoint: emptyCheckpoint(),
      fullRescan: false,
      isInteractive: () => false
    });

    expect(after.bbs_tasks).toEqual(legacyTasks);
    expect(after.bbs_last_scanned).toEqual(legacyCheckpoint);
    // The inputs were real work: a quiz, an exam, the stream homework (with its mark) and the unannounced lab mark
    const titles = (after.bbs_tasks as DeadlineTask[]).map(t => t.title);
    expect(titles).toEqual(expect.arrayContaining(['Homework 4', 'Lab Report 2', 'Quiz 2']));
    expect((after.bbs_tasks as DeadlineTask[]).find(t => t.title === 'Homework 4')?.score).toBe(8);
    // The student's own task is untouched
    expect((after.bbs_tasks as DeadlineTask[]).find(t => t.id === 'task_user_1')).toMatchObject({ room: 'My Room', description: 'my own note', dueDate: EDITED.dueDate });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/Marks: \d+ of 2 matched/);
  });

  it('a second scan with the checkpoint skips what the first one read', async () => {
    deterministic();
    const store = installChrome(STORE());
    const input = {
      streamAnnouncements: STREAM_ANNS, courseAnnouncements: [], directTasks: DIRECT, submissionUpdates: [],
      gradebook: { courses: 0, coursesRead: 0, skipped: [] }, fullRescan: false, isInteractive: () => false
    };
    const first = await runScanPipeline({ ...input, checkpoint: emptyCheckpoint() });
    expect(first.newCount).toBeGreaterThan(0);
    const { getLastScanCheckpoint } = await import('../src/utils/storage');
    const checkpoint = await getLastScanCheckpoint();
    expect(checkpoint.processedDirectTaskIds).toContain('stream_hw4');
    const second = await runScanPipeline({ ...input, checkpoint });
    expect(second.newCount).toBe(0);
    expect(second.message).toMatch(/Up to date/);
    expect(second.message).toContain('Marks: gradebook not readable.');
    expect(store.bbs_tasks.length).toBeGreaterThan(0);
  });
});

/** A Blackboard origin answering the HTTP scan's requests from a route table. */
function blackboard(routes: Record<string, any>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(String(url));
    const key = `${init?.method || 'GET'} ${u.pathname}`;
    calls.push(`${key}${u.search}`);
    const body = routes[key];
    if (body === undefined) return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    if (body instanceof Response) return body;
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(typeof body === 'function' ? body(u) : body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

describe('the HTTP scan reports what it could read', () => {
  beforeEach(() => vi.spyOn(console, 'info').mockImplementation(() => {}));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const ME = { 'GET /learn/api/v1/users/me': { id: '_77_1' } };

  it('reads only the enrolled courses (every page), never a built-in list', async () => {
    installChrome(STORE());
    const calls = blackboard({
      ...ME,
      'GET /learn/api/public/v1/users/me/courses': (u: URL) => u.searchParams.get('offset')
        ? { results: [{ courseId: '_200_1', course: { name: 'Physics 1', courseId: '1430115_51_2610' } }] }
        : { results: [{ courseId: '_100_1', course: { name: 'Calculus I for Engineering', courseId: '1440133_21_2610' } }], paging: { nextPage: '/learn/api/public/v1/users/me/courses?expand=course&offset=1' } },
      'POST /learn/api/v1/streams/ultra': { sv_streamEntries: [] },
      'GET /learn/api/public/v1/courses/_100_1/announcements': { results: [{ id: '_9001_1', title: 'Quiz 3', body: '<p>Quiz 3 will be conducted on Thursday, 29 October 2026.</p>', created: '2026-10-22T09:00:00.000Z' }] },
      'GET /learn/api/public/v1/courses/_200_1/announcements': new Response('{}', { status: 403, headers: { 'Content-Type': 'application/json' } }),
      'GET /learn/api/v1/courses/_200_1/announcements': new Response('{}', { status: 403, headers: { 'Content-Type': 'application/json' } }),
      'GET /learn/api/v1/courses/_100_1/gradebook/columns': { results: [] },
      'GET /learn/api/v1/courses/_100_1/gradebook/grades': { results: [] }
    });
    const res = await runHttpBlackboardScan({ refreshExam: false, run: { interactive: false, reported: false } });
    expect(res.ok).toBe(true);
    expect(res.needsFallback).toBeFalsy();
    expect(res.sources).toMatchObject({ session: 'ok', courses: { ok: true, count: 2 }, stream: { ok: true }, announcements: { ok: 1, failed: 1 }, gradebook: { ok: 1, failed: 1 } });
    expect(res.message).toContain('1 course could not be read.');
    const courseIds = new Set(calls.map(c => (c.match(/courses\/(_\d+_\d+)/) || [])[1]).filter(Boolean));
    expect([...courseIds].sort()).toEqual(['_100_1', '_200_1']);
  });

  it('signed out: says so, saves nothing, no fallback', async () => {
    const store = installChrome(STORE());
    blackboard({ 'GET /learn/api/v1/users/me': new Response('{}', { status: 401 }) });
    const res = await runHttpBlackboardScan({ refreshExam: false, run: { interactive: true, reported: false } });
    expect(res).toMatchObject({ ok: false, fallbackReason: 'expired' });
    expect(res.needsFallback).toBeFalsy();
    expect(res.message).toMatch(/sign in/i);
    expect(store.bbs_session_status.expired).toBe(true);
    expect(store.bbs_tasks).toEqual([EDITED]);
  });

  it('unreachable: asks for the tab scanner and saves nothing', async () => {
    const store = installChrome(STORE());
    blackboard({ 'GET /learn/api/v1/users/me': new TypeError('Failed to fetch') });
    const res = await runHttpBlackboardScan({ refreshExam: false, run: { interactive: true, reported: false } });
    expect(res).toMatchObject({ ok: false, needsFallback: true, fallbackReason: 'unreachable' });
    expect(store.bbs_tasks).toEqual([EDITED]);
    expect(store.bbs_scan_status?.state).toBe('running');
  });

  it('course list and stream both failing asks for the tab scanner', async () => {
    installChrome(STORE());
    blackboard({ ...ME });
    const res = await runHttpBlackboardScan({ refreshExam: false, run: { interactive: false, reported: false } });
    expect(res).toMatchObject({ ok: false, needsFallback: true, fallbackReason: 'no-data' });
  });

  it('a failed course list is a failure, not an empty list', async () => {
    blackboard({ 'GET /learn/api/public/v1/users/me/courses': new Response('<html>sign in</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }) });
    const fetchFn = (path: string, init?: RequestInit) => fetch(new URL(path, 'https://elearning.sharjah.ac.ae').href, init);
    const enrolled = await fetchEnrolledCourses(fetchFn);
    expect(enrolled.ok).toBe(false);
    const read = await readBlackboardApi(fetchFn, { origin: 'https://elearning.sharjah.ac.ae' });
    expect(read.sources.session).toBe('unreachable');
  });
});
