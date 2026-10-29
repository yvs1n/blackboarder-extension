import { ScanGate, ScanRun } from '../content/scanGate';
import { runHttpBlackboardScan, resolveBlackboardOrigin, HttpScanOptions, ScanResult } from './httpScanner';
import { getExtraSites } from '../utils/blackboardSites';
import { getScanStatus, setScanStatus, ScanStatus } from '../utils/storage';
import { SIGN_IN_MESSAGE, UNREACHABLE_MESSAGE } from '../scan/scanFallback';
import { stampScanStarted } from '../scan/autoScan';

/**
 * Every scan goes through here: HTTP from the service worker first, then, when Blackboard did
 * not answer over HTTP, the tab scanner in a Blackboard tab. Only one scan runs at a time; a
 * request made during a scan joins it (a Scan press turns a quiet scan visible, see ScanGate).
 *
 * Fallback tab: the tab that asked (floating button, automatic scan), else an open Blackboard tab
 * with a live scanner, else (not for automatic scans) a background tab opened on the stream and
 * closed again afterwards.
 */

export interface ScanRequest {
  fullRescan?: boolean;
  /** Show progress and a final status. Automatic scans are quiet. */
  interactive?: boolean;
  /** An automatic scan: never reads the exam schedule and never opens a tab. */
  auto?: boolean;
  /** The Blackboard tab that asked; the fallback runs there and nowhere else. */
  senderTabId?: number;
  onSync?: () => Promise<any>;
}

type Tab = { id?: number; url?: string; status?: string; discarded?: boolean };

export interface OrchestratorDeps {
  runHttp: (options: HttpScanOptions) => Promise<ScanResult>;
  resolveOrigin: () => Promise<string>;
  getExtraSites: () => Promise<string[]>;
  tabs: {
    query: (q: { url: string[] }) => Promise<Tab[]>;
    create: (p: { url: string; active: boolean }) => Promise<Tab>;
    get: (tabId: number) => Promise<Tab>;
    remove: (tabId: number) => Promise<void>;
    sendMessage: (tabId: number, message: any) => Promise<any>;
  };
  /** Loads content.js (and its CSS) into a tab that has no live scanner. */
  inject: (tabId: number) => Promise<void>;
  contentScriptMatches: () => string[];
  getScanStatus: () => Promise<ScanStatus | null>;
  setScanStatus: (s: Omit<ScanStatus, 'updatedAt'>) => Promise<void>;
  stampScanStarted: () => Promise<void>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** How long the opened tab may take to load, and the tab scan to finish. */
  loadTimeoutMs: number;
  scanTimeoutMs: number;
}

export const TAB_SCAN_TIMEOUT_MS = 120 * 1000;
export const TAB_LOAD_TIMEOUT_MS = 30 * 1000;

function originOf(url?: string): string {
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
}

/** A Blackboard tab that ended up on a sign-in page: another host (SSO) or a login path. */
export function isLoginUrl(url: string | undefined, origin: string): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin !== origin) return true;
  return /(?:^|\/)(?:login|signin|sign-in|sso|cas|auth)(?:\/|$|\.)/i.test(parsed.pathname) || /\/webapps\/login/i.test(parsed.pathname);
}

async function ping(deps: OrchestratorDeps, tabId: number): Promise<{ ok: boolean; loginPage?: boolean } | null> {
  try {
    const res = await deps.tabs.sendMessage(tabId, { type: 'PING_SCANNER' });
    return res && res.ok ? res : null;
  } catch {
    return null;
  }
}

/** Pings the tab, loading a fresh scanner into it once if nothing answers (a tab from before an extension update). */
async function pingOrInject(deps: OrchestratorDeps, tabId: number): Promise<{ ok: boolean; loginPage?: boolean } | null> {
  const first = await ping(deps, tabId);
  if (first) return first;
  try {
    await deps.inject(tabId);
  } catch {
    return null;
  }
  for (let i = 0; i < 6; i++) {
    const res = await ping(deps, tabId);
    if (res) return res;
    await deps.sleep(500);
  }
  return null;
}

/** An open Blackboard tab (university origin or an added site) with a live scanner, or null. */
export async function findOpenBlackboardTab(deps: OrchestratorDeps, origin: string): Promise<number | null> {
  const extra = await deps.getExtraSites().catch(() => [] as string[]);
  const origins = new Set([origin, ...extra.map(originOf).filter(Boolean)]);
  let tabs: Tab[] = [];
  try {
    tabs = await deps.tabs.query({ url: [...deps.contentScriptMatches(), ...extra.map(o => `${o}/*`)] });
  } catch {
    return null;
  }
  for (const tab of tabs) {
    if (typeof tab.id !== 'number' || tab.discarded || !origins.has(originOf(tab.url))) continue;
    const res = await ping(deps, tab.id);
    if (res && !res.loginPage) return tab.id;
  }
  return null;
}

async function waitForLoad(deps: OrchestratorDeps, tabId: number): Promise<Tab | null> {
  const until = deps.now() + deps.loadTimeoutMs;
  while (deps.now() < until) {
    let tab: Tab;
    try {
      tab = await deps.tabs.get(tabId);
    } catch {
      return null;
    }
    if (tab.status === 'complete') return tab;
    await deps.sleep(250);
  }
  return null;
}

type TabOutcome = { kind: 'result'; result: ScanResult } | { kind: 'expired' } | { kind: 'failed'; error: string };

/** Runs the tab scanner in a tab and waits for it (at most scanTimeoutMs; the stored scan status is the backstop). */
async function scanInTab(deps: OrchestratorDeps, tabId: number, run: ScanRun, startedAt: number): Promise<TabOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), deps.scanTimeoutMs);
  });
  const reply = deps.tabs.sendMessage(tabId, { type: 'RUN_TAB_SCAN', fullRescan: run.fullRescan, interactive: run.interactive })
    .catch(() => null);
  const res = await Promise.race([reply, timeout]);
  if (timer) clearTimeout(timer);

  if (res && res !== 'timeout' && res.ok !== undefined) {
    return { kind: 'result', result: { ok: Boolean(res.ok), newCount: res.newCount || 0, message: res.message, via: 'tab' } };
  }
  // No answer (tab closed, navigated, or too slow): what the tab wrote to storage, if anything
  const status = await deps.getScanStatus().catch(() => null);
  if (status && status.state !== 'running' && new Date(status.updatedAt).getTime() >= startedAt) {
    return { kind: 'result', result: { ok: status.state === 'done', newCount: status.newCount || 0, message: status.message, via: 'tab' } };
  }
  return { kind: 'failed', error: res === 'timeout' ? 'The Blackboard tab did not finish scanning in time.' : 'The Blackboard tab stopped answering.' };
}

/** The tab half of the fallback: pick or open a tab, scan there, close it if it was opened here. */
export async function runTabFallback(deps: OrchestratorDeps, run: ScanRun, req: ScanRequest): Promise<TabOutcome> {
  const startedAt = deps.now();
  const origin = await deps.resolveOrigin();

  if (typeof req.senderTabId === 'number') {
    const res = await ping(deps, req.senderTabId);
    if (!res) return { kind: 'failed', error: 'This Blackboard tab is not connected. Refresh it and try again.' };
    if (res.loginPage) return { kind: 'expired' };
    return scanInTab(deps, req.senderTabId, run, startedAt);
  }

  const open = await findOpenBlackboardTab(deps, origin);
  if (open !== null) return scanInTab(deps, open, run, startedAt);
  if (req.auto) return { kind: 'failed', error: 'No Blackboard tab is open.' };

  let opened: number | null = null;
  try {
    const tab = await deps.tabs.create({ url: `${origin}/ultra/stream`, active: false });
    if (typeof tab.id !== 'number') return { kind: 'failed', error: 'Could not open a Blackboard tab.' };
    opened = tab.id;
    const loaded = await waitForLoad(deps, opened);
    if (!loaded) return { kind: 'failed', error: 'Blackboard did not load in time.' };
    if (isLoginUrl(loaded.url, origin)) return { kind: 'expired' };
    const res = await pingOrInject(deps, opened);
    if (!res) return { kind: 'failed', error: 'The scanner did not start in the Blackboard tab.' };
    if (res.loginPage) return { kind: 'expired' };
    return await scanInTab(deps, opened, run, startedAt);
  } catch (err) {
    return { kind: 'failed', error: String((err as any)?.message || err) };
  } finally {
    if (opened !== null) await deps.tabs.remove(opened).catch(() => {});
  }
}

export interface ScanOrchestrator {
  requestScan(req: ScanRequest): Promise<ScanResult>;
  isRunning(): boolean;
}

export function createScanOrchestrator(deps: OrchestratorDeps): ScanOrchestrator {
  let current: ScanRequest = {};
  let lastResult: ScanResult = { ok: true, message: 'Scan finished.' };

  const finish = async (run: ScanRun, startedAt: number, result: ScanResult) => {
    if (!run.interactive) return;
    const status = await deps.getScanStatus().catch(() => null);
    const written = status && status.state !== 'running' && new Date(status.updatedAt).getTime() >= startedAt;
    if (!written) {
      await deps.setScanStatus(result.ok
        ? { state: 'done', message: result.message || 'Scan finished.', newCount: result.newCount || 0 }
        : { state: 'error', message: result.message || UNREACHABLE_MESSAGE });
    }
    run.reported = true;
  };

  const scan = async (run: ScanRun): Promise<void> => {
    const req = current;
    await deps.stampScanStarted();
    const http = await deps.runHttp({ fullRescan: run.fullRescan, refreshExam: !req.auto, run, onSync: req.onSync });
    if (!http.needsFallback) {
      lastResult = http;
      return;
    }

    const startedAt = deps.now();
    if (run.interactive) {
      await deps.setScanStatus({ state: 'running', message: 'Blackboard did not answer directly. Scanning in a Blackboard tab...' });
    }
    const outcome = await runTabFallback(deps, run, req);
    let result: ScanResult;
    if (outcome.kind === 'result') {
      result = { ...outcome.result, sources: http.sources, fallbackReason: http.fallbackReason };
    } else if (outcome.kind === 'expired') {
      result = { ok: false, message: SIGN_IN_MESSAGE, sources: http.sources, fallbackReason: 'expired', via: 'tab' };
    } else {
      console.info(`[Scan] Tab fallback did not run: ${outcome.error}`);
      result = { ok: false, message: UNREACHABLE_MESSAGE, sources: http.sources, fallbackReason: http.fallbackReason, via: 'tab' };
    }
    await finish(run, startedAt, result);
    lastResult = result;
  };

  const gate = new ScanGate({
    scan,
    onBecameInteractive: run => deps.setScanStatus({
      state: 'running',
      message: run.fullRescan ? 'Full re-scan: reading Blackboard...' : 'Reading Blackboard...'
    }),
    onUnreported: async run => {
      run.reported = true;
      await deps.setScanStatus({ state: 'done', message: lastResult.message || 'Scan finished.', newCount: lastResult.newCount || 0 });
    }
  });

  return {
    async requestScan(req: ScanRequest): Promise<ScanResult> {
      const interactive = req.auto ? false : req.interactive !== false;
      // A running scan already read its request; the next one (a full re-scan asked for during a
      // quick one) takes this, unless it is only an automatic scan joining in
      if (!gate.running || !req.auto) current = req;
      try {
        await gate.run(interactive, Boolean(req.fullRescan));
      } catch (err) {
        console.error('[Scan] Scan failed:', err);
        return { ok: false, message: UNREACHABLE_MESSAGE };
      }
      return lastResult;
    },
    isRunning: () => gate.running
  };
}

function contentScriptMatches(): string[] {
  try {
    const entry = chrome.runtime.getManifest().content_scripts?.find(cs => cs.js?.includes('content.js'));
    return entry?.matches || [];
  } catch {
    return [];
  }
}

async function injectScanner(tabId: number): Promise<void> {
  const entry = chrome.runtime.getManifest().content_scripts?.find(cs => cs.js?.includes('content.js'));
  if (!entry?.js) throw new Error('no content script');
  if (entry.css?.length) await chrome.scripting.insertCSS({ target: { tabId }, files: entry.css });
  await chrome.scripting.executeScript({ target: { tabId }, files: entry.js });
}

export function chromeOrchestratorDeps(): OrchestratorDeps {
  return {
    runHttp: runHttpBlackboardScan,
    resolveOrigin: resolveBlackboardOrigin,
    getExtraSites,
    tabs: {
      query: q => chrome.tabs.query(q) as Promise<Tab[]>,
      create: p => chrome.tabs.create(p) as Promise<Tab>,
      get: id => chrome.tabs.get(id) as Promise<Tab>,
      remove: id => chrome.tabs.remove(id),
      sendMessage: (id, message) => chrome.tabs.sendMessage(id, message)
    },
    inject: injectScanner,
    contentScriptMatches,
    getScanStatus,
    setScanStatus,
    stampScanStarted: () => stampScanStarted(chrome.storage.local as any),
    now: () => Date.now(),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    loadTimeoutMs: TAB_LOAD_TIMEOUT_MS,
    scanTimeoutMs: TAB_SCAN_TIMEOUT_MS
  };
}

let defaultOrchestrator: ScanOrchestrator | null = null;

/** The service worker's one orchestrator. */
export function scanOrchestrator(): ScanOrchestrator {
  if (!defaultOrchestrator) defaultOrchestrator = createScanOrchestrator(chromeOrchestratorDeps());
  return defaultOrchestrator;
}
