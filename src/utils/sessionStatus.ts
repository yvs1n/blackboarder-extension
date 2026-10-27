/**
 * Whether the student's Blackboard session is still signed in, as seen by the last scan. The scan
 * saves it here and the popup shows a banner while it says the session ended.
 */
export const SESSION_STATUS_KEY = 'bbs_session_status';

export interface SessionStatus {
  expired: boolean;
  checkedAt: string;
}

/**
 * Blackboard answers a signed-out API call with 401 or 403, or sends the sign-in page (HTML) where JSON
 * was expected.
 */
export function isSessionExpiredResponse(status: number, contentType: string | null): boolean {
  if (status === 401 || status === 403) return true;
  if (status >= 200 && status < 300) return !(contentType || '').toLowerCase().includes('json');
  return false;
}

export interface SessionBanner {
  title: string;
  text: string;
}

/** What the banner says, or null when there is nothing to show. */
export function describeSessionBanner(status: SessionStatus | null | undefined): SessionBanner | null {
  if (!status || status.expired !== true) return null;
  return {
    title: 'Blackboard session ended',
    text: 'Blackboarder cannot read your announcements or marks until you sign in to Blackboard again. Sign in, then scan.'
  };
}
