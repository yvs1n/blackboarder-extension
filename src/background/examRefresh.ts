import { getProfile } from '../utils/profile';
import { profileUniversity } from '../core/studentProfile';
import { ExamRefreshResult, isExamPageUrl } from '../utils/examRefreshNote';

export { examRefreshNote, isExamPageUrl } from '../utils/examRefreshNote';
export type { ExamRefreshResult, ExamRefreshState } from '../utils/examRefreshNote';

/**
 * Reads the university's exam schedule page during a Scan the student started on Blackboard:
 * opens it in a background tab, asks the content script there to read the table
 * (`READ_EXAM_SCHEDULE`, saved like a scan of that page), then closes the tab.
 * At most once an hour unless it is a full re-scan; never for automatic scans.
 */

export const EXAM_READ_KEY = 'bbs_exam_schedule_read';
export const EXAM_REFRESH_GAP_MS = 60 * 60 * 1000;
const WAIT_MS = 45 * 1000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function readFromTab(tabId: number, page: string): Promise<ExamRefreshResult> {
  const deadline = Date.now() + WAIT_MS;
  let lastUrl = '';
  while (Date.now() < deadline) {
    await sleep(1000);
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return { state: 'error' }; // the student closed it
    }
    lastUrl = tab.url || tab.pendingUrl || '';
    if (tab.status !== 'complete' || !isExamPageUrl(lastUrl, page)) continue;
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'READ_EXAM_SCHEDULE' });
      if (res && typeof res.found === 'number') {
        return res.found > 0
          ? { state: 'read', found: res.found, added: res.added || 0, updated: res.updated || 0 }
          : { state: 'empty', found: 0 };
      }
    } catch {
      // The content script is not listening yet; try again
    }
  }
  // Still on a sign-in page (or redirected away) after the wait
  return { state: isExamPageUrl(lastUrl, page) ? 'empty' : 'signed-out' };
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

  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url: page, active: false });
    tabId = tab.id;
    if (tabId === undefined) return { state: 'error' };
    const result = await readFromTab(tabId, page);
    if (result.state === 'read' || result.state === 'empty') {
      const saved = { ...result, readAt: new Date().toISOString() };
      await chrome.storage.local.set({ [EXAM_READ_KEY]: saved }).catch(() => {});
      return saved;
    }
    return result;
  } catch {
    return { state: 'error' };
  } finally {
    if (tabId !== undefined) chrome.tabs.remove(tabId).catch(() => {});
  }
}
