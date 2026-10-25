import { Announcement, DeadlineTask, TaskType, TaskPriority } from '../types';
import { resolveTaskTimeWithSchedule, resolveTaskRoom } from '../core/courseSchedule';
import { sanitizeDoctorAnnouncementText } from '../core/courseHelper';
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

/**
 * Extracts deadlines and academic tasks from an announcement with the generative AI the student
 * picked: OpenRouter by default, or IFM or any OpenAI-compatible service through `endpoint`.
 */
export async function extractDeadlinesWithAi(
  announcement: Announcement,
  apiKey: string,
  model: string = 'google/gemini-3.8-flash',
  hint?: {
    category?: TaskType;
    priority?: TaskPriority;
    hasRoom?: boolean;
    hasTime?: boolean;
  },
  endpoint: Pick<AiEndpoint, 'provider' | 'chatUrl' | 'syncKey' | 'aiPass'> = { provider: 'openrouter', chatUrl: OPENROUTER_CHAT_URL }
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
1. NEVER USE THE "Posted Date" AS THE DEADLINE OR ASSESSMENT TIME! The posted date is strictly metadata indicating when the doctor published the announcement.
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
      "title": "Short title, e.g., Midterm Exam",
      "dueDate": "2026-10-12T12:30:00",
      "hasSpecificTime": true,
      "type": "quiz" | "assignment" | "exam" | "project" | "lab" | "meeting" | "other",
      "priority": "high" | "medium" | "low",
      "room": "A8-204 (or specific room/lab if mentioned by doctor, otherwise null)",
      "description": "Clean explanation or instructions written by the doctor",
      "sourceSnippet": "Exact text sentence mentioning the deadline"
    }
  ]
}
6. If the doctor mentions a specific classroom, hall, or lab to attend in (e.g. "room A8-204", "hall TH005", "Lab 3", "قاعة 103", "مختبر 105"), extract it into "room". Otherwise set "room" to null.
If no deadlines or tasks are found, return { "deadlines": [] }. Output valid JSON only.`;

  const cleanBody = sanitizeDoctorAnnouncementText(
    announcement.contentText,
    announcement.courseName,
    announcement.courseCode,
    announcement.title
  );

  const hintLines: string[] = [];
  if (hint?.category) {
    hintLines.push(`Assessment Type: "${hint.category}" with priority: "${hint.priority || 'medium'}". Use this type unless clear evidence indicates otherwise.`);
  }
  if (hint?.hasRoom !== undefined) {
    hintLines.push(
      hint.hasRoom
        ? 'Doctor mentions an explicit room/location in text: YES (You MUST extract this exact room/hall/lab into "room").'
        : 'Doctor mentions an explicit room/location in text: NO (Leave "room" as null; do not guess or hallucinate a room so the schedule default room is preserved).'
    );
  }
  if (hint?.hasTime !== undefined) {
    hintLines.push(
      hint.hasTime
        ? 'Doctor states an explicit clock time: YES (Extract the start time and set "hasSpecificTime": true).'
        : 'Doctor states an explicit clock time: NO (Set "hasSpecificTime": false so the schedule class time is preserved).'
    );
  }

  const hintBlock = hintLines.length > 0 ? `PRE-CLASSIFICATION GUIDANCE (from the announcement wording):\n${hintLines.map(h => `- ${h}`).join('\n')}\n` : '';

  const userContent = `Course: ${announcement.courseCode} ${announcement.courseName}
Announcement Title: ${announcement.title}
Posted Date (METADATA ONLY - DO NOT USE AS ASSESSMENT TIME): ${announcement.postedAt || 'Unknown'}
${hintBlock}Doctor's Announcement Body:
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
      let response: Response | null = null;
      let data: OpenRouterResponse | null = null;

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
          return [];
        }
        data = json.data as OpenRouterResponse;
      }

      const isContentScript =
        typeof window !== 'undefined' &&
        window.location?.protocol !== 'chrome-extension:' &&
        (window.location?.protocol === 'http:' || window.location?.protocol === 'https:') &&
        isExtensionContextValid();

      if (!data && isContentScript) {
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
        response = await post(requestPayload);

        // Some OpenAI-compatible services refuse JSON mode; ask again without it
        if (response.status === 400 && !isOpenRouter) {
          const { response_format: _omit, ...plain } = requestPayload;
          response = await post(plain);
        }

        if (!response.ok) {
          const errText = await response.text();
          console.warn(`[AI] Model ${currentModel} returned status ${response.status}:`, errText);
          continue;
        }

        data = (await response.json()) as OpenRouterResponse;
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content) continue;

      const parsed: any = parseAiJson(content);

      const rawItems: unknown = Array.isArray(parsed) ? parsed : (parsed.deadlines || (parsed as any).tasks);
      if (!Array.isArray(rawItems)) {
        return [];
      }

      // An item without a usable date would otherwise be created as "due right now"
      const validItems = (rawItems as AiExtractedItem[]).filter(
        item => item && !isNaN(new Date(item.dueDate).getTime())
      );

      return validItems.map(item => {
        const validDate = new Date(item.dueDate);
        const fullDoctorText = cleanBody || announcement.contentText || item.description || announcement.title;

        const scheduleRes = resolveTaskTimeWithSchedule({
          dueDate: validDate,
          courseNameOrCode: announcement.courseName || item.courseCode || announcement.courseCode,
          hasSpecificTime: Boolean(item.hasSpecificTime),
          announcementText: cleanBody,
          title: item.title
        });

        const resolvedType = (item.type && item.type !== 'other')
          ? (item.type as TaskType)
          : (hint?.category && hint.category !== 'other'
              ? hint.category
              : (item.type as TaskType || 'other'));

        const roomInfo = resolveTaskRoom({
          courseNameOrCode: announcement.courseName || item.courseCode || announcement.courseCode,
          announcementText: cleanBody,
          title: item.title,
          existingRoom: item.room,
          type: resolvedType
        });

        const resolvedPriority = item.priority || hint?.priority || 'medium';

        return {
          id: `task_ai_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          announcementId: announcement.id,
          courseCode: item.courseCode || announcement.courseCode,
          courseName: announcement.courseName,
          title: item.title || 'Extracted Task',
          description: fullDoctorText,
          dueDate: scheduleRes.dueDate.toISOString(),
          hasSpecificTime: scheduleRes.hasSpecificTime,
          type: resolvedType,
          priority: resolvedPriority,
          status: 'pending',
          sourceSnippet: fullDoctorText,
          notes: (item.description && item.description !== fullDoctorText) ? item.description : undefined,
          confidence: 0.95,
          extractedBy: 'ai',
          room: roomInfo.room || undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      });
    } catch (error) {
      console.warn(`Failed with model ${currentModel}:`, error);
    }
  }

  return [];
}
