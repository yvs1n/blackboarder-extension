/** What a background read of the exam schedule page returns, shared by the service worker and the scan message. */

export type ExamRefreshState = 'read' | 'empty' | 'recent' | 'none' | 'signed-out' | 'error';

export interface ExamRefreshResult {
  state: ExamRefreshState;
  found?: number;
  added?: number;
  updated?: number;
  readAt?: string;
}

/** Same page, ignoring case, query and a trailing slash (Banner may add a query string). */
export function isExamPageUrl(url: string | undefined, page: string): boolean {
  try {
    const a = new URL(url || '');
    const b = new URL(page);
    const path = (p: string) => p.replace(/\/+$/, '').toLowerCase();
    return a.origin.toLowerCase() === b.origin.toLowerCase() && path(a.pathname) === path(b.pathname);
  } catch {
    return false;
  }
}

/** The line added to the scan message; empty when there is nothing worth saying. */
export function examRefreshNote(res: ExamRefreshResult | null | undefined): string {
  if (!res) return '';
  if (res.state === 'read') {
    const parts = [`${res.found} on your exam schedule`];
    if (res.added) parts.push(`${res.added} new`);
    if (res.updated) parts.push(`${res.updated} updated`);
    return ` Exams: ${parts.join(', ')}.`;
  }
  if (res.state === 'empty') return ' Exams: none listed on your exam schedule yet.';
  if (res.state === 'signed-out') return ' Exams: sign in to Banner, then scan again to read your exam schedule.';
  return '';
}
