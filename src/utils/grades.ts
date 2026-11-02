import { describeGradeScale, GradeRow } from '../core/universities';
import { GpaSummary, UOS_GRADE_SCALE } from './gpa';
import { MarksSummary, CourseMarks, formatScore } from './marks';
import type { CumulativeGpaSummary, ArchivedSemester, DeadlineTask } from '../types';
import { calculateCourseTargetAnalysis, calculateTrajectoryTargetPlan, TrajectoryTargetPlan } from '../core/targetGpa';

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
  cumulative?: CumulativeGpaSummary | null,
  options?: {
    tasks?: DeadlineTask[];
    selectedTargets?: Record<string, string>;
    targetTermGpa?: number;
  }
): string {
  if (!gpa.courses.length && !marks.courses.length) {
    return '<div class="marks-empty">No courses yet. Add them in the Courses tab or scan Blackboard.</div>';
  }
  const topPoints = Math.max(...scaleInfo.scale.map(g => g.points), 0) || 4;
  const marksByCourse = new Map(marks.courses.map(c => [c.courseName, c]));

  // 1. Calculate Trajectory Plan
  let trajectoryPlan: TrajectoryTargetPlan | null = null;
  const defaultTarget = gpa.gpa !== undefined
    ? Math.min(4.0, Math.round((Math.max(2.0, gpa.gpa) + 0.25) * 20) / 20)
    : 3.75;
  const targetGpaVal = (typeof options?.targetTermGpa === 'number' && options.targetTermGpa > 0)
    ? options.targetTermGpa
    : defaultTarget;

  if (gpa.courses.length > 0) {
    trajectoryPlan = calculateTrajectoryTargetPlan(
      gpa,
      targetGpaVal,
      options?.tasks || [],
      scaleInfo.scale
    );
  }

  // Calculate Projected Cumulative CGPA
  let projectedCgpaText = '';
  let projCgpaVal: number | null = null;
  let projTotalCred = 0;
  if (trajectoryPlan) {
    const plannedTermGpa = trajectoryPlan.plannedGpa;
    const termCredits = gpa.totalCredits > 0 ? gpa.totalCredits : 15;
    if (cumulative && cumulative.totalGradedCredits > 0) {
      const priorCredits = Math.max(0, cumulative.totalGradedCredits - (gpa.gradedCredits || 0));
      const priorWeighted = (cumulative.cgpa || 0) * (cumulative.totalGradedCredits || 0);
      const activeWeighted = (gpa.gpa || 0) * (gpa.gradedCredits || 0);
      const priorPoints = Math.max(0, priorWeighted - activeWeighted);
      projTotalCred = priorCredits + termCredits;
      const projTotalPts = priorPoints + (plannedTermGpa * termCredits);
      projCgpaVal = projTotalCred > 0 ? (projTotalPts / projTotalCred) : plannedTermGpa;
      projectedCgpaText = `Projected CGPA: <strong class="marks-gpa-cgpa-val">${projCgpaVal.toFixed(2)}</strong> (${projTotalCred} cr)`;
    } else {
      projTotalCred = termCredits;
      projCgpaVal = plannedTermGpa;
      projectedCgpaText = `Projected CGPA: <strong class="marks-gpa-cgpa-val">${plannedTermGpa.toFixed(2)}</strong> (${termCredits} cr)`;
    }
  }

  // Target explanation note (discrete grade rounding explanation)
  let targetExplanation = '';
  if (trajectoryPlan) {
    if (!trajectoryPlan.possible) {
      targetExplanation = `<div class="target-plan-unattainable" style="margin-top: 6px;">
        <span class="target-unattainable-title">Target ${targetGpaVal.toFixed(2)} is mathematically unattainable</span>
        <span class="target-unattainable-sub">Highest achievable Term SGPA is <strong>${trajectoryPlan.maxPossibleGpa.toFixed(2)}</strong>.</span>
        <button type="button" class="btn-xs-manage-links btn-set-max-gpa" data-max-gpa="${trajectoryPlan.maxPossibleGpa.toFixed(2)}">Set to Max (${trajectoryPlan.maxPossibleGpa.toFixed(2)})</button>
      </div>`;
    } else if (Math.abs(trajectoryPlan.plannedGpa - targetGpaVal) >= 0.005) {
      const diff = trajectoryPlan.plannedGpa - targetGpaVal;
      const sign = diff >= 0 ? '+' : '';
      targetExplanation = `<div class="target-rounding-note" style="margin-top: 6px;">
        <span class="target-rounding-title">Nearest attainable combination: <strong>${trajectoryPlan.plannedGpa.toFixed(2)} SGPA</strong> (${sign}${diff.toFixed(2)})</span>
        <span class="target-rounding-sub">University grades round to discrete scale points (A = 4.0, B+ = 3.5) weighted by credit hours.</span>
      </div>`;
    }
  }

  // SECTION 1: Dual-Column GPA Overview (Clean, balanced & symmetrical)
  const termVal = gpa.gpa === undefined ? '-' : gpa.gpa.toFixed(2);
  const cgpaVal = (cumulative?.cgpa !== undefined) ? cumulative.cgpa.toFixed(2) : '-';
  const totalGradedCreds = cumulative?.totalGradedCredits || gpa.gradedCredits || 0;

  const hasDiffCgpa = Boolean(
    cumulative &&
    cumulative.cgpa !== undefined &&
    gpa.gpa !== undefined &&
    Math.abs(cumulative.cgpa - gpa.gpa) > 0.001
  );

  const progressRow = (cumulative && cumulative.degreeProgressPercent !== undefined)
    ? `<div class="gpa-progress-wrap" title="${cumulative.totalCompletedCredits} of ${cumulative.targetCredits} degree credits completed" style="margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--surface-border);">
         <div class="gpa-progress-track" style="height: 4px; background: var(--surface-border); width: 100%; border-radius: 0;"><div class="gpa-progress-bar" style="height: 100%; background: var(--primary); width:${cumulative.degreeProgressPercent}%;"></div></div>
         <span class="gpa-progress-text" style="font-size: 10px; color: var(--text-muted); margin-top: 3px; display: block;">Degree Progress: ${cumulative.totalCompletedCredits} of ${cumulative.targetCredits} cr completed (${cumulative.degreeProgressPercent}%)</span>
       </div>`
    : '';

  const gpaOverviewHtml = `
    <div class="marks-gpa-overview" style="margin-bottom: 8px;">
      <div class="gpa-head-dual" style="display: grid; grid-template-columns: ${trajectoryPlan ? '1fr 1fr' : '1fr'}; gap: 8px;">
        <div class="marks-gpa-col gpa-stat-current" style="padding: 8px 10px; background: var(--surface); border: 1px solid var(--surface-border); display: flex; flex-direction: column; justify-content: center;">
          <span class="marks-gpa-col-title" style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); display: block; margin-bottom: 4px;">Current Standing</span>
          <div style="display: flex; align-items: baseline; gap: 8px;">
            <span class="marks-gpa-big" style="font-size: 24px; font-weight: 800; color: var(--text-main); line-height: 1;">${termVal}</span>
            <span style="font-size: 11px; color: var(--text-muted);">Term SGPA (${gpa.gradedCredits} of ${gpa.totalCredits} cr)</span>
          </div>
          ${hasDiffCgpa ? `<div class="marks-gpa-cgpa-row" style="font-size: 10.5px; color: var(--text-muted); margin-top: 2px;">Cumulative CGPA: <strong class="marks-gpa-cgpa-val">${cgpaVal}</strong> (${totalGradedCreds} cr)</div>` : ''}
        </div>

        ${trajectoryPlan ? `
        <div class="marks-gpa-col gpa-stat-target" style="padding: 8px 10px; background: var(--surface); border: 1px solid var(--surface-border); display: flex; flex-direction: column; justify-content: center;">
          <span class="marks-gpa-col-title" style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); display: block; margin-bottom: 4px;">Academic Goal</span>
          <div style="display: flex; align-items: baseline; gap: 8px;">
            <span class="marks-gpa-big is-target" style="font-size: 24px; font-weight: 800; color: var(--primary); line-height: 1;">${trajectoryPlan.plannedGpa.toFixed(2)}</span>
            <span style="font-size: 11px; color: var(--text-muted);">Planned SGPA</span>
          </div>
          ${hasDiffCgpa ? `<div class="marks-gpa-cgpa-row" style="font-size: 10.5px; color: var(--text-muted); margin-top: 2px;">${projectedCgpaText}</div>` : ''}
        </div>
        ` : ''}
      </div>

      ${trajectoryPlan ? `
      <div class="marks-gpa-goal-bar" style="margin-top: 6px; padding: 6px 10px; background: var(--surface); border: 1px solid var(--surface-border);">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
          <span style="font-size: 11px; font-weight: 700; color: var(--text-main);">Target Term SGPA:</span>
          <div style="display: flex; align-items: center; gap: 4px;">
            <button type="button" class="btn-xs-manage-links btn-target-chip-val" data-target="3.50" style="padding: 1px 6px; font-size: 10px; height: 22px; min-height: 22px;">3.50</button>
            <button type="button" class="btn-xs-manage-links btn-target-chip-val" data-target="3.75" style="padding: 1px 6px; font-size: 10px; height: 22px; min-height: 22px;">3.75</button>
            <button type="button" class="btn-xs-manage-links btn-target-chip-val" data-target="4.00" style="padding: 1px 6px; font-size: 10px; height: 22px; min-height: 22px;">4.00</button>
            <input type="number" id="input-target-term-gpa" class="form-input" min="1.0" max="4.0" step="0.05" value="${targetGpaVal.toFixed(2)}" style="width: 52px; font-size: 11px; padding: 1px 3px; text-align: center; font-weight: 700; height: 22px; min-height: 22px; box-sizing: border-box;" title="Enter custom Target Term GPA" />
          </div>
        </div>
        ${targetExplanation}
      </div>
      ` : ''}
      ${progressRow}
    </div>
  `;

  // SECTION 2: Current Term Course Grades (Clean & compact, matching Courses tab layout)
  const courseRows = gpa.courses.map(c => {
    const courseMarks = marksByCourse.get(c.courseName);
    marksByCourse.delete(c.courseName);
    const right = c.percent === undefined
      ? `<span class="marks-awaiting">${courseMarks ? 'Not graded yet' : 'No marks yet'}</span>`
      : `<span class="marks-pct">${c.percent}%</span><span class="gpa-letter">${esc(c.letter)}</span>`;
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

  const currentGradesCard = `
    <div class="marks-section-wrap" id="marks-card-current-grades" style="margin-top: 10px; margin-bottom: 8px;">
      <div class="marks-section-head" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; padding: 0 1px;">
        <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted);">Current Term Grades</span>
        <span style="font-size: 10.5px; color: var(--text-muted); font-variant-numeric: tabular-nums;">${marks.gradedCount} Graded · ${gpa.courses.length} Courses</span>
      </div>
      <div class="marks-courses-list" style="display: flex; flex-direction: column; gap: 4px;">
        ${courseRows.join('')}
      </div>
    </div>
  `;

  // SECTION 3: Target Grade Breakdown & Trajectory Planner (Predicted Grade as Percentage)
  let targetBreakdownCard = '';
  if (trajectoryPlan && trajectoryPlan.courses.length > 0) {
    const targetCardsHtml = trajectoryPlan.courses.map(pc => {
      const courseGrade = gpa.courses.find(c => c.courseName === pc.courseName);
      const targetAnalysis = calculateCourseTargetAnalysis(
        courseGrade || { courseName: pc.courseName, creditHours: pc.creditHours, gradedWeight: pc.gradedWeight, earnedWeight: 0, components: [] },
        options?.tasks || [],
        scaleInfo.scale
      );

      const activeSelectedLetter = options?.selectedTargets?.[pc.courseName] || pc.targetLetter;
      const validTargets = targetAnalysis.targets.filter(t => !t.unattainable);
      const activeTarget = targetAnalysis.targets.find(t => t.letter === activeSelectedLetter)
        || targetAnalysis.targets.find(t => t.letter === pc.targetLetter)
        || validTargets[0]
        || targetAnalysis.targets[0];

      // Interactive target selector chips with percentage cutoffs
      const pills = targetAnalysis.targets.slice(0, 5).map(t => {
        const isSel = activeTarget && t.letter === activeTarget.letter;
        const isUnattainable = t.unattainable;
        const isGuaranteed = t.guaranteed;
        const title = isUnattainable
          ? `Unattainable (max possible ${targetAnalysis.maxPossiblePercent}%)`
          : isGuaranteed
          ? `Guaranteed (already earned ${targetAnalysis.earnedWeight}%)`
          : `Need ${t.requiredPercent}% on remaining ${targetAnalysis.remainingWeight}% weight to earn ${t.letter} (${t.minPercent}%)`;
        const cls = ['target-chip', isSel ? 'is-active' : '', isUnattainable ? 'is-unattainable' : '', isGuaranteed ? 'is-guaranteed' : ''].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}" data-course="${esc(pc.courseName)}" data-letter="${esc(t.letter)}" title="${esc(title)}">${esc(t.letter)} <span style="font-size: 9px; opacity: 0.85;">${t.minPercent}%</span></button>`;
      }).join('');

      // Status text showing predicted grade as percentage
      let targetDesc = '';
      if (!activeTarget) {
        targetDesc = `<span class="target-desc-dim">No target available</span>`;
      } else if (activeTarget.guaranteed) {
        targetDesc = `<span class="target-desc-highlight" style="color: var(--text-main); font-weight: 700;">Grade ${activeTarget.minPercent}% (${esc(activeTarget.letter)}) guaranteed</span> (${targetAnalysis.earnedWeight}% earned &ge; ${activeTarget.minPercent}% cutoff)`;
      } else if (activeTarget.unattainable) {
        targetDesc = `<span class="target-desc-dim" style="color: var(--text-muted);">Grade ${activeTarget.minPercent}% (${esc(activeTarget.letter)}) unattainable (max possible is ${targetAnalysis.maxPossiblePercent}%)</span>`;
      } else {
        const reqDisplay = (activeTarget.letter === pc.targetLetter && pc.displayRange)
          ? pc.displayRange
          : `${activeTarget.requiredPercent}%`;
        targetDesc = `Predicted Grade: <strong class="target-highlight" style="color: var(--text-main); font-weight: 700;">${activeTarget.minPercent}% (${esc(activeTarget.letter)})</strong>. Need <strong class="target-highlight" style="color: var(--text-main); font-weight: 700;">${reqDisplay}</strong> on remaining ${targetAnalysis.remainingWeight}% weight.`;
      }

      // Visual Trajectory Bar
      let trajectoryBarHtml = '';
      if (activeTarget && !activeTarget.guaranteed && !activeTarget.unattainable) {
        const earnedW = Math.min(100, Math.max(0, targetAnalysis.earnedWeight));
        const neededW = Math.max(0, Math.min(100 - earnedW, activeTarget.minPercent - earnedW));
        trajectoryBarHtml = `
          <div class="trajectory-graph-wrap" style="margin-top: 5px; padding: 4px 6px; background: var(--surface-hover); border: 1px solid var(--surface-border);">
            <div class="trajectory-bar-track" style="position: relative; height: 5px; background: var(--surface-border); width: 100%; border-radius: 0;">
              <div class="trajectory-bar-earned" style="position: absolute; left: 0; top: 0; bottom: 0; width: ${earnedW}%; background: var(--primary);" title="Earned: ${earnedW}%"></div>
              ${neededW > 0 ? `<div class="trajectory-bar-needed" style="position: absolute; left: ${earnedW}%; top: 0; bottom: 0; width: ${neededW}%; background: var(--text-muted); opacity: 0.65;" title="Needed to reach ${activeTarget.minPercent}% cutoff"></div>` : ''}
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 9.5px; color: var(--text-muted); margin-top: 3px; font-weight: 500;">
              <span>Earned: <strong style="color: var(--text-main);">${earnedW}%</strong></span>
              <span>Cutoff: <strong style="color: var(--text-main);">${activeTarget.minPercent}% (${esc(activeTarget.letter)})</strong></span>
              <span>Max: <strong style="color: var(--text-main);">${targetAnalysis.maxPossiblePercent}%</strong></span>
            </div>
          </div>
        `;
      }

      // Upcoming Tasks list showing target scores as percentages
      const upcomingTasks = (activeTarget.upcomingTasks && activeTarget.upcomingTasks.length > 0)
        ? activeTarget.upcomingTasks
        : pc.upcomingTasks;

      let upcomingTasksHtml = '';
      if (upcomingTasks && upcomingTasks.length > 0) {
        const rows = upcomingTasks.map(u => {
          const scorePercent = u.displayRange || `${Math.round(u.targetScore / u.maxScore * 100)}%`;
          const scoreRaw = `${u.targetScore}/${u.maxScore}`;
          return `
            <div class="target-task-item" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; padding: 2px 0; border-top: 1px solid var(--surface-border);">
              <span class="target-task-name" style="display: flex; align-items: center; gap: 5px; min-width: 0; flex: 1;">
                <svg class="ui-icon" style="width: 12px; height: 12px; color: var(--text-muted); flex-shrink: 0;"><use href="#icon-pencil"></use></svg>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(u.title)}${u.weight ? ` <span style="color: var(--text-muted); font-size: 10px;">(${u.weight}%)</span>` : ''}</span>
              </span>
              <span class="target-task-score" style="font-weight: 700; color: var(--text-main); font-size: 11px; flex-shrink: 0;">Score ${scorePercent} <span style="font-size: 10px; font-weight: normal; color: var(--text-muted);">(${scoreRaw})</span></span>
            </div>
          `;
        }).join('');

        upcomingTasksHtml = `
          <div class="target-task-list" style="margin-top: 5px; display: flex; flex-direction: column;">
            ${rows}
          </div>
        `;
      } else if (targetAnalysis.remainingWeight > 0) {
        upcomingTasksHtml = `
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px; font-style: italic;">
            No upcoming dues announced yet. Scoring required on remaining ${targetAnalysis.remainingWeight}% assessment weight.
          </div>
        `;
      }

      return `
        <div class="target-course-card" data-course="${esc(pc.courseName)}" style="padding: 8px 10px; background: var(--surface); border: 1px solid var(--surface-border); margin-bottom: 6px;">
          <div class="target-course-header" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
              <span class="marks-dot" style="background:${esc(colorFor(pc.courseName))};"></span>
              <strong style="font-size: 12px; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(pc.courseName)}</strong>
              <span style="font-size: 10.5px; color: var(--text-muted); flex-shrink: 0;">${pc.creditHours} cr</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
              <span class="target-trend-pill" data-trend="${pc.trend.direction}" style="font-size: 10px; font-weight: 600; padding: 1px 6px; border: 1px solid var(--surface-border); background: var(--surface-hover); color: var(--text-muted);" title="Momentum based on recent marks">${esc(pc.trend.label)}</span>
              <span class="info-badge blue" style="font-size: 10.5px; font-weight: 700;">Predicted: ${activeTarget.minPercent}% (${esc(activeTarget.letter)})</span>
            </div>
          </div>
          ${trajectoryBarHtml}
          <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 4px; line-height: 1.35;">
            ${targetDesc}
          </div>
          ${upcomingTasksHtml}
          <div class="gpa-target-wrap" style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 6px; padding-top: 5px; border-top: 1px dashed var(--surface-border);">
            <span class="gpa-target-label" style="font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Predicted Goal:</span>
            <div class="gpa-target-chips" style="display: flex; gap: 3px;">
              ${pills}
            </div>
          </div>
        </div>
      `;
    }).join('');

    targetBreakdownCard = `
      <div class="marks-section-wrap" id="marks-card-target-breakdown" style="margin-top: 10px; margin-bottom: 8px;">
        <div class="marks-section-head" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; padding: 0 1px;">
          <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted);">Target Grade Breakdown</span>
          <span class="info-badge blue" style="font-size: 10px; font-weight: 700;">${trajectoryPlan.plannedGpa.toFixed(2)} Planned SGPA</span>
        </div>
        <div class="marks-targets-list" style="display: flex; flex-direction: column; gap: 4px;">
          ${targetCardsHtml}
        </div>
      </div>
    `;
  }

  const scale = describeGradeScale([...scaleInfo.scale]);
  const cutoffs = scaleInfo.fromSyllabus ? ' Instructors set the percentages, so check your syllabus and edit the scale in Settings if it differs.' : '';
  const gpaNoteHtml = `<div class="gpa-note">${esc(scaleInfo.name)} scale: ${esc(scale)}.${cutoffs} A course grade is your score on what is graded so far. Each letter is worth GPA points, and the GPA averages them by credit hours.</div>`;

  return `${gpaOverviewHtml}${currentGradesCard}${targetBreakdownCard}${gpaNoteHtml}`;
}

/** Renders a read-only view of a concluded archived semester. */
export function archivedSemesterHtml(
  semester: ArchivedSemester,
  scaleInfo: { name: string; scale: ReadonlyArray<GradeRow> } = { name: 'UOS', scale: UOS_GRADE_SCALE }
): string {
  const topPoints = Math.max(...scaleInfo.scale.map(g => g.points), 0) || 4;
  const termVal = semester.termGpa !== undefined ? semester.termGpa.toFixed(2) : '-';

  const head = `
    <div class="marks-gpa-overview" style="margin-bottom: 12px;">
      <div class="gpa-stat-box" style="padding: 10px 12px; background: var(--surface); border: 1px solid var(--surface-border);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
          <span class="gpa-caption" style="font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted);">${esc(semester.name)}</span>
          <span class="info-badge blue" style="font-size: 10px; font-weight: 700;">Archived Term</span>
        </div>
        <div style="display: flex; align-items: baseline; gap: 8px;">
          <span class="gpa-value" style="font-size: 26px; font-weight: 800; color: var(--text-main);">${termVal}</span>
          <span style="font-size: 11px; color: var(--text-muted);">Term GPA (${semester.gradedCredits} of ${semester.totalCredits} credits)</span>
        </div>
      </div>
    </div>
  `;

  const rows = (semester.courses || []).map(c => {
    const letter = c.grade || '-';
    const points = typeof c.points === 'number' ? `${c.points.toFixed(1)} of ${topPoints.toFixed(1)} GPA pts` : '';
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

  const currentGradesCard = `
    <div class="marks-section-wrap" style="margin-top: 10px; margin-bottom: 8px;">
      <div class="marks-section-head" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; padding: 0 1px;">
        <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted);">Archived Term Courses</span>
        <span style="font-size: 10.5px; color: var(--text-muted); font-variant-numeric: tabular-nums;">${semester.courses?.length || 0} Courses</span>
      </div>
      <div class="marks-courses-list" style="display: flex; flex-direction: column; gap: 4px;">
        ${rows || '<div class="marks-empty">No course records in this archived semester.</div>'}
      </div>
    </div>
  `;

  return head + currentGradesCard;
}
