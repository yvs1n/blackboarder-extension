/**
 * Automatic scans when a Blackboard page loads (Settings > Scanning > autoScanOnPageLoad): at
 * most one every 30 minutes, across all tabs. Any scan that starts also sets the stamp, so a page
 * opened right after a Scan (including the background tab the fallback opens) does not scan again.
 */

export const AUTO_SCAN_KEY = 'bbs_last_auto_scan_at';
export const AUTO_SCAN_GAP_MS = 30 * 60 * 1000;

export interface StampStorage {
  get(keys: string[]): Promise<Record<string, any>>;
  set(items: Record<string, any>): Promise<void>;
}

export function isAutoScanDue(lastAt: unknown, now: number = Date.now()): boolean {
  const last = typeof lastAt === 'number' ? lastAt : Number.NaN;
  if (!Number.isFinite(last) || last > now) return true;
  return now - last >= AUTO_SCAN_GAP_MS;
}

/** True (and the stamp is set) when an automatic scan may run now. */
export async function claimAutoScan(storage: StampStorage, now: number = Date.now()): Promise<boolean> {
  try {
    const res = await storage.get([AUTO_SCAN_KEY]);
    if (!isAutoScanDue(res?.[AUTO_SCAN_KEY], now)) return false;
    await storage.set({ [AUTO_SCAN_KEY]: now });
    return true;
  } catch {
    return false;
  }
}

/** Records that a scan started, so automatic scans wait their 30 minutes from it. */
export async function stampScanStarted(storage: StampStorage, now: number = Date.now()): Promise<void> {
  try {
    await storage.set({ [AUTO_SCAN_KEY]: now });
  } catch {}
}
