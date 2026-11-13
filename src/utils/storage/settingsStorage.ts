import { UserSettings, DEFAULT_SETTINGS } from '../../types';
import {
  STORAGE_KEYS,
  isExtensionContextValid,
  normalizeRestoredSyncKey,
  safeGetLocalStorage,
  safeSetLocalStorage,
} from './env';

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
