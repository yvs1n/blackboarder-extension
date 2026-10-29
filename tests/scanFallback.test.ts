import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import { decideFallback, describePartialFailures } from '../src/scan/scanFallback';
import type { ScanSourceOutcomes } from '../src/scan/blackboardApi';
import { fetchCloudScanRequest, isScanRequestStale, scanRequestUrl, SCAN_REQUEST_STALE_MS } from '../src/utils/cloudScanRequest';
import { FIREBASE_DB_URL } from '../src/utils/firebaseSync';
import { claimAutoScan, isAutoScanDue, AUTO_SCAN_KEY, AUTO_SCAN_GAP_MS, StampStorage } from '../src/scan/autoScan';
import { findCourseIdForText } from '../src/scan/courseLookup';
import type { UserCourseConfig } from '../src/types';

function sources(over: Partial<ScanSourceOutcomes> = {}): ScanSourceOutcomes {
  return {
    session: 'ok',
    courses: { ok: true, count: 3 },
    stream: { ok: true },
    announcements: { ok: 3, failed: 0, failedCourseIds: [] },
    gradebook: { ok: 3, failed: 0, failedCourseIds: [] },
    ...over
  };
}

describe('when the HTTP scan falls back to the tab scanner', () => {
  it('signed out: no fallback, the student is asked to sign in', () => {
    expect(decideFallback(sources({ session: 'expired' }))).toEqual({ fallback: false, reason: 'expired' });
  });

  it('Blackboard unreachable: falls back', () => {
    expect(decideFallback(sources({ session: 'unreachable' }))).toEqual({ fallback: true, reason: 'unreachable' });
  });

  it('course list and stream both failed: falls back', () => {
    const s = sources({ courses: { ok: false, count: 0, status: 500, error: 'HTTP 500' }, stream: { ok: false, status: 500, error: 'HTTP 500' } });
    expect(decideFallback(s)).toEqual({ fallback: true, reason: 'no-data' });
  });

  it('only some courses failed: no fallback, the message says how many', () => {
    const s = sources({ announcements: { ok: 1, failed: 2, failedCourseIds: ['_1_1', '_2_1'] } });
    expect(decideFallback(s)).toEqual({ fallback: false, reason: null });
    expect(describePartialFailures(s)).toBe(' 2 courses could not be read.');
  });

  it('only the course list or only the stream failed: no fallback, said in the message', () => {
    const noList = sources({ courses: { ok: false, count: 0, error: 'HTTP 403' } });
    expect(decideFallback(noList).fallback).toBe(false);
    expect(describePartialFailures(noList)).toContain('course list could not be read');
    const noStream = sources({ stream: { ok: false, error: 'HTTP 500' } });
    expect(decideFallback(noStream).fallback).toBe(false);
    expect(describePartialFailures(noStream)).toContain('activity stream could not be read');
  });

  it('a full read adds nothing to the message', () => {
    expect(describePartialFailures(sources())).toBe('');
    expect(describePartialFailures(undefined)).toBe('');
  });
});

describe('phone scan requests (cloudScanRequest)', () => {
  afterEach(() => vi.restoreAllMocks());
  const KEY = 'BBS-ABCDEFGHJKLMNPQRSTUVWXYZ23';

  it('reads only the scanRequest field of the synced data', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ state: 'pending', requestedAt: '2026-10-29T10:00:00.000Z' }), { status: 200 }));
    const req = await fetchCloudScanRequest(KEY, fetchMock as any);
    expect(req).toEqual({ state: 'pending', requestedAt: '2026-10-29T10:00:00.000Z' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as any[])[0])).toBe(`${FIREBASE_DB_URL}/users/${KEY}/data/scanRequest.json`);
  });

  it('never asks Firebase without a valid sync key', async () => {
    const fetchMock = vi.fn();
    expect(await fetchCloudScanRequest('', fetchMock as any)).toBeNull();
    expect(await fetchCloudScanRequest('short', fetchMock as any)).toBeNull();
    expect(await fetchCloudScanRequest('../../root', fetchMock as any)).toBeNull();
    expect(scanRequestUrl('a/b/c/d/e/f')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no request, a refused read or a malformed value is "nothing to do"', async () => {
    expect(await fetchCloudScanRequest(KEY, (async () => new Response('null', { status: 200 })) as any)).toBeNull();
    expect(await fetchCloudScanRequest(KEY, (async () => new Response('{}', { status: 401 })) as any)).toBeNull();
    expect(await fetchCloudScanRequest(KEY, (async () => new Response(JSON.stringify({ state: 'weird', requestedAt: 'x' }), { status: 200 })) as any)).toBeNull();
    expect(await fetchCloudScanRequest(KEY, (async () => { throw new Error('offline'); }) as any)).toBeNull();
  });

  it('a pending request older than 15 minutes is stale', () => {
    const now = Date.parse('2026-10-29T10:30:00.000Z');
    const at = (msAgo: number) => new Date(now - msAgo).toISOString();
    expect(isScanRequestStale({ state: 'pending', requestedAt: at(SCAN_REQUEST_STALE_MS + 1000) }, now)).toBe(true);
    expect(isScanRequestStale({ state: 'pending', requestedAt: at(60 * 1000) }, now)).toBe(false);
    expect(isScanRequestStale({ state: 'done', requestedAt: at(SCAN_REQUEST_STALE_MS * 4) }, now)).toBe(false);
    expect(isScanRequestStale({ state: 'pending', requestedAt: 'not a date' }, now)).toBe(true);
  });

  it('the 1-minute alarm only reads the request; the full pull stays on the 30-minute alarm', () => {
    const sw = fs.readFileSync('src/background/serviceWorker.ts', 'utf8');
    expect(sw).toMatch(/alarm\.name === CLOUD_SCAN_ALARM\) \{\s*pollCloudScanRequest\(\);\s*\}/);
    expect(sw).toMatch(/alarm\.name === ALARM_NAME\) \{\s*pullTasksFromFirebaseToLocal\(\)/);
    const pull = sw.slice(sw.indexOf('async function pullTasksFromFirebaseToLocal'), sw.indexOf('/** After a scan'));
    expect(pull).not.toContain('scanRequest');
    expect(sw).toContain('markCloudScanRequestCompleted(syncKey, req.requestedAt, SCAN_REQUEST_EXPIRED_MESSAGE)');
  });
});

describe('automatic scan on page load', () => {
  function memoryStorage(initial: Record<string, any> = {}): StampStorage & { data: Record<string, any> } {
    const data = { ...initial };
    return {
      data,
      get: async keys => Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]])),
      set: async items => { Object.assign(data, items); }
    };
  }

  it('runs at most once every 30 minutes', async () => {
    const storage = memoryStorage();
    const t0 = Date.parse('2026-10-29T08:00:00.000Z');
    expect(await claimAutoScan(storage, t0)).toBe(true);
    expect(storage.data[AUTO_SCAN_KEY]).toBe(t0);
    expect(await claimAutoScan(storage, t0 + 60 * 1000)).toBe(false);
    expect(await claimAutoScan(storage, t0 + AUTO_SCAN_GAP_MS - 1)).toBe(false);
    expect(await claimAutoScan(storage, t0 + AUTO_SCAN_GAP_MS)).toBe(true);
  });

  it('a missing, broken or future stamp does not block it', () => {
    const now = Date.now();
    expect(isAutoScanDue(undefined, now)).toBe(true);
    expect(isAutoScanDue('yesterday', now)).toBe(true);
    expect(isAutoScanDue(now + 3600 * 1000, now)).toBe(true);
  });

  it('storage errors skip the scan instead of throwing', async () => {
    const broken: StampStorage = { get: async () => { throw new Error('gone'); }, set: async () => {} };
    expect(await claimAutoScan(broken)).toBe(false);
  });

  it('the content script reads the setting and asks for a quiet HTTP-first scan', () => {
    const src = fs.readFileSync('src/content/scraper.ts', 'utf8');
    expect(src).toContain('settings.autoScanOnPageLoad');
    expect(src).toContain("chrome.runtime.sendMessage({ type: 'RUN_HTTP_SCAN', auto: true }");
    expect(src).toContain('if (!onExamPage) scheduleAutoScan();');
    expect(src).toContain('claimAutoScan(');
  });

  it('the content script runs the tab scanner for RUN_TAB_SCAN and answers when it is done', () => {
    const src = fs.readFileSync('src/content/scraper.ts', 'utf8');
    expect(src).toMatch(/message\.type === 'RUN_TAB_SCAN'\)[\s\S]{0,600}runScan\(interactive, Boolean\(message\.fullRescan\)\)/);
    expect(src).toContain('sendResponse({ ok: true, scanning: scanGate.running, loginPage: isSignInPage() })');
  });
});

describe('no built-in course table', () => {
  it('neither scanner carries course ids of its own', () => {
    for (const f of ['src/content/scraper.ts', 'src/background/httpScanner.ts', 'src/scan/blackboardApi.ts', 'src/scan/scanPipeline.ts']) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src).not.toMatch(/KNOWN_UOS/);
      expect(src).not.toMatch(/'_\d+_1'/);
    }
  });

  it('a stream card without a course link finds its course by code, name, or the saved course it matches', () => {
    const courses = new Map([
      ['_100_1', { name: 'Calculus I for Engineering', code: '1440 133' }],
      ['_200_1', { name: 'Physics 1', code: '1430 115' }],
      ['_300_1', { name: 'Physics 1 Lab', code: '1430 116' }]
    ]);
    expect(findCourseIdForText('1440133 Quiz 3', courses)).toBe('_100_1');
    expect(findCourseIdForText('Calculus I for Engineering - Quiz 3', courses)).toBe('_100_1');
    // "Physics 1" is inside "Physics 1 Lab": the longer name wins
    expect(findCourseIdForText('Physics 1 Lab report', courses)).toBe('_300_1');
    expect(findCourseIdForText('Physics 1 midterm', courses)).toBe('_200_1');
    // Two courses with the same name: no guess
    const twins = new Map([['_1_1', { name: 'Physics 1', code: '' }], ['_2_1', { name: 'Physics 1', code: '' }]]);
    expect(findCourseIdForText('Physics 1 midterm', twins)).toBe('');
    const saved = [{ id: 'calc', courseCode: '1440 133', courseName: 'Calculus I', aliases: ['حسبان'], colorHex: '#000', scheduleSlots: [], syllabus: [] }] as UserCourseConfig[];
    expect(findCourseIdForText('حسبان 1 - اختبار قصير', courses, saved)).toBe('_100_1');
    expect(findCourseIdForText('Something else', courses, saved)).toBe('');
    expect(findCourseIdForText('1440133', new Map())).toBe('');
  });
});
