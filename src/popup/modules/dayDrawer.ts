import type { DeadlineTask } from '../../types';
import { localizedTaskView } from '../../core/arabicTranslator';
import { localizeTaskTypeLabel } from '../../core/i18n';
import { classesOnDay, todaysClassesHtml } from '../../core/classSchedule';
import { getCourseColorTheme, getCourseHex } from '../../core/courseColors';
import { profileGradeScale } from '../../core/studentProfile';
import { getAllSyllabi } from '../../core/syllabusWeights';
import { calculateTrajectoryTargetPlan, type TrajectoryTargetPlan } from '../../core/targetGpa';
import { buildGpaSummary } from '../../utils/marks/gpa';
import { compareTasksByTime, formatCountdown, formatTaskTime } from '../../utils/tasks/calendar';
import { getCachedSettingsSync } from '../../utils/storage/index';
import { matchesSelectedCourseFilter, resolveCourseInfo } from '../../core/courseHelper';
import { escapeHtml, getSvgIcon, getTaskTypeIcon } from '../../utils/ui/uiCommon';
import { getCachedProfile } from '../universitySettings';
import { isCalendarDeadline } from './calendarView';
import { closeDayDrawerShell, openDayDrawerShell, registerOverlayCloseHandler } from './overlayController';
import { getCombinedCalendarTasks } from './paymentsView';
import { openConfiguredBlackboard } from './settingsWalkthrough';
import { dom, formatDateKey, popupActions, popupState } from './state';
import {
  renderSummaryAndNotesForExt,
  renderUnifiedActionsForExt,
  wireUnifiedTaskActions
} from './taskActions';

export function selectDay(dateKey: string, openDrawer: boolean = true) {
  popupState.selectedDateStr = dateKey;
  document.querySelectorAll('.cal-day.is-selected').forEach(el => el.classList.remove('is-selected'));
  const activeEl = document.querySelector(`.cal-day[data-date="${dateKey}"]`);
  if (activeEl) {
    activeEl.classList.add('is-selected');
  }

  renderSelectedDay();

  if (openDrawer) {
    openDayExpandedDrawer(dateKey);
  }
}

export function openDayExpandedDrawer(dateKey: string) {
  const dayExpandedDrawer = dom.dayExpandedDrawer();
  const dayExpandedBackdrop = dom.dayExpandedBackdrop();
  const dayDrawerTitle = dom.dayDrawerTitle();
  const dayDrawerSubtitle = dom.dayDrawerSubtitle();
  const dayDrawerBody = dom.dayDrawerBody();
  if (!dayExpandedDrawer || !dayExpandedBackdrop) return;

  const lang = popupState.currentLanguage;
  const isAr = lang === 'ar';
  const [y, m, d] = dateKey.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const formattedDate = dateObj.toLocaleDateString(isAr ? 'ar-AE' : undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const tasksOnDate = getCombinedCalendarTasks().filter(task => {
    if (!matchesSelectedCourseFilter(task, popupState.selectedCourseFilter)) return false;
    if (!isCalendarDeadline(task)) return false;
    const taskD = new Date(task.dueDate);
    return !isNaN(taskD.getTime()) && formatDateKey(taskD) === dateKey;
  });
  tasksOnDate.sort(compareTasksByTime);

  dayDrawerTitle.innerHTML = `${getSvgIcon('calendar', 'mr-1')} <span>${escapeHtml(formattedDate)}</span>`;
  dayDrawerSubtitle.textContent = isAr
    ? `${tasksOnDate.length} مواعيد مجدولة`
    : (tasksOnDate.length === 1 ? '1 Deadline Scheduled' : `${tasksOnDate.length} Deadlines Scheduled`);

  const classesBox = document.getElementById('day-expanded-classes');
  const showClasses = getCachedSettingsSync().showClassesInCalendar !== false;
  if (classesBox) {
    classesBox.hidden = !showClasses;
    if (!showClasses) {
      classesBox.innerHTML = '';
      classesBox.style.display = 'none';
    } else {
      const now = new Date();
      const classes = classesOnDay(popupState.currentUserCourses, dateObj)
        .filter(o => matchesSelectedCourseFilter({ courseName: o.courseName, courseCode: o.courseCode } as DeadlineTask, popupState.selectedCourseFilter));
      const hasSchedule = popupState.currentUserCourses.some(c => (c.scheduleSlots || []).length > 0);
      classesBox.style.display = '';
      classesBox.innerHTML = `<div class="selected-day-classes-title">${isAr ? 'المحاضرات' : 'Classes'}</div>` + todaysClassesHtml(classes, now, o => o.colorHex || getCourseHex(o.courseName), {
        isToday: formatDateKey(now) === dateKey,
        hasSchedule,
        lang,
      });
    }
  }

  dayDrawerBody.innerHTML = '';

  if (tasksOnDate.length === 0) {
    dayDrawerBody.innerHTML = `
      <div class="day-drawer-empty">
        <div class="empty-icon">${getSvgIcon('coffee')}</div>
        <div class="empty-text">${isAr ? 'لا توجد مواعيد مجدولة لهذا اليوم.' : 'No deadlines scheduled for this day.'}</div>
        <button type="button" class="btn-drawer-add-action" id="btn-drawer-add-empty">
          ${getSvgIcon('plus', 'mr-1')}
          <span>${isAr ? 'إضافة موعد لهذا اليوم' : 'Add Deadline for this Date'}</span>
        </button>
      </div>
    `;
    document.getElementById('btn-drawer-add-empty')?.addEventListener('click', () => {
      closeDayExpandedDrawer();
      popupActions.openAddModalOnDate(dateKey);
    });
  } else {
    tasksOnDate.forEach(task => {
      const card = createDaySummaryCard(task);
      dayDrawerBody.appendChild(card);
    });
  }

  registerOverlayCloseHandler('day-expanded-drawer', closeDayExpandedDrawer);
  openDayDrawerShell();
}

export function closeDayExpandedDrawer() {
  closeDayDrawerShell();
}

export function renderDoctorQuoteHtml(
  task: DeadlineTask,
  _courseName?: string,
  _courseCode?: string,
  _idPrefix: string = 'quote-body-'
): string {
  return renderSummaryAndNotesForExt(task, { variant: 'card', includeFullViewBtn: true });
}

let cachedTrajectorySig = '';
let cachedTrajectoryResult: { plan: TrajectoryTargetPlan | null; targetGpa: number } = { plan: null, targetGpa: 3.75 };

export function getCurrentTrajectoryPlan(): { plan: TrajectoryTargetPlan | null; targetGpa: number } {
  const profile = getCachedProfile();
  const tasks = popupState.currentTasks;
  const courses = popupState.currentUserCourses;
  const sig = [
    profile?.universityId || '',
    profile?.studyLevel || '',
    profile?.targetTermGpa ?? '',
    courses.length,
    ...courses.map(c => `${c.id}:${c.creditHours ?? ''}:${(c.syllabus || []).map(s => `${s.id}:${s.totalWeight}:${s.count ?? ''}`).join(',')}`),
    tasks.length,
    ...tasks.map(t => `${t.id}:${t.status}:${t.score ?? ''}:${t.maxScore ?? ''}:${t.weight ?? ''}:${t.ignoreMark ? 1 : 0}`)
  ].join('|');

  if (sig === cachedTrajectorySig) {
    return cachedTrajectoryResult;
  }

  const scale = profileGradeScale(profile);
  const syllabi = getAllSyllabi();
  const gpa = buildGpaSummary(tasks, syllabi, scale);
  const targetGpa = (typeof profile?.targetTermGpa === 'number' && profile.targetTermGpa > 0)
    ? profile.targetTermGpa
    : (gpa.gpa !== undefined ? Math.min(4.0, Math.round((Math.max(2.0, gpa.gpa) + 0.25) * 20) / 20) : 3.75);
  const plan = calculateTrajectoryTargetPlan(gpa, targetGpa, tasks, scale);
  cachedTrajectorySig = sig;
  cachedTrajectoryResult = { plan, targetGpa };
  return cachedTrajectoryResult;
}

export function getTaskTargetBadgeHtml(
  task: DeadlineTask,
  trajectoryPlan: TrajectoryTargetPlan | null,
  targetGpa: number
): string {
  if (!task || task.status === 'completed' || !trajectoryPlan?.taskTargetMap) return '';
  const taskTarget = trajectoryPlan.taskTargetMap[task.id];
  if (!taskTarget) return '';

  const isAr = popupState.currentLanguage === 'ar';
  const pct = taskTarget.requiredPercent;
  let text = '';
  if (pct <= 0) {
    text = isAr ? `المستهدف: مضمون (${escapeHtml(taskTarget.targetLetter)})` : `Target: Secured (${escapeHtml(taskTarget.targetLetter)})`;
  } else if (pct > 100) {
    text = isAr ? `المستهدف: >100% (${escapeHtml(taskTarget.targetLetter)})` : `Target: >100% (${escapeHtml(taskTarget.targetLetter)})`;
  } else {
    text = isAr ? `المستهدف: ${pct.toFixed(1)}% (${escapeHtml(taskTarget.targetLetter)})` : `Target: ${pct.toFixed(1)}% (${escapeHtml(taskTarget.targetLetter)})`;
  }

  const tooltip = isAr
    ? `الدرجة المطلوبة: ${pct.toFixed(1)}% (${taskTarget.targetScore}/${taskTarget.maxScore}) لتحقيق تقدير ${escapeHtml(taskTarget.targetLetter)} ومعدل ${targetGpa.toFixed(2)}`
    : `Target required score: ${pct.toFixed(1)}% (${taskTarget.targetScore}/${taskTarget.maxScore} pts) for ${escapeHtml(taskTarget.targetLetter)} grade to achieve ${targetGpa.toFixed(2)} GPA`;

  return `<span class="task-target-pill" title="${tooltip}">${getSvgIcon('star', 'mr-1')}<span>${text}</span></span>`;
}

export function createDaySummaryCard(task: DeadlineTask): HTMLDivElement {
  const lang = popupState.currentLanguage;
  const isAr = lang === 'ar';
  const isCompleted = task.status === 'completed';
  const isPayment = Boolean(task.isPayment);
  const resolved = resolveCourseInfo(task);
  const view = localizedTaskView({ ...task, courseName: resolved.courseName }, lang);
  const courseHex = isPayment ? 'var(--accent)' : getCourseHex(resolved.courseName, resolved.courseCode, task.title);
  const courseTheme = getCourseColorTheme(resolved.courseName, resolved.courseCode, task.title);
  const countdown = formatCountdown(task.dueDate, task.hasSpecificTime, task.status, lang);
  const timeDisplay = formatTaskTime(task, lang);

  const isHwOrProject = task.type === 'assignment' || (task.type as string) === 'hw' || task.type === 'project';
  const { plan: trajectoryPlan, targetGpa } = getCurrentTrajectoryPlan();
  const targetBadgeHtml = isPayment ? '' : getTaskTargetBadgeHtml(task, trajectoryPlan, targetGpa);

  const card = document.createElement('div');
  card.className = `day-summary-card ${isCompleted ? 'is-completed' : ''} ${isPayment ? 'is-payment-item' : ''}`;
  card.setAttribute('data-id', task.id);
  card.style.borderLeft = `4px solid ${courseHex}`;
  card.style.setProperty('border-left-color', courseHex, 'important');

  card.innerHTML = `
    <div class="day-card-header">
      <span class="day-card-course-badge" style="background: ${courseTheme.bgLight}; color: ${courseTheme.textDark}; border: 1px solid ${courseTheme.border};" title="${escapeHtml(view.courseName)} ${resolved.courseCode ? `(${escapeHtml(resolved.courseCode)})` : ''}">
        <span class="day-card-course-dot" style="background-color: ${courseHex};"></span>
        <span class="day-card-course-name">${escapeHtml(view.courseName)}</span>
      </span>
      <div style="display: flex; align-items: center; gap: 5px;">
        <span class="type-pill type-${escapeHtml(task.type)}" style="font-size: 9px; padding: 1px 5px; display: inline-flex; align-items: center; gap: 3px;">
          ${isPayment ? getSvgIcon('credit-card') : getTaskTypeIcon(task.type)}
          <span>${isPayment ? (isAr ? 'رسوم' : 'PAYMENT') : localizeTaskTypeLabel(task.type, lang, true)}</span>
        </span>
        <span class="day-card-status-badge ${isCompleted ? 'status-done' : countdown.urgency}">
          ${isCompleted ? `${getSvgIcon('check', 'mr-1')} ${isAr ? 'مكتمل' : 'Completed'}` : countdown.label}
        </span>
      </div>
    </div>

    <div class="day-card-title-row">
      <div class="day-card-title ${isCompleted ? 'title-completed' : ''}">
        ${escapeHtml(view.title)}
      </div>
    </div>

    <div class="day-card-meta-row">
      <div class="day-card-time" title="Scheduled / Due Time">
        ${getSvgIcon('clock', 'mr-1')} <span class="day-card-time-text">${escapeHtml(timeDisplay)}</span>
      </div>
      ${(isPayment && task.paymentAmountText) ? `<span class="payment-task-pill">${escapeHtml(task.paymentAmountText)}</span>` : ''}
      ${(!isHwOrProject && view.room) ? `
        <div class="day-card-room" title="Classroom / Exam Hall" style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: #4338ca; background: #e0e7ff; padding: 2px 7px; border-radius: 4px; border: 1px solid #c7d2fe;">
          ${getSvgIcon('pin', 'mr-1')} <span class="day-card-room-text">${escapeHtml(view.room)}</span>
        </div>
      ` : ''}
      ${view.weightDisplay ? `
        <div class="day-card-weight" title="${task.syllabusNote ? escapeHtml(task.syllabusNote) : 'Syllabus grade weight'}">
          ${getSvgIcon('scale', 'mr-1')} <span class="day-card-weight-text">${escapeHtml(view.weightDisplay)}</span>
        </div>
      ` : ''}
      ${targetBadgeHtml}
      ${(task.submissionStatus === 'graded' || (typeof task.score === 'number' && !isNaN(task.score))) ? `
        <div class="task-grade-pill" title="Grade / Score released on Blackboard">
          ${getSvgIcon('star', 'mr-1')} <span>${escapeHtml(task.scoreDisplay || (task.maxScore ? `${task.score} / ${task.maxScore}` : (task.score !== undefined ? `${task.score} pts` : (isAr ? 'مُقيّم' : 'Graded'))))}</span>
        </div>
      ` : ''}
      ${task.submissionStatus === 'submitted' ? `
        <div class="task-submitted-pill" title="${task.submissionReceipt ? `Receipt: ${escapeHtml(task.submissionReceipt)}` : 'Submitted to Blackboard'}">
          ${getSvgIcon('check', 'mr-1')} <span>${isAr ? 'تم التسليم' : 'Submitted'}</span>
        </div>
      ` : ''}
    </div>

    ${renderSummaryAndNotesForExt(task, { variant: 'card', includeFullViewBtn: true })}

    ${task.notes ? `
      <div class="day-card-student-notes" style="margin-top: 6px; padding: 6px 10px; background: var(--surface-hover); border-left: 3px solid var(--text-main); border-radius: 0;">
        <span style="font-size: 10px; font-weight: 700; color: var(--text-main); display: inline-flex; align-items: center; gap: 4px;">
          ${getSvgIcon('pencil')}
          <span>${isAr ? 'ملاحظات الطالب:' : 'Student Notes:'}</span>
        </span>
        <div style="font-size: 11px; color: var(--text-main); margin-top: 2px; white-space: pre-wrap;">${escapeHtml(task.notes)}</div>
      </div>
    ` : ''}

    <div class="day-card-actions">
      ${renderUnifiedActionsForExt(task, { variant: 'card' })}
    </div>
  `;

  wireUnifiedTaskActions(card, task);

  return card;
}

export function renderSelectedDay() {
  const lang = popupState.currentLanguage;
  const isAr = lang === 'ar';
  const selectedDayTitle = dom.selectedDayTitle();
  const selectedDayList = dom.selectedDayList();
  const [y, m, d] = popupState.selectedDateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const formattedHeader = dateObj.toLocaleDateString(isAr ? 'ar-AE' : undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const filterLabel = popupState.selectedCourseFilter
    ? ` <span style="font-weight: 500; font-size: 11px; color: var(--text-muted);">&bull; ${escapeHtml(popupState.selectedCourseFilter)}</span>`
    : '';
  selectedDayTitle.innerHTML = `${getSvgIcon('calendar', 'mr-1')} <span>${isAr ? 'مواعيد' : 'Deadlines for'} ${escapeHtml(formattedHeader)}${filterLabel}</span>`;

  const showClasses = getCachedSettingsSync().showClassesInCalendar !== false;
  const hasCourses = popupState.currentUserCourses.length > 0;
  const emptyGuide = document.getElementById('calendar-empty-guide');
  const dayContainer = document.getElementById('selected-day-container');
  if (emptyGuide && dayContainer) {
    if (popupState.currentTasks.length === 0 && popupState.currentPayments.length === 0 && !hasCourses) {
      emptyGuide.style.display = 'block';
      dayContainer.style.display = 'none';
      const openBbBtn = document.getElementById('btn-empty-guide-open-bb');
      if (openBbBtn && !openBbBtn.getAttribute('data-wired')) {
        openBbBtn.setAttribute('data-wired', 'true');
        openBbBtn.addEventListener('click', () => {
          void openConfiguredBlackboard();
        });
      }
      return;
    } else {
      emptyGuide.style.display = 'none';
      dayContainer.style.display = 'block';
    }
  }

  const classesBox = document.getElementById('selected-day-classes');
  if (classesBox) classesBox.hidden = !showClasses;
  if (classesBox && !showClasses) classesBox.innerHTML = '';
  if (classesBox && showClasses) {
    const now = new Date();
    const classes = classesOnDay(popupState.currentUserCourses, dateObj)
      .filter(o => matchesSelectedCourseFilter({ courseName: o.courseName, courseCode: o.courseCode } as DeadlineTask, popupState.selectedCourseFilter));
    const hasSchedule = popupState.currentUserCourses.some(c => (c.scheduleSlots || []).length > 0);
    classesBox.style.display = '';
    classesBox.innerHTML = `<div class="selected-day-classes-title">${isAr ? 'المحاضرات' : 'Classes'}</div>` + todaysClassesHtml(classes, now, o => o.colorHex || getCourseHex(o.courseName), {
      isToday: formatDateKey(now) === popupState.selectedDateStr,
      hasSchedule,
      lang,
    });
  }

  const tasksOnDate = getCombinedCalendarTasks().filter(task => {
    if (!matchesSelectedCourseFilter(task, popupState.selectedCourseFilter)) return false;
    if (!isCalendarDeadline(task)) return false;
    const taskD = new Date(task.dueDate);
    return !isNaN(taskD.getTime()) && formatDateKey(taskD) === popupState.selectedDateStr;
  });
  tasksOnDate.sort(compareTasksByTime);

  selectedDayList.innerHTML = '';

  if (tasksOnDate.length === 0) {
    selectedDayList.innerHTML = `
      <div class="selected-day-empty">
        <span>${isAr ? 'لا توجد مواعيد مجدولة لهذا اليوم.' : `No deadlines scheduled for this day${popupState.selectedCourseFilter ? ' matching selected course' : ''}.`}</span>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();
  tasksOnDate.forEach(task => {
    const card = createDaySummaryCard(task);
    fragment.appendChild(card);
  });
  selectedDayList.appendChild(fragment);
}

export function setupDayDrawerEvents() {
  dom.btnDrawerClose()?.addEventListener('click', closeDayExpandedDrawer);
  dom.dayExpandedBackdrop()?.addEventListener('click', closeDayExpandedDrawer);
  dom.btnDrawerAdd()?.addEventListener('click', () => {
    closeDayExpandedDrawer();
    popupActions.openAddModalOnDate(popupState.selectedDateStr);
  });
}
