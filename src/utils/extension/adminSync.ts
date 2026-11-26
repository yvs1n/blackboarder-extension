import { BUILD_INFO } from '../../buildInfo';
import {
  filterVisibleAnnouncements,
  localizeAdminAnnouncement,
  type AdminAnnouncement,
  type PublicAdminSnapshot
} from '../../core/adminBroadcasts';
import type { UiLanguage } from '../../types';

export const ADMIN_FEED_URL = 'https://blackboarder.pages.dev/api/announcements';
export const ADMIN_CACHE_KEY = 'bbs_admin_state_cache';
export const ADMIN_DISMISSED_KEY = 'bbs_admin_dismissed_ids';
export const ADMIN_NOTIFIED_KEY = 'bbs_admin_notified_ids';
export const ADMIN_SYNC_INTERVAL_MS = 15 * 60 * 1000;

export interface CachedAdminState {
  fetchedAt: number;
  snapshot: PublicAdminSnapshot;
}

export async function getCachedAdminState(): Promise<CachedAdminState | null> {
  try {
    const res = await chrome.storage.local.get([ADMIN_CACHE_KEY]);
    const raw = res?.[ADMIN_CACHE_KEY] as CachedAdminState | undefined;
    if (raw && typeof raw.fetchedAt === 'number' && raw.snapshot && Array.isArray(raw.snapshot.announcements)) {
      return raw;
    }
  } catch {}
  return null;
}

export async function getDismissedAdminIds(): Promise<string[]> {
  try {
    const res = await chrome.storage.local.get([ADMIN_DISMISSED_KEY]);
    const list = res?.[ADMIN_DISMISSED_KEY];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function dismissAdminAnnouncement(id: string): Promise<string[]> {
  const existing = await getDismissedAdminIds();
  if (existing.includes(id)) return existing;
  const next = [...existing, id].slice(-200);
  try {
    await chrome.storage.local.set({ [ADMIN_DISMISSED_KEY]: next });
  } catch {}
  return next;
}

export async function syncAdminState(force = false): Promise<PublicAdminSnapshot | null> {
  const cached = await getCachedAdminState();
  if (!force && cached && Date.now() - cached.fetchedAt < ADMIN_SYNC_INTERVAL_MS) {
    return cached.snapshot;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(ADMIN_FEED_URL, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return cached?.snapshot || null;
    const data = (await res.json().catch(() => null)) as (PublicAdminSnapshot & { ok?: boolean }) | null;
    if (!data || !Array.isArray(data.announcements)) return cached?.snapshot || null;
    const snapshot: PublicAdminSnapshot = {
      v: data.v,
      generatedAt: data.generatedAt,
      announcements: data.announcements,
      serviceStatus: data.serviceStatus,
      remoteConfig: data.remoteConfig,
      signature: data.signature,
      sigAlg: data.sigAlg
    };
    await chrome.storage.local.set({
      [ADMIN_CACHE_KEY]: { fetchedAt: Date.now(), snapshot }
    }).catch(() => {});
    return snapshot;
  } catch {
    return cached?.snapshot || null;
  } finally {
    clearTimeout(timer);
  }
}

export async function notifyPendingAdminAnnouncements(
  snapshot: PublicAdminSnapshot | null,
  options: { lang?: UiLanguage; universityId?: string } = {}
): Promise<AdminAnnouncement[]> {
  if (!snapshot || typeof chrome === 'undefined' || !chrome.notifications?.create) return [];
  const dismissed = await getDismissedAdminIds();
  const visible = filterVisibleAnnouncements(
    snapshot,
    {
      surface: 'extension',
      version: BUILD_INFO.version,
      universityId: options.universityId
    },
    dismissed
  ).filter(item => item.sendPush);

  if (visible.length === 0) return [];

  let notified: Record<string, number> = {};
  try {
    const stored = await chrome.storage.local.get([ADMIN_NOTIFIED_KEY]);
    const raw = stored?.[ADMIN_NOTIFIED_KEY];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) notified = { ...raw };
  } catch {}

  const sentNow: AdminAnnouncement[] = [];
  const now = Date.now();
  for (const item of visible) {
    if (notified[item.id]) continue;
    const copy = localizeAdminAnnouncement(item, options.lang || 'en');
    try {
      chrome.notifications.create(`bbs_admin_${item.id}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: copy.title,
        message: copy.body,
        priority: item.priority === 'critical' ? 2 : 1
      });
      notified[item.id] = now;
      sentNow.push(item);
    } catch {}
  }

  if (sentNow.length > 0) {
    // Prune entries older than 60 days so local storage stays bounded
    const cutoff = now - 60 * 86400 * 1000;
    for (const [k, ts] of Object.entries(notified)) {
      if (typeof ts !== 'number' || ts < cutoff) delete notified[k];
    }
    await chrome.storage.local.set({ [ADMIN_NOTIFIED_KEY]: notified }).catch(() => {});
  }
  return sentNow;
}
