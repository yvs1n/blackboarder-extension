import { describeGradeScale, GradeRow } from '../core/universities';
import { GpaSummary, UOS_GRADE_SCALE } from './gpa';
import { MarksSummary, CourseMarks, formatScore } from './marks';
import type { CumulativeGpaSummary, ArchivedSemester, DeadlineTask } from '../types';
import { calculateCourseTargetAnalysis, CourseTargetAnalysis, calculateTrajectoryTargetPlan, TrajectoryTargetPlan } from '../core/targetGpa';

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

function targetSectionHtml(analysis: CourseTargetAnalysis, selectedLetter?: string): string {
  if (analysis.remainingWeight <= 0) {
    return `<div class="gpa-target-wrap"><div class="gpa-target-desc" style="color: var(--text-muted); font-size: 10.5px;">All course assessment weight is 100% graded.</div></div>`;
  }

  const validTargets = analysis.targets.filter(t => !t.unattainable);
  const activeTarget = (selectedLetter ? analysis.targets.find(t => t.letter === selectedLetter) : null)
    || analysis.targets.find(t => t.letter === 'A' && !t.unattainable)
    || validTargets[0]
    || analysis.targets[0];

  const pills = analysis.targets.slice(0, 5).map(t => {
    const isSel = activeTarget && t.letter === activeTarget.letter;
    const isUnattainable = t.unattainable;
    const isGuaranteed = t.guaranteed;
    const title = isUnattainable
      ? `Unattainable (max possible ${analysis.maxPossiblePercent}%)`
      : isGuaranteed
      ? `Guaranteed (already earned ${analysis.earnedWeight}%)`
      : `Need ${t.requiredPercent}% on remaining ${analysis.remainingWeight}% weight`;
    const cls = ['target-chip', isSel ? 'is-active' : '', isUnattainable ? 'is-unattainable' : '', isGuaranteed ? 'is-guaranteed' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-course="${esc(analysis.courseName)}" data-letter="${esc(t.letter)}" title="${esc(title)}">${esc(t.letter)}</button>`;
  }).join('');

  let targetDesc = '';
  if (!activeTarget) {
    targetDesc = `<span class="target-desc-dim">No target available</span>`;
  } else if (activeTarget.guaranteed) {
    targetDesc = `<span class="target-desc-highlight" style="color: #059669; font-weight: 600;">Grade ${esc(activeTarget.letter)} guaranteed</span> (${analysis.earnedWeight}% earned &ge; ${activeTarget.minPercent}% cutoff)`;
  } else if (activeTarget.unattainable) {
    targetDesc = `<span class="target-desc-dim" style="color: var(--text-muted);">Grade ${esc(activeTarget.letter)} unattainable (max possible is ${analysis.maxPossiblePercent}%)</span>`;
  } else {
    const upcoming = (activeTarget.upcomingTasks || []).map(u => {
      return `${esc(u.title)}: ${u.targetScore}/${u.maxScore}`;
    }).slice(0, 2).join(' · ');

    const breakdownText = upcoming ? ` · ${upcoming}` : '';
    targetDesc = `Target <strong class="target-highlight" style="color: var(--text-main); font-weight: 700;">${esc(activeTarget.letter)}</strong> (${activeTarget.minPercent}%): Need <strong class="target-highlight" style="color: var(--text-main); font-weight: 700;">${activeTarget.requiredPercent}%</strong> on remaining ${analysis.remainingWeight}% weight${breakdownText}`;
  }

  return `<div class="gpa-target-wrap" data-course="${esc(analysis.courseName)}">
    <div class="gpa-target-header">
      <span class="gpa-target-label">Target Grade</span>
      <div class="gpa-target-chips">${pills}</div>
    </div>
    <div class="gpa-target-desc">${targetDesc}</div>
  </div>`;
}

export function gradesHtml(
  gpa: GpaSummary,
  marks: MarksSummary,
  colorFor: (courseName: string) => string,
  scaleInfo: { name: string; scale: ReadonlyArray<GradeRow>; fromSyllabus?: boolean } = { name: 'UOS', scale: UOS_GRADE_SCALE },
  cumulative?: CumulativeGpaSummary | null,
  options?: {
    tasks?: DeadlineTask[];
    selectedTargets?: Record<string, string>;
    targetTermGpa?: number;
  }
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

  // Target Term GPA Planner & Trajectory Allocation
  let targetPlannerHtml = '';
  let trajectoryPlan: TrajectoryTargetPlan | null = null;
  if (gpa.courses.length > 0) {
    const defaultTarget = gpa.gpa !== undefined
      ? Math.min(4.0, Math.round((Math.max(2.0, gpa.gpa) + 0.25) * 20) / 20)
      : 3.75;
    const targetGpaVal = (typeof options?.targetTermGpa === 'number' && options.targetTermGpa > 0)
      ? options.targetTermGpa
      : defaultTarget;

    trajectoryPlan = calculateTrajectoryTargetPlan(
      gpa,
      targetGpaVal,
      options?.tasks || [],
      scaleInfo.scale
    );

    const planSummary = trajectoryPlan.possible
      ? `<div class="target-plan-summary" style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--surface-border); font-size: 10.5px; color: var(--text-muted); line-height: 1.4;">
           <span style="font-weight: 600; color: var(--text-main);">Trajectory Targets (${trajectoryPlan.plannedGpa.toFixed(2)} Planned):</span>
           ${trajectoryPlan.courses.map(pc => `<span><strong>${esc(pc.courseName)}</strong>: <strong style="color: var(--primary);">${esc(pc.targetLetter)}</strong> (need ${pc.requiredPercent}%)${pc.upcomingTasks.length > 0 ? ` [${esc(pc.upcomingTasks[0].title)}: ${pc.upcomingTasks[0].targetScore}/${pc.upcomingTasks[0].maxScore}]` : ''}</span>`).join(' · ')}
         </div>`
      : `<div class="target-plan-summary" style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--surface-border); font-size: 10.5px; color: #dc2626; line-height: 1.4;">
           ⚠️ Target ${targetGpaVal.toFixed(2)} is mathematically unattainable based on completed weight. Highest achievable GPA is <strong>${trajectoryPlan.maxPossibleGpa.toFixed(2)}</strong>.
         </div>`;

    targetPlannerHtml = `<div class="target-gpa-bar" style="margin-top: 10px; margin-bottom: 8px; padding: 10px 12px; background: var(--surface-hover); border: 1px solid var(--surface-border);">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
        <div>
          <span style="font-size: 11.5px; font-weight: 700; color: var(--text-main); display: block;">Target Term GPA</span>
          <span style="font-size: 10px; color: var(--text-muted); display: block;">Trajectory-weighted score targets for upcoming dues</span>
        </div>
        <div style="display: flex; align-items: center; gap: 4px;">
          <button type="button" class="btn-xs-manage-links btn-target-chip-val" data-target="3.50" style="padding: 2px 6px; font-size: 10.5px; height: 24px; min-height: 24px;">3.50</button>
          <button type="button" class="btn-xs-manage-links btn-target-chip-val" data-target="3.75" style="padding: 2px 6px; font-size: 10.5px; height: 24px; min-height: 24px;">3.75</button>
          <button type="button" class="btn-xs-manage-links btn-target-chip-val" data-target="4.00" style="padding: 2px 6px; font-size: 10.5px; height: 24px; min-height: 24px;">4.00</button>
          <input type="number" id="input-target-term-gpa" class="form-input" min="1.0" max="4.0" step="0.05" value="${targetGpaVal.toFixed(2)}" style="width: 58px; font-size: 11.5px; padding: 2px 4px; text-align: center; font-weight: 700; height: 24px; min-height: 24px; box-sizing: border-box;" title="Enter custom Target Term GPA" />
        </div>
      </div>
      ${planSummary}
    </div>`;
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
    const targetAnalysis = calculateCourseTargetAnalysis(c, options?.tasks || [], scaleInfo.scale);
    const plannedTargetLetter = trajectoryPlan?.courses.find(pc => pc.courseName === c.courseName)?.targetLetter;
    const activeSelectedLetter = options?.selectedTargets?.[c.courseName] || plannedTargetLetter;
    const targetHtml = targetSectionHtml(targetAnalysis, activeSelectedLetter);
    return `<div class="marks-course">
      <div class="marks-course-head"><span class="marks-dot" style="background:${esc(colorFor(c.courseName))}"></span><span class="marks-course-name">${esc(c.courseName)}</span><span class="marks-course-total">${c.creditHours} cr</span><span class="marks-right">${right}</span></div>
      ${detail}${drops}${markRowsHtml(courseMarks)}${targetHtml}
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
  return `${head}${courseRows.join('')}${targetPlannerHtml}<div class="gpa-note">${esc(scaleInfo.name)} scale: ${esc(scale)}.${cutoffs} A course grade is your score on what is graded so far. Each letter is worth GPA points (shown under each course), and the GPA averages them by credit hours; set credit hours by editing the course below.</div>`;
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
