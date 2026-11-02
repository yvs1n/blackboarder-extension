import { DeadlineTask, QuickLink, UserCourseConfig, StudentProfile, ArchivedSemester } from '../types';
import { sanitizeCloudTasks, encodeCloudKeys, decodeCloudKeys, sanitizeCloudQuickLinks, sanitizeCloudCourses, sanitizeScanRequest } from './cloudSanitize';
import type { CloudScanRequest } from './cloudSanitize';
import { getProfile, mergeCloudProfile } from './profile';
import { getStoredSemesters, getStoredSemestersUpdatedAt, mergeCloudSemesters, saveStoredSemesters } from './semestersStorage';
import { mergeForCloudWrite, readCloudSide } from './syncMerge';

export const FIREBASE_CONFIG = {
  authDomain: 'blackboard-sidekick.firebaseapp.com',
  databaseURL: 'https://blackboard-sidekick-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'blackboard-sidekick',
  storageBucket: 'blackboard-sidekick.firebasestorage.app'
};

export const FIREBASE_DB_URL = FIREBASE_CONFIG.databaseURL;

export const NO_SYNC_KEY_MESSAGE = 'No sync key is set. Pair this device in Settings > Sync first.';

/**
 * Normalizes a sync key or pairing link into a valid clean sync key string.
 * Supports direct keys ("BBS-ABC..."), lowercase ("bbs-abc..."), or full pairing URLs.
 */
export function extractSyncKey(raw?: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (text.includes('://') || text.startsWith('//') || text.startsWith('?') || text.startsWith('#') || text.includes('/')) {
    try {
      let urlStr = text;
      if (text.startsWith('?') || text.startsWith('#')) {
        urlStr = `https://blackboarder.pages.dev/${text}`;
      } else if (!text.includes('://') && !text.startsWith('//')) {
        urlStr = `https://${text}`;
      }
      const url = new URL(urlStr, 'https://blackboarder.pages.dev');
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
      const key = url.searchParams.get('key') || url.searchParams.get('sync') || url.searchParams.get('code') || hashParams.get('key') || hashParams.get('sync') || hashParams.get('code') || '';
      if (key) return key.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    } catch {}
  }
  return text.trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * The Firebase data URL for a sync key: /users/{key}/data.json. Characters a key cannot hold are
 * removed first; what is left must be a valid key (the database.rules.json rule), else null.
 * There is no fallback to the database root: every read and write stays inside users/{syncKey}.
 */
export function getFirebaseDataUrl(syncKey?: string): string | null {
  const cleanKey = extractSyncKey(syncKey);
  return /^[A-Za-z0-9_-]{8,64}$/.test(cleanKey) ? `${FIREBASE_DB_URL}/users/${cleanKey}/data.json` : null;
}

/** A response header, or null (some test doubles and old runtimes have no headers object). */
function headerOf(res: Response, name: string): string | null {
  const headers: any = res && (res as any).headers;
  return headers && typeof headers.get === 'function' ? headers.get(name) : null;
}

/** How many times a write is tried again after another device wrote between the read and the write. */
const ETAG_RETRIES = 3;

/**
 * Deletes everything stored online under a sync key: deadlines, courses, quick links, the encrypted AI
 * key and the push subscription. Only that key's own folder is touched.
 */
export async function deleteSyncDataFromFirebase(syncKey: string): Promise<{ success: boolean; message: string }> {
  const cleanKey = (syncKey || '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(cleanKey)) return { success: false, message: 'There is no valid sync key to delete.' };
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/users/${cleanKey}.json`, { method: 'DELETE' });
    if (!res.ok) return { success: false, message: `The server refused the request (${res.status}).` };
    return { success: true, message: 'Cloud data deleted.' };
  } catch (err) {
    return { success: false, message: 'Could not reach the server. Check your connection and try again.' };
  }
}

export type { CloudScanRequest };

export interface FirebaseSyncPayload {
  tasks: DeadlineTask[];
  lastSync: string;
  device?: string;
  count: number;
  syncKey?: string;
  quickLinks?: QuickLink[];
  courses?: UserCourseConfig[];
  coursesUpdatedAt?: string;
  quickLinksUpdatedAt?: string;
  tombstones?: Record<string, string>;
  profile?: StudentProfile;
  semesters?: ArchivedSemester[];
  semestersUpdatedAt?: string;
  scanRequest?: CloudScanRequest;
}

export { sanitizeCloudTasks };

/**
 * Writes this device's deadlines, courses, quick links and profile to Firebase under the sync key.
 * The write replaces the whole cloud document, so the cloud copy is read first and merged in
 * (`mergeForCloudWrite`): nothing another device saved in the meantime is lost. If the cloud copy
 * cannot be read, nothing is written; the next sync tries again.
 * The read asks Firebase for the document's ETag and the write sends it back as `if-match`, so a
 * write made by another device in between is refused (412) instead of overwritten; then the copy is
 * read, merged and written again, up to ETAG_RETRIES times.
 */
export async function pushTasksToFirebase(
  tasks: DeadlineTask[],
  device: string = 'Chrome Extension',
  syncKey?: string,
  quickLinks?: QuickLink[],
  tombstones?: Record<string, string>,
  courses?: UserCourseConfig[],
  coursesUpdatedAt?: string,
  quickLinksUpdatedAt?: string
): Promise<{ success: boolean; message: string; lastSync?: string; count?: number }> {
  const targetUrl = getFirebaseDataUrl(syncKey);
  if (!targetUrl) return { success: false, message: NO_SYNC_KEY_MESSAGE };
  try {
    const profile = await getProfile();
    const semesters = await getStoredSemesters();
    const semestersUpdatedAt = await getStoredSemestersUpdatedAt();
    for (let attempt = 0; ; attempt++) {
      const cloudRes = await fetch(targetUrl, { cache: 'no-store', headers: { 'X-Firebase-ETag': 'true' } });
      if (!cloudRes || !cloudRes.ok) {
        return { success: false, message: `Could not read the cloud copy before saving (${cloudRes ? cloudRes.status : 'no response'})` };
      }
      const etag = headerOf(cloudRes, 'ETag');
      const cloud = readCloudSide(await cloudRes.json().catch(() => null));
      const merged = mergeForCloudWrite({
        tasks,
        tombstones,
        courses: Array.isArray(courses) ? courses : undefined,
        coursesUpdatedAt,
        quickLinks,
        quickLinksUpdatedAt,
        profile,
        semesters,
        semestersUpdatedAt
      }, cloud);

      if (merged.semestersFromCloud && merged.semesters) {
        await saveStoredSemesters(merged.semesters, merged.semestersUpdatedAt);
      }

      const lastSync = new Date().toISOString();
      const payload: FirebaseSyncPayload = {
        tasks: merged.tasks,
        lastSync,
        device,
        count: merged.tasks.length,
        syncKey: syncKey || undefined,
        quickLinks: merged.quickLinks,
        quickLinksUpdatedAt: merged.quickLinksUpdatedAt,
        courses: merged.courses,
        coursesUpdatedAt: merged.coursesUpdatedAt,
        // Keys are task ids and may hold characters Firebase refuses, so they are encoded
        tombstones: encodeCloudKeys(merged.tombstones),
        // Every write replaces the whole payload, so the university always travels with it
        profile: merged.profile,
        semesters: merged.semesters,
        semestersUpdatedAt: merged.semestersUpdatedAt,
        // And so does the phone's scan request, or the extension would never see it
        scanRequest: merged.scanRequest
      };

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (etag) headers['if-match'] = etag;
      const res = await fetch(targetUrl, { method: 'PUT', headers, body: JSON.stringify(payload) });

      if (res.status === 412 && etag && attempt < ETAG_RETRIES) {
        // Another device wrote since the read: read its copy, merge again and retry
        console.info('[Firebase] The cloud copy changed while saving, merging again');
        continue;
      }
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        return { success: false, message: `Firebase error (${res.status}): ${err}` };
      }

      return {
        success: true,
        message: `Synchronized ${merged.tasks.length} deadlines with Firebase Cloud`,
        lastSync,
        count: merged.tasks.length
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: `Could not connect to Firebase: ${err.message || err}`
    };
  }
}

/**
 * Fetches the latest deadlines stored in Firebase Realtime Database.
 * If syncKey is provided, retrieves the isolated user bucket.
 */
export async function fetchTasksFromFirebase(syncKey?: string): Promise<{
  success: boolean;
  tasks: DeadlineTask[];
  deleted?: boolean;
  lastSync?: string;
  device?: string;
  error?: string;
  quickLinks?: QuickLink[];
  quickLinksUpdatedAt?: string;
  courses?: UserCourseConfig[];
  coursesUpdatedAt?: string;
  tombstones?: Record<string, string>;
  profile?: StudentProfile;
  semesters?: ArchivedSemester[];
  semestersUpdatedAt?: string;
  scanRequest?: CloudScanRequest;
}> {
  const targetUrl = getFirebaseDataUrl(syncKey);
  if (!targetUrl) return { success: false, tasks: [], error: NO_SYNC_KEY_MESSAGE };
  try {
    const res = await fetch(targetUrl, {
      cache: 'no-store'
    });

    if (!res.ok) {
      return { success: false, tasks: [], error: `HTTP ${res.status}` };
    }

    const data: FirebaseSyncPayload | null = await res.json();
    if (data === null || (data as any)?.deleted === true) {
      return {
        success: false,
        tasks: [],
        deleted: true,
        error: 'Sync key has been deleted or unlinked.'
      };
    }

    await mergeCloudProfile(data?.profile).catch(() => false);
    await mergeCloudSemesters(data?.semesters, data?.semestersUpdatedAt).catch(() => false);
    const quickLinks = sanitizeCloudQuickLinks(data?.quickLinks);
    const courses = sanitizeCloudCourses(data?.courses);
    if (!data || !Array.isArray(data.tasks)) {
      // Firebase drops empty arrays: a saved empty list has lastSync but no tasks
      return {
        success: true,
        tasks: [],
        lastSync: data?.lastSync,
        quickLinks,
        quickLinksUpdatedAt: data?.quickLinksUpdatedAt,
        courses,
        coursesUpdatedAt: data?.coursesUpdatedAt,
        tombstones: decodeCloudKeys(data?.tombstones),
        profile: data?.profile,
        semesters: data?.semesters,
        semestersUpdatedAt: data?.semestersUpdatedAt,
        scanRequest: sanitizeScanRequest(data?.scanRequest)
      };
    }

    return {
      success: true,
      tasks: sanitizeCloudTasks(data.tasks),
      lastSync: data.lastSync,
      device: data.device,
      quickLinks,
      quickLinksUpdatedAt: data.quickLinksUpdatedAt,
      courses,
      coursesUpdatedAt: data.coursesUpdatedAt,
      tombstones: decodeCloudKeys(data.tombstones),
      profile: data.profile,
      semesters: data.semesters,
      semestersUpdatedAt: data.semestersUpdatedAt,
      scanRequest: sanitizeScanRequest(data.scanRequest)
    };
  } catch (err: any) {
    return {
      success: false,
      tasks: [],
      error: err.message || 'Network error'
    };
  }
}

/**
 * Updates a completed scan request in Firebase so the mobile PWA knows the scan finished.
 */
export async function markCloudScanRequestCompleted(
  syncKey: string,
  requestedAt: string,
  message: string = 'Scan complete! Deadlines updated.'
): Promise<void> {
  const targetUrl = getFirebaseDataUrl(syncKey);
  if (!targetUrl) return;
  try {
    const res = await fetch(targetUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lastSync: new Date().toISOString(),
        scanRequest: {
          state: 'done',
          requestedAt,
          completedAt: new Date().toISOString(),
          message
        }
      })
    });
    if (res && !res.ok) console.info(`[Firebase] Could not mark scan request completed (${res.status})`);
  } catch (err) {
    // Offline or Firebase unreachable: the phone stops waiting on its own
    console.info('[Firebase] Could not mark scan request completed:', err);
  }
}
