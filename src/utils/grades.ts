import { describeGradeScale, GradeRow } from '../core/universities';
import { GpaSummary, UOS_GRADE_SCALE } from './gpa';
import { MarksSummary, CourseMarks, formatScore } from './marks';
import type { CumulativeGpaSummary, ArchivedSemester } from '../types';

/**
 * The Grades card: the projected GPA, then each course's grade so far with every mark under it.
 * Shared by the extension's and the phone's Courses tab (same classes in both stylesheets).
 */

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Header badge: "GPA 3.50 · 4 marks", "CGPA 3.65 · Term 3.50", or "No marks yet". */
export function gradesBadgeText(gpa: GpaSummary, marks: MarksSummary, cumulative?: CumulativeGpaSummary | null): string {
  const parts: string[] = [];
  if (cumulative?.cgpa !== undefined && cumulative.archivedSemestersCount > 0) {
    parts.push(`CGPA ${cumulative.cgpa.toFixed(2)}`);
    if (gpa.gpa !== undefined) parts.push(`Term ${gpa.gpa.toFixed(2)}`);
  } else if (gpa.gpa !== undefined) {
    parts.push(`GPA ${gpa.gpa.toFixed(2)}`);
  }
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
  scaleInfo: { name: string; scale: ReadonlyArray<GradeRow>; fromSyllabus?: boolean } = { name: 'UOS', scale: UOS_GRADE_SCALE },
  cumulative?: CumulativeGpaSummary | null
): string {
  if (!gpa.courses.length && !marks.courses.length) {
    return '<div class="marks-empty">No courses yet. Add them below or scan Blackboard.</div>';
  }
  const topPoints = Math.max(...scaleInfo.scale.map(g => g.points), 0) || 4;
  const marksByCourse = new Map(marks.courses.map(c => [c.courseName, c]));

  const hasHistory = Boolean(
    cumulative && (
      cumulative.archivedSemestersCount > 0 ||
      (cumulative.totalGradedCredits > (gpa.gradedCredits || 0)) ||
      (cumulative.cgpa !== undefined && gpa.gpa !== undefined && Math.abs(cumulative.cgpa - gpa.gpa) > 0.001)
    )
  );

  let head = '';
  if (hasHistory && cumulative) {
    const termVal = gpa.gpa === undefined ? '-' : gpa.gpa.toFixed(2);
    const cgpaVal = cumulative.cgpa === undefined ? '-' : cumulative.cgpa.toFixed(2);
    const progressRow = cumulative.degreeProgressPercent !== undefined
      ? `<div class="gpa-progress-wrap" title="${cumulative.totalCompletedCredits} of ${cumulative.targetCredits} degree credits completed" style="grid-column: 1 / -1; margin-top: 6px;">
           <div class="gpa-progress-track" style="height: 4px; background: var(--surface-border); width: 100%;"><div class="gpa-progress-bar" style="height: 100%; background: var(--primary); width:${cumulative.degreeProgressPercent}%;"></div></div>
           <span class="gpa-progress-text" style="font-size: 10.5px; color: var(--text-muted); margin-top: 4px; display: block;">Degree Progress: ${cumulative.totalCompletedCredits} of ${cumulative.targetCredits} cr completed (${cumulative.degreeProgressPercent}%)</span>
         </div>`
      : '';

    head = `<div class="gpa-head gpa-head-dual" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
      <div class="gpa-stat-box">
        <span class="gpa-value">${termVal}</span>
        <span class="gpa-caption">Term SGPA (${gpa.gradedCredits} of ${gpa.totalCredits} cr)</span>
      </div>
      <div class="gpa-stat-box gpa-stat-cgpa">
        <span class="gpa-value">${cgpaVal}</span>
        <span class="gpa-caption">Cumulative CGPA (${cumulative.totalGradedCredits} cr)</span>
      </div>
      ${progressRow}
    </div>`;
  } else {
    head = gpa.gpa === undefined
      ? '<div class="gpa-head"><span class="gpa-value">-</span><span class="gpa-caption">No marks yet. Marks are read from the Blackboard gradebook when you scan, and your GPA appears after the first one.</span></div>'
      : `<div class="gpa-head"><span class="gpa-value">${gpa.gpa.toFixed(2)}</span><span class="gpa-caption">Projected GPA from marks so far, ${gpa.gradedCredits} of ${gpa.totalCredits} credit hours</span></div>`;
  }

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
    if (/orientation|توجيه|تهيئة/i.test(c.courseName)) continue;
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

/** Renders a read-only view of a concluded archived semester. */
export function archivedSemesterHtml(
  semester: ArchivedSemester,
  scaleInfo: { name: string; scale: ReadonlyArray<GradeRow> } = { name: 'UOS', scale: UOS_GRADE_SCALE }
): string {
  const topPoints = Math.max(...scaleInfo.scale.map(g => g.points), 0) || 4;
  const termVal = semester.termGpa !== undefined ? semester.termGpa.toFixed(2) : '-';
  const head = `<div class="gpa-head" style="margin-bottom: 10px;">
    <div style="display: flex; align-items: baseline; justify-content: space-between; width: 100%;">
      <div>
        <span class="gpa-value">${termVal}</span>
        <span class="gpa-caption">${esc(semester.name)} Term GPA · ${semester.gradedCredits} of ${semester.totalCredits} credits</span>
      </div>
      <span class="info-badge blue" style="font-size: 10px; font-weight: 600;">Archived</span>
    </div>
  </div>`;

  const rows = (semester.courses || []).map(c => {
    const letter = c.grade || '-';
    const points = typeof c.points === 'number' ? `${c.points.toFixed(1)} / ${topPoints.toFixed(1)} pts` : '';
    const pct = typeof c.percent === 'number' ? `${c.percent}%` : '';
    const color = c.colorHex || 'var(--text-muted)';
    return `<div class="marks-course">
      <div class="marks-course-head">
        <span class="marks-dot" style="background:${esc(color)}"></span>
        <span class="marks-course-name">${esc(c.name)}</span>
        <span class="marks-course-total">${c.creditHours} cr</span>
        <span class="marks-right">
          ${pct ? `<span class="marks-pct">${pct}</span>` : ''}
          <span class="gpa-letter">${esc(letter)}</span>
        </span>
      </div>
      ${points ? `<div class="gpa-detail">${esc(c.code ? `${c.code} · ` : '')}${esc(letter)} = ${points}</div>` : ''}
    </div>`;
  }).join('');

  return head + (rows || '<div class="marks-empty">No course records in this archived semester.</div>');
}
