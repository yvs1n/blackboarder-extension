import type { DeadlineTask } from '../types';
import { coreTitle } from './streamParser';

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

  for (const t of tasks || []) {
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
    const row: MarkRow = { id: t.id, title: t.title, status: graded ? 'graded' : 'submitted', weight, dueDate: t.dueDate };
    if (graded) {
      row.score = t.score;
      row.maxScore = t.maxScore;
      row.percent = round1((t.score! / t.maxScore!) * 100);
      if (weight) {
        row.earned = round1((t.score! / t.maxScore!) * weight);
      }
    }

    // Deduplicate marks within course (e.g. "Quiz 2" vs "2nd Quiz (Vector & Free Fall)")
    const existingIndex = course.marks.findIndex(m => {
      if (t.gradeSourceId && (m as any).gradeSourceId && t.gradeSourceId === (m as any).gradeSourceId) return true;
      const coreT = coreTitle(t.title);
      const coreM = coreTitle(m.title);
      if (coreT && coreM && coreT.length >= 4 && coreT === coreM) return true;
      return false;
    });

    if (existingIndex !== -1) {
      const existingRow = course.marks[existingIndex];
      if (row.title.length > existingRow.title.length) {
        existingRow.title = row.title;
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
    // Most recent first (by the item's date); items without a date go last
    const time = (m: MarkRow) => {
      const n = new Date(m.dueDate || '').getTime();
      return isNaN(n) ? -Infinity : n;
    };
    c.marks.sort((a, b) => time(b) - time(a));
  }
  courses.sort((a, b) => a.courseName.localeCompare(b.courseName));
  return { courses, gradedCount, submittedCount };
}

/** "4.5 / 5" with trailing zeros dropped. */
export function formatScore(score?: number, max?: number): string {
  const f = (n?: number) => (n === undefined ? '-' : String(round1(n)));
  return `${f(score)} / ${f(max)}`;
}
