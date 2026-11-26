import type { DeadlineTask } from '../../types';
import { bonusTargetOptionsForCourse, formatTaskWeightDisplay } from '../../core/syllabusWeights';
import { escapeHtml } from '../../utils/ui/uiCommon';
import { detectSemesterName, archiveActiveSemester } from '../../core/semesters';
import { profileGradeScale } from '../../core/studentProfile';
import { buildGpaSummary } from '../../utils/marks/gpa';
import { compareTasksByTime } from '../../utils/tasks/calendar';
import { deduplicateTaskList } from '../../utils/tasks/taskMerge';
import type { MarksControllerHooks } from '../marksViewController';

export interface MarksModalCallbacks {
  hooks: MarksControllerHooks;
  renderGradeTracker: (tasks: DeadlineTask[], hooks: MarksControllerHooks) => void;
  updateSemesterSelector: (hooks: MarksControllerHooks) => Promise<void>;
}

/** Closes a modal backdrop cleanly and keeps hidden state in sync. */
function setModalVisible(modal: HTMLElement | null, visible: boolean): void {
  if (!modal) return;
  modal.style.display = visible ? 'flex' : 'none';
  modal.classList.toggle('hidden', !visible);
}

/** Wires Bonus Mark, Score Entry, and Archive Term modals for the Marks tab. */
export function initMarksModals({ hooks, renderGradeTracker, updateSemesterSelector }: MarksModalCallbacks): {
  openBonusModal: (defaultCourseName?: string) => void;
} {
  const applyTaskMutation = async (nextTasks: DeadlineTask[], syncReason: string): Promise<DeadlineTask[]> => {
    const saved = await hooks.saveTasks(nextTasks);
    renderGradeTracker(saved, hooks);
    hooks.renderTasks();
    hooks.refreshAllViews();
    hooks.syncCloud(saved, syncReason);
    return saved;
  };

  // --- Add Bonus Mark Modal ---
  const bonusModal = document.getElementById('modal-add-bonus');
  const bonusForm = document.getElementById('form-add-bonus') as HTMLFormElement | null;
  const bonusCourseSelect = document.getElementById('bonus-course-select') as HTMLSelectElement | null;
  const bonusTargetSelect = document.getElementById('bonus-target-select') as HTMLSelectElement | null;
  const bonusTitleInput = document.getElementById('bonus-title-input') as HTMLInputElement | null;
  const bonusValInput = document.getElementById('bonus-val-input') as HTMLInputElement | null;
  const bonusUnitSelect = document.getElementById('bonus-unit-select') as HTMLSelectElement | null;
  const bonusUnitHint = document.getElementById('bonus-unit-hint');
  const bonusLinkDateCheck = document.getElementById('bonus-link-date-check') as HTMLInputElement | null;
  const bonusDateWrap = document.getElementById('bonus-date-wrap');
  const bonusDateInput = document.getElementById('bonus-date-input') as HTMLInputElement | null;
  const bonusTimeInput = document.getElementById('bonus-time-input') as HTMLInputElement | null;
  const bonusTypeSelect = document.getElementById('bonus-type-select') as HTMLSelectElement | null;
  const bonusEarnedCheck = document.getElementById('bonus-earned-check') as HTMLInputElement | null;
  const bonusNotesInput = document.getElementById('bonus-notes-input') as HTMLInputElement | null;
  const closeBonusBtn = document.getElementById('btn-close-bonus-modal');
  const cancelBonusBtn = document.getElementById('btn-cancel-bonus');

  const syncBonusUnitHint = () => {
    if (!bonusUnitHint) return;
    const isPct = bonusUnitSelect?.value === 'percent';
    const targetVal = bonusTargetSelect?.value || 'total';
    const targetLabel = bonusTargetSelect?.selectedOptions?.[0]?.dataset.shortLabel || 'Course Total';
    if (isPct) {
      bonusUnitHint.textContent = targetVal === 'total'
        ? `Adds a percentage boost (+%) directly onto your ${targetLabel}.`
        : `Applies that percentage boost of ${targetLabel}'s syllabus weight.`;
    } else {
      bonusUnitHint.textContent = targetVal === 'total'
        ? 'Adds pure extra points directly without inflating the required syllabus denominator.'
        : `Adds pure extra points toward ${targetLabel}.`;
    }
  };

  const syncBonusDateVisibility = () => {
    if (bonusDateWrap) bonusDateWrap.style.display = bonusLinkDateCheck?.checked ? '' : 'none';
  };

  bonusUnitSelect?.addEventListener('change', syncBonusUnitHint);
  bonusTargetSelect?.addEventListener('change', syncBonusUnitHint);
  bonusLinkDateCheck?.addEventListener('change', syncBonusDateVisibility);

  const populateBonusModalTargets = () => {
    if (!bonusTargetSelect) return;
    const courseName = bonusCourseSelect?.value || '';
    const matched = hooks.getUserCourses().find(c => c.courseName === courseName);
    const opts = bonusTargetOptionsForCourse(courseName, matched?.courseCode || '');
    bonusTargetSelect.innerHTML = '';
    for (const o of opts) {
      const el = document.createElement('option');
      el.value = o.value;
      el.textContent = o.label;
      el.dataset.shortLabel = o.shortLabel;
      bonusTargetSelect.appendChild(el);
    }
    bonusTargetSelect.value = 'total';
    syncBonusUnitHint();
  };

  bonusCourseSelect?.addEventListener('change', populateBonusModalTargets);

  const openBonusModal = (defaultCourseName?: string) => {
    if (!bonusModal || !bonusCourseSelect) return;
    bonusCourseSelect.innerHTML = '';
    const activeCourses = hooks.getUserCourses() || [];
    if (activeCourses.length === 0) {
      const opt = document.createElement('option');
      opt.value = defaultCourseName || 'General Course';
      opt.textContent = defaultCourseName || 'General Course';
      bonusCourseSelect.appendChild(opt);
    } else {
      for (const c of activeCourses) {
        const opt = document.createElement('option');
        opt.value = c.courseName;
        opt.textContent = c.courseCode ? `${c.courseName} (${c.courseCode})` : c.courseName;
        if (defaultCourseName && (c.courseName.toLowerCase() === defaultCourseName.toLowerCase() || c.courseCode?.toLowerCase() === defaultCourseName.toLowerCase())) {
          opt.selected = true;
        }
        bonusCourseSelect.appendChild(opt);
      }
    }
    populateBonusModalTargets();
    if (bonusTitleInput) bonusTitleInput.value = 'Bonus Mark / Extra Credit';
    if (bonusValInput) bonusValInput.value = '2.0';
    if (bonusUnitSelect) bonusUnitSelect.value = 'points';
    if (bonusLinkDateCheck) bonusLinkDateCheck.checked = false;
    if (bonusDateInput) {
      const d = new Date();
      bonusDateInput.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    if (bonusTimeInput) bonusTimeInput.value = '';
    if (bonusTypeSelect) bonusTypeSelect.value = 'quiz';
    if (bonusEarnedCheck) bonusEarnedCheck.checked = false;
    syncBonusDateVisibility();
    syncBonusUnitHint();
    if (bonusNotesInput) bonusNotesInput.value = '';
    setModalVisible(bonusModal, true);
    setTimeout(() => bonusTitleInput?.focus(), 40);
  };

  const closeBonusModal = () => setModalVisible(bonusModal, false);
  closeBonusBtn?.addEventListener('click', closeBonusModal);
  cancelBonusBtn?.addEventListener('click', closeBonusModal);
  bonusModal?.addEventListener('click', (e) => {
    if (e.target === bonusModal) closeBonusModal();
  });

  bonusForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!bonusCourseSelect || !bonusValInput) return;
    const courseName = bonusCourseSelect.value;
    const matched = hooks.getUserCourses().find(c => c.courseName === courseName);
    const courseCode = matched?.courseCode || 'UOS';
    const title = bonusTitleInput?.value.trim() || 'Bonus Mark';
    const bonusVal = parseFloat(bonusValInput.value) || 0;
    const bonusUnit: 'points' | 'percent' = bonusUnitSelect?.value === 'percent' ? 'percent' : 'points';
    const notes = bonusNotesInput?.value.trim() || '';
    const bonusTarget = bonusTargetSelect?.value || 'total';
    const bonusTargetLabel = bonusTargetSelect?.selectedOptions?.[0]?.dataset.shortLabel || (bonusTarget === 'total' ? 'Course Total' : bonusTarget);
    const linkedToDeadline = Boolean(bonusLinkDateCheck?.checked && bonusDateInput?.value);
    const nowIso = new Date().toISOString();

    let dueDateIso = '';
    let hasSpecificTime = false;
    if (linkedToDeadline && bonusDateInput?.value) {
      const timeStr = bonusTimeInput?.value;
      dueDateIso = new Date(`${bonusDateInput.value}T${timeStr ? `${timeStr}:00` : '23:59:00'}`).toISOString();
      hasSpecificTime = Boolean(timeStr);
    }

    const isGradedNow = !linkedToDeadline || Boolean(bonusEarnedCheck?.checked);
    const newBonusTask: DeadlineTask = {
      id: linkedToDeadline
        ? `task_manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        : `task_bonus_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      courseName,
      courseCode,
      dueDate: dueDateIso,
      hasSpecificTime,
      type: linkedToDeadline ? ((bonusTypeSelect?.value as DeadlineTask['type']) || 'quiz') : 'other',
      priority: 'medium',
      status: isGradedNow ? 'completed' : 'pending',
      completedAt: isGradedNow ? nowIso : undefined,
      submissionStatus: isGradedNow ? 'graded' : undefined,
      gradedAt: isGradedNow ? nowIso : undefined,
      score: isGradedNow ? bonusVal : undefined,
      maxScore: isGradedNow ? bonusVal : undefined,
      weight: bonusVal,
      weightDisplay: formatTaskWeightDisplay(bonusVal, { isBonus: true, bonusUnit, bonusTarget, bonusTargetLabel }),
      isBonus: true,
      bonusUnit,
      bonusTarget,
      bonusTargetLabel,
      notes,
      description: notes || title,
      sourceSnippet: notes || (linkedToDeadline ? title : 'Manual bonus mark entry'),
      confidence: 1.0,
      extractedBy: 'manual',
      userEdited: true,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    const updatedTasks = deduplicateTaskList([...hooks.getTasks(), newBonusTask]);
    updatedTasks.sort(compareTasksByTime);
    await applyTaskMutation(updatedTasks, linkedToDeadline ? 'Added Bonus Deadline' : 'Added Bonus Mark');
    closeBonusModal();
  });

  // --- Quick Score Entry Modal ---
  const scoreModal = document.getElementById('modal-complete-score');
  const scoreForm = document.getElementById('form-complete-score') as HTMLFormElement | null;
  const closeScoreBtn = document.getElementById('btn-close-complete-score');
  const skipScoreBtn = document.getElementById('btn-skip-complete-score');
  const closeScoreModal = () => setModalVisible(scoreModal, false);
  closeScoreBtn?.addEventListener('click', closeScoreModal);
  skipScoreBtn?.addEventListener('click', closeScoreModal);
  scoreModal?.addEventListener('click', (e) => {
    if (e.target === scoreModal) closeScoreModal();
  });

  scoreForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idInput = document.getElementById('complete-score-task-id') as HTMLInputElement | null;
    const earnedInput = document.getElementById('complete-score-earned') as HTMLInputElement | null;
    const maxInput = document.getElementById('complete-score-max') as HTMLInputElement | null;
    const taskId = idInput?.value || '';
    const earned = parseFloat(earnedInput?.value || '');
    const maxRaw = parseFloat(maxInput?.value || '');
    if (!taskId || isNaN(earned) || earned < 0) return;
    const maxScore = !isNaN(maxRaw) && maxRaw > 0 ? maxRaw : (earned > 0 ? earned : 10);
    const nowIso = new Date().toISOString();
    const nextTasks = hooks.getTasks().map(t => (
      t.id !== taskId ? t : {
        ...t,
        status: 'completed' as const,
        completedAt: t.completedAt || nowIso,
        submissionStatus: 'graded' as const,
        score: earned,
        maxScore,
        gradedAt: nowIso,
        userEdited: true,
        updatedAt: nowIso
      }
    ));
    await applyTaskMutation(nextTasks, 'Recorded Mark');
    closeScoreModal();
    hooks.showToast('Mark saved');
  });

  // --- Archive Term Modal ---
  const openArchiveBtn = document.getElementById('btn-open-archive-semester');
  const archiveModal = document.getElementById('modal-archive-semester');
  const closeArchiveBtn = document.getElementById('btn-close-archive-modal');
  const cancelArchiveBtn = document.getElementById('btn-cancel-archive-semester');
  const confirmArchiveBtn = document.getElementById('btn-confirm-archive-semester');
  const closeArchive = () => setModalVisible(archiveModal, false);

  openArchiveBtn?.addEventListener('click', () => {
    if (!archiveModal) return;
    const userCourses = hooks.getUserCourses();
    const detected = detectSemesterName(userCourses);
    const archiveTermInput = (document.getElementById('archive-semester-name') || document.getElementById('archive-term-name')) as HTMLInputElement | null;
    const archivePreview = document.getElementById('archive-semester-summary') || document.getElementById('archive-courses-preview');
    if (archiveTermInput) archiveTermInput.value = detected || '';
    if (archivePreview) {
      if (userCourses.length === 0) {
        archivePreview.innerHTML = '<p style="color: var(--text-muted); font-size: 12px; margin: 0;">No active courses configured. Add courses before archiving.</p>';
      } else {
        const scale = profileGradeScale(hooks.getProfile());
        const gpa = buildGpaSummary(hooks.getTasks(), hooks.getAllSyllabi(), scale);
        const gradeMap = new Map((gpa.courses || []).map(cg => [cg.courseName.toLowerCase(), cg]));
        archivePreview.innerHTML = userCourses.map(c => {
          const cg = gradeMap.get(c.courseName.toLowerCase());
          const gradeBadge = cg && typeof cg.percent === 'number'
            ? `<span style="font-weight: 700; color: var(--text-main);">${cg.letter || ''} (${Math.round(cg.percent)}%)</span>`
            : `<span style="color: var(--text-muted); font-size: 11px;">No grade yet</span>`;
          return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--border-light); font-size: 12px;"><span><b>${escapeHtml(c.courseName)}</b> <span style="color: var(--text-muted);">(${c.creditHours ?? 3} cr)</span></span><span>${gradeBadge}</span></div>`;
        }).join('');
      }
    }
    setModalVisible(archiveModal, true);
    setTimeout(() => archiveTermInput?.focus(), 40);
  });

  closeArchiveBtn?.addEventListener('click', closeArchive);
  cancelArchiveBtn?.addEventListener('click', closeArchive);
  archiveModal?.addEventListener('click', (e) => {
    if (e.target === archiveModal) closeArchive();
  });

  confirmArchiveBtn?.addEventListener('click', async () => {
    const archiveTermInput = (document.getElementById('archive-semester-name') || document.getElementById('archive-term-name')) as HTMLInputElement | null;
    if (!archiveTermInput) return;
    const semesters = hooks.getSemesters();
    const userCourses = hooks.getUserCourses();
    const tasks = hooks.getTasks();
    const name = archiveTermInput.value.trim() || `Term ${semesters.length + 1}`;
    const depthRadio = (document.querySelector('input[name="archive-mode"]:checked') || document.querySelector('input[name="archive-depth"]:checked')) as HTMLInputElement | null;
    const clearActive = (document.getElementById('archive-clear-active') as HTMLInputElement)?.checked;
    const scale = profileGradeScale(hooks.getProfile());
    const sem = archiveActiveSemester({
      name,
      courses: userCourses,
      tasks,
      scale,
      mode: depthRadio?.value === 'full' ? 'full' : 'compact'
    });

    await hooks.saveSemesters([sem, ...semesters.filter(s => s.id !== sem.id)]);

    let nextTasks = tasks;
    if (clearActive) {
      await hooks.saveUserCourses([], new Date().toISOString());
      nextTasks = tasks.filter(t => t.status !== 'completed');
      await hooks.saveTasks(nextTasks);
    }

    closeArchive();
    await updateSemesterSelector(hooks);
    hooks.setSelectedSemesterId(sem.id);
    const select = document.getElementById('select-semester-view') as HTMLSelectElement | null;
    if (select) select.value = sem.id;

    renderGradeTracker(nextTasks, hooks);
    hooks.refreshAllViews();
    hooks.showToast(`Semester "${name}" archived successfully!`);
    hooks.syncCloud(nextTasks, 'Archive Semester');
  });

  return { openBonusModal };
}

/** Opens the quick non-blocking Score Entry dialog when a manual deadline is marked done or '+ Score' is clicked. */
export function openCompleteScoreModal(task: DeadlineTask, _hooks?: MarksControllerHooks): void {
  const modal = document.getElementById('modal-complete-score');
  const idInput = document.getElementById('complete-score-task-id') as HTMLInputElement | null;
  const labelEl = document.getElementById('complete-score-task-label');
  const earnedInput = document.getElementById('complete-score-earned') as HTMLInputElement | null;
  const maxInput = document.getElementById('complete-score-max') as HTMLInputElement | null;
  if (!modal || !idInput || !earnedInput || !maxInput) return;

  idInput.value = task.id;
  if (labelEl) {
    const unitTag = task.isBonus ? ` (${task.bonusUnit === 'percent' ? '%' : 'pts'} bonus)` : '';
    labelEl.textContent = `${task.courseName ? `${task.courseName} · ` : ''}${task.title}${unitTag}`;
  }
  const suggestedMax = task.maxScore || (task.isBonus && task.weight ? task.weight : undefined);
  maxInput.value = suggestedMax ? String(suggestedMax) : '10';
  earnedInput.value = typeof task.score === 'number' ? String(task.score) : '';
  earnedInput.placeholder = suggestedMax ? `out of ${suggestedMax}` : 'e.g. 9';

  setModalVisible(modal, true);
  setTimeout(() => earnedInput.focus(), 40);
}
