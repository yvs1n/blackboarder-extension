import type { DeadlineTask } from '../types';
import { coreTitle } from './streamParser';
import { sanitizeTaskListMarks } from './taskMerge';
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
  status: 'graded' | 'submitted';
  score?: number;
  maxScore?: number;
  percent?: number;
  weight?: number;
  /** Course percentage this mark earned: weight x score / max */
  earned?: number;
  dueDate?: string;
  gradedAt?: string;
  submittedAt?: string;
}

export interface CourseMarks {
  courseName: string;
  totalWeight: number;
  marks: MarkRow[];
  /** Sum of the weights of graded items with a known weight */
  gradedWeight: number;
  /** Course percentage earned from those items */
  earnedWeight: number;
  /** Average score across graded items, in percent */
  averagePercent?: number;
}

export interface MarksSummary {
  courses: CourseMarks[];
  gradedCount: number;
  submittedCount: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

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
    const graded = t.submissionStatus === 'graded' && typeof t.score === 'number' && !!t.maxScore && t.maxScore > 0;
    const submitted = !graded && (t.submissionStatus === 'submitted' || t.submissionStatus === 'graded');
    if (!graded && !submitted) continue;

    const syl = syllabi.find(s =>
      s.courseCodePattern.test(t.courseName || '') || s.courseCodePattern.test(t.courseCode || '')
    );
    const courseName = syl?.courseName || t.courseName || t.courseCode || 'Other';
    let course = byCourse.get(courseName);
    if (!course) {
      course = { courseName, totalWeight: syl?.totalWeight || 100, marks: [], gradedWeight: 0, earnedWeight: 0 };
      byCourse.set(courseName, course);
    }

    const weight = Number(t.weight) > 0 ? Number(t.weight) : undefined;
    const row: MarkRow = {
      id: t.id,
      title: t.title,
      status: graded ? 'graded' : 'submitted',
      weight,
      dueDate: t.dueDate,
      gradedAt: t.gradedAt,
      submittedAt: t.submittedAt
    };
    if (graded) {
      row.score = t.score;
      row.maxScore = t.maxScore;
      row.percent = round1((t.score! / t.maxScore!) * 100);
      if (weight) {
        row.earned = round1((t.score! / t.maxScore!) * weight);
      }
    }

    // Deduplicate marks within course (e.g. "Quiz 2" vs "2nd Quiz (Vector & Free Fall)", "EAP Midterm Exam" vs "Midterm")
    const existingIndex = course.marks.findIndex(m => {
      if (t.gradeSourceId && (m as any).gradeSourceId && t.gradeSourceId === (m as any).gradeSourceId) return true;
      const coreT = coreTitle(t.title);
      const coreM = coreTitle(m.title);
      if (coreT && coreM && coreT.length >= 4 && coreT === coreM) return true;
      if (isExamItem(t) && isExamItem({ title: m.title }) && /\b(?:midterm|نصفي)\b/i.test(t.title) && /\b(?:midterm|نصفي)\b/i.test(m.title)) return true;
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
        existingRow.status = 'graded';
        existingRow.score = row.score;
        existingRow.maxScore = row.maxScore;
        existingRow.percent = row.percent;
        if (weight && !existingRow.weight) {
          existingRow.weight = weight;
          existingRow.earned = row.earned;
          course.gradedWeight += weight;
          course.earnedWeight += (t.score! / t.maxScore!) * weight;
        }
        gradedCount++;
        submittedCount--;
      }
      continue;
    }

    if (graded) {
      gradedCount++;
      if (weight) {
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
