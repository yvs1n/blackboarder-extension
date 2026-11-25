import type { DeadlineTask } from '../types';
import { resolveCourseInfo } from './courseHelper';
import {
  extractAssessmentNumber,
  findCourseSyllabus,
  resolveSingletonSyllabusKey,
  type SyllabusComponent
} from './syllabusWeights';

const MAKEUP_SIGNAL_RE = /\b(?:make[\s-]*up|makeup|deferred|substitute|re-?sit|resit)\s+(?:exam(?:ination)?|mid[\s-]*term|final|quiz|test|lab)\b|\b(?:make[\s-]*up|makeup)\b[\s:,-]*(?:for|of)\b|\bfor\s+(?:those|students?)\s+who\s+missed\b|\bmissed\s+the\s+(?:mid[\s-]*term|final|exam(?:ination)?|quiz|test|lab)\b|(?:امتحان|اختبار|كويز)\s*(?:تعويضي|بديل|مؤجل)/i;
const PRACTICE_RE = /\b(?:practice|mock|trial|sample|dry\s*run)\b|تجريبي/i;
const BONUS_SIGNAL_RE = /\b(?:bonus|extra\s*credit|extra\s*marks?|extra\s*points?|optional\s+(?:quiz|exam|test|assignment|homework|hw|lab))\b|(?:كويز|اختبار|امتحان|واجب|درجات?)\s*(?:بونص|إضافي(?:ة)?)|\bبونص\b/i;
const BONUS_NEGATION_RE = /\b(?:no\s+bonus|not\s+optional|without\s+bonus|non[\s-]*bonus)\b|بدون\s*(?:بونص|درجات\s*إضافية)/i;

export function isMakeupTask(task: Pick<DeadlineTask, 'title' | 'description' | 'sourceSnippet'>): boolean {
  const combined = `${task.title || ''} ${task.description || ''} ${task.sourceSnippet || ''}`;
  return MAKEUP_SIGNAL_RE.test(combined);
}

export function isBonusText(text?: string): boolean {
  if (!text) return false;
  if (BONUS_NEGATION_RE.test(text)) return false;
  return BONUS_SIGNAL_RE.test(text);
}

export function isBonusTaskText(
  task: Pick<DeadlineTask, 'title' | 'description' | 'sourceSnippet' | 'isBonus'>
): boolean {
  if (task.isBonus) return true;
  const combined = `${task.title || ''} ${task.description || ''} ${task.sourceSnippet || ''}`;
  return isBonusText(combined);
}

export interface MakeupTarget {
  kind: 'midterm' | 'final' | 'quiz' | 'lab' | 'exam';
  num: number | null;
}

function extractMakeupTargetNumber(
  task: Pick<DeadlineTask, 'title' | 'description' | 'sourceSnippet'>
): number | null {
  const titleNum = extractAssessmentNumber(task.title || '');
  if (titleNum !== null) return titleNum;
  const body = `${task.description || ''}\n${task.sourceSnippet || ''}`;
  const explicitTarget = body.match(
    /\b(?:missed(?:\s+the)?|make[\s-]*up(?:\s+for)?)\s+(?:quiz|mid[\s_-]*term|exam(?:ination)?|test|lab(?:\s*report)?|experiment)\s*#?\s*(\d{1,2})\b/i
  );
  if (explicitTarget) {
    const n = parseInt(explicitTarget[1], 10);
    return !isNaN(n) && n >= 1 && n <= 30 ? n : null;
  }
  return null;
}

export function resolveMakeupTarget(
  task: Pick<DeadlineTask, 'title' | 'type' | 'weightDisplay' | 'syllabusNote' | 'description' | 'sourceSnippet'>
): MakeupTarget {
  const combined = `${task.title || ''} | ${task.weightDisplay || ''} | ${task.syllabusNote || ''} | ${task.description || ''} | ${task.sourceSnippet || ''}`;
  const num = extractMakeupTargetNumber(task);
  if (/\bmid[\s_-]*terms?\b|نصفي|منتصف\s*الفصل/i.test(combined)) return { kind: 'midterm', num };
  if (/\bfinals?\b|نهائي/i.test(combined)) return { kind: 'final', num };
  if (task.type === 'quiz' || /\bquiz(?:zes)?\b|كويز/i.test(combined)) return { kind: 'quiz', num };
  if (task.type === 'lab' || /\blab(?:\s*exam|\s*report)?\b|مختبر/i.test(combined)) return { kind: 'lab', num };
  return { kind: 'exam', num };
}

function normalizeCourseNameKey(name?: string): string {
  if (!name) return '';
  const lowered = name
    .toLowerCase()
    .replace(/\biii\b/g, '3')
    .replace(/\bii\b/g, '2')
    .replace(/\bi\b/g, '1')
    .replace(/[^a-z0-9\u0600-\u06ff]/g, '');
  return lowered === 'generalcourse' || lowered === 'uos' ? '' : lowered;
}

function normalizeBaseCourseCode(code?: string): string {
  if (!code) return '';
  const cleaned = code.trim().toUpperCase().replace(/\s+/g, '');
  if (!cleaned || cleaned === 'UOS') return '';
  return cleaned.replace(/[_-]\d{1,3}[A-Z]?$/, '');
}

export function sameCourseNormalized(a: DeadlineTask, b: DeadlineTask): boolean {
  const ra = resolveCourseInfo(a);
  const rb = resolveCourseInfo(b);
  const nameA = normalizeCourseNameKey(ra.courseName || a.courseName);
  const nameB = normalizeCourseNameKey(rb.courseName || b.courseName);
  if (nameA && nameB && nameA === nameB) return true;

  const codeA = normalizeBaseCourseCode(ra.courseCode || a.courseCode);
  const codeB = normalizeBaseCourseCode(rb.courseCode || b.courseCode);
  if (codeA && codeB && codeA === codeB) return true;

  const sylA = findCourseSyllabus(ra.courseName || ra.courseCode || a.courseName || a.courseCode);
  const sylB = findCourseSyllabus(rb.courseName || rb.courseCode || b.courseName || b.courseCode);
  if (sylA && sylB && sylA.courseId === sylB.courseId) return true;

  return false;
}

export function isCompletedOrGradedTask(task: DeadlineTask): boolean {
  return Boolean(
    task.status === 'completed' ||
    task.submissionStatus === 'graded' ||
    task.submissionStatus === 'submitted' ||
    (typeof task.score === 'number' && !isNaN(task.score))
  );
}

export interface MatchedSyllabusComponentInfo {
  courseId: string;
  comp: SyllabusComponent;
  maxItems: number;
}

export function resolveMatchedSyllabusComponent(task: DeadlineTask): MatchedSyllabusComponentInfo | null {
  const r = resolveCourseInfo(task);
  const syllabus =
    findCourseSyllabus(r.courseName || r.courseCode || task.courseName || task.courseCode) ||
    findCourseSyllabus(r.courseCode || task.courseCode);
  if (!syllabus || !Array.isArray(syllabus.components) || syllabus.components.length === 0) return null;

  const titleStr = (task.title || '').trim();
  const weightMeta = `${task.weightDisplay || ''} ${task.syllabusNote || ''}`.toLowerCase();
  const bodyStr = `${titleStr} ${task.sourceSnippet || ''} ${task.description || ''}`.trim();
  const normType = (task.type || '').toLowerCase();

  let comp =
    syllabus.components.find(c => weightMeta && weightMeta.includes(c.name.toLowerCase())) ||
    syllabus.components.find(c => c.matcher.test(titleStr)) ||
    syllabus.components.find(c => c.matcher.test(bodyStr));

  if (!comp) {
    if (normType === 'quiz') comp = syllabus.components.find(c => /quiz/i.test(c.name));
    else if (normType === 'lab') comp = syllabus.components.find(c => /lab|exp/i.test(c.name));
    else if (normType === 'assignment') comp = syllabus.components.find(c => /homework|assignment|hw/i.test(c.name));
    else if (normType === 'project') comp = syllabus.components.find(c => /project/i.test(c.name));
  }
  if (!comp) return null;

  const explicitMax = Math.max(comp.outOf || 0, comp.count || 0);
  const isSingletonName = Boolean(resolveSingletonSyllabusKey({ title: comp.name, type: task.type, weightDisplay: comp.name }));
  const maxItems = explicitMax > 0 ? explicitMax : (isSingletonName ? 1 : 0);
  return { courseId: syllabus.courseId, comp, maxItems };
}

export function countCompletedInSyllabusComponent(
  targetInfo: MatchedSyllabusComponentInfo,
  anchorTask: DeadlineTask,
  allTasks: Iterable<DeadlineTask>,
  excludeTaskId?: string
): number {
  let count = 0;
  for (const t of allTasks) {
    if (!t || t.id === excludeTaskId || t.status === 'dismissed') continue;
    if (t.isBonus || isBonusTaskText(t) || isMakeupTask(t) || PRACTICE_RE.test(t.title || '')) continue;
    if (!isCompletedOrGradedTask(t)) continue;
    if (!sameCourseNormalized(anchorTask, t)) continue;
    const otherInfo = resolveMatchedSyllabusComponent(t);
    if (otherInfo && otherInfo.courseId === targetInfo.courseId && otherInfo.comp.id === targetInfo.comp.id) {
      count++;
    }
  }
  return count;
}

/**
 * Returns true when an auto-extracted, unedited makeup exam/quiz should be suppressed because
 * the student already completed, submitted, or received a grade on the original assessment
 * (or exhausted that syllabus component's required count) in the same course.
 */
export function isMakeupSupersededByCompletedOriginal(
  makeupTask: DeadlineTask,
  allTasks: Iterable<DeadlineTask>
): boolean {
  if (!makeupTask || makeupTask.userEdited || makeupTask.extractedBy === 'manual') return false;
  if (makeupTask.submissionStatus === 'graded' || (typeof makeupTask.score === 'number' && !isNaN(makeupTask.score))) {
    return false;
  }
  if (!isMakeupTask(makeupTask)) return false;

  const makeupComp = resolveMatchedSyllabusComponent(makeupTask);
  if (makeupComp && makeupComp.maxItems > 0) {
    const completedInComp = countCompletedInSyllabusComponent(makeupComp, makeupTask, allTasks, makeupTask.id);
    if (completedInComp >= makeupComp.maxItems) return true;
  }

  const target = resolveMakeupTarget(makeupTask);
  for (const orig of allTasks) {
    if (!orig || orig.id === makeupTask.id) continue;
    if (!isCompletedOrGradedTask(orig)) continue;
    if (isMakeupTask(orig) || PRACTICE_RE.test(orig.title || '')) continue;
    if (!sameCourseNormalized(makeupTask, orig)) continue;

    const origMeta = `${orig.title || ''} | ${orig.weightDisplay || ''} | ${orig.syllabusNote || ''}`;
    const origNum = extractAssessmentNumber(orig.title || '');
    const origSingleton = resolveSingletonSyllabusKey(orig);
    const origComp = makeupComp ? resolveMatchedSyllabusComponent(orig) : null;
    const sameComp = Boolean(makeupComp && origComp && makeupComp.comp.id === origComp.comp.id);

    if (target.kind === 'midterm') {
      const isOrigMid =
        sameComp ||
        origSingleton === 'cat:midterm' ||
        /\b(?:mid[\s_-]*terms?|major\s*exam|first\s*exam)\b|نصفي|منتصف\s*الفصل/i.test(origMeta);
      if (isOrigMid && !(target.num !== null && origNum !== null && target.num !== origNum)) {
        return true;
      }
    } else if (target.kind === 'final') {
      const isOrigFinal = sameComp || origSingleton === 'cat:final' || /\bfinals?\b|نهائي/i.test(origMeta);
      if (isOrigFinal) return true;
    } else if (target.kind === 'quiz') {
      if (orig.type === 'quiz' && target.num !== null && origNum === target.num) return true;
    } else if (target.kind === 'lab') {
      if (orig.type === 'lab' && target.num !== null && origNum === target.num) return true;
    } else {
      if (orig.type === 'exam' && (target.num === null || origNum === target.num)) return true;
    }
  }
  return false;
}

/**
 * Returns true when an unedited, non-bonus, ungraded auto-extracted task falls into a syllabus
 * component whose finite item quota (`count` or `outOf`) is already 100% completed/graded.
 */
export function isUneditedExtraPastSyllabusQuota(
  task: DeadlineTask,
  allTasks: Iterable<DeadlineTask>
): boolean {
  if (!task || task.userEdited || task.extractedBy === 'manual') return false;
  if (isCompletedOrGradedTask(task)) return false;
  if (task.isBonus || isBonusTaskText(task)) return false;

  const compInfo = resolveMatchedSyllabusComponent(task);
  if (!compInfo || compInfo.maxItems <= 0) return false;
  const completedCount = countCompletedInSyllabusComponent(compInfo, task, allTasks, task.id);
  return completedCount >= compInfo.maxItems;
}

/**
 * Allows a student's bonus deadline (e.g. manually added Bonus Quiz) to deduplicate with a
 * scanned assessment of the same type in the same course when the scan missed the bonus label.
 */
export function canPairBonusWithScannedTask(
  a: DeadlineTask,
  b: DeadlineTask,
  allTasks?: Iterable<DeadlineTask>
): boolean {
  const bonusA = isBonusTaskText(a);
  const bonusB = isBonusTaskText(b);
  if (bonusA === bonusB) return true;

  const bonusTask = bonusA ? a : b;
  const regularTask = bonusA ? b : a;
  if (regularTask.userEdited || regularTask.extractedBy === 'manual') return false;
  if (!sameCourseNormalized(a, b)) return false;

  const normType = (t?: string) => {
    const v = (t || 'assignment').toLowerCase().trim();
    if (v === 'hw' || v === 'homework') return 'assignment';
    if (v === 'test') return 'quiz';
    if (v === 'midterm' || v === 'final') return 'exam';
    return v;
  };
  if (normType(a.type) !== normType(b.type)) return false;

  const numBonus = extractAssessmentNumber(bonusTask.title || '');
  const numReg = extractAssessmentNumber(regularTask.title || '');
  if (numBonus !== null && numReg !== null && numBonus !== numReg) return false;

  // Never merge an old completed regular quiz from weeks ago into an upcoming manual bonus quiz
  if (isCompletedOrGradedTask(regularTask) && !isCompletedOrGradedTask(bonusTask)) {
    const tBonus = new Date(bonusTask.dueDate).getTime();
    const tReg = new Date(regularTask.dueDate).getTime();
    if (isNaN(tBonus) || isNaN(tReg) || Math.abs(tBonus - tReg) > 3 * 24 * 60 * 60 * 1000) {
      return false;
    }
  }

  const tA = new Date(a.dueDate).getTime();
  const tB = new Date(b.dueDate).getTime();
  if (!isNaN(tA) && !isNaN(tB) && Math.abs(tA - tB) <= 7 * 24 * 60 * 60 * 1000) {
    // Only merge on date proximity when the bonus task is manual/edited or numbers agree or regular is unnumbered
    if (bonusTask.extractedBy === 'manual' || bonusTask.userEdited || (numBonus !== null && numBonus === numReg)) {
      return true;
    }
  }

  if (allTasks) {
    const compInfo = resolveMatchedSyllabusComponent(regularTask);
    if (compInfo && compInfo.maxItems > 0) {
      const completedCount = countCompletedInSyllabusComponent(compInfo, regularTask, allTasks, regularTask.id);
      if (completedCount >= compInfo.maxItems) return true;
    }
  }

  return false;
}

/**
 * Removes redundant unedited makeup tasks and unedited extra tasks whose syllabus component
 * quota is already 100% completed/graded.
 */
export function filterRedundantMakeupTasks(tasks: DeadlineTask[]): DeadlineTask[] {
  if (!Array.isArray(tasks) || tasks.length <= 1) return tasks || [];
  return tasks.filter(
    t => !isMakeupSupersededByCompletedOriginal(t, tasks) && !isUneditedExtraPastSyllabusQuota(t, tasks)
  );
}
