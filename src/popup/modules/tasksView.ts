import type { DeadlineTask, TaskStatus } from '../../types';
import { getCourseColorTheme } from '../../core/courseColors';
import { profileGradeScale } from '../../core/studentProfile';
import { getAllSyllabi } from '../../core/syllabusWeights';
import { calculateTrajectoryTargetPlan } from '../../core/targetGpa';
import { buildGpaSummary } from '../../utils/gpa';
import { compareTasksByTime, createGoogleCalendarUrl, formatCountdown } from '../../utils/calendar';
import { resolveCourseInfo } from '../../core/courseHelper';
import { escapeHtml, getSvgIcon, getTaskTypeIcon } from '../../utils/uiCommon';
import { getCachedProfile } from '../universitySettings';
import { getTaskTargetBadgeHtml, renderDoctorQuoteHtml } from './dayDrawer';
import { dom, popupActions, popupState } from './state';

export function showToast(message: string, actionText?: string, onAction?: () => void) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  container.querySelectorAll('.toast').forEach(el => {
    const text = el.textContent?.trim() || '';
    if (
      text === message.trim() ||
      (message.includes('up to date') && text.includes('up to date')) ||
      (message.includes('Update installed') && text.includes('Update installed')) ||
      (message.includes('New version') && text.includes('New version'))
    ) {
      el.remove();
    }
  });

  const toast = document.createElement('div');
  toast.className = 'toast';

  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  if (actionText && typeof onAction === 'function') {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'toast-btn-action';
    actionBtn.textContent = actionText;
    actionBtn.type = 'button';
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toast.remove();
      onAction();
    });
    toast.appendChild(actionBtn);
  }

  container.appendChild(toast);

  const duration = actionText ? 5000 : 3200;
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

export async function shareTask(task: DeadlineTask) {
  const dueFormatted = new Date(task.dueDate).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: task.hasSpecificTime ? '2-digit' : undefined,
    minute: task.hasSpecificTime ? '2-digit' : undefined,
  });
  const text = `📌 ${task.title}\n📚 ${task.courseCode || task.courseName}\n⏰ Due: ${dueFormatted}${task.room ? '\n📍 Room: ' + task.room : ''}${task.weightDisplay ? '\n⚖️ ' + task.weightDisplay : ''}\n\nManaged with Blackboarder`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: task.title,
        text,
      });
      return;
    } catch (err: any) {
      if (err.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast('Task details copied to clipboard!');
  } catch {
    showToast('Could not copy task details.');
  }
}

export function updateStats(tasks: DeadlineTask[]) {
  const now = Date.now();
  const pendingTasks = tasks.filter(t => t.status === 'pending');

  let urgent = 0;
  let thisWeek = 0;

  for (const t of pendingTasks) {
    const dueTime = new Date(t.dueDate).getTime();
    const diffHours = (dueTime - now) / (1000 * 3600);

    if (diffHours > -12 && diffHours <= 48) {
      urgent++;
    }
    if (diffHours > 0 && diffHours <= 168) {
      thisWeek++;
    }
  }

  dom.statUrgentCount().textContent = String(urgent);
  dom.statWeekCount().textContent = String(thisWeek);
  dom.statTotalCount().textContent = String(pendingTasks.length);
  dom.navBadgeCount().textContent = String(pendingTasks.length);

  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const allCount = tasks.length;
  const btnPending = document.querySelector('.filter-chip[data-status="pending"]');
  const btnAll = document.querySelector('.filter-chip[data-status="all"]');
  const btnCompleted = document.querySelector('.filter-chip[data-status="completed"]');
  if (btnPending) btnPending.textContent = `Pending (${pendingTasks.length})`;
  if (btnAll) btnAll.textContent = `All (${allCount})`;
  if (btnCompleted) btnCompleted.textContent = `Completed (${completedCount})`;
}

export function updateCourseFilterOptions(tasks: DeadlineTask[]) {
  const filterCourseSelect = dom.filterCourseSelect();
  const courseMap = new Map<string, string>();

  tasks.forEach(t => {
    const resolved = resolveCourseInfo(t);
    const key = resolved.courseName;
    if (key && !courseMap.has(key)) {
      const hasCodeAndName = resolved.courseName && resolved.courseCode && resolved.courseName !== resolved.courseCode;
      const label = hasCodeAndName
        ? `${resolved.courseName} (${resolved.courseCode})`
        : (resolved.courseName || resolved.courseCode);
      courseMap.set(key, label);
    }
  });

  const currentVal = filterCourseSelect.value;
  filterCourseSelect.innerHTML = '<option value="all">All Courses</option>';
  courseMap.forEach((label, key) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    filterCourseSelect.appendChild(opt);
  });

  if (courseMap.has(currentVal)) {
    filterCourseSelect.value = currentVal;
  }
}

export function renderTasks() {
  const taskListEl = dom.taskListEl();
  const filtered = popupState.currentTasks.filter(task => {
    if (popupState.currentFilterStatus === 'pending' && task.status !== 'pending') return false;
    if (popupState.currentFilterStatus === 'completed' && task.status !== 'completed') return false;

    if (popupState.currentFilterCourse !== 'all') {
      const resolved = resolveCourseInfo(task);
      const match = (task.courseCode === popupState.currentFilterCourse) ||
                    (task.courseName === popupState.currentFilterCourse) ||
                    (resolved.courseName === popupState.currentFilterCourse) ||
                    (resolved.courseCode === popupState.currentFilterCourse);
      if (!match) return false;
    }

    if (popupState.currentFilterType !== 'all' && task.type !== popupState.currentFilterType) {
      return false;
    }

    if (popupState.currentSearchQuery) {
      const q = popupState.currentSearchQuery.toLowerCase();
      const resolved = resolveCourseInfo(task);
      const match = task.title.toLowerCase().includes(q) ||
                    task.courseCode.toLowerCase().includes(q) ||
                    task.courseName.toLowerCase().includes(q) ||
                    resolved.courseName.toLowerCase().includes(q) ||
                    resolved.courseCode.toLowerCase().includes(q) ||
                    (task.description && task.description.toLowerCase().includes(q));
      if (!match) return false;
    }

    return true;
  });

  filtered.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    if (a.status === 'completed' && b.status === 'completed') {
      const parse = (d?: string) => {
        if (!d) return NaN;
        const n = new Date(d).getTime();
        return isNaN(n) ? NaN : n;
      };
      const timeA = parse(a.dueDate) || parse(a.submittedAt) || parse(a.completedAt) || parse(a.createdAt) || parse(a.updatedAt) || parse(a.gradedAt) || -Infinity;
      const timeB = parse(b.dueDate) || parse(b.submittedAt) || parse(b.completedAt) || parse(b.createdAt) || parse(b.updatedAt) || parse(b.gradedAt) || -Infinity;
      if (timeA !== timeB) return timeB - timeA;
      return (a.title || '').localeCompare(b.title || '');
    }
    return compareTasksByTime(a, b);
  });

  taskListEl.innerHTML = '';

  if (filtered.length === 0) {
    taskListEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${getSvgIcon('calendar')}</div>
        <div class="empty-title">${popupState.currentTasks.length === 0 ? 'No Deadlines Extracted Yet' : 'No Matching Deadlines'}</div>
        <div class="empty-desc">
          ${popupState.currentTasks.length === 0
            ? 'Open Blackboard (e.g. <b>blackboard.sharjah.ac.ae</b>) in a browser tab and click <b>Scan Page</b> to automatically extract upcoming quizzes and assignments!'
            : 'Try adjusting your filters or search terms.'}
        </div>
      </div>
    `;
    return;
  }

  const profile = getCachedProfile();
  const scale = profileGradeScale(profile);
  const syllabi = getAllSyllabi();
  const gpa = buildGpaSummary(popupState.currentTasks, syllabi, scale);
  const targetGpa = (typeof profile?.targetTermGpa === 'number' && profile.targetTermGpa > 0)
    ? profile.targetTermGpa
    : (gpa.gpa !== undefined ? Math.min(4.0, Math.round((Math.max(2.0, gpa.gpa) + 0.25) * 20) / 20) : 3.75);
  const trajectoryPlan = calculateTrajectoryTargetPlan(gpa, targetGpa, popupState.currentTasks, scale);

  const fragment = document.createDocumentFragment();

  filtered.forEach(task => {
    const countdown = formatCountdown(task.dueDate, task.hasSpecificTime, task.status);
    const isCompleted = task.status === 'completed';
    const resolved = resolveCourseInfo(task);
    const courseTheme = getCourseColorTheme(resolved.courseName, resolved.courseCode, task.title);
    const gcalUrl = createGoogleCalendarUrl(task);

    const targetBadgeHtml = getTaskTargetBadgeHtml(task, trajectoryPlan, targetGpa);

    const isHwOrProject = task.type === 'assignment' || (task.type as string) === 'hw' || task.type === 'project';
    let roomBadgeHtml = '';
    if (!isHwOrProject) {
      if (task.room) {
        roomBadgeHtml = `
          <button type="button" class="room-pill-btn" data-id="${escapeHtml(task.id)}" title="Click to change room">
            <span>${getSvgIcon('pin', 'mr-1')} ${escapeHtml(task.room)}</span>
            <span class="room-edit-hint">${getSvgIcon('pencil')}</span>
          </button>
        `;
      } else {
        roomBadgeHtml = `
          <button type="button" class="room-pill-btn" data-id="${escapeHtml(task.id)}" style="background:#f1f5f9; color:#64748b; border-color:#e2e8f0;" title="Click to assign room">
            <span>${getSvgIcon('pin', 'mr-1')} Add Room</span>
            <span class="room-edit-hint">${getSvgIcon('plus')}</span>
          </button>
        `;
      }
    }

    let weightBadgeHtml = '';
    if (task.weightDisplay || task.weight) {
      const weightVal = task.weight || 0;
      const isMajor = weightVal >= 20;
      const isMedium = weightVal >= 10 && weightVal < 20;
      const weightClass = isMajor ? 'weight-major' : (isMedium ? 'weight-medium' : '');
      const displayText = task.weightDisplay || `${task.weight}% of Grade`;
      weightBadgeHtml = `<span class="task-weight-pill ${weightClass}" title="${task.syllabusNote ? escapeHtml(task.syllabusNote) : 'Syllabus weight'}">${getSvgIcon('scale', 'mr-1')} ${escapeHtml(displayText)}</span>`;
    }

    let classTimeBadgeHtml = '';
    if (!task.hasSpecificTime) {
      classTimeBadgeHtml = `<span class="meta-pill time-class">${getSvgIcon('clock', 'mr-1')} Class Time</span>`;
    }

    const doctorQuoteHtml = renderDoctorQuoteHtml(task, resolved.courseName, resolved.courseCode, 'quote-body-');

    let studentNotesHtml = '';
    if (task.notes && task.notes.trim()) {
      studentNotesHtml = `
        <div class="student-notes-box" style="margin-top: 6px; padding: 6px 10px; background: var(--surface-hover); border-left: 3px solid var(--text-main); border-radius: 4px;">
          <div style="font-size: 11px; font-weight: 700; color: var(--text-main); display: inline-flex; align-items: center; gap: 4px; margin-bottom: 2px;">
            ${getSvgIcon('pencil')}
            <span>Student Notes:</span>
          </div>
          <div style="font-size: 12px; color: var(--text-main); white-space: pre-wrap; line-height: 1.4;">${escapeHtml(task.notes)}</div>
        </div>
      `;
    }

    const card = document.createElement('div');
    card.className = `task-card urgency-${countdown.urgency} status-${task.status}`;
    card.style.borderLeft = `4px solid ${courseTheme.hex}`;
    card.style.setProperty('border-left-color', courseTheme.hex, 'important');
    card.setAttribute('data-id', task.id);

    card.innerHTML = `
      <div class="task-course-banner">
        <div class="course-badge-main" style="background: ${courseTheme.bgLight} !important; border: 1px solid ${courseTheme.border} !important; color: ${courseTheme.textDark} !important;" title="${escapeHtml(resolved.courseName)}${resolved.courseCode && resolved.courseCode !== 'UOS' ? ` (${escapeHtml(resolved.courseCode)})` : ''}">
          <span class="course-color-dot" style="width: 8px; height: 8px; border-radius: 50%; background: ${courseTheme.hex}; display: inline-block; flex-shrink: 0;"></span>
          <span class="course-name-text" style="color: ${courseTheme.textDark}; font-weight: 700;">${escapeHtml(resolved.courseName)}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="type-pill type-${escapeHtml(task.type)}" style="display: inline-flex; align-items: center; gap: 3px;">
            ${getTaskTypeIcon(task.type)}
            <span>${(task.type || 'assignment').toUpperCase()}</span>
          </span>
        </div>
      </div>

      <div class="task-title-row">
        <button type="button" class="status-checkbox-btn ${isCompleted ? 'checked' : ''}" data-id="${escapeHtml(task.id)}" aria-label="Toggle status" title="${isCompleted ? 'Mark as Pending' : 'Mark as Done'}">
          ${isCompleted ? '✓' : ''}
        </button>
        <div class="task-title-text">${escapeHtml(task.title)}</div>
      </div>

      <div class="task-due-row">
        <span class="urgency-badge ${countdown.urgency}">
          ${countdown.urgency === 'completed'
            ? `${getSvgIcon('check', 'mr-1')} ${countdown.label}`
            : (countdown.urgency === 'overdue' ? `${getSvgIcon('urgent', 'mr-1')} ${countdown.label}` : `${getSvgIcon('clock', 'mr-1')} ${countdown.label}`)}
        </span>
        ${roomBadgeHtml}
        ${weightBadgeHtml}
        ${classTimeBadgeHtml}
        ${targetBadgeHtml}
        ${(task.submissionStatus === 'graded' || (typeof task.score === 'number' && !isNaN(task.score))) ? `
          <span class="task-grade-pill" title="Grade / Score released on Blackboard">
            ${getSvgIcon('star', 'mr-1')} <span>${escapeHtml(task.scoreDisplay || (task.maxScore ? `${task.score} / ${task.maxScore}` : (task.score !== undefined ? `${task.score} pts` : 'Graded')))}</span>
          </span>
        ` : ''}
        ${task.submissionStatus === 'submitted' ? `
          <span class="task-submitted-pill" title="${task.submissionReceipt ? `Receipt: ${escapeHtml(task.submissionReceipt)}` : 'Submitted to Blackboard'}">
            ${getSvgIcon('check', 'mr-1')} <span>Submitted</span>
          </span>
        ` : ''}
      </div>

      ${task.priority === 'high' ? '<div class="priority-label-row"><span class="high-priority-tag">HIGH PRIORITY</span></div>' : ''}

      ${doctorQuoteHtml}
      ${studentNotesHtml}

      <div class="task-card-footer">
        <button type="button" class="btn-card-action btn-share-card" data-id="${escapeHtml(task.id)}" title="Share task details">
          ${getSvgIcon('share', 'mr-1')} <span class="btn-responsive-label">Share</span>
        </button>
        <button type="button" class="btn-card-action btn-edit-card" data-id="${escapeHtml(task.id)}" title="Edit deadline">
          ${getSvgIcon('pencil', 'mr-1')} <span class="btn-responsive-label">Edit</span>
        </button>
        <a class="btn-card-action btn-gcal" href="${gcalUrl}" target="_blank" rel="noopener noreferrer" title="Add to Google Calendar">
          ${getSvgIcon('calendar', 'mr-1')} <span class="btn-responsive-label">G-Calendar</span>
        </a>
        <button type="button" class="btn-card-action btn-card-toggle" data-id="${escapeHtml(task.id)}">
          ${isCompleted ? `${getSvgIcon('refresh', 'mr-1')} <span class="btn-responsive-label">Mark Pending</span>` : `${getSvgIcon('check', 'mr-1')} <span class="btn-responsive-label">Mark Done</span>`}
        </button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button, a, input, select')) return;
      popupActions.openReadingSheet(task);
    });

    card.querySelector('.btn-inspect-quote')?.addEventListener('click', (e) => {
      e.stopPropagation();
      popupActions.openReadingSheet(task);
    });

    card.querySelector('.btn-toggle-quote')?.addEventListener('click', (e) => {
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

    card.querySelector('.doctor-quote-box')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.btn-toggle-quote, .btn-inspect-quote')) return;
      popupActions.openReadingSheet(task);
    });

    card.querySelector('.room-pill-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      popupActions.openRoomPicker(task.id);
    });

    card.querySelector('.btn-share-card')?.addEventListener('click', (e) => {
      e.stopPropagation();
      shareTask(task);
    });

    card.querySelector('.btn-edit-card')?.addEventListener('click', (e) => {
      e.stopPropagation();
      popupActions.openEditModal(task);
    });

    const handleToggleDone = async (e: Event) => {
      e.stopPropagation();
      const currentTask = popupState.currentTasks.find(t => t.id === task.id) || task;
      const prevStatus = currentTask.status;
      const currentlyCompleted = prevStatus === 'completed';
      const nextStatus: TaskStatus = currentlyCompleted ? 'pending' : 'completed';
      popupState.currentTasks = popupActions.applyTaskUpdateLocal(task.id, {
        status: nextStatus,
        completedAt: nextStatus === 'completed' ? new Date().toISOString() : undefined,
      });

      const nowCompleted = nextStatus === 'completed';
      card.classList.toggle('status-completed', nowCompleted);
      card.classList.toggle('status-pending', !nowCompleted);
      card.classList.toggle('is-completed', nowCompleted);

      const checkBtn = card.querySelector('.status-checkbox-btn');
      if (checkBtn) {
        checkBtn.classList.toggle('checked', nowCompleted);
        checkBtn.textContent = nowCompleted ? '✓' : '';
        checkBtn.setAttribute('title', nowCompleted ? 'Mark as Pending' : 'Mark as Done');
      }

      if (popupState.currentFilterStatus === 'all') {
        const toggleBtn = card.querySelector('.btn-card-toggle');
        if (toggleBtn) {
          toggleBtn.innerHTML = nowCompleted
            ? `${getSvgIcon('refresh', 'mr-1')} <span class="btn-responsive-label">Mark Pending</span>`
            : `${getSvgIcon('check', 'mr-1')} <span class="btn-responsive-label">Mark Done</span>`;
        }
        updateStats(popupState.currentTasks);
        popupState.dirtyViews.add('calendar');
        popupState.dirtyViews.add('marks');
        popupState.dirtyViews.add('courses');
      } else {
        popupActions.refreshAllViews();
      }

      popupActions.syncTasksToCloud(popupState.currentTasks, 'Status Change');
      showToast(
        nextStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
        'Undo',
        async () => {
          popupState.currentTasks = popupActions.applyTaskUpdateLocal(task.id, {
            status: prevStatus,
            completedAt: prevStatus === 'completed' ? task.completedAt || new Date().toISOString() : undefined,
          });
          popupActions.refreshAllViews();
          popupActions.syncTasksToCloud(popupState.currentTasks, 'Revert Status Change');
          showToast('Status reverted');
        }
      );
    };

    card.querySelector('.status-checkbox-btn')?.addEventListener('click', handleToggleDone);
    card.querySelector('.btn-card-toggle')?.addEventListener('click', handleToggleDone);

    fragment.appendChild(card);
  });
  taskListEl.appendChild(fragment);
}

export function setupTaskFilterEvents() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      const target = e.currentTarget as HTMLButtonElement;
      target.classList.add('active');
      popupState.currentFilterStatus = (target.dataset.status as any) || 'pending';
      renderTasks();
    });
  });

  dom.filterCourseSelect()?.addEventListener('change', (e) => {
    popupState.currentFilterCourse = (e.target as HTMLSelectElement).value;
    renderTasks();
  });

  dom.filterTypeSelect()?.addEventListener('change', (e) => {
    popupState.currentFilterType = (e.target as HTMLSelectElement).value;
    renderTasks();
  });

  dom.searchInput()?.addEventListener('input', (e) => {
    popupState.currentSearchQuery = (e.target as HTMLInputElement).value.trim();
    renderTasks();
  });
}
