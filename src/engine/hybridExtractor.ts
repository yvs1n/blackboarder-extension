import { Announcement, DeadlineTask, TaskType, UserSettings } from '../types';
import { extractDeadlinesLocally } from './localExtractor';
import { extractDeadlinesWithAi, confirmDeadlinesWithAi } from './aiExtractor';
import { AiSettings, resolveAiEndpoint } from './aiProviders';
import { resolveTaskWeight, extractAssessmentNumber } from '../core/syllabusWeights';
import { resolveTaskRoom, extractRoomFromText } from '../core/courseSchedule';
import {
  extractAnnouncementFieldDelta,
  applyAnnouncementDeltaToTask
} from '../core/announcementReconcile';
import { isPresentationTitle, isBareTypeTitle, toEnglishDeadlineTitle, mergeAnnouncementTexts, isExamReviewSession } from '../core/courseHelper';
import { parseTime } from './localDateTime';
import { coreTitle, isPracticeTitle } from '../utils/streamParser';
import { areTasksDuplicates } from '../utils/taskMerge';

/**
 * Normalizes title for deduplication comparison.
 */
function normalizeTaskKey(task: DeadlineTask): string {
  const dueTime = new Date(task.dueDate).getTime();
  const dateStr = isNaN(dueTime) ? 'invalid' : new Date(dueTime).toISOString().slice(0, 10);
  const cleanTitle = task.title.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
  return `${task.courseCode}_${task.type}_${dateStr}_${cleanTitle}`;
}

// English words need \b so "lab" does not match "label". Arabic words must not use \b:
// in JavaScript \b only sees ASCII letters, so \bواجب\b never matches anything.
const ENGLISH_ACADEMIC = /\b(quiz(?:zes)?|exams?|midterms?|finals?|tests?|assignments?|homework|hw|projects?|labs?|presentations?|reports?|essays?|submit|submission|due|deadline|postponed|rescheduled)\b/i;
const ARABIC_ACADEMIC = /(واجب|كويز|امتحان|اختبار|تسليم|تأجيل|عروض|عرض|مشروع|تقرير|بحث|مناقشة|موعد)/;

/**
 * True when text mentions an assessment or deadline, in English or Arabic.
 * Decides whether an announcement the local parser could not date is worth an AI call.
 */
export function hasAcademicKeywords(text: string): boolean {
  return ENGLISH_ACADEMIC.test(text) || ARABIC_ACADEMIC.test(text);
}

/** Presentation dates (and who presents when) are not deadlines the student works towards. */
export function isPresentationTask(task: Pick<DeadlineTask, 'title'>): boolean {
  return isPresentationTitle(task.title || '');
}

/** 'mid', 'final' or a number for exams ("Midterm Exam", "Final", "Exam 2"); '' when the title says none. */
function examKind(title: string): string {
  if (/mid[\s-]*terms?|فصلي/i.test(title)) return 'mid';
  if (/\bfinals?\b|نهائي/i.test(title)) return 'final';
  const n = title.match(/\b(?:exam|test)\s*(\d+)\b/i);
  return n ? n[1] : '';
}

function sameKnownCourse(a: DeadlineTask, b: DeadlineTask): boolean {
  const codeA = (a.courseCode || '').trim().toUpperCase();
  const codeB = (b.courseCode || '').trim().toUpperCase();
  if (codeA && codeA !== 'UOS' && codeB && codeB !== 'UOS') return codeA === codeB;
  const nameA = (a.courseName || '').trim().toLowerCase();
  const nameB = (b.courseName || '').trim().toLowerCase();
  return nameA !== '' && nameA !== 'general course' && nameA !== 'uos' && nameA === nameB;
}

/**
 * An announcement that explains how an exam will go names the exam again, often in other words
 * ("Midterm" for "Midterm Exam"). If this course already has that exam, it is the same exam.
 */
function findSameExam(task: DeadlineTask, existing: Iterable<DeadlineTask>): DeadlineTask | undefined {
  if (task.type !== 'exam') return undefined;
  const kind = examKind(task.title);
  for (const e of existing) {
    if (e.type === 'exam' && sameKnownCourse(e, task) && examKind(e.title) === kind) return e;
  }
  return undefined;
}

function sameCourseForUpdate(ann: Announcement, task: DeadlineTask): boolean {
  const normCode = (s?: string) => {
    const c = (s || '').replace(/\s+/g, '').toUpperCase();
    return c === 'UOS' ? '' : c;
  };
  const normName = (s?: string) => {
    const n = (s || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '');
    return n === 'generalcourse' || n === 'uos' ? '' : n;
  };
  const ca = normCode(ann.courseCode);
  const cb = normCode(task.courseCode);
  if (ca && cb) return ca === cb;
  const na = normName(ann.courseName);
  const nb = normName(task.courseName);
  if (na && nb) return na === nb || na.includes(nb) || nb.includes(na);
  return true;
}

const INSTRUCTION_CUE_RE = /\b(?:cover(?:s|ing|ed)?|topics?|chapters?|modules?|sections?|material|syllab(?:us|i)|format|duration|minutes?|hours?|calculators?|closed\s*book|open\s*book|bring|instructions?|guidelines?|rules?|room|hall|lab|building|online|blackboard|reminder|update|quiz(?:zes)?|midterms?|finals?|exams?|assignments?|homework|hw\d*|projects?|reports?)\b|يغطي|تغطي|مواضيع|فصول|وحدات|تعليمات|قاعة|مختبر|مدة|ملاحظات|كويز|امتحان|اختبار|واجب|مشروع|تقرير/i;
const GRADE_REPORT_RE = /(?:^|[^\p{L}\p{N}])(?:درجات|درجة|علامات|علامة|نتائج|النتائج|العلامات|الدرجات|grades?|marks?|scores?|results?|feedback|solutions?|answer\s*keys?)(?:$|[^\p{L}\p{N}])/iu;

function taskKind(t: DeadlineTask): 'midterm' | 'final' | 'exam' | 'quiz' | 'assignment' | 'lab' | 'project' | null {
  const title = t.title || '';
  if (/(?:\bmid[\s_-]*terms?\b|نصفي)/i.test(title)) return 'midterm';
  if (/(?:\bfinals?\b|نهائي)/i.test(title)) return 'final';
  if (t.type === 'quiz' || /quiz|كويز|اختبار\s*قصير/i.test(title)) return 'quiz';
  if (t.type === 'exam' || /\b(?:exam|test)\b|امتحان|اختبار/i.test(title)) return 'exam';
  if (t.type === 'lab' || /lab|تقرير|تجربة/i.test(title)) return 'lab';
  if (t.type === 'project' || /project|مشروع|بحث/i.test(title)) return 'project';
  if (t.type === 'assignment' || /assignment|homework|hw|واجب/i.test(title)) return 'assignment';
  return null;
}

function annMatchesKind(text: string, kind: NonNullable<ReturnType<typeof taskKind>>): boolean {
  switch (kind) {
    case 'midterm': return /(?:\bmid[\s_-]*terms?\b|نصفي)/i.test(text);
    case 'final': return /(?:\bfinals?\b|نهائي)/i.test(text);
    case 'quiz': return /\bquiz(?:zes)?\b|كويز|اختبار\s*قصير/i.test(text);
    case 'exam': return /\b(?:exams?|tests?)\b|امتحان|اختبار/i.test(text) && !/(?:\bmid[\s_-]*terms?\b|\bfinals?\b|نصفي|نهائي)/i.test(text);
    case 'lab': return /\b(?:labs?|experiments?|lab\s*reports?)\b|مختبر|تقرير|تجربة/i.test(text);
    case 'project': return /\bprojects?\b|مشروع|بحث/i.test(text);
    case 'assignment': return /\b(?:assignments?|homework|hw\d*|problem\s*sets?)\b|واجب/i.test(text);
  }
}

/**
 * Matches an undated announcement that reads like instructions, topics, or updates for an
 * existing pending deadline in the same course so its text is attached without duplicating tasks.
 */
function findTaskForInstructionAnnouncement(ann: Announcement, tasks: Iterable<DeadlineTask>): DeadlineTask | undefined {
  const annCombined = `${ann.title || ''} ${ann.contentText || ''}`.trim();
  if (!annCombined || isExamReviewSession(ann.title, ann.contentText || '')) return undefined;
  if (GRADE_REPORT_RE.test(ann.title || '') && !/(?:makeup|make-up|reschedul|تعويضي)/i.test(annCombined)) return undefined;
  if (!INSTRUCTION_CUE_RE.test(annCombined)) return undefined;

  const annPractice = isPracticeTitle(annCombined);
  const numAnn = extractAssessmentNumber(annCombined);
  const coreAnn = coreTitle(ann.title || '');
  const list = Array.from(tasks);

  const candidates: DeadlineTask[] = [];
  for (const existing of list) {
    if (!existing || existing.status === 'completed' || existing.status === 'dismissed' || existing.submissionStatus === 'graded') continue;
    if (!sameCourseForUpdate(ann, existing)) continue;
    if (isPracticeTitle(existing.title) !== annPractice) continue;

    const kind = taskKind(existing);
    if (!kind || !annMatchesKind(annCombined, kind)) continue;

    const numEx = extractAssessmentNumber(existing.title);
    if (numEx !== null && numAnn !== null && numEx !== numAnn) continue;

    const coreEx = coreTitle(existing.title);
    const strongNumberMatch = numEx !== null && numAnn !== null && numEx === numAnn;
    const sameCore = coreEx.length >= 4 && coreAnn.length >= 4 && (coreEx === coreAnn || coreAnn.includes(coreEx) || coreEx.includes(coreAnn));
    const singletonExam = kind === 'midterm' || kind === 'final';
    const bothUnnumbered = numEx === null && numAnn === null;

    if (strongNumberMatch || sameCore || singletonExam || bothUnnumbered) {
      candidates.push(existing);
      continue;
    }

    // One side omitted the number ("The quiz covers..." when only one pending quiz exists in that course)
    const sameCourseAndKindCount = list.filter(o =>
      o &&
      o.status !== 'completed' &&
      o.status !== 'dismissed' &&
      o.submissionStatus !== 'graded' &&
      sameCourseForUpdate(ann, o) &&
      taskKind(o) === kind
    ).length;
    if (sameCourseAndKindCount === 1) {
      candidates.push(existing);
    }
  }

  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => {
    const numA = extractAssessmentNumber(a.title);
    const numB = extractAssessmentNumber(b.title);
    const exactA = numA !== null && numA === numAnn ? 1 : 0;
    const exactB = numB !== null && numB === numAnn ? 1 : 0;
    if (exactA !== exactB) return exactB - exactA;
    return (new Date(a.dueDate).getTime() || 0) - (new Date(b.dueDate).getTime() || 0);
  });
  return candidates[0];
}

/** How many announcements are extracted at once (each may be an AI call). */
const EXTRACTION_CONCURRENCY = 4;

/** Promise.all with at most `limit` calls in flight; results keep input order. */
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function cleanTitle(title: string | undefined): string {
  return (title || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
}

function dayOf(iso: string): string {
  const t = new Date(iso).getTime();
  return isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}

/**
 * Title + course key for spotting a re-announced task, or '' when the course is unknown.
 * Without a known course, "Quiz 3" from two different courses would look like the same task
 * and the newer one would be silently merged into the older one.
 */
export function titleCourseKeyFor(task: Pick<DeadlineTask, 'title' | 'courseCode' | 'courseName'>): string {
  const code = (task.courseCode || '').trim();
  const name = (task.courseName || '').trim();
  const codeKnown = code !== '' && code.toUpperCase() !== 'UOS';
  const nameKnown = name !== '' && name !== 'General Course' && name.toLowerCase() !== 'uos';
  if (!codeKnown && !nameKnown) return '';
  const coreT = coreTitle(task.title);
  if (!coreT) return '';
  const cleanC = (codeKnown ? code : name).toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '');
  return `${cleanC}_${coreT}`;
}

const TYPE_WORDS: Array<[TaskType, RegExp]> = [
  ['exam', /\b(midterms?|finals?|exams?)\b|امتحان|اختبار (?:نهائي|فصلي)/i],
  ['quiz', /\b(quiz(?:zes)?)\b|كويز|اختبار قصير/i],
  ['lab', /\b(labs?|experiments?)\b|مختبر|تجربة/i],
  ['project', /\b(projects?|presentations?)\b|مشروع|عروض|عرض/i],
  ['assignment', /\b(assignments?|homework|hw\d*|reports?|essays?|submit|submission)\b|واجب|تسليم|تقرير|بحث/i]
];

/** The assessment type the wording names first in this order, or null. */
export function guessAssessmentType(text: string): TaskType | null {
  for (const [type, re] of TYPE_WORDS) if (re.test(text)) return type;
  return null;
}

/** What the text plainly states, passed to the AI so it does not guess a type, time or room. */
export function wordingHint(text: string): { category?: TaskType; hasTime: boolean; hasRoom: boolean } {
  const category = guessAssessmentType(text) || undefined;
  const hasTime = parseTime(text).hasTime;
  const hasRoom = Boolean(extractRoomFromText(text)) ||
    /\b(?:room|hall|auditorium|lecture\s*hall|building|bldg|in\s+lab|lab\s*(?:#|no\.?)?\s*\d)\b|قاعة|مدرج|مختبر\s*\d/i.test(text);
  return { category, hasTime, hasRoom };
}

function needsAiConfirmation(fullText: string, localTasks: DeadlineTask[]): boolean {
  if (localTasks.length === 0) return false;
  if (localTasks.some(t => t.confidence < 0.80 || isBareTypeTitle(t.title))) return true;
  const hint = wordingHint(fullText);
  if (hint.hasRoom && !localTasks.some(t => Boolean(t.room))) return true;
  if (hint.hasTime && !localTasks.some(t => t.timeSource === 'explicit')) return true;
  return false;
}

export interface HybridExtractionResult {
  tasks: DeadlineTask[];
  /** Which stage produced the result, shown to the user in the web app */
  tier: string;
  rejected?: boolean;
  reason?: string;
}

/**
 * Hybrid extraction pipeline: runs the built-in local parser first (primary engine),
 * confirms ambiguous extractions via optional AI when configured (with safe local fallback),
 * or runs AI fallback when the local parser could not date academic wording.
 */
export async function extractDeadlinesHybrid(
  announcement: Announcement,
  settings: UserSettings
): Promise<DeadlineTask[]> {
  return (await extractDeadlinesHybridDetailed(announcement, settings)).tasks;
}

/**
 * Same pipeline as extractDeadlinesHybrid, but also reports which stage produced the tasks.
 */
export async function extractDeadlinesHybridDetailed(
  announcement: Announcement,
  settings: AiSettings
): Promise<HybridExtractionResult> {
  // Step 1: Run built-in local parser (primary engine, instant & offline)
  const localTasks = extractDeadlinesLocally(announcement).filter(t => !isPresentationTask(t));
  const localTier = 'Built-in parser';
  const fullText = `${announcement.title} ${announcement.contentText}`;
  const aiEndpoint = settings.useAiExtraction ? resolveAiEndpoint(settings) : null;

  if (localTasks.length > 0) {
    // A generic 'other' gets the category the wording points to
    const guessed = guessAssessmentType(fullText);
    if (guessed) {
      for (const t of localTasks) if (t.type === 'other') t.type = guessed;
    }
    if (aiEndpoint && needsAiConfirmation(fullText, localTasks)) {
      const confirmation = await confirmDeadlinesWithAi(
        announcement,
        localTasks,
        aiEndpoint.apiKey,
        aiEndpoint.model,
        wordingHint(fullText),
        { provider: aiEndpoint.provider, chatUrl: aiEndpoint.chatUrl, syncKey: aiEndpoint.syncKey, aiPass: aiEndpoint.aiPass }
      );
      if (confirmation.ok) {
        const refined = confirmation.tasks.filter(t => !isPresentationTask(t));
        if (refined.length > 0) {
          return { tasks: refined, tier: 'Built-in parser (AI confirmed)' };
        }
      }
    }
    return { tasks: localTasks, tier: localTier };
  }

  // If AI is off or the chosen provider has no key, the built-in parser's answer stands
  if (!aiEndpoint) {
    return { tasks: localTasks, tier: localTier };
  }

  // Step 2: skip the AI call for text that never mentions an assessment or deadline
  if (!hasAcademicKeywords(fullText)) {
    return { tasks: localTasks, tier: 'No academic keywords detected' };
  }

  // Step 3: Generative AI fallback when built-in parser found nothing
  console.log(`[Blackboarder] Triggering Generative AI parser for announcement: "${announcement.title}"`);
  const aiTasks = await extractDeadlinesWithAi(
    announcement,
    aiEndpoint.apiKey,
    aiEndpoint.model,
    wordingHint(fullText),
    { provider: aiEndpoint.provider, chatUrl: aiEndpoint.chatUrl, syncKey: aiEndpoint.syncKey, aiPass: aiEndpoint.aiPass }
  );

  const wanted = aiTasks.filter(t => !isPresentationTask(t));
  if (wanted.length > 0) {
    return { tasks: wanted, tier: 'AI fallback' };
  }

  return { tasks: localTasks, tier: 'Tier 1 Fallback (AI found nothing)' };
}

/**
 * Batch processes multiple announcements and deduplicates deadlines against existing stored tasks.
 * When matching existing tasks, performs in-place updates without resetting user completion status,
 * updating truncated descriptions with unabridged text, announced custom rooms, and syllabus weights.
 * Skips announcements that have already been parsed in previous scan checkpoints unless a full re-scan is requested.
 */
export async function processAnnouncementsBatch(
  announcements: Announcement[],
  existingTasks: DeadlineTask[],
  settings: UserSettings,
  knownProcessedAnnIds?: Set<string>,
  onProgress?: (done: number, total: number) => void
): Promise<{ newTasks: DeadlineTask[]; allTasks: DeadlineTask[]; updatedTasks: DeadlineTask[] }> {
  // Index existing tasks by normalized key, announcement ID, ID, and title+course
  const existingKeyMap = new Map<string, DeadlineTask>();
  const existingAnnIdMap = new Map<string, DeadlineTask>();
  const existingIdMap = new Map<string, DeadlineTask>();
  const existingTitleCourseMap = new Map<string, DeadlineTask>();

  for (const t of existingTasks) {
    existingKeyMap.set(normalizeTaskKey(t), t);
    existingIdMap.set(t.id, t);
    if (t.announcementId) {
      existingAnnIdMap.set(`${t.announcementId}|${cleanTitle(t.title)}`, t);
    }
    const titleCourseKey = titleCourseKeyFor(t);
    if (titleCourseKey) {
      existingTitleCourseMap.set(titleCourseKey, t);
    }
  }

  const newTasks: DeadlineTask[] = [];
  const updatedTasks: DeadlineTask[] = [];
  const updatedTaskIds = new Set<string>();

  // Skip previously parsed announcements and sort dated ones chronologically (oldest first) so newer updates win
  const toProcess = announcements
    .map((ann, origIdx) => ({ ann, origIdx, ts: ann.postedAt ? Date.parse(ann.postedAt) : NaN }))
    .filter(item => !(knownProcessedAnnIds && knownProcessedAnnIds.has(item.ann.id)))
    .sort((a, b) => {
      if (!isNaN(a.ts) && !isNaN(b.ts) && a.ts !== b.ts) return a.ts - b.ts;
      return a.origIdx - b.origIdx;
    })
    .map(item => item.ann);

  // Extraction (AI calls) runs a few at a time; merging below stays in order so dedupe is stable
  let finished = 0;
  onProgress?.(0, toProcess.length);
  const extractedLists = await mapWithLimit(toProcess, EXTRACTION_CONCURRENCY, async ann => {
    try {
      return await extractDeadlinesHybrid(ann, settings);
    } catch (err) {
      console.warn('[HybridExtractor] Extraction failed for', ann.title, err);
      return [] as DeadlineTask[];
    } finally {
      finished++;
      onProgress?.(finished, toProcess.length);
    }
  });

  for (let idx = 0; idx < toProcess.length; idx++) {
    const ann = toProcess[idx];
    const extracted = extractedLists[idx] || [];

    if (extracted.length === 0) {
      // No new deadline date extracted: check if this announcement gives instructions, topics,
      // rules, time, room, or weight updates for an already-existing upcoming deadline in the same course.
      const matchedExisting = findTaskForInstructionAnnouncement(ann, existingIdMap.values());
      if (matchedExisting) {
        let changed = false;
        const annTs = ann.postedAt ? Date.parse(ann.postedAt) : NaN;
        const exTs = matchedExisting.announcementPostedAt ? Date.parse(matchedExisting.announcementPostedAt) : NaN;
        const isOlderOutOfOrder = !isNaN(annTs) && !isNaN(exTs) && annTs < exTs;

        const incomingBody = (ann.contentText || ann.title || '').trim();
        const mergedDesc = isOlderOutOfOrder
          ? mergeAnnouncementTexts(incomingBody, matchedExisting.description || matchedExisting.sourceSnippet)
          : mergeAnnouncementTexts(matchedExisting.description || matchedExisting.sourceSnippet, incomingBody);
        if (mergedDesc && mergedDesc !== (matchedExisting.description || '')) {
          matchedExisting.description = mergedDesc;
          matchedExisting.sourceSnippet = mergedDesc;
          changed = true;
        }

        if (!matchedExisting.userEdited && matchedExisting.extractedBy !== 'manual') {
          const delta = extractAnnouncementFieldDelta({
            title: ann.title,
            bodyText: ann.contentText,
            baseDate: !isNaN(annTs) ? new Date(annTs) : undefined,
            courseNameOrCode: matchedExisting.courseName || matchedExisting.courseCode,
            taskTitle: matchedExisting.title,
            taskType: matchedExisting.type
          });
          // Undated announcement matched via instruction matcher never moves calendar day
          delete delta.calendarDay;
          if (applyAnnouncementDeltaToTask(matchedExisting, delta, { onlyFillMissing: isOlderOutOfOrder })) {
            changed = true;
          }

          if (matchedExisting.weight === undefined || matchedExisting.weight === null) {
            const wInfo = resolveTaskWeight({
              ...matchedExisting,
              description: mergedDesc || incomingBody,
              sourceSnippet: mergedDesc || incomingBody
            }, matchedExisting.courseName);
            if (wInfo.weight !== undefined) {
              matchedExisting.weight = wInfo.weight;
              matchedExisting.weightDisplay = wInfo.weightDisplay;
              matchedExisting.syllabusNote = wInfo.syllabusNote;
              changed = true;
            }
          }
        }

        if (!matchedExisting.announcementId && ann.id) {
          matchedExisting.announcementId = ann.id;
          changed = true;
        }
        if (ann.postedAt && !isOlderOutOfOrder && matchedExisting.announcementPostedAt !== ann.postedAt) {
          matchedExisting.announcementPostedAt = ann.postedAt;
          changed = true;
        }

        if (changed) {
          matchedExisting.updatedAt = new Date().toISOString();
          if (!updatedTaskIds.has(matchedExisting.id)) {
            updatedTasks.push(matchedExisting);
            updatedTaskIds.add(matchedExisting.id);
          }
        }
      }
      continue;
    }

    for (const task of extracted) {
      if (task.weight === undefined) {
        const wInfo = resolveTaskWeight(task, task.courseName);
        task.weight = wInfo.weight;
        task.weightDisplay = wInfo.weightDisplay;
        task.syllabusNote = wInfo.syllabusNote;
      }

      // Ensure room is resolved from the announcement text (bypasses hw and project)
      const resolvedRoom = resolveTaskRoom({
        courseNameOrCode: task.courseName || task.courseCode,
        announcementText: task.description || task.sourceSnippet,
        title: task.title,
        existingRoom: task.room,
        type: task.type
      });
      if (resolvedRoom.room) {
        task.room = resolvedRoom.room;
      } else {
        const cleanT = (task.type || '').toLowerCase();
        if (cleanT === 'assignment' || cleanT === 'hw' || cleanT === 'project') {
          task.room = undefined;
        }
      }

      const key = normalizeTaskKey(task);
      const titleCourseKey = titleCourseKeyFor(task);

      // One announcement can hold several deadlines, so its id only matches the same task
      const sameAnnouncement = task.announcementId ? existingAnnIdMap.get(`${task.announcementId}|${cleanTitle(task.title)}`) : undefined;
      const exactMatch = sameAnnouncement
        || existingIdMap.get(task.id)
        || existingKeyMap.get(key);

      // Same title in the same (known) course on another day: the course moved the date
      let rescheduledFrom: DeadlineTask | undefined;
      if (!exactMatch && titleCourseKey) {
        const candidate = existingTitleCourseMap.get(titleCourseKey);
        if (candidate) {
          const isDone = candidate.status === 'completed' ||
            candidate.submissionStatus === 'graded' ||
            candidate.submissionStatus === 'submitted';
          if (!isDone) {
            const candNum = extractAssessmentNumber(candidate.title);
            const taskNum = extractAssessmentNumber(task.title);
            const hasNum = candNum !== null || taskNum !== null;
            const hasRescheduleKeyword = /(?:reschedul|postpon|delay|extend|move|تأجيل|تمديد|تغيير\s*موعد)/i.test(
              `${task.title} ${task.description || ''} ${task.sourceSnippet || ''}`
            );
            const isGeneric = /^(?:assignment|homework|hw\d*|quiz|test|exam|lab|report|project|task|due|untitled|واجب|كويز|امتحان|اختبار|تقرير|مشروع)$/i.test(task.title.trim());
            if (!isGeneric || hasNum || hasRescheduleKeyword) {
              rescheduledFrom = candidate;
            }
          }
        }
      }

      // Check candidate duplicate via areTasksDuplicates against existing items
      let candidateDuplicate: DeadlineTask | undefined;
      if (!exactMatch && !rescheduledFrom) {
        for (const existingItem of existingIdMap.values()) {
          if (areTasksDuplicates(existingItem, task)) {
            if (!titleCourseKey && dayOf(existingItem.dueDate) !== dayOf(task.dueDate)) {
              continue;
            }
            const isDone = existingItem.status === 'completed' ||
              existingItem.submissionStatus === 'graded' ||
              existingItem.submissionStatus === 'submitted';
            const numEx = extractAssessmentNumber(existingItem.title);
            const numTask = extractAssessmentNumber(task.title);
            if (isDone && numEx === null && numTask === null && dayOf(existingItem.dueDate) !== dayOf(task.dueDate)) {
              continue;
            }
            candidateDuplicate = existingItem;
            break;
          }
        }
      }

      // The same exam described again (format, rules, reminders) is not a new exam, and keeps its date
      const sameExam = !exactMatch && !rescheduledFrom && !candidateDuplicate ? findSameExam(task, existingIdMap.values()) : undefined;
      const existing = exactMatch || rescheduledFrom || candidateDuplicate || sameExam;

      if (existing) {
        let changed = false;
        const prevKey = normalizeTaskKey(existing);
        const annTs = ann.postedAt ? Date.parse(ann.postedAt) : NaN;
        const exTs = existing.announcementPostedAt ? Date.parse(existing.announcementPostedAt) : NaN;
        const isOlderOutOfOrder = !isNaN(annTs) && !isNaN(exTs) && annTs < exTs;

        // 1. Description / sourceSnippet: merge doctor updates in chronological order
        const incomingDesc = (task.description || task.sourceSnippet || '').trim();
        const mergedDesc = isOlderOutOfOrder
          ? mergeAnnouncementTexts(incomingDesc, existing.description || existing.sourceSnippet)
          : mergeAnnouncementTexts(existing.description || existing.sourceSnippet, incomingDesc);
        if (mergedDesc && mergedDesc !== (existing.description || '')) {
          existing.description = mergedDesc;
          existing.sourceSnippet = mergedDesc;
          changed = true;
        }

        // 2. If existing task was edited or created manually by the student, DO NOT override student changes!
        if (!existing.userEdited && existing.extractedBy !== 'manual') {
          const enTitle = toEnglishDeadlineTitle(existing.title, existing.type);
          if (enTitle && enTitle !== existing.title) {
            existing.title = enTitle;
            changed = true;
          }

          // Build field delta from ONLY what this announcement explicitly extracted:
          // - Unmentioned fields keep their previous values on `existing`
          // - Same values stay untouched
          // - Newly announced date, explicit time, room, or explicit weight updates accordingly
          const incomingDue = task.dueDate ? new Date(task.dueDate) : null;
          const validIncomingDue = Boolean(incomingDue && !isNaN(incomingDue.getTime()));
          const isDone = existing.status === 'completed' ||
            existing.submissionStatus === 'graded' ||
            existing.submissionStatus === 'submitted';

          const delta = extractAnnouncementFieldDelta({
            title: ann.title,
            bodyText: incomingDesc,
            baseDate: !isNaN(annTs) ? new Date(annTs) : undefined,
            courseNameOrCode: existing.courseName || existing.courseCode,
            taskTitle: existing.title,
            taskType: existing.type || task.type
          });

          // Prefer task's already-extracted date & explicit time when valid (handles AI fallback/confirmation too)
          if (validIncomingDue && !isDone) {
            delta.calendarDay = {
              year: incomingDue!.getFullYear(),
              month: incomingDue!.getMonth(),
              day: incomingDue!.getDate()
            };
          } else if (isDone) {
            delete delta.calendarDay;
            delete delta.explicitTime;
          }
          if (!isDone && task.timeSource === 'explicit' && validIncomingDue) {
            delta.explicitTime = {
              hour: incomingDue!.getHours(),
              minute: incomingDue!.getMinutes()
            };
          }

          if (applyAnnouncementDeltaToTask(existing, delta, { onlyFillMissing: isOlderOutOfOrder })) {
            changed = true;
          }

          // Fallback syllabus weight & default room if still missing after reconciliation
          if ((existing.weight === undefined || existing.weight === null) && task.weight !== undefined) {
            existing.weight = task.weight;
            existing.weightDisplay = task.weightDisplay;
            existing.syllabusNote = task.syllabusNote;
            changed = true;
          }
          if (!existing.room && task.room) {
            const cleanExT = String(existing.type || task.type || '').toLowerCase();
            if (cleanExT !== 'assignment' && cleanExT !== 'hw' && cleanExT !== 'project') {
              existing.room = task.room;
              changed = true;
            }
          }
        }

        // 3. Link announcementId & advance latest announcement timestamp
        if (!existing.announcementId && task.announcementId) {
          existing.announcementId = task.announcementId;
          changed = true;
        }
        if (ann.postedAt && !isOlderOutOfOrder && existing.announcementPostedAt !== ann.postedAt) {
          existing.announcementPostedAt = ann.postedAt;
          changed = true;
        }

        // Keep lookup map updated if dueDate moved so a 3rd follow-up announcement finds the moved task
        const nextKey = normalizeTaskKey(existing);
        if (nextKey !== prevKey) {
          existingKeyMap.delete(prevKey);
          existingKeyMap.set(nextKey, existing);
        }

        if (changed && !updatedTaskIds.has(existing.id)) {
          existing.updatedAt = new Date().toISOString();
          updatedTasks.push(existing);
          updatedTaskIds.add(existing.id);
        }
      } else {
        task.title = toEnglishDeadlineTitle(task.title, task.type);
        existingKeyMap.set(key, task);
        existingIdMap.set(task.id, task);
        if (titleCourseKey) existingTitleCourseMap.set(titleCourseKey, task);
        if (task.announcementId) {
          existingAnnIdMap.set(`${task.announcementId}|${cleanTitle(task.title)}`, task);
        }
        newTasks.push(task);
      }
    }
  }

  // Combine and sort by due date ascending
  const allTasks = [...newTasks, ...existingTasks].sort(
    (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  );

  return { newTasks, allTasks, updatedTasks };
}
