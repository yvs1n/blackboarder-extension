import { Announcement, DeadlineTask, TaskType, UserSettings } from '../types';
import { extractDeadlinesLocally } from './localExtractor';
import { extractDeadlinesWithAi } from './aiExtractor';
import { AiSettings, resolveAiEndpoint } from './aiProviders';
import { resolveTaskWeight } from '../core/syllabusWeights';
import { resolveTaskRoom } from '../core/courseSchedule';
import { isPresentationTitle } from '../core/courseHelper';

/**
 * Normalizes title for deduplication comparison.
 */
function normalizeTaskKey(task: DeadlineTask): string {
  const dueTime = new Date(task.dueDate).getTime();
  const dateStr = isNaN(dueTime) ? 'invalid' : new Date(dueTime).toISOString().slice(0, 10);
  const cleanTitle = task.title.toLowerCase().replace(/[^a-z0-9]/g, '');
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
  const cleanT = cleanTitle(task.title);
  if (!cleanT) return '';
  const cleanC = (codeKnown ? code : name).toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
  return `${cleanC}_${cleanT}`;
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
  const hasTime = /\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b|الساعة\s*\d/i.test(text);
  const hasRoom = /\b(?:room|hall|lab)\s*[A-Z]?\d|\b[A-Z]\d{1,2}\s*[-:]\s*\d{2,3}\b|قاعة|مختبر\s*\d/i.test(text);
  return { category, hasTime, hasRoom };
}

export interface HybridExtractionResult {
  tasks: DeadlineTask[];
  /** Which stage produced the result, shown to the user in the web app */
  tier: string;
  rejected?: boolean;
  reason?: string;
}

/**
 * Hybrid extraction pipeline: runs the local parser first, then a keyword check,
 * and Generative AI for exact dates when the parser found nothing.
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
  // Step 1: Run local parser (instant, offline)
  const localTasks = extractDeadlinesLocally(announcement);
  const localTier = 'Built-in parser';

  if (localTasks.length > 0) {
    // A generic 'other' gets the category the wording points to
    const guessed = guessAssessmentType(`${announcement.title} ${announcement.contentText}`);
    if (guessed) {
      for (const t of localTasks) if (t.type === 'other') t.type = guessed;
    }
    return { tasks: localTasks.filter(t => !isPresentationTask(t)), tier: localTier };
  }

  // If AI is off or the chosen provider has no key, the built-in parser's answer stands
  const aiEndpoint = settings.useAiExtraction ? resolveAiEndpoint(settings) : null;
  if (!aiEndpoint) {
    return { tasks: localTasks, tier: localTier };
  }

  // Step 2: skip the AI call for text that never mentions an assessment or deadline
  const fullText = `${announcement.title} ${announcement.contentText}`;
  if (!hasAcademicKeywords(fullText)) {
    return { tasks: localTasks, tier: 'No academic keywords detected' };
  }

  // Step 3: Generative AI for exact dates, guided by what the wording already shows
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
    return { tasks: wanted, tier: 'AI model' };
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

  // Skip announcements already parsed in a previous scan (unless a full re-scan passes no set)
  const toProcess = announcements.filter(ann => !(knownProcessedAnnIds && knownProcessedAnnIds.has(ann.id)));

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

  for (const extracted of extractedLists) {
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
      const rescheduledFrom = !exactMatch && titleCourseKey ? existingTitleCourseMap.get(titleCourseKey) : undefined;
      // The same exam described again (format, rules, reminders) is not a new exam, and keeps its date
      const sameExam = !exactMatch && !rescheduledFrom ? findSameExam(task, existingIdMap.values()) : undefined;
      const existing = exactMatch || rescheduledFrom || sameExam;

      if (existing) {
        let changed = false;

        // 1. Description / sourceSnippet: update if incoming has longer text, or existing ends in '…' or '...'
        const incomingDesc = (task.description || task.sourceSnippet || '').trim();
        const existingDesc = (existing.description || existing.sourceSnippet || '').trim();
        const isExistingTruncated = /[…\.]\s*$/.test(existingDesc) || existingDesc.includes('…') || existingDesc.endsWith('...');

        if (incomingDesc && (incomingDesc.length > existingDesc.length || (isExistingTruncated && !incomingDesc.includes('…')))) {
          existing.description = incomingDesc;
          existing.sourceSnippet = incomingDesc;
          changed = true;
        }

        // 2. If existing task was edited or created manually by the student, DO NOT override student changes!
        if (!existing.userEdited && existing.extractedBy !== 'manual') {
          // Room: re-resolve room with the latest announcement text. An announced room ALWAYS overrides the default!
          const newRoomRes = resolveTaskRoom({
            courseNameOrCode: existing.courseName || existing.courseCode,
            announcementText: existing.description || existing.sourceSnippet || incomingDesc,
            title: existing.title,
            existingRoom: existing.room,
            type: existing.type || task.type
          });
          if (newRoomRes.room && newRoomRes.room !== existing.room) {
            existing.room = newRoomRes.room;
            changed = true;
          } else {
            const cleanExT = (existing.type || task.type || '').toLowerCase();
            if ((cleanExT === 'assignment' || cleanExT === 'hw' || cleanExT === 'project') && existing.room) {
              existing.room = undefined;
              changed = true;
            }
          }

          // 3. Weight & Syllabus Note if previously missing
          if ((existing.weight === undefined || existing.weight === null) && task.weight !== undefined) {
            existing.weight = task.weight;
            existing.weightDisplay = task.weightDisplay;
            existing.syllabusNote = task.syllabusNote;
            changed = true;
          }

          // 4. Rescheduled: take the newly announced date
          if (rescheduledFrom && dayOf(existing.dueDate) !== dayOf(task.dueDate)) {
            existing.dueDate = task.dueDate;
            existing.hasSpecificTime = task.hasSpecificTime;
            changed = true;
          }

          // 5. Specific class time: if existing did not have specific time, but new does
          if (!existing.hasSpecificTime && task.hasSpecificTime && (!sameExam || dayOf(existing.dueDate) === dayOf(task.dueDate))) {
            existing.dueDate = task.dueDate;
            existing.hasSpecificTime = true;
            changed = true;
          }
        }

        // 6. If announcementId was not linked before, link it
        if (!existing.announcementId && task.announcementId) {
          existing.announcementId = task.announcementId;
          changed = true;
        }

        if (changed && !updatedTaskIds.has(existing.id)) {
          existing.updatedAt = new Date().toISOString();
          updatedTasks.push(existing);
          updatedTaskIds.add(existing.id);
        }
      } else {
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
