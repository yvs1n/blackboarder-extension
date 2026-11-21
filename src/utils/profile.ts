import type { StudentProfile } from '../types';
import { sanitizeProfile } from '../core/studentProfile';
import { findUniversityByHost, swapUniversityQuickLinks } from '../core/universities';
import { getQuickLinks, saveQuickLinks, safeGetLocalStorage, safeSetLocalStorage } from './storage';

export const PROFILE_KEY = 'bbs_profile';

function hasChromeStorage(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.local;
  } catch {
    return false;
  }
}

export async function getProfile(): Promise<StudentProfile | null> {
  if (hasChromeStorage()) {
    try {
      const res = await chrome.storage.local.get([PROFILE_KEY]);
      return sanitizeProfile(res?.[PROFILE_KEY]);
    } catch {
      return null;
    }
  }
  try {
    const raw = safeGetLocalStorage(PROFILE_KEY);
    return raw ? sanitizeProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Saves the profile, stamping updatedAt unless one is given (a cloud copy keeps its own). */
export async function saveProfile(profile: Omit<StudentProfile, 'updatedAt'> & { updatedAt?: string }): Promise<StudentProfile | null> {
  const clean = sanitizeProfile({ ...profile, updatedAt: profile.updatedAt || new Date().toISOString() });
  if (!clean) return null;
  const before = profile.updatedAt ? null : await getProfile();
  if (hasChromeStorage()) {
    try {
      await chrome.storage.local.set({ [PROFILE_KEY]: clean });
    } catch {}
  } else {
    try {
      safeSetLocalStorage(PROFILE_KEY, JSON.stringify(clean));
    } catch {}
  }
  // A change made on this device (a cloud copy brings its own links through sync)
  if (!profile.updatedAt) await swapQuickLinksForUniversity(before?.universityId || 'other', clean.universityId);
  return clean;
}

/** Drops the old university's untouched built-in links and adds the new one's. */
async function swapQuickLinksForUniversity(fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return;
  try {
    const links = await getQuickLinks();
    const now = new Date().toISOString();
    const next = swapUniversityQuickLinks(links, fromId, toId, p => ({ ...p, createdAt: now }));
    if (JSON.stringify(next) !== JSON.stringify(links)) await saveQuickLinks(next);
  } catch {}
}

/** Clears saved profile completely from local storage (used when switching sync keys or restoring a backup without a profile). */
export async function clearProfile(): Promise<void> {
  if (hasChromeStorage()) {
    try {
      await chrome.storage.local.remove([PROFILE_KEY]);
    } catch {}
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(PROFILE_KEY);
  } catch {}
}

/** Keeps a cloud profile when it is newer than the one here. Returns true when it was taken. */
export async function mergeCloudProfile(cloud: unknown): Promise<boolean> {
  const incoming = sanitizeProfile(cloud);
  if (!incoming) return false;
  const local = await getProfile();
  if (local && Date.parse(incoming.updatedAt) <= Date.parse(local.updatedAt)) return false;
  await saveProfile(incoming);
  return true;
}

/**
 * Sets the university from the Blackboard address the first time a scan runs, when the student
 * has not chosen one. Returns the university id it set, or null.
 */
export async function detectUniversityFromHost(hostname: string): Promise<string | null> {
  const found = findUniversityByHost(hostname);
  if (!found) return null;
  const current = await getProfile();
  if (current) return null;
  await saveProfile({ universityId: found.id, source: 'detected' });
  return found.id;
}
