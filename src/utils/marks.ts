import type { DeadlineTask } from '../types';
import { coreTitle } from './streamParser';
import { extractAssessmentNumber } from '../core/syllabusWeights';
import { sanitizeTaskListMarks } from './taskMerge';
import { round1 } from './uiCommon';
import { isExamItem } from './gradebook';

/** The fields of a syllabus this summary needs (both the extension and phone shapes have them). */
export interface MarksSyllabus {
  courseName: string;
  courseCodePattern: RegExp;
  totalWeight?: number;
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
  isBonus?: boolean;
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
    const graded = (t.submissionStatus === 'graded' && typeof t.score === 'number' && !!t.maxScore && t.maxScore > 0)
      || (isBonus && typeof (t.score ?? t.weight) === 'number' && Number(t.score ?? t.weight) > 0);
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

    const bonusVal = isBonus ? Number(t.weight || t.score || 0) : 0;
    const weight = isBonus ? bonusVal : (Number(t.weight) > 0 ? Number(t.weight) : undefined);
    const row: MarkRow = {
      id: t.id,
      title: t.title,
      status: graded ? 'graded' : (waiting ? 'waiting' : 'submitted'),
      weight,
      dueDate: t.dueDate,
      gradedAt: t.gradedAt,
      submittedAt: t.submittedAt,
      isBonus
    };
    if (graded) {
      if (isBonus) {
        row.score = bonusVal;
        row.maxScore = bonusVal;
        row.percent = 100;
        row.earned = round1(bonusVal);
      } else {
        row.score = t.score;
        row.maxScore = t.maxScore;
        row.percent = round1((t.score! / t.maxScore!) * 100);
        if (weight) {
          row.earned = round1((t.score! / t.maxScore!) * weight);
        }
      }
    }

    // Deduplicate marks within course (e.g. "Quiz 2" vs "2nd Quiz (Vector & Free Fall)", "EAP Midterm Exam" vs "Midterm")
    const existingIndex = course.marks.findIndex(m => {
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
    // Ranked from newest to oldest: most recently graded or due first; undated items go last
    const time = (m: MarkRow) => {
      const parse = (d?: string) => {
        if (!d) return NaN;
        const n = new Date(d).getTime();
        return isNaN(n) ? NaN : n;
      };
      const tGraded = parse(m.gradedAt);
      if (!isNaN(tGraded)) return tGraded;
      const tDue = parse(m.dueDate);
      if (!isNaN(tDue)) return tDue;
      const tSub = parse(m.submittedAt);
      if (!isNaN(tSub)) return tSub;
      return -Infinity;
    };
    c.marks.sort((a, b) => {
      const diff = time(b) - time(a);
      if (diff !== 0) return diff;
      return a.title.localeCompare(b.title);
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
