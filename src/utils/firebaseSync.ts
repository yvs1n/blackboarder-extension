import { DeadlineTask, TaskStatus, QuickLink, UserCourseConfig } from '../types';
import { sanitizeCloudTasks, encodeCloudKeys, decodeCloudKeys, sanitizeCloudQuickLinks, sanitizeCloudCourses } from './cloudSanitize';

export const FIREBASE_CONFIG = {
  authDomain: 'blackboard-sidekick.firebaseapp.com',
  databaseURL: 'https://blackboard-sidekick-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'blackboard-sidekick',
  storageBucket: 'blackboard-sidekick.firebasestorage.app'
};

export const FIREBASE_DB_URL = FIREBASE_CONFIG.databaseURL;

/**
 * Returns the scoped Firebase data URL based on user syncKey.
 * If syncKey is provided, namespaces under /users/{cleanKey}/data.json.
 * If syncKey is omitted or empty, falls back to legacy root /data.json.
 */
export function getFirebaseDataUrl(syncKey?: string): string {
  const cleanKey = (syncKey || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return cleanKey ? `${FIREBASE_DB_URL}/users/${cleanKey}/data.json` : `${FIREBASE_DB_URL}/data.json`;
}

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

export interface FirebaseSyncPayload {
  tasks: DeadlineTask[];
  lastSync: string;
  device?: string;
  count: number;
  syncKey?: string;
  quickLinks?: QuickLink[];
  courses?: UserCourseConfig[];
  coursesUpdatedAt?: string;
  tombstones?: Record<string, string>;
}

export { sanitizeCloudTasks };

export interface DeletionTombstone {
  id: string;
  deletedAt: string;
  device?: string;
}

/**
 * Pushes deadlines to Firebase Realtime Database.
 * Supports user-isolated namespaces via syncKey.
 */
export async function pushTasksToFirebase(
  tasks: DeadlineTask[],
  device: string = 'Chrome Extension',
  syncKey?: string,
  quickLinks?: QuickLink[],
  tombstones?: Record<string, string>,
  courses?: UserCourseConfig[],
  coursesUpdatedAt?: string
): Promise<{ success: boolean; message: string; lastSync?: string; count?: number }> {
  try {
    const lastSync = new Date().toISOString();
    const payload: FirebaseSyncPayload = {
      tasks,
      lastSync,
      device,
      count: tasks.length,
      syncKey: syncKey || undefined,
      quickLinks: quickLinks || undefined,
      courses: Array.isArray(courses) ? courses : undefined,
      coursesUpdatedAt: coursesUpdatedAt || undefined,
      // Keys are task ids and may hold characters Firebase refuses, so they are encoded
      tombstones: encodeCloudKeys(tombstones)
    };

    const targetUrl = getFirebaseDataUrl(syncKey);
    const res = await fetch(targetUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return { success: false, message: `Firebase error (${res.status}): ${err}` };
    }

    return {
      success: true,
      message: `Synchronized ${tasks.length} deadlines with Firebase Cloud`,
      lastSync,
      count: tasks.length
    };
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
  lastSync?: string;
  device?: string;
  error?: string;
  quickLinks?: QuickLink[];
  courses?: UserCourseConfig[];
  coursesUpdatedAt?: string;
  tombstones?: Record<string, string>;
}> {
  try {
    const targetUrl = getFirebaseDataUrl(syncKey);
    const res = await fetch(targetUrl, {
      cache: 'no-store'
    });

    if (!res.ok) {
      return { success: false, tasks: [], error: `HTTP ${res.status}` };
    }

    const data: FirebaseSyncPayload = await res.json();
    const quickLinks = sanitizeCloudQuickLinks(data?.quickLinks);
    const courses = sanitizeCloudCourses(data?.courses);
    if (!data || !Array.isArray(data.tasks)) {
      // Firebase drops empty arrays: a saved empty list has lastSync but no tasks
      return {
        success: true,
        tasks: [],
        lastSync: data?.lastSync,
        quickLinks,
        courses,
        coursesUpdatedAt: data?.coursesUpdatedAt,
        tombstones: decodeCloudKeys(data?.tombstones)
      };
    }

    return {
      success: true,
      tasks: sanitizeCloudTasks(data.tasks),
      lastSync: data.lastSync,
      device: data.device,
      quickLinks,
      courses,
      coursesUpdatedAt: data.coursesUpdatedAt,
      tombstones: decodeCloudKeys(data.tombstones)
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
 * Pushes a modified task list back to Firebase while keeping the quick links, courses and
 * deletion tombstones already stored in the cloud (a bare PUT of `tasks` would wipe them).
 */
function pushPreservingCloudFields(
  fetched: Awaited<ReturnType<typeof fetchTasksFromFirebase>>,
  tasks: DeadlineTask[],
  device: string,
  syncKey?: string,
  tombstones: Record<string, string> | undefined = fetched.tombstones
) {
  return pushTasksToFirebase(
    tasks,
    device,
    syncKey,
    fetched.quickLinks,
    tombstones,
    fetched.courses,
    fetched.coursesUpdatedAt
  );
}

/**
 * Updates a single task status in Firebase Realtime Database without clobbering other fields.
 */
export async function updateTaskStatusInFirebase(
  taskId: string,
  status: TaskStatus,
  syncKey?: string
): Promise<boolean> {
  try {
    const fetchRes = await fetchTasksFromFirebase(syncKey);
    if (!fetchRes.success || !fetchRes.tasks) return false;

    const tasks = fetchRes.tasks;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return false;

    task.status = status;
    task.updatedAt = new Date().toISOString();

    const pushRes = await pushPreservingCloudFields(fetchRes, tasks, 'Status Update', syncKey);
    return pushRes.success;
  } catch (err) {
    console.error('Error updating task status in Firebase:', err);
    return false;
  }
}

/**
 * Updates a single task (including notes and announcement) in Firebase Realtime Database.
 */
export async function updateTaskInFirebase(
  updatedTask: DeadlineTask,
  device: string = 'Chrome Extension',
  syncKey?: string
): Promise<boolean> {
  try {
    const fetchRes = await fetchTasksFromFirebase(syncKey);
    if (!fetchRes.success || !fetchRes.tasks) return false;

    const tasks = fetchRes.tasks.map(t => (t.id === updatedTask.id ? { ...t, ...updatedTask, updatedAt: new Date().toISOString() } : t));
    const pushRes = await pushPreservingCloudFields(fetchRes, tasks, `${device} Task Edit`, syncKey);
    return pushRes.success;
  } catch (err) {
    console.error('Error updating task in Firebase:', err);
    return false;
  }
}

/**
 * Removes a task from Firebase and records a deletion tombstone so it cannot resurrect from another device.
 * Returns false if the cloud copy could not be read or written.
 */
export async function recordTaskDeletionInFirebase(
  taskId: string,
  device: string = 'Chrome Extension',
  syncKey?: string
): Promise<boolean> {
  try {
    const fetchRes = await fetchTasksFromFirebase(syncKey);
    if (!fetchRes.success) return false;

    const remaining = (fetchRes.tasks || []).filter(t => t.id !== taskId);
    const tombstones = { ...(fetchRes.tombstones || {}), [taskId]: new Date().toISOString() };
    const pushRes = await pushPreservingCloudFields(fetchRes, remaining, `${device} Deleted Task`, syncKey, tombstones);
    return pushRes.success;
  } catch (e) {
    console.warn('Could not record task deletion in Firebase:', e);
    return false;
  }
}
