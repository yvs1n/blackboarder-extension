import { UserSettings, DEFAULT_SETTINGS, SharedPreferences } from '../../types';
import {
  CalendarFeedShowPreference,
  SHARED_SETTING_KEYS,
  extractSharedPreferencesFromSettings,
  sanitizeSharedPreferences,
  sharedPreferencesToSettingsPatch,
} from '../../core/sharedPreferences';
import {
  STORAGE_KEYS,
  isExtensionContextValid,
  normalizeRestoredSyncKey,
  safeGetLocalStorage,
  safeSetLocalStorage,
} from './env';

export const PREFERENCES_UPDATED_AT_KEY = 'bbs_preferences_updated_at';
export const CALENDAR_FEED_SHOW_KEY = 'bbs_calendar_feed_show';

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

function readLocalSettingsFallback(): UserSettings {
  const raw = safeGetLocalStorage(STORAGE_KEYS.SETTINGS);
  const fallback: UserSettings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  const persistentKey = normalizeRestoredSyncKey(
    fallback.syncKey || safeGetLocalStorage('bbs_persistent_sync_key')
  );
  fallback.syncKey = persistentKey || DEFAULT_SETTINGS.syncKey || '';
  return fallback;
}

function persistResolvedSettings(resolved: UserSettings): void {
  const syncKey = resolved.syncKey || '';
  safeSetLocalStorage('bbs_persistent_sync_key', syncKey);
  safeSetLocalStorage(STORAGE_KEYS.SETTINGS, JSON.stringify(resolved));

  try {
    chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: resolved,
      bbs_persistent_sync_key: syncKey
    }, () => {});
  } catch {}

  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    try {
      chrome.storage.sync.set({
        bbs_sync_key: syncKey,
        bbs_settings_backup: resolved
      }, () => {});
    } catch {}
  }
}

export async function getSettings(): Promise<UserSettings> {
  if (isExtensionContextValid()) {
    try {
      return await new Promise<UserSettings>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.SETTINGS, 'bbs_persistent_sync_key'], (result: { [key: string]: any }) => {
            try {
              const stored = result?.[STORAGE_KEYS.SETTINGS];
              const resolved = stored && typeof stored === 'object'
                ? { ...DEFAULT_SETTINGS, ...stored }
                : { ...DEFAULT_SETTINGS };

              const resolveSyncKeyAndFinish = (keyToUse: string | null) => {
                const normalizedKey = normalizeRestoredSyncKey(keyToUse || resolved.syncKey) || DEFAULT_SETTINGS.syncKey || '';
                resolved.syncKey = normalizedKey || generateUniqueSyncKey();
                persistResolvedSettings(resolved);
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
                  resolveSyncKeyAndFinish(syncKey || null);
                });
              } else {
                resolveSyncKeyAndFinish(localCandidate || null);
              }
            } catch {
              resolve(readLocalSettingsFallback());
            }
          });
        } catch {
          resolve(readLocalSettingsFallback());
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }

  const raw = safeGetLocalStorage(STORAGE_KEYS.SETTINGS);
  const resolved = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
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

export interface SaveSettingsOptions {
  skipPreferenceStamp?: boolean;
  preferencesUpdatedAt?: string;
}

export async function getPreferencesUpdatedAt(): Promise<string | null> {
  if (isExtensionContextValid()) {
    try {
      const res = await chrome.storage.local.get([PREFERENCES_UPDATED_AT_KEY]);
      const v = res?.[PREFERENCES_UPDATED_AT_KEY];
      if (typeof v === 'string' && v) return v;
    } catch {}
  }
  const local = safeGetLocalStorage(PREFERENCES_UPDATED_AT_KEY);
  return local || null;
}

export async function savePreferencesUpdatedAt(iso: string): Promise<void> {
  safeSetLocalStorage(PREFERENCES_UPDATED_AT_KEY, iso);
  if (isExtensionContextValid()) {
    try {
      await chrome.storage.local.set({ [PREFERENCES_UPDATED_AT_KEY]: iso });
    } catch {}
  }
}

export async function getCalendarFeedShow(): Promise<CalendarFeedShowPreference> {
  if (isExtensionContextValid()) {
    try {
      const res = await chrome.storage.local.get([CALENDAR_FEED_SHOW_KEY]);
      const v = res?.[CALENDAR_FEED_SHOW_KEY];
      if (v === 'deadlines' || v === 'classes' || v === 'both') return v;
    } catch {}
  }
  const local = safeGetLocalStorage(CALENDAR_FEED_SHOW_KEY);
  return local === 'deadlines' || local === 'classes' || local === 'both' ? local : 'both';
}

export async function saveCalendarFeedShow(
  show: CalendarFeedShowPreference,
  updatedAt?: string
): Promise<void> {
  const clean: CalendarFeedShowPreference = show === 'deadlines' || show === 'classes' || show === 'both' ? show : 'both';
  const prev = await getCalendarFeedShow();
  safeSetLocalStorage(CALENDAR_FEED_SHOW_KEY, clean);
  const stamp = updatedAt || (prev !== clean ? new Date().toISOString() : undefined);
  if (isExtensionContextValid()) {
    try {
      const toSet: Record<string, unknown> = { [CALENDAR_FEED_SHOW_KEY]: clean };
      if (stamp) toSet[PREFERENCES_UPDATED_AT_KEY] = stamp;
      await chrome.storage.local.set(toSet);
    } catch {}
  }
  if (stamp) safeSetLocalStorage(PREFERENCES_UPDATED_AT_KEY, stamp);
}

export async function getLocalSharedPreferences(): Promise<SharedPreferences> {
  const [settings, calShow, updatedAt] = await Promise.all([
    getSettings(),
    getCalendarFeedShow(),
    getPreferencesUpdatedAt()
  ]);
  return extractSharedPreferencesFromSettings(settings, calShow, updatedAt);
}

export async function applyCloudSharedPreferences(
  cloudRaw: unknown
): Promise<{ applied: boolean; changedFields: string[]; preferences?: SharedPreferences }> {
  const cloud = sanitizeSharedPreferences(cloudRaw);
  if (!cloud) return { applied: false, changedFields: [] };
  const [current, localUpdatedAt, localCalShow] = await Promise.all([
    getSettings(),
    getPreferencesUpdatedAt(),
    getCalendarFeedShow()
  ]);
  const cloudMs = cloud.updatedAt ? Date.parse(cloud.updatedAt) : 0;
  const localMs = localUpdatedAt ? Date.parse(localUpdatedAt) : 0;
  // Never overwrite explicit newer local preference choices
  if (localMs > 0 && cloudMs <= localMs) {
    return { applied: false, changedFields: [] };
  }
  // If local has an explicit choice with no cloud stamp yet, only take cloud when local wasn't stamped
  if (!cloud.updatedAt && localMs > 0) {
    return { applied: false, changedFields: [] };
  }

  const patch = sharedPreferencesToSettingsPatch(cloud);
  const changedFields: string[] = [];
  for (const key of SHARED_SETTING_KEYS) {
    if (patch[key] !== undefined && (current as any)[key] !== (patch as any)[key]) {
      changedFields.push(String(key));
    }
  }
  if (cloud.calendarFeedShow && cloud.calendarFeedShow !== localCalShow) {
    changedFields.push('calendarFeedShow');
    await saveCalendarFeedShow(cloud.calendarFeedShow, cloud.updatedAt || new Date().toISOString());
  }
  const stampToStore = cloud.updatedAt || (changedFields.length > 0 ? new Date().toISOString() : undefined);
  if (Object.keys(patch).length > 0) {
    await saveSettings(patch, {
      skipPreferenceStamp: true,
      ...(stampToStore ? { preferencesUpdatedAt: stampToStore } : {})
    });
  } else if (stampToStore) {
    await savePreferencesUpdatedAt(stampToStore);
  }
  return { applied: changedFields.length > 0, changedFields, preferences: cloud };
}

export async function saveSettings(
  settings: Partial<UserSettings>,
  options?: SaveSettingsOptions
): Promise<UserSettings> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  if (updated.syncKey) {
    updated.syncKey = normalizeRestoredSyncKey(updated.syncKey) || updated.syncKey.trim().toUpperCase();
  }
  safeSetLocalStorage(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
  if (updated.language === 'ar' || updated.language === 'en') {
    safeSetLocalStorage('bbs_lang', updated.language);
  }
  if (updated.theme) {
    safeSetLocalStorage('bbs_theme', updated.theme);
  }
  if (updated.syncKey) {
    safeSetLocalStorage('bbs_persistent_sync_key', updated.syncKey);
  }

  const sharedFieldChanged = SHARED_SETTING_KEYS.some(
    k => Object.prototype.hasOwnProperty.call(settings, k) && (current as any)[k] !== (updated as any)[k]
  );
  const nextPrefStamp = options?.preferencesUpdatedAt
    || (!options?.skipPreferenceStamp && sharedFieldChanged ? new Date().toISOString() : undefined);
  if (nextPrefStamp) {
    safeSetLocalStorage(PREFERENCES_UPDATED_AT_KEY, nextPrefStamp);
  }

  if (isExtensionContextValid()) {
    try {
      await new Promise<void>(resolve => {
        try {
          const toSet: Record<string, unknown> = {
            [STORAGE_KEYS.SETTINGS]: updated,
            bbs_persistent_sync_key: updated.syncKey
          };
          if (nextPrefStamp) {
            toSet[PREFERENCES_UPDATED_AT_KEY] = nextPrefStamp;
          }
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
