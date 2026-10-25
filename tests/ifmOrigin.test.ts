import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import { ifmOriginRule, testAiEndpoint, IFM_MODEL } from '../src/engine/aiProviders';

describe('IFM refuses browser requests', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('the extension drops the Origin header only on its own requests to api.ifm.ai', () => {
    const rule = ifmOriginRule('abcdefghijklmnopabcdefghijklmnop');
    expect(rule.action).toEqual({ type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'remove' }] });
    expect(rule.condition.urlFilter).toBe('||api.ifm.ai/');
    expect(rule.condition.initiatorDomains).toEqual(['abcdefghijklmnopabcdefghijklmnop']);
  });

  it('the service worker installs the rule and the manifest allows it', () => {
    const sw = fs.readFileSync('src/background/serviceWorker.ts', 'utf8');
    expect(sw).toContain('addRules: [ifmOriginRule(chrome.runtime.id)]');
    const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
    expect(manifest.permissions).toContain('declarativeNetRequestWithHostAccess');
  });

  it('Test connection explains the origin refusal instead of blaming the model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: `The model "${IFM_MODEL}" is not available.`, code: 'model_origin_not_allowed' }
    }), { status: 403 })));
    const r = await testAiEndpoint({ provider: 'ifm', chatUrl: 'https://api.ifm.ai/v1/chat/completions', apiKey: 'test-key', model: IFM_MODEL });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Reload the extension');
  });
});
