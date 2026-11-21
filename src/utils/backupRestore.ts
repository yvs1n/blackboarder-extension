import type { ArchivedSemester, DeadlineTask, PaymentItem, QuickLink, StudentProfile, UserCourseConfig, UserSettings } from '../types';
import { compareTasksByTime } from './calendar';
import { sanitizeCloudCourses, sanitizeCloudQuickLinks, sanitizeCloudTasks } from './cloudSanitize';
import { filterCleanUserCourses } from '../core/courseFilter';
import { sanitizePayments } from '../core/payments';
import { sanitizeSemesters } from '../core/semesters';
import { sanitizeProfile } from '../core/studentProfile';
import { saveExtraSites } from './blackboardSites';
import { extractSyncKey, overwriteCloudVault } from './firebaseSync';
import { clearProfile, saveProfile } from './profile';
import {
  getSettings,
  isExtensionContextValid,
  safeGetLocalStorage,
  safeSetLocalStorage,
  saveQuickLinks,
  saveSettings,
  saveStoredPayments,
  saveStoredSemesters,
  saveTasks,
  saveUserCourses,
} from './storage';
import { setStorageTombstones } from './tombstones';

export const BACKUP_EPOCH_KEY = 'bbs_backup_epoch';

export interface CloudSnapshotData {
  tasks?: DeadlineTask[];
  courses?: UserCourseConfig[];
  coursesUpdatedAt?: string;
  quickLinks?: QuickLink[];
  quickLinksUpdatedAt?: string;
  payments?: PaymentItem[];
  paymentsUpdatedAt?: string;
  semesters?: ArchivedSemester[];
  semestersUpdatedAt?: string;
  tombstones?: Record<string, string>;
  profile?: StudentProfile | null;
  backupEpoch?: string;
}

export interface AppliedSnapshotState {
  tasks: DeadlineTask[];
  courses: UserCourseConfig[];
  quickLinks: QuickLink[];
  payments: PaymentItem[];
  semesters: ArchivedSemester[];
  tombstones: Record<string, string>;
  profile: StudentProfile | null;
  backupEpoch: string;
}

export async function getLocalBackupEpoch(): Promise<string> {
  if (isExtensionContextValid()) {
    try {
      const res = await chrome.storage.local.get([BACKUP_EPOCH_KEY]);
      if (typeof res?.[BACKUP_EPOCH_KEY] === 'string' && res[BACKUP_EPOCH_KEY]) {
        return res[BACKUP_EPOCH_KEY];
      }
    } catch {}
  }
  return safeGetLocalStorage(BACKUP_EPOCH_KEY) || '';
}

export async function setLocalBackupEpoch(epoch?: string): Promise<void> {
  const val = typeof epoch === 'string' ? epoch : '';
  safeSetLocalStorage(BACKUP_EPOCH_KEY, val);
  if (isExtensionContextValid()) {
    try {
      await chrome.storage.local.set({ [BACKUP_EPOCH_KEY]: val });
    } catch {}
  }
}

/** True when Firebase holds a full backup overwrite (`backupEpoch`) newer than what this device last saw. */
export function isCloudBackupEpochNewer(cloudEpoch?: string | null, localEpoch?: string | null): boolean {
  if (!cloudEpoch || typeof cloudEpoch !== 'string') return false;
  const cloudMs = Date.parse(cloudEpoch);
  if (isNaN(cloudMs)) return false;
  if (!localEpoch) return true;
  const localMs = Date.parse(localEpoch);
  if (isNaN(localMs)) return true;
  return cloudMs > localMs;
}

/**
 * Unconditionally replaces all local storage state (tasks, courses, quick links, payments, semesters,
 * tombstones, profile, and backup epoch) from an authoritative Firebase snapshot.
 * Never merges with leftover local data and never pushes back to Firebase.
 */
export async function applyCloudSnapshotAuthoritatively(snapshot: CloudSnapshotData): Promise<AppliedSnapshotState> {
  const nowIso = new Date().toISOString();
  const tasks = sanitizeCloudTasks(Array.isArray(snapshot.tasks) ? snapshot.tasks : []).sort(compareTasksByTime);
  const courses = filterCleanUserCourses(sanitizeCloudCourses(Array.isArray(snapshot.courses) ? snapshot.courses : []) || []);
  const quickLinks = sanitizeCloudQuickLinks(Array.isArray(snapshot.quickLinks) ? snapshot.quickLinks : []) || [];
  const payments = sanitizePayments(Array.isArray(snapshot.payments) ? snapshot.payments : []);
  const semesters = sanitizeSemesters(Array.isArray(snapshot.semesters) ? snapshot.semesters : []);
  const tombstones = snapshot.tombstones && typeof snapshot.tombstones === 'object' && !Array.isArray(snapshot.tombstones)
    ? { ...snapshot.tombstones }
    : {};
  const cleanProfile = sanitizeProfile(snapshot.profile);
  const backupEpoch = typeof snapshot.backupEpoch === 'string' ? snapshot.backupEpoch : '';

  await saveTasks(tasks);
  await saveUserCourses(courses, snapshot.coursesUpdatedAt || nowIso);
  await saveQuickLinks(quickLinks, snapshot.quickLinksUpdatedAt || nowIso);
  await saveStoredPayments(payments, snapshot.paymentsUpdatedAt || nowIso);
  await saveStoredSemesters(semesters, snapshot.semestersUpdatedAt || nowIso);
  await setStorageTombstones(tombstones);
  if (cleanProfile) {
    await saveProfile(cleanProfile);
  } else {
    await clearProfile();
  }
  await setLocalBackupEpoch(backupEpoch);

  return {
    tasks,
    courses,
    quickLinks,
    payments,
    semesters,
    tombstones,
    profile: cleanProfile,
    backupEpoch
  };
}

export interface BackupRestoreOutcome {
  applied: AppliedSnapshotState;
  restoredTaskCount: number;
  restoredCourseCount: number;
  syncKey: string;
  cloudResult?: { success: boolean; message: string; lastSync?: string; count?: number };
}

/**
 * Replaces ALL local state from an imported JSON backup and authoritatively overwrites
 * the Firebase vault under the active Sync Key (never merging stale local or cloud items back in).
 */
export async function applyBackupAuthoritatively(
  data: any,
  options?: { activeSyncKey?: string; deviceLabel?: string }
): Promise<BackupRestoreOutcome> {
  if (!data || typeof data !== 'object' || (!Array.isArray(data.tasks) && !Array.isArray(data.courses))) {
    throw new Error('Invalid backup file format.');
  }

  const nowIso = new Date().toISOString();
  const tasks = Array.isArray(data.tasks)
    ? sanitizeCloudTasks(data.tasks).filter(t => Boolean(t.title)).sort(compareTasksByTime)
    : [];
  const courses = Array.isArray(data.courses)
    ? filterCleanUserCourses(sanitizeCloudCourses(data.courses) || [])
    : [];
  const quickLinks = Array.isArray(data.quickLinks)
    ? sanitizeCloudQuickLinks(data.quickLinks) || []
    : [];
  const payments = Array.isArray(data.payments) ? sanitizePayments(data.payments) : [];
  const semesters = Array.isArray(data.semesters) ? sanitizeSemesters(data.semesters) : [];
  const tombstones: Record<string, string> =
    data.tombstones && typeof data.tombstones === 'object' && !Array.isArray(data.tombstones)
      ? { ...data.tombstones }
      : {};

  const rawProfile = data.profile && typeof data.profile === 'object' ? sanitizeProfile({ ...data.profile, updatedAt: nowIso }) : null;

  const existingSettings = await getSettings();
  const activeKey = extractSyncKey(options?.activeSyncKey ?? existingSettings.syncKey);
  const importedKey = extractSyncKey(data.settings?.syncKey);
  const targetSyncKey = activeKey || importedKey || '';

  if (data.settings && typeof data.settings === 'object') {
    const nextSettings: Partial<UserSettings> = {
      ...data.settings,
      ...(targetSyncKey ? { syncKey: targetSyncKey } : {})
    };
    await saveSettings(nextSettings);
  } else if (targetSyncKey && targetSyncKey !== existingSettings.syncKey) {
    await saveSettings({ syncKey: targetSyncKey });
  }

  if (targetSyncKey) {
    safeSetLocalStorage('bbs_persistent_sync_key', targetSyncKey);
    safeSetLocalStorage('bbs_sync_key', targetSyncKey);
  }

  await saveTasks(tasks);
  await saveUserCourses(courses, nowIso);
  await saveQuickLinks(quickLinks, nowIso);
  await saveStoredPayments(payments, nowIso);
  await saveStoredSemesters(semesters, nowIso);
  await setStorageTombstones(tombstones);

  if (Array.isArray(data.extraSites)) {
    await saveExtraSites(data.extraSites).catch(() => {});
  } else {
    await saveExtraSites([]).catch(() => {});
  }

  if (rawProfile) {
    await saveProfile(rawProfile);
  } else {
    await clearProfile();
  }

  await setLocalBackupEpoch(nowIso);

  let cloudResult: BackupRestoreOutcome['cloudResult'];
  if (targetSyncKey) {
    cloudResult = await overwriteCloudVault(
      {
        tasks,
        courses,
        coursesUpdatedAt: nowIso,
        quickLinks,
        quickLinksUpdatedAt: nowIso,
        tombstones,
        profile: rawProfile,
        semesters,
        semestersUpdatedAt: nowIso,
        payments,
        paymentsUpdatedAt: nowIso,
        backupEpoch: nowIso
      },
      options?.deviceLabel || 'Restored Backup',
      targetSyncKey
    );
  }

  return {
    applied: {
      tasks,
      courses,
      quickLinks,
      payments,
      semesters,
      tombstones,
      profile: rawProfile,
      backupEpoch: nowIso
    },
    restoredTaskCount: tasks.length,
    restoredCourseCount: courses.length,
    syncKey: targetSyncKey,
    cloudResult
  };
}
