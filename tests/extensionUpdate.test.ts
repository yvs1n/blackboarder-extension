import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isRemoteNewer } from '../src/utils/updateChecker';
import { NATIVE_HOST_NAME } from '../src/background/autoUpdate';
import { BUILD_INFO } from '../src/buildInfo';

const read = (rel: string) => fs.readFileSync(path.resolve(rel), 'utf8');

describe('Extension automatic updates', () => {
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

  it('ships the updater with the built extension', () => {
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
  });
});
