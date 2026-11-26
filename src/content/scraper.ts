import { Announcement, DeadlineTask } from '../types';
import { getSettings, getStoredPayments, getTasks, saveStoredPayments, saveTasksMergingLatest, getLastScanCheckpoint, isExtensionContextValid, getUserCourses, autoRegisterDiscoveredCourses, setScanStatus, getScanStatus } from '../utils/storage';
import { setActiveUserCourses } from '../core/userCourses';
import { isValidTask } from '../core/courseHelper';
import { deduplicateTaskList } from '../utils/taskMerge';
import { GRADEBOOK_REPORT_KEY } from '../utils/gradebook';
import { repairTaskWeightsAndRooms } from '../utils/taskRepair';
import { mergeStreamAndCourseAnnouncements } from '../utils/announcementMerge';
import { startCourseColorPainter, discoveredCoursesWithColors } from './courseColorPainter';
import { startActivityFilter } from './activityFilter';
import { startStudentProfileBadge } from './studentProfileBadge';
import { extractStudentFromBlackboardPage } from './studentProfileExtractor';
import { SESSION_STATUS_KEY } from '../utils/sessionStatus';
import { ScanGate, ScanRun } from './scanGate';
import { detectUniversityFromHost } from '../utils/profile';
import { isExamSchedulePage, scrapeExamScheduleFromDoc, mergeExamScheduleTasks, extractStudentFromExamDoc } from '../core/examSchedule';
import { isFinancePortalPage, parseFinancePageFromDoc } from '../core/financePageParser';
import { mergeCloudPayments } from '../core/payments';
import { getLocalTombstones, setStorageTombstones } from '../utils/tombstones';
import { ExamRefreshResult, examRefreshNote } from '../utils/examRefreshNote';
import { fetchCourseAnnouncements, isGenericPlaceholderName, readBlackboardApi } from '../scan/blackboardApi';
import { runScanPipeline, emptyCheckpoint } from '../scan/scanPipeline';
import { claimAutoScan } from '../scan/autoScan';
import {
  bbFetch,
  collectPageCourses,
  getBlackboardJson,
  logCourseAnnouncementRead,
  saveStudentProfileIfFound,
  scrapeOpenDrawerAnnouncement,
  startCourseLookup,
  tabFetch
} from './classicAnnouncementFetch';
import {
  scrapeAnnouncements,
  scrapeEnrolledCourses,
  scrapeStreamSubmissionsAndGrades,
  scrapeUltraStreamDueItems
} from './domStreamScraper';
import {
  injectFloatingButton,
  showExtensionReloadToast,
  showSidekickToast,
  teardownOrphanedContentScript
} from './contentUi';

export { bbFetch, saveStudentProfileIfFound };

/** Saves whether the Blackboard session is alive (from the users/me call), for the popup's banner. */
function saveSessionStatus(expired: boolean): void {
  try {
    chrome.storage.local.set({ [SESSION_STATUS_KEY]: { expired, checkedAt: new Date().toISOString() } });
  } catch {
    // The extension may have been reloaded; the next scan saves it again
  }
}

let lastGradebookRead = { signedIn: false, expired: false, courses: 0, coursesRead: 0, skipped: [] as string[] };
let lastTabScanResult: { ok: boolean; newCount: number; message: string } | null = null;
let lastTabScanToastAt = 0;

/**
 * Orchestrates announcement scraping across DOM cards, REST APIs, and open drawers.
 */
export async function scrapeAnnouncementsFull(options?: { fullRescan?: boolean }): Promise<Announcement[]> {
  const checkpoint = options?.fullRescan ? emptyCheckpoint() : await getLastScanCheckpoint();
  const knownAnnIds = new Set(checkpoint.processedAnnouncementIds);
  const knownKeys = new Set(checkpoint.processedAnnouncementKeys || []);

  const lookup = startCourseLookup(collectPageCourses());
  const domAnnouncements = await scrapeAnnouncements(
    options?.fullRescan ? undefined : knownAnnIds,
    options?.fullRescan ? undefined : knownKeys,
    lookup.resolve
  );

  const courses = await lookup.courses();
  const courseIds = Array.from(courses.keys());
  const results = await Promise.all(
    courseIds.map(cid => fetchCourseAnnouncements(tabFetch, cid, courses.get(cid), window.location.origin))
  );
  const apiAnnouncements = results.flatMap(r => (r.ok ? r.announcements : []));
  logCourseAnnouncementRead(domAnnouncements.length, apiAnnouncements.length, courseIds, courseIds.filter((_, i) => !results[i].ok));

  return mergeStreamAndCourseAnnouncements(domAnnouncements, apiAnnouncements, scrapeOpenDrawerAnnouncement());
}

const scanGate = new ScanGate({
  scan: runScanInner,
  onBecameInteractive: run => setScanStatus({
    state: 'running',
    message: run.fullRescan ? 'Full re-scan: reading Blackboard...' : 'Reading Blackboard...'
  }),
  onUnreported: async run => {
    run.reported = true;
    await setScanStatus({ state: 'done', message: 'Scan finished.', newCount: 0 });
  }
});

/** Runs a scan in this Blackboard tab and saves the result. */
export function runScan(interactive: boolean = false, fullRescan: boolean = false): Promise<void> {
  return scanGate.run(interactive, fullRescan);
}

async function runScanInner(run: ScanRun) {
  const onExamPage = isExamSchedulePage(window.location, document);
  const onFinancePage = isFinancePortalPage(window.location, document);
  await runBlackboardScan(run);
  if (!onExamPage && !onFinancePage) await refreshExamScheduleAfterScan(run);
}

async function waitForExamScheduleTasks(maxWaitMs = 5000): Promise<DeadlineTask[]> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const tasks = scrapeExamScheduleFromDoc(document);
    if (tasks.length > 0) return tasks;
    await new Promise(r => setTimeout(r, 250));
  }
  return scrapeExamScheduleFromDoc(document);
}

async function runExamScheduleScan(run: ScanRun, waitMs?: number): Promise<{ found: number; added: number; updated: number }> {
  if (run.interactive) {
    await setScanStatus({ state: 'running', message: 'Reading exam schedule...' });
  }

  await getUserCourses().catch(() => []);

  const tombstones: Record<string, string> = await new Promise(resolve => {
    try {
      chrome.storage.local.get(['bbs_tombstones'], res => resolve((res?.bbs_tombstones as Record<string, string>) || {}));
    } catch {
      resolve({});
    }
  });

  const rawExamTasks = await waitForExamScheduleTasks(waitMs ?? (run.interactive ? 5000 : 3500));
  const startOfTodayMs = new Date().setHours(0, 0, 0, 0);
  let restoredUpcomingCount = 0;
  let skippedPastTombstonedCount = 0;

  if (run.interactive || run.fullRescan) {
    let tombstonesChanged = false;
    const nowIso = new Date().toISOString();
    for (const exam of rawExamTasks) {
      if (!tombstones[exam.id]) continue;
      const dueMs = Date.parse(exam.dueDate || '');
      if (!isNaN(dueMs) && dueMs >= startOfTodayMs) {
        delete tombstones[exam.id];
        exam.updatedAt = nowIso;
        tombstonesChanged = true;
        restoredUpcomingCount++;
      } else {
        skippedPastTombstonedCount++;
      }
    }
    if (tombstonesChanged) {
      await setStorageTombstones(tombstones).catch(() => {});
    }
  } else {
    skippedPastTombstonedCount = rawExamTasks.filter(t => Boolean(tombstones[t.id])).length;
  }

  const examTasks = rawExamTasks.filter(t => !tombstones[t.id]);
  if (examTasks.length === 0) {
    lastTabScanResult = { ok: true, newCount: 0, message: 'No exam schedule rows found on this page.' };
    if (run.interactive) {
      showSidekickToast('Blackboarder', 'No exam rows found on this page yet. Wait for the table to load and try again.');
      run.reported = true;
      await setScanStatus({ state: 'done', message: 'No exam schedule rows found on this page.', newCount: 0 });
    }
    return { found: 0, added: 0, updated: 0 };
  }

  const existingTasks = await getTasks();
  saveStudentProfileIfFound(extractStudentFromExamDoc(document));
  const { tasks: mergedTasks, addedCount, updatedCount } = mergeExamScheduleTasks(existingTasks, examTasks, tombstones);
  const finalTasks = deduplicateTaskList(mergedTasks).filter(isValidTask);

  await autoRegisterDiscoveredCourses(examTasks).catch(() => {});
  repairTaskWeightsAndRooms(finalTasks);
  await saveTasksMergingLatest(finalTasks);

  try {
    const currentSettings = await getSettings();
    if (currentSettings.autoSyncOnScan !== false && isExtensionContextValid()) {
      chrome.runtime.sendMessage({ type: 'SYNC_TO_SERVER' }).catch(() => {});
    }
  } catch {}

  const badge = document.getElementById('bbs-floating-badge');
  if (badge) {
    const pendingCount = finalTasks.filter(t => t.status === 'pending' && t.visibility !== 'hidden').length;
    if (pendingCount > 0) {
      badge.textContent = String(pendingCount);
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  const changedTotal = addedCount + updatedCount;
  lastTabScanResult = { ok: true, newCount: addedCount, message: `Read ${examTasks.length} exams from the exam schedule.` };
  const pastSkippedSuffix = skippedPastTombstonedCount > 0
    ? ` (${skippedPastTombstonedCount} deleted past exam${skippedPastTombstonedCount > 1 ? 's' : ''} kept hidden)`
    : '';
  if (run.interactive || changedTotal > 0) {
    const msg = addedCount > 0
      ? (restoredUpcomingCount > 0
        ? `Added <strong>${addedCount}</strong> exam${addedCount > 1 ? 's' : ''} (including ${restoredUpcomingCount} restored upcoming)${updatedCount > 0 ? ` and updated ${updatedCount}` : ''} from your Exam Schedule!`
        : `Added <strong>${addedCount}</strong> exam${addedCount > 1 ? 's' : ''}${updatedCount > 0 ? ` and updated ${updatedCount}` : ''} from your Exam Schedule!`)
      : updatedCount > 0
        ? `Updated <strong>${updatedCount}</strong> exam${updatedCount > 1 ? 's' : ''} from your Exam Schedule!`
        : `All ${examTasks.length} exams on this schedule are already in your calendar.${pastSkippedSuffix}`;
    showSidekickToast('Exam Schedule Scanned', msg, changedTotal);
  }
  if (run.interactive) {
    run.reported = true;
    await setScanStatus({
      state: 'done',
      message: addedCount > 0
        ? `Added ${addedCount} exam${addedCount > 1 ? 's' : ''}${updatedCount > 0 ? ` and updated ${updatedCount}` : ''} from the exam schedule!`
        : updatedCount > 0
          ? `Updated ${updatedCount} exam${updatedCount > 1 ? 's' : ''} from the exam schedule.`
          : `Up to date. All ${examTasks.length} exams on this page are in your calendar.${pastSkippedSuffix}`,
      newCount: addedCount
    });
  }
  return { found: examTasks.length, added: addedCount, updated: updatedCount };
}

async function refreshExamScheduleAfterScan(run: ScanRun): Promise<void> {
  if (!run.interactive || !isExtensionContextValid()) return;
  const before = await getScanStatus();
  if (!before || before.state !== 'done') return;
  await setScanStatus({ state: 'running', message: `${before.message} Reading your exam schedule...` });
  const res: ExamRefreshResult | null = await new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type: 'REFRESH_EXAM_SCHEDULE', force: run.fullRescan }, r => {
        void chrome.runtime.lastError;
        resolve(r || null);
      });
    } catch {
      resolve(null);
    }
  });
  const added = res?.state === 'read' ? res.added || 0 : 0;
  const updated = res?.state === 'read' ? res.updated || 0 : 0;
  await setScanStatus({
    state: 'done',
    message: before.message + examRefreshNote(res),
    newCount: (before.newCount || 0) + added
  });
  if (added + updated > 0) {
    showSidekickToast('Exam Schedule', `${added ? `Added <strong>${added}</strong> exam${added > 1 ? 's' : ''}` : ''}${added && updated ? ' and ' : ''}${updated ? `updated ${updated}` : ''} from your exam schedule.`, added);
  }
}

async function runFinancePageScan(run: ScanRun): Promise<{ found: number; added: number }> {
  if (run.interactive) {
    await setScanStatus({ state: 'running', message: 'Reading payment deadlines from this page...' });
  }
  const scraped = parseFinancePageFromDoc(document, window.location.href);
  if (scraped.length === 0) {
    lastTabScanResult = { ok: true, newCount: 0, message: 'No installment or due date rows found on this page yet.' };
    if (run.interactive) {
      run.reported = true;
      await setScanStatus({ state: 'done', message: lastTabScanResult.message, newCount: 0 });
      showSidekickToast('Finance Page Scanned', lastTabScanResult.message, 0);
    }
    return { found: 0, added: 0 };
  }
  const existing = await getStoredPayments();
  const tombs = getLocalTombstones();
  const existingIds = new Set(existing.map(p => p.id));
  const merged = mergeCloudPayments(existing, scraped, tombs);
  const added = merged.filter(p => !existingIds.has(p.id)).length;
  await saveStoredPayments(merged, new Date().toISOString());
  try {
    const currentSettings = await getSettings();
    if (currentSettings.autoSyncOnScan !== false && isExtensionContextValid()) {
      chrome.runtime.sendMessage({ type: 'SYNC_TO_SERVER' }).catch(() => {});
    }
  } catch {}
  const msg = added > 0
    ? `Saved ${added} new fee deadline${added > 1 ? 's' : ''} (${scraped.length} scanned).`
    : `All ${scraped.length} fee deadlines on this page are already tracked.`;
  lastTabScanResult = { ok: true, newCount: added, message: msg };
  if (run.interactive || added > 0) showSidekickToast('Payments Scanned', msg, added);
  if (run.interactive) {
    run.reported = true;
    await setScanStatus({ state: 'done', message: msg, newCount: added });
  }
  return { found: scraped.length, added };
}

async function runBlackboardScan(run: ScanRun) {
  const { fullRescan } = run;
  if (!isExtensionContextValid()) {
    teardownOrphanedContentScript();
    if (run.interactive) {
      showExtensionReloadToast();
    } else {
      console.info('[Blackboarder] Extension was reloaded; refresh this tab to reconnect.');
    }
    lastTabScanResult = { ok: false, newCount: 0, message: 'Blackboarder was reloaded. Refresh the Blackboard tab and try again.' };
    return;
  }

  await getUserCourses().catch(() => {});

  if (isExamSchedulePage(window.location, document)) {
    await runExamScheduleScan(run);
    return;
  }
  if (isFinancePortalPage(window.location, document)) {
    await runFinancePageScan(run);
    return;
  }

  if (run.interactive) {
    await setScanStatus({ state: 'running', message: fullRescan ? 'Full re-scan: reading Blackboard...' : 'Reading Blackboard...' });
  }

  try {
    const checkpoint = fullRescan ? emptyCheckpoint() : await getLastScanCheckpoint();
    const knownDirectIds = new Set(checkpoint.processedDirectTaskIds);
    const knownAnnIds = new Set(checkpoint.processedAnnouncementIds);
    const knownKeys = new Set(checkpoint.processedAnnouncementKeys || []);

    const domDirectTasks = scrapeUltraStreamDueItems(fullRescan ? undefined : knownDirectIds);
    const domSubmissionUpdates = scrapeStreamSubmissionsAndGrades();
    const page = collectPageCourses();
    const lookup = startCourseLookup(page);

    if (run.signal?.aborted) return;
    const [api, domAnnouncements] = await Promise.all([
      readBlackboardApi(tabFetch, {
        origin: window.location.origin,
        pageCourses: page.courses,
        pageSkipped: page.skipped,
        enrolled: lookup.enrolled,
        signal: run.signal
      }),
      scrapeAnnouncements(fullRescan ? undefined : knownAnnIds, fullRescan ? undefined : knownKeys, lookup.resolve)
    ]);
    if (run.signal?.aborted) return;
    const { sources } = api;
    lastGradebookRead = {
      signedIn: sources.session === 'ok',
      expired: sources.session === 'expired',
      courses: api.courseIds.length,
      coursesRead: sources.gradebook.ok,
      skipped: api.skippedGrades
    };
    if (lastGradebookRead.signedIn || lastGradebookRead.expired) saveSessionStatus(lastGradebookRead.expired);
    if (lastGradebookRead.signedIn) {
      try {
        chrome.storage.local.set({ [GRADEBOOK_REPORT_KEY]: { readAt: new Date().toISOString(), rows: api.gradebookReport } });
      } catch {}
      logCourseAnnouncementRead(domAnnouncements.length, api.courseAnnouncements.length, api.courseIds, sources.announcements.failedCourseIds);
    }
    const domProfile = extractStudentFromBlackboardPage(document);
    const combinedProfile = api.userProfile
      ? {
          ...domProfile,
          ...api.userProfile,
          studentName: (api.userProfile.studentName && !isGenericPlaceholderName(api.userProfile.studentName))
            ? api.userProfile.studentName
            : (domProfile?.studentName || api.userProfile.studentName)
        }
      : domProfile;
    saveStudentProfileIfFound(combinedProfile);

    const tabAnnouncements = mergeStreamAndCourseAnnouncements(domAnnouncements, api.courseAnnouncements, scrapeOpenDrawerAnnouncement());

    await autoRegisterDiscoveredCourses(await discoveredCoursesWithColors(getBlackboardJson)).catch(() => {});

    if (run.signal?.aborted) return;
    const result = await runScanPipeline({
      streamAnnouncements: api.stream.announcements,
      courseAnnouncements: tabAnnouncements,
      directTasks: [...domDirectTasks, ...api.stream.directTasks],
      submissionUpdates: [...domSubmissionUpdates, ...api.stream.submissionUpdates, ...api.gradebookUpdates],
      discoveredCourses: scrapeEnrolledCourses(),
      gradebook: {
        expired: lastGradebookRead.expired,
        courses: lastGradebookRead.courses,
        coursesRead: lastGradebookRead.coursesRead,
        skipped: lastGradebookRead.skipped
      },
      sources: lastGradebookRead.signedIn ? sources : undefined,
      checkpoint,
      fullRescan,
      isInteractive: () => run.interactive,
      signal: run.signal
    });
    if (run.signal?.aborted) return;
    lastTabScanResult = { ok: true, newCount: result.newCount, message: result.message };

    try {
      const currentSettings = await getSettings();
      if (currentSettings.autoSyncOnScan !== false && isExtensionContextValid()) {
        chrome.runtime.sendMessage({ type: 'SYNC_TO_SERVER' }).catch(() => {});
      }
    } catch {}

    const totalNewCount = result.newCount;

    const badge = document.getElementById('bbs-floating-badge');
    if (badge && result.pendingCount > 0) {
      badge.textContent = String(result.pendingCount);
      badge.style.display = 'inline-block';
    }

    if (run.interactive || totalNewCount > 0) {
      const msg = totalNewCount > 0
        ? `Found <strong>${totalNewCount}</strong> new deadline${totalNewCount > 1 ? 's' : ''} (Quizzes & Assignments) from Blackboard!`
        : `All deadlines up to date. (${result.pendingCount} pending tasks in dashboard)`;
      showSidekickToast('Scan Complete', msg, totalNewCount, false, () => scanGate.abort());
      lastTabScanToastAt = Date.now();
    }
    if (run.interactive) {
      run.reported = true;
      await setScanStatus({ state: 'done', message: result.message, newCount: totalNewCount });
    }
  } catch (error: any) {
    if (error?.message?.includes('Extension context invalidated')) {
      teardownOrphanedContentScript();
      console.info('[Blackboarder] Extension was reloaded; refresh this tab to reconnect.');
      if (run.interactive) showExtensionReloadToast();
      lastTabScanResult = { ok: false, newCount: 0, message: 'Blackboarder was reloaded. Refresh the Blackboard tab and try again.' };
      return;
    }
    console.error('Error during Blackboard scan:', error);
    lastTabScanResult = { ok: false, newCount: 0, message: 'Scan hit a problem. Refresh the Blackboard tab and try again.' };
    if (run.interactive) {
      showSidekickToast('Scan Notice', 'Blackboard scan encountered an issue. If page layout changed, try refreshing the tab.', 0);
      run.reported = true;
      await setScanStatus({ state: 'error', message: 'Scan hit a problem. Refresh the Blackboard tab and try again.' });
    }
  }
}

function isBlackboardSite(): boolean {
  if (isExamSchedulePage(window.location, document)) return true;
  if (isFinancePortalPage(window.location, document)) return true;
  const host = window.location.hostname.toLowerCase();
  if ((!host.includes('blackboarder') && host.includes('blackboard')) || host.startsWith('learn.') || host.startsWith('ilearn.') || host.startsWith('elearning.') || host.startsWith('bb.')) {
    return true;
  }
  if (/^\/(?:ultra|webapps)(?:\/|$)/i.test(window.location.pathname)) return true;
  if (host.endsWith('sharjah.ac.ae')) {
    return host.includes('bb') || host.includes('learn') || host.includes('elearning') || Boolean(document.querySelector('#courseMenuPalette, .bb-course-title, #announcementList, bb-announcement-card, .stream-item-container, #activity-stream, [data-course-id]'));
  }
  return false;
}

function init() {
  if ((window as any).__BBS_SCRAPER_INITIALIZED__) return;
  (window as any).__BBS_SCRAPER_INITIALIZED__ = true;
  if (!isBlackboardSite()) return;
  const onExamPage = isExamSchedulePage(window.location, document);
  const onFinancePage = isFinancePortalPage(window.location, document);

  getUserCourses().catch(() => {});
  detectUniversityFromHost(window.location.hostname).catch(() => null);

  try {
    if (isExtensionContextValid() && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes['bbs_user_courses']) {
          const newCourses = changes['bbs_user_courses'].newValue;
          setActiveUserCourses(Array.isArray(newCourses) ? newCourses : []);
        }
      });
    }
  } catch {}

  injectFloatingButton(() => {
    if (!isExtensionContextValid()) return;
    if (isExamSchedulePage(window.location, document)) {
      showSidekickToast('Exam Schedule', 'Scanning exam schedule on this page...', 0, true, () => scanGate.abort());
      runExamScheduleScan({ interactive: true, fullRescan: false, reported: false }).catch(() => {});
      return;
    }
    if (isFinancePortalPage(window.location, document)) {
      showSidekickToast('Payments', 'Scanning financial deadlines on this page...', 0, true, () => scanGate.abort());
      runFinancePageScan({ interactive: true, fullRescan: false, reported: false }).catch(() => {});
      return;
    }
    const scanStartedAt = Date.now();
    showSidekickToast('Scanning Blackboard...', 'Checking announcements and enrolled courses...', 0, true, () => scanGate.abort());

    chrome.runtime.sendMessage({ type: 'RUN_HTTP_SCAN', interactive: true }, async res => {
      void chrome.runtime.lastError;
      const tasks = await getTasks().catch(() => []);
      const pendingCount = tasks.filter(t => t.status === 'pending').length;
      const badge = document.getElementById('bbs-floating-badge');
      if (badge) {
        if (pendingCount > 0) {
          badge.textContent = String(pendingCount);
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }
      if (lastTabScanToastAt >= scanStartedAt || res?.message === 'Scan cancelled.') return;

      const msg = res?.ok
        ? (res.newCount ? `Added <strong>${res.newCount}</strong> new deadlines to calendar!` : (res.message || 'All deadlines up to date.'))
        : (res?.message || 'Could not reach Blackboard.');
      showSidekickToast(res?.ok ? 'Scan Complete' : 'Scan Notice', msg, res?.newCount || 0);
    });
  });

  if (!onExamPage && !onFinancePage) {
    startCourseColorPainter(getBlackboardJson);
    startActivityFilter(getBlackboardJson);
    startStudentProfileBadge();

    const initialDomStudent = extractStudentFromBlackboardPage(document);
    if (initialDomStudent) saveStudentProfileIfFound(initialDomStudent);
    setTimeout(() => {
      const laterDomStudent = extractStudentFromBlackboardPage(document);
      if (laterDomStudent) saveStudentProfileIfFound(laterDomStudent);
    }, 2500);
  }

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'b' || e.key === 'B')) {
      if (isExtensionContextValid()) {
        try {
          chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {});
        } catch {}
      }
    }
  });

  try {
    if (isExtensionContextValid()) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'SCRAPE_PAGE') {
          (async () => {
            try {
              await getUserCourses().catch(() => {});
              if (isExamSchedulePage(window.location, document)) {
                const directTasks = await waitForExamScheduleTasks(3500);
                await autoRegisterDiscoveredCourses(directTasks).catch(() => {});
                sendResponse({
                  announcements: [],
                  directTasks,
                  submissionUpdates: [],
                  discoveredCourses: [],
                  isIncremental: false,
                  lastScannedAt: new Date().toISOString()
                });
                return;
              }
              const fullRescan = Boolean(message.fullRescan);
              const checkpoint = fullRescan
                ? { lastScannedAt: '', processedAnnouncementIds: [], processedDirectTaskIds: [] }
                : await getLastScanCheckpoint();

              const directTasks = scrapeUltraStreamDueItems(fullRescan ? undefined : new Set(checkpoint.processedDirectTaskIds));
              const announcements = await scrapeAnnouncementsFull({ fullRescan });
              const submissionUpdates = scrapeStreamSubmissionsAndGrades();
              const discoveredCourses = scrapeEnrolledCourses();

              await autoRegisterDiscoveredCourses([...directTasks, ...announcements, ...discoveredCourses]).catch(() => {});

              sendResponse({
                announcements,
                directTasks,
                submissionUpdates,
                discoveredCourses,
                isIncremental: !fullRescan,
                lastScannedAt: checkpoint.lastScannedAt
              });
            } catch (err) {
              console.error('[Scraper] SCRAPE_PAGE failed:', err);
              sendResponse({ announcements: [], directTasks: [], submissionUpdates: [], discoveredCourses: [] });
            }
          })();
          return true;
        } else if (message.type === 'READ_EXAM_SCHEDULE') {
          if (!isExamSchedulePage(window.location, document)) {
            sendResponse({ found: 0 });
            return false;
          }
          getUserCourses().catch(() => {})
            .then(() => runExamScheduleScan({ interactive: false, fullRescan: false, reported: false }, 15000))
            .then(res => sendResponse(res))
            .catch(() => sendResponse({ found: 0 }));
          return true;
        } else if (message.type === 'PING_SCANNER') {
          sendResponse({ ok: true, scanning: scanGate.running, loginPage: isSignInPage() });
          return false;
        } else if (message.type === 'ABORT_TAB_SCAN') {
          scanGate.abort();
          document.getElementById('bbs-toast')?.classList.remove('bbs-toast-visible');
          lastTabScanResult = { ok: false, newCount: 0, message: 'Scan cancelled.' };
          sendResponse({ ok: true });
          return false;
        } else if (message.type === 'RUN_TAB_SCAN') {
          const startedAt = Date.now();
          const interactive = Boolean(message.interactive);
          lastTabScanResult = null;
          runScan(interactive, Boolean(message.fullRescan))
            .then(async () => {
              const status = interactive ? await getScanStatus() : null;
              if (status && status.state !== 'running' && new Date(status.updatedAt).getTime() >= startedAt) {
                sendResponse({ ok: status.state === 'done', newCount: status.newCount || 0, message: status.message });
              } else {
                sendResponse(lastTabScanResult || { ok: true, newCount: 0, message: 'Scan finished.' });
              }
            })
            .catch(err => sendResponse({ ok: false, newCount: 0, message: String(err) }));
          return true;
        } else if (message.type === 'TRIGGER_SCAN') {
          chrome.runtime.sendMessage({ type: 'RUN_HTTP_SCAN', fullRescan: Boolean(message.fullRescan) }, res => {
            sendResponse({ success: Boolean(res?.ok) });
          });
          return true;
        }
        return false;
      });
    }
  } catch {}

  if (!onExamPage) scheduleAutoScan();
}

function isSignInPage(): boolean {
  return Boolean(document.querySelector('input[type="password"]')) || /(?:^|\/)login(?:\/|$)/i.test(window.location.pathname);
}

function scheduleAutoScan(): void {
  if (isFinancePortalPage(window.location, document)) return;
  getSettings()
    .then(settings => {
      if (!settings.autoScanOnPageLoad || !isExtensionContextValid() || isSignInPage()) return;
      setTimeout(async () => {
        if (!isExtensionContextValid()) return;
        if (!(await claimAutoScan(chrome.storage.local as any))) return;
        try {
          chrome.runtime.sendMessage({ type: 'RUN_HTTP_SCAN', auto: true }, () => {
            void chrome.runtime.lastError;
          });
        } catch {}
      }, 2500);
    })
    .catch(() => {});
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
