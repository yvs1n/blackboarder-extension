import { UserSettings, AiProvider } from '../types';

/**
 * Where the generative AI step sends its request. Every provider speaks the OpenAI
 * chat-completions format, so only the URL, key and model differ.
 */
export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const IFM_BASE_URL = 'https://api.ifm.ai/v1';
export const IFM_MODEL = 'IFM/K2-Horizon-375B-A23B';
export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-3.8-flash';

export type AiSettings = Partial<Pick<
  UserSettings,
  'openRouterApiKey' | 'openRouterModel' | 'aiProvider' | 'ifmApiKey' | 'customAiBaseUrl' | 'customAiApiKey' | 'customAiModel'
>> & {
  useAiExtraction: boolean;
  /** Web app only: the server that holds the extension's key, locked, reached by sync key */
  aiServer?: { url: string; syncKey: string; aiPass: string };
};

/** 'server' is the web app's route: its server adds the extension's key and model. */
export type AiRoute = AiProvider | 'server';

export interface AiEndpoint {
  provider: AiRoute;
  chatUrl: string;
  apiKey: string;
  model: string;
  syncKey?: string;
  aiPass?: string;
}

/**
 * Turns what the student typed ("api.example.com/v1/", ".../v1/chat/completions") into a base URL
 * ending before /chat/completions. Only https is accepted, except for a model running on this computer.
 */
export function normalizeAiBaseUrl(raw: string | undefined): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return '';
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return '';
  const path = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  return `${url.origin}${path}`;
}

export function chatUrlFor(baseUrl: string): string {
  return `${baseUrl}/chat/completions`;
}

/** The provider the student picked, with its key. Null when that provider has no key or URL yet. */
export function resolveAiEndpoint(settings: Partial<AiSettings>): AiEndpoint | null {
  if (settings.aiServer) {
    const { url, syncKey, aiPass } = settings.aiServer;
    return url && syncKey && aiPass ? { provider: 'server', chatUrl: url, apiKey: '', model: '', syncKey, aiPass } : null;
  }
  const provider: AiProvider = settings.aiProvider || 'openrouter';
  if (provider === 'ifm') {
    const apiKey = (settings.ifmApiKey || '').trim();
    return apiKey ? { provider, chatUrl: chatUrlFor(IFM_BASE_URL), apiKey, model: IFM_MODEL } : null;
  }
  if (provider === 'custom') {
    const base = normalizeAiBaseUrl(settings.customAiBaseUrl);
    const apiKey = (settings.customAiApiKey || '').trim();
    const model = (settings.customAiModel || '').trim();
    return base && apiKey && model ? { provider, chatUrl: chatUrlFor(base), apiKey, model } : null;
  }
  const apiKey = (settings.openRouterApiKey || '').trim();
  return apiKey
    ? { provider: 'openrouter', chatUrl: OPENROUTER_CHAT_URL, apiKey, model: settings.openRouterModel || DEFAULT_OPENROUTER_MODEL }
    : null;
}

/**
 * IFM refuses requests that carry a browser Origin header ("model_origin_not_allowed", shown as
 * "The model ... is not available"), and a browser always adds one. This rule removes it from the
 * extension's own requests to api.ifm.ai. Websites' requests are left alone.
 */
export const IFM_ORIGIN_RULE_ID = 4101;
export function ifmOriginRule(extensionId: string): chrome.declarativeNetRequest.Rule {
  return {
    id: IFM_ORIGIN_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
      requestHeaders: [{ header: 'origin', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation }]
    },
    condition: {
      urlFilter: '||api.ifm.ai/',
      initiatorDomains: [extensionId],
      resourceTypes: ['xmlhttprequest' as chrome.declarativeNetRequest.ResourceType, 'other' as chrome.declarativeNetRequest.ResourceType]
    }
  };
}

/** Request headers. OpenRouter's attribution headers are only sent to OpenRouter. */
export function aiRequestHeaders(provider: AiRoute, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://blackboarder.local';
    headers['X-Title'] = 'Blackboarder Extension';
  }
  return headers;
}

/** Only chat-completions URLs over https (or a local model) may be called through the service worker. */
export function isAllowedAiChatUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !/\/chat\/completions$/.test(url)) return false;
  return normalizeAiBaseUrl(url) !== '' && chatUrlFor(normalizeAiBaseUrl(url)) === url;
}

/**
 * Reads the model's JSON answer. Reasoning models (K2 Horizon) may wrap it in <think> blocks
 * or code fences, so the outermost {...} or [...] is taken.
 */
export function parseAiJson(content: string): any {
  const text = String(content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  try {
    return JSON.parse(text);
  } catch {}
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(unfenced);
  } catch {}
  const start = unfenced.search(/[{[]/);
  const end = Math.max(unfenced.lastIndexOf('}'), unfenced.lastIndexOf(']'));
  if (start >= 0 && end > start) return JSON.parse(unfenced.slice(start, end + 1));
  throw new Error('AI reply was not JSON');
}

/** Sends one tiny request so the student knows the key, URL and model work. */
export async function testAiEndpoint(endpoint: AiEndpoint): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(endpoint.chatUrl, {
      method: 'POST',
      headers: aiRequestHeaders(endpoint.provider, endpoint.apiKey),
      body: JSON.stringify({
        model: endpoint.model,
        messages: [{ role: 'user', content: 'Reply with the word ok.' }],
        max_tokens: 400
      })
    });
    if (res.ok) return { ok: true, message: `Connected to ${endpoint.model}` };
    const text = await res.text().catch(() => '');
    let detail = '';
    let code = '';
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message || j?.message || '';
      code = j?.error?.code || '';
    } catch {}
    if (code === 'model_origin_not_allowed') {
      return { ok: false, message: 'IFM refused the browser request. Reload the extension (it removes the header IFM blocks), then test again.' };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, message: `Key refused (${res.status})${detail ? ': ' + detail : ''}` };
    return { ok: false, message: `Error ${res.status}${detail ? ': ' + detail : ''}` };
  } catch (err) {
    return { ok: false, message: `Could not reach ${new URL(endpoint.chatUrl).host}` };
  }
}
