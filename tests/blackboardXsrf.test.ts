import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { xsrfFromBbRouter, needsXsrf, XSRF_HEADER } from '../src/utils/blackboardXsrf';
import { serviceWorkerFetch } from '../src/background/httpScanner';

/*
 * Blackboard answered the activity stream POST with 403 over HTTP: Learn wants the session's
 * XSRF token (the "xsrf:" part of the HttpOnly BbRouter cookie) in X-Blackboard-XSRF on POSTs.
 */
const ROUTER = 'expires:1793300000,id:ABC123,signature:deadbeef,site:f00d,timeout:10800,user:u1,v:2,xsrf:5b1c2d3e-aaaa-bbbb-cccc-0123456789ab';

describe('the XSRF token in the BbRouter cookie', () => {
  it('reads it from a plain or URL-encoded cookie value', () => {
    expect(xsrfFromBbRouter(ROUTER)).toBe('5b1c2d3e-aaaa-bbbb-cccc-0123456789ab');
    expect(xsrfFromBbRouter(encodeURIComponent(ROUTER))).toBe('5b1c2d3e-aaaa-bbbb-cccc-0123456789ab');
  });

  it('gives null when there is no token', () => {
    expect(xsrfFromBbRouter('expires:1,id:2,v:2')).toBeNull();
    expect(xsrfFromBbRouter('')).toBeNull();
    expect(xsrfFromBbRouter(undefined)).toBeNull();
  });

  it('is only needed on requests that are not GET or HEAD', () => {
    expect(needsXsrf()).toBe(false);
    expect(needsXsrf({ method: 'get' })).toBe(false);
    expect(needsXsrf({ method: 'HEAD' })).toBe(false);
    expect(needsXsrf({ method: 'POST' })).toBe(true);
  });
});

describe('the service worker fetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the token on the stream POST, reads the cookie once, and leaves GETs alone', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }));
    const readXsrf = vi.fn(async () => 'tok-1');
    const bb = serviceWorkerFetch('https://elearning.example.edu', readXsrf);

    await bb('/learn/api/v1/users/me');
    await bb('/learn/api/v1/streams/ultra', { method: 'POST', body: '{}' });
    await bb('/learn/api/v1/streams/ultra', { method: 'POST', body: '{}' });

    expect(calls[0].headers[XSRF_HEADER]).toBeUndefined();
    expect(calls[1].headers[XSRF_HEADER]).toBe('tok-1');
    expect(calls[2].headers[XSRF_HEADER]).toBe('tok-1');
    expect(calls[1].url).toBe('https://elearning.example.edu/learn/api/v1/streams/ultra');
    expect(readXsrf).toHaveBeenCalledTimes(1);
    expect(readXsrf).toHaveBeenCalledWith('https://elearning.example.edu');
  });

  it('still sends the POST without a token when the cookie cannot be read', async () => {
    const seen: Record<string, string>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return new Response('{}');
    }));
    await serviceWorkerFetch('https://elearning.example.edu', async () => null)('/learn/api/v1/streams/ultra', { method: 'POST' });
    expect(seen[0][XSRF_HEADER]).toBeUndefined();
  });
});

describe('the manifest', () => {
  it('asks for the cookies permission, which the HttpOnly session cookie needs', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'public', 'manifest.json'), 'utf8'));
    expect(manifest.permissions).toContain('cookies');
  });
});
