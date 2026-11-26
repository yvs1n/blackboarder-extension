import { FIREBASE_DB_URL } from './firebaseSync';
import { sanitizeScanRequest } from './cloudSanitize';
import type { CloudScanRequest } from './cloudSanitize';

/**
 * The phone asks the extension to scan by writing `scanRequest` into the synced data. The
 * service worker looks for it every minute; reading only that one small field (not the whole
 * document with every task) keeps the minute check cheap. The full pull stays on the 30-minute alarm.
 */

/** A pending request older than this is not run any more (the phone stopped waiting long ago). */
export const SCAN_REQUEST_STALE_MS = 15 * 60 * 1000;
export const SCAN_REQUEST_EXPIRED_MESSAGE = 'Scan request expired.';

const SYNC_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function scanRequestUrl(syncKey: string): string | null {
  const key = (syncKey || '').trim();
  return SYNC_KEY_RE.test(key) ? `${FIREBASE_DB_URL}/users/${key}/data/scanRequest.json` : null;
}

/** The scan request stored for this sync key, or null (none, unreadable, or not a valid key). */
export async function fetchCloudScanRequest(
  syncKey: string | undefined,
  fetchFn: typeof fetch = fetch
): Promise<CloudScanRequest | null> {
  const url = scanRequestUrl(syncKey || '');
  if (!url) return null;
  try {
    const res = await fetchFn(url, { cache: 'no-store' });
    if (!res || !res.ok) return null;
    return sanitizeScanRequest(await res.json()) || null;
  } catch {
    // Offline or Firebase unreachable: the next minute tries again
    return null;
  }
}

/** A pending request made more than 15 minutes ago (or with an unreadable time). */
export function isScanRequestStale(req: CloudScanRequest, now: number = Date.now()): boolean {
  if (req.state !== 'pending') return false;
  const at = Date.parse(req.requestedAt);
  if (isNaN(at)) return true;
  return now - at > SCAN_REQUEST_STALE_MS;
}
