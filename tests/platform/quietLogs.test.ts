import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Brave/Chrome list every console.warn from the extension on its Errors page, so expected
// situations (a course refusing, a reloaded extension, an AI fallback) must not warn.
describe('expected situations stay off the extension Errors page', () => {
  const read = (f: string) => fs.readFileSync(f, 'utf8');

  it('does not warn when a course announcement request fails or the extension was reloaded', () => {
    const src = read('src/content/scraper.ts');
    expect(src).not.toMatch(/console\.warn\([^)]*REST API fetch unavailable/);
    expect(src).not.toMatch(/console\.warn\([^)]*Extension context invalidated/);
  });

  it('catches a missing reply to the Alt+B shortcut message', () => {
    expect(read('src/content/scraper.ts')).toContain("chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {});");
  });

  it('logs AI and classifier fallbacks as info', () => {
    for (const f of ['src/engine/aiExtractor.ts', 'src/engine/hybridExtractor.ts']) {
      expect(read(f)).not.toMatch(/console\.warn\([^)]*(?:falling back|not configured|refinement failed)/i);
    }
  });
});
