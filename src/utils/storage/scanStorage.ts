import { Announcement } from '../../types';
import {
  STORAGE_KEYS,
  isExtensionContextValid,
  safeGetLocalStorage,
  safeSetLocalStorage,
} from './env';

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

  const readLocalCheckpoint = (): ScanCheckpoint => {
    const raw = safeGetLocalStorage(STORAGE_KEYS.LAST_SCANNED);
    if (raw) {
      try {
        return parseCheckpoint(JSON.parse(raw));
      } catch {
        // Fallback
      }
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

function readLocalAnnouncements(): Announcement[] {
  const raw = safeGetLocalStorage(STORAGE_KEYS.ANNOUNCEMENTS);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function getAnnouncements(): Promise<Announcement[]> {
  if (isExtensionContextValid()) {
    try {
      return await new Promise<Announcement[]>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.ANNOUNCEMENTS], (result: { [key: string]: any }) => {
            try {
              if (chrome.runtime?.lastError) {
                resolve(readLocalAnnouncements());
                return;
              }
              resolve((result?.[STORAGE_KEYS.ANNOUNCEMENTS] as Announcement[]) || []);
            } catch {
              resolve(readLocalAnnouncements());
            }
          });
        } catch {
          resolve(readLocalAnnouncements());
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }

  return readLocalAnnouncements();
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
