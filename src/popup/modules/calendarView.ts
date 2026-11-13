import type { DeadlineTask } from '../../types';
import { classesOnDay, formatClock, type ClassOccurrence } from '../../core/classSchedule';
import { getCourseHex } from '../../core/courseColors';
import { getActiveCourseLegend } from '../../core/userCourses';
import { getCachedSettingsSync } from '../../utils/storage';
import { compareTasksByTime, formatTaskTime } from '../../utils/calendar';
import { matchesSelectedCourseFilter, resolveCourseInfo } from '../../core/courseHelper';
import { escapeHtml, getSvgIcon, getTaskTypeIcon } from '../../utils/uiCommon';
import { dom, formatDateKey, formatMonthYear, popupActions, popupState } from './state';

/**
 * Unannounced gradebook marks (sourceSnippet: 'gradebook' or synthetic gbcol_ without announcement)
 * belong in the Grades card in the Courses tab and must never be scheduled as deadlines on the calendar.
 */
export function isCalendarDeadline(task: DeadlineTask): boolean {
  if (!task || !task.dueDate) return false;
  if (task.sourceSnippet === 'gradebook') return false;
  if (typeof task.id === 'string' && task.id.startsWith('gbcol_') && !task.announcementId) return false;
  return true;
}

export function renderCalendar(animationDirection: 'next' | 'prev' | 'none' = 'none') {
  const calMonthTitle = dom.calMonthTitle();
  const calendarGrid = dom.calendarGrid();
  calMonthTitle.textContent = formatMonthYear(popupState.calendarYear, popupState.calendarMonth);

  const tasksByDate = new Map<string, DeadlineTask[]>();
  popupState.currentTasks.forEach(task => {
    if (!matchesSelectedCourseFilter(task, popupState.selectedCourseFilter)) return;
    if (!isCalendarDeadline(task)) return;
    const d = new Date(task.dueDate);
    if (!isNaN(d.getTime())) {
      const key = formatDateKey(d);
      if (!tasksByDate.has(key)) {
        tasksByDate.set(key, []);
      }
      tasksByDate.get(key)!.push(task);
    }
  });

  tasksByDate.forEach(dayTasks => {
    dayTasks.sort(compareTasksByTime);
  });

  calendarGrid.innerHTML = '';

  const firstDayIndex = new Date(popupState.calendarYear, popupState.calendarMonth, 1).getDay();
  const offset = (firstDayIndex + 6) % 7;
  const daysInMonth = new Date(popupState.calendarYear, popupState.calendarMonth + 1, 0).getDate();
  const prevMonthDays = new Date(popupState.calendarYear, popupState.calendarMonth, 0).getDate();

  const todayKey = formatDateKey(new Date());
  const fragment = document.createDocumentFragment();
  const showClasses = getCachedSettingsSync().showClassesInCalendar !== false;
  const getDayClasses = (d: Date): ClassOccurrence[] => {
    if (!showClasses) return [];
    return classesOnDay(popupState.currentUserCourses, d).filter(o =>
      matchesSelectedCourseFilter({ courseName: o.courseName, courseCode: o.courseCode } as DeadlineTask, popupState.selectedCourseFilter)
    );
  };

  for (let i = offset - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    const prevDate = new Date(popupState.calendarYear, popupState.calendarMonth - 1, dayNum);
    const dateKey = formatDateKey(prevDate);
    const dayEl = createDayCell(dayNum, dateKey, true, tasksByDate.get(dateKey) || [], false, false, getDayClasses(prevDate));
    fragment.appendChild(dayEl);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const currDate = new Date(popupState.calendarYear, popupState.calendarMonth, d);
    const dateKey = formatDateKey(currDate);
    const dayTasks = tasksByDate.get(dateKey) || [];
    const dayEl = createDayCell(d, dateKey, false, dayTasks, dateKey === todayKey, dateKey === popupState.selectedDateStr, getDayClasses(currDate));
    fragment.appendChild(dayEl);
  }

  const totalSlots = fragment.children.length;
  const remaining = (7 - (totalSlots % 7)) % 7;
  for (let n = 1; n <= remaining; n++) {
    const nextDate = new Date(popupState.calendarYear, popupState.calendarMonth + 1, n);
    const dateKey = formatDateKey(nextDate);
    const dayEl = createDayCell(n, dateKey, true, tasksByDate.get(dateKey) || [], false, false, getDayClasses(nextDate));
    fragment.appendChild(dayEl);
  }

  calendarGrid.appendChild(fragment);

  const rowCount = Math.max(4, Math.ceil(calendarGrid.children.length / 7));
  calendarGrid.style.setProperty('--cal-rows', String(rowCount));
  calendarGrid.dataset.rows = String(rowCount);
  calendarGrid.classList.toggle('is-six-rows', rowCount >= 6);
  calendarGrid.classList.toggle('is-four-rows', rowCount <= 4);

  if (animationDirection === 'next' || animationDirection === 'prev') {
    calendarGrid.classList.remove('cal-slide-next', 'cal-slide-prev');
    void calendarGrid.offsetWidth;
    calendarGrid.classList.add(animationDirection === 'next' ? 'cal-slide-next' : 'cal-slide-prev');
    calMonthTitle.classList.remove('cal-title-fade');
    void calMonthTitle.offsetWidth;
    calMonthTitle.classList.add('cal-title-fade');
  }
}

export function navigateMonth(direction: -1 | 1, anim: 'next' | 'prev' = direction === 1 ? 'next' : 'prev'): void {
  popupState.calendarMonth += direction;
  if (popupState.calendarMonth < 0) {
    popupState.calendarMonth = 11;
    popupState.calendarYear--;
  } else if (popupState.calendarMonth > 11) {
    popupState.calendarMonth = 0;
    popupState.calendarYear++;
  }
  renderCalendar(anim);
}

export function navigateToToday(): void {
  const now = new Date();
  const prevDate = new Date(popupState.calendarYear, popupState.calendarMonth, 1);
  const targetDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const anim: 'next' | 'prev' | 'none' = targetDate > prevDate ? 'next' : (targetDate < prevDate ? 'prev' : 'none');
  popupState.calendarYear = now.getFullYear();
  popupState.calendarMonth = now.getMonth();
  popupState.selectedDateStr = formatDateKey(now);
  renderCalendar(anim);
  popupActions.renderSelectedDay();
}

export function openAddModalOnDate(dateStr: string) {
  const addDateInput = document.getElementById('add-date') as HTMLInputElement;
  if (addDateInput) {
    addDateInput.value = dateStr;
  }
  popupActions.switchView('add');
}

export function createDayCell(
  dayNum: number,
  dateKey: string,
  isOtherMonth: boolean,
  tasks: DeadlineTask[],
  isToday: boolean = false,
  isSelected: boolean = false,
  classes: ClassOccurrence[] = []
): HTMLDivElement {
  const cell = document.createElement('div');
  cell.className = 'cal-day';
  cell.dataset.date = dateKey;
  cell.setAttribute('role', 'button');
  cell.setAttribute('tabindex', '0');
  if (isOtherMonth) cell.classList.add('other-month');
  if (isToday) cell.classList.add('is-today');
  if (isSelected) cell.classList.add('is-selected');

  const header = document.createElement('div');
  header.className = 'cal-day-header';
  const numSpan = document.createElement('span');
  numSpan.className = 'cal-day-num';
  numSpan.textContent = String(dayNum);
  header.appendChild(numSpan);
  cell.appendChild(header);

  const chipsContainer = document.createElement('div');
  chipsContainer.className = 'cal-event-chips-container';

  const maxVisibleChips = 2;
  const visibleTasks = tasks.slice(0, maxVisibleChips);

  visibleTasks.forEach(task => {
    const isCompleted = task.status === 'completed';
    const resolved = resolveCourseInfo(task);
    const courseHex = getCourseHex(resolved.courseName, resolved.courseCode, task.title);
    const timeStr = formatTaskTime(task);

    const chip = document.createElement('div');
    chip.className = 'cal-event-chip';

    if (isCompleted) {
      chip.classList.add('is-completed');
      chip.style.removeProperty('background-color');
      chip.style.borderLeftColor = courseHex;
      chip.innerHTML = `${getSvgIcon('check')} <span>${escapeHtml(task.title)}</span>`;
      chip.title = `[Completed] ${resolved.courseName}: ${task.title} - Click to expand day view`;
    } else {
      chip.style.backgroundColor = courseHex;
      chip.style.setProperty('background-color', courseHex, 'important');
      chip.style.borderLeftColor = 'rgba(0, 0, 0, 0.25)';
      chip.innerHTML = `${getTaskTypeIcon(task.type)} <span>${escapeHtml(task.title)}</span>`;
      chip.title = `${resolved.courseName}: ${task.title} ${task.weightDisplay ? `(${task.weightDisplay})` : ''} - ${timeStr} - Click to expand day view`;
    }

    chip.addEventListener('click', e => {
      e.stopPropagation();
      popupActions.selectDay(dateKey, true);
    });

    chipsContainer.appendChild(chip);
  });

  const remainingSlots = maxVisibleChips - visibleTasks.length;
  if (remainingSlots > 0 && classes.length > 0) {
    const visibleClasses = classes.slice(0, remainingSlots);
    visibleClasses.forEach(c => {
      const chip = document.createElement('div');
      chip.className = 'cal-event-chip is-class';
      const courseHex = c.colorHex || getCourseHex(c.courseName);
      chip.style.backgroundColor = 'var(--surface-hover)';
      chip.style.borderLeftColor = courseHex;
      chip.style.borderLeftWidth = '3px';
      chip.style.borderLeftStyle = 'solid';
      chip.innerHTML = `${getSvgIcon('clock')} <span>${escapeHtml(c.courseName)}</span>`;
      chip.title = `Class: ${c.courseName} (${formatClock(c.start)} - ${formatClock(c.end)})${c.room ? ' in ' + c.room : ''} - Click to expand day view`;
      chip.addEventListener('click', e => {
        e.stopPropagation();
        popupActions.selectDay(dateKey, true);
      });
      chipsContainer.appendChild(chip);
    });
  }

  const totalEvents = tasks.length + classes.length;
  if (totalEvents > maxVisibleChips) {
    const more = document.createElement('span');
    more.className = 'cal-event-more';
    more.textContent = `+${totalEvents - maxVisibleChips}`;
    more.addEventListener('click', e => {
      e.stopPropagation();
      popupActions.selectDay(dateKey, true);
    });
    header.appendChild(more);
  }

  cell.appendChild(chipsContainer);

  cell.addEventListener('click', () => {
    popupActions.selectDay(dateKey, true);
  });

  cell.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      popupActions.selectDay(dateKey, true);
    }
  });

  return cell;
}

export function renderLegend() {
  const legendChipsContainer = dom.legendChipsContainer();
  if (!legendChipsContainer) return;
  const activeLegend = getActiveCourseLegend();
  const legendPanel = document.getElementById('course-legend-panel');

  if (activeLegend.length === 0) {
    legendChipsContainer.innerHTML = '';
    if (legendPanel) legendPanel.style.display = 'none';
    updateLegendScrollArrows();
    return;
  }

  if (legendPanel) legendPanel.style.display = '';
  legendChipsContainer.innerHTML = '';
  legendChipsContainer.classList.toggle('has-filter', popupState.selectedCourseFilter !== null);

  const allChip = document.createElement('div');
  allChip.className = `legend-chip ${popupState.selectedCourseFilter === null ? 'is-active' : ''}`;
  allChip.setAttribute('data-course', '');
  allChip.setAttribute('role', 'button');
  allChip.setAttribute('tabindex', '0');
  allChip.setAttribute('title', 'Show deadlines for all courses');
  allChip.innerHTML = `<span>All</span>`;
  allChip.addEventListener('click', () => {
    popupState.selectedCourseFilter = null;
    renderLegend();
    renderCalendar();
    popupActions.renderSelectedDay();
  });
  legendChipsContainer.appendChild(allChip);

  activeLegend.forEach(course => {
    const chip = document.createElement('div');
    const isActive = popupState.selectedCourseFilter === course.name;
    chip.className = `legend-chip ${isActive ? 'is-active' : ''}`;
    chip.setAttribute('data-course', course.name);
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('title', `Filter calendar by ${course.name}`);
    chip.innerHTML = `
      <span class="legend-dot" style="background-color: ${course.hex};"></span>
      <span>${escapeHtml(course.name)}</span>
    `;
    chip.addEventListener('click', () => {
      popupState.selectedCourseFilter = popupState.selectedCourseFilter === course.name ? null : course.name;
      renderLegend();
      renderCalendar();
      popupActions.renderSelectedDay();
    });
    legendChipsContainer.appendChild(chip);
  });
  requestAnimationFrame(updateLegendScrollArrows);
  setTimeout(updateLegendScrollArrows, 50);
  setTimeout(updateLegendScrollArrows, 150);
  setTimeout(updateLegendScrollArrows, 350);
  setTimeout(updateLegendScrollArrows, 700);
}

let _legendScrollRaf = 0;
export function updateLegendScrollArrows() {
  if (_legendScrollRaf) return;
  _legendScrollRaf = requestAnimationFrame(() => {
    _legendScrollRaf = 0;
    const legendChipsContainer = dom.legendChipsContainer();
    const btnLeft = document.getElementById('legend-scroll-left');
    const btnRight = document.getElementById('legend-scroll-right');
    const bar = document.getElementById('course-legend-panel');
    if (!legendChipsContainer || !btnLeft || !btnRight) return;
    const maxScroll = legendChipsContainer.scrollWidth - legendChipsContainer.clientWidth;
    const showLeft = maxScroll > 1 && legendChipsContainer.scrollLeft > 2;
    const showRight = maxScroll > 1 && legendChipsContainer.scrollLeft < maxScroll - 2;

    btnLeft.style.display = showLeft ? 'inline-flex' : 'none';
    btnRight.style.display = showRight ? 'inline-flex' : 'none';
    btnLeft.setAttribute('aria-hidden', String(!showLeft));
    btnRight.setAttribute('aria-hidden', String(!showRight));

    if (bar) {
      bar.classList.toggle('has-overflow-left', showLeft);
      bar.classList.toggle('has-overflow-right', showRight);
    }
  });
}

export function initLegendScroll() {
  const legendChipsContainer = dom.legendChipsContainer();
  const btnLeft = document.getElementById('legend-scroll-left');
  const btnRight = document.getElementById('legend-scroll-right');
  const bar = document.getElementById('course-legend-panel');
  if (!legendChipsContainer) return;

  btnLeft?.addEventListener('click', () => {
    legendChipsContainer.scrollBy({ left: -140, behavior: 'smooth' });
    setTimeout(updateLegendScrollArrows, 200);
  });

  btnRight?.addEventListener('click', () => {
    legendChipsContainer.scrollBy({ left: 140, behavior: 'smooth' });
    setTimeout(updateLegendScrollArrows, 200);
  });

  legendChipsContainer.addEventListener('scroll', updateLegendScrollArrows, { passive: true });
  bar?.addEventListener('pointerenter', updateLegendScrollArrows);
  bar?.addEventListener('mouseenter', updateLegendScrollArrows);

  legendChipsContainer.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) {
      updateLegendScrollArrows();
      return;
    }
    if (e.deltaY !== 0 && legendChipsContainer.scrollWidth > legendChipsContainer.clientWidth) {
      e.preventDefault();
      legendChipsContainer.scrollBy({ left: e.deltaY, behavior: 'auto' });
      updateLegendScrollArrows();
    }
  }, { passive: false });

  window.addEventListener('resize', updateLegendScrollArrows);

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => updateLegendScrollArrows());
    ro.observe(legendChipsContainer);
    if (legendChipsContainer.parentElement) {
      ro.observe(legendChipsContainer.parentElement);
    }
  }

  if (typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(() => updateLegendScrollArrows());
    mo.observe(legendChipsContainer, { childList: true, subtree: true });
  }

  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    document.fonts.ready.then(updateLegendScrollArrows).catch(() => {});
  }
}

export function initCalendarGestures(): void {
  const container = document.getElementById('view-calendar');
  const calendarGrid = dom.calendarGrid();
  const calMonthTitle = dom.calMonthTitle();
  if (!container || !calendarGrid) return;

  if (calMonthTitle) {
    calMonthTitle.title = 'Swipe horizontally with two fingers or use arrow keys to navigate months';
  }

  let accumulatedDeltaX = 0;
  let gestureLockoutUntil = 0;
  let resetTimer: number | null = null;
  const GESTURE_THRESHOLD = 42;
  const LOCKOUT_MS = 360;

  container.addEventListener('wheel', (e: WheelEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('#course-legend-panel')) return;

    const absX = Math.abs(e.deltaX);
    const absY = Math.abs(e.deltaY);

    if (absX < 8 || absX <= absY * 1.1) {
      accumulatedDeltaX = 0;
      return;
    }

    const now = Date.now();
    if (now < gestureLockoutUntil) {
      e.preventDefault();
      return;
    }

    e.preventDefault();
    accumulatedDeltaX += e.deltaX;

    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      accumulatedDeltaX = 0;
    }, 140);

    if (accumulatedDeltaX >= GESTURE_THRESHOLD) {
      gestureLockoutUntil = now + LOCKOUT_MS;
      accumulatedDeltaX = 0;
      navigateMonth(1, 'next');
    } else if (accumulatedDeltaX <= -GESTURE_THRESHOLD) {
      gestureLockoutUntil = now + LOCKOUT_MS;
      accumulatedDeltaX = 0;
      navigateMonth(-1, 'prev');
    }
  }, { passive: false });

  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerStartTime = 0;
  let activePointerId: number | null = null;
  let isSwiping = false;

  calendarGrid.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    activePointerId = e.pointerId;
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    pointerStartTime = Date.now();
    isSwiping = false;
  }, { passive: true });

  calendarGrid.addEventListener('pointermove', (e: PointerEvent) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    const dx = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;
    if (Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      isSwiping = true;
    }
  }, { passive: true });

  const finishPointerSwipe = (e: PointerEvent) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    const elapsed = Date.now() - pointerStartTime;
    const dx = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;
    activePointerId = null;

    if (isSwiping && elapsed < 650 && Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (dx < 0) {
        navigateMonth(1, 'next');
      } else {
        navigateMonth(-1, 'prev');
      }
    }
    isSwiping = false;
  };

  calendarGrid.addEventListener('pointerup', finishPointerSwipe, { passive: true });
  calendarGrid.addEventListener('pointercancel', finishPointerSwipe, { passive: true });

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (popupState.currentActiveView !== 'calendar') return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    const activeModal = document.querySelector('.modal-backdrop:not(.hidden)');
    if (activeModal && (activeModal as HTMLElement).style.display !== 'none') return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateMonth(-1, 'prev');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateMonth(1, 'next');
    } else if (e.key === 't' || e.key === 'T' || e.key === 'Home') {
      e.preventDefault();
      navigateToToday();
    }
  });
}

export function setupCalendarEvents() {
  dom.btnCalPrev().addEventListener('click', () => navigateMonth(-1, 'prev'));
  dom.btnCalNext().addEventListener('click', () => navigateMonth(1, 'next'));
  dom.btnCalToday().addEventListener('click', () => navigateToToday());
  dom.btnAddOnDate()?.addEventListener('click', () => openAddModalOnDate(popupState.selectedDateStr));
}
