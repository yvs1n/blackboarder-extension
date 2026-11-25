import type { DeadlineTask } from '../types';
import { resolveCourseInfo } from './courseHelper';
import { extractAssessmentNumber, resolveSingletonSyllabusKey } from './syllabusWeights';

const MAKEUP_SIGNAL_RE = /\b(?:make[\s-]*up|makeup|deferred|substitute|re-?sit|resit)\s+(?:exam(?:ination)?|mid[\s-]*term|final|quiz|test)\b|\bfor\s+(?:those|students?)\s+who\s+missed\b|\bmissed\s+the\s+(?:mid[\s-]*term|final|exam(?:ination)?|quiz|test)\b|(?:امتحان|اختبار|كويز)\s*(?:تعويضي|بديل|مؤجل)/i;
const PRACTICE_RE = /\b(?:practice|mock|trial|sample|dry\s*run)\b|تجريبي/i;

export function isMakeupTask(task: Pick<DeadlineTask, 'title' | 'description' | 'sourceSnippet'>): boolean {
  const combined = `${task.title || ''} ${task.description || ''} ${task.sourceSnippet || ''}`;
  return MAKEUP_SIGNAL_RE.test(combined);
}

export interface MakeupTarget {
  kind: 'midterm' | 'final' | 'quiz' | 'lab' | 'exam';
  num: number | null;
}

export function resolveMakeupTarget(
  task: Pick<DeadlineTask, 'title' | 'type' | 'weightDisplay' | 'syllabusNote' | 'description' | 'sourceSnippet'>
): MakeupTarget {
  const combined = `${task.title || ''} ${task.weightDisplay || ''} ${task.syllabusNote || ''} ${task.description || ''} ${task.sourceSnippet || ''}`;
  const num = extractAssessmentNumber(task.title || '') ?? extractAssessmentNumber(combined);
  if (/\bmid[\s_-]*terms?\b|نصفي|منتصف\s*الفصل/i.test(combined)) return { kind: 'midterm', num };
  if (/\bfinals?\b|نهائي/i.test(combined)) return { kind: 'final', num };
  if (task.type === 'quiz' || /\bquiz(?:zes)?\b|كويز/i.test(combined)) return { kind: 'quiz', num };
  if (task.type === 'lab' || /\blab(?:\s*exam|\s*report)?\b|مختبر/i.test(combined)) return { kind: 'lab', num };
  return { kind: 'exam', num };
}

function sameCourseNormalized(a: DeadlineTask, b: DeadlineTask): boolean {
  const ra = resolveCourseInfo(a);
  const rb = resolveCourseInfo(b);
  const codeA = (ra.courseCode || '').replace(/\s+/g, '').toUpperCase();
  const codeB = (rb.courseCode || '').replace(/\s+/g, '').toUpperCase();
  if (codeA && codeB && codeA !== 'UOS' && codeB !== 'UOS') {
    return codeA === codeB;
  }
  const nameA = (ra.courseName || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '');
  const nameB = (rb.courseName || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '');
  if (!nameA || !nameB || nameA === 'generalcourse' || nameB === 'generalcourse') return false;
  return nameA === nameB;
}

function isCompletedOrGraded(task: DeadlineTask): boolean {
  return Boolean(
    task.status === 'completed' ||
    task.submissionStatus === 'graded' ||
    task.submissionStatus === 'submitted' ||
    (typeof task.score === 'number' && !isNaN(task.score))
  );
}

/**
 * Returns true when an auto-extracted, unedited makeup exam/quiz should be suppressed because
 * the student already completed, submitted, or received a grade on the original assessment
 * in the same course.
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

  const target = resolveMakeupTarget(makeupTask);
  for (const orig of allTasks) {
    if (!orig || orig.id === makeupTask.id) continue;
    if (!isCompletedOrGraded(orig)) continue;
    if (isMakeupTask(orig) || PRACTICE_RE.test(orig.title || '')) continue;
    if (!sameCourseNormalized(makeupTask, orig)) continue;

    const origMeta = `${orig.title || ''} ${orig.weightDisplay || ''} ${orig.syllabusNote || ''}`;
    const origNum = extractAssessmentNumber(orig.title || '');
    const origSingleton = resolveSingletonSyllabusKey(orig);

    if (target.kind === 'midterm') {
      const isOrigMid = origSingleton === 'cat:midterm' || /\bmid[\s_-]*terms?\b|نصفي/i.test(origMeta);
      if (isOrigMid && !(target.num !== null && origNum !== null && target.num !== origNum)) {
        return true;
      }
    } else if (target.kind === 'final') {
      const isOrigFinal = origSingleton === 'cat:final' || /\bfinals?\b|نهائي/i.test(origMeta);
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
 * Removes redundant unedited makeup tasks whose corresponding original assessment in the same
 * course is already completed, submitted, or graded.
 */
export function filterRedundantMakeupTasks(tasks: DeadlineTask[]): DeadlineTask[] {
  if (!Array.isArray(tasks) || tasks.length <= 1) return tasks || [];
  return tasks.filter(t => !isMakeupSupersededByCompletedOriginal(t, tasks));
}
