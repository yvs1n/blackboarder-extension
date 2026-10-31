import { mergeTombstones } from './taskMerge';

export const TOMBSTONES_STORAGE_KEY = 'bbs_tombstones';

let tombstoneChain: Promise<any> = Promise.resolve();

/**
 * Returns a promise that resolves when all pending tombstone writes have settled.
 */
export function awaitTombstonesPersisted(): Promise<void> {
  return tombstoneChain.then(() => {}).catch(() => {});
}

/**
 * Reads local deletion tombstones synchronously from localStorage.
 */
export function getLocalTombstones(): Record<string, string> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(TOMBSTONES_STORAGE_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Reads deletion tombstones asynchronously from chrome.storage.local or localStorage.
 */
export async function getStorageTombstones(): Promise<Record<string, string>> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      return await new Promise<Record<string, string>>(resolve => {
        chrome.storage.local.get([TOMBSTONES_STORAGE_KEY], res => {
          const stored = res?.[TOMBSTONES_STORAGE_KEY] as Record<string, string> | undefined;
          resolve(stored || getLocalTombstones());
        });
      });
    } catch {
      // Fall through to localStorage
    }
  }
  return getLocalTombstones();
}

/**
 * Persists deletion tombstones to both localStorage and chrome.storage.local.
 */
export async function setStorageTombstones(tombstones: Record<string, string>): Promise<void> {
  const safe = tombstones && typeof tombstones === 'object' ? tombstones : {};
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TOMBSTONES_STORAGE_KEY, JSON.stringify(safe));
    }
  } catch {}

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await new Promise<void>(resolve => {
        chrome.storage.local.set({ [TOMBSTONES_STORAGE_KEY]: safe }, () => resolve());
      });
    } catch {}
  }
}

/**
 * Records a deletion tombstone for a given task ID. Serialized via tombstoneChain.
 */
export function recordLocalTombstone(id: string, date: string = new Date().toISOString()): Promise<Record<string, string>> {
  if (!id) return getStorageTombstones();
  tombstoneChain = tombstoneChain.then(async () => {
    const current = await getStorageTombstones();
    current[id] = date;
    await setStorageTombstones(current);
    return current;
  }).catch(() => getStorageTombstones());
  return tombstoneChain;
}

/**
 * Removes a deletion tombstone if present (e.g. when restoring or un-deleting a task).
 */
export function removeLocalTombstone(id: string): Promise<Record<string, string>> {
  if (!id) return getStorageTombstones();
  tombstoneChain = tombstoneChain.then(async () => {
    const current = await getStorageTombstones();
    if (current[id]) {
      delete current[id];
      await setStorageTombstones(current);
    }
    return current;
  }).catch(() => getStorageTombstones());
  return tombstoneChain;
}

export { mergeTombstones };
