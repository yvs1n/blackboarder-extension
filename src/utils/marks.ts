import type { DeadlineTask } from '../types';

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
      gradedCount++;
      row.score = t.score;
      row.maxScore = t.maxScore;
      row.percent = round1((t.score! / t.maxScore!) * 100);
      if (weight) {
        row.earned = round1((t.score! / t.maxScore!) * weight);
        course.gradedWeight += weight;
        course.earnedWeight += (t.score! / t.maxScore!) * weight;
      }
    } else {
      submittedCount++;
    }
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

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Short badge text for the Marks header. */
export function marksBadgeText(summary: MarksSummary): string {
  if (!summary.gradedCount && !summary.submittedCount) return 'No marks yet';
  const parts = [`${summary.gradedCount} mark${summary.gradedCount === 1 ? '' : 's'}`];
  if (summary.submittedCount) parts.push(`${summary.submittedCount} awaiting`);
  return parts.join(' · ');
}

/**
 * The Marks list, shared by the extension popup and the phone app (same classes in both stylesheets).
 * `colorFor` gives a course's colour.
 */
export function marksSummaryHtml(summary: MarksSummary, colorFor: (courseName: string) => string): string {
  if (!summary.courses.length) {
    return '<div class="marks-empty">No marks yet. Marks are read from the Blackboard gradebook when you scan.</div>';
  }
  return summary.courses.map(c => {
    const head = c.gradedWeight > 0
      ? `<span class="marks-course-total" title="Course grade earned from graded items with a known weight">${c.earnedWeight}% of ${c.gradedWeight}% graded</span>`
      : (c.averagePercent !== undefined ? `<span class="marks-course-total">Avg ${c.averagePercent}%</span>` : '');
    const rows = c.marks.map(m => {
      const right = m.status === 'graded'
        ? `<span class="marks-score">${esc(formatScore(m.score, m.maxScore))}</span><span class="marks-pct">${m.percent}%</span>`
        : '<span class="marks-awaiting">Submitted</span>';
      const sub = m.weight
        ? `<span class="marks-weight">${m.earned !== undefined ? `${m.earned} of ${m.weight}%` : `worth ${m.weight}%`}</span>`
        : '';
      return `<div class="marks-row"><span class="marks-title">${esc(m.title)}</span>${sub}<span class="marks-right">${right}</span></div>`;
    }).join('');
    return `<div class="marks-course">
      <div class="marks-course-head"><span class="marks-dot" style="background:${esc(colorFor(c.courseName))}"></span><span class="marks-course-name">${esc(c.courseName)}</span>${head}</div>
      ${rows}
    </div>`;
  }).join('');
}
