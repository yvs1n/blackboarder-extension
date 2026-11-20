import type { DeadlineTask, UserCourseConfig, StudentProfile, ArchivedSemester } from '../types';
import { type CourseSyllabus } from '../core/syllabusWeights';
import { escapeHtml } from '../utils/uiCommon';
import {
  partitionCoursesBySemester,
  calculateCgpa,
  autoPartitionPastSemesters
} from '../core/semesters';
import { calculateTrajectoryTargetPlan } from '../core/targetGpa';
import { profileGradeScale, profileUniversity } from '../core/studentProfile';
import { buildGpaSummary } from '../utils/gpa';
import { buildMarksSummary, deleteMarkFromTasks, toggleMarkIgnoredInTasks } from '../utils/marks';
import { recordLocalTombstone, removeLocalTombstone } from '../utils/tombstones';
import { gradesBadgeText, gradesHtml, archivedSemesterHtml } from '../utils/grades';
import { buildSyllabusProgress, syllabusProgressHtml } from '../utils/syllabusProgress';
import { compareTasksByTime } from '../utils/calendar';
import { deduplicateTaskList } from '../utils/taskMerge';
import { initMarksModals, openCompleteScoreModal } from './modules/marksModals';

export { openCompleteScoreModal };

export interface MarksControllerHooks {
  getTasks: () => DeadlineTask[];
  saveTasks: (tasks: DeadlineTask[]) => Promise<DeadlineTask[]>;
  getUserCourses: () => UserCourseConfig[];
  saveUserCourses: (courses: UserCourseConfig[], updatedAt: string) => Promise<void>;
  getSemesters: () => ArchivedSemester[];
  saveSemesters: (semesters: ArchivedSemester[]) => Promise<void>;
  getProfile: () => StudentProfile | null;
  saveProfile: (p: StudentProfile) => Promise<void>;
  getAllSyllabi: () => CourseSyllabus[];
  getCourseHex: (courseName: string) => string;
  renderStudentIdentity: (p: StudentProfile | null) => void;
  renderTasks: () => void;
  refreshAllViews: () => void;
  syncCloud: (tasks: DeadlineTask[], reason: string) => void;
  showToast: (msg: string, actionLabel?: string, onAction?: () => void | Promise<void>) => void;
  getSelectedSemesterId: () => string;
  setSelectedSemesterId: (id: string) => void;
}

/**
 * Calculates the nearest attainable GPA combination for the active semester
 * based on discrete scale points and course credit hours.
 */
export function snapTargetGpa(
  val: number,
  mode: 'term' | 'cgpa',
  hooks: MarksControllerHooks
): { snappedVal: number; adjusted: boolean; reason: string; plannedTermGpa?: number; projCgpaVal?: number } {
  const profile = hooks.getProfile();
  const scale = profileGradeScale(profile);
  const syllabi = hooks.getAllSyllabi();
  const tasks = hooks.getTasks();
  const gpa = buildGpaSummary(tasks, syllabi, scale);
  const semesters = hooks.getSemesters();
  const cumulative = calculateCgpa(gpa, semesters, profile);

  const topPoints = scale.length > 0 ? Math.max(...scale.map(s => s.points)) : 4.0;
  const termCredits = gpa.totalCredits || (gpa.courses.length * 3) || 3;
  const priorCredits = Math.max(0, (cumulative?.totalGradedCredits || 0) - (gpa.gradedCredits || 0));
  const priorWeighted = ((cumulative?.cgpa || 0) * (cumulative?.totalGradedCredits || 0));
  const activeWeighted = (gpa.gpa || 0) * (gpa.gradedCredits || 0);
  const priorPoints = Math.max(0, priorWeighted - activeWeighted);
  const totalCredsAfterTerm = priorCredits + termCredits;

  if (mode === 'term') {
    const plan = calculateTrajectoryTargetPlan(gpa, val, tasks, scale);
    if (!plan.possible || val > plan.maxPossibleGpa) {
      const snappedVal = Math.round(plan.maxPossibleGpa * 100) / 100;
      const projCgpaVal = Math.round(((priorPoints + (snappedVal * termCredits)) / totalCredsAfterTerm) * 100) / 100;
      return {
        snappedVal,
        adjusted: Math.abs(snappedVal - val) >= 0.005,
        reason: `Target ${val.toFixed(2)} exceeds highest achievable SGPA (${snappedVal.toFixed(2)}). Adjusted to maximum achievable.`,
        plannedTermGpa: snappedVal,
        projCgpaVal
      };
    }
    const snappedVal = Math.round(plan.plannedGpa * 100) / 100;
    const adjusted = Math.abs(snappedVal - val) >= 0.005;
    const projCgpaVal = Math.round(((priorPoints + (snappedVal * termCredits)) / totalCredsAfterTerm) * 100) / 100;
    return {
      snappedVal,
      adjusted,
      reason: `Nearest attainable GPA to your target (${val.toFixed(2)}) is ${snappedVal.toFixed(2)}, so we adjusted it for you.`,
      plannedTermGpa: snappedVal,
      projCgpaVal
    };
  } else {
    // Cumulative CGPA mode
    const requiredTermSgpaRaw = priorCredits > 0
      ? ((val * totalCredsAfterTerm) - priorPoints) / termCredits
      : val;

    if (requiredTermSgpaRaw > topPoints) {
      const maxAchievableCgpa = Math.round(((priorPoints + (topPoints * termCredits)) / totalCredsAfterTerm) * 100) / 100;
      return {
        snappedVal: maxAchievableCgpa,
        adjusted: Math.abs(maxAchievableCgpa - val) >= 0.005,
        reason: `Target ${val.toFixed(2)} CGPA is unattainable this semester. Highest achievable Cumulative CGPA is ${maxAchievableCgpa.toFixed(2)}, so we adjusted it for you.`,
        plannedTermGpa: topPoints,
        projCgpaVal: maxAchievableCgpa
      };
    }

    if (requiredTermSgpaRaw <= 0) {
      const minCgpa = Math.round((priorPoints / totalCredsAfterTerm) * 100) / 100;
      return {
        snappedVal: minCgpa,
        adjusted: Math.abs(minCgpa - val) >= 0.005,
        reason: `Adjusted to nearest attainable Cumulative CGPA (${minCgpa.toFixed(2)}).`,
        plannedTermGpa: 0,
        projCgpaVal: minCgpa
      };
    }

    const clampedTargetSgpa = Math.min(topPoints, Math.max(0, requiredTermSgpaRaw));
    const plan = calculateTrajectoryTargetPlan(gpa, clampedTargetSgpa, tasks, scale);
    const plannedTermGpa = plan.plannedGpa;
    const projCgpaVal = Math.round(((priorPoints + (plannedTermGpa * termCredits)) / totalCredsAfterTerm) * 100) / 100;

    const adjusted = Math.abs(projCgpaVal - val) >= 0.005;
    return {
      snappedVal: projCgpaVal,
      adjusted,
      reason: `Nearest attainable Cumulative CGPA to your target (${val.toFixed(2)}) is ${projCgpaVal.toFixed(2)}, so we adjusted it for you.`,
      plannedTermGpa,
      projCgpaVal
    };
  }
}

export const selectedTargetGrades = new Map<string, string>();
let guideOpenState = false;
let lastAdjustedTarget: { requested: number; snapped: number; mode: 'cgpa' | 'term' } | null = null;

/**
 * Updates the semester dropdown in the Marks tab with active and archived terms.
 */
export async function updateSemesterSelector(hooks: MarksControllerHooks): Promise<void> {
  const select = document.getElementById('select-semester-view') as HTMLSelectElement | null;
  if (!select) return;

  const semesters = hooks.getSemesters();
  const userCourses = hooks.getUserCourses();
  const tasks = hooks.getTasks();

  const autoPartitionBtn = document.getElementById('btn-auto-partition-semesters') as HTMLButtonElement | null;
  if (autoPartitionBtn) {
    const partitions = partitionCoursesBySemester(userCourses, tasks);
    if (partitions.length > 1) {
      autoPartitionBtn.style.display = 'inline-flex';
      autoPartitionBtn.textContent = `Organize Terms (${partitions.length})`;
    } else {
      autoPartitionBtn.style.display = 'none';
    }
  }

  const currentVal = select.value || hooks.getSelectedSemesterId() || 'active';
  let html = `<option value="active">Active Semester</option>`;
  if (semesters.length > 0) {
    html += `<optgroup label="Archived Terms">`;
    for (const sem of semesters) {
      const gpaStr = typeof sem.termGpa === 'number' ? ` (${sem.termGpa.toFixed(2)})` : '';
      html += `<option value="${escapeHtml(sem.id)}">${escapeHtml(sem.name)}${gpaStr}</option>`;
    }
    html += `</optgroup>`;
  }
  select.innerHTML = html;
  if (semesters.some(s => s.id === currentVal) || currentVal === 'active') {
    select.value = currentVal;
    hooks.setSelectedSemesterId(currentVal);
  } else {
    select.value = 'active';
    hooks.setSelectedSemesterId('active');
  }
}

/**
 * Renders the Grades overview card and the Syllabus Progress card.
 */
export function renderGradeTracker(tasks: DeadlineTask[], hooks: MarksControllerHooks): void {
  const userCourses = hooks.getUserCourses();
  const semesters = hooks.getSemesters();
  const gradesCard = document.getElementById('grades-tracker');
  const syllabusCard = document.getElementById('syllabus-tracker');
  const hasCoursesOrTasks = userCourses.length > 0 || tasks.length > 0 || semesters.length > 0;
  if (gradesCard) gradesCard.style.display = hasCoursesOrTasks ? '' : 'none';
  if (syllabusCard) syllabusCard.style.display = (userCourses.length > 0 || tasks.length > 0) ? '' : 'none';
  if (!hasCoursesOrTasks) return;

  const gradesBadge = document.getElementById('grades-tracker-badge');
  const gradesBody = document.getElementById('grades-tracker-breakdown');
  const profile = hooks.getProfile();
  hooks.renderStudentIdentity(profile);

  const selectedSemesterViewId = hooks.getSelectedSemesterId();

  // If a past archived semester is selected in the dropdown:
  if (selectedSemesterViewId !== 'active') {
    const sem = semesters.find(s => s.id === selectedSemesterViewId);
    if (sem && gradesBadge && gradesBody) {
      gradesBody.hidden = false;
      const scale = profileGradeScale(profile);
      const uni = profileUniversity(profile);
      gradesBadge.textContent = typeof sem.termGpa === 'number' ? `Term ${sem.termGpa.toFixed(2)}` : 'Archived';
      gradesBody.innerHTML = archivedSemesterHtml(sem, {
        name: profile?.gradeScale ? 'Your' : uni.shortName === 'Other' ? 'Standard' : uni.shortName,
        scale
      });
      if (syllabusCard) syllabusCard.style.display = 'none';
      return;
    }
  }

  if (gradesBadge && gradesBody) {
    gradesBody.hidden = false;
    const scale = profileGradeScale(profile);
    const uni = profileUniversity(profile);
    const syllabi = hooks.getAllSyllabi();
    const gpa = buildGpaSummary(tasks, syllabi, scale);
    const marks = buildMarksSummary(tasks, syllabi);
    const cumulative = calculateCgpa(gpa, semesters, profile);
    gradesBadge.textContent = gradesBadgeText(gpa, marks, cumulative);
    let isBreakdownOpen = false;
    try { isBreakdownOpen = localStorage.getItem('bbs_open_target_breakdown') === '1'; } catch {}

    gradesBody.innerHTML = gradesHtml(gpa, marks, name => hooks.getCourseHex(name), {
      name: profile?.gradeScale ? 'Your' : uni.shortName === 'Other' ? 'Standard' : uni.shortName,
      scale,
      fromSyllabus: !profile?.gradeScale && uni.cutoffsFromSyllabus
    }, cumulative, {
      tasks,
      selectedTargets: Object.fromEntries(selectedTargetGrades),
      targetTermGpa: profile?.targetTermGpa,
      targetCgpa: profile?.targetCgpa,
      targetGpaMode: profile?.targetGpaMode,
      showGuide: guideOpenState,
      openTargetBreakdown: isBreakdownOpen,
      userCourses,
      adjustedFrom: lastAdjustedTarget
    });
  }

  // Syllabus Progress card
  const sylBadge = document.getElementById('syllabus-tracker-badge');
  const sylBody = document.getElementById('syllabus-tracker-breakdown');
  if (sylBadge && sylBody) {
    const progress = buildSyllabusProgress(tasks, hooks.getAllSyllabi());
    sylBadge.textContent = `${progress.overallPercent}% done`;
    sylBody.innerHTML = syllabusProgressHtml(progress, name => hooks.getCourseHex(name));
  }
}

/**
 * Initializes listeners for collapsible sections, bonus mark modals, and archive flows.
 */
export function initMarksViewController(hooks: MarksControllerHooks): void {
  wireCollapsible('grades-tracker-toggle-btn', 'grades-tracker-breakdown');
  wireCollapsible('syllabus-tracker-toggle-btn', 'syllabus-tracker-breakdown');

  const { openBonusModal } = initMarksModals({
    hooks,
    renderGradeTracker,
    updateSemesterSelector
  });

  const gradesBody = document.getElementById('grades-tracker-breakdown');
  gradesBody?.addEventListener('click', async (e) => {
    const bonusCourseBtn = (e.target as HTMLElement).closest('.btn-add-course-bonus') as HTMLElement | null;
    if (bonusCourseBtn) {
      const courseName = bonusCourseBtn.getAttribute('data-course') || '';
      openBonusModal(courseName);
      return;
    }

    const bonusTriggerBtn = (e.target as HTMLElement).closest('.btn-add-bonus-trigger') as HTMLElement | null;
    if (bonusTriggerBtn) {
      openBonusModal();
      return;
    }

    const ignoreMarkBtn = (e.target as HTMLElement).closest('.btn-toggle-ignore-mark') as HTMLElement | null;
    if (ignoreMarkBtn) {
      const markId = ignoreMarkBtn.getAttribute('data-mark-id') || '';
      if (!markId) return;
      const res = toggleMarkIgnoredInTasks(hooks.getTasks(), markId);
      if (res.ignored === undefined) return;
      const saved = await hooks.saveTasks(res.tasks);
      renderGradeTracker(saved, hooks);
      hooks.renderTasks();
      hooks.refreshAllViews();
      hooks.syncCloud(saved, res.ignored ? 'Ignored Mark' : 'Included Mark');

      const label = (res.title || 'Mark').slice(0, 24);
      hooks.showToast(
        res.ignored ? `Ignored "${label}" from GPA` : `Included "${label}" in GPA`,
        'Undo',
        async () => {
          const undone = toggleMarkIgnoredInTasks(hooks.getTasks(), markId);
          const savedUndo = await hooks.saveTasks(undone.tasks);
          renderGradeTracker(savedUndo, hooks);
          hooks.renderTasks();
          hooks.refreshAllViews();
          hooks.syncCloud(savedUndo, 'Restored Mark Inclusion');
        }
      );
      return;
    }

    const delMarkBtn = (e.target as HTMLElement).closest('.btn-delete-mark') as HTMLElement | null;
    if (delMarkBtn) {
      const markId = delMarkBtn.getAttribute('data-mark-id') || '';
      if (!markId) return;
      const res = deleteMarkFromTasks(hooks.getTasks(), markId);
      if (res.action === 'none' || !res.previousTask) return;
      const prev = res.previousTask;

      if (res.action === 'deleted') {
        const prevTs = new Date(prev.updatedAt || prev.createdAt || 0).getTime() || 0;
        await recordLocalTombstone(markId, new Date(Math.max(Date.now(), prevTs + 1000)).toISOString());
      }
      const saved = await hooks.saveTasks(res.tasks);
      renderGradeTracker(saved, hooks);
      hooks.renderTasks();
      hooks.refreshAllViews();
      hooks.syncCloud(saved, res.action === 'deleted' ? 'Deleted Mark' : 'Cleared Mark');

      const label = (res.title || 'Mark').slice(0, 24);
      hooks.showToast(
        res.action === 'deleted' ? `Deleted mark "${label}"` : `Removed mark on "${label}"`,
        'Undo',
        async () => {
          if (res.action === 'deleted') {
            await removeLocalTombstone(prev.id);
          }
          const current = hooks.getTasks().filter(t => t.id !== prev.id);
          const restored = deduplicateTaskList([
            ...current,
            { ...prev, updatedAt: new Date().toISOString() }
          ]);
          restored.sort(compareTasksByTime);
          const savedRestore = await hooks.saveTasks(restored);
          renderGradeTracker(savedRestore, hooks);
          hooks.renderTasks();
          hooks.refreshAllViews();
          hooks.syncCloud(savedRestore, 'Restored Mark');
          hooks.showToast('Mark restored');
        }
      );
      return;
    }

    const enterScoreBtn = (e.target as HTMLElement).closest('.btn-enter-mark-score') as HTMLElement | null;
    if (enterScoreBtn) {
      const markId = enterScoreBtn.getAttribute('data-mark-id') || '';
      const task = hooks.getTasks().find(t => t.id === markId);
      if (task) openCompleteScoreModal(task, hooks);
      return;
    }

    const targetToggleBtn = (e.target as HTMLElement).closest('#target-breakdown-toggle-btn, .target-breakdown-header') as HTMLElement | null;
    if (targetToggleBtn) {
      const content = document.getElementById('target-breakdown-content');
      if (content) {
        const isCurrentlyOpen = !content.hidden;
        const nextOpen = !isCurrentlyOpen;
        content.hidden = !nextOpen;
        content.style.display = nextOpen ? 'flex' : 'none';
        targetToggleBtn.setAttribute('aria-expanded', String(nextOpen));
        try { localStorage.setItem('bbs_open_target_breakdown', nextOpen ? '1' : '0'); } catch {}
      }
      return;
    }

    const guideToggle = (e.target as HTMLElement).closest('#btn-toggle-gpa-guide') as HTMLElement | null;
    if (guideToggle) {
      const panel = document.getElementById('gpa-predictor-guide');
      if (panel) {
        guideOpenState = panel.style.display === 'none';
        panel.style.display = guideOpenState ? 'block' : 'none';
        guideToggle.setAttribute('aria-expanded', guideOpenState ? 'true' : 'false');
      }
      return;
    }

    const modeBtn = (e.target as HTMLElement).closest('.btn-goal-mode') as HTMLElement | null;
    if (modeBtn && modeBtn.dataset.mode) {
      const mode = modeBtn.dataset.mode as 'cgpa' | 'term';
      const prof = hooks.getProfile() || { universityId: 'uos', updatedAt: new Date().toISOString() };
      prof.targetGpaMode = mode;
      prof.updatedAt = new Date().toISOString();
      await hooks.saveProfile(prof);
      renderGradeTracker(hooks.getTasks(), hooks);
      hooks.renderTasks();
      return;
    }

    const chip = (e.target as HTMLElement).closest('.target-chip') as HTMLElement | null;
    if (chip) {
      const course = chip.getAttribute('data-course');
      const letter = chip.getAttribute('data-letter');
      if (course && letter) {
        selectedTargetGrades.set(course, letter);
        renderGradeTracker(hooks.getTasks(), hooks);
        hooks.renderTasks();
      }
      return;
    }

    const gpaChip = (e.target as HTMLElement).closest('.btn-target-chip-val') as HTMLElement | null;
    if (gpaChip && gpaChip.dataset.target) {
      const val = parseFloat(gpaChip.dataset.target);
      const mode = (gpaChip.dataset.mode || 'term') as 'term' | 'cgpa';
      if (!isNaN(val)) {
        const snap = snapTargetGpa(val, mode, hooks);
        const prof = hooks.getProfile() || { universityId: 'uos', updatedAt: new Date().toISOString() };
        if (mode === 'cgpa') {
          prof.targetCgpa = snap.snappedVal;
          if (snap.plannedTermGpa !== undefined) {
            prof.targetTermGpa = snap.plannedTermGpa;
          }
          prof.targetGpaMode = 'cgpa';
        } else {
          prof.targetTermGpa = snap.snappedVal;
          if (snap.projCgpaVal !== undefined) {
            prof.targetCgpa = snap.projCgpaVal;
          }
          prof.targetGpaMode = 'term';
        }
        prof.updatedAt = new Date().toISOString();
        await hooks.saveProfile(prof);
        lastAdjustedTarget = snap.adjusted ? { requested: val, snapped: snap.snappedVal, mode } : null;
        if (snap.adjusted) {
          hooks.showToast(snap.reason);
        }
        renderGradeTracker(hooks.getTasks(), hooks);
        hooks.renderTasks();
      }
      return;
    }

    const maxCgpaBtn = (e.target as HTMLElement).closest('.btn-set-max-cgpa') as HTMLElement | null;
    if (maxCgpaBtn && maxCgpaBtn.dataset.maxCgpa) {
      const val = parseFloat(maxCgpaBtn.dataset.maxCgpa);
      if (!isNaN(val)) {
        lastAdjustedTarget = null;
        const prof = hooks.getProfile() || { universityId: 'uos', updatedAt: new Date().toISOString() };
        prof.targetCgpa = Math.round(val * 100) / 100;
        prof.targetGpaMode = 'cgpa';
        prof.updatedAt = new Date().toISOString();
        await hooks.saveProfile(prof);
        renderGradeTracker(hooks.getTasks(), hooks);
        hooks.renderTasks();
      }
      return;
    }

    const maxGpaBtn = (e.target as HTMLElement).closest('.btn-set-max-gpa') as HTMLElement | null;
    if (maxGpaBtn && maxGpaBtn.dataset.maxGpa) {
      const val = parseFloat(maxGpaBtn.dataset.maxGpa);
      if (!isNaN(val)) {
        lastAdjustedTarget = null;
        const prof = hooks.getProfile() || { universityId: 'uos', updatedAt: new Date().toISOString() };
        prof.targetTermGpa = Math.round(val * 100) / 100;
        prof.targetGpaMode = 'term';
        prof.updatedAt = new Date().toISOString();
        await hooks.saveProfile(prof);
        renderGradeTracker(hooks.getTasks(), hooks);
        hooks.renderTasks();
      }
      return;
    }
  });

  gradesBody?.addEventListener('change', async (e) => {
    const target = e.target as HTMLInputElement;
    if (target && (target.id === 'input-target-gpa-val' || target.id === 'input-target-term-gpa')) {
      const val = parseFloat(target.value);
      const mode = (target.dataset.mode || 'term') as 'term' | 'cgpa';
      if (!isNaN(val) && val >= 1.0 && val <= 4.0) {
        const snap = snapTargetGpa(val, mode, hooks);
        const prof = hooks.getProfile() || { universityId: 'uos', updatedAt: new Date().toISOString() };
        if (mode === 'cgpa') {
          prof.targetCgpa = snap.snappedVal;
          if (snap.plannedTermGpa !== undefined) {
            prof.targetTermGpa = snap.plannedTermGpa;
          }
          prof.targetGpaMode = 'cgpa';
        } else {
          prof.targetTermGpa = snap.snappedVal;
          if (snap.projCgpaVal !== undefined) {
            prof.targetCgpa = snap.projCgpaVal;
          }
          prof.targetGpaMode = 'term';
        }
        prof.updatedAt = new Date().toISOString();
        await hooks.saveProfile(prof);
        target.value = snap.snappedVal.toFixed(2);
        lastAdjustedTarget = snap.adjusted ? { requested: val, snapped: snap.snappedVal, mode } : null;
        if (snap.adjusted) {
          hooks.showToast(snap.reason);
        }
        renderGradeTracker(hooks.getTasks(), hooks);
        hooks.renderTasks();
      }
    }
  });

  gradesBody?.addEventListener('keydown', (e) => {
    const target = e.target as HTMLInputElement;
    if (e.key === 'Enter' && target && (target.id === 'input-target-gpa-val' || target.id === 'input-target-term-gpa')) {
      target.blur();
    }
  });

  const select = document.getElementById('select-semester-view') as HTMLSelectElement | null;
  if (select) {
    select.addEventListener('change', () => {
      hooks.setSelectedSemesterId(select.value);
      renderGradeTracker(hooks.getTasks(), hooks);
    });
  }

  const autoPartitionBtn = document.getElementById('btn-auto-partition-semesters');
  autoPartitionBtn?.addEventListener('click', async () => {
    const profile = hooks.getProfile();
    const scale = profileGradeScale(profile);
    const res = autoPartitionPastSemesters({
      courses: hooks.getUserCourses(),
      tasks: hooks.getTasks(),
      scale,
      existingSemesters: hooks.getSemesters(),
      mode: 'full'
    });
    if (res.partitionedCoursesCount > 0) {
      await hooks.saveUserCourses(res.activeCourses, new Date().toISOString());
      const savedTasks = await hooks.saveTasks(res.activeTasks);
      await hooks.saveSemesters(res.archivedSemesters);
      await updateSemesterSelector(hooks);
      renderGradeTracker(savedTasks, hooks);
      hooks.refreshAllViews();
    }
  });
}

/** Opens and closes a card; the open state is remembered per card. */
export function wireCollapsible(btnId: string, bodyId: string): void {
  const toggleBtn = document.getElementById(btnId);
  const body = document.getElementById(bodyId);
  if (!toggleBtn || !body) return;
  const key = `bbs_open_${bodyId}`;
  const setOpen = (open: boolean) => {
    body.hidden = !open;
    toggleBtn.setAttribute('aria-expanded', String(open));
  };
  try { setOpen(localStorage.getItem(key) === '1'); } catch { setOpen(false); }
  toggleBtn.addEventListener('click', () => {
    const open = Boolean(body.hidden);
    setOpen(open);
    try { localStorage.setItem(key, open ? '1' : '0'); } catch { /* not saved in this browser */ }
  });
}
