import type { ArchivedSemester } from '../types';
import { sanitizeSemesters, mergeArchivedSemesters } from '../core/semesters';

export const SEMESTERS_STORAGE_KEY = 'bbs_semesters';
export const SEMESTERS_UPDATED_AT_KEY = 'bbs_semesters_updated_at';

function hasChromeStorage(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.local;
  } catch {
    return false;
  }
}

function readLocalStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, val: unknown): void {
  try {
    localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
  } catch {}
}

/** Reads stored archived semesters from extension storage or localStorage. */
export async function getStoredSemesters(): Promise<ArchivedSemester[]> {
  if (hasChromeStorage()) {
    try {
      const res = await chrome.storage.local.get([SEMESTERS_STORAGE_KEY]);
      const clean = sanitizeSemesters(res?.[SEMESTERS_STORAGE_KEY]);
      if (clean.length > 0) return clean;
    } catch {}
  }
  const fromLocal = readLocalStorage<ArchivedSemester[]>(SEMESTERS_STORAGE_KEY);
  return sanitizeSemesters(fromLocal);
}

/** Reads the last update timestamp for archived semesters. */
export async function getStoredSemestersUpdatedAt(): Promise<string | null> {
  if (hasChromeStorage()) {
    try {
      const res = await chrome.storage.local.get([SEMESTERS_UPDATED_AT_KEY]);
      if (typeof res?.[SEMESTERS_UPDATED_AT_KEY] === 'string') {
        return res[SEMESTERS_UPDATED_AT_KEY];
      }
    } catch {}
  }
  try {
    return localStorage.getItem(SEMESTERS_UPDATED_AT_KEY);
  } catch {
    return null;
  }
}

/** Saves archived semesters, updating both chrome.storage and localStorage. */
export async function saveStoredSemesters(
  semesters: ArchivedSemester[],
  updatedAt?: string
): Promise<{ semesters: ArchivedSemester[]; updatedAt: string }> {
  const clean = sanitizeSemesters(semesters);
  const stamp = updatedAt || new Date().toISOString();

  if (hasChromeStorage()) {
    try {
      await chrome.storage.local.set({
        [SEMESTERS_STORAGE_KEY]: clean,
        [SEMESTERS_UPDATED_AT_KEY]: stamp
      });
    } catch {}
  }

  writeLocalStorage(SEMESTERS_STORAGE_KEY, clean);
  writeLocalStorage(SEMESTERS_UPDATED_AT_KEY, stamp);

  return { semesters: clean, updatedAt: stamp };
}

/**
 * Merges cloud semesters into local storage when cloud has newer changes or additional semesters.
 * Returns true if local storage was updated.
 */
export async function mergeCloudSemesters(
  cloudSemesters?: ArchivedSemester[] | null,
  cloudUpdatedAt?: string
): Promise<boolean> {
  const cleanCloud = sanitizeSemesters(cloudSemesters);
  if (!cleanCloud.length) return false;

  const currentLocal = await getStoredSemesters();
  const currentStamp = await getStoredSemestersUpdatedAt();

  const merged = mergeArchivedSemesters(currentLocal, cleanCloud);
  const timeLocal = currentStamp ? Date.parse(currentStamp) || 0 : 0;
  const timeCloud = cloudUpdatedAt ? Date.parse(cloudUpdatedAt) || 0 : 0;

  const changed = JSON.stringify(merged) !== JSON.stringify(currentLocal);
  if (changed || timeCloud > timeLocal) {
    const finalStamp = timeCloud > timeLocal && cloudUpdatedAt ? cloudUpdatedAt : new Date().toISOString();
    await saveStoredSemesters(merged, finalStamp);
    return true;
  }
  return false;
}
