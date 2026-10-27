import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import { deleteSyncDataFromFirebase, FIREBASE_DB_URL } from '../src/utils/firebaseSync';
import { describeSessionBanner, isSessionExpiredResponse } from '../src/utils/sessionStatus';
import { generateUniqueSyncKey } from '../src/utils/storage';

afterEach(() => vi.unstubAllGlobals());

describe('Delete my online data', () => {
  it('deletes only the key\'s own folder', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const result = await deleteSyncDataFromFirebase('BBS-TESTKEY123');
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${FIREBASE_DB_URL}/users/BBS-TESTKEY123.json`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
  });

  it('refuses an empty or malformed key without calling the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const bad of ['', 'short', 'BBS-../../x', 'BBS-TEST KEY 12', 'x'.repeat(65)]) {
      expect((await deleteSyncDataFromFirebase(bad)).success).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a refused or failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    expect((await deleteSyncDataFromFirebase('BBS-TESTKEY123')).success).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect((await deleteSyncDataFromFirebase('BBS-TESTKEY123')).success).toBe(false);
  });
});

describe('Blackboard session banner', () => {
  it('a 401, a 403, or a sign-in page instead of JSON means the session ended', () => {
    expect(isSessionExpiredResponse(401, 'application/json')).toBe(true);
    expect(isSessionExpiredResponse(403, null)).toBe(true);
    expect(isSessionExpiredResponse(200, 'text/html; charset=utf-8')).toBe(true);
    expect(isSessionExpiredResponse(200, null)).toBe(true);
  });

  it('a normal JSON answer, or a server error, does not', () => {
    expect(isSessionExpiredResponse(200, 'application/json;charset=UTF-8')).toBe(false);
    expect(isSessionExpiredResponse(500, 'text/html')).toBe(false);
    expect(isSessionExpiredResponse(404, 'application/json')).toBe(false);
  });

  it('the banner shows only while the session is marked ended', () => {
    expect(describeSessionBanner(null)).toBeNull();
    expect(describeSessionBanner({ expired: false, checkedAt: '2026-10-27T00:00:00Z' })).toBeNull();
    const banner = describeSessionBanner({ expired: true, checkedAt: '2026-10-27T00:00:00Z' });
    expect(banner?.title).toMatch(/session/i);
    expect(banner?.text).toMatch(/sign in/i);
  });

  it('the scraper records the status and the popup shows the banner with a warning icon', () => {
    expect(fs.readFileSync('src/content/scraper.ts', 'utf8')).toContain('saveSessionStatus(lastGradebookRead.expired)');
    const html = fs.readFileSync('src/popup/index.html', 'utf8');
    expect(html).toMatch(/id="session-banner"[\s\S]*#icon-urgent/);
  });
});

describe('Sync keys', () => {
  it('new keys carry 130 bits, well past guessing, and use no look-alike characters', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const key = generateUniqueSyncKey();
      expect(key).toMatch(/^BBS-[A-HJ-NP-Z2-9]{26}$/);
      keys.add(key);
    }
    expect(keys.size).toBe(200);
  });

  it('still fit the limits the server and database rules enforce', () => {
    const key = generateUniqueSyncKey();
    expect(key.length).toBeLessThanOrEqual(64);
    expect(fs.readFileSync('src/popup/index.html', 'utf8')).toMatch(/id="setting-sync-key"[^>]*maxlength="64"/);
  });
});

describe('Store build (Chrome Web Store and Edge Add-ons)', () => {
  const built = fs.existsSync('dist-store/manifest.json');

  it.skipIf(!built)('has no update helper, native messaging or GitHub access', () => {
    const manifest = JSON.parse(fs.readFileSync('dist-store/manifest.json', 'utf8'));
    expect(manifest.permissions).not.toContain('nativeMessaging');
    expect(JSON.stringify(manifest.host_permissions)).not.toMatch(/github/i);
    expect(fs.existsSync('dist-store/updater')).toBe(false);
    expect(fs.existsSync('dist-store/update.bat')).toBe(false);
    expect(fs.existsSync('dist-store/update.sh')).toBe(false);
    expect(fs.readFileSync('dist-store/background.js', 'utf8')).not.toContain('sendNativeMessage');
  });

  it.skipIf(!built)('keeps the same version and the permissions the extension really needs', () => {
    const store = JSON.parse(fs.readFileSync('dist-store/manifest.json', 'utf8'));
    const normal = JSON.parse(fs.readFileSync('dist/manifest.json', 'utf8'));
    expect(store.version).toBe(normal.version);
    for (const p of ['storage', 'alarms', 'notifications', 'sidePanel', 'scripting']) expect(store.permissions).toContain(p);
  });

  it('the normal build keeps its self-updater', () => {
    const manifest = JSON.parse(fs.readFileSync('dist/manifest.json', 'utf8'));
    expect(manifest.permissions).toContain('nativeMessaging');
  });
});
