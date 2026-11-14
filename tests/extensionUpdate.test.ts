import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isRemoteNewer } from '../src/utils/updateChecker';
import {
  AUTO_UPDATE_ENABLED_KEY,
  JUST_UPDATED_KEY,
  NATIVE_HOST_NAME,
  runAutoUpdate
} from '../src/background/autoUpdate';
import { BUILD_INFO } from '../src/buildInfo';

const read = (rel: string) => fs.readFileSync(path.resolve(rel), 'utf8');

describe('Extension automatic updates', () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = (globalThis as any).chrome;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalChrome === undefined) delete (globalThis as any).chrome;
    else (globalThis as any).chrome = originalChrome;
    vi.restoreAllMocks();
  });

  const local = { build: 'aaaaaaaaaaaa', timestamp: '2026-10-20T10:00:00.000Z' };

  it('treats only a different, not-older build on GitHub as an update', () => {
    expect(isRemoteNewer({ build: 'aaaaaaaaaaaa', timestamp: '2026-10-21T00:00:00Z' }, local)).toBe(false);
    expect(isRemoteNewer({ build: 'bbbbbbbbbbbb', timestamp: '2026-10-21T00:00:00Z' }, local)).toBe(true);
    expect(isRemoteNewer({ build: 'bbbbbbbbbbbb' }, local)).toBe(true);
    // A cached copy of an older build, or a local build with uncommitted changes, is not an update
    expect(isRemoteNewer({ build: 'bbbbbbbbbbbb', timestamp: '2026-10-19T00:00:00Z' }, local)).toBe(false);
    expect(isRemoteNewer(null, local)).toBe(false);
    expect(isRemoteNewer({ build: '' }, local)).toBe(false);
  });

  it('asks for native messaging and keeps the folder-based extension ID', () => {
    const manifest = JSON.parse(read('public/manifest.json'));
    expect(manifest.key).toBeUndefined();
    expect(manifest.permissions).toContain('nativeMessaging');
    expect(manifest.host_permissions).toContain('https://raw.githubusercontent.com/*');
  });

  it('ships the updater with the built extension and embeds changelog in BUILD_INFO', () => {
    for (const rel of ['update.bat', 'update.sh', 'updater/host.bat', 'updater/blackboarder-updater.ps1', 'updater/blackboarder-updater.sh']) {
      expect(fs.existsSync(path.resolve('dist', rel)), rel).toBe(true);
    }
    // cmd.exe needs CRLF line endings in batch files
    expect(fs.readFileSync(path.resolve('dist/update.bat'), 'latin1')).toContain('\r\n');

    const version = JSON.parse(read('dist/version.json'));
    expect(version.build).toBe(BUILD_INFO.build);
    expect(version.files).toContain('manifest.json');
    expect(version.files).toContain('updater/blackboarder-updater.ps1');
    expect(version.files).not.toContain('version.json');
    expect(Array.isArray(BUILD_INFO.changelog)).toBe(true);
    expect(BUILD_INFO.changelog.length).toBeGreaterThan(0);
    expect(BUILD_INFO.changelog.every(item => typeof item === 'string' && item.length > 0)).toBe(true);
  });

  it('provides auto-update, post-update changelog toggle, and changelog modal in popup UI', () => {
    const html = read('src/popup/index.html');
    expect(html).toContain('id="setting-auto-update"');
    expect(html).toContain('id="setting-show-changelog"');
    expect(html).toContain('id="details-ext-changelog"');
    expect(html).toContain('id="modal-changelog"');
    expect(html).toContain('aria-labelledby="changelog-modal-title"');
  });

  it('uses one helper name everywhere and downloads the repository archive', () => {
    for (const rel of ['updater/blackboarder-updater.ps1', 'updater/blackboarder-updater.sh']) {
      const script = read(rel);
      expect(script).toContain(NATIVE_HOST_NAME);
      expect(script).toContain('archive/refs/heads/main.zip');
      // A git clone is updated with a fast-forward git pull, never overwritten
      expect(script).toContain('.git');
      expect(script).toContain('pull --ff-only');
      expect(script).toContain('--untracked-files=no');
      // Run from the repository's own updater/ folder, the extension is dist/
      expect(script).toMatch(/dist[\\/]manifest\.json/);
    }
    // cmd keeps reading a running batch file, so the host line must end the script itself
    expect(read('updater/host.bat').trim()).toMatch(/-NativeHost & exit \/b$/);
    expect(read('updater/update.bat')).toContain('-Install');
    expect(read('updater/update.sh')).toContain('--install');

    const sh = read('updater/blackboarder-updater.sh');
    expect(sh).toContain('cleanup_stale_files');
    expect(sh).toContain('find "$target_dir" -depth -type d -empty');
  });

  it('automatically downloads and reloads when auto-update is enabled, and waits when disabled', async () => {
    const runScenario = async (autoEnabled: boolean) => {
      let diskBuild = BUILD_INFO.build;
      const store: Record<string, any> = autoEnabled ? {} : { [AUTO_UPDATE_ENABLED_KEY]: false };
      const nativeCalls: any[] = [];
      const reloadSpy = vi.fn();

      (globalThis as any).chrome = {
        storage: {
          local: {
            get: vi.fn(async (key: string | string[]) => {
              if (typeof key === 'string') return { [key]: store[key] };
              const out: Record<string, any> = {};
              for (const k of key) out[k] = store[k];
              return out;
            }),
            set: vi.fn(async (obj: Record<string, any>) => Object.assign(store, obj))
          }
        },
        alarms: { create: vi.fn() },
        runtime: {
          lastError: null,
          getURL: (rel: string) => `chrome-extension://testid/${rel}`,
          getContexts: vi.fn(async () => []),
          reload: reloadSpy,
          sendNativeMessage: vi.fn((_host: string, msg: any, cb: (reply: any) => void) => {
            nativeCalls.push(msg);
            if (msg.type === 'ping') cb({ ok: true, helperVersion: 1 });
            else if (msg.type === 'update') {
              diskBuild = 'ffffffffffff';
              cb({ ok: true, changed: true, build: 'ffffffffffff' });
            } else cb({ ok: false });
          })
        }
      };

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('chrome-extension://testid/version.json')) {
          return new Response(JSON.stringify({ build: diskBuild }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            version: '9.9.9',
            build: 'ffffffffffff',
            shortCommit: 'fffffff',
            timestamp: '2099-01-01T00:00:00.000Z',
            message: 'New test update'
          }),
          { status: 200 }
        );
      }) as typeof fetch;

      const status = await runAutoUpdate();
      return { status, nativeCalls, reloadSpy, store };
    };

    const autoOn = await runScenario(true);
    expect(autoOn.nativeCalls.some(c => c.type === 'update')).toBe(true);
    expect(autoOn.status.state).toBe('updated');
    expect(autoOn.store[JUST_UPDATED_KEY]?.toBuild).toBe('ffffffffffff');
    expect(autoOn.reloadSpy).toHaveBeenCalledTimes(1);

    const autoOff = await runScenario(false);
    expect(autoOff.nativeCalls.some(c => c.type === 'update')).toBe(false);
    expect(autoOff.status.state).toBe('update-available');
    expect(autoOff.store[JUST_UPDATED_KEY]).toBeUndefined();
    expect(autoOff.reloadSpy).not.toHaveBeenCalled();
  });

  if (process.platform === 'win32') {
    it('deletes all stale files not listed in the new build (even outside old version.json)', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bbs-updater-clean-'));
      try {
        fs.mkdirSync(path.join(tmp, 'assets'), { recursive: true });
        fs.mkdirSync(path.join(tmp, 'old-empty-dir', 'nested'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'manifest.json'), '{}');
        fs.writeFileSync(path.join(tmp, 'version.json'), '{}');
        fs.writeFileSync(path.join(tmp, 'assets', 'popup-NEWHASH.js'), 'new');
        fs.writeFileSync(path.join(tmp, 'assets', 'popup-OLDHASH.js'), 'stale');
        fs.writeFileSync(path.join(tmp, 'old-empty-dir', 'nested', 'obsolete.txt'), 'stale2');

        const ps1 = read('updater/blackboarder-updater.ps1');
        const fnStart = ps1.indexOf('function Remove-StaleExtensionFiles');
        const fnEnd = ps1.indexOf('function Update-ExtensionFiles');
        expect(fnStart).toBeGreaterThan(-1);
        const fnSource = ps1.slice(fnStart, fnEnd);

        const runner = path.join(os.tmpdir(), `bbs-test-${Date.now()}.ps1`);
        fs.writeFileSync(
          runner,
          `${fnSource}\nRemove-StaleExtensionFiles -TargetDir '${tmp.replace(/'/g, "''")}' -KeepFiles @('manifest.json','assets/popup-NEWHASH.js')\n`,
          'utf8'
        );
        try {
          execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runner], { stdio: 'pipe' });
        } finally {
          fs.rmSync(runner, { force: true });
        }

        expect(fs.existsSync(path.join(tmp, 'manifest.json'))).toBe(true);
        expect(fs.existsSync(path.join(tmp, 'version.json'))).toBe(true);
        expect(fs.existsSync(path.join(tmp, 'assets', 'popup-NEWHASH.js'))).toBe(true);
        expect(fs.existsSync(path.join(tmp, 'assets', 'popup-OLDHASH.js'))).toBe(false);
        expect(fs.existsSync(path.join(tmp, 'old-empty-dir'))).toBe(false);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  }
});
