import type { DeadlineTask } from '../../types';
import { getCourseColorTheme } from '../../core/courseColors';
import { compareTasksByTime, formatCountdown } from '../../utils/calendar';
import { resolveCourseInfo } from '../../core/courseHelper';
import { escapeHtml, getSvgIcon, getTaskTypeIcon } from '../../utils/uiCommon';
import { getCurrentTrajectoryPlan, getTaskTargetBadgeHtml } from './dayDrawer';
import {
  renderSummaryAndNotesForExt,
  renderUnifiedActionsForExt,
  wireUnifiedTaskActions
} from './taskActions';
import { getCombinedCalendarTasks, openPaymentModal } from './paymentsView';
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
  const filtered = getCombinedCalendarTasks().filter(task => {
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

  const completedSortTime = new Map<string, number>();
  const parseTs = (d?: string) => {
    if (!d) return NaN;
    const n = Date.parse(d);
    return isNaN(n) ? NaN : n;
  };
  for (const t of filtered) {
    if (t.status === 'completed') {
      completedSortTime.set(
        t.id,
        parseTs(t.dueDate) || parseTs(t.submittedAt) || parseTs(t.completedAt) || parseTs(t.createdAt) || parseTs(t.updatedAt) || parseTs(t.gradedAt) || -Infinity
      );
    }
  }

  filtered.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    if (a.status === 'completed' && b.status === 'completed') {
      const timeA = completedSortTime.get(a.id) ?? -Infinity;
      const timeB = completedSortTime.get(b.id) ?? -Infinity;
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

  const { plan: trajectoryPlan, targetGpa } = getCurrentTrajectoryPlan();

  const fragment = document.createDocumentFragment();

  filtered.forEach(task => {
    const isPayment = Boolean(task.isPayment);
    const countdown = formatCountdown(task.dueDate, task.hasSpecificTime, task.status);
    const isCompleted = task.status === 'completed';
    const resolved = resolveCourseInfo(task);
    const courseTheme = getCourseColorTheme(resolved.courseName, resolved.courseCode, task.title);

    const targetBadgeHtml = isPayment ? '' : getTaskTargetBadgeHtml(task, trajectoryPlan, targetGpa);

    const isHwOrProject = task.type === 'assignment' || (task.type as string) === 'hw' || task.type === 'project';
    let roomBadgeHtml = '';
    if (!isPayment && !isHwOrProject) {
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

    const summaryNotesHtml = renderSummaryAndNotesForExt(task, { variant: 'card', includeFullViewBtn: true });

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
    card.className = `task-card urgency-${countdown.urgency} status-${task.status}${isPayment ? ' is-payment-item' : ''}`;
    card.style.borderLeft = `4px solid ${isPayment ? 'var(--accent)' : courseTheme.hex}`;
    card.style.setProperty('border-left-color', isPayment ? 'var(--accent)' : courseTheme.hex, 'important');
    card.setAttribute('data-id', task.id);

    card.innerHTML = `
      <div class="task-course-banner">
        <div class="course-badge-main" style="background: ${courseTheme.bgLight} !important; border: 1px solid ${courseTheme.border} !important; color: ${courseTheme.textDark} !important;" title="${escapeHtml(resolved.courseName)}${resolved.courseCode && resolved.courseCode !== 'UOS' ? ` (${escapeHtml(resolved.courseCode)})` : ''}">
          <span class="course-color-dot" style="width: 8px; height: 8px; border-radius: 50%; background: ${isPayment ? 'var(--accent)' : courseTheme.hex}; display: inline-block; flex-shrink: 0;"></span>
          <span class="course-name-text" style="color: ${courseTheme.textDark}; font-weight: 700;">${escapeHtml(resolved.courseName)}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          ${(isPayment && task.paymentAmountText) ? `<span class="payment-task-pill">${escapeHtml(task.paymentAmountText)}</span>` : ''}
          <span class="type-pill type-${escapeHtml(task.type)}" style="display: inline-flex; align-items: center; gap: 3px;">
            ${isPayment ? getSvgIcon('credit-card') : getTaskTypeIcon(task.type)}
            <span>${isPayment ? 'PAYMENT' : (task.type || 'assignment').toUpperCase()}</span>
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

      ${summaryNotesHtml}
      ${studentNotesHtml}

      <div class="task-card-footer">
        ${renderUnifiedActionsForExt(task, { variant: 'card' })}
      </div>
    `;

    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button, a, input, select, details, summary')) return;
      if (isPayment && task.paymentId) {
        const existing = popupState.currentPayments.find(p => p.id === task.paymentId);
        if (existing) openPaymentModal(existing);
        return;
      }
      popupActions.openReadingSheet(task);
    });

    card.querySelector('.room-pill-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      popupActions.openRoomPicker(task.id);
    });

    wireUnifiedTaskActions(card, task);

    card.querySelector('.status-checkbox-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = card.querySelector('.btn-card-toggle') as HTMLElement | null;
      if (btn) btn.click();
    });

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

  let searchRaf: number | null = null;
  const searchInput = dom.searchInput();
  searchInput?.addEventListener('input', (e) => {
    popupState.currentSearchQuery = (e.target as HTMLInputElement).value.trim();
    if (searchRaf !== null) cancelAnimationFrame(searchRaf);
    searchRaf = requestAnimationFrame(() => {
      searchRaf = null;
      renderTasks();
    });
  });

  searchInput?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && searchInput.value) {
      e.stopPropagation();
      searchInput.value = '';
      popupState.currentSearchQuery = '';
      renderTasks();
    }
  });

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== '/' || popupState.currentActiveView !== 'details') return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    const activeModal = document.querySelector('.modal-backdrop:not(.hidden)');
    if (activeModal && (activeModal as HTMLElement).style.display !== 'none') return;
    e.preventDefault();
    searchInput?.focus();
    searchInput?.select();
  });
}
