import type { DeadlineTask } from '../../types';
import { localizedTaskView } from '../../core/arabicTranslator';
import { localizeTaskTypeLabel } from '../../core/i18n';
import { getCourseColorTheme } from '../../core/courseColors';
import { getAllCourseSchedules } from '../../core/courseSchedule';
import { profileGradeScale } from '../../core/studentProfile';
import { bonusTargetOptionsForCourse, getAllSyllabi } from '../../core/syllabusWeights';
import { calculateTrajectoryTargetPlan } from '../../core/targetGpa';
import { buildGpaSummary } from '../../utils/gpa';
import { formatCountdown } from '../../utils/calendar';
import { parseCourseDetails, resolveCourseInfo } from '../../core/courseHelper';
import { escapeHtml, getSvgIcon, getTaskTypeIcon } from '../../utils/uiCommon';
import { findPickedCourse } from '../coursePicker';
import { getCachedProfile } from '../universitySettings';
import { getTaskTargetBadgeHtml } from './dayDrawer';
import { closeModalEl, openModalEl, registerOverlayCloseHandler } from './overlayController';
import {
  renderSummaryAndNotesForExt,
  renderUnifiedActionsForExt,
  wireUnifiedTaskActions
} from './taskActions';
import { dom, formatDateKey, popupActions, popupState } from './state';

export function updateAddRoomVisibility() {
  const addTypeSelect = document.getElementById('add-type') as HTMLSelectElement | null;
  const addRoomInput = document.getElementById('add-room') as HTMLInputElement | null;
  const isHwOrProj = addTypeSelect?.value === 'assignment' || (addTypeSelect?.value as string) === 'hw' || addTypeSelect?.value === 'project';
  const group = addRoomInput ? addRoomInput.closest('.form-group') as HTMLElement | null : null;
  if (group) group.style.display = isHwOrProj ? 'none' : '';
  if (isHwOrProj && addRoomInput) addRoomInput.value = '';
}

export function updateEditRoomVisibility() {
  const editTypeSelect = document.getElementById('edit-type') as HTMLSelectElement | null;
  const editRoomInput = document.getElementById('edit-room') as HTMLInputElement | null;
  const isHwOrProj = editTypeSelect?.value === 'assignment' || (editTypeSelect?.value as string) === 'hw' || editTypeSelect?.value === 'project';
  const group = editRoomInput ? editRoomInput.closest('.form-group') as HTMLElement | null : null;
  if (group) group.style.display = isHwOrProj ? 'none' : '';
  if (isHwOrProj && editRoomInput) editRoomInput.value = '';
}

/** Populates "Bonus On What" choices and syncs labels/visibility for Add & Edit grade mode UI. */
export function syncBonusFormUi(prefix: 'add' | 'edit', courseInputVal: string, preferredTarget?: string, preferredUnit?: 'points' | 'percent'): void {
  const gradeMode = document.getElementById(`${prefix}-grade-mode`) as HTMLSelectElement | null;
  const isBonus = gradeMode?.value === 'bonus';
  const weightLabel = document.getElementById(`${prefix}-weight-label`);
  const weightSublabel = document.getElementById(`${prefix}-weight-sublabel`);
  const weightInput = document.getElementById(`${prefix}-weight`) as HTMLInputElement | null;
  const calcBtn = document.getElementById(prefix === 'add' ? 'btn-calc-add-weight' : 'btn-calc-edit-weight');
  const bonusOpts = document.getElementById(`${prefix}-bonus-options`);
  const bonusTargetSelect = document.getElementById(`${prefix}-bonus-target`) as HTMLSelectElement | null;
  const bonusUnitSelect = document.getElementById(`${prefix}-bonus-unit`) as HTMLSelectElement | null;

  if (bonusUnitSelect && preferredUnit) {
    bonusUnitSelect.value = preferredUnit === 'percent' ? 'percent' : 'points';
  }
  const unitVal = bonusUnitSelect?.value === 'percent' ? 'percent' : 'points';
  if (weightLabel) weightLabel.textContent = isBonus ? (unitVal === 'percent' ? 'Bonus Value (%)' : 'Bonus Points (pts)') : 'Grade Weight (%)';
  if (weightSublabel) weightSublabel.textContent = isBonus ? '(extra credit)' : '(from Syllabus)';
  if (weightInput) weightInput.placeholder = isBonus ? 'e.g. 2' : 'e.g. 5';
  if (calcBtn) (calcBtn as HTMLElement).style.display = isBonus ? 'none' : '';
  if (bonusOpts) bonusOpts.style.display = isBonus ? '' : 'none';

  if (bonusTargetSelect) {
    const parsed = parsePickedCourse(courseInputVal || '');
    const options = bonusTargetOptionsForCourse(parsed.name || courseInputVal, parsed.code);
    const keepVal = preferredTarget || bonusTargetSelect.value || 'total';
    bonusTargetSelect.innerHTML = '';
    for (const opt of options) {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      el.dataset.shortLabel = opt.shortLabel;
      bonusTargetSelect.appendChild(el);
    }
    if (options.some(o => o.value === keepVal)) {
      bonusTargetSelect.value = keepVal;
    } else if (preferredTarget && preferredTarget !== 'total') {
      const customOpt = document.createElement('option');
      customOpt.value = preferredTarget;
      customOpt.textContent = preferredTarget.replace(/^(?:comp:|compname:|type:)/, '');
      customOpt.dataset.shortLabel = customOpt.textContent;
      bonusTargetSelect.appendChild(customOpt);
      bonusTargetSelect.value = preferredTarget;
    } else {
      bonusTargetSelect.value = 'total';
    }
  }

  if (prefix === 'add') {
    const earnedCheck = document.getElementById('add-bonus-earned') as HTMLInputElement | null;
    const scoreWrap = document.getElementById('add-bonus-score-wrap');
    if (scoreWrap) scoreWrap.style.display = isBonus && earnedCheck?.checked ? '' : 'none';
  } else {
    const statusSel = document.getElementById('edit-status') as HTMLSelectElement | null;
    const scoreWrap = document.getElementById('edit-bonus-score-wrap');
    if (scoreWrap) scoreWrap.style.display = isBonus && statusSel?.value === 'completed' ? '' : 'none';
  }
}

/** A course picked from the list keeps that course's own name and code; anything else is parsed as typed. */
export function parsePickedCourse(value: string): { name: string; code: string } {
  const picked = findPickedCourse(popupState.currentUserCourses, value);
  if (picked) return { name: picked.courseName, code: (picked.courseCode || '').trim() || 'UOS' };
  return parseCourseDetails(value);
}

export function openReadingSheet(task: DeadlineTask) {
  const modal = document.getElementById('modal-reading-sheet');
  const badgeGroup = document.getElementById('reading-modal-badges');
  const content = document.getElementById('reading-modal-content');
  if (!modal || !badgeGroup || !content) return;

  const lang = popupState.currentLanguage;
  const isAr = lang === 'ar';
  const resolved = resolveCourseInfo(task);
  const view = localizedTaskView({ ...task, courseName: resolved.courseName }, lang);
  const courseTheme = getCourseColorTheme(resolved.courseName, resolved.courseCode, task.title);
  const isHwOrProject = task.type === 'assignment' || (task.type as string) === 'hw' || task.type === 'project';
  const countdown = formatCountdown(task.dueDate, task.hasSpecificTime, task.status);

  const profile = getCachedProfile();
  const scale = profileGradeScale(profile);
  const syllabi = getAllSyllabi();
  const gpa = buildGpaSummary(popupState.currentTasks, syllabi, scale);
  const targetGpa = (typeof profile?.targetTermGpa === 'number' && profile.targetTermGpa > 0)
    ? profile.targetTermGpa
    : (gpa.gpa !== undefined ? Math.min(4.0, Math.round((Math.max(2.0, gpa.gpa) + 0.25) * 20) / 20) : 3.75);
  const trajectoryPlan = calculateTrajectoryTargetPlan(gpa, targetGpa, popupState.currentTasks, scale);
  const targetBadgeHtml = getTaskTargetBadgeHtml(task, trajectoryPlan, targetGpa);

  badgeGroup.innerHTML = `
    <div class="course-badge-main reading-course-badge" title="${escapeHtml(view.courseName)}${resolved.courseCode && resolved.courseCode !== 'UOS' ? ` (${escapeHtml(resolved.courseCode)})` : ''}">
      <span class="course-color-dot" style="background: ${courseTheme.hex};"></span>
      <span class="course-name-text">${escapeHtml(view.courseName)}</span>
    </div>
    <span class="type-pill type-${escapeHtml(task.type || 'assignment')}">
      <span>${getTaskTypeIcon(task.type)}</span>
      <span>${localizeTaskTypeLabel(task.type, lang, true)}</span>
    </span>
  `;

  content.innerHTML = `
    <h2 class="reading-pane-title">${escapeHtml(view.title)}</h2>

    <div class="reading-meta-section">
      <span class="urgency-badge ${countdown.urgency}">
        ${countdown.urgency === 'completed'
          ? `${getSvgIcon('check', 'mr-1')} ${escapeHtml(countdown.label)}`
          : (countdown.urgency === 'overdue' ? `${getSvgIcon('urgent', 'mr-1')} ${escapeHtml(countdown.label)}` : `${getSvgIcon('clock', 'mr-1')} ${escapeHtml(countdown.label)}`)}
      </span>
      ${!isHwOrProject ? `
      <button type="button" class="room-pill-btn modal-reading-room-btn" data-task-id="${escapeHtml(task.id)}">
        <span>${getSvgIcon('pin', 'mr-1')} ${escapeHtml(view.room || (isAr ? 'لم تُحدد القاعة' : 'No room set'))}</span>
        <span class="room-edit-hint">${getSvgIcon('pencil')}</span>
      </button>
      ` : ''}
      ${view.weightDisplay || task.weight ? `<span class="task-weight-pill weight-major">${getSvgIcon('scale', 'mr-1')} ${escapeHtml(view.weightDisplay || `${task.weight}%`)}</span>` : ''}
      ${targetBadgeHtml}
      ${(task.submissionStatus === 'graded' || (typeof task.score === 'number' && !isNaN(task.score))) ? `
        <span class="task-grade-pill" title="Grade / Score released on Blackboard">
          ${getSvgIcon('star', 'mr-1')} <span>${escapeHtml(task.scoreDisplay || (task.maxScore ? `${task.score} / ${task.maxScore}` : (task.score !== undefined ? `${task.score} pts` : (isAr ? 'مُقيّم' : 'Graded'))))}</span>
        </span>
      ` : ''}
      ${task.submissionStatus === 'submitted' ? `
        <span class="task-submitted-pill" title="${task.submissionReceipt ? `Receipt: ${escapeHtml(task.submissionReceipt)}` : 'Submitted to Blackboard'}">
          ${getSvgIcon('check', 'mr-1')} <span>${isAr ? 'تم التسليم' : 'Submitted'}</span>
        </span>
      ` : ''}
      ${task.priority === 'high' ? `<span class="high-priority-tag">${isAr ? 'أولوية عالية' : 'HIGH PRIORITY'}</span>` : ''}
    </div>

    ${renderSummaryAndNotesForExt(task, {
      variant: 'reading',
      countdownLabel: countdown.label,
      includeCopyBtn: true,
      copyBtnId: 'btn-copy-drawer-text'
    })}

    ${task.notes && task.notes.trim() ? `
      <div class="reading-notes-box">
        <div class="reading-notes-header">
          ${getSvgIcon('pencil')}
          <span>${isAr ? 'ملاحظات الطالب الشخصية' : 'Student Personal Notes'}</span>
        </div>
        <div class="reading-notes-content">${escapeHtml(task.notes)}</div>
      </div>
    ` : ''}

    <div class="reading-actions-bar">
      ${renderUnifiedActionsForExt(task, { variant: 'reading' })}
    </div>
  `;

  wireUnifiedTaskActions(content, task, {
    onAfterToggle: closeReadingSheet,
    onAfterDelete: closeReadingSheet,
    onBeforeEdit: closeReadingSheet
  });

  content.querySelector('.modal-reading-room-btn')?.addEventListener('click', () => {
    closeReadingSheet();
    openRoomPicker(task.id);
  });

  registerOverlayCloseHandler('modal-reading-sheet', closeReadingSheet);
  openModalEl('modal-reading-sheet', modal);
}

export function closeReadingSheet() {
  closeModalEl('modal-reading-sheet', document.getElementById('modal-reading-sheet'));
}

export function openRoomPicker(taskId: string) {
  const task = popupState.currentTasks.find(t => t.id === taskId);
  if (!task) return;
  popupState.activeRoomPickerTaskId = taskId;

  const modal = document.getElementById('modal-room-picker');
  const presetsContainer = document.getElementById('room-presets-container');
  const customInput = document.getElementById('input-custom-room') as HTMLInputElement;
  if (!modal || !presetsContainer) return;

  const currentRoom = (task.room || '').trim();
  if (customInput) customInput.value = currentRoom;

  const seenRooms = new Set<string>();
  const roomPresets = getAllCourseSchedules().filter(s => {
    const key = (s.room || '').trim().toLowerCase();
    if (!key || seenRooms.has(key)) return false;
    seenRooms.add(key);
    return true;
  });
  presetsContainer.innerHTML = roomPresets.map(s => {
    const isCurrent = currentRoom.toLowerCase() === s.room.toLowerCase();
    return `
      <button type="button" class="room-preset-btn ${isCurrent ? 'is-active' : ''}" data-room="${escapeHtml(s.room)}">
        <div class="room-preset-left">
          <span class="room-preset-code">${getSvgIcon('pin', 'mr-1')} ${escapeHtml(s.room)}</span>
          <span class="room-preset-course">${escapeHtml(s.courseName)}</span>
        </div>
        ${isCurrent ? '<span style="color:#4338ca; font-size:11px; font-weight:700;">✓ Current</span>' : '<span style="color:var(--text-muted); font-size:11px;">Select</span>'}
      </button>
    `;
  }).join('');

  presetsContainer.querySelectorAll('.room-preset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const selectedRoom = btn.getAttribute('data-room');
      await applyRoomChange(taskId, selectedRoom || '');
      closeRoomPicker();
    });
  });

  registerOverlayCloseHandler('modal-room-picker', closeRoomPicker);
  openModalEl('modal-room-picker', modal);
}

export function closeRoomPicker() {
  closeModalEl('modal-room-picker', document.getElementById('modal-room-picker'));
  popupState.activeRoomPickerTaskId = null;
}

export async function applyRoomChange(taskId: string, newRoom: string) {
  const cleanedRoom = (newRoom || '').trim();
  popupState.currentTasks = popupActions.applyTaskUpdateLocal(taskId, { room: cleanedRoom || undefined, userEdited: true });
  popupActions.refreshAllViews();
  popupActions.syncTasksToCloud(popupState.currentTasks, 'Room Change');
  popupActions.showToast(`Room updated to "${cleanedRoom || 'None'}"`);
}

export function openEditModal(task: DeadlineTask) {
  const modalEditTask = dom.modalEditTask();
  const editTaskIdInput = document.getElementById('edit-task-id') as HTMLInputElement;
  const editTitleInput = document.getElementById('edit-title') as HTMLInputElement;
  const editCourseInput = document.getElementById('edit-course') as HTMLInputElement;
  const editDateInput = document.getElementById('edit-date') as HTMLInputElement;
  const editTimeInput = document.getElementById('edit-time') as HTMLInputElement;
  const editTypeSelect = document.getElementById('edit-type') as HTMLSelectElement;
  const editPrioritySelect = document.getElementById('edit-priority') as HTMLSelectElement;
  const editStatusSelect = document.getElementById('edit-status') as HTMLSelectElement;
  const editDescInput = document.getElementById('edit-desc') as HTMLTextAreaElement;
  const editNotesInput = document.getElementById('edit-notes') as HTMLTextAreaElement;
  const editRoomInput = document.getElementById('edit-room') as HTMLInputElement;
  const editWeightInput = document.getElementById('edit-weight') as HTMLInputElement;
  const editWeightHint = document.getElementById('edit-weight-hint') as HTMLElement;

  popupState.editingTaskId = task.id;
  editTaskIdInput.value = task.id;
  editTitleInput.value = task.title;
  const resolved = resolveCourseInfo(task);
  editCourseInput.value = resolved.courseName || resolved.courseCode;

  const d = new Date(task.dueDate);
  if (!isNaN(d.getTime())) {
    editDateInput.value = formatDateKey(d);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    editTimeInput.value = task.hasSpecificTime ? `${hh}:${mm}` : '';
  } else {
    editDateInput.value = popupState.selectedDateStr;
    editTimeInput.value = '23:59';
  }

  editTypeSelect.value = task.type || 'assignment';
  editPrioritySelect.value = task.priority || 'medium';
  editStatusSelect.value = task.status || 'pending';
  if (editDescInput) {
    editDescInput.value = task.description || task.sourceSnippet || '';
  }
  editNotesInput.value = task.notes || '';
  if (editRoomInput) {
    editRoomInput.value = task.room || '';
  }
  updateEditRoomVisibility();
  editWeightInput.value = task.weight !== undefined && task.weight !== null ? String(task.weight) : '';
  editWeightHint.textContent = task.syllabusNote || (task.weightDisplay ? `Saved weight: ${task.weightDisplay}` : '');
  const editGradeMode = document.getElementById('edit-grade-mode') as HTMLSelectElement | null;
  if (editGradeMode) {
    editGradeMode.value = task.isBonus ? 'bonus' : 'syllabus';
  }
  const editBonusScoreInput = document.getElementById('edit-bonus-score') as HTMLInputElement | null;
  if (editBonusScoreInput) {
    editBonusScoreInput.value = task.isBonus && task.submissionStatus === 'graded' && typeof task.score === 'number'
      ? String(task.score)
      : '';
  }
  syncBonusFormUi('edit', editCourseInput.value, task.bonusTarget, task.bonusUnit || 'points');

  registerOverlayCloseHandler('modal-edit-task', closeEditModal);
  openModalEl('modal-edit-task', modalEditTask);
  popupActions.rememberDraft();
}

export function closeEditModal() {
  closeModalEl('modal-edit-task', dom.modalEditTask());
  popupState.editingTaskId = null;
  popupActions.rememberDraft();
}
