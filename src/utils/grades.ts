import { describeGradeScale, GradeRow } from '../core/universities';
import { GpaSummary, UOS_GRADE_SCALE } from './gpa';
import { MarksSummary, CourseMarks, formatScore } from './marks';

/**
 * The Grades card: the projected GPA, then each course's grade so far with every mark under it.
 * Shared by the extension's and the phone's Courses tab (same classes in both stylesheets).
 */

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Header badge: "GPA 3.50 · 4 marks", "2 marks · 1 awaiting" or "No marks yet". */
export function gradesBadgeText(gpa: GpaSummary, marks: MarksSummary): string {
  const parts: string[] = [];
  if (gpa.gpa !== undefined) parts.push(`GPA ${gpa.gpa.toFixed(2)}`);
  if (marks.gradedCount) parts.push(`${marks.gradedCount} mark${marks.gradedCount === 1 ? '' : 's'}`);
  if (marks.submittedCount) parts.push(`${marks.submittedCount} awaiting`);
  return parts.length ? parts.join(' · ') : 'No marks yet';
}

function markRowsHtml(course: CourseMarks | undefined): string {
  if (!course) return '';
  return course.marks.map(m => {
    const right = m.status === 'graded'
      ? `<span class="marks-score">${esc(formatScore(m.score, m.maxScore))}</span><span class="marks-pct">${m.percent}%</span>`
      : '<span class="marks-awaiting">Submitted</span>';
    const sub = m.weight
      ? `<span class="marks-weight">${m.earned !== undefined ? `${m.earned} of ${m.weight}%` : `worth ${m.weight}%`}</span>`
      : '';
    return `<div class="marks-row"><span class="marks-title">${esc(m.title)}</span>${sub}<span class="marks-right">${right}</span></div>`;
  }).join('');
}

export function gradesHtml(
  gpa: GpaSummary,
  marks: MarksSummary,
  colorFor: (courseName: string) => string,
  scaleInfo: { name: string; scale: ReadonlyArray<GradeRow>; fromSyllabus?: boolean } = { name: 'UOS', scale: UOS_GRADE_SCALE }
): string {
  if (!gpa.courses.length && !marks.courses.length) {
    return '<div class="marks-empty">No courses yet. Add them below or scan Blackboard.</div>';
  }
  const topPoints = Math.max(...scaleInfo.scale.map(g => g.points), 0) || 4;
  const marksByCourse = new Map(marks.courses.map(c => [c.courseName, c]));

  const head = gpa.gpa === undefined
    ? '<div class="gpa-head"><span class="gpa-value">-</span><span class="gpa-caption">No marks yet. Marks are read from the Blackboard gradebook when you scan, and your GPA appears after the first one.</span></div>'
    : `<div class="gpa-head"><span class="gpa-value">${gpa.gpa.toFixed(2)}</span><span class="gpa-caption">Projected GPA from marks so far, ${gpa.gradedCredits} of ${gpa.totalCredits} credit hours</span></div>`;

  const courseRows = gpa.courses.map(c => {
    const courseMarks = marksByCourse.get(c.courseName);
    marksByCourse.delete(c.courseName);
    const right = c.percent === undefined
      ? `<span class="marks-awaiting">${courseMarks ? 'Not graded yet' : 'No marks yet'}</span>`
      : `<span class="marks-pct">${c.percent}%</span><span class="gpa-letter">${esc(c.letter)}</span>`;
    // Marks earned out of the course marks graded so far, and what the letter adds to the GPA
    const detail = c.percent === undefined ? '' : `<div class="gpa-detail">${c.earnedWeight} of ${c.gradedWeight} marks so far · ${esc(c.letter)} = ${c.points!.toFixed(1)} of ${topPoints.toFixed(1)} GPA points</div>`;
    const drops = c.components.filter(k => k.dropped.length).map(k =>
      `<div class="gpa-detail">${esc(k.name)}${k.rule ? ` (${esc(k.rule)})` : ''}: not counted ${k.dropped.map(d => `${esc(d.title)} ${d.percent}%`).join(', ')}</div>`
    ).join('');
    return `<div class="marks-course">
      <div class="marks-course-head"><span class="marks-dot" style="background:${esc(colorFor(c.courseName))}"></span><span class="marks-course-name">${esc(c.courseName)}</span><span class="marks-course-total">${c.creditHours} cr</span><span class="marks-right">${right}</span></div>
      ${detail}${drops}${markRowsHtml(courseMarks)}
    </div>`;
  });

  // Marks for courses that are not set up (no grade, but the marks still show)
  for (const c of marksByCourse.values()) {
    const total = c.averagePercent !== undefined ? `<span class="marks-course-total">Avg ${c.averagePercent}%</span>` : '';
    courseRows.push(`<div class="marks-course">
      <div class="marks-course-head"><span class="marks-dot" style="background:${esc(colorFor(c.courseName))}"></span><span class="marks-course-name">${esc(c.courseName)}</span>${total}</div>
      ${markRowsHtml(c)}
    </div>`);
  }

  const scale = describeGradeScale([...scaleInfo.scale]);
  const cutoffs = scaleInfo.fromSyllabus ? ' Instructors set the percentages, so check your syllabus and edit the scale in Settings if it differs.' : '';
  return `${head}${courseRows.join('')}<div class="gpa-note">${esc(scaleInfo.name)} scale: ${esc(scale)}.${cutoffs} A course grade is your score on what is graded so far. Each letter is worth GPA points (shown under each course), and the GPA averages them by credit hours; set credit hours by editing the course below.</div>`;
}
