import { DeadlineTask, Announcement, UserSettings, DEFAULT_SETTINGS, QuickLink, UserCourseConfig } from '../types';
import { universityQuickLinks } from '../core/universities';
import { isValidTask, isBlackboardSystemNoise, hasValidAcademicCourseCode } from '../core/courseHelper';
import { areTasksDuplicates, mergeDuplicatePair, deduplicateTaskList, mergeCloudTasks, sanitizeTaskListMarks } from './taskMerge';
import { DEFAULT_USER_COURSES, setActiveUserCourses } from '../core/userCourses';
import { resolveTaskWeight } from '../core/syllabusWeights';
import { resolveTaskRoom, resolveTaskTimeWithSchedule } from '../core/courseSchedule';
import { filterCleanUserCourses } from '../core/courseFilter';

const STORAGE_KEYS = {
  TASKS: 'bbs_tasks',
  ANNOUNCEMENTS: 'bbs_announcements',
  SETTINGS: 'bbs_settings',
  LAST_SCANNED: 'bbs_last_scanned',
  QUICK_LINKS: 'bbs_quick_links',
  COURSES: 'bbs_user_courses',
  COURSES_UPDATED_AT: 'bbs_courses_updated_at',
  QUICK_LINKS_UPDATED_AT: 'bbs_quick_links_updated_at'
};

/**
 * Normalizes a student sync key to trimmed uppercase format.
 */
export function normalizeRestoredSyncKey(key?: string | null): string {
  const clean = (key || '').trim().toUpperCase();
  return clean;
}

/**
 * Dynamic check to verify if the Chrome Extension runtime context is still active and valid.
 * In Manifest V3, when an extension is updated, reloaded, or rebuilt, content scripts injected
 * into existing tabs become orphaned. In that state, calling chrome APIs throws:
 * "Error: Extension context invalidated."
 */
export function isExtensionContextValid(): boolean {
  try {
    return (
      typeof chrome !== 'undefined' &&
      Boolean(chrome.runtime?.id) &&
      Boolean(chrome.storage?.local)
    );
  } catch {
    return false;
  }
}

/**
 * True only on pages where a same-origin `/api/ai/*` edge proxy can plausibly exist (the hosted
 * web app). Content scripts run on the university's Blackboard origin; posting an API key there
 * would hand it to the university's server, so those hosts are always excluded.
 */
export function canUseSameOriginProxy(): boolean {
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    const { protocol, hostname } = window.location;
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    // A content script runs on a university's Blackboard, whatever its address: never post there
    if (typeof chrome !== 'undefined' && (chrome as any).runtime?.id) return false;
    return !/(^|\.)(sharjah\.ac\.ae|blackboard\.com)$/i.test(hostname);
  } catch {
    return false;
  }
}

const memoryStorage = new Map<string, string>();

function canUseLocalStorage(): boolean {
  try {
    const hasLocalStorage = typeof localStorage !== 'undefined';
    if (!hasLocalStorage) return false;

    // If running in browser window
    if (typeof window !== 'undefined') {
      // If running inside a content script on an external web page (e.g. Blackboard),
      // do not read/write host webpage localStorage
      if (typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)) {
        if (window.location?.protocol === 'http:' || window.location?.protocol === 'https:') {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

function safeGetLocalStorage(key: string): string | null {
  try {
    if (canUseLocalStorage()) {
      return localStorage.getItem(key);
    }
  } catch {
    // Ignore storage access errors (e.g. iframe sandbox)
  }
  return memoryStorage.get(key) || null;
}

function safeSetLocalStorage(key: string, value: string): void {
  try {
    if (canUseLocalStorage()) {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    // Ignore storage quota or access errors
  }
  memoryStorage.set(key, value);
}

export function getCachedTasksSync(): DeadlineTask[] {
  const raw = safeGetLocalStorage(STORAGE_KEYS.TASKS);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return sanitizeTaskListMarks(parsed.filter(isValidTask));
      }
    } catch {}
  }
  return [];
}

export function getCachedQuickLinksSync(): QuickLink[] {
  return parseLinks(safeGetLocalStorage(STORAGE_KEYS.QUICK_LINKS));
}

/** Random characters in a new sync key: 26 symbols of 5 bits each is 130 bits, far beyond guessing. Older, shorter keys still work. */
export const SYNC_KEY_RANDOM_LENGTH = 26;

export function generateUniqueSyncKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, so a random byte maps without bias
  const bytes = new Uint8Array(SYNC_KEY_RANDOM_LENGTH);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let rand = '';
  for (let i = 0; i < bytes.length; i++) {
    rand += chars.charAt(bytes[i] % chars.length);
  }
  return `BBS-${rand}`;
}

export function getCachedSettingsSync(): UserSettings {
  const raw = safeGetLocalStorage(STORAGE_KEYS.SETTINGS);
  let settings: UserSettings = { ...DEFAULT_SETTINGS };
  if (raw) {
    try {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {}
  }
  const existingKey = normalizeRestoredSyncKey(
    settings.syncKey || safeGetLocalStorage('bbs_persistent_sync_key') || safeGetLocalStorage('bbs_sync_key')
  );
  settings.syncKey = existingKey || DEFAULT_SETTINGS.syncKey || '';
  return settings;
}

export async function getSettings(): Promise<UserSettings> {
  if (isExtensionContextValid()) {
    try {
      return await new Promise<UserSettings>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.SETTINGS, 'bbs_persistent_sync_key'], (result: { [key: string]: any }) => {
            try {
              const stored = result?.[STORAGE_KEYS.SETTINGS];
              let resolved = stored && typeof stored === 'object' ? { ...DEFAULT_SETTINGS, ...stored } : { ...DEFAULT_SETTINGS };

              const resolveSyncKeyAndFinish = (keyToUse: string | null) => {
                const normalizedKey = normalizeRestoredSyncKey(keyToUse || resolved.syncKey) || DEFAULT_SETTINGS.syncKey || '';
                if (normalizedKey) {
                  resolved.syncKey = normalizedKey;
                  safeSetLocalStorage('bbs_persistent_sync_key', resolved.syncKey);
                  safeSetLocalStorage(STORAGE_KEYS.SETTINGS, JSON.stringify(resolved));

                  try {
                    chrome.storage.local.set({
                      [STORAGE_KEYS.SETTINGS]: resolved,
                      bbs_persistent_sync_key: resolved.syncKey
                    }, () => {});
                  } catch {}

                  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
                    try {
                      chrome.storage.sync.set({
                        bbs_sync_key: resolved.syncKey,
                        bbs_settings_backup: resolved
                      }, () => {});
                    } catch {}
                  }
                } else {
                  resolved.syncKey = generateUniqueSyncKey();
                  safeSetLocalStorage('bbs_persistent_sync_key', resolved.syncKey);
                  safeSetLocalStorage(STORAGE_KEYS.SETTINGS, JSON.stringify(resolved));
                  try {
                    chrome.storage.local.set({
                      [STORAGE_KEYS.SETTINGS]: resolved,
                      bbs_persistent_sync_key: resolved.syncKey
                    }, () => {});
                  } catch {}
                  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
                    try {
                      chrome.storage.sync.set({
                        bbs_sync_key: resolved.syncKey,
                        bbs_settings_backup: resolved
                      }, () => {});
                    } catch {}
                  }
                }

                resolve(resolved);
              };

              const localCandidate = normalizeRestoredSyncKey(
                resolved.syncKey || result?.bbs_persistent_sync_key || safeGetLocalStorage('bbs_persistent_sync_key')
              );

              if (localCandidate && (resolved.openRouterApiKey || resolved.ifmApiKey || resolved.customAiApiKey)) {
                resolveSyncKeyAndFinish(localCandidate);
                return;
              }

              // Check chrome.storage.sync to restore user account & private keys if extension was reinstalled or moved
              if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
                chrome.storage.sync.get(['bbs_sync_key', 'bbs_settings_backup'], (syncData: { [key: string]: any }) => {
                  const backup = syncData?.bbs_settings_backup as Partial<UserSettings> | undefined;
                  if (backup && typeof backup === 'object') {
                    if (!resolved.openRouterApiKey && backup.openRouterApiKey) {
                      resolved.openRouterApiKey = backup.openRouterApiKey;
                    }
                    // Other AI providers' keys come back too, along with the provider choice
                    if (!resolved.ifmApiKey && backup.ifmApiKey) resolved.ifmApiKey = backup.ifmApiKey;
                    // Same AI pass after a reinstall, so paired phones keep working
                    if (!resolved.aiPass && backup.aiPass) resolved.aiPass = backup.aiPass;
                    if (!resolved.customAiApiKey && backup.customAiApiKey) {
                      resolved.customAiApiKey = backup.customAiApiKey;
                      resolved.customAiBaseUrl = resolved.customAiBaseUrl || backup.customAiBaseUrl;
                      resolved.customAiModel = resolved.customAiModel || backup.customAiModel;
                    }
                    if ((!resolved.aiProvider || resolved.aiProvider === 'openrouter') && backup.aiProvider) {
                      resolved.aiProvider = backup.aiProvider;
                    }
                  }
                  const syncKey = normalizeRestoredSyncKey(
                    localCandidate || syncData?.bbs_sync_key || backup?.syncKey
                  );
                  if (syncKey) {
                    resolveSyncKeyAndFinish(syncKey);
                  } else {
                    resolveSyncKeyAndFinish(null);
                  }
                });
              } else {
                resolveSyncKeyAndFinish(localCandidate || null);
              }
            } catch {
              const raw = safeGetLocalStorage(STORAGE_KEYS.SETTINGS);
              let fallback = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
              const persistentKey = normalizeRestoredSyncKey(
                fallback.syncKey || safeGetLocalStorage('bbs_persistent_sync_key')
              );
              fallback.syncKey = persistentKey || DEFAULT_SETTINGS.syncKey || '';
              resolve(fallback);
            }
          });
        } catch {
          const raw = safeGetLocalStorage(STORAGE_KEYS.SETTINGS);
          let fallback = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
          const persistentKey = normalizeRestoredSyncKey(
            fallback.syncKey || safeGetLocalStorage('bbs_persistent_sync_key')
          );
          fallback.syncKey = persistentKey || DEFAULT_SETTINGS.syncKey || '';
          resolve(fallback);
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }

  const raw = safeGetLocalStorage(STORAGE_KEYS.SETTINGS);
  let resolved = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  const persistentKey = normalizeRestoredSyncKey(
    resolved.syncKey || safeGetLocalStorage('bbs_persistent_sync_key')
  );
  resolved.syncKey = persistentKey || generateUniqueSyncKey();
  if (resolved.syncKey) {
    safeSetLocalStorage('bbs_persistent_sync_key', resolved.syncKey);
  }
  safeSetLocalStorage(STORAGE_KEYS.SETTINGS, JSON.stringify(resolved));
  return resolved;
}

export async function saveSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  if (updated.syncKey) {
    updated.syncKey = normalizeRestoredSyncKey(updated.syncKey) || updated.syncKey.trim().toUpperCase();
  }
  safeSetLocalStorage(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
  if (updated.syncKey) {
    safeSetLocalStorage('bbs_persistent_sync_key', updated.syncKey);
  }

  if (isExtensionContextValid()) {
    try {
      await new Promise<void>(resolve => {
        try {
          const toSet: Record<string, unknown> = {
            [STORAGE_KEYS.SETTINGS]: updated,
            bbs_persistent_sync_key: updated.syncKey
          };
          if (typeof updated.blackboardDarkMode === 'boolean') {
            toSet.blackboardDarkMode = updated.blackboardDarkMode;
            toSet.darkModeEnabled = updated.blackboardDarkMode;
          }
          chrome.storage.local.set(toSet, () => resolve());
        } catch {
          resolve();
        }
      });

      // Synchronously back up settings and syncKey to chrome.storage.sync to survive reloads/uninstalls
      if (typeof chrome !== 'undefined' && chrome.storage?.sync && updated.syncKey) {
        try {
          chrome.storage.sync.set({
            bbs_sync_key: updated.syncKey,
            bbs_settings_backup: updated
          }, () => {});
        } catch {}
      }

      return updated;
    } catch {
      // Fall through to localStorage
    }
  }

  return updated;
}

export async function getTasks(): Promise<DeadlineTask[]> {
  if (isExtensionContextValid()) {
    try {
      return await new Promise<DeadlineTask[]>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.TASKS], (result: { [key: string]: any }) => {
            try {
              if (chrome.runtime?.lastError) {
                const raw = safeGetLocalStorage(STORAGE_KEYS.TASKS);
                resolve(raw ? sanitizeTaskListMarks(JSON.parse(raw)) : []);
                return;
              }
              const rawTasks = (result?.[STORAGE_KEYS.TASKS] as DeadlineTask[]) || [];
              const tasks = sanitizeTaskListMarks(rawTasks);
              if (tasks && tasks.length > 0) {
                safeSetLocalStorage(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
                if (JSON.stringify(tasks) !== JSON.stringify(rawTasks)) {
                  try {
                    chrome.storage.local.set({ [STORAGE_KEYS.TASKS]: tasks }, () => {});
                  } catch {}
                }
              }
              resolve(tasks);
            } catch {
              const raw = safeGetLocalStorage(STORAGE_KEYS.TASKS);
              resolve(raw ? sanitizeTaskListMarks(JSON.parse(raw)) : []);
            }
          });
        } catch {
          const raw = safeGetLocalStorage(STORAGE_KEYS.TASKS);
          resolve(raw ? sanitizeTaskListMarks(JSON.parse(raw)) : []);
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }

  const raw = safeGetLocalStorage(STORAGE_KEYS.TASKS);
  if (raw) {
    try {
      return sanitizeTaskListMarks(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Saves tasks without losing a newer copy that was saved meanwhile: a scan's marks while the
 * popup was busy, or a phone edit while a scan ran. Per task the newer updatedAt wins; tasks
 * only in storage are kept unless deleted (tombstoned) or junk. Returns what was saved.
 */
export async function saveTasksMergingLatest(tasks: DeadlineTask[]): Promise<DeadlineTask[]> {
  let stored: DeadlineTask[] = [];
  let tombstones: Record<string, string> = {};
  try {
    stored = await getTasks();
    if (isExtensionContextValid()) {
      const data = await chrome.storage.local.get(['bbs_tombstones']);
      tombstones = (data?.bbs_tombstones as Record<string, string>) || {};
    }
  } catch {}
  const { tasks: merged } = mergeCloudTasks(tasks, stored, tombstones);
  await saveTasks(merged);
  return merged;
}

export async function saveTasks(tasks: DeadlineTask[]): Promise<void> {
  safeSetLocalStorage(STORAGE_KEYS.TASKS, JSON.stringify(tasks));

  if (isExtensionContextValid()) {
    try {
      await new Promise<void>(resolve => {
        try {
          chrome.storage.local.set({ [STORAGE_KEYS.TASKS]: tasks }, () => {
            try {
              if (isExtensionContextValid()) {
                chrome.runtime?.sendMessage?.({ type: 'UPDATE_BADGE' }, () => {
                  if (chrome.runtime?.lastError) {
                    // Background worker may be inactive or sleeping; safely ignore
                  }
                });
              }
            } catch {
              // Context invalidated between set and message; ignore safely
            }
            resolve();
          });
        } catch {
          resolve();
        }
      });
      return;
    } catch {
      // Fall through to localStorage
    }
  }
}

export async function addTask(task: DeadlineTask): Promise<DeadlineTask[]> {
  const existing = await getTasks();
  const matchIdx = existing.findIndex(e => areTasksDuplicates(e, task));
  let updated: DeadlineTask[];
  if (matchIdx !== -1) {
    existing[matchIdx] = mergeDuplicatePair(existing[matchIdx], task);
    updated = existing;
  } else {
    updated = [task, ...existing];
  }
  updated = deduplicateTaskList(updated);
  await saveTasks(updated);
  return updated;
}

export async function updateTask(taskId: string, updates: Partial<DeadlineTask>): Promise<DeadlineTask[]> {
  const tasks = await getTasks();
  const updated = tasks.map(t => (t.id === taskId ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t));
  await saveTasks(updated);
  return updated;
}

export async function deleteTask(taskId: string): Promise<DeadlineTask[]> {
  const tasks = await getTasks();
  const updated = tasks.filter(t => t.id !== taskId);
  await saveTasks(updated);
  return updated;
}

export interface ScanCheckpoint {
  lastScannedAt: string;
  processedAnnouncementIds: string[];
  processedDirectTaskIds: string[];
  processedAnnouncementKeys?: string[];
}

export async function getLastScanCheckpoint(): Promise<ScanCheckpoint> {
  const fallback: ScanCheckpoint = {
    lastScannedAt: '',
    processedAnnouncementIds: [],
    processedDirectTaskIds: [],
    processedAnnouncementKeys: []
  };

  const parseCheckpoint = (stored: any): ScanCheckpoint => {
    if (stored && typeof stored === 'object') {
      return {
        lastScannedAt: stored.lastScannedAt || '',
        processedAnnouncementIds: Array.isArray(stored.processedAnnouncementIds) ? stored.processedAnnouncementIds : [],
        processedDirectTaskIds: Array.isArray(stored.processedDirectTaskIds) ? stored.processedDirectTaskIds : [],
        processedAnnouncementKeys: Array.isArray(stored.processedAnnouncementKeys) ? stored.processedAnnouncementKeys : []
      };
    }
    return fallback;
  };

  if (isExtensionContextValid()) {
    try {
      return await new Promise<ScanCheckpoint>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.LAST_SCANNED], (result: { [key: string]: any }) => {
            try {
              if (chrome.runtime?.lastError) {
                resolve(readLocalCheckpoint());
                return;
              }
              resolve(parseCheckpoint(result?.[STORAGE_KEYS.LAST_SCANNED]));
            } catch {
              resolve(readLocalCheckpoint());
            }
          });
        } catch {
          resolve(readLocalCheckpoint());
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }

  return readLocalCheckpoint();

  function readLocalCheckpoint(): ScanCheckpoint {
    const raw = safeGetLocalStorage(STORAGE_KEYS.LAST_SCANNED);
    if (raw) {
      try {
        return parseCheckpoint(JSON.parse(raw));
      } catch {
        // Fallback
      }
    }
    return fallback;
  }
}

export async function saveLastScanCheckpoint(checkpoint: Partial<ScanCheckpoint>): Promise<void> {
  const current = await getLastScanCheckpoint();
  const updated: ScanCheckpoint = {
    lastScannedAt: checkpoint.lastScannedAt || new Date().toISOString(),
    processedAnnouncementIds: Array.from(new Set([...current.processedAnnouncementIds, ...(checkpoint.processedAnnouncementIds || [])])).slice(-500),
    processedDirectTaskIds: Array.from(new Set([...current.processedDirectTaskIds, ...(checkpoint.processedDirectTaskIds || [])])).slice(-500),
    processedAnnouncementKeys: Array.from(new Set([...(current.processedAnnouncementKeys || []), ...(checkpoint.processedAnnouncementKeys || [])])).slice(-500)
  };

  if (isExtensionContextValid()) {
    try {
      await new Promise<void>(resolve => {
        try {
          chrome.storage.local.set({ [STORAGE_KEYS.LAST_SCANNED]: updated }, () => resolve());
        } catch {
          resolve();
        }
      });
      return;
    } catch {
      // Fall through to localStorage
    }
  }

  safeSetLocalStorage(STORAGE_KEYS.LAST_SCANNED, JSON.stringify(updated));
}

export async function getAnnouncements(): Promise<Announcement[]> {
  if (isExtensionContextValid()) {
    try {
      return await new Promise<Announcement[]>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.ANNOUNCEMENTS], (result: { [key: string]: any }) => {
            try {
              if (chrome.runtime?.lastError) {
                const raw = safeGetLocalStorage(STORAGE_KEYS.ANNOUNCEMENTS);
                resolve(raw ? JSON.parse(raw) : []);
                return;
              }
              resolve((result?.[STORAGE_KEYS.ANNOUNCEMENTS] as Announcement[]) || []);
            } catch {
              const raw = safeGetLocalStorage(STORAGE_KEYS.ANNOUNCEMENTS);
              resolve(raw ? JSON.parse(raw) : []);
            }
          });
        } catch {
          const raw = safeGetLocalStorage(STORAGE_KEYS.ANNOUNCEMENTS);
          resolve(raw ? JSON.parse(raw) : []);
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }

  const raw = safeGetLocalStorage(STORAGE_KEYS.ANNOUNCEMENTS);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return [];
}

export async function saveAnnouncements(newAnnouncements: Announcement[]): Promise<void> {
  const existing = await getAnnouncements();
  const map = new Map<string, Announcement>();
  for (const a of existing) {
    map.set(a.id, a);
  }
  for (const a of newAnnouncements) {
    map.set(a.id, a);
  }
  const merged = Array.from(map.values()).slice(-200);

  if (isExtensionContextValid()) {
    try {
      await new Promise<void>(resolve => {
        try {
          chrome.storage.local.set({ [STORAGE_KEYS.ANNOUNCEMENTS]: merged }, () => resolve());
        } catch {
          resolve();
        }
      });
      return;
    } catch {
      // Fall through to localStorage
    }
  }

  safeSetLocalStorage(STORAGE_KEYS.ANNOUNCEMENTS, JSON.stringify(merged));
}

function parseLinks(raw: string | null): QuickLink[] {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The student's quick links; empty until they add some or set a university that has built-in ones. */
export async function getQuickLinks(): Promise<QuickLink[]> {
  if (isExtensionContextValid()) {
    try {
      return await new Promise<QuickLink[]>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.QUICK_LINKS], (result: { [key: string]: any }) => {
            if (chrome.runtime?.lastError) {
              resolve(parseLinks(safeGetLocalStorage(STORAGE_KEYS.QUICK_LINKS)));
              return;
            }
            const links = result?.[STORAGE_KEYS.QUICK_LINKS];
            const resolved: QuickLink[] = Array.isArray(links) ? links : [];
            safeSetLocalStorage(STORAGE_KEYS.QUICK_LINKS, JSON.stringify(resolved));
            resolve(resolved);
          });
        } catch {
          resolve(parseLinks(safeGetLocalStorage(STORAGE_KEYS.QUICK_LINKS)));
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }
  return parseLinks(safeGetLocalStorage(STORAGE_KEYS.QUICK_LINKS));
}

/**
 * Saves the quick links. An edit here stamps them now; links taken from the cloud keep the cloud's
 * stamp, so the newer list wins on every device (see src/utils/syncMerge.ts).
 */
export async function saveQuickLinks(links: QuickLink[], updatedAt?: string): Promise<void> {
  const stamp = updatedAt || new Date().toISOString();
  safeSetLocalStorage(STORAGE_KEYS.QUICK_LINKS, JSON.stringify(links));
  safeSetLocalStorage(STORAGE_KEYS.QUICK_LINKS_UPDATED_AT, stamp);

  if (isExtensionContextValid()) {
    try {
      await new Promise<void>(resolve => {
        try {
          chrome.storage.local.set({ [STORAGE_KEYS.QUICK_LINKS]: links, [STORAGE_KEYS.QUICK_LINKS_UPDATED_AT]: stamp }, () => resolve());
        } catch {
          resolve();
        }
      });
      return;
    } catch {
      // Fall through to localStorage
    }
  }
}

export async function addQuickLink(newLink: Omit<QuickLink, 'id' | 'createdAt'>): Promise<QuickLink[]> {
  const existing = await getQuickLinks();
  let url = (newLink.url || '').trim();
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  const created: QuickLink = {
    ...newLink,
    url,
    id: `ql_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    createdAt: new Date().toISOString()
  };
  const updated = [...existing, created];
  await saveQuickLinks(updated);
  return updated;
}

export async function updateQuickLink(id: string, updates: Partial<QuickLink>): Promise<QuickLink[]> {
  const existing = await getQuickLinks();
  const updated = existing.map(l => {
    if (l.id !== id) return l;
    let url = updates.url !== undefined ? updates.url.trim() : l.url;
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    return {
      ...l,
      ...updates,
      url,
      updatedAt: new Date().toISOString()
    };
  });
  await saveQuickLinks(updated);
  return updated;
}

export async function deleteQuickLink(id: string): Promise<QuickLink[]> {
  const existing = await getQuickLinks();
  const updated = existing.filter(l => l.id !== id);
  await saveQuickLinks(updated);
  return updated;
}

/** Replaces the quick links with the university's built-in ones (none for most universities). */
export async function resetQuickLinksToDefault(universityId: string): Promise<QuickLink[]> {
  const links: QuickLink[] = universityQuickLinks(universityId, new Date().toISOString());
  await saveQuickLinks(links);
  return links;
}

// Lives in core so the phone app runs the same filter
export { filterCleanUserCourses };

export function getCachedCoursesSync(): UserCourseConfig[] {
  const raw = safeGetLocalStorage(STORAGE_KEYS.COURSES);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const clean = filterCleanUserCourses(parsed);
        setActiveUserCourses(clean);
        return clean;
      }
    } catch {}
  }
  return [];
}

export async function getUserCourses(): Promise<UserCourseConfig[]> {
  const finalizeAndClean = (courses: UserCourseConfig[]): UserCourseConfig[] => {
    const rawList = Array.isArray(courses) ? courses : [];
    const clean = filterCleanUserCourses(rawList);
    // If corrupted system tabs were found, automatically prune them from storage
    if (clean.length !== rawList.length) {
      getCoursesUpdatedAt().then(stamp => saveUserCourses(clean, stamp || undefined)).catch(() => {});
    } else {
      setActiveUserCourses(clean);
    }
    return clean;
  };

  if (isExtensionContextValid()) {
    try {
      return await new Promise<UserCourseConfig[]>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.COURSES], (result: { [key: string]: any }) => {
            try {
              if (chrome.runtime?.lastError) {
                const raw = safeGetLocalStorage(STORAGE_KEYS.COURSES);
                const courses = raw ? JSON.parse(raw) : [];
                resolve(finalizeAndClean(courses));
                return;
              }
              const courses = result?.[STORAGE_KEYS.COURSES];
              const resolved = Array.isArray(courses) ? courses : [];
              safeSetLocalStorage(STORAGE_KEYS.COURSES, JSON.stringify(resolved));
              resolve(finalizeAndClean(resolved));
            } catch {
              const raw = safeGetLocalStorage(STORAGE_KEYS.COURSES);
              const courses = raw ? JSON.parse(raw) : [];
              resolve(finalizeAndClean(courses));
            }
          });
        } catch {
          const raw = safeGetLocalStorage(STORAGE_KEYS.COURSES);
          const courses = raw ? JSON.parse(raw) : [];
          resolve(finalizeAndClean(courses));
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }

  const raw = safeGetLocalStorage(STORAGE_KEYS.COURSES);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return finalizeAndClean(parsed);
      }
    } catch {}
  }
  setActiveUserCourses([]);
  return [];
}

export async function getCoursesUpdatedAt(): Promise<string | null> {
  if (isExtensionContextValid()) {
    try {
      return await new Promise<string | null>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.COURSES_UPDATED_AT], (result: { [key: string]: any }) => {
            if (chrome.runtime?.lastError) {
              resolve(safeGetLocalStorage(STORAGE_KEYS.COURSES_UPDATED_AT));
              return;
            }
            const stamp = result?.[STORAGE_KEYS.COURSES_UPDATED_AT] || safeGetLocalStorage(STORAGE_KEYS.COURSES_UPDATED_AT);
            resolve(stamp || null);
          });
        } catch {
          resolve(safeGetLocalStorage(STORAGE_KEYS.COURSES_UPDATED_AT));
        }
      });
    } catch {
      // Fall through
    }
  }
  return safeGetLocalStorage(STORAGE_KEYS.COURSES_UPDATED_AT);
}

/** When the quick links were last changed on any device; null before the first change. */
export async function getQuickLinksUpdatedAt(): Promise<string | null> {
  if (isExtensionContextValid()) {
    try {
      return await new Promise<string | null>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.QUICK_LINKS_UPDATED_AT], (result: { [key: string]: any }) => {
            const stamp = (!chrome.runtime?.lastError && result?.[STORAGE_KEYS.QUICK_LINKS_UPDATED_AT]) || safeGetLocalStorage(STORAGE_KEYS.QUICK_LINKS_UPDATED_AT);
            resolve(stamp || null);
          });
        } catch {
          resolve(safeGetLocalStorage(STORAGE_KEYS.QUICK_LINKS_UPDATED_AT));
        }
      });
    } catch {
      // Fall through
    }
  }
  return safeGetLocalStorage(STORAGE_KEYS.QUICK_LINKS_UPDATED_AT);
}

export async function saveCoursesUpdatedAt(timestamp: string): Promise<void> {
  safeSetLocalStorage(STORAGE_KEYS.COURSES_UPDATED_AT, timestamp);
  if (isExtensionContextValid()) {
    try {
      await new Promise<void>(resolve => {
        try {
          chrome.storage.local.set({ [STORAGE_KEYS.COURSES_UPDATED_AT]: timestamp }, () => resolve());
        } catch {
          resolve();
        }
      });
    } catch {
      // Ignore
    }
  }
}

export async function saveUserCourses(courses: UserCourseConfig[], updatedAt?: string): Promise<void> {
  const safeCourses = Array.isArray(courses) ? courses : [];
  const stamp = updatedAt || new Date().toISOString();
  safeSetLocalStorage(STORAGE_KEYS.COURSES, JSON.stringify(safeCourses));
  safeSetLocalStorage(STORAGE_KEYS.COURSES_UPDATED_AT, stamp);
  setActiveUserCourses(safeCourses);

  if (isExtensionContextValid()) {
    try {
      await new Promise<void>(resolve => {
        try {
          chrome.storage.local.set({
            [STORAGE_KEYS.COURSES]: safeCourses,
            [STORAGE_KEYS.COURSES_UPDATED_AT]: stamp
          }, () => resolve());
        } catch {
          resolve();
        }
      });
      return;
    } catch {
      // Fall through
    }
  }
}

export async function resetUserCoursesToDefault(): Promise<UserCourseConfig[]> {
  await saveUserCourses(DEFAULT_USER_COURSES);
  return DEFAULT_USER_COURSES;
}

/**
 * Automatically registers newly discovered courses from scraped tasks or course lists into bbs_user_courses
 * if they do not already match any existing configured course, assigning vibrant unique palette colors.
 */
export async function autoRegisterDiscoveredCourses(
  tasksOrCourses: (DeadlineTask | { courseName?: string; courseCode?: string; colorHex?: string })[]
): Promise<UserCourseConfig[]> {
  const currentCourses = await getUserCourses();
  const palette = [
    '#2563eb', // Royal Blue
    '#dc2626', // Crimson Red
    '#059669', // Emerald Green
    '#d97706', // Amber Gold
    '#7c3aed', // Purple
    '#db2777', // Vivid Pink
    '#0891b2', // Cyan
    '#ea580c', // Orange
    '#4f46e5', // Indigo
    '#16a34a', // Leaf Green
    '#9333ea', // Deep Violet
    '#0284c7', // Sky Blue
    '#b91c1c', // Ruby
    '#0d9488', // Dark Teal
    '#c026d3', // Fuchsia
    '#65a30d'  // Lime
  ];

  let addedCount = 0;
  const updatedCourses = [...currentCourses];

  for (const item of tasksOrCourses) {
    let rawName = (item.courseName || '').trim();
    let rawCode = (item.courseCode || '').trim();

    // Reject Blackboard navigation tabs and system noise
    if (isBlackboardSystemNoise(rawName) || isBlackboardSystemNoise(rawCode)) continue;

    // Clean generic placeholder terms
    if (rawCode.toUpperCase() === 'UOS') rawCode = '';
    if (rawName.toLowerCase() === 'uos') rawName = '';
    if (rawName.toLowerCase() === 'general course') continue;
    if (!rawName && !rawCode) continue;

    // Require a valid academic course code before auto-registering any scraped item
    if (!hasValidAcademicCourseCode(rawCode)) continue;

    const normTargetCode = rawCode.replace(/[\s_-]+/g, '').toLowerCase();
    const tName = rawName.toLowerCase();

    // Check if item matches any existing course by normalized code, name, or alias
    const exists = updatedCourses.some(c => {
      const cCodeNorm = (c.courseCode || '').replace(/[\s_-]+/g, '').toLowerCase();
      const cName = (c.courseName || '').trim().toLowerCase();

      if (cCodeNorm && normTargetCode && cCodeNorm === normTargetCode) return true;
      if (cName && tName && (cName === tName || tName.includes(cName) || cName.includes(tName))) return true;
      if (Array.isArray(c.aliases)) {
        return c.aliases.some(a => {
          const cleanA = a.trim().toLowerCase();
          const normA = cleanA.replace(/[\s_-]+/g, '');
          return cleanA && (
            (tName && tName.includes(cleanA)) ||
            (normTargetCode && normA && normTargetCode === normA)
          );
        });
      }
      return false;
    });

    if (!exists) {
      // Blackboard's own colour for the course when the scan read it, otherwise the next unused palette colour
      const usedColors = new Set(updatedCourses.map(c => c.colorHex?.toLowerCase()));
      const availableColors = palette.filter(hex => !usedColors.has(hex.toLowerCase()));
      const blackboardColor = (item as { colorHex?: string }).colorHex;
      const nextColor = typeof blackboardColor === 'string' && /^#[0-9a-f]{6}$/i.test(blackboardColor)
        ? blackboardColor.toLowerCase()
        : availableColors.length > 0
        ? availableColors[Math.floor(Math.random() * availableColors.length)]
        : palette[Math.floor(Math.random() * palette.length)];

      const id = 'course_' + (rawCode || rawName).toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 20) + '_' + Math.random().toString(36).substring(2, 6);

      const newCourse: UserCourseConfig = {
        id,
        courseCode: rawCode || rawName,
        courseName: rawName || rawCode,
        colorHex: nextColor,
        aliases: rawCode && rawName && rawCode !== rawName ? [rawCode, rawName] : [rawCode || rawName],
        scheduleSlots: [],
        syllabus: []
      };

      updatedCourses.push(newCourse);
      addedCount++;
    }
  }

  if (addedCount > 0) {
    await saveUserCourses(updatedCourses);
  }

  return updatedCourses;
}


export async function recalculateTasksWithActiveCourses(): Promise<DeadlineTask[]> {
  const tasks = await getTasks();
  let changed = false;

  const updatedTasks = tasks.map(task => {
    // Tasks the student made or edited keep their own values
    if (task.userEdited || task.extractedBy === 'manual') return task;

    // 1. Recalculate syllabus weight
    const resolvedWeight = resolveTaskWeight(task);
    let newWeight = task.weight;
    let newWeightDisplay = task.weightDisplay;

    if (resolvedWeight.weight !== undefined) {
      newWeight = resolvedWeight.weight;
      newWeightDisplay = resolvedWeight.weightDisplay;
    }

    // 2. Room recalculation (only if user hasn't manually edited the task)
    let newRoom = task.room;
    if (!task.userEdited) {
      const roomRes = resolveTaskRoom({
        courseNameOrCode: task.courseName || task.courseCode,
        announcementText: task.description || task.sourceSnippet || '',
        title: task.title,
        type: task.type,
        // Keep a sensible saved room; only an announced room in the text replaces it
        existingRoom: task.room
      });
      if (roomRes.room) {
        newRoom = roomRes.room;
      }
    }

    // 3. Time recalculation if no specific time was provided
    let newDueDate = task.dueDate;
    let newHasSpecificTime = task.hasSpecificTime;
    if (!task.userEdited && task.hasSpecificTime === false && task.dueDate) {
      const timeRes = resolveTaskTimeWithSchedule({
        dueDate: new Date(task.dueDate),
        courseNameOrCode: task.courseName || task.courseCode,
        hasSpecificTime: false,
        announcementText: task.description || task.sourceSnippet || '',
        title: task.title
      });
      if (timeRes.appliedSchedule) {
        newDueDate = timeRes.dueDate.toISOString();
        newHasSpecificTime = true;
      }
    }

    if (
      newWeight !== task.weight ||
      newWeightDisplay !== task.weightDisplay ||
      newRoom !== task.room ||
      newDueDate !== task.dueDate ||
      newHasSpecificTime !== task.hasSpecificTime
    ) {
      changed = true;
      return {
        ...task,
        weight: newWeight,
        weightDisplay: newWeightDisplay,
        room: newRoom,
        dueDate: newDueDate,
        hasSpecificTime: newHasSpecificTime,
        updatedAt: new Date().toISOString()
      };
    }
    return task;
  });

  if (changed) {
    await saveTasks(updatedTasks);
  }
  return updatedTasks;
}

// ============================================================================
// Scan status: written by the scan in the Blackboard tab, read by the popup.
// The scan outlives the popup, so the popup shows progress from here when reopened.
// ============================================================================
export const SCAN_STATUS_KEY = 'bbs_scan_status';

export interface ScanStatus {
  state: 'running' | 'done' | 'error';
  message: string;
  done?: number;
  total?: number;
  newCount?: number;
  updatedAt: string;
}

/** A running status older than this is from a scan that died (tab closed or reloaded). */
export const SCAN_STALE_MS = 10 * 60 * 1000;

export async function setScanStatus(status: Omit<ScanStatus, 'updatedAt'>): Promise<void> {
  if (!isExtensionContextValid()) return;
  try {
    await chrome.storage.local.set({ [SCAN_STATUS_KEY]: { ...status, updatedAt: new Date().toISOString() } });
  } catch {}
}

export async function getScanStatus(): Promise<ScanStatus | null> {
  if (!isExtensionContextValid()) return null;
  try {
    const res = await chrome.storage.local.get([SCAN_STATUS_KEY]);
    return (res?.[SCAN_STATUS_KEY] as ScanStatus) || null;
  } catch {
    return null;
  }
}

// Automatically sync cached courses into active state on module load
try {
  const cachedInitialCourses = getCachedCoursesSync();
  if (Array.isArray(cachedInitialCourses) && cachedInitialCourses.length > 0) {
    setActiveUserCourses(cachedInitialCourses);
  }
} catch {}

