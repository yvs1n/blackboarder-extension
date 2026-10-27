import { UserSettings } from '../types';
import { DEFAULT_OPENROUTER_MODEL, IFM_MODEL } from '../engine/aiProviders';
import { getSettings, saveSettings } from './storage';

/**
 * Hands the extension's AI key to the student's own Blackboarder server, which stores it encrypted
 * (see "AI key locker" in mobile-web/_worker.js). The web app then reaches the same model through
 * that server without ever holding the key. Only sent again when something changed.
 */
export const AI_LOCK_STATE_KEY = 'bbs_ai_lock';
const RESEND_AFTER_MS = 24 * 60 * 60 * 1000;

export type AiLockStatus = 'locked' | 'cleared' | 'server-off' | 'unsupported' | 'no-sync' | 'error';

export interface AiLockState {
  fingerprint: string;
  status: AiLockStatus;
  at: string;
}

type LockSettings = Pick<
  UserSettings,
  'useAiExtraction' | 'aiProvider' | 'openRouterApiKey' | 'openRouterModel' | 'ifmApiKey' |
  'customAiApiKey' | 'customAiBaseUrl' | 'customAiModel' | 'syncKey' | 'aiPass'
>;

/**
 * The AI pass: random, made by the extension, and given to phones only inside the pairing link
 * (after "#", so it never reaches a server log). The server keeps just its hash and runs the AI
 * only for requests that carry it, so the sync key alone cannot spend the student's AI credit.
 */
export function newAiPass(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The extension's AI pass, made on first use. */
export async function ensureAiPass(): Promise<string> {
  const settings = await getSettings();
  if (settings.aiPass && /^[A-Za-z0-9_-]{32,128}$/.test(settings.aiPass)) return settings.aiPass;
  const aiPass = newAiPass();
  await saveSettings({ aiPass });
  return aiPass;
}

/** The phone pairing link: the sync key in the query, the AI pass after "#". */
export function pairingLink(appBase: string, syncKey: string, aiPass?: string): string {
  if (!syncKey) return appBase;
  return `${appBase}?key=${encodeURIComponent(syncKey)}${aiPass ? `#ai=${aiPass}` : ''}`;
}

/** What the server should hold: the picked provider's key and model, or nothing when AI is off. */
export function aiLockRequest(settings: Partial<LockSettings>) {
  const provider = settings.aiProvider || 'openrouter';
  const key = !settings.useAiExtraction ? ''
    : provider === 'ifm' ? settings.ifmApiKey
    : provider === 'custom' ? settings.customAiApiKey
    : settings.openRouterApiKey;
  const model = provider === 'ifm' ? IFM_MODEL
    : provider === 'custom' ? (settings.customAiModel || '')
    : (settings.openRouterModel || DEFAULT_OPENROUTER_MODEL);
  return {
    syncKey: (settings.syncKey || '').trim(),
    provider,
    apiKey: (key || '').trim(),
    model,
    baseUrl: provider === 'custom' ? (settings.customAiBaseUrl || '') : '',
    aiPass: settings.aiPass || ''
  };
}

export function aiLockServerUrl(): string {
  return 'https://blackboarder.pages.dev/api/ai/key';
}

async function fingerprintOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function readState(): Promise<AiLockState | null> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get([AI_LOCK_STATE_KEY], r => resolve((r?.[AI_LOCK_STATE_KEY] as AiLockState) || null));
    } catch {
      resolve(null);
    }
  });
}

function writeState(state: AiLockState): Promise<void> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.set({ [AI_LOCK_STATE_KEY]: state }, () => resolve());
    } catch {
      resolve();
    }
  });
}

export async function getAiLockState(): Promise<AiLockState | null> {
  return readState();
}

/** Sends the key to the server when the settings differ from the last successful send. */
export async function syncAiKeyLock(settings: Partial<LockSettings>, force = false): Promise<AiLockStatus> {
  const request = aiLockRequest(settings);
  const url = aiLockServerUrl();
  if (!request.syncKey) return 'no-sync';

  // The fingerprint is a one-way hash; the key itself is never kept anywhere new
  const fingerprint = await fingerprintOf(JSON.stringify({ url, ...request }));
  const previous = await readState();
  // Sent again once a day too, so a changed AI_KEY_SECRET on the server heals by itself
  const fresh = previous ? Date.now() - new Date(previous.at).getTime() < RESEND_AFTER_MS : false;
  if (!force && fresh && previous?.fingerprint === fingerprint && previous.status !== 'error') return previous.status;

  let status: AiLockStatus = 'error';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.ok) status = json.cleared ? 'cleared' : 'locked';
    else if (res.status === 501) status = 'server-off';
    else if (res.status === 400) status = 'unsupported';
  } catch {
    status = 'error';
  }
  await writeState({ fingerprint, status, at: new Date().toISOString() });
  return status;
}

/** One line for the settings page about what the web app will use. */
export function describeAiLock(status: AiLockStatus | null | undefined): string {
  switch (status) {
    case 'locked': return 'Web app: uses this model through your server.';
    case 'cleared': return 'Web app: uses the built-in parser (no AI key set).';
    case 'server-off': return 'Web app: uses the built-in parser until AI_KEY_SECRET is set on your server.';
    case 'unsupported': return 'Web app: uses the built-in parser (your server cannot reach this provider).';
    case 'no-sync': return 'Web app: pair a sync key to share this model with it.';
    case 'error': return 'Web app: could not reach your server; it uses the built-in parser for now.';
    default: return '';
  }
}
