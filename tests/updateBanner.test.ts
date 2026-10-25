import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { describeUpdateBanner, isUpdateStatusFresh, UPDATE_STATUS_FRESH_MS } from '../src/utils/updateBanner';
import type { AutoUpdateStatus } from '../src/background/autoUpdate';

function status(extra: Partial<AutoUpdateStatus>): AutoUpdateStatus {
  return {
    state: 'up-to-date',
    helperInstalled: true,
    installedBuild: 'aaaaaaaaaaaa',
    remoteBuild: 'bbbbbbbbbbbb',
    checkedAt: '2026-10-22T10:00:00.000Z',
    ...extra
  };
}

describe('update banner', () => {
  it('asks for a restart as soon as the new files are installed, and cannot be dismissed', () => {
    const banner = describeUpdateBanner(status({ state: 'updated' }), 'bbbbbbbbbbbb');
    expect(banner?.primary).toBe('restart');
    expect(banner?.dismissible).toBe(false);
  });

  it('tells a git clone why the update was not pulled instead of hiding it', () => {
    const banner = describeUpdateBanner(status({ state: 'dev-checkout', error: 'The git clone has uncommitted changes, so it was not updated.' }));
    expect(banner?.desc).toContain('uncommitted changes');
    expect(banner?.primary).toBe('none');
  });

  it('offers the ZIP only when the update helper is not set up', () => {
    expect(describeUpdateBanner(status({ state: 'update-available', helperInstalled: false }))?.primary).toBe('download');
    expect(describeUpdateBanner(status({ state: 'update-available', helperInstalled: true }))?.primary).toBe('none');
  });

  it('respects "Later" for a build, but shows the next build again', () => {
    expect(describeUpdateBanner(status({ state: 'update-available' }), 'bbbbbbbbbbbb')).toBeNull();
    expect(describeUpdateBanner(status({ state: 'update-available', remoteBuild: 'cccccccccccc' }), 'bbbbbbbbbbbb')).not.toBeNull();
  });

  it('shows nothing when up to date or offline', () => {
    expect(describeUpdateBanner(status({ state: 'up-to-date' }))).toBeNull();
    expect(describeUpdateBanner(status({ state: 'offline' }))).toBeNull();
    expect(describeUpdateBanner(null)).toBeNull();
  });
});

describe('when the popup checks GitHub again', () => {
  const now = Date.parse('2026-10-22T10:00:00.000Z');
  it('re-checks unless the saved result is a couple of minutes old at most', () => {
    expect(isUpdateStatusFresh(status({}), 'aaaaaaaaaaaa', now + 30_000)).toBe(true);
    expect(isUpdateStatusFresh(status({}), 'aaaaaaaaaaaa', now + UPDATE_STATUS_FRESH_MS + 1)).toBe(false);
    expect(isUpdateStatusFresh(status({}), 'otherbuild', now)).toBe(false);
    expect(isUpdateStatusFresh(null, 'aaaaaaaaaaaa', now)).toBe(false);
  });

  it('checks every 15 minutes in the background and replaces the old hourly alarm', () => {
    const src = fs.readFileSync('src/background/autoUpdate.ts', 'utf8');
    expect(src).toContain('const CHECK_PERIOD_MINUTES = 15;');
    expect(src).toContain('existing.periodInMinutes !== CHECK_PERIOD_MINUTES');
  });
});
