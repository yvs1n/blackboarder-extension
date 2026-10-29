import { describe, it, expect, vi } from 'vitest';
import { createScanOrchestrator, isLoginUrl, OrchestratorDeps } from '../src/background/scanOrchestrator';
import type { ScanResult } from '../src/background/httpScanner';
import type { ScanStatus } from '../src/utils/storage';

const ORIGIN = 'https://elearning.sharjah.ac.ae';
const NEEDS_FALLBACK: ScanResult = { ok: false, needsFallback: true, fallbackReason: 'unreachable', message: 'Could not reach Blackboard.', via: 'http' };

type TabState = { id: number; url: string; status: string; scanner: boolean; loginPage?: boolean };

/** Stubbed chrome.tabs / scripting / runtime, with a tab scanner that answers RUN_TAB_SCAN. */
function harness(opts: {
  http?: ScanResult;
  openTabs?: TabState[];
  /** What the opened tab loads as (a sign-in redirect, say). */
  openedUrl?: string;
  openedHasScanner?: boolean;
  tabScan?: (tabId: number) => Promise<any>;
  injectFails?: boolean;
} = {}) {
  const tabs = new Map<number, TabState>((opts.openTabs || []).map(t => [t.id, { ...t }]));
  let nextId = 100;
  let status: ScanStatus | null = null;
  const removed: number[] = [];
  const created: { url: string; active: boolean }[] = [];
  const messages: { tabId: number; message: any }[] = [];
  const injected: number[] = [];
  let clock = 1_000_000;

  const deps: OrchestratorDeps = {
    runHttp: vi.fn(async () => opts.http || NEEDS_FALLBACK),
    resolveOrigin: async () => ORIGIN,
    getExtraSites: async () => [],
    tabs: {
      query: async () => [...tabs.values()].map(t => ({ id: t.id, url: t.url, status: t.status })),
      create: async p => {
        created.push(p);
        const id = nextId++;
        tabs.set(id, { id, url: opts.openedUrl || p.url, status: 'complete', scanner: opts.openedHasScanner !== false });
        return { id, url: p.url, status: 'loading' };
      },
      get: async id => {
        const t = tabs.get(id);
        if (!t) throw new Error('no tab');
        return { id: t.id, url: t.url, status: t.status };
      },
      remove: async id => {
        removed.push(id);
        tabs.delete(id);
      },
      sendMessage: async (tabId, message) => {
        messages.push({ tabId, message });
        const t = tabs.get(tabId);
        if (!t || !t.scanner) throw new Error('Could not establish connection. Receiving end does not exist.');
        if (message.type === 'PING_SCANNER') return { ok: true, scanning: false, loginPage: Boolean(t.loginPage) };
        if (message.type === 'RUN_TAB_SCAN') {
          return opts.tabScan ? opts.tabScan(tabId) : { ok: true, newCount: 2, message: 'Added 2 new deadlines to calendar!' };
        }
        return undefined;
      }
    },
    inject: async tabId => {
      injected.push(tabId);
      if (opts.injectFails) throw new Error('cannot inject');
      const t = tabs.get(tabId);
      if (t) t.scanner = true;
    },
    contentScriptMatches: () => ['https://*.sharjah.ac.ae/*'],
    getScanStatus: async () => status,
    setScanStatus: async s => { status = { ...s, updatedAt: new Date(clock).toISOString() }; },
    stampScanStarted: async () => {},
    now: () => clock,
    sleep: async ms => { clock += ms; },
    loadTimeoutMs: 30_000,
    scanTimeoutMs: 50
  };
  return { deps, tabs, removed, created, messages, injected, getStatus: () => status };
}

describe('scan orchestration: HTTP first, then the tab scanner', () => {
  it('a working HTTP scan never touches tabs', async () => {
    const h = harness({ http: { ok: true, newCount: 1, message: 'Added 1 new deadline to calendar!', via: 'http' } });
    const res = await createScanOrchestrator(h.deps).requestScan({ interactive: true });
    expect(res).toMatchObject({ ok: true, newCount: 1, via: 'http' });
    expect(h.created).toHaveLength(0);
    expect(h.messages).toHaveLength(0);
  });

  it('signed out over HTTP: no fallback', async () => {
    const h = harness({ http: { ok: false, fallbackReason: 'expired', message: 'Sign in to Blackboard first, then click Scan.', via: 'http' } });
    const res = await createScanOrchestrator(h.deps).requestScan({ interactive: true });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/sign in/i);
    expect(h.created).toHaveLength(0);
    expect(h.messages).toHaveLength(0);
  });

  it('opens a background tab when no Blackboard tab is open, scans there and closes it', async () => {
    const h = harness();
    const res = await createScanOrchestrator(h.deps).requestScan({ interactive: true, fullRescan: true });
    expect(h.created).toEqual([{ url: `${ORIGIN}/ultra/stream`, active: false }]);
    const scan = h.messages.find(m => m.message.type === 'RUN_TAB_SCAN');
    expect(scan?.message).toEqual({ type: 'RUN_TAB_SCAN', fullRescan: true, interactive: true });
    expect(res).toMatchObject({ ok: true, newCount: 2, via: 'tab', fallbackReason: 'unreachable' });
    expect(h.removed).toEqual([100]);
    // A visible scan ends with a final status
    expect(h.getStatus()?.state).toBe('done');
  });

  it('closes the opened tab when the tab scan times out', async () => {
    const h = harness({ tabScan: () => new Promise(() => {}) });
    const res = await createScanOrchestrator(h.deps).requestScan({ interactive: true });
    expect(res.ok).toBe(false);
    expect(h.removed).toEqual([100]);
    expect(h.getStatus()?.state).toBe('error');
  });

  it('closes the opened tab when the tab scan fails', async () => {
    const h = harness({ tabScan: async () => { throw new Error('tab crashed'); } });
    const res = await createScanOrchestrator(h.deps).requestScan({ interactive: true });
    expect(res.ok).toBe(false);
    expect(h.removed).toEqual([100]);
  });

  it('loads the scanner into the opened tab when it has none yet, and closes the tab if that fails', async () => {
    const ok = harness({ openedHasScanner: false });
    expect((await createScanOrchestrator(ok.deps).requestScan({ interactive: true })).ok).toBe(true);
    expect(ok.injected).toEqual([100]);
    expect(ok.removed).toEqual([100]);

    const bad = harness({ openedHasScanner: false, injectFails: true });
    expect((await createScanOrchestrator(bad.deps).requestScan({ interactive: true })).ok).toBe(false);
    expect(bad.removed).toEqual([100]);
  });

  it('an opened tab that lands on a sign-in page counts as signed out, and is closed', async () => {
    const h = harness({ openedUrl: 'https://login.microsoftonline.com/common/oauth2/authorize' });
    const res = await createScanOrchestrator(h.deps).requestScan({ interactive: true });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/sign in/i);
    expect(h.messages.some(m => m.message.type === 'RUN_TAB_SCAN')).toBe(false);
    expect(h.removed).toEqual([100]);
  });

  it('uses an open Blackboard tab with a live scanner and never closes it', async () => {
    const h = harness({ openTabs: [
      { id: 7, url: 'https://banner.sharjah.ac.ae/StudentExamPage', status: 'complete', scanner: true },
      { id: 8, url: `${ORIGIN}/ultra/course`, status: 'complete', scanner: true }
    ] });
    const res = await createScanOrchestrator(h.deps).requestScan({ interactive: true });
    expect(res).toMatchObject({ ok: true, via: 'tab' });
    expect(h.created).toHaveLength(0);
    expect(h.messages.find(m => m.message.type === 'RUN_TAB_SCAN')?.tabId).toBe(8);
    expect(h.removed).toHaveLength(0);
  });

  it('the floating button falls back in its own tab; an existing tab is not closed even on timeout', async () => {
    const h = harness({ openTabs: [{ id: 9, url: `${ORIGIN}/ultra/stream`, status: 'complete', scanner: true }], tabScan: () => new Promise(() => {}) });
    const res = await createScanOrchestrator(h.deps).requestScan({ interactive: true, senderTabId: 9 });
    expect(res.ok).toBe(false);
    expect(h.messages.filter(m => m.message.type === 'RUN_TAB_SCAN').map(m => m.tabId)).toEqual([9]);
    expect(h.created).toHaveLength(0);
    expect(h.removed).toHaveLength(0);
  });

  it('an automatic scan stays quiet, skips the exam schedule and never opens a tab', async () => {
    const h = harness();
    const res = await createScanOrchestrator(h.deps).requestScan({ auto: true });
    expect(res.ok).toBe(false);
    expect(h.created).toHaveLength(0);
    expect(h.getStatus()).toBeNull();
    expect((h.deps.runHttp as any).mock.calls[0][0]).toMatchObject({ refreshExam: false });
    expect((h.deps.runHttp as any).mock.calls[0][0].run.interactive).toBe(false);
  });

  it('an automatic scan from a Blackboard tab falls back in that tab', async () => {
    const h = harness({ openTabs: [{ id: 5, url: `${ORIGIN}/ultra/stream`, status: 'complete', scanner: true }] });
    const res = await createScanOrchestrator(h.deps).requestScan({ auto: true, senderTabId: 5 });
    expect(res.ok).toBe(true);
    expect(h.messages.find(m => m.message.type === 'RUN_TAB_SCAN')?.message).toEqual({ type: 'RUN_TAB_SCAN', fullRescan: false, interactive: false });
    expect(h.removed).toHaveLength(0);
  });

  it('never runs two scans at once: a request during a scan joins it', async () => {
    let release!: () => void;
    const h = harness({ http: { ok: true, newCount: 0, message: 'Up to date.', via: 'http' } });
    (h.deps.runHttp as any).mockImplementation(() => new Promise<ScanResult>(r => { release = () => r({ ok: true, newCount: 0, message: 'Up to date.', via: 'http' }); }));
    const orch = createScanOrchestrator(h.deps);
    const quiet = orch.requestScan({ auto: true });
    expect(orch.isRunning()).toBe(true);
    const pressed = orch.requestScan({ interactive: true });
    await Promise.resolve();
    release();
    const [a, b] = await Promise.all([quiet, pressed]);
    expect(h.deps.runHttp).toHaveBeenCalledTimes(1);
    expect(a.message).toBe('Up to date.');
    expect(b.message).toBe('Up to date.');
    // The quiet scan became visible when Scan was pressed
    expect((h.deps.runHttp as any).mock.calls[0][0].run.interactive).toBe(true);
    expect(orch.isRunning()).toBe(false);
  });
});

describe('sign-in page detection for the opened tab', () => {
  it('another host or a login path is a sign-in page', () => {
    expect(isLoginUrl('https://login.microsoftonline.com/x', ORIGIN)).toBe(true);
    expect(isLoginUrl(`${ORIGIN}/webapps/login/`, ORIGIN)).toBe(true);
    expect(isLoginUrl(`${ORIGIN}/auth-saml/saml/login?apId=_1_1`, ORIGIN)).toBe(true);
    expect(isLoginUrl(`${ORIGIN}/ultra/stream`, ORIGIN)).toBe(false);
    expect(isLoginUrl(`${ORIGIN}/ultra/courses/_1_1/outline`, ORIGIN)).toBe(false);
  });
});
