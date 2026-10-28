import { getProfile } from '../utils/profile';
import { profileUniversity } from '../core/studentProfile';
import { ExamRefreshResult, isExamPageUrl } from '../utils/examRefreshNote';
import {
  scrapeExamScheduleFromHtml,
  extractExamScheduleRowsFromJson,
  rowsToExamTasks,
  mergeExamScheduleTasks
} from '../core/examSchedule';
import { getTasks, getUserCourses, autoRegisterDiscoveredCourses, saveTasksMergingLatest } from '../utils/storage';
import { deduplicateTaskList } from '../utils/taskMerge';
import { isValidTask } from '../core/courseHelper';
import { repairTaskWeightsAndRooms } from '../utils/taskRepair';
import type { DeadlineTask } from '../types';

export { examRefreshNote, isExamPageUrl } from '../utils/examRefreshNote';
export type { ExamRefreshResult, ExamRefreshState } from '../utils/examRefreshNote';

/**
 * Reads the university's exam schedule page during a Scan via direct HTTP requests
 * using the browser's session cookies (no background tab is ever opened).
 * At most once an hour unless it is a full re-scan; never for automatic scans.
 */

export const EXAM_READ_KEY = 'bbs_exam_schedule_read';
export const EXAM_REFRESH_GAP_MS = 60 * 60 * 1000;

function isSignInHtml(html: string): boolean {
  if (!html) return false;
  if (/<input\b[^>]*type=["']?password["']?/i.test(html)) return true;
  if (/<title\b[^>]*>[^<]*(?:sign\s*in|log\s*in|central\s*authentication|sso\s*login)[^<]*<\/title>/i.test(html)) return true;
  return false;
}

async function fetchBannerVirtualDomainTasks(pageUrl: string, html: string): Promise<DeadlineTask[]> {
  try {
    const parsedUrl = new URL(pageUrl);
    const origin = parsedUrl.origin;
    const domains = new Set<string>();

    const matches = html.match(/virtualDomains\.([A-Za-z0-9_]+)/g) || [];
    for (const m of matches) {
      const name = m.split('.')[1];
      if (name) domains.add(name);
    }

    if (domains.size === 0) {
      const pageMatch = parsedUrl.pathname.match(/\/customPage\/page\/([A-Za-z0-9_-]+)/i);
      if (pageMatch) {
        const pbRes = await fetch(`${origin}/BannerExtensibility/internalPb/page/${encodeURIComponent(pageMatch[1])}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        }).catch(() => null);
        if (pbRes && pbRes.ok) {
          const pbText = await pbRes.text().catch(() => '');
          const pbMatches = pbText.match(/virtualDomains\.([A-Za-z0-9_]+)/g) || [];
          for (const m of pbMatches) {
            const name = m.split('.')[1];
            if (name) domains.add(name);
          }
        }
      }
    }

    const tasks: DeadlineTask[] = [];
    for (const domain of domains) {
      const vdRes = await fetch(`${origin}/BannerExtensibility/internalPb/virtualDomains.${encodeURIComponent(domain)}?max=200`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      }).catch(() => null);
      if (!vdRes || !vdRes.ok) continue;
      const payload = await vdRes.json().catch(() => null);
      const rows = extractExamScheduleRowsFromJson(payload);
      if (rows.length > 0) {
        tasks.push(...rowsToExamTasks(rows));
      }
    }
    return tasks;
  } catch {
    return [];
  }
}

async function readViaHttp(page: string): Promise<ExamRefreshResult> {
  const res = await fetch(page, {
    credentials: 'include',
    headers: { Accept: 'text/html,application/xhtml+xml,application/json' }
  });

  if (res.status === 401 || res.status === 403) {
    return { state: 'signed-out' };
  }
  if (res.url && !isExamPageUrl(res.url, page)) {
    return { state: 'signed-out' };
  }
  if (!res.ok) {
    return { state: 'error' };
  }

  const bodyText = await res.text();
  await getUserCourses().catch(() => {});

  let examTasks = scrapeExamScheduleFromHtml(bodyText);
  if (examTasks.length === 0) {
    if (isSignInHtml(bodyText)) {
      return { state: 'signed-out' };
    }
    examTasks = await fetchBannerVirtualDomainTasks(page, bodyText);
  }

  const stored = await chrome.storage.local.get(['bbs_tombstones']).catch(() => ({} as Record<string, any>));
  const tombstones = (stored?.bbs_tombstones as Record<string, string>) || {};
  const activeExamTasks = examTasks.filter(t => !tombstones[t.id]);

  if (activeExamTasks.length === 0) {
    return { state: 'empty', found: 0 };
  }

  const existingTasks = await getTasks();
  const { tasks: mergedTasks, addedCount, updatedCount } = mergeExamScheduleTasks(existingTasks, activeExamTasks, tombstones);
  const finalTasks = deduplicateTaskList(mergedTasks).filter(isValidTask);

  await autoRegisterDiscoveredCourses(activeExamTasks).catch(() => {});
  repairTaskWeightsAndRooms(finalTasks);
  await saveTasksMergingLatest(finalTasks);

  return {
    state: 'read',
    found: activeExamTasks.length,
    added: addedCount,
    updated: updatedCount
  };
}

export async function refreshExamSchedule(force = false): Promise<ExamRefreshResult> {
  const page = profileUniversity(await getProfile().catch(() => null)).examSchedulePage;
  if (!page) return { state: 'none' };

  try {
    const stored = await chrome.storage.local.get([EXAM_READ_KEY]);
    const last = stored?.[EXAM_READ_KEY] as ExamRefreshResult | undefined;
    if (!force && last?.readAt && last.state === 'read' && Date.now() - Date.parse(last.readAt) < EXAM_REFRESH_GAP_MS) {
      return { ...last, state: 'recent' };
    }
  } catch {}

  try {
    const result = await readViaHttp(page);
    if (result.state === 'read' || result.state === 'empty') {
      const saved = { ...result, readAt: new Date().toISOString() };
      await chrome.storage.local.set({ [EXAM_READ_KEY]: saved }).catch(() => {});
      return saved;
    }
    return result;
  } catch {
    return { state: 'error' };
  }
}
