import type { StudentProfile } from '../types';
import { sanitizeProfile } from '../core/studentProfile';
import { findUniversityByHost } from '../core/universities';

export const PROFILE_KEY = 'bbs_profile';

function hasChromeStorage(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.local;
  } catch {
    return false;
  }
}

export async function getProfile(): Promise<StudentProfile | null> {
  if (!hasChromeStorage()) return null;
  try {
    const res = await chrome.storage.local.get([PROFILE_KEY]);
    return sanitizeProfile(res?.[PROFILE_KEY]);
  } catch {
    return null;
  }
}

/** Saves the profile, stamping updatedAt unless one is given (a cloud copy keeps its own). */
export async function saveProfile(profile: Omit<StudentProfile, 'updatedAt'> & { updatedAt?: string }): Promise<StudentProfile | null> {
  const clean = sanitizeProfile({ ...profile, updatedAt: profile.updatedAt || new Date().toISOString() });
  if (!clean || !hasChromeStorage()) return clean;
  try {
    await chrome.storage.local.set({ [PROFILE_KEY]: clean });
  } catch {}
  return clean;
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
