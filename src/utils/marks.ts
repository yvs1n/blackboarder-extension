import type { DeadlineTask } from '../types';
import { coreTitle } from './streamParser';
import { extractAssessmentNumber } from '../core/syllabusWeights';
import { sanitizeTaskListMarks } from './taskMerge';
import { round1 } from './uiCommon';
import { isExamItem } from './gradebook';

export interface MarksSyllabusComponent {
  id?: string;
  name: string;
  type: string;
  totalWeight: number;
}

/** The fields of a syllabus this summary needs (both the extension and phone shapes have them). */
export interface MarksSyllabus {
  courseName: string;
  courseCodePattern: RegExp;
  totalWeight?: number;
  components?: MarksSyllabusComponent[];
}

export interface MarkRow {
  id: string;
  title: string;
  status: 'graded' | 'submitted' | 'waiting';
  score?: number;
  maxScore?: number;
  percent?: number;
  weight?: number;
  /** Course percentage this mark earned: weight x score / max */
  earned?: number;
  dueDate?: string;
  gradedAt?: string;
  submittedAt?: string;
  completedAt?: string;
  createdAt?: string;
  isBonus?: boolean;
  bonusUnit?: 'points' | 'percent';
  bonusTarget?: string;
  bonusTargetLabel?: string;
  /** True when the mark has no scheduled deadline (standalone bonus mark or unannounced gradebook entry). */
  isStandalone?: boolean;
}

export interface CourseMarks {
  courseName: string;
  totalWeight: number;
  marks: MarkRow[];
  /** Sum of the weights of graded items with a known weight */
  gradedWeight: number;
  /** Course percentage earned from those items (including any bonus marks) */
  earnedWeight: number;
  /** Extra credit bonus marks earned */
  bonusWeight?: number;
  /** Average score across graded items, in percent */
  averagePercent?: number;
}

export interface MarksSummary {
  courses: CourseMarks[];
  gradedCount: number;
  submittedCount: number;
}

/**
 * Identifies whether a task represents a graded assessment component
 * (quiz, exam, midterm, final, assignment, homework, project, lab, or weighted syllabus item).
 */
export function isAssessmentTask(t: { type?: string; title?: string; weight?: number }): boolean {
  if (typeof t.weight === 'number' && t.weight > 0) return true;
  const type = (t.type || '').toLowerCase();
  if (type === 'quiz' || type === 'exam' || type === 'assignment' || type === 'project' || type === 'lab') {
    return true;
  }
  if (isExamItem(t)) return true;
  const title = (t.title || '').toLowerCase();
  return /\b(?:quiz(?:zes)?|test|exam|mid[\s_-]*term|final|assignment|hw\d*|homework|project|lab|paper|presentation|essay|report)\b|كويز|اختبار|امتحان|واجب|مشروع|مختبر|تقرير|تجربة/i.test(title);
}

/** True when a mark exists on its own (standalone bonus mark or unannounced gradebook mark) rather than on a deadline. */
export function isStandaloneMarkTask(t: Pick<DeadlineTask, 'id' | 'sourceSnippet' | 'extractedBy' | 'isBonus' | 'announcementId' | 'type' | 'dueDate'>): boolean {
  if (!t) return false;
  return Boolean(
    (t.id && (t.id.startsWith('task_bonus_') || t.id.startsWith('gbcol_') || t.id.startsWith('gb_'))) ||
    t.sourceSnippet === 'gradebook' ||
    (t.extractedBy as string) === 'gradebook' ||
    (Boolean(t.isBonus) && !t.announcementId && t.type === 'other') ||
    !t.dueDate
  );
}

/** True when marking this task done should offer a quick score-entry modal (manual assessment/bonus without a mark yet). */
export function shouldPromptForCompletionScore(t?: DeadlineTask | null): boolean {
  if (!t) return false;
  if (t.extractedBy !== 'manual') return false;
  if (t.submissionStatus === 'graded') return false;
  return Boolean(t.isBonus || isAssessmentTask(t));
}

/** Resolves the matching syllabus component (if bonusTarget picks one) for a bonus task. */
export function matchBonusComponent<T extends MarksSyllabusComponent>(t: DeadlineTask, components: T[] = []): T | undefined {
  const target = (t.bonusTarget || '').trim();
  const label = (t.bonusTargetLabel || '').trim().toLowerCase();
  if (!target || target === 'total') return undefined;
  if (target.startsWith('comp:')) {
    const id = target.slice(5);
    const byId = components.find(c => c.id && c.id === id);
    if (byId) return byId;
  }
  if (target.startsWith('compname:')) {
    const name = target.slice(9).toLowerCase();
    const byName = components.find(c => c.name.toLowerCase() === name);
    if (byName) return byName;
  }
  if (target.startsWith('type:')) {
    const tp = target.slice(5).toLowerCase();
    const byType = components.find(c => c.type.toLowerCase() === tp);
    if (byType) return byType;
  }
  if (label) {
    const byLabel = components.find(c => c.name.toLowerCase() === label);
    if (byLabel) return byLabel;
  }
  return components.find(c => c.id === target || c.name.toLowerCase() === target.toLowerCase());
}

/** Calculates exact course-grade points earned by a graded bonus entry, honoring 'points' vs 'percent'. */
export function bonusEarnedAmount(t: DeadlineTask, courseTotalWeight = 100, targetCompWeight?: number): number {
  const rawVal = Number(t.weight) > 0 ? Number(t.weight) : Number(t.maxScore ?? t.score ?? 0);
  const isPercent = t.bonusUnit === 'percent';
  const denomScale = targetCompWeight && targetCompWeight > 0 ? targetCompWeight : (courseTotalWeight || 100);
  const pointBudget = isPercent ? (rawVal / 100) * denomScale : rawVal;

  if (typeof t.score === 'number' && typeof t.maxScore === 'number' && t.maxScore > 0) {
    return (t.score / t.maxScore) * pointBudget;
  }
  if (typeof t.score === 'number' && t.score >= 0) {
    return isPercent ? (t.score / 100) * denomScale : t.score;
  }
  return pointBudget;
}

/**
 * Every mark in one place: graded and submitted tasks grouped by course, with each course's
 * earned share of the grade. Courses are named after their syllabus when one matches.
 */
export function buildMarksSummary(tasks: DeadlineTask[], syllabi: MarksSyllabus[] = []): MarksSummary {
  const byCourse = new Map<string, CourseMarks>();
  let gradedCount = 0;
  let submittedCount = 0;
  const cleanTasks = sanitizeTaskListMarks(tasks || []);

  for (const t of cleanTasks) {
    if (!t) continue;
    const cName = t.courseName || '';
    const cCode = t.courseCode || '';
    const title = t.title || '';
    if (/orientation|توجيه|تهيئة/i.test(cName) || /orientation/i.test(cCode) || /orientation|توجيه|تهيئة/i.test(title)) {
      continue;
    }
    const isBonus = Boolean(t.isBonus);
    const hasScorePair = typeof t.score === 'number' && !!t.maxScore && t.maxScore > 0;
    const hasGradedBonus = isBonus && t.submissionStatus === 'graded' && (hasScorePair || (typeof (t.score ?? t.weight) === 'number' && Number(t.score ?? t.weight) > 0));
    const graded = (t.submissionStatus === 'graded' && hasScorePair) || hasGradedBonus;
    const submitted = !graded && (t.submissionStatus === 'submitted' || t.submissionStatus === 'graded');
    const waiting = !graded && !submitted && t.status === 'completed' && isAssessmentTask(t);
    if (!graded && !submitted && !waiting) continue;

    const syl = syllabi.find(s =>
      s.courseCodePattern.test(t.courseName || '') || s.courseCodePattern.test(t.courseCode || '')
    );
    const courseName = syl?.courseName || t.courseName || t.courseCode || 'Other';
    let course = byCourse.get(courseName);
    if (!course) {
      course = { courseName, totalWeight: syl?.totalWeight || 100, marks: [], gradedWeight: 0, earnedWeight: 0 };
      byCourse.set(courseName, course);
    }

    const targetComp = isBonus ? matchBonusComponent(t, syl?.components) : undefined;
    const bonusBase = Number(t.weight) > 0 ? Number(t.weight) : Number(t.maxScore ?? t.score ?? 0);
    const bonusEarned = isBonus ? bonusEarnedAmount(t, course.totalWeight, targetComp?.totalWeight) : 0;
    const weight = isBonus ? (bonusBase > 0 ? bonusBase : undefined) : (Number(t.weight) > 0 ? Number(t.weight) : undefined);
    const row: MarkRow = {
      id: t.id,
      title: t.title,
      status: graded ? 'graded' : (waiting ? 'waiting' : 'submitted'),
      weight,
      dueDate: t.dueDate,
      gradedAt: t.gradedAt,
      submittedAt: t.submittedAt,
      completedAt: t.completedAt || (t.status === 'completed' ? (t.submittedAt || t.updatedAt) : undefined),
      createdAt: t.createdAt,
      isBonus,
      bonusUnit: isBonus ? (t.bonusUnit === 'percent' ? 'percent' : 'points') : undefined,
      bonusTarget: isBonus ? t.bonusTarget : undefined,
      bonusTargetLabel: isBonus ? t.bonusTargetLabel : undefined,
      isStandalone: isStandaloneMarkTask(t)
    };
    if (graded) {
      if (isBonus) {
        row.score = hasScorePair ? t.score : round1(bonusEarned);
        row.maxScore = hasScorePair ? t.maxScore : round1(bonusBase || bonusEarned);
        row.percent = row.maxScore ? round1((row.score! / row.maxScore) * 100) : 100;
        row.earned = round1(bonusEarned);
      } else {
        row.score = t.score;
        row.maxScore = t.maxScore;
        row.percent = round1((t.score! / t.maxScore!) * 100);
        if (weight) {
          row.earned = round1((t.score! / t.maxScore!) * weight);
        }
      }
    }

    // Deduplicate marks within course (never merge a bonus item into a non-bonus item)
    const existingIndex = course.marks.findIndex(m => {
      if (Boolean(m.isBonus) !== isBonus) return false;
      if (t.gradeSourceId && (m as any).gradeSourceId && t.gradeSourceId === (m as any).gradeSourceId) return true;
      const numT = extractAssessmentNumber(t.title);
      const numM = extractAssessmentNumber(m.title);
      const isQuizT = /quiz|كويز/i.test(t.title);
      const isQuizM = /quiz|كويز/i.test(m.title);
      const isAssignT = /assignment|hw|homework|واجب/i.test(t.title);
      const isAssignM = /assignment|hw|homework|واجب/i.test(m.title);
      const isLabT = /lab|تقرير/i.test(t.title);
      const isLabM = /lab|تقرير/i.test(m.title);
      if (numT !== null && numM !== null && numT === numM) {
        if ((isQuizT && isQuizM) || (isAssignT && isAssignM) || (isLabT && isLabM)) return true;
      }
      const coreT = coreTitle(t.title);
      const coreM = coreTitle(m.title);
      if (coreT && coreM && coreT.length >= 4 && coreT === coreM) return true;
      if (isExamItem(t) && isExamItem({ title: m.title })) {
        if (/(?:\bmidterm\b|نصفي)/i.test(t.title) && /(?:\bmidterm\b|نصفي)/i.test(m.title)) return true;
        if (/(?:\bfinal\b|نهائي)/i.test(t.title) && /(?:\bfinal\b|نهائي)/i.test(m.title)) return true;
      }
      return false;
    });

    if (existingIndex !== -1) {
      const existingRow = course.marks[existingIndex];
      if (row.title.length > existingRow.title.length) {
        existingRow.title = row.title;
      }
      if (row.gradedAt) {
        if (!existingRow.gradedAt) {
          existingRow.gradedAt = row.gradedAt;
        } else {
          const tNew = new Date(row.gradedAt).getTime();
          const tOld = new Date(existingRow.gradedAt).getTime();
          if (!isNaN(tNew) && (isNaN(tOld) || tNew > tOld)) {
            existingRow.gradedAt = row.gradedAt;
          }
        }
      }
      if (row.submittedAt && !existingRow.submittedAt) {
        existingRow.submittedAt = row.submittedAt;
      }
      if (row.completedAt && !existingRow.completedAt) {
        existingRow.completedAt = row.completedAt;
      }
      if (row.dueDate && !existingRow.dueDate) {
        existingRow.dueDate = row.dueDate;
      }
      if (row.createdAt && !existingRow.createdAt) {
        existingRow.createdAt = row.createdAt;
      }
      if (graded && existingRow.status !== 'graded') {
        const wasAwaiting = existingRow.status === 'submitted' || existingRow.status === 'waiting';
        existingRow.status = 'graded';
        existingRow.score = row.score;
        existingRow.maxScore = row.maxScore;
        existingRow.percent = row.percent;
        const effWeight = weight || existingRow.weight;
        if (effWeight) {
          existingRow.weight = effWeight;
          existingRow.earned = isBonus ? round1(effWeight) : round1((t.score! / t.maxScore!) * effWeight);
          if (isBonus) {
            course.earnedWeight += (existingRow.earned || 0);
            course.bonusWeight = (course.bonusWeight || 0) + (existingRow.earned || 0);
          } else {
            course.gradedWeight += effWeight;
            course.earnedWeight += (t.score! / t.maxScore!) * effWeight;
          }
        }
        gradedCount++;
        if (wasAwaiting) submittedCount--;
      } else if (!graded && row.status === 'submitted' && existingRow.status === 'waiting') {
        existingRow.status = 'submitted';
        if (weight && !existingRow.weight) existingRow.weight = weight;
      } else if (!graded && weight && !existingRow.weight) {
        existingRow.weight = weight;
      } else if (weight && !existingRow.weight && typeof existingRow.score === 'number' && existingRow.maxScore) {
        existingRow.weight = weight;
        existingRow.earned = round1((existingRow.score / existingRow.maxScore) * weight);
        if (isBonus) {
          course.earnedWeight += (existingRow.earned || 0);
          course.bonusWeight = (course.bonusWeight || 0) + (existingRow.earned || 0);
        } else {
          course.gradedWeight += weight;
          course.earnedWeight += (existingRow.score / existingRow.maxScore) * weight;
        }
      }
      continue;
    }

    if (graded) {
      gradedCount++;
      if (isBonus) {
        course.earnedWeight += (row.earned || 0);
        course.bonusWeight = (course.bonusWeight || 0) + (row.earned || 0);
      } else if (weight) {
        course.gradedWeight += weight;
        course.earnedWeight += (t.score! / t.maxScore!) * weight;
      }
    } else {
      submittedCount++;
    }
    (row as any).gradeSourceId = t.gradeSourceId;
    course.marks.push(row);
  }

  const courses = Array.from(byCourse.values());
  for (const c of courses) {
    c.gradedWeight = round1(c.gradedWeight);
    c.earnedWeight = round1(c.earnedWeight);
    if (c.bonusWeight) c.bonusWeight = round1(c.bonusWeight);
    const pcts = c.marks.filter(m => m.percent !== undefined).map(m => m.percent!);
    if (pcts.length) c.averagePercent = round1(pcts.reduce((a, b) => a + b, 0) / pcts.length);
    // Ranked from newest to oldest by posting, due, or completion date (NOT by when the mark was released); oldest at the bottom
    const time = (m: MarkRow) => {
      const parse = (d?: string) => {
        if (!d) return NaN;
        const n = new Date(d).getTime();
        return isNaN(n) ? NaN : n;
      };
      const tDue = parse(m.dueDate);
      if (!isNaN(tDue)) return tDue;
      const tSub = parse(m.submittedAt);
      if (!isNaN(tSub)) return tSub;
      const tComp = parse(m.completedAt);
      if (!isNaN(tComp)) return tComp;
      const tCreated = parse(m.createdAt);
      if (!isNaN(tCreated)) return tCreated;
      const tGraded = parse(m.gradedAt);
      if (!isNaN(tGraded)) return tGraded;
      return -Infinity;
    };
    c.marks.sort((a, b) => {
      const diff = time(b) - time(a);
      if (diff !== 0) return diff;
      const numA = extractAssessmentNumber(a.title);
      const numB = extractAssessmentNumber(b.title);
      if (numA !== null && numB !== null && numA !== numB) {
        return numB - numA;
      }
      return a.title.localeCompare(b.title, undefined, { numeric: true });
    });
  }
  courses.sort((a, b) => a.courseName.localeCompare(b.courseName));
  return { courses, gradedCount, submittedCount };
}

/** "4.5 / 5" with trailing zeros dropped. */
export function formatScore(score?: number, max?: number): string {
  const f = (n?: number) => (n === undefined ? '-' : String(round1(n)));
  return `${f(score)} / ${f(max)}`;
}

export interface DeleteMarkResult {
  tasks: DeadlineTask[];
  action: 'deleted' | 'cleared' | 'none';
  previousTask?: DeadlineTask;
  title?: string;
}

/**
 * Deletes a mark from the Grades card:
 * - Standalone bonus/gradebook items are removed completely (caller records tombstone).
 * - Scheduled/announced deadlines keep the deadline intact while clearing the recorded mark
 *   and remembering any linked Blackboard grade column so future scans do not re-apply it.
 */
export function deleteMarkFromTasks(tasks: DeadlineTask[], markId: string): DeleteMarkResult {
  const list = Array.isArray(tasks) ? tasks : [];
  const target = list.find(t => t && t.id === markId);
  if (!target) return { tasks: list, action: 'none' };

  const previousTask: DeadlineTask = {
    ...target,
    ...(target.gradeSourcesBefore ? { gradeSourcesBefore: [...target.gradeSourcesBefore] } : {}),
    ...(target.dismissedGradeSources ? { dismissedGradeSources: [...target.dismissedGradeSources] } : {})
  };

  const isStandaloneMark = isStandaloneMarkTask(target);

  if (isStandaloneMark) {
    return {
      tasks: list.filter(t => t.id !== markId),
      action: 'deleted',
      previousTask,
      title: target.title
    };
  }

  const nextTask: DeadlineTask = { ...target };
  delete nextTask.score;
  delete nextTask.maxScore;
  delete nextTask.scoreDisplay;
  delete nextTask.gradedAt;
  delete nextTask.markProvisional;
  delete nextTask.submissionStatus;
  delete nextTask.submittedAt;
  delete nextTask.submissionReceipt;
  if (target.gradeSourceId) {
    nextTask.dismissedGradeSources = Array.from(
      new Set([...(target.dismissedGradeSources || []), target.gradeSourceId])
    );
    delete nextTask.gradeSourceId;
  }
  nextTask.userEdited = true;
  nextTask.updatedAt = new Date().toISOString();

  return {
    tasks: list.map(t => (t.id === markId ? nextTask : t)),
    action: 'cleared',
    previousTask,
    title: target.title
  };
}
