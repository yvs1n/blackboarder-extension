import { describeGradeScale, GradeRow } from '../core/universities';
import { GpaSummary, UOS_GRADE_SCALE } from './gpa';
import { MarksSummary, CourseMarks, formatScore } from './marks';
import type { CumulativeGpaSummary, ArchivedSemester, DeadlineTask } from '../types';
import { calculateCourseTargetAnalysis, calculateTrajectoryTargetPlan, TrajectoryTargetPlan } from '../core/targetGpa';
import { esc } from './uiCommon';

/**
 * The Grades card: the projected GPA, then each course's grade so far with every mark under it.
 * Shared by the extension's and the phone's Courses tab (same classes in both stylesheets).
 */

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
  if (!course || !course.marks.length) {
    return '<div class="marks-empty" style="font-size: 11px; color: var(--text-muted); padding: 4px 0; font-style: italic;">No individual marks recorded in gradebook yet.</div>';
  }
  return course.marks.map(m => {
    if (m.isBonus) {
      const bonusScore = m.earned ?? m.score ?? m.weight ?? 0;
      return `<div class="marks-row marks-row-bonus" style="background: rgba(34, 197, 94, 0.05);"><span class="marks-title" style="display: inline-flex; align-items: center; gap: 5px;">★ ${esc(m.title)} <span class="settings-pill pill-green" style="font-size: 8.5px; padding: 1px 4px; text-transform: uppercase;">Bonus</span></span><span class="marks-weight" style="color: var(--success, #22c55e);">+${bonusScore}% extra credit</span><span class="marks-right"><span class="marks-score" style="color: var(--success, #22c55e); font-weight: 700;">+${bonusScore}</span><span class="marks-pct" style="color: var(--success, #22c55e);">pts</span></span></div>`;
    }
    const right = m.status === 'graded'
      ? `<span class="marks-score">${esc(formatScore(m.score, m.maxScore))}</span><span class="marks-pct">${m.percent}%</span>`
      : '<span class="marks-awaiting">Submitted</span>';
    const sub = m.weight
      ? `<span class="marks-weight">${m.earned !== undefined ? `${m.earned} of ${m.weight}% weight` : `worth ${m.weight}%`}</span>`
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
    targetCgpa?: number;
    targetGpaMode?: 'cgpa' | 'term';
    showGuide?: boolean;
    courseCodes?: Map<string, string>;
    openTargetBreakdown?: boolean;
    userCourses?: import('../types').UserCourseConfig[];
    courseCrns?: Map<string, string>;
  }
): string {
  if (!gpa.courses.length && !marks.courses.length) {
    return '<div class="marks-empty">No courses yet. Add them in the Courses tab or scan Blackboard.</div>';
  }
  const topPoints = Math.max(...scaleInfo.scale.map(g => g.points), 0) || 4;
  const marksByCourse = new Map(marks.courses.map(c => [c.courseName, c]));

  // Prior baseline calculation for scholarship & cumulative GPA planning
  const priorCredits = Math.max(0, (cumulative?.totalGradedCredits || 0) - (gpa.gradedCredits || 0));
  const priorWeighted = ((cumulative?.cgpa || 0) * (cumulative?.totalGradedCredits || 0));
  const activeWeighted = ((gpa.gpa || 0) * (gpa.gradedCredits || 0));
  const priorPoints = Math.max(0, priorWeighted - activeWeighted);
  const termCredits = gpa.totalCredits > 0 ? gpa.totalCredits : 15;
  const totalCredsAfterTerm = priorCredits + termCredits;

  // Active target mode: 'cgpa' (scholarship / cumulative target) vs 'term' (direct term SGPA target)
  const activeMode: 'cgpa' | 'term' = options?.targetGpaMode
    ? options.targetGpaMode
    : (typeof options?.targetCgpa === 'number' && options.targetCgpa > 0)
      ? 'cgpa'
      : (priorCredits > 0 && cumulative?.cgpa !== undefined)
        ? 'cgpa'
        : 'term';

  const defaultTargetTerm = gpa.gpa !== undefined
    ? Math.min(4.0, Math.round((Math.max(2.0, gpa.gpa) + 0.25) * 20) / 20)
    : 3.75;
  const targetTermVal = (typeof options?.targetTermGpa === 'number' && options.targetTermGpa > 0)
    ? options.targetTermGpa
    : defaultTargetTerm;

  const defaultTargetCgpa = cumulative?.cgpa !== undefined
    ? Math.min(4.0, Math.round((Math.max(2.5, cumulative.cgpa) + 0.10) * 20) / 20)
    : 3.60;
  const targetCgpaVal = (typeof options?.targetCgpa === 'number' && options.targetCgpa > 0)
    ? options.targetCgpa
    : defaultTargetCgpa;

  let effectiveTargetTermGpa = targetTermVal;
  let cgpaAttainable = true;
  let maxAchievableCgpa = topPoints;
  let requiredTermSgpaRaw = targetTermVal;

  if (activeMode === 'cgpa') {
    if (priorCredits > 0) {
      const neededTotalPoints = targetCgpaVal * totalCredsAfterTerm;
      const termPointsNeeded = neededTotalPoints - priorPoints;
      requiredTermSgpaRaw = Math.max(0, termPointsNeeded / termCredits);
      const maxPossibleTermPoints = topPoints * termCredits;
      maxAchievableCgpa = Math.round(((priorPoints + maxPossibleTermPoints) / totalCredsAfterTerm) * 100) / 100;
      cgpaAttainable = requiredTermSgpaRaw <= topPoints;
      effectiveTargetTermGpa = Math.min(topPoints, Math.max(1.0, Math.round(requiredTermSgpaRaw * 100) / 100));
    } else {
      effectiveTargetTermGpa = targetCgpaVal;
      requiredTermSgpaRaw = targetCgpaVal;
      cgpaAttainable = targetCgpaVal <= topPoints;
      maxAchievableCgpa = topPoints;
    }
  }

  // 1. Calculate Trajectory Plan
  let trajectoryPlan: TrajectoryTargetPlan | null = null;
  if (gpa.courses.length > 0) {
    trajectoryPlan = calculateTrajectoryTargetPlan(
      gpa,
      effectiveTargetTermGpa,
      options?.tasks || [],
      scaleInfo.scale
    );
  }

  // Calculate Projected Cumulative CGPA
  let projectedCgpaText = '';
  let projCgpaVal: number | null = null;
  if (trajectoryPlan) {
    const plannedTermGpa = trajectoryPlan.plannedGpa;
    if (priorCredits > 0) {
      const projTotalPts = priorPoints + (plannedTermGpa * termCredits);
      projCgpaVal = Math.round((projTotalPts / totalCredsAfterTerm) * 100) / 100;
      projectedCgpaText = `Projected CGPA: <strong class="marks-gpa-cgpa-val">${projCgpaVal.toFixed(2)}</strong> (${totalCredsAfterTerm} cr)`;
    } else {
      projCgpaVal = plannedTermGpa;
      projectedCgpaText = `Projected CGPA: <strong class="marks-gpa-cgpa-val">${plannedTermGpa.toFixed(2)}</strong> (${termCredits} cr)`;
    }
  }

  // Target explanation note (Scholarship & discrete grade rounding explanation)
  let targetExplanation = '';
  if (trajectoryPlan) {
    if (activeMode === 'cgpa') {
      if (!cgpaAttainable) {
        targetExplanation = `<div class="target-plan-unattainable" style="margin-top: 6px;">
          <span class="target-unattainable-title">Target ${targetCgpaVal.toFixed(2)} Cumulative CGPA is unattainable this semester</span>
          <span class="target-unattainable-sub">Requires a <strong>${requiredTermSgpaRaw.toFixed(2)} Term SGPA</strong> (exceeds ${topPoints.toFixed(1)} max scale). Highest achievable Cumulative CGPA after this semester is <strong>${maxAchievableCgpa.toFixed(2)}</strong> (achieved with a ${topPoints.toFixed(2)} SGPA).</span>
          <button type="button" class="btn-xs-manage-links btn-set-max-cgpa" data-max-cgpa="${maxAchievableCgpa.toFixed(2)}">Set to Max Achievable (${maxAchievableCgpa.toFixed(2)})</button>
        </div>`;
      } else {
        const diff = trajectoryPlan.plannedGpa - requiredTermSgpaRaw;
        const sign = diff >= 0 ? '+' : '';
        targetExplanation = `<div class="target-rounding-note" style="margin-top: 6px;">
          <span class="target-rounding-title">Scholarship Target: <strong>${targetCgpaVal.toFixed(2)} Cumulative CGPA</strong> &rarr; Requires <strong>${requiredTermSgpaRaw.toFixed(2)} Term SGPA</strong></span>
          <span class="target-rounding-sub">Nearest attainable combination: <strong>${trajectoryPlan.plannedGpa.toFixed(2)} Planned SGPA</strong> (${sign}${diff.toFixed(2)}) &bull; Projected CGPA: <strong>${projCgpaVal?.toFixed(2)}</strong>. University grades round to discrete scale points (A = 4.0, B+ = 3.5) weighted by credit hours.</span>
        </div>`;
      }
    } else {
      if (!trajectoryPlan.possible) {
        targetExplanation = `<div class="target-plan-unattainable" style="margin-top: 6px;">
          <span class="target-unattainable-title">Target ${targetTermVal.toFixed(2)} is mathematically unattainable</span>
          <span class="target-unattainable-sub">Highest achievable Term SGPA is <strong>${trajectoryPlan.maxPossibleGpa.toFixed(2)}</strong>.</span>
          <button type="button" class="btn-xs-manage-links btn-set-max-gpa" data-max-gpa="${trajectoryPlan.maxPossibleGpa.toFixed(2)}">Set to Max (${trajectoryPlan.maxPossibleGpa.toFixed(2)})</button>
        </div>`;
      } else if (Math.abs(trajectoryPlan.plannedGpa - targetTermVal) >= 0.005) {
        const diff = trajectoryPlan.plannedGpa - targetTermVal;
        const sign = diff >= 0 ? '+' : '';
        targetExplanation = `<div class="target-rounding-note" style="margin-top: 6px;">
          <span class="target-rounding-title">Nearest attainable combination: <strong>${trajectoryPlan.plannedGpa.toFixed(2)} SGPA</strong> (${sign}${diff.toFixed(2)})</span>
          <span class="target-rounding-sub">University grades round to discrete scale points (A = 4.0, B+ = 3.5) weighted by credit hours.</span>
        </div>`;
      }
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
          <div class="marks-gpa-stat-row" style="display: flex; align-items: baseline; gap: 6px; flex-wrap: nowrap; white-space: nowrap;">
            <span class="marks-gpa-big" style="font-size: 24px; font-weight: 800; color: var(--text-main); line-height: 1;">${termVal}</span>
            <span class="marks-gpa-stat-label" style="font-size: 10.5px; color: var(--text-muted); line-height: 1.25; white-space: nowrap;">Term SGPA (${gpa.gradedCredits} of ${gpa.totalCredits} cr)</span>
          </div>
          ${hasDiffCgpa ? `<div class="marks-gpa-cgpa-row" style="font-size: 10.5px; color: var(--text-muted); margin-top: 2px;">Cumulative CGPA: <strong class="marks-gpa-cgpa-val">${cgpaVal}</strong> (${totalGradedCreds} cr)</div>` : ''}
        </div>

        ${trajectoryPlan ? `
        <div class="marks-gpa-col gpa-stat-target" style="padding: 8px 10px; background: var(--surface); border: 1px solid var(--surface-border); display: flex; flex-direction: column; justify-content: center;">
          <span class="marks-gpa-col-title" style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); display: block; margin-bottom: 4px;">Academic Goal</span>
          <div class="marks-gpa-stat-row" style="display: flex; align-items: baseline; gap: 6px; flex-wrap: nowrap; white-space: nowrap;">
            <span class="marks-gpa-big is-target" style="font-size: 24px; font-weight: 800; color: var(--primary); line-height: 1;">${trajectoryPlan.plannedGpa.toFixed(2)}</span>
            <span class="marks-gpa-stat-label" style="font-size: 10.5px; color: var(--text-muted); line-height: 1.25; white-space: nowrap;">Planned SGPA</span>
          </div>
          ${hasDiffCgpa ? `<div class="marks-gpa-cgpa-row" style="font-size: 10.5px; color: var(--text-muted); margin-top: 2px;">${projectedCgpaText}</div>` : ''}
        </div>
        ` : ''}
      </div>

      ${trajectoryPlan ? `
      <div class="marks-gpa-goal-bar" style="margin-top: 6px; padding: 6px 10px; background: var(--surface); border: 1px solid var(--surface-border);">
        <div class="marks-goal-mode-bar" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; padding-bottom: 5px; border-bottom: 1px solid var(--surface-border); flex-wrap: wrap;">
          <div class="marks-mode-toggle" style="display: inline-flex; border: 1px solid var(--surface-border); background: var(--surface-hover);">
            <button type="button" class="btn-goal-mode ${activeMode === 'cgpa' ? 'is-active' : ''}" data-mode="cgpa" title="Target your cumulative GPA (ideal for scholarship retention and honors)" style="background: ${activeMode === 'cgpa' ? 'var(--text-main)' : 'transparent'}; color: ${activeMode === 'cgpa' ? 'var(--bg)' : 'var(--text-muted)'}; border: none; padding: 2px 7px; font-size: 10px; font-weight: ${activeMode === 'cgpa' ? '700' : '600'}; cursor: pointer;">Cumulative CGPA (Scholarship)</button>
            <button type="button" class="btn-goal-mode ${activeMode === 'term' ? 'is-active' : ''}" data-mode="term" title="Directly target your current semester GPA" style="background: ${activeMode === 'term' ? 'var(--text-main)' : 'transparent'}; color: ${activeMode === 'term' ? 'var(--bg)' : 'var(--text-muted)'}; border: none; padding: 2px 7px; font-size: 10px; font-weight: ${activeMode === 'term' ? '700' : '600'}; cursor: pointer;">Term SGPA</button>
          </div>
          <button type="button" class="btn-xs-manage-links" id="btn-toggle-gpa-guide" aria-expanded="${options?.showGuide ? 'true' : 'false'}" style="font-size: 10px; padding: 2px 7px; min-height: 24px; display: inline-flex; align-items: center; gap: 4px;" title="Learn how the predictor calculates required grades">
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-help-circle"></use></svg>
            <span>How It Works</span>
          </button>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
          <span style="font-size: 11px; font-weight: 700; color: var(--text-main);">${activeMode === 'cgpa' ? 'Target Cumulative CGPA (Scholarship):' : 'Target Term SGPA:'}</span>
          <div style="display: flex; align-items: center; gap: 4px;">
            ${activeMode === 'cgpa' ? `
              <button type="button" class="btn-xs-manage-links btn-target-chip-val ${Math.abs(targetCgpaVal - 3.50) < 0.005 ? 'is-active' : ''}" data-target="3.50" data-mode="cgpa" style="padding: 1px 6px; font-size: 10px; height: 22px; min-height: 22px;">3.50</button>
              <button type="button" class="btn-xs-manage-links btn-target-chip-val ${Math.abs(targetCgpaVal - 3.60) < 0.005 ? 'is-active' : ''}" data-target="3.60" data-mode="cgpa" style="padding: 1px 6px; font-size: 10px; height: 22px; min-height: 22px;" title="Standard Scholarship Minimum">3.60</button>
              <button type="button" class="btn-xs-manage-links btn-target-chip-val ${Math.abs(targetCgpaVal - 3.80) < 0.005 ? 'is-active' : ''}" data-target="3.80" data-mode="cgpa" style="padding: 1px 6px; font-size: 10px; height: 22px; min-height: 22px;" title="Excellence / Dean's List">3.80</button>
              <button type="button" class="btn-xs-manage-links btn-target-chip-val ${Math.abs(targetCgpaVal - 4.00) < 0.005 ? 'is-active' : ''}" data-target="4.00" data-mode="cgpa" style="padding: 1px 6px; font-size: 10px; height: 22px; min-height: 22px;">4.00</button>
              <input type="number" id="input-target-gpa-val" data-mode="cgpa" class="form-input" min="1.0" max="4.0" step="0.05" value="${targetCgpaVal.toFixed(2)}" style="width: 52px; font-size: 11px; padding: 1px 3px; text-align: center; font-weight: 700; height: 22px; min-height: 22px; box-sizing: border-box;" title="Enter custom Target Cumulative CGPA" />
            ` : `
              <button type="button" class="btn-xs-manage-links btn-target-chip-val ${Math.abs(targetTermVal - 3.50) < 0.005 ? 'is-active' : ''}" data-target="3.50" data-mode="term" style="padding: 1px 6px; font-size: 10px; height: 22px; min-height: 22px;">3.50</button>
              <button type="button" class="btn-xs-manage-links btn-target-chip-val ${Math.abs(targetTermVal - 3.75) < 0.005 ? 'is-active' : ''}" data-target="3.75" data-mode="term" style="padding: 1px 6px; font-size: 10px; height: 22px; min-height: 22px;">3.75</button>
              <button type="button" class="btn-xs-manage-links btn-target-chip-val ${Math.abs(targetTermVal - 4.00) < 0.005 ? 'is-active' : ''}" data-target="4.00" data-mode="term" style="padding: 1px 6px; font-size: 10px; height: 22px; min-height: 22px;">4.00</button>
              <input type="number" id="input-target-term-gpa" data-mode="term" class="form-input" min="1.0" max="4.0" step="0.05" value="${targetTermVal.toFixed(2)}" style="width: 52px; font-size: 11px; padding: 1px 3px; text-align: center; font-weight: 700; height: 22px; min-height: 22px; box-sizing: border-box;" title="Enter custom Target Term GPA" />
            `}
          </div>
        </div>
        ${targetExplanation}

        <!-- Expandable Predictor & Scholarship Guide Panel -->
        <div id="gpa-predictor-guide" class="gpa-guide-panel" style="display: ${options?.showGuide ? 'block' : 'none'}; margin-top: 8px; padding: 10px 12px; background: var(--surface-hover); border: 1px solid var(--surface-border);">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <h4 style="margin: 0; font-size: 11.5px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 5px;">
              <svg class="ui-icon" style="width: 12px; height: 12px; color: var(--primary);"><use href="#icon-award"></use></svg>
              <span>How the GPA &amp; Scholarship Predictor Works</span>
            </h4>
            <span style="font-size: 9.5px; color: var(--text-muted); text-transform: uppercase;">Guide</span>
          </div>

          <div class="gpa-guide-step" style="margin-bottom: 7px;">
            <div class="gpa-guide-step-title" style="font-weight: 700; color: var(--text-main); font-size: 10.5px; margin-bottom: 2px;">1. Cumulative CGPA vs. Term SGPA (Scholarships)</div>
            <div class="gpa-guide-step-body" style="font-size: 10px; color: var(--text-muted); line-height: 1.4;">
              University scholarships, tuition discounts, and honors evaluate your overall <strong>Cumulative CGPA</strong> across all completed terms. Prior credit hours dilute how much a single semester can move your overall standing.
            </div>
          </div>

          <div class="gpa-guide-step" style="margin-bottom: 7px;">
            <div class="gpa-guide-step-title" style="font-weight: 700; color: var(--text-main); font-size: 10.5px; margin-bottom: 2px;">2. Academic Baseline Formula</div>
            <div class="gpa-guide-step-body" style="font-size: 10px; color: var(--text-muted); line-height: 1.4;">
              Formula: <code>New CGPA = ((Prior CGPA &times; Prior Credits) + (Term SGPA &times; Term Credits)) &divide; Total Credits</code>. Configure prior credits and starting GPA in <strong>Settings &gt; General &gt; Academic Baseline</strong> or archive past terms in this tab.
            </div>
          </div>

          <div class="gpa-guide-step" style="margin-bottom: 7px;">
            <div class="gpa-guide-step-title" style="font-weight: 700; color: var(--text-main); font-size: 10.5px; margin-bottom: 2px;">3. Reverse-Engineering Required Grades</div>
            <div class="gpa-guide-step-body" style="font-size: 10px; color: var(--text-muted); line-height: 1.4;">
              When in <strong>Cumulative CGPA</strong> mode (e.g. 3.60 for your scholarship), Blackboarder calculates the exact semester <strong>Term SGPA</strong> needed, then solves for the required marks on all upcoming assessments.
            </div>
          </div>

          <div class="gpa-guide-step" style="margin-bottom: 7px;">
            <div class="gpa-guide-step-title" style="font-weight: 700; color: var(--text-main); font-size: 10.5px; margin-bottom: 2px;">4. Discrete Scale Points &amp; Rounding</div>
            <div class="gpa-guide-step-body" style="font-size: 10px; color: var(--text-muted); line-height: 1.4;">
              Universities award discrete grade points (A = 4.0, B+ = 3.5, B = 3.0). Unattainable numbers like 3.91 round to the nearest achievable combination (e.g. 3.97) weighted by course credit hours.
            </div>
          </div>

          <div class="gpa-guide-step">
            <div class="gpa-guide-step-title" style="font-weight: 700; color: var(--text-main); font-size: 10.5px; margin-bottom: 2px;">5. Trajectory-Weighted Scores</div>
            <div class="gpa-guide-step-body" style="font-size: 10px; color: var(--text-muted); line-height: 1.4;">
              Instead of demanding uniform scores everywhere, the engine analyzes your recent marks in each course. Strong courses absorb higher targets (A / A-), leaving realistic requirements (B / B+) for harder courses.
            </div>
          </div>
        </div>
      </div>
      ` : ''}
      ${progressRow}
    </div>
  `;

  // SECTION 2: Current Term Course Grades (Structured with left accent borders and metadata, matching Course Cards)
  const courseRows = gpa.courses.map(c => {
    const courseMarks = marksByCourse.get(c.courseName);
    marksByCourse.delete(c.courseName);
    const markCount = courseMarks ? courseMarks.marks.length : 0;
    const courseColor = colorFor(c.courseName);

    const right = c.percent === undefined
      ? `<span class="settings-pill pill-gray" style="font-size: 10px;">${courseMarks ? 'Not graded yet' : 'No marks yet'}</span>`
      : `<div class="marks-grade-badge-wrap" style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
           <span class="marks-course-pct" style="font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-main); background: var(--surface-hover); border: 1px solid var(--surface-border); padding: 2px 6px;">${c.percent}%</span>
           <span class="marks-course-letter" style="font-size: 11px; font-weight: 800; color: var(--bg); background: var(--text-main); padding: 2px 7px; min-width: 18px; text-align: center;">${esc(c.letter)}</span>
         </div>`;

    const detail = c.percent === undefined ? '' : `${c.earnedWeight} of ${c.gradedWeight} marks so far · ${esc(c.letter)} = ${c.points!.toFixed(1)} of ${topPoints.toFixed(1)} GPA points`;

    const drops = c.components.filter(k => k.dropped.length).map(k =>
      `<div class="marks-drop-notice" style="font-size: 10px; color: var(--warning, #e6a23c); background: var(--surface-hover); padding: 3px 6px; border-left: 2px solid var(--warning, #e6a23c); margin-top: 4px;">${esc(k.name)}${k.rule ? ` (${esc(k.rule)})` : ''}: not counted ${k.dropped.map(d => `${esc(d.title)} ${d.percent}%`).join(', ')}</div>`
    ).join('');

    const statusBadge = c.gradedWeight >= 100
      ? `<span class="settings-pill pill-green" style="font-size: 10px;">100% Graded</span>`
      : `<span class="settings-pill pill-blue" style="font-size: 10px;">${c.gradedWeight}% Graded (${100 - c.gradedWeight}% Remaining)</span>`;

    const userCourse = (options?.userCourses || []).find(uc => uc.courseName.toLowerCase() === c.courseName.toLowerCase());
    const code = userCourse?.courseCode || options?.courseCodes?.get(c.courseName.toLowerCase()) || '';
    const crn = userCourse?.crn || options?.courseCrns?.get(c.courseName.toLowerCase()) || '';

    const metaParts = [
      code ? `<span class="ucc-code" style="font-weight: 700; color: var(--text-main);">${esc(code)}</span>` : '',
      crn ? `<span title="CRN">CRN ${esc(crn)}</span>` : '',
      `<span>${c.creditHours} credit hour${c.creditHours === 1 ? '' : 's'}</span>`,
      c.bonusWeight ? `<span class="settings-pill pill-green" style="font-size: 9px; padding: 1px 4px;">+${c.bonusWeight}% Bonus</span>` : '',
      detail ? `<span>${detail}</span>` : ''
    ].filter(Boolean).join('<span aria-hidden="true"> · </span>');

    return `
      <div class="marks-course" style="border: 1px solid var(--surface-border); border-left: 3px solid ${esc(courseColor)}; background: var(--surface); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px;">
        <div class="marks-course-head" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
          <div class="marks-course-title-group" style="display: flex; align-items: flex-start; gap: 7px; min-width: 0; flex: 1;">
            <span class="marks-dot" style="width: 10px; height: 10px; flex-shrink: 0; background:${esc(courseColor)}; margin-top: 3px;"></span>
            <div class="marks-course-title-text" style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
              <span class="marks-course-name" style="font-size: 12.5px; font-weight: 700; color: var(--text-main); line-height: 1.3; overflow-wrap: anywhere;">${esc(c.courseName)}</span>
              <div class="marks-course-meta" style="font-size: 10px; color: var(--text-muted); display: flex; flex-wrap: wrap; align-items: center; gap: 4px; line-height: 1.3;">
                ${metaParts}
              </div>
            </div>
          </div>
          <div class="marks-course-grade-badge">
            ${right}
          </div>
        </div>
        ${drops}
        <div class="marks-course-items-list" style="display: flex; flex-direction: column;">
          ${markRowsHtml(courseMarks)}
        </div>
        <div class="marks-course-footer" style="display: flex; align-items: center; justify-content: space-between; padding-top: 5px; border-top: 1px dashed var(--surface-border); font-size: 10px; color: var(--text-muted); margin-top: 2px;">
          <span>${markCount} mark${markCount === 1 ? '' : 's'} recorded</span>
          <div style="display: flex; align-items: center; gap: 6px;">
            <button type="button" class="btn-outline-action btn-add-course-bonus" data-course="${esc(c.courseName)}" style="font-size: 10px; padding: 1px 7px; height: 20px; min-height: 20px; width: auto; line-height: 18px;" title="Add a bonus mark to ${esc(c.courseName)}">+ Bonus</button>
            ${statusBadge}
          </div>
        </div>
      </div>
    `;
  });

  // Marks for courses that are not set up (no grade, but the marks still show)
  for (const c of marksByCourse.values()) {
    if (/orientation|توجيه|تهيئة/i.test(c.courseName)) continue;
    const total = c.averagePercent !== undefined ? `<span class="marks-course-total">Avg ${c.averagePercent}%</span>` : '';
    const courseColor = colorFor(c.courseName);
    courseRows.push(`
      <div class="marks-course" style="border: 1px solid var(--surface-border); border-left: 3px solid ${esc(courseColor)}; background: var(--surface); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px;">
        <div class="marks-course-head" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
          <div class="marks-course-title-group" style="display: flex; align-items: flex-start; gap: 7px; min-width: 0; flex: 1;">
            <span class="marks-dot" style="width: 10px; height: 10px; flex-shrink: 0; background:${esc(courseColor)}; margin-top: 3px;"></span>
            <div class="marks-course-title-text" style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
              <span class="marks-course-name" style="font-size: 12.5px; font-weight: 700; color: var(--text-main); line-height: 1.3; overflow-wrap: anywhere;">${esc(c.courseName)}</span>
              <div class="marks-course-meta" style="font-size: 10px; color: var(--text-muted); display: flex; flex-wrap: wrap; align-items: center; gap: 4px; line-height: 1.3;">
                <span>Unconfigured Course</span>
                <span>·</span>
                <span>${c.marks.length} mark${c.marks.length === 1 ? '' : 's'} recorded</span>
              </div>
            </div>
          </div>
          ${total}
        </div>
        <div class="marks-course-items-list" style="display: flex; flex-direction: column;">
          ${markRowsHtml(c)}
        </div>
        <div class="marks-course-footer" style="display: flex; align-items: center; justify-content: space-between; padding-top: 5px; border-top: 1px dashed var(--surface-border); font-size: 10px; color: var(--text-muted); margin-top: 2px;">
          <span>${c.marks.length} mark${c.marks.length === 1 ? '' : 's'} recorded</span>
          <span class="settings-pill pill-gray" style="font-size: 10px;">No syllabus configured</span>
        </div>
      </div>
    `);
  }

  const currentGradesCard = `
    <div class="marks-section-wrap" id="marks-card-current-grades" style="margin-top: 10px; margin-bottom: 8px;">
      <div class="marks-section-head" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; padding: 0 1px;">
        <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted);">Current Term Grades</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 10.5px; color: var(--text-muted); font-variant-numeric: tabular-nums;">${marks.gradedCount} Graded · ${gpa.courses.length} Courses</span>
          <button type="button" class="btn-outline-action btn-add-bonus-trigger" style="font-size: 10px; padding: 1px 7px; height: 20px; min-height: 20px; width: auto; line-height: 18px;" title="Add a bonus mark or extra credit">+ Bonus Mark</button>
        </div>
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
        <div class="target-course-card" data-course="${esc(pc.courseName)}" style="padding: 8px 10px; background: var(--surface); border: 1px solid var(--surface-border); border-left: 3px solid ${esc(colorFor(pc.courseName))}; margin-bottom: 6px;">
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

    let isOpen = false;
    if (typeof options?.openTargetBreakdown === 'boolean') {
      isOpen = options.openTargetBreakdown;
    } else if (typeof localStorage !== 'undefined') {
      try { isOpen = localStorage.getItem('bbs_open_target_breakdown') === '1'; } catch {}
    }

    targetBreakdownCard = `
      <div class="grade-tracker-widget course-summary-card target-breakdown-card" id="marks-card-target-breakdown" style="margin-top: 10px; margin-bottom: 8px; background: var(--surface); border: 1px solid var(--surface-border); border-radius: 0;">
        <button type="button" class="grade-tracker-header target-breakdown-header" id="target-breakdown-toggle-btn" aria-expanded="${isOpen ? 'true' : 'false'}" style="width: 100%; min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; background: transparent; border: 0; color: var(--text-main); font: inherit; text-align: left; cursor: pointer;">
          <span class="course-summary-title" style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700;">
            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 15px; height: 15px; color: var(--primary);"><line x1="10" y1="6" x2="21" y2="6"></line><line x1="10" y1="12" x2="21" y2="12"></line><line x1="10" y1="18" x2="21" y2="18"></line><polyline points="3 6 4 7 6 5"></polyline><polyline points="3 12 4 13 6 11"></polyline><polyline points="3 18 4 19 6 17"></polyline></svg>
            <span>Target Grade Breakdown</span>
          </span>
          <span class="course-summary-right" style="display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;">
            <span class="info-badge blue" style="font-size: 11px;">${trajectoryPlan.plannedGpa.toFixed(2)} Planned SGPA</span>
            <svg class="course-summary-arrow ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; transition: transform 0.2s;"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </span>
        </button>
        <div class="grade-tracker-breakdown target-breakdown-content" id="target-breakdown-content"${isOpen ? '' : ' hidden'} style="display: ${isOpen ? 'flex' : 'none'}; flex-direction: column; gap: 6px; margin: 0; padding: 0 10px 10px;">
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
    return `<div class="marks-course" style="border: 1px solid var(--surface-border); border-left: 3px solid ${esc(color)}; background: var(--surface); padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px;">
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
