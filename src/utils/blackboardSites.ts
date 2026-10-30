/**
 * Blackboard addresses the student added (universities whose Blackboard is not on a
 * *.blackboard.com or UOS address). The browser asks for permission to that one site; the
 * service worker then runs the scraper and dark mode there like on the built-in addresses.
 */

export const EXTRA_SITES_KEY = 'bbs_extra_blackboard_origins';
export const EXTRA_SCRIPT_IDS = ['bbs-extra-dark', 'bbs-extra-scraper'];

/** Addresses the manifest already covers; adding them again is not needed. */
const BUILT_IN = /(^|\.)(sharjah\.ac\.ae|blackboard\.com|uaeu\.ac\.ae|adu\.ac\.ae|zu\.ac\.ae|aud\.edu|aus\.edu|aurak\.ac\.ae)$/i;

/**
 * "lms.example.edu/ultra/course" or "https://lms.example.edu" to "https://lms.example.edu".
 * Null for anything that is not a plain https web address.
 */
export function normalizeBlackboardOrigin(input: string): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.endsWith('.')) return null;
  return `https://${host}`;
}

export function isBuiltInBlackboardHost(hostname: string): boolean {
  return BUILT_IN.test(hostname || '');
}

export function originPattern(origin: string): string {
  return `${origin}/*`;
}

export async function getExtraSites(): Promise<string[]> {
  try {
    const res = await chrome.storage.local.get([EXTRA_SITES_KEY]);
    const list = res?.[EXTRA_SITES_KEY];
    return Array.isArray(list) ? list.filter((o: unknown) => typeof o === 'string' && normalizeBlackboardOrigin(o) === o) : [];
  } catch {
    return [];
  }
}

export async function saveExtraSites(origins: string[]): Promise<void> {
  const clean = [...new Set(origins.map(o => normalizeBlackboardOrigin(o)).filter((o): o is string => !!o))];
  await chrome.storage.local.set({ [EXTRA_SITES_KEY]: clean });
}

/**
 * Registers the scraper and dark mode on every added address the browser allowed. Run by the
 * service worker on start and whenever the list or the permissions change.
 */
export async function registerExtraSiteScripts(): Promise<string[]> {
  if (!chrome.scripting?.registerContentScripts) return [];
  const origins = await getExtraSites();
  const allowed: string[] = [];
  for (const origin of origins) {
    try {
      if (await chrome.permissions.contains({ origins: [originPattern(origin)] })) allowed.push(origin);
    } catch {}
  }
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: EXTRA_SCRIPT_IDS });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map(s => s.id) });
  } catch {}
  if (!allowed.length) return [];
  const matches = allowed.map(originPattern);
  try {
    await chrome.scripting.registerContentScripts([
      { id: 'bbs-extra-dark', matches, js: ['blackboard-dark.js'], css: ['blackboard-dark.css'], runAt: 'document_start', allFrames: true, persistAcrossSessions: true },
      { id: 'bbs-extra-scraper', matches, js: ['content.js'], css: ['content.css'], runAt: 'document_idle', persistAcrossSessions: true }
    ]);
  } catch (err) {
    console.error('[Sites] Could not register Blackboard sites:', err);
  }
  return allowed;
}
