import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

describe('Android extension manifest & responsive mobile popup CSS', () => {
  it('declares Firefox for Android and zero data collection permissions in manifest.json', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/manifest.json'), 'utf8'));
    expect(manifest.browser_specific_settings?.gecko?.data_collection_permissions).toEqual({
      required: ['none']
    });
    expect(manifest.browser_specific_settings?.gecko_android?.strict_min_version).toBeTruthy();
  });

  it('locks desktop popup dimensions at 480x600 while adapting to < 480px touch viewports on Android phones', () => {
    const baseCss = fs.readFileSync(path.join(ROOT, 'src/popup/styles/02-base.css'), 'utf8');
    const modalsCss = fs.readFileSync(path.join(ROOT, 'src/popup/styles/05-modals-weights.css'), 'utf8');
    const settingsCss = fs.readFileSync(path.join(ROOT, 'src/popup/styles/09-settings-courses.css'), 'utf8');

    expect(baseCss).toContain('width: 480px;');
    expect(baseCss).toContain('min-height: 600px;');
    expect(baseCss).toContain('@media (max-width: 479px) and (pointer: coarse)');
    expect(baseCss).toContain('height: 100dvh !important;');
    expect(modalsCss).toContain('.view-panel {\n  display: none;\n  width: 100%;');
    expect(settingsCss).toContain('@media (max-width: 420px)');
    expect(settingsCss).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
  });
});
