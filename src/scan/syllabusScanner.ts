import { analyzeCourseDocument, type CourseDraft } from '../core/courseDocument';
import { fileToText, type PdfJsLike } from '../core/documentText';
import { extractCoursesWithAi } from '../engine/aiCourseImport';
import type { AiEndpoint } from '../engine/aiProviders';
import type { UserCourseConfig } from '../types';
import {
  fetchAllPages,
  fetchEnrolledCourses,
  fetchSession,
  isOrientationOrSandboxCourse,
  stripHtmlToText,
  type BbFetch,
  type CourseMeta
} from './blackboardApi';

export const FIRST_SYLLABUS_SCAN_KEY = 'bbs_first_syllabus_scan_done';

const SYLLABUS_STRONG_RE = /\b(?:syllabus|syllabi|course[\s_-]*outline|course[\s_-]*profile|course[\s_-]*spec(?:ification)?|course[\s_-]*guide|module[\s_-]*handbook|module[\s_-]*guide)\b|توصيف\s*(?:المساق|المقرر)|خطة\s*(?:المساق|المقرر|الدراس)/i;
const SYLLABUS_MEDIUM_RE = /\b(?:assessment[\s_-]*(?:plan|scheme|criteria|breakdown)|scheme[\s_-]*of[\s_-]*(?:work|assessment)|grading[\s_-]*(?:policy|breakdown|scheme)|course[\s_-]*info(?:rmation)?)\b|نظام\s*التقييم|توزيع\s*الدرجات/i;
const SYLLABUS_FOLDER_RE = /\b(?:syllabus|outline|course\s*info|start\s*here|getting\s*started|general|overview|documents?|resources?|handbook|assessment|week\s*1|intro)\b|معلومات|الخطة|التوصيف/i;
const NEGATIVE_SYLLABUS_RE = /\b(?:sample|template|archive|old[\s_-]*syllabus|deprecated|draft)\b/i;

const SUPPORTED_EXT_RE = /\.(pdf|docx|txt|md|csv|html?|rtf)(?:$|\?)/i;
const UNSUPPORTED_EXT_RE = /\.(pptx?|xlsx?|zip|rar|7z|mp4|mov|avi|mkv|mp3|wav|jpe?g|png|gif|webp|exe|dmg|iso)(?:$|\?)/i;

export interface SyllabusScanCandidate {
  courseId: string;
  meta: CourseMeta;
  itemId: string;
  title: string;
  score: number;
  downloadPath?: string;
  fileName?: string;
  mimeType?: string;
  inlineText?: string;
}

export interface SyllabusScanProgress {
  phase: 'session' | 'courses' | 'discovering' | 'extracting';
  message: string;
  current?: number;
  total?: number;
}

export interface SyllabusScanResult {
  ok: boolean;
  skippedReason?: 'no-ai-key' | 'no-origin' | 'no-session' | 'no-courses';
  courses: CourseDraft[];
  scannedCourses: number;
  matchedFiles: number;
  failedCourses: number;
  errors: string[];
}

export interface DiscoverSyllabiOptions {
  origin: string;
  fetchFn: BbFetch;
  ai: AiEndpoint | null;
  allowLocalFallback?: boolean;
  existingCourses?: UserCourseConfig[];
  loadPdfJs?: () => Promise<PdfJsLike>;
  extractTextFromFile?: (file: File) => Promise<string>;
  extractWithAi?: (text: string, ai: AiEndpoint) => Promise<CourseDraft[]>;
  onProgress?: (progress: SyllabusScanProgress) => void;
  signal?: AbortSignal;
  maxCourses?: number;
}

/** Strict first-time automatic syllabus trigger guard: requires an AI key and unmet syllabus coverage. */
export function shouldAutoScanSyllabiOnFirstScan(params: {
  firstScanDone: boolean;
  aiEndpoint: AiEndpoint | null;
  courses: Pick<UserCourseConfig, 'syllabus'>[];
  scanSucceeded: boolean;
}): boolean {
  if (params.firstScanDone) return false;
  if (!params.aiEndpoint) return false;
  if (!params.scanSucceeded) return false;
  if (!params.courses.length) return false;
  return params.courses.some(c => !Array.isArray(c.syllabus) || c.syllabus.length === 0);
}

export async function isFirstSyllabusScanDone(): Promise<boolean> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get(FIRST_SYLLABUS_SCAN_KEY);
      if (typeof res?.[FIRST_SYLLABUS_SCAN_KEY] === 'boolean') return res[FIRST_SYLLABUS_SCAN_KEY];
    }
  } catch {}
  try {
    return localStorage.getItem(FIRST_SYLLABUS_SCAN_KEY) === 'true';
  } catch {
    return false;
  }
}

export async function markFirstSyllabusScanDone(done = true): Promise<void> {
  try {
    localStorage.setItem(FIRST_SYLLABUS_SCAN_KEY, done ? 'true' : 'false');
  } catch {}
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [FIRST_SYLLABUS_SCAN_KEY]: done });
    }
  } catch {}
}

/** Scores whether a Blackboard item title or attachment filename indicates a syllabus file. 0 = ignore. */
export function scoreSyllabusIndicator(label: string, mimeType = ''): number {
  const s = String(label || '').trim();
  if (!s) return 0;
  if (UNSUPPORTED_EXT_RE.test(s)) return 0;
  let score = 0;
  if (SYLLABUS_STRONG_RE.test(s)) score += 10;
  else if (SYLLABUS_MEDIUM_RE.test(s)) score += 6;
  else return 0;

  if (/\b(?:syllabus|course[\s_-]*outline|course[\s_-]*spec)\b/i.test(s)) score += 3;
  if (/\.pdf(?:$|\?)/i.test(s) || mimeType.toLowerCase().includes('pdf')) score += 2;
  else if (/\.docx(?:$|\?)/i.test(s) || mimeType.toLowerCase().includes('wordprocessingml')) score += 1;
  if (NEGATIVE_SYLLABUS_RE.test(s)) score -= 4;
  return Math.max(0, score);
}

function isSupportedAttachment(fileName: string, mimeType = ''): boolean {
  const mime = mimeType.toLowerCase();
  if (UNSUPPORTED_EXT_RE.test(fileName)) return false;
  if (SUPPORTED_EXT_RE.test(fileName)) return true;
  return mime.includes('pdf') || mime.includes('wordprocessingml') || mime.startsWith('text/');
}

function toRelativePath(rawUrl: string, origin: string): string {
  const val = String(rawUrl || '').trim();
  if (!val) return '';
  if (val.startsWith('/')) return val;
  try {
    const parsed = new URL(val, origin);
    if (parsed.origin !== origin) return '';
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '';
  }
}

async function fetchCourseContentTree(fetchFn: BbFetch, courseId: string): Promise<any[]> {
  const cid = encodeURIComponent(courseId);
  const recursiveRes = await fetchAllPages(fetchFn, `/learn/api/public/v1/courses/${cid}/contents?recursive=true&limit=200`, 3);
  if (recursiveRes.ok && recursiveRes.results.length > 0) {
    return recursiveRes.results;
  }

  // Fallback: top-level contents then selectively enter syllabus/overview folders
  let rootItems: any[] = [];
  for (const base of ['/learn/api/public/v1', '/learn/api/v1']) {
    const res = await fetchAllPages(fetchFn, `${base}/courses/${cid}/contents?limit=200`, 2);
    if (res.ok) {
      rootItems = res.results;
      break;
    }
  }
  if (!rootItems.length) return [];

  const collected = [...rootItems];
  const candidateFolders = rootItems
    .filter(item => {
      const handlerId = String(item?.contentHandler?.id || '');
      const isFolder = handlerId === 'resource/x-bb-folder' || item?.hasChildren === true;
      const title = String(item?.title || '');
      return isFolder && item?.id && (SYLLABUS_FOLDER_RE.test(title) || SYLLABUS_STRONG_RE.test(title));
    })
    .slice(0, 6);

  for (const folder of candidateFolders) {
    const fid = encodeURIComponent(String(folder.id));
    for (const base of ['/learn/api/public/v1', '/learn/api/v1']) {
      const children = await fetchAllPages(fetchFn, `${base}/courses/${cid}/contents/${fid}/children?limit=100`, 1);
      if (children.ok) {
        collected.push(...children.results);
        break;
      }
    }
  }
  return collected;
}

async function fetchItemAttachments(fetchFn: BbFetch, courseId: string, itemId: string): Promise<{ base: string; attachments: any[] }> {
  const cid = encodeURIComponent(courseId);
  const iid = encodeURIComponent(itemId);
  for (const base of ['/learn/api/public/v1', '/learn/api/v1']) {
    const res = await fetchAllPages(fetchFn, `${base}/courses/${cid}/contents/${iid}/attachments?limit=50`, 0);
    if (res.ok) return { base, attachments: res.results };
  }
  return { base: '/learn/api/public/v1', attachments: [] };
}

function extractBodyFileLinks(bodyHtml: string, origin: string): { path: string; fileName: string }[] {
  const out: { path: string; fileName: string }[] = [];
  const re = /href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(bodyHtml || ''); m; m = re.exec(bodyHtml || '')) {
    const rel = toRelativePath(m[1], origin);
    if (!rel) continue;
    const linkText = stripHtmlToText(m[3]);
    const tailName = decodeURIComponent(rel.split('?')[0].split('/').pop() || '');
    const label = linkText || tailName;
    if (SUPPORTED_EXT_RE.test(rel) || scoreSyllabusIndicator(label) > 0) {
      out.push({ path: rel, fileName: tailName || `${label.slice(0, 40)}.pdf` });
    }
  }
  return out;
}

async function discoverCourseCandidates(
  fetchFn: BbFetch,
  courseId: string,
  meta: CourseMeta,
  origin: string
): Promise<SyllabusScanCandidate[]> {
  const items = await fetchCourseContentTree(fetchFn, courseId);
  if (!items.length) return [];

  const titleMatchedItems = items
    .map(item => ({ item, titleScore: scoreSyllabusIndicator(String(item?.title || '')) }))
    .filter(x => x.item?.id && (x.titleScore > 0 || SYLLABUS_FOLDER_RE.test(String(x.item?.title || ''))))
    .sort((a, b) => b.titleScore - a.titleScore)
    .slice(0, 8);

  const candidates: SyllabusScanCandidate[] = [];
  for (const { item, titleScore } of titleMatchedItems) {
    const itemId = String(item.id);
    const title = String(item.title || 'Syllabus');
    const bodyHtml = typeof item.body === 'string' ? item.body : String(item?.body?.displayText || item?.body?.rawText || '');

    // Check embedded links in body HTML (common in Ultra documents & classic items)
    for (const link of extractBodyFileLinks(bodyHtml, origin)) {
      const score = Math.max(titleScore, scoreSyllabusIndicator(link.fileName), scoreSyllabusIndicator(title));
      if (score > 0) {
        candidates.push({
          courseId,
          meta,
          itemId,
          title,
          score,
          downloadPath: link.path,
          fileName: link.fileName
        });
      }
    }

    // Check Blackboard attachments REST endpoint when title suggests a syllabus/document
    if (titleScore > 0 || String(item?.contentHandler?.id || '').includes('file') || String(item?.contentHandler?.id || '').includes('document')) {
      const { base, attachments } = await fetchItemAttachments(fetchFn, courseId, itemId);
      for (const att of attachments) {
        if (!att?.id) continue;
        const fileName = String(att.fileName || att.name || title || 'syllabus.pdf').trim();
        const mimeType = String(att.mimeType || '');
        if (!isSupportedAttachment(fileName, mimeType)) continue;
        const fileScore = Math.max(titleScore, scoreSyllabusIndicator(fileName, mimeType));
        if (fileScore <= 0) continue;
        candidates.push({
          courseId,
          meta,
          itemId,
          title,
          score: fileScore + 2,
          downloadPath: `${base}/courses/${encodeURIComponent(courseId)}/contents/${encodeURIComponent(itemId)}/attachments/${encodeURIComponent(String(att.id))}/download`,
          fileName,
          mimeType
        });
      }
    }

    // Fallback candidate: inline body text if title strongly indicates syllabus & body has grading cues
    if (titleScore >= 8 && bodyHtml) {
      const plain = stripHtmlToText(bodyHtml);
      if (plain.length >= 100 && /%|\b(?:grading|assessment|exam|quiz|project|credit)\b/i.test(plain)) {
        candidates.push({
          courseId,
          meta,
          itemId,
          title,
          score: titleScore - 1,
          inlineText: `${meta.code ? `${meta.code} ` : ''}${meta.name}\n${title}\n${plain}`
        });
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

function draftKey(draft: CourseDraft): string {
  const code = String(draft.courseCode || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (code) return `c:${code}`;
  return `n:${String(draft.courseName || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

function enrichDraftWithMeta(draft: CourseDraft, meta: CourseMeta): CourseDraft {
  return {
    ...draft,
    courseCode: draft.courseCode || meta.code || '',
    courseName: draft.courseName || meta.name || meta.code || ''
  };
}

/**
 * Discovers syllabus files in the student's enrolled Blackboard courses, downloads and extracts
 * text, parses courses through AI, and returns drafts for user confirmation.
 * Strictly refuses to crawl if no AI API key is configured.
 */
export async function discoverAndExtractBlackboardSyllabi(options: DiscoverSyllabiOptions): Promise<SyllabusScanResult> {
  if (!options.ai && !options.allowLocalFallback) {
    return {
      ok: false,
      skippedReason: 'no-ai-key',
      courses: [],
      scannedCourses: 0,
      matchedFiles: 0,
      failedCourses: 0,
      errors: ['Configure an AI API key in Settings > Scanning first so Blackboard syllabi can be read accurately.']
    };
  }
  if (!options.origin) {
    return {
      ok: false,
      skippedReason: 'no-origin',
      courses: [],
      scannedCourses: 0,
      matchedFiles: 0,
      failedCourses: 0,
      errors: ['Open or configure your Blackboard site first.']
    };
  }

  options.onProgress?.({ phase: 'session', message: 'Checking Blackboard session...' });
  const session = await fetchSession(options.fetchFn);
  if (session.state !== 'ok') {
    return {
      ok: false,
      skippedReason: 'no-session',
      courses: [],
      scannedCourses: 0,
      matchedFiles: 0,
      failedCourses: 0,
      errors: ['Sign in to Blackboard first so syllabus files can be read.']
    };
  }

  options.onProgress?.({ phase: 'courses', message: 'Reading your enrolled Blackboard courses...' });
  const enrolled = await fetchEnrolledCourses(options.fetchFn);
  if (!enrolled.ok || enrolled.courses.size === 0) {
    return {
      ok: false,
      skippedReason: 'no-courses',
      courses: [],
      scannedCourses: 0,
      matchedFiles: 0,
      failedCourses: 0,
      errors: ['No active Blackboard courses found to inspect.']
    };
  }

  const courseList = [...enrolled.courses.entries()]
    .filter(([, meta]) => !isOrientationOrSandboxCourse(meta.name, meta.code))
    .slice(0, options.maxCourses ?? 20);

  const fallbackPdfJs = async (): Promise<PdfJsLike> => { throw new Error('PDF reader unavailable in this context.'); };
  const readFileText = options.extractTextFromFile || ((file: File) => fileToText(file, options.loadPdfJs || fallbackPdfJs));
  const aiExtract = options.extractWithAi || extractCoursesWithAi;

  const discoveredDrafts: CourseDraft[] = [];
  const seenKeys = new Set<string>();
  const errors: string[] = [];
  let matchedFiles = 0;
  let failedCourses = 0;

  for (let i = 0; i < courseList.length; i++) {
    if (options.signal?.aborted) break;
    const [cid, meta] = courseList[i];
    const label = meta.code || meta.name || 'Course';
    options.onProgress?.({
      phase: 'discovering',
      message: `Checking syllabus files in ${label} (${i + 1}/${courseList.length})...`,
      current: i + 1,
      total: courseList.length
    });

    try {
      const candidates = await discoverCourseCandidates(options.fetchFn, cid, meta, options.origin);
      if (!candidates.length) continue;

      let extractedForCourse = false;
      for (const candidate of candidates.slice(0, 2)) {
        if (options.signal?.aborted || extractedForCourse) break;
        let text = candidate.inlineText || '';

        if (candidate.downloadPath) {
          options.onProgress?.({
            phase: 'extracting',
            message: `Reading ${candidate.fileName || candidate.title} (${label})${options.ai ? ' with AI' : ''}...`,
            current: i + 1,
            total: courseList.length
          });
          const res = await options.fetchFn(candidate.downloadPath, { signal: options.signal });
          if (!res.ok) continue;
          const bytes = await res.arrayBuffer();
          if (!bytes.byteLength) continue;
          const fileName = candidate.fileName || `${label}-syllabus.pdf`;
          const mimeType = candidate.mimeType || res.headers?.get('content-type') || '';
          const file = new File([bytes], fileName, { type: mimeType.split(';')[0] || 'application/octet-stream' });
          text = await readFileText(file).catch(() => '');
        }

        if (!text || text.trim().length < 60) continue;
        matchedFiles++;

        const aiInput = `${meta.code ? `Course Code: ${meta.code}\n` : ''}${meta.name ? `Course Name: ${meta.name}\n` : ''}\n${text}`;
        let extracted: CourseDraft[] = [];
        if (options.ai) {
          try {
            extracted = await aiExtract(aiInput, options.ai);
          } catch {
            if (options.allowLocalFallback) extracted = analyzeCourseDocument(aiInput).courses;
          }
        }
        if (extracted.length === 0 && options.allowLocalFallback) {
          extracted = analyzeCourseDocument(aiInput).courses;
        }
        for (const rawDraft of extracted) {
          const draft = enrichDraftWithMeta(rawDraft, meta);
          if (!draft.syllabus.length && !draft.scheduleSlots.length && draft.creditHours === undefined) continue;
          const key = draftKey(draft);
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          discoveredDrafts.push(draft);
          extractedForCourse = true;
        }
      }
    } catch (err: any) {
      failedCourses++;
      errors.push(`${label}: ${String(err?.message || err)}`);
    }
  }

  return {
    ok: true,
    courses: discoveredDrafts,
    scannedCourses: courseList.length,
    matchedFiles,
    failedCourses,
    errors
  };
}
