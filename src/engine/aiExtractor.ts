import { Announcement, DeadlineTask, TaskType, TaskPriority } from '../types';
import { resolveTaskTimeWithSchedule, resolveTaskRoom } from '../core/courseSchedule';
import { sanitizeDoctorAnnouncementText, toEnglishDeadlineTitle } from '../core/courseHelper';
import { isExtensionContextValid } from '../utils/storage';
import { AiEndpoint, OPENROUTER_CHAT_URL, DEFAULT_OPENROUTER_MODEL, aiRequestHeaders, parseAiJson } from './aiProviders';

interface AiExtractedItem {
  title: string;
  courseCode?: string;
  dueDate: string; // ISO 8601 string: YYYY-MM-DDTHH:mm:ss
  hasSpecificTime?: boolean;
  type: 'quiz' | 'assignment' | 'exam' | 'project' | 'lab' | 'meeting' | 'other';
  priority: 'high' | 'medium' | 'low';
  description?: string;
  sourceSnippet: string;
  room?: string;
  summary?: {
    topics?: string;
    formatRules?: string;
    brief?: string;
  };
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message: string;
  };
}

interface AiHint {
  category?: TaskType;
  priority?: TaskPriority;
  hasRoom?: boolean;
  hasTime?: boolean;
}

type AiTransportEndpoint = Pick<AiEndpoint, 'provider' | 'chatUrl' | 'syncKey' | 'aiPass'>;

function buildHintBlock(hint?: AiHint): string {
  const hintLines: string[] = [];
  if (hint?.category) {
    hintLines.push(`Assessment Type: "${hint.category}" with priority: "${hint.priority || 'medium'}". Use this type unless clear evidence indicates otherwise.`);
  }
  if (hint?.hasRoom !== undefined) {
    hintLines.push(
      hint.hasRoom
        ? 'Professor mentions an explicit room/location in text: YES (You MUST extract this exact room/hall/lab into "room").'
        : 'Professor mentions an explicit room/location in text: NO (Leave "room" as null; do not guess or hallucinate a room so the schedule default room is preserved).'
    );
  }
  if (hint?.hasTime !== undefined) {
    hintLines.push(
      hint.hasTime
        ? 'Professor states an explicit clock time: YES (Extract the start time and set "hasSpecificTime": true).'
        : 'Professor states an explicit clock time: NO (Set "hasSpecificTime": false so the schedule class time is preserved).'
    );
  }
  return hintLines.length > 0 ? `PRE-CLASSIFICATION GUIDANCE (from the announcement wording):\n${hintLines.map(h => `- ${h}`).join('\n')}\n` : '';
}

async function requestAiChatJson(
  requestPayload: Record<string, unknown>,
  apiKey: string,
  endpoint: AiTransportEndpoint,
  viaServer: boolean,
  isOpenRouter: boolean
): Promise<{ ok: boolean; fatal?: boolean; data?: OpenRouterResponse }> {
  if (viaServer) {
    // Same prompt and parsing as the extension; the server only adds the key and model
    const { model: _model, ...forServer } = requestPayload;
    const res = await fetch(endpoint.chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...forServer, syncKey: endpoint.syncKey, aiPass: endpoint.aiPass })
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok || !json.data) {
      console.info('[AI] Server AI unavailable:', json?.error || res.status);
      return { ok: false, fatal: true };
    }
    return { ok: true, data: json.data as OpenRouterResponse };
  }

  let data: OpenRouterResponse | null = null;
  const isContentScript =
    typeof window !== 'undefined' &&
    window.location?.protocol !== 'chrome-extension:' &&
    (window.location?.protocol === 'http:' || window.location?.protocol === 'https:') &&
    isExtensionContextValid();

  if (isContentScript) {
    try {
      const bgResp = await new Promise<any>((resolve, reject) => {
        try {
          if (!isExtensionContextValid()) {
            reject(new Error('Extension context invalidated'));
            return;
          }
          chrome.runtime.sendMessage(
            {
              type: 'PROXY_OPENROUTER_CHAT',
              body: requestPayload,
              apiKey: apiKey.trim(),
              provider: endpoint.provider,
              url: endpoint.chatUrl
            },
            response => {
              try {
                if (chrome.runtime?.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve(response);
                }
              } catch (cbErr) {
                reject(cbErr);
              }
            }
          );
        } catch (callErr) {
          reject(callErr);
        }
      });
      if (bgResp && bgResp.ok && bgResp.data) {
        data = bgResp.data as OpenRouterResponse;
      }
    } catch (e: any) {
      if (e?.message?.includes('Extension context invalidated')) {
        console.info('[OpenRouter AI] Extension context invalidated; falling back to direct fetch.');
      } else {
        console.info('[OpenRouter AI] Service worker proxy failed, falling back:', String(e));
      }
    }
  }

  if (!data) {
    const post = (payload: Record<string, unknown>) => fetch(endpoint.chatUrl, {
      method: 'POST',
      headers: aiRequestHeaders(endpoint.provider, apiKey.trim()),
      body: JSON.stringify(payload)
    });
    let response = await post(requestPayload);

    // Some OpenAI-compatible services refuse JSON mode; ask again without it
    if (response.status === 400 && !isOpenRouter) {
      const { response_format: _omit, ...plain } = requestPayload;
      response = await post(plain);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[AI] Model ${String(requestPayload.model || '')} returned status ${response.status}:`, errText);
      return { ok: false };
    }

    data = (await response.json()) as OpenRouterResponse;
  }

  return { ok: true, data };
}

function mapAiItemsToTasks(
  validItems: AiExtractedItem[],
  announcement: Announcement,
  cleanBody: string,
  hint?: AiHint
): DeadlineTask[] {
  const combinedText = `${announcement.title || ''}\n${cleanBody}`.trim();
  return validItems.map(item => {
    const validDate = new Date(item.dueDate);
    const fullDoctorText = cleanBody || announcement.contentText || item.description || announcement.title;
    const explicitTime = Boolean(item.hasSpecificTime);

    const scheduleRes = resolveTaskTimeWithSchedule({
      dueDate: validDate,
      courseNameOrCode: announcement.courseName || item.courseCode || announcement.courseCode,
      hasSpecificTime: explicitTime,
      announcementText: combinedText,
      title: item.title
    });

    const resolvedType = (item.type && item.type !== 'other')
      ? (item.type as TaskType)
      : (hint?.category && hint.category !== 'other'
          ? hint.category
          : (item.type as TaskType || 'other'));

    const roomInfo = resolveTaskRoom({
      courseNameOrCode: announcement.courseName || item.courseCode || announcement.courseCode,
      announcementText: combinedText,
      title: item.title,
      existingRoom: item.room,
      type: resolvedType
    });

    const timeSource: DeadlineTask['timeSource'] = explicitTime
      ? 'explicit'
      : scheduleRes.appliedSchedule ? 'schedule' : 'default';

    const summaryObj = item.summary && typeof item.summary === 'object'
      ? {
          ...(typeof item.summary.topics === 'string' && item.summary.topics.trim() ? { topics: item.summary.topics.trim().slice(0, 260) } : {}),
          ...(typeof item.summary.formatRules === 'string' && item.summary.formatRules.trim() ? { formatRules: item.summary.formatRules.trim().slice(0, 260) } : {}),
          ...(typeof item.summary.brief === 'string' && item.summary.brief.trim() ? { brief: item.summary.brief.trim().slice(0, 360) } : {})
        }
      : undefined;
    const hasStructuredSummary = Boolean(summaryObj && (summaryObj.topics || summaryObj.formatRules || summaryObj.brief));

    return {
      id: `task_ai_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      announcementId: announcement.id,
      ...(announcement.postedAt ? { announcementPostedAt: announcement.postedAt } : {}),
      courseCode: item.courseCode || announcement.courseCode,
      courseName: announcement.courseName,
      title: toEnglishDeadlineTitle(item.title || 'Extracted Task', resolvedType),
      description: fullDoctorText,
      dueDate: scheduleRes.dueDate.toISOString(),
      hasSpecificTime: scheduleRes.hasSpecificTime,
      timeSource,
      type: resolvedType,
      priority: item.priority || hint?.priority || 'medium',
      status: 'pending',
      sourceSnippet: fullDoctorText,
      ...(hasStructuredSummary ? { summary: summaryObj } : {}),
      confidence: 0.95,
      extractedBy: 'ai',
      room: roomInfo.room || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });
}

/**
 * Extracts deadlines and academic tasks from an announcement with the generative AI the student
 * picked: OpenRouter by default, or IFM or any OpenAI-compatible service through `endpoint`.
 */
export async function extractDeadlinesWithAi(
  announcement: Announcement,
  apiKey: string,
  model: string = 'google/gemini-3.8-flash',
  hint?: AiHint,
  endpoint: AiTransportEndpoint = { provider: 'openrouter', chatUrl: OPENROUTER_CHAT_URL }
): Promise<DeadlineTask[]> {
  // The web app has no key: its server holds the extension's key, locked, and is reached by sync key
  const viaServer = endpoint.provider === 'server';
  if (viaServer ? !(endpoint.syncKey && endpoint.aiPass) : (!apiKey || !apiKey.trim())) {
    console.info('AI API key not configured.');
    return [];
  }
  const isOpenRouter = endpoint.provider === 'openrouter';

  const baseDate = announcement.postedAt ? new Date(announcement.postedAt) : new Date();
  const baseDateStr = baseDate.toISOString().slice(0, 10);

  const systemPrompt = `You are an expert academic assistant designed to extract due dates, assignments, quizzes, midterms, labs, exams, and projects from university Blackboard course announcements (English and Arabic).
Reference Context:
- Reference Date for relative terms ("tomorrow", "next Tuesday", "this Friday"): ${baseDateStr}.
- Current Year: ${baseDate.getFullYear()}.
- Course: ${announcement.courseCode} - ${announcement.courseName}.

CRITICAL TIME & DATE RULES:
1. NEVER USE THE "Posted Date" AS THE DEADLINE OR ASSESSMENT TIME! The posted date is strictly metadata indicating when the professor published the announcement.
2. If the instructor states an explicit time or range for the quiz/exam/class (e.g. "from 12:30 pm to 13:30 pm", "at 11:00 am", "12:30 - 1:30 pm", "من 12:30 إلى 13:30"):
   - Extract the START time of the assessment (e.g. 12:30:00).
   - Set "hasSpecificTime": true.
3. If NO specific time of day is stated by the instructor:
   - Set "hasSpecificTime": false.
   - For quizzes and exams without an explicit time, use 10:00:00 as a placeholder.
   - For homework/assignments/submissions without an explicit time, use 23:59:00 as a placeholder.
4. Calculate exact ISO 8601 timestamps (format: "YYYY-MM-DDTHH:mm:00").
5. Return a strict JSON object with key "deadlines" containing an array of objects matching this schema:
{
  "deadlines": [
    {
      "title": "Short concise English title, e.g., Midterm Exam, Quiz 1, Homework 2",
      "dueDate": "2026-10-12T12:30:00",
      "hasSpecificTime": true,
      "type": "quiz" | "assignment" | "exam" | "project" | "lab" | "meeting" | "other",
      "priority": "high" | "medium" | "low",
      "room": "A8-204 (or specific room/lab if mentioned by professor, otherwise null)",
      "description": "Clean explanation or instructions written by the professor",
      "sourceSnippet": "Exact text sentence mentioning the deadline",
      "summary": {
        "topics": "Covered chapters/topics/lectures if mentioned, otherwise null",
        "formatRules": "Format, duration, calculator/book rules, ID requirement if mentioned, otherwise null",
        "brief": "1 concise sentence summarizing the key action or update"
      }
    }
  ]
}
6. CRITICAL LANGUAGE RULE: All deadline titles MUST be in English (e.g. 'Midterm Exam', 'Quiz 1', 'Homework 2', 'Final Exam', 'Course Project'). Even if the announcement is in Arabic, translate and standardize the title into concise English.
7. If the professor mentions a specific classroom, hall, or lab to attend in (e.g. "room A8-204", "hall TH005", "Lab 3", "قاعة 103", "مختبر 105"), extract it into "room". Otherwise set "room" to null.
8. DO NOT extract post-exam reviews, paper viewing sessions, Akkindi / bubble sheet checks, grade disputes, or answer key discussions where the exam has already concluded (e.g. "review your exam sheet", "Akkindi sheet", "paper viewing", "مراجعة أوراق الامتحان", "الاطلاع على ورقة الإجابة"). Only extract upcoming future assessments, exams to be taken, or work to be submitted.
If no deadlines or tasks are found, return { "deadlines": [] }. Output valid JSON only.`;

  const cleanBody = sanitizeDoctorAnnouncementText(
    announcement.contentText,
    announcement.courseName,
    announcement.courseCode,
    announcement.title
  );

  const hintBlock = buildHintBlock(hint);
  const userContent = `Course: ${announcement.courseCode} ${announcement.courseName}
Announcement Title: ${announcement.title}
Posted Date (METADATA ONLY - DO NOT USE AS ASSESSMENT TIME): ${announcement.postedAt || 'Unknown'}
${hintBlock}Professor's Announcement Body:
${cleanBody}`;

  // Fallback models only exist on OpenRouter; another provider runs just the model it was given
  const candidateModels = isOpenRouter
    ? [
        model || DEFAULT_OPENROUTER_MODEL,
        DEFAULT_OPENROUTER_MODEL,
        'google/gemini-3.7-flash',
        'google/gemini-flash-latest'
      ].filter((m, idx, arr) => arr.indexOf(m) === idx)
    : [model];

  for (const currentModel of candidateModels) {
    try {
      const requestPayload: Record<string, unknown> = {
        model: currentModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        // Reasoning models (K2 Horizon) spend tokens thinking before they write the JSON
        max_tokens: isOpenRouter ? 1000 : 4000
      };

      const res = await requestAiChatJson(requestPayload, apiKey, endpoint, viaServer, isOpenRouter);
      if (!res.ok) {
        if (res.fatal) return [];
        continue;
      }

      const content = res.data?.choices?.[0]?.message?.content;
      if (!content) continue;

      const parsed: any = parseAiJson(content);
      const rawItems: unknown = Array.isArray(parsed) ? parsed : (parsed.deadlines || (parsed as any).tasks);
      if (!Array.isArray(rawItems)) return [];

      // An item without a usable date would otherwise be created as "due right now"
      const validItems = (rawItems as AiExtractedItem[]).filter(
        item => item && !isNaN(new Date(item.dueDate).getTime())
      );

      return mapAiItemsToTasks(validItems, announcement, cleanBody, hint);
    } catch (error) {
      console.warn(`Failed with model ${currentModel}:`, error);
    }
  }

  return [];
}

/**
 * Confirmation / refinement pass: lets an optional AI model verify or fix ambiguous
 * dates, times, rooms, or titles already extracted by the primary built-in parser.
 * On any failure or unparseable output, returns ok: false with the untouched localTasks.
 */
export async function confirmDeadlinesWithAi(
  announcement: Announcement,
  localTasks: DeadlineTask[],
  apiKey: string,
  model: string = 'google/gemini-3.8-flash',
  hint?: AiHint,
  endpoint: AiTransportEndpoint = { provider: 'openrouter', chatUrl: OPENROUTER_CHAT_URL }
): Promise<{ ok: boolean; tasks: DeadlineTask[] }> {
  const viaServer = endpoint.provider === 'server';
  if (localTasks.length === 0 || (viaServer ? !(endpoint.syncKey && endpoint.aiPass) : (!apiKey || !apiKey.trim()))) {
    return { ok: false, tasks: localTasks };
  }
  const isOpenRouter = endpoint.provider === 'openrouter';
  const baseDate = announcement.postedAt ? new Date(announcement.postedAt) : new Date();
  const baseDateStr = baseDate.toISOString().slice(0, 10);

  const cleanBody = sanitizeDoctorAnnouncementText(
    announcement.contentText,
    announcement.courseName,
    announcement.courseCode,
    announcement.title
  );

  const candidates = localTasks.map(t => ({
    title: t.title,
    type: t.type,
    dueDate: t.dueDate,
    hasSpecificTime: t.timeSource === 'explicit',
    room: t.room || null
  }));

  const systemPrompt = `You verify and refine deadline extractions already produced by a deterministic university Blackboard parser (English and Arabic).
Reference Date: ${baseDateStr}. Course: ${announcement.courseCode} - ${announcement.courseName}.
Rules:
1. Review the candidate deadlines against the announcement text. Fix any wrong date, rescheduled time, missing explicit clock time ("hasSpecificTime": true only if the text explicitly states a time), missing/wrong room/hall/lab ("room": exact room token or null if not stated in text), or title translation.
2. Add any missed upcoming graded deadline if clearly present in the text; drop false positives (e.g. post-exam reviews or past score announcements).
3. Keep concise English titles and ISO 8601 timestamps ("YYYY-MM-DDTHH:mm:00"). Return ONLY valid JSON: { "deadlines": [...] }.`;

  const hintBlock = buildHintBlock(hint);
  const userContent = `Announcement Title: ${announcement.title}
Posted Date (METADATA ONLY): ${announcement.postedAt || 'Unknown'}
${hintBlock}Built-in Parser Candidates:
${JSON.stringify(candidates)}

Announcement Body:
${cleanBody}`;

  const payload: Record<string, unknown> = {
    model: isOpenRouter ? (model || DEFAULT_OPENROUTER_MODEL) : model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: isOpenRouter ? 1000 : 4000
  };

  try {
    const res = await requestAiChatJson(payload, apiKey, endpoint, viaServer, isOpenRouter);
    if (!res.ok) return { ok: false, tasks: localTasks };

    const content = res.data?.choices?.[0]?.message?.content;
    if (!content) return { ok: false, tasks: localTasks };

    const parsed: any = parseAiJson(content);
    const rawItems: unknown = Array.isArray(parsed) ? parsed : (parsed.deadlines || (parsed as any).tasks);
    if (!Array.isArray(rawItems)) return { ok: false, tasks: localTasks };

    const validItems = (rawItems as AiExtractedItem[]).filter(
      item => item && !isNaN(new Date(item.dueDate).getTime())
    );
    const confirmed = mapAiItemsToTasks(validItems, announcement, cleanBody, hint).map((task, idx) => {
      const localMatch = localTasks[idx] && localTasks[idx].type === task.type ? localTasks[idx] : localTasks.find(l => l.type === task.type);
      if (localMatch) {
        return {
          ...task,
          extractedBy: localMatch.extractedBy,
          weight: localMatch.weight,
          weightDisplay: localMatch.weightDisplay,
          syllabusNote: localMatch.syllabusNote,
          summary: task.summary || localMatch.summary
        };
      }
      return task;
    });
    return { ok: true, tasks: confirmed };
  } catch (err) {
    console.warn('[AI] Confirmation pass failed, keeping local parser output:', err);
    return { ok: false, tasks: localTasks };
  }
}
