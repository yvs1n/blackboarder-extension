import type { DeadlineTask, TaskStatus } from '../../types';
import { classesOnDay, todaysClassesHtml } from '../../core/classSchedule';
import { getCourseColorTheme, getCourseHex } from '../../core/courseColors';
import { profileGradeScale, profileUniversity } from '../../core/studentProfile';
import { getAllSyllabi } from '../../core/syllabusWeights';
import { calculateTrajectoryTargetPlan, type TrajectoryTargetPlan } from '../../core/targetGpa';
import { buildGpaSummary } from '../../utils/gpa';
import { compareTasksByTime, createGoogleCalendarUrl, formatCountdown, formatTaskTime } from '../../utils/calendar';
import { addTask, getCachedSettingsSync } from '../../utils/storage';
import { matchesSelectedCourseFilter, resolveCourseInfo, sanitizeDoctorAnnouncementText } from '../../core/courseHelper';
import { recordLocalTombstone, removeLocalTombstone } from '../../utils/tombstones';
import { escapeHtml, getSvgIcon, getTaskTypeIcon } from '../../utils/uiCommon';
import { getCachedProfile } from '../universitySettings';
import { isCalendarDeadline } from './calendarView';
import { dom, formatDateKey, popupActions, popupState } from './state';

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

  const [y, m, d] = dateKey.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const formattedDate = dateObj.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const tasksOnDate = popupState.currentTasks.filter(task => {
    if (!matchesSelectedCourseFilter(task, popupState.selectedCourseFilter)) return false;
    if (!isCalendarDeadline(task)) return false;
    const taskD = new Date(task.dueDate);
    return !isNaN(taskD.getTime()) && formatDateKey(taskD) === dateKey;
  });
  tasksOnDate.sort(compareTasksByTime);

  dayDrawerTitle.innerHTML = `${getSvgIcon('calendar', 'mr-1')} <span>${escapeHtml(formattedDate)}</span>`;
  dayDrawerSubtitle.textContent = tasksOnDate.length === 1
    ? '1 Deadline Scheduled'
    : `${tasksOnDate.length} Deadlines Scheduled`;

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
      classesBox.innerHTML = `<div class="selected-day-classes-title">Classes</div>` + todaysClassesHtml(classes, now, o => o.colorHex || getCourseHex(o.courseName), {
        isToday: formatDateKey(now) === dateKey,
        hasSchedule,
      });
    }
  }

  dayDrawerBody.innerHTML = '';

  if (tasksOnDate.length === 0) {
    dayDrawerBody.innerHTML = `
      <div class="day-drawer-empty">
        <div class="empty-icon">${getSvgIcon('coffee')}</div>
        <div class="empty-text">No deadlines scheduled for this day.</div>
        <button type="button" class="btn-drawer-add-action" id="btn-drawer-add-empty">
          ${getSvgIcon('plus', 'mr-1')}
          <span>Add Deadline for this Date</span>
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

  dayExpandedBackdrop.classList.remove('hidden');
  dayExpandedDrawer.classList.remove('hidden');
  requestAnimationFrame(() => {
    dayExpandedBackdrop.classList.add('open');
    dayExpandedDrawer.classList.add('open');
  });
}

export function closeDayExpandedDrawer() {
  const dayExpandedDrawer = dom.dayExpandedDrawer();
  const dayExpandedBackdrop = dom.dayExpandedBackdrop();
  if (!dayExpandedDrawer || !dayExpandedBackdrop) return;
  dayExpandedBackdrop.classList.remove('open');
  dayExpandedDrawer.classList.remove('open');
  setTimeout(() => {
    dayExpandedBackdrop.classList.add('hidden');
    dayExpandedDrawer.classList.add('hidden');
  }, 220);
}

export function renderDoctorQuoteHtml(
  task: DeadlineTask,
  courseName?: string,
  courseCode?: string,
  idPrefix: string = 'quote-body-'
): string {
  const rawSnippet = (task.description || task.sourceSnippet || '').trim();
  if (!rawSnippet || rawSnippet.startsWith('Blackboard Ultra Stream item')) return '';
  const cleanSnippet = sanitizeDoctorAnnouncementText(rawSnippet, courseName, courseCode, task.title);
  if (!cleanSnippet) return '';
  const normalizedText = cleanSnippet.replace(/\n{3,}/g, '\n\n').trim();
  const isLong = normalizedText.length > 120 || normalizedText.includes('\n');
  const quoted = normalizedText.startsWith('"') && normalizedText.endsWith('"')
    ? escapeHtml(normalizedText)
    : `"${escapeHtml(normalizedText)}"`;
  return `
    <div class="doctor-quote-box" data-task-id="${escapeHtml(task.id)}">
      <div class="quote-label-row">
        <div class="quote-label">
          <span>${getSvgIcon('message', 'mr-1')}</span>
          <span>Doctor Announcement:</span>
        </div>
        <button type="button" class="btn-inspect-quote" data-id="${escapeHtml(task.id)}" data-task-id="${escapeHtml(task.id)}" title="Inspect full announcement">
          <span>${getSvgIcon('search', 'mr-1')} Full View</span>
        </button>
      </div>
      <div class="quote-body ${isLong ? 'clamped' : 'expanded'}" id="${idPrefix}${escapeHtml(task.id)}">${quoted}</div>
      ${isLong ? `
        <button type="button" class="btn-toggle-quote" data-id="${escapeHtml(task.id)}" data-task-id="${escapeHtml(task.id)}" aria-expanded="false">
          <span class="quote-toggle-icon">${getSvgIcon('book', 'mr-1')}</span>
          <span class="quote-toggle-text">Read Full Announcement ▾</span>
        </button>
      ` : ''}
    </div>
  `;
}

function getCurrentTrajectoryPlan(): { plan: TrajectoryTargetPlan | null; targetGpa: number } {
  const profile = getCachedProfile();
  const scale = profileGradeScale(profile);
  const syllabi = getAllSyllabi();
  const gpa = buildGpaSummary(popupState.currentTasks, syllabi, scale);
  const targetGpa = (typeof profile?.targetTermGpa === 'number' && profile.targetTermGpa > 0)
    ? profile.targetTermGpa
    : (gpa.gpa !== undefined ? Math.min(4.0, Math.round((Math.max(2.0, gpa.gpa) + 0.25) * 20) / 20) : 3.75);
  const plan = calculateTrajectoryTargetPlan(gpa, targetGpa, popupState.currentTasks, scale);
  return { plan, targetGpa };
}

export function getTaskTargetBadgeHtml(
  task: DeadlineTask,
  trajectoryPlan: TrajectoryTargetPlan | null,
  targetGpa: number
): string {
  if (!task || task.status === 'completed' || !trajectoryPlan?.taskTargetMap) return '';
  const taskTarget = trajectoryPlan.taskTargetMap[task.id];
  if (!taskTarget) return '';

  const pct = taskTarget.requiredPercent;
  let text = '';
  if (pct <= 0) {
    text = `Target: Secured (${escapeHtml(taskTarget.targetLetter)})`;
  } else if (pct > 100) {
    text = `Target: >100% (${escapeHtml(taskTarget.targetLetter)})`;
  } else {
    text = `Target: ${pct.toFixed(1)}% (${escapeHtml(taskTarget.targetLetter)})`;
  }

  const tooltip = `Target required score: ${pct.toFixed(1)}% (${taskTarget.targetScore}/${taskTarget.maxScore} pts) for ${escapeHtml(taskTarget.targetLetter)} grade to achieve ${targetGpa.toFixed(2)} GPA`;

  return `<span class="task-target-pill" title="${tooltip}">${getSvgIcon('star', 'mr-1')}<span>${text}</span></span>`;
}

export function createDaySummaryCard(task: DeadlineTask): HTMLDivElement {
  const isCompleted = task.status === 'completed';
  const resolved = resolveCourseInfo(task);
  const courseHex = getCourseHex(resolved.courseName, resolved.courseCode, task.title);
  const courseTheme = getCourseColorTheme(resolved.courseName, resolved.courseCode, task.title);
  const countdown = formatCountdown(task.dueDate, task.hasSpecificTime);
  const timeDisplay = formatTaskTime(task);

  const isHwOrProject = task.type === 'assignment' || (task.type as string) === 'hw' || task.type === 'project';
  const { plan: trajectoryPlan, targetGpa } = getCurrentTrajectoryPlan();
  const targetBadgeHtml = getTaskTargetBadgeHtml(task, trajectoryPlan, targetGpa);

  const card = document.createElement('div');
  card.className = `day-summary-card ${isCompleted ? 'is-completed' : ''}`;
  card.style.borderLeft = `4px solid ${courseHex}`;
  card.style.setProperty('border-left-color', courseHex, 'important');

  card.innerHTML = `
    <div class="day-card-header">
      <span class="day-card-course-badge" style="background: ${courseTheme.bgLight}; color: ${courseTheme.textDark}; border: 1px solid ${courseTheme.border};" title="${escapeHtml(resolved.courseName)} ${resolved.courseCode ? `(${escapeHtml(resolved.courseCode)})` : ''}">
        <span class="day-card-course-dot" style="background-color: ${courseHex};"></span>
        <span class="day-card-course-name">${escapeHtml(resolved.courseName)}</span>
      </span>
      <div style="display: flex; align-items: center; gap: 5px;">
        <span class="type-pill type-${escapeHtml(task.type)}" style="font-size: 9px; padding: 1px 5px; display: inline-flex; align-items: center; gap: 3px;">
          ${getTaskTypeIcon(task.type)}
          <span>${escapeHtml(task.type)}</span>
        </span>
        <span class="day-card-status-badge ${isCompleted ? 'status-done' : countdown.urgency}">
          ${isCompleted ? `${getSvgIcon('check', 'mr-1')} Completed` : countdown.label}
        </span>
      </div>
    </div>

    <div class="day-card-title-row">
      <div class="day-card-title ${isCompleted ? 'title-completed' : ''}">
        ${escapeHtml(task.title)}
      </div>
    </div>

    <div class="day-card-meta-row">
      <div class="day-card-time" title="Scheduled / Due Time">
        ${getSvgIcon('clock', 'mr-1')} <span class="day-card-time-text">${escapeHtml(timeDisplay)}</span>
      </div>
      ${(!isHwOrProject && task.room) ? `
        <div class="day-card-room" title="Classroom / Exam Hall" style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: #4338ca; background: #e0e7ff; padding: 2px 7px; border-radius: 4px; border: 1px solid #c7d2fe;">
          ${getSvgIcon('pin', 'mr-1')} <span class="day-card-room-text">${escapeHtml(task.room)}</span>
        </div>
      ` : ''}
      ${task.weightDisplay ? `
        <div class="day-card-weight" title="${task.syllabusNote ? escapeHtml(task.syllabusNote) : 'Syllabus grade weight'}">
          ${getSvgIcon('scale', 'mr-1')} <span class="day-card-weight-text">${escapeHtml(task.weightDisplay)}</span>
        </div>
      ` : ''}
      ${targetBadgeHtml}
      ${(task.submissionStatus === 'graded' || (typeof task.score === 'number' && !isNaN(task.score))) ? `
        <div class="task-grade-pill" title="Grade / Score released on Blackboard">
          ${getSvgIcon('star', 'mr-1')} <span>${escapeHtml(task.scoreDisplay || (task.maxScore ? `${task.score} / ${task.maxScore}` : (task.score !== undefined ? `${task.score} pts` : 'Graded')))}</span>
        </div>
      ` : ''}
      ${task.submissionStatus === 'submitted' ? `
        <div class="task-submitted-pill" title="${task.submissionReceipt ? `Receipt: ${escapeHtml(task.submissionReceipt)}` : 'Submitted to Blackboard'}">
          ${getSvgIcon('check', 'mr-1')} <span>Submitted</span>
        </div>
      ` : ''}
    </div>

    ${renderDoctorQuoteHtml(task, resolved.courseName, resolved.courseCode, 'quote-body-day-')}

    ${task.notes ? `
      <div class="day-card-student-notes" style="margin-top: 6px; padding: 6px 10px; background: var(--surface-hover); border-left: 3px solid var(--text-main); border-radius: 0;">
        <span style="font-size: 10px; font-weight: 700; color: var(--text-main); display: inline-flex; align-items: center; gap: 4px;">
          ${getSvgIcon('pencil')}
          <span>Student Notes:</span>
        </span>
        <div style="font-size: 11px; color: var(--text-main); margin-top: 2px; white-space: pre-wrap;">${escapeHtml(task.notes)}</div>
      </div>
    ` : ''}

    <div class="day-card-actions">
      <button type="button" class="btn-card-action btn-card-toggle ${isCompleted ? 'btn-is-completed' : ''}" title="${isCompleted ? 'Mark as Pending' : 'Mark as Done'}">
        ${isCompleted ? `${getSvgIcon('check', 'mr-1')} Completed` : `${getSvgIcon('circle', 'mr-1')} Mark Done`}
      </button>
      <button type="button" class="btn-card-action btn-card-share" title="Share / Copy Task Details">
        ${getSvgIcon('share', 'mr-1')} Share
      </button>
      <button type="button" class="btn-card-action btn-card-edit" title="Edit Deadline">
        ${getSvgIcon('pencil', 'mr-1')} Edit
      </button>
      <a class="btn-card-action btn-card-gcal" href="${createGoogleCalendarUrl(task)}" target="_blank" rel="noopener noreferrer" title="Add to Google Calendar">
        ${getSvgIcon('calendar', 'mr-1')} G-Cal
      </a>
      <button type="button" class="btn-card-action btn-card-delete" title="Delete Deadline">
        ${getSvgIcon('trash')}
      </button>
    </div>
  `;

  card.querySelector('.btn-card-toggle')?.addEventListener('click', async e => {
    e.stopPropagation();
    const prevStatus = task.status;
    const nextStatus: TaskStatus = isCompleted ? 'pending' : 'completed';
    popupState.currentTasks = popupActions.applyTaskUpdateLocal(task.id, {
      status: nextStatus,
      completedAt: nextStatus === 'completed' ? new Date().toISOString() : undefined,
    });
    popupActions.refreshAllViews();
    popupActions.syncTasksToCloud(popupState.currentTasks, 'Drawer Status Change');
    popupActions.showToast(
      nextStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
      'Undo',
      async () => {
        popupState.currentTasks = popupActions.applyTaskUpdateLocal(task.id, {
          status: prevStatus,
          completedAt: prevStatus === 'completed' ? task.completedAt || new Date().toISOString() : undefined,
        });
        popupActions.refreshAllViews();
        popupActions.syncTasksToCloud(popupState.currentTasks, 'Revert Status Change');
        popupActions.showToast('Status reverted');
      }
    );
  });

  card.querySelector('.btn-card-share')?.addEventListener('click', e => {
    e.stopPropagation();
    popupActions.shareTask(task);
  });

  card.querySelector('.btn-card-edit')?.addEventListener('click', e => {
    e.stopPropagation();
    popupActions.openEditModal(task);
  });

  card.querySelector('.btn-card-delete')?.addEventListener('click', async e => {
    e.stopPropagation();
    const taskToDelete = task;
    recordLocalTombstone(task.id);
    popupState.currentTasks = popupActions.removeTaskLocal(task.id);
    popupActions.refreshAllViews();
    popupActions.syncTasksToCloud(popupState.currentTasks, 'Drawer Deleted Deadline');
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

  card.querySelector('.btn-inspect-quote')?.addEventListener('click', e => {
    e.stopPropagation();
    popupActions.openReadingSheet(task);
  });

  card.querySelector('.btn-toggle-quote')?.addEventListener('click', e => {
    e.stopPropagation();
    const body = card.querySelector('.quote-body');
    const btn = card.querySelector('.btn-toggle-quote') as HTMLElement;
    if (!body || !btn) return;
    const isClamped = body.classList.contains('clamped');
    if (isClamped) {
      body.classList.remove('clamped');
      body.classList.add('expanded');
      btn.innerHTML = `${getSvgIcon('book', 'mr-1')} <span class="quote-toggle-text">Show Less ▴</span>`;
    } else {
      body.classList.remove('expanded');
      body.classList.add('clamped');
      btn.innerHTML = `${getSvgIcon('book', 'mr-1')} <span class="quote-toggle-text">Read Full Announcement ▾</span>`;
    }
  });

  card.querySelector('.doctor-quote-box')?.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('.btn-toggle-quote, .btn-inspect-quote')) return;
    popupActions.openReadingSheet(task);
  });

  return card;
}

export function renderSelectedDay() {
  const selectedDayTitle = dom.selectedDayTitle();
  const selectedDayList = dom.selectedDayList();
  const [y, m, d] = popupState.selectedDateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const formattedHeader = dateObj.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const filterLabel = popupState.selectedCourseFilter
    ? ` <span style="font-weight: 500; font-size: 11px; color: var(--text-muted);">&bull; ${escapeHtml(popupState.selectedCourseFilter)}</span>`
    : '';
  selectedDayTitle.innerHTML = `${getSvgIcon('calendar', 'mr-1')} <span>Deadlines for ${escapeHtml(formattedHeader)}${filterLabel}</span>`;

  const showClasses = getCachedSettingsSync().showClassesInCalendar !== false;
  const hasCourses = popupState.currentUserCourses.length > 0;
  const emptyGuide = document.getElementById('calendar-empty-guide');
  const dayContainer = document.getElementById('selected-day-container');
  if (emptyGuide && dayContainer) {
    if (popupState.currentTasks.length === 0 && !hasCourses) {
      emptyGuide.style.display = 'block';
      dayContainer.style.display = 'none';
      const openBbBtn = document.getElementById('btn-empty-guide-open-bb');
      if (openBbBtn && !openBbBtn.getAttribute('data-wired')) {
        openBbBtn.setAttribute('data-wired', 'true');
        openBbBtn.addEventListener('click', () => {
          const cached = getCachedProfile();
          const uni = profileUniversity(cached);
          const bbUrl = uni.blackboardUrl || 'https://elearning.sharjah.ac.ae/ultra/stream';
          try {
            chrome.tabs.create({ url: bbUrl });
          } catch {
            window.open(bbUrl, '_blank', 'noopener');
          }
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
    classesBox.innerHTML = `<div class="selected-day-classes-title">Classes</div>` + todaysClassesHtml(classes, now, o => o.colorHex || getCourseHex(o.courseName), {
      isToday: formatDateKey(now) === popupState.selectedDateStr,
      hasSchedule,
    });
  }

  const tasksOnDate = popupState.currentTasks.filter(task => {
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
        <span>No deadlines scheduled for this day${popupState.selectedCourseFilter ? ' matching selected course' : ''}.</span>
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
