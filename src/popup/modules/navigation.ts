import { DeadlineTask, TaskPriority, TaskStatus, TaskType } from '../../types';
import { findCourseSchedule, resolveTaskRoom, resolveTaskTimeWithSchedule } from '../../core/courseSchedule';
import { formatTaskWeightDisplay, resolveTaskWeight } from '../../core/syllabusWeights';
import { compareTasksByTime, downloadIcsFile } from '../../utils/calendar';
import { deduplicateTaskList } from '../../utils/taskMerge';
import { addTask, getTasks, saveTasksMergingLatest } from '../../utils/storage';
import { removeLocalTombstone, recordLocalTombstone } from '../../utils/tombstones';
import { escapeHtml, getSvgIcon } from '../../utils/uiCommon';
import { attachCoursePicker } from '../coursePicker';
import { applyFields, clearDraft, collectFields, loadDraft, saveDraft } from '../popupDraft';
import { parsePickedCourse, syncBonusFormUi } from './readingModal';
import { isOverlayOpen } from './overlayController';
import { AppView, dom, popupActions, popupState } from './state';

function currentSettingsPage(): string {
  return document.querySelector<HTMLElement>('.settings-nav-tab.active')?.dataset.settingsPage || 'general';
}

export function rememberDraft() {
  if (!popupState.draftReady) return;
  const modalEditTask = dom.modalEditTask();
  if ((isOverlayOpen('modal-edit-task') || modalEditTask.style.display === 'flex') && popupState.editingTaskId) {
    saveDraft({ view: 'edit', taskId: popupState.editingTaskId, fields: collectFields(dom.formEditTask()) });
  } else if (dom.viewAdd().classList.contains('active')) {
    saveDraft({ view: 'add', fields: collectFields(dom.formAddTask()) });
  } else if (dom.viewSettings().classList.contains('active')) {
    saveDraft({ view: 'settings', settingsPage: currentSettingsPage() });
  } else if (dom.viewMarks().classList.contains('active')) {
    saveDraft({ view: 'marks' });
  } else if (dom.viewCourses().classList.contains('active')) {
    saveDraft({ view: 'courses' });
  } else if (dom.viewPayments()?.classList.contains('active')) {
    saveDraft({ view: 'payments' });
  } else {
    clearDraft();
  }
}

/** Reopens what was being done when the popup closed: adding or editing a deadline, or a settings page. */
export async function restoreDraft() {
  try {
    const d = await loadDraft();
    if (!d) return;
    if (d.view === 'add') {
      switchView('add');
      applyFields(d.fields);
      popupActions.updateAddRoomVisibility();
    } else if (d.view === 'edit') {
      const task = popupState.currentTasks.find(t => t.id === d.taskId) ||
        (await getTasks().catch(() => [] as DeadlineTask[])).find(t => t.id === d.taskId);
      if (!task) return;
      popupActions.openEditModal(task);
      applyFields(d.fields);
      popupActions.updateEditRoomVisibility();
    } else if (d.view === 'settings') {
      switchView('settings');
      showSettingsPage(d.settingsPage || 'general');
    } else if (d.view === 'marks') {
      switchView('marks');
    } else if (d.view === 'courses') {
      switchView('courses');
    } else if (d.view === 'payments') {
      switchView('payments');
    }
  } finally {
    popupState.draftReady = true;
    rememberDraft();
  }
}

export function switchView(view: AppView) {
  popupActions.closeDayExpandedDrawer();

  dom.viewCalendar().classList.remove('active');
  dom.viewDetails().classList.remove('active');
  dom.viewMarks().classList.remove('active');
  dom.viewCourses().classList.remove('active');
  dom.viewPayments()?.classList.remove('active');
  dom.viewAdd().classList.remove('active');
  dom.viewSettings().classList.remove('active');

  dom.tabNavCalendar().classList.remove('active');
  dom.tabNavDetails().classList.remove('active');
  dom.tabNavMarks().classList.remove('active');
  dom.tabNavCourses().classList.remove('active');

  popupState.currentActiveView = view;

  if (view === 'calendar') {
    dom.viewCalendar().classList.add('active');
    dom.tabNavCalendar().classList.add('active');
    if (popupState.dirtyViews.has('calendar')) {
      popupActions.renderCalendar();
      popupActions.renderSelectedDay();
      popupState.dirtyViews.delete('calendar');
    }
    requestAnimationFrame(popupActions.updateLegendScrollArrows);
  } else if (view === 'details') {
    dom.viewDetails().classList.add('active');
    dom.tabNavDetails().classList.add('active');
    if (popupState.dirtyViews.has('details')) {
      popupActions.renderTasks();
      popupState.dirtyViews.delete('details');
    }
  } else if (view === 'marks') {
    dom.viewMarks().classList.add('active');
    dom.tabNavMarks().classList.add('active');
    if (popupState.dirtyViews.has('marks')) {
      popupActions.renderGradeTracker(popupState.currentTasks);
      popupState.dirtyViews.delete('marks');
    }
  } else if (view === 'courses') {
    dom.viewCourses().classList.add('active');
    dom.tabNavCourses().classList.add('active');
    if (popupState.dirtyViews.has('courses')) {
      popupActions.renderUserCoursesManager();
      popupState.dirtyViews.delete('courses');
    }
  } else if (view === 'payments') {
    dom.viewPayments()?.classList.add('active');
    popupActions.renderPaymentsView();
    popupState.dirtyViews.delete('payments');
  } else if (view === 'add') {
    dom.viewAdd().classList.add('active');
    popupActions.updateAddRoomVisibility();
    const addCourseEl = document.getElementById('add-course') as HTMLInputElement | null;
    syncBonusFormUi('add', addCourseEl?.value || '');
  } else if (view === 'settings') {
    dom.viewSettings().classList.add('active');
    popupActions.loadSettingsForm();
    popupActions.renderUserCoursesManager();
    popupActions.renderQuickLinksManager();
    popupState.dirtyViews.delete('settings');
  }
  rememberDraft();
}

export function showSettingsPage(page: string, focusTab = false) {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.settings-nav-tab');
  tabs.forEach(tab => {
    const isActive = tab.dataset.settingsPage === page;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
    if (isActive && focusTab) tab.focus();
  });
  document.querySelectorAll<HTMLElement>('.settings-page').forEach(panel => {
    panel.hidden = panel.id !== `settings-page-${page}`;
  });
  rememberDraft();
  const nav = document.querySelector<HTMLElement>('.settings-nav');
  if (nav) {
    requestAnimationFrame(() => {
      if (nav.getBoundingClientRect().top < 0) nav.scrollIntoView({ block: 'start' });
    });
  }
}

export function initSettingsNav() {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-nav-tab'));
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => showSettingsPage(tab.dataset.settingsPage || 'general'));
    tab.addEventListener('keydown', (e: KeyboardEvent) => {
      let next = -1;
      if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      if (next < 0) return;
      e.preventDefault();
      showSettingsPage(tabs[next].dataset.settingsPage || 'general', true);
    });
  });
}

export function setupNavigationAndTaskEvents() {
  dom.tabNavCalendar().addEventListener('click', () => switchView('calendar'));
  dom.tabNavDetails().addEventListener('click', () => switchView('details'));
  dom.tabNavMarks().addEventListener('click', () => switchView('marks'));
  dom.tabNavCourses().addEventListener('click', () => switchView('courses'));

  dom.btnAddModal().addEventListener('click', () => {
    (document.getElementById('add-date') as HTMLInputElement).value = popupState.selectedDateStr;
    switchView('add');
  });
  dom.btnSettingsToggle().addEventListener('click', () => switchView('settings'));
  dom.btnCancelAdd().addEventListener('click', () => switchView('calendar'));
  dom.btnCancelSettings().addEventListener('click', () => switchView('calendar'));
  initSettingsNav();

  dom.btnExportAllIcs().addEventListener('click', () => {
    const activeTasks = popupState.currentTasks.filter(t => t.status === 'pending');
    if (activeTasks.length === 0) {
      alert('No active deadlines to export.');
      return;
    }
    downloadIcsFile(activeTasks, 'uos_blackboard_deadlines.ics');
  });

  const addTypeSelect = document.getElementById('add-type') as HTMLSelectElement;
  const addRoomInput = document.getElementById('add-room') as HTMLInputElement;
  const addWeightInput = document.getElementById('add-weight') as HTMLInputElement;
  const addWeightHint = document.getElementById('add-weight-hint') as HTMLElement;
  const btnCalcAddWeight = document.getElementById('btn-calc-add-weight') as HTMLButtonElement;

  const editTitleInput = document.getElementById('edit-title') as HTMLInputElement;
  const editCourseInput = document.getElementById('edit-course') as HTMLInputElement;
  const editDateInput = document.getElementById('edit-date') as HTMLInputElement;
  const editTimeInput = document.getElementById('edit-time') as HTMLInputElement;
  const editRoomInput = document.getElementById('edit-room') as HTMLInputElement;
  const editTypeSelect = document.getElementById('edit-type') as HTMLSelectElement;
  const editPrioritySelect = document.getElementById('edit-priority') as HTMLSelectElement;
  const editStatusSelect = document.getElementById('edit-status') as HTMLSelectElement;
  const editDescInput = (document.getElementById('edit-desc') || document.getElementById('edit-description')) as HTMLTextAreaElement;
  const editNotesInput = document.getElementById('edit-notes') as HTMLTextAreaElement;
  const editWeightInput = document.getElementById('edit-weight') as HTMLInputElement;
  const editWeightHint = document.getElementById('edit-weight-hint') as HTMLElement;
  const btnCalcEditWeight = document.getElementById('btn-calc-edit-weight') as HTMLButtonElement;

  const addGradeMode = document.getElementById('add-grade-mode') as HTMLSelectElement | null;
  const addBonusEarned = document.getElementById('add-bonus-earned') as HTMLInputElement | null;
  const editGradeMode = document.getElementById('edit-grade-mode') as HTMLSelectElement | null;

  addTypeSelect?.addEventListener('change', popupActions.updateAddRoomVisibility);
  editTypeSelect?.addEventListener('change', popupActions.updateEditRoomVisibility);

  const addCourseInput = document.getElementById('add-course') as HTMLInputElement;
  attachCoursePicker(document.getElementById('add-course') as HTMLInputElement, () => popupState.currentUserCourses);
  attachCoursePicker(editCourseInput, () => popupState.currentUserCourses);

  addGradeMode?.addEventListener('change', () => syncBonusFormUi('add', addCourseInput?.value || ''));
  document.getElementById('add-bonus-unit')?.addEventListener('change', () => syncBonusFormUi('add', addCourseInput?.value || ''));
  addBonusEarned?.addEventListener('change', () => syncBonusFormUi('add', addCourseInput?.value || ''));
  editGradeMode?.addEventListener('change', () => syncBonusFormUi('edit', editCourseInput?.value || ''));
  document.getElementById('edit-bonus-unit')?.addEventListener('change', () => syncBonusFormUi('edit', editCourseInput?.value || ''));
  editStatusSelect?.addEventListener('change', () => syncBonusFormUi('edit', editCourseInput?.value || ''));
  editCourseInput?.addEventListener('input', () => syncBonusFormUi('edit', editCourseInput.value));
  editCourseInput?.addEventListener('change', () => syncBonusFormUi('edit', editCourseInput.value));

  for (const form of [dom.formAddTask(), dom.formEditTask()]) {
    form.addEventListener('input', rememberDraft);
    form.addEventListener('change', rememberDraft);
  }

  addCourseInput?.addEventListener('input', () => {
    syncBonusFormUi('add', addCourseInput.value);
    const sched = findCourseSchedule(addCourseInput.value);
    const timeInput = document.getElementById('add-time') as HTMLInputElement;
    if (sched && timeInput && (!timeInput.value || timeInput.value === '23:59')) {
      const hh = String(sched.startHour).padStart(2, '0');
      const mm = String(sched.startMinute).padStart(2, '0');
      timeInput.value = `${hh}:${mm}`;
    }
    const isHwOrProj = addTypeSelect?.value === 'assignment' || (addTypeSelect?.value as string) === 'hw' || addTypeSelect?.value === 'project';
    if (!isHwOrProj && sched && addRoomInput && !addRoomInput.value) {
      addRoomInput.value = sched.room || '';
    }
  });
  addCourseInput?.addEventListener('change', () => syncBonusFormUi('add', addCourseInput.value));

  dom.formAddTask().addEventListener('submit', async e => {
    e.preventDefault();
    const title = (document.getElementById('add-title') as HTMLInputElement).value;
    const course = (document.getElementById('add-course') as HTMLInputElement).value;
    const dateVal = (document.getElementById('add-date') as HTMLInputElement).value;
    const rawTimeVal = ((document.getElementById('add-time') as HTMLInputElement).value || '').trim();
    const type = (document.getElementById('add-type') as HTMLSelectElement).value as TaskType;
    const priority = (document.getElementById('add-priority') as HTMLSelectElement).value as TaskPriority;
    const notes = (document.getElementById('add-notes') as HTMLTextAreaElement).value;

    const parsedCourse = parsePickedCourse(course);
    const [y, m, d] = dateVal.split('-').map(Number);
    let dueDate: Date;
    let hasSpecificTime: boolean;

    if (rawTimeVal) {
      const [hh, mm] = rawTimeVal.split(':').map(Number);
      dueDate = new Date(y, m - 1, d, hh, mm, 0, 0);
      hasSpecificTime = true;
    } else {
      const defaultDate = new Date(y, m - 1, d, 23, 59, 0, 0);
      const schedRes = resolveTaskTimeWithSchedule({
        dueDate: defaultDate,
        courseNameOrCode: parsedCourse.name || parsedCourse.code,
        hasSpecificTime: false,
        announcementText: notes,
        title
      });
      if (schedRes.appliedSchedule) {
        dueDate = schedRes.dueDate;
        hasSpecificTime = schedRes.hasSpecificTime;
      } else {
        dueDate = defaultDate;
        hasSpecificTime = false;
      }
    }

    const isHwOrProject = type === 'assignment' || (type as string) === 'hw' || type === 'project';
    const manualRoom = (!isHwOrProject && addRoomInput) ? addRoomInput.value.trim() : '';
    const resolvedRoomObj = isHwOrProject ? { room: '', isCustom: false } : resolveTaskRoom({
      courseNameOrCode: parsedCourse.name || parsedCourse.code,
      announcementText: notes,
      title,
      existingRoom: manualRoom,
      type
    });
    const room = (!isHwOrProject && resolvedRoomObj.room) ? resolvedRoomObj.room : undefined;

    const weightVal = addWeightInput ? addWeightInput.value.trim() : '';
    const isBonus = (document.getElementById('add-grade-mode') as HTMLSelectElement)?.value === 'bonus';
    const addBonusUnitSel = document.getElementById('add-bonus-unit') as HTMLSelectElement | null;
    const bonusUnit: 'points' | 'percent' = addBonusUnitSel?.value === 'percent' ? 'percent' : 'points';
    const bonusTargetSel = document.getElementById('add-bonus-target') as HTMLSelectElement | null;
    const bonusEarned = (document.getElementById('add-bonus-earned') as HTMLInputElement)?.checked || false;
    const bonusScoreRaw = (document.getElementById('add-bonus-score') as HTMLInputElement)?.value.trim() || '';
    const parsedBonusScore = bonusScoreRaw ? parseFloat(bonusScoreRaw) : NaN;

    let weight: number | undefined = weightVal ? parseFloat(weightVal) : undefined;
    let weightDisplay: string | undefined = undefined;
    let syllabusNote: string | undefined = undefined;
    let bonusTarget: string | undefined = undefined;
    let bonusTargetLabel: string | undefined = undefined;

    if (isBonus) {
      bonusTarget = bonusTargetSel?.value || 'total';
      const selOpt = bonusTargetSel?.selectedOptions?.[0];
      bonusTargetLabel = selOpt?.dataset.shortLabel || (bonusTarget === 'total' ? 'Course Total' : bonusTarget.replace(/^(?:comp:|compname:|type:)/, ''));
      if ((weight === undefined || isNaN(weight)) && !isNaN(parsedBonusScore)) {
        weight = parsedBonusScore;
      }
      if (weight !== undefined && !isNaN(weight) && weight > 0) {
        weightDisplay = formatTaskWeightDisplay(weight, { isBonus: true, bonusUnit, bonusTarget, bonusTargetLabel });
      }
      syllabusNote = bonusTarget === 'total'
        ? (bonusUnit === 'percent' ? 'Bonus % added to course total' : 'Pure bonus marks added to course total')
        : `Bonus marks applied to ${bonusTargetLabel}`;
    } else if (weight !== undefined && !isNaN(weight)) {
      weightDisplay = `${weight}% of Grade`;
      syllabusNote = addWeightHint ? (addWeightHint.textContent || 'Custom manual weight') : 'Custom manual weight';
    } else {
      const resolved = resolveTaskWeight(parsedCourse.name || parsedCourse.code, title, type, notes);
      if (resolved.weight !== undefined) {
        weight = resolved.weight;
        weightDisplay = resolved.weightDisplay;
        syllabusNote = resolved.syllabusNote;
      }
    }

    const bonusGraded = isBonus && bonusEarned;
    const bonusScoreVal = bonusGraded ? (!isNaN(parsedBonusScore) ? parsedBonusScore : (weight || 0)) : undefined;

    const newTask: DeadlineTask = {
      id: `task_manual_${Date.now()}`,
      courseCode: parsedCourse.code,
      courseName: parsedCourse.name,
      title,
      room,
      description: notes,
      dueDate: dueDate.toISOString(),
      hasSpecificTime,
      type,
      priority,
      status: bonusGraded ? 'completed' : 'pending',
      submissionStatus: bonusGraded ? 'graded' : undefined,
      score: bonusGraded ? bonusScoreVal : undefined,
      maxScore: bonusGraded ? (weight || bonusScoreVal || 0) : undefined,
      isBonus: isBonus || undefined,
      bonusUnit: isBonus ? bonusUnit : undefined,
      bonusTarget: isBonus ? bonusTarget : undefined,
      bonusTargetLabel: isBonus ? bonusTargetLabel : undefined,
      sourceSnippet: notes,
      notes,
      confidence: 1.0,
      extractedBy: 'manual',
      userEdited: true,
      weight,
      weightDisplay,
      syllabusNote,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    popupState.currentTasks = deduplicateTaskList(await addTask(newTask));
    popupState.currentTasks.sort(compareTasksByTime);
    popupState.currentTasks = await saveTasksMergingLatest(popupState.currentTasks);

    dom.formAddTask().reset();
    if (addRoomInput) addRoomInput.value = '';
    if (addWeightInput) addWeightInput.value = '';
    if (addWeightHint) addWeightHint.textContent = '';
    syncBonusFormUi('add', '');
    popupState.selectedDateStr = dateVal;
    popupActions.refreshAllViews();
    switchView('calendar');
    popupActions.syncTasksToCloud(popupState.currentTasks, 'Added Deadline');
  });

  btnCalcAddWeight?.addEventListener('click', () => {
    const title = (document.getElementById('add-title') as HTMLInputElement).value;
    const course = (document.getElementById('add-course') as HTMLInputElement).value;
    const type = (document.getElementById('add-type') as HTMLSelectElement).value as TaskType;
    const notes = (document.getElementById('add-notes') as HTMLTextAreaElement).value;
    const resolved = resolveTaskWeight(course, title, type, notes);
    if (resolved.weight !== undefined) {
      addWeightInput.value = String(resolved.weight);
      addWeightHint.innerHTML = `${getSvgIcon('scale', 'mr-1')} <b>${escapeHtml(resolved.weightDisplay || '')}</b>: ${escapeHtml(resolved.syllabusNote || '')}`;
      addWeightHint.style.color = 'var(--text-main)';
    } else {
      addWeightHint.innerHTML = `${getSvgIcon('info', 'mr-1')} <span>Course or weight not found in syllabus database.</span>`;
      addWeightHint.style.color = '#718096';
    }
  });

  dom.formEditTask().addEventListener('submit', async e => {
    e.preventDefault();
    if (!popupState.editingTaskId) return;

    const title = editTitleInput.value;
    const course = editCourseInput.value;
    const dateVal = editDateInput.value;
    const rawTimeVal = editTimeInput.value ? editTimeInput.value.trim() : '';
    const type = editTypeSelect.value as TaskType;
    const priority = editPrioritySelect.value as TaskPriority;
    const status = editStatusSelect.value as TaskStatus;
    const descVal = editDescInput ? editDescInput.value.trim() : '';
    const notesVal = editNotesInput ? editNotesInput.value.trim() : '';

    const parsedCourse = parsePickedCourse(course);
    const [y, m, d] = dateVal.split('-').map(Number);
    let dueDate: Date;
    let hasSpecificTime: boolean;

    if (rawTimeVal) {
      const [hh, mm] = rawTimeVal.split(':').map(Number);
      dueDate = new Date(y, m - 1, d, hh, mm, 0, 0);
      hasSpecificTime = true;
    } else {
      const defaultDate = new Date(y, m - 1, d, 23, 59, 0, 0);
      const schedRes = resolveTaskTimeWithSchedule({
        dueDate: defaultDate,
        courseNameOrCode: parsedCourse.name || parsedCourse.code,
        hasSpecificTime: false,
        announcementText: `${descVal} ${notesVal}`,
        title
      });
      if (schedRes.appliedSchedule) {
        dueDate = schedRes.dueDate;
        hasSpecificTime = schedRes.hasSpecificTime;
      } else {
        dueDate = defaultDate;
        hasSpecificTime = false;
      }
    }

    const isHwOrProject = type === 'assignment' || (type as string) === 'hw' || type === 'project';
    const roomVal = (!isHwOrProject && editRoomInput) ? editRoomInput.value.trim() : '';
    const room = (!isHwOrProject && roomVal) ? roomVal : undefined;

    const targetId = popupState.editingTaskId;
    const existingTask = popupState.currentTasks.find(t => t.id === targetId);
    const weightVal = editWeightInput ? editWeightInput.value.trim() : '';
    const isBonus = (document.getElementById('edit-grade-mode') as HTMLSelectElement)?.value === 'bonus';
    const editBonusUnitSel = document.getElementById('edit-bonus-unit') as HTMLSelectElement | null;
    const bonusUnit: 'points' | 'percent' = editBonusUnitSel?.value === 'percent' ? 'percent' : 'points';
    const editBonusTargetSel = document.getElementById('edit-bonus-target') as HTMLSelectElement | null;
    const editBonusScoreRaw = (document.getElementById('edit-bonus-score') as HTMLInputElement)?.value.trim() || '';
    const parsedBonusScore = editBonusScoreRaw ? parseFloat(editBonusScoreRaw) : NaN;

    let weight: number | undefined = weightVal ? parseFloat(weightVal) : undefined;
    let weightDisplay: string | undefined = undefined;
    let syllabusNote: string | undefined = undefined;
    let bonusTarget: string | undefined = undefined;
    let bonusTargetLabel: string | undefined = undefined;

    if (isBonus) {
      bonusTarget = editBonusTargetSel?.value || 'total';
      const selOpt = editBonusTargetSel?.selectedOptions?.[0];
      bonusTargetLabel = selOpt?.dataset.shortLabel || (bonusTarget === 'total' ? 'Course Total' : bonusTarget.replace(/^(?:comp:|compname:|type:)/, ''));
      if ((weight === undefined || isNaN(weight)) && !isNaN(parsedBonusScore)) {
        weight = parsedBonusScore;
      }
      if (weight !== undefined && !isNaN(weight) && weight > 0) {
        weightDisplay = formatTaskWeightDisplay(weight, { isBonus: true, bonusUnit, bonusTarget, bonusTargetLabel });
      }
      syllabusNote = bonusTarget === 'total'
        ? (bonusUnit === 'percent' ? 'Bonus % added to course total' : 'Pure bonus marks added to course total')
        : `Bonus marks applied to ${bonusTargetLabel}`;
    } else if (weight !== undefined && !isNaN(weight)) {
      weightDisplay = `${weight}% of Grade`;
      syllabusNote = editWeightHint ? (editWeightHint.textContent || 'Custom manual weight') : 'Custom manual weight';
    } else {
      const resolved = resolveTaskWeight(parsedCourse.name || parsedCourse.code, title, type, `${descVal} ${notesVal}`);
      if (resolved.weight !== undefined) {
        weight = resolved.weight;
        weightDisplay = resolved.weightDisplay;
        syllabusNote = resolved.syllabusNote;
      }
    }

    const bonusGraded = isBonus && status === 'completed';
    const keepRegularGrade = !isBonus && existingTask && !existingTask.isBonus && status === 'completed' && existingTask.submissionStatus === 'graded';
    const bonusScoreVal = bonusGraded
      ? (!isNaN(parsedBonusScore) ? parsedBonusScore : (weight || existingTask?.score || 0))
      : undefined;

    const updatedTaskFields: Partial<DeadlineTask> = {
      title,
      courseName: parsedCourse.name,
      courseCode: parsedCourse.code,
      dueDate: dueDate.toISOString(),
      hasSpecificTime,
      room,
      type,
      priority,
      status,
      submissionStatus: bonusGraded ? 'graded' : (keepRegularGrade ? existingTask?.submissionStatus : undefined),
      score: bonusGraded ? bonusScoreVal : (keepRegularGrade ? existingTask?.score : undefined),
      maxScore: bonusGraded ? (weight || existingTask?.maxScore || bonusScoreVal || 0) : (keepRegularGrade ? existingTask?.maxScore : undefined),
      isBonus: isBonus || undefined,
      bonusUnit: isBonus ? bonusUnit : undefined,
      bonusTarget: isBonus ? bonusTarget : undefined,
      bonusTargetLabel: isBonus ? bonusTargetLabel : undefined,
      description: descVal,
      sourceSnippet: descVal,
      notes: notesVal,
      weight,
      weightDisplay,
      syllabusNote,
      userEdited: true,
      updatedAt: new Date().toISOString()
    };

    popupState.currentTasks = popupState.currentTasks.map(t => (t.id === targetId ? { ...t, ...updatedTaskFields } : t));
    popupState.currentTasks.sort(compareTasksByTime);

    popupActions.persistTasksInBackground(popupState.currentTasks);

    popupActions.closeEditModal();
    popupState.selectedDateStr = dateVal;
    popupActions.refreshAllViews();

    const dayExpandedDrawer = dom.dayExpandedDrawer();
    if (dayExpandedDrawer && dayExpandedDrawer.classList.contains('open')) {
      popupActions.openDayExpandedDrawer(dateVal);
    }

    popupActions.syncTasksToCloud(popupState.currentTasks, 'Edited Deadline');
  });

  btnCalcEditWeight?.addEventListener('click', () => {
    const title = editTitleInput.value;
    const course = editCourseInput.value;
    const type = editTypeSelect.value as TaskType;
    const desc = editDescInput ? editDescInput.value : '';
    const notes = editNotesInput.value;
    const resolved = resolveTaskWeight(course, title, type, `${desc} ${notes}`);
    if (resolved.weight !== undefined) {
      editWeightInput.value = String(resolved.weight);
      editWeightHint.innerHTML = `${getSvgIcon('scale', 'mr-1')} <b>${escapeHtml(resolved.weightDisplay || '')}</b>: ${escapeHtml(resolved.syllabusNote || '')}`;
      editWeightHint.style.color = 'var(--text-main)';
    } else {
      editWeightHint.innerHTML = `${getSvgIcon('info', 'mr-1')} <span>Course or weight not found in syllabus database.</span>`;
      editWeightHint.style.color = '#718096';
    }
  });

  document.getElementById('btn-delete-from-modal')?.addEventListener('click', async () => {
    if (!popupState.editingTaskId) return;
    const taskToDelete = popupState.currentTasks.find(t => t.id === popupState.editingTaskId);
    if (!taskToDelete) return;

    recordLocalTombstone(popupState.editingTaskId);
    popupState.currentTasks = popupActions.removeTaskLocal(popupState.editingTaskId);
    popupActions.closeEditModal();
    popupActions.refreshAllViews();
    popupActions.syncTasksToCloud(popupState.currentTasks, 'Deleted Deadline');

    popupActions.showToast(
      `Deleted "${taskToDelete.title.slice(0, 22)}..."`,
      'Undo',
      async () => {
        await removeLocalTombstone(taskToDelete.id);
        popupState.currentTasks = await addTask({ ...taskToDelete, updatedAt: new Date().toISOString() });
        popupActions.refreshAllViews();
        popupActions.syncTasksToCloud(popupState.currentTasks, 'Restored Deadline');
        popupActions.showToast('Deadline restored');
      }
    );
  });

  document.getElementById('btn-close-edit-modal')?.addEventListener('click', popupActions.closeEditModal);
  document.getElementById('btn-cancel-edit')?.addEventListener('click', popupActions.closeEditModal);
  dom.modalEditTask().addEventListener('click', e => {
    if (e.target === dom.modalEditTask()) popupActions.closeEditModal();
  });
}
