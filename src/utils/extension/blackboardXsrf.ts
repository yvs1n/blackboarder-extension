/**
 * Blackboard Learn refuses POST requests (the activity stream is one) with 403 unless they carry
 * the session's XSRF token in `X-Blackboard-XSRF`, as Ultra's own pages send it. The token is the
 * `xsrf:` part of the `BbRouter` session cookie, which is HttpOnly: only the service worker can
 * read it, through chrome.cookies. GET requests never need it.
 */

export const XSRF_HEADER = 'X-Blackboard-XSRF';
export const GET_BLACKBOARD_XSRF = 'GET_BLACKBOARD_XSRF';

/** The token inside a BbRouter cookie value ("expires:...,id:...,v:2,xsrf:<token>"), or null. */
export function xsrfFromBbRouter(value: string | null | undefined): string | null {
  if (!value) return null;
  let text = value;
  try {
    text = decodeURIComponent(value);
  } catch {}
  const match = /(?:^|,)\s*xsrf:([^,\s]+)/.exec(text);
  return match ? match[1] : null;
}

/** True for a request that changes or posts something, which Blackboard checks for the token. */
export function needsXsrf(init?: RequestInit): boolean {
  const method = String(init?.method || 'GET').toUpperCase();
  return method !== 'GET' && method !== 'HEAD';
}

/** Reads the session's XSRF token for a Blackboard origin (service worker only). */
export async function readBlackboardXsrf(origin: string): Promise<string | null> {
  try {
    if (typeof chrome === 'undefined' || !chrome.cookies?.get) return null;
    const cookie = await chrome.cookies.get({ url: origin, name: 'BbRouter' });
    return xsrfFromBbRouter(cookie?.value);
  } catch {
    return null;
  }
}
