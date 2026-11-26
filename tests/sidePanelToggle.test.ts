// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  applySidePanelBehavior,
  isSidePanelBehaviorSupported,
  openCurrentWindowSidePanel
} from '../src/utils/sidePanel';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Extension Sidebar (Side Panel) Toggle', () => {
  it('hides the Side Panel toggle row by default in HTML and detects browser API support dynamically', async () => {
    const html = fs.readFileSync('src/popup/index.html', 'utf8');
    expect(html).toContain('id="row-setting-sidepanel"');
    expect(html).toContain('id="setting-open-sidepanel"');
    expect(html).toMatch(/id="row-setting-sidepanel"[^>]*hidden/);

    // Unsupported browser (e.g. Firefox or older Chromium without sidePanel.setPanelBehavior)
    vi.stubGlobal('chrome', {});
    expect(isSidePanelBehaviorSupported()).toBe(false);
    expect(await applySidePanelBehavior(true)).toBe(false);

    // Supported Chromium / Edge browser
    const setPanelBehavior = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn().mockResolvedValue(undefined);
    const getCurrent = vi.fn().mockResolvedValue({ id: 42 });
    vi.stubGlobal('chrome', {
      sidePanel: { setPanelBehavior, open },
      windows: { getCurrent }
    });

    expect(isSidePanelBehaviorSupported()).toBe(true);
    expect(await applySidePanelBehavior(true)).toBe(true);
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });

    expect(await applySidePanelBehavior(false)).toBe(true);
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: false });

    expect(await openCurrentWindowSidePanel()).toBe(true);
    expect(open).toHaveBeenCalledWith({ windowId: 42 });
  });
});
