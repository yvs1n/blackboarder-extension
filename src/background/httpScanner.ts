import { getSettings, getLastScanCheckpoint, getUserCourses, autoRegisterDiscoveredCourses, setScanStatus } from '../utils/storage';
import { GRADEBOOK_REPORT_KEY } from '../utils/gradebook';
import { discoveredCoursesWithColors } from '../content/courseColorPainter';
import { SESSION_STATUS_KEY } from '../utils/sessionStatus';
import { getProfile } from '../utils/profile';
import { profileUniversity } from '../core/studentProfile';
import { getExtraSites } from '../utils/blackboardSites';
import { refreshExamSchedule, examRefreshNote } from './examRefresh';
import { BbFetch, ScanSourceOutcomes, readBlackboardApi } from '../scan/blackboardApi';
import { runScanPipeline, emptyCheckpoint } from '../scan/scanPipeline';
import { decideFallback, FallbackReason, SIGN_IN_MESSAGE, UNREACHABLE_MESSAGE } from '../scan/scanFallback';
import { needsXsrf, readBlackboardXsrf, XSRF_HEADER } from '../utils/blackboardXsrf';

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

/**
 * fetch() for a Blackboard path from the service worker: the university origin, with the
 * student's cookies, and the XSRF token on POSTs (read once per scan).
 */
export function serviceWorkerFetch(origin: string, readXsrf: (origin: string) => Promise<string | null> = readBlackboardXsrf): BbFetch {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest'
  };
  let xsrf: Promise<string | null> | null = null;
  return async (path: string, init?: RequestInit) => {
    const extra: Record<string, string> = {};
    if (needsXsrf(init)) {
      xsrf ??= readXsrf(origin);
      const token = await xsrf;
      if (token) extra[XSRF_HEADER] = token;
    }
    return fetch(new URL(path, origin).href, {
      ...init,
      credentials: 'include',
      headers: { ...headers, ...extra, ...(init?.headers as Record<string, string> || {}) }
    });
  };
}

export interface ScanResult {
  ok: boolean;
  newCount?: number;
  message?: string;
  /** What each part of the HTTP read did. */
  sources?: ScanSourceOutcomes;
  /** Set when the HTTP read was not enough and the tab scanner should run (nothing was saved). */
  needsFallback?: boolean;
  fallbackReason?: FallbackReason | null;
  /** Which scanner produced the result. */
  via?: 'http' | 'tab';
}

/** The visible-or-quiet state of a scan; `interactive` can turn true while it runs (see ScanGate). */
export interface ScanRunState {
  interactive: boolean;
  reported: boolean;
}

export interface HttpScanOptions {
  fullRescan?: boolean;
  /** Read the exam schedule afterwards. Never for automatic scans. */
  refreshExam?: boolean;
  run?: ScanRunState;
  onSync?: () => Promise<any>;
}

let httpScanRunning = false;

/**
 * Runs a Blackboard scan directly over HTTP from the service worker using the student's
 * browser cookies, with zero browser tabs. When Blackboard cannot be reached or neither the
 * course list nor the stream answers, nothing is saved and the result asks for the tab scanner.
 */
export async function runHttpBlackboardScan(options: HttpScanOptions = {}): Promise<ScanResult> {
  const fullRescan = Boolean(options.fullRescan);
  const run: ScanRunState = options.run || { interactive: true, reported: false };
  if (httpScanRunning) {
    return { ok: true, message: 'Scan already in progress.', via: 'http' };
  }
  httpScanRunning = true;

  const status = async (s: Parameters<typeof setScanStatus>[0]) => {
    if (!run.interactive) return;
    if (s.state !== 'running') run.reported = true;
    await setScanStatus(s);
  };

  try {
    await status({
      state: 'running',
      message: fullRescan ? 'Full re-scan: reading Blackboard...' : 'Reading Blackboard...'
    });

    await getUserCourses().catch(() => {});
    const origin = await resolveBlackboardOrigin();
    const httpFetch = serviceWorkerFetch(origin);
    const getJson = async (path: string) => {
      const res = await httpFetch(path);
      if (!res.ok) throw new Error(`Blackboard ${res.status}`);
      return res.json();
    };

    const api = await readBlackboardApi(httpFetch, { origin });
    const { sources } = api;

    // Tell the popup whether the session is alive, so it can show a banner when it is not
    if (sources.session !== 'unreachable') {
      await chrome.storage.local.set({
        [SESSION_STATUS_KEY]: { expired: sources.session === 'expired', checkedAt: new Date().toISOString() }
      }).catch(() => {});
    }

    const decision = decideFallback(sources);
    if (decision.reason === 'expired') {
      await status({ state: 'error', message: SIGN_IN_MESSAGE });
      return { ok: false, message: SIGN_IN_MESSAGE, sources, fallbackReason: 'expired', via: 'http' };
    }
    if (decision.fallback) {
      console.info(`[HTTP Scanner] Blackboard did not answer over HTTP (${decision.reason}); the tab scanner takes over.`);
      return { ok: false, message: UNREACHABLE_MESSAGE, sources, needsFallback: true, fallbackReason: decision.reason, via: 'http' };
    }

    // New courses take the colour Blackboard gives them (courses already set up keep theirs)
    await autoRegisterDiscoveredCourses(await discoveredCoursesWithColors(getJson)).catch(() => {});

    // What each gradebook held on the last scan, kept on this device only, to explain a missing mark
    try {
      await chrome.storage.local.set({ [GRADEBOOK_REPORT_KEY]: { readAt: new Date().toISOString(), rows: api.gradebookReport } });
    } catch {}

    const result = await runScanPipeline({
      streamAnnouncements: api.stream.announcements,
      courseAnnouncements: api.courseAnnouncements,
      directTasks: api.stream.directTasks,
      submissionUpdates: [...api.stream.submissionUpdates, ...api.gradebookUpdates],
      gradebook: { courses: api.courseIds.length, coursesRead: sources.gradebook.ok, skipped: api.skippedGrades },
      sources,
      checkpoint: fullRescan ? emptyCheckpoint() : await getLastScanCheckpoint(),
      fullRescan,
      isInteractive: () => run.interactive
    });

    let finalMessage = result.message;
    let finalNewCount = result.newCount;
    if (options.refreshExam) {
      await status({ state: 'running', message: `${result.message} Reading your exam schedule...` });
      const examRes = await refreshExamSchedule(fullRescan).catch(() => null);
      finalNewCount += examRes?.state === 'read' ? examRes.added || 0 : 0;
      finalMessage += examRefreshNote(examRes);
    }

    await status({ state: 'done', message: finalMessage, newCount: finalNewCount });

    const settings = await getSettings();
    if (settings.autoSyncOnScan !== false && options.onSync) {
      await options.onSync().catch(() => {});
    }

    return { ok: true, newCount: finalNewCount, message: finalMessage, sources, via: 'http' };
  } catch (err) {
    console.error('[HTTP Scanner] Error during HTTP scan:', err);
    await status({ state: 'error', message: UNREACHABLE_MESSAGE });
    return { ok: false, message: UNREACHABLE_MESSAGE, via: 'http' };
  } finally {
    httpScanRunning = false;
  }
}
