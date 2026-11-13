import { QuickLink } from '../../types';
import { universityQuickLinks } from '../../core/universities';
import { reorderQuickLinksList } from '../quickLinkMeta';
import {
  STORAGE_KEYS,
  isExtensionContextValid,
  safeGetLocalStorage,
  safeSetLocalStorage,
} from './env';

function parseLinks(raw: string | null): QuickLink[] {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getCachedQuickLinksSync(): QuickLink[] {
  return parseLinks(safeGetLocalStorage(STORAGE_KEYS.QUICK_LINKS));
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

export async function moveQuickLink(id: string, direction: 'up' | 'down'): Promise<QuickLink[]> {
  const existing = await getQuickLinks();
  const index = existing.findIndex(l => l.id === id);
  if (index === -1) return existing;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= existing.length) return existing;
  const updated = reorderQuickLinksList(existing, index, targetIndex);
  await saveQuickLinks(updated);
  return updated;
}

export async function reorderQuickLinks(orderedIds: string[]): Promise<QuickLink[]> {
  const existing = await getQuickLinks();
  const map = new Map(existing.map(l => [l.id, l]));
  const reordered: QuickLink[] = [];
  for (const id of orderedIds) {
    const item = map.get(id);
    if (item) {
      reordered.push(item);
      map.delete(id);
    }
  }
  for (const remaining of map.values()) {
    reordered.push(remaining);
  }
  await saveQuickLinks(reordered);
  return reordered;
}

/** Replaces the quick links with the university's built-in ones (none for most universities). */
export async function resetQuickLinksToDefault(universityId: string): Promise<QuickLink[]> {
  const links: QuickLink[] = universityQuickLinks(universityId, new Date().toISOString());
  await saveQuickLinks(links);
  return links;
}
