/**
 * Reads a syllabus or schedule with the student's own AI model, when one is set up. The extension
 * calls the provider directly; the phone goes through its server (`provider: 'server'`), which adds
 * the extension's locked key. The answer is cleaned by the same code as the built-in reader's.
 */
import { analyzeCourseDocument, sanitizeCourseDrafts, normalizeDocumentText, timeRangeIn, type CourseDraft } from '../core/courseDocument';
import { aiRequestHeaders, parseAiJson, type AiEndpoint } from './aiProviders';

/** The server accepts 20,000 characters per request, prompt included. */
const MAX_DOCUMENT_CHARS = 15000;

export const COURSE_IMPORT_PROMPT = `You read university course documents: a syllabus or a class schedule (timetable). Find every course in it.
Return only JSON in this shape:
{"courses":[{"courseCode":"CSC 201","courseName":"Data Structures","creditHours":3,"instructor":"Name or null",
"meetings":[{"days":["Sunday","Tuesday"],"start":"11:00","end":"12:15","room":"A8-103"}],
"assessments":[{"name":"Midterm Exam","weight":25,"count":null,"outOf":null}]}]}
Rules:
- meetings are the weekly class, lab or tutorial times only. Never office hours, exam dates or deadlines. Times are 24-hour HH:MM.
- days are full English day names. Banner letters: U Sunday, M Monday, T Tuesday, W Wednesday, R Thursday, F Friday, S Saturday.
- assessments are the graded parts and their percentage of the course grade (weight, 0 to 100). count is how many items share that weight (4 quizzes), outOf is how many are held when only the best count are kept ("best 3 of 4": count 3, outOf 4). Leave out totals and letter-grade cutoffs.
- Use null for anything the document does not say. Do not guess.
- The document may be in English or Arabic; write names as they appear.`;

/** The parts of a long document that matter: the top, grading sections and lines with class times. */
export function focusDocumentForAi(text: string, limit = MAX_DOCUMENT_CHARS): string {
  const clean = normalizeDocumentText(text).trim();
  if (clean.length <= limit) return clean;
  const lines = clean.split('\n');
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (i < 60) keep.add(i);
    if (/assessment|grading|evaluation|distribution|weight|credit|instructor|course\s*(code|title|name|number)|التقييم|الدرجات/i.test(line)) {
      for (let j = i; j < Math.min(lines.length, i + 25); j++) keep.add(j);
    }
    if (timeRangeIn(line)) for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 1); j++) keep.add(j);
  });
  let out = '';
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (out.length + lines[i].length + 1 > limit) break;
    out += lines[i] + '\n';
  }
  return out.trim();
}

/**
 * The courses the AI found. Throws an Error with a message for the student when the AI could not
 * be reached or answered with something unreadable.
 */
export async function extractCoursesWithAi(
  text: string,
  endpoint: Pick<AiEndpoint, 'provider' | 'chatUrl' | 'apiKey' | 'model' | 'syncKey' | 'aiPass'>
): Promise<CourseDraft[]> {
  const messages = [
    { role: 'system', content: COURSE_IMPORT_PROMPT },
    { role: 'user', content: focusDocumentForAi(text) }
  ];
  let data: any;
  if (endpoint.provider === 'server') {
    const res = await fetch(endpoint.chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, temperature: 0.1, max_tokens: 3000, syncKey: endpoint.syncKey, aiPass: endpoint.aiPass })
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok || !json.data) throw new Error(json?.error || `The AI could not be reached (${res.status}).`);
    data = json.data;
  } else {
    const payload: Record<string, unknown> = {
      model: endpoint.model, messages, temperature: 0.1, max_tokens: 3000, response_format: { type: 'json_object' }
    };
    const post = (body: Record<string, unknown>) => fetch(endpoint.chatUrl, {
      method: 'POST', headers: aiRequestHeaders(endpoint.provider, endpoint.apiKey), body: JSON.stringify(body)
    });
    let res = await post(payload);
    // Some OpenAI-compatible services refuse JSON mode; ask again without it
    if (res.status === 400 && endpoint.provider !== 'openrouter') {
      const { response_format: _omit, ...plain } = payload;
      res = await post(plain);
    }
    if (!res.ok) throw new Error(`The AI answered with an error (${res.status}).`);
    data = await res.json();
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('The AI gave an empty answer.');
  return sanitizeCourseDrafts(parseAiJson(content));
}

export interface CourseSearchResult {
  courses: CourseDraft[];
  /** 'ai' when the student's model found them, else the built-in reader */
  source: 'ai' | 'built-in';
  /** Why the AI was not used, when it was asked to help */
  aiProblem?: string;
}

/** The built-in reader, then the AI when given one. The AI's answer wins when it found anything. */
export async function findCoursesInDocument(
  text: string,
  ai?: Pick<AiEndpoint, 'provider' | 'chatUrl' | 'apiKey' | 'model' | 'syncKey' | 'aiPass'> | null
): Promise<CourseSearchResult> {
  const builtIn = analyzeCourseDocument(text).courses;
  if (!ai) return { courses: builtIn, source: 'built-in' };
  try {
    const fromAi = await extractCoursesWithAi(text, ai);
    if (fromAi.length) return { courses: fromAi, source: 'ai' };
    return { courses: builtIn, source: 'built-in', aiProblem: 'The AI found no courses in it.' };
  } catch (e: any) {
    return { courses: builtIn, source: 'built-in', aiProblem: String(e?.message || e) };
  }
}
