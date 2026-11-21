import type { StudentProfile } from '../types';
import { profileUniversity } from '../core/studentProfile';

/**
 * Blackboard addresses the student added (universities whose Blackboard is not on a
 * *.blackboard.com or built-in university address). The browser asks for permission to that one site; the
 * service worker then runs the scraper and dark mode there like on the built-in addresses.
 */

export const EXTRA_SITES_KEY = 'bbs_extra_blackboard_origins';
export const EXTRA_SCRIPT_IDS = ['bbs-extra-dark', 'bbs-extra-scraper'];

/** Addresses the manifest already covers; adding them again is not needed. */
const BUILT_IN = /(^|\.)(sharjah\.ac\.ae|blackboard\.com|uaeu\.ac\.ae|adu\.ac\.ae|zu\.ac\.ae|aud\.edu|aus\.edu|aurak\.ac\.ae|buid\.ac\.ae)$/i;

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

/**
 * True when an HTTPS URL appears to belong to a Blackboard Learn portal (built-in host,
 * Blackboard Ultra/Classic path, or Blackboard subdomain) and is not a Banner exam/finance portal.
 */
export function isLikelyBlackboardUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (/banner|studentexampage|tahseel|finance|payment/i.test(host + path)) return false;
  if (/^\/(?:ultra|webapps)(?:\/|$)/.test(path)) return true;
  if ((!host.includes('blackboarder') && host.includes('blackboard')) || host.startsWith('learn.') || host.startsWith('ilearn.') || host.startsWith('elearning.') || host.startsWith('bb.') || host.startsWith('lms.')) {
    return true;
  }
  return isBuiltInBlackboardHost(host) && !host.startsWith('www.');
}

/**
 * Resolves the Blackboard URL to open in a browser tab for the active profile.
 * Never falls back to University of Sharjah when the student picked "Other university".
 */
export async function resolveBlackboardLaunchUrl(profile: StudentProfile | null | undefined): Promise<string | null> {
  const uni = profileUniversity(profile);
  if (uni.blackboardUrl) return uni.blackboardUrl;
  const extra = await getExtraSites().catch(() => []);
  if (extra.length > 0) return `${extra[0]}/ultra/stream`;
  return null;
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
