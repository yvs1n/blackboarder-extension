export const STORAGE_KEYS = {
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

const memoryStorage = new Map<string, string>();

function canUseLocalStorage(): boolean {
  try {
    const hasLocalStorage = typeof localStorage !== 'undefined';
    if (!hasLocalStorage) return false;

    if (typeof window !== 'undefined') {
      // Do not read/write host webpage localStorage when running as a content script.
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

export function safeGetLocalStorage(key: string): string | null {
  try {
    if (canUseLocalStorage()) {
      return localStorage.getItem(key);
    }
  } catch {
    // Ignore storage access errors (e.g. iframe sandbox)
  }
  return memoryStorage.get(key) || null;
}

export function safeSetLocalStorage(key: string, value: string): void {
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
