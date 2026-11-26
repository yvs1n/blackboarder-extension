import type { DeadlineTask, TaskArabicMirror } from '../types';
import { buildTaskArabicMirror, computeTaskTranslationSig } from '../core/arabicTranslator';
import { aiRequestHeaders, parseAiJson, type AiEndpoint } from './aiProviders';
import { isExtensionContextValid } from '../utils/storage';

/**
 * Translates any new or updated tasks lacking an up-to-date AI Arabic mirror using the user's
 * configured AI endpoint (extension direct/background or mobile `/api/ai/extract`).
 * Safe fallback: tasks already carry offline Arabic mirrors via `buildTaskArabicMirror`, so any
 * network failure leaves tasks readable in Arabic without failing.
 */
export async function translateTasksToArabicWithAi(
  tasks: DeadlineTask[],
  endpoint: AiEndpoint | null,
  maxBatch = 18
): Promise<DeadlineTask[]> {
  if (!Array.isArray(tasks) || tasks.length === 0) return tasks || [];
  if (!endpoint) return tasks.map(t => ({ ...t, ar: buildTaskArabicMirror(t) }));

  const candidates = tasks.filter(t => {
    if (!t || t.status === 'dismissed') return false;
    const sig = computeTaskTranslationSig(t);
    return !t.ar || t.ar.sourceSig !== sig || t.ar.translatedBy === 'local';
  }).slice(0, maxBatch);

  if (candidates.length === 0) return tasks;

  const viaServer = endpoint.provider === 'server';
  const payloadItems = candidates.map(t => ({
    id: t.id,
    courseName: t.courseName,
    title: t.title,
    brief: t.summary?.brief || '',
    topics: t.summary?.topics || '',
    formatRules: t.summary?.formatRules || '',
    description: (t.description || t.sourceSnippet || '').slice(0, 700)
  }));

  const body: Record<string, unknown> = {
    ...(viaServer ? {} : { model: endpoint.model }),
    messages: [
      {
        role: 'system',
        content: 'You translate university course deadline cards and professor announcements from English into clear, natural Modern Standard Arabic for Arabic-speaking university students. Preserve course codes, room numbers, numbers, and [Professor Update] order (as [تحديث الأستاذ]). If text is already Arabic, keep it clear and natural. Return strict JSON: { "translations": [{ "id": string, "title": string, "courseName": string, "brief": string|null, "topics": string|null, "formatRules": string|null, "description": string|null }] }.'
      },
      { role: 'user', content: JSON.stringify({ items: payloadItems }) }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 2600
  };

  try {
    let rawJson: any = null;
    if (viaServer) {
      const res = await fetch(endpoint.chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, syncKey: endpoint.syncKey, aiPass: endpoint.aiPass })
      });
      const wrapped = await res.json().catch(() => null);
      if (res.ok && wrapped?.ok) rawJson = wrapped.data;
    } else if (typeof window !== 'undefined' && window.location?.protocol !== 'chrome-extension:' && isExtensionContextValid()) {
      const proxy = await new Promise<any>(resolve => {
        chrome.runtime.sendMessage(
          { type: 'PROXY_OPENROUTER_CHAT', body, apiKey: endpoint.apiKey, provider: endpoint.provider, url: endpoint.chatUrl },
          r => { void chrome.runtime.lastError; resolve(r); }
        );
      });
      if (proxy?.ok) rawJson = proxy.data;
    } else {
      const res = await fetch(endpoint.chatUrl, {
        method: 'POST',
        headers: aiRequestHeaders(endpoint.provider, endpoint.apiKey),
        body: JSON.stringify(body)
      });
      if (res.ok) rawJson = await res.json().catch(() => null);
    }

    const content = rawJson?.choices?.[0]?.message?.content;
    if (!content) return tasks;
    const parsed: any = parseAiJson(content);
    const list: any[] = Array.isArray(parsed?.translations) ? parsed.translations : [];
    const byId = new Map<string, Partial<TaskArabicMirror>>();
    for (const item of list) {
      if (!item?.id || typeof item.id !== 'string') continue;
      byId.set(item.id, {
        ...(typeof item.title === 'string' && item.title.trim() ? { title: item.title.trim() } : {}),
        ...(typeof item.courseName === 'string' && item.courseName.trim() ? { courseName: item.courseName.trim() } : {}),
        ...(typeof item.brief === 'string' && item.brief.trim() ? { brief: item.brief.trim() } : {}),
        ...(typeof item.topics === 'string' && item.topics.trim() ? { topics: item.topics.trim() } : {}),
        ...(typeof item.formatRules === 'string' && item.formatRules.trim() ? { formatRules: item.formatRules.trim() } : {}),
        ...(typeof item.description === 'string' && item.description.trim() ? { description: item.description.trim() } : {})
      });
    }
    if (byId.size === 0) return tasks;

    const nowIso = new Date().toISOString();
    return tasks.map(t => {
      const patch = byId.get(t.id);
      if (!patch) return t;
      return {
        ...t,
        ar: buildTaskArabicMirror(t, patch),
        updatedAt: nowIso
      };
    });
  } catch {
    return tasks;
  }
}
