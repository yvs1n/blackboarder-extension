import { DeadlineTask, TaskType, TaskPriority, TaskStatus, QuickLink, QuickLinkCategory, UserCourseConfig, CustomScheduleSlot, CustomSyllabusComponent, Weekday, AiProvider, UserSettings } from '../types';
import { purgeSyntheticGradebookTasks } from '../utils/gradebook';
import { loadDraft, saveDraft, clearDraft, collectFields, applyFields } from './popupDraft';
import { attachCoursePicker, findPickedCourse } from './coursePicker';
import { buildMarksSummary } from '../utils/marks';
import { buildSyllabusProgress, syllabusProgressHtml } from '../utils/syllabusProgress';
import { buildGpaSummary } from '../utils/gpa';
import { gradesHtml, gradesBadgeText } from '../utils/grades';
import { pickNewerList } from '../utils/syncMerge';
import { initUniversitySettings, getCachedProfile } from './universitySettings';
import { profileGradeScale, profileUniversity } from '../core/studentProfile';
import { quickLinkPreset } from '../core/universities';
import { classesOnDay, todaysClassesHtml } from '../core/classSchedule';
import { getTasks, saveTasks, addTask, getSettings, saveSettings, saveLastScanCheckpoint, getQuickLinks, saveQuickLinks, addQuickLink, updateQuickLink, deleteQuickLink, resetQuickLinksToDefault, getCachedTasksSync, getCachedQuickLinksSync, getCachedSettingsSync, getCachedCoursesSync, getUserCourses, saveUserCourses, recalculateTasksWithActiveCourses, getCoursesUpdatedAt, generateUniqueSyncKey, getScanStatus, ScanStatus, SCAN_STALE_MS, SCAN_STATUS_KEY, saveTasksMergingLatest, getQuickLinksUpdatedAt } from '../utils/storage';
import { createGoogleCalendarUrl, downloadIcsFile, formatCountdown, formatTaskTime, compareTasksByTime } from '../utils/calendar';
import { extractDeadlinesLocally } from '../engine/localExtractor';
import { resolveAiEndpoint, normalizeAiBaseUrl, testAiEndpoint, IFM_MODEL } from '../engine/aiProviders';
import { qrSvg } from '../utils/qrCode';
import { quickLinkMeta, quickLinkIconHtml } from '../utils/quickLinkMeta';
import { syncAiKeyLock, getAiLockState, describeAiLock, ensureAiPass, newAiPass, pairingLink } from '../utils/aiKeyLock';
import { parseCourseDetails, sanitizeDoctorAnnouncementText, resolveCourseInfo, isValidTask, findLegacyNamelessTaskIds, matchesSelectedCourseFilter, isBlackboardSystemNoise } from '../core/courseHelper';
import { getCourseHex, getCourseColorTheme } from '../core/courseColors';
import { resolveTaskWeight, getAllSyllabi } from '../core/syllabusWeights';
import { findCourseSchedule, resolveTaskTimeWithSchedule, resolveTaskRoom, getAllCourseSchedules } from '../core/courseSchedule';
import { pushTasksToFirebase, fetchTasksFromFirebase, deleteSyncDataFromFirebase, extractSyncKey } from '../utils/firebaseSync';
import { sanitizeCloudTasks, sanitizeCloudCourses, sanitizeCloudQuickLinks } from '../utils/cloudSanitize';
import { getProfile, saveProfile } from '../utils/profile';
import { filterCleanUserCourses } from '../core/courseFilter';
import { mergeCloudTasks, mergeTombstones, getTaskSeriesInfo, deduplicateTaskList } from '../utils/taskMerge';
import { parseSyllabusWeightsText, parseCoursesFromJson, mergeImportedCourses } from '../core/courseImporter';
import { applyCourseImport, type CourseDraft } from '../core/courseDocument';
import { courseImportReviewHtml, readCourseImportReview } from '../core/courseImportView';
import { fileToText, type PdfJsLike } from '../core/documentText';
import { findCoursesInDocument } from '../engine/aiCourseImport';
import { getActiveCourseLegend, activeCourseHintOptions } from '../core/userCourses';
import { GITHUB_REPO_URL, GITHUB_ZIP_URL } from '../utils/updateChecker';
import { POPUP_PORT_NAME, AUTO_UPDATE_STATUS_KEY, type AutoUpdateStatus } from '../background/autoUpdate';
import { IS_STORE_BUILD } from '../utils/storeBuild';
import { SESSION_STATUS_KEY, describeSessionBanner, type SessionStatus } from '../utils/sessionStatus';
import { describeUpdateBanner, isUpdateStatusFresh, ENABLE_UPDATES_HINT } from '../utils/updateBanner';
import { BUILD_INFO } from '../buildInfo';
import { calendarFeedUrl, cleanCalendarFeedShow } from '../core/calendarLink';

// State
let currentTasks: DeadlineTask[] = [];
let currentQuickLinks: QuickLink[] = [];
let currentUserCourses: UserCourseConfig[] = [];
let currentFilterStatus: 'all' | 'pending' | 'completed' = 'pending';
let currentFilterCourse: string = 'all';
let currentFilterType: string = 'all';
let currentSearchQuery: string = '';

// Calendar State
const todayDate = new Date();
let calendarYear = todayDate.getFullYear();
let calendarMonth = todayDate.getMonth(); // 0-indexed (0 = Jan)
let selectedDateStr = formatDateKey(todayDate); // 'YYYY-MM-DD'
let selectedCourseFilter: string | null = null;

// DOM Elements: Views & Nav
const tabNavCalendar = document.getElementById('tab-nav-calendar') as HTMLButtonElement;
const tabNavDetails = document.getElementById('tab-nav-details') as HTMLButtonElement;
const tabNavCourses = document.getElementById('tab-nav-courses') as HTMLButtonElement;
const navBadgeCount = document.getElementById('nav-badge-count') as HTMLElement;

const viewCalendar = document.getElementById('view-calendar') as HTMLElement;
const viewDetails = document.getElementById('view-details') as HTMLElement;
const viewCourses = document.getElementById('view-courses') as HTMLElement;
const viewAdd = document.getElementById('view-add') as HTMLElement;
const viewSettings = document.getElementById('view-settings') as HTMLElement;

// Calendar Elements
const calMonthTitle = document.getElementById('cal-month-title') as HTMLElement;
const btnCalPrev = document.getElementById('btn-cal-prev') as HTMLButtonElement;
const btnCalNext = document.getElementById('btn-cal-next') as HTMLButtonElement;
const btnCalToday = document.getElementById('btn-cal-today') as HTMLButtonElement;
const calendarGrid = document.getElementById('calendar-grid') as HTMLDivElement;
const legendChipsContainer = document.getElementById('legend-chips-container') as HTMLDivElement;
const selectedDayTitle = document.getElementById('selected-day-title') as HTMLElement;
const selectedDayList = document.getElementById('selected-day-list') as HTMLDivElement;
const btnAddOnDate = document.getElementById('btn-add-on-date') as HTMLButtonElement;

// Expanded Day View Drawer Elements
const dayExpandedBackdrop = document.getElementById('day-expanded-backdrop') as HTMLDivElement;
const dayExpandedDrawer = document.getElementById('day-expanded-drawer') as HTMLElement;
const dayDrawerTitle = document.getElementById('day-drawer-title') as HTMLElement;
const dayDrawerSubtitle = document.getElementById('day-drawer-subtitle') as HTMLElement;
const btnDrawerAdd = document.getElementById('btn-drawer-add') as HTMLButtonElement;
const btnDrawerClose = document.getElementById('btn-drawer-close') as HTMLButtonElement;
const dayDrawerBody = document.getElementById('day-drawer-body') as HTMLDivElement;

// Details / List Elements
const taskListEl = document.getElementById('task-list') as HTMLDivElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const filterCourseSelect = document.getElementById('filter-course') as HTMLSelectElement;
const filterTypeSelect = document.getElementById('filter-type') as HTMLSelectElement;
const tabButtons = document.querySelectorAll('.tab-btn');

const statUrgentCount = document.getElementById('stat-urgent-count') as HTMLElement;
const statWeekCount = document.getElementById('stat-week-count') as HTMLElement;
const statTotalCount = document.getElementById('stat-total-count') as HTMLElement;

// Header Buttons
const btnScanTab = document.getElementById('btn-scan-tab') as HTMLButtonElement;
const btnAddModal = document.getElementById('btn-add-modal') as HTMLButtonElement;
const btnExportAllIcs = document.getElementById('btn-export-all-ics') as HTMLButtonElement;
const btnSettingsToggle = document.getElementById('btn-settings-toggle') as HTMLButtonElement;
const btnCancelAdd = document.getElementById('btn-cancel-add') as HTMLButtonElement;
const btnCancelSettings = document.getElementById('btn-cancel-settings') as HTMLButtonElement;

// Header Scan Banner Elements (slides down smoothly in header)
const headerScanBanner = document.getElementById('header-scan-banner') as HTMLDivElement | null;
const hsbIcon = document.getElementById('hsb-icon') as SVGElement | null;
const hsbText = document.getElementById('hsb-text') as HTMLSpanElement | null;
let scanBannerTimer: any = null;

function showScanBanner(
  text: string,
  type: 'active' | 'success' | 'info' | 'warning' = 'active',
  autoHideMs?: number
) {
  if (!headerScanBanner || !hsbText) return;
  if (scanBannerTimer) {
    clearTimeout(scanBannerTimer);
    scanBannerTimer = null;
  }

  hsbText.textContent = text;
  headerScanBanner.className = `header-scan-banner is-active is-${type}`;

  const spinner = headerScanBanner.querySelector('.hsb-spinner');
  if (hsbIcon) {
    if (type === 'active') {
      spinner?.classList.add('is-spinning');
      hsbIcon.innerHTML = `<use href="#icon-sparkles"></use>`;
    } else if (type === 'success') {
      spinner?.classList.remove('is-spinning');
      hsbIcon.innerHTML = `<use href="#icon-check"></use>`;
    } else if (type === 'warning') {
      spinner?.classList.remove('is-spinning');
      hsbIcon.innerHTML = `<use href="#icon-urgent"></use>`;
    } else {
      spinner?.classList.remove('is-spinning');
      hsbIcon.innerHTML = `<use href="#icon-sparkles"></use>`;
    }
  }

  if (autoHideMs && autoHideMs > 0) {
    scanBannerTimer = setTimeout(() => {
      hideScanBanner();
    }, autoHideMs);
  }
}

function hideScanBanner() {
  if (!headerScanBanner) return;
  if (scanBannerTimer) {
    clearTimeout(scanBannerTimer);
    scanBannerTimer = null;
  }
  headerScanBanner.classList.remove('is-active');
  const spinner = headerScanBanner.querySelector('.hsb-spinner');
  spinner?.classList.remove('is-spinning');
}

// Theme Management
let currentThemeSetting: 'light' | 'dark' | 'system' = 'light';

function applyTheme(theme: 'light' | 'dark' | 'system' = 'light') {
  currentThemeSetting = theme;
  let isDark = false;
  if (theme === 'system') {
    isDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } else {
    isDark = theme === 'dark';
  }

  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

  const themeSelect = document.getElementById('setting-theme') as HTMLSelectElement | null;
  if (themeSelect && themeSelect.value !== theme) {
    themeSelect.value = theme;
  }
}

// The Theme dropdown in Settings > General applies and saves at once
// (it replaced the header's light/dark toggle button).
async function setThemeNow(newTheme: 'light' | 'dark' | 'system') {
  applyTheme(newTheme);
  try {
    localStorage.setItem('bbs_theme', newTheme);
    await saveSettings({ theme: newTheme });
    const channel = new BroadcastChannel('bbs_sync_channel');
    channel.postMessage({ type: 'THEME_CHANGED', theme: newTheme });
    channel.close();
  } catch {}
}

// One-time switch to "Match System Theme" (the new default). Saved light/dark values
// came from the old 'light' default or the removed header toggle, so everyone starts
// on System once; picking Light or Dark afterwards sticks.
const THEME_SYSTEM_DEFAULT_FLAG = 'bbs_theme_system_default_v1';
async function migrateThemeToSystemDefault() {
  try {
    const flags = await chrome.storage.local.get(THEME_SYSTEM_DEFAULT_FLAG);
    if (flags[THEME_SYSTEM_DEFAULT_FLAG]) return;
    await saveSettings({ theme: 'system' });
    try { localStorage.setItem('bbs_theme', 'system'); } catch {}
    applyTheme('system');
    await chrome.storage.local.set({ [THEME_SYSTEM_DEFAULT_FLAG]: true });
  } catch {}
}

function initThemeSync() {
  let theme: 'light' | 'dark' | 'system' = 'system';
  try {
    const localTheme = localStorage.getItem('bbs_theme') as any;
    if (localTheme) {
      theme = localTheme;
    } else {
      const cached = getCachedSettingsSync();
      if (cached.theme) theme = cached.theme;
    }
  } catch {}
  applyTheme(theme);
}

// Forms
const formAddTask = document.getElementById('form-add-task') as HTMLFormElement;
const formSettings = document.getElementById('form-settings') as HTMLFormElement;

const addTypeSelect = document.getElementById('add-type') as HTMLSelectElement | null;
const addRoomInput = document.getElementById('add-room') as HTMLInputElement;
const addWeightInput = document.getElementById('add-weight') as HTMLInputElement;
const btnCalcAddWeight = document.getElementById('btn-calc-add-weight') as HTMLButtonElement;
const addWeightHint = document.getElementById('add-weight-hint') as HTMLElement;

function updateAddRoomVisibility() {
  const isHwOrProj = addTypeSelect?.value === 'assignment' || (addTypeSelect?.value as string) === 'hw' || addTypeSelect?.value === 'project';
  const group = addRoomInput ? addRoomInput.closest('.form-group') as HTMLElement | null : null;
  if (group) group.style.display = isHwOrProj ? 'none' : '';
  if (isHwOrProj && addRoomInput) addRoomInput.value = '';
}

function updateEditRoomVisibility() {
  const isHwOrProj = editTypeSelect?.value === 'assignment' || (editTypeSelect?.value as string) === 'hw' || editTypeSelect?.value === 'project';
  const group = editRoomInput ? editRoomInput.closest('.form-group') as HTMLElement | null : null;
  if (group) group.style.display = isHwOrProj ? 'none' : '';
  if (isHwOrProj && editRoomInput) editRoomInput.value = '';
}

// Edit Modal Elements
const modalEditTask = document.getElementById('modal-edit-task') as HTMLDivElement;
const formEditTask = document.getElementById('form-edit-task') as HTMLFormElement;
const btnCloseEditModal = document.getElementById('btn-close-edit-modal') as HTMLButtonElement;
const btnCancelEdit = document.getElementById('btn-cancel-edit') as HTMLButtonElement;
const btnDeleteFromModal = document.getElementById('btn-delete-from-modal') as HTMLButtonElement;
const editTaskIdInput = document.getElementById('edit-task-id') as HTMLInputElement;
const editTitleInput = document.getElementById('edit-title') as HTMLInputElement;
const editCourseInput = document.getElementById('edit-course') as HTMLInputElement;
const editDateInput = document.getElementById('edit-date') as HTMLInputElement;
const editTimeInput = document.getElementById('edit-time') as HTMLInputElement;
const editRoomInput = document.getElementById('edit-room') as HTMLInputElement;
const editTypeSelect = document.getElementById('edit-type') as HTMLSelectElement;
const editPrioritySelect = document.getElementById('edit-priority') as HTMLSelectElement;
const editStatusSelect = document.getElementById('edit-status') as HTMLSelectElement;
const editWeightInput = document.getElementById('edit-weight') as HTMLInputElement;
const btnCalcEditWeight = document.getElementById('btn-calc-edit-weight') as HTMLButtonElement;
const editWeightHint = document.getElementById('edit-weight-hint') as HTMLElement;
const editDescInput = document.getElementById('edit-desc') as HTMLTextAreaElement;
const editNotesInput = document.getElementById('edit-notes') as HTMLTextAreaElement;

// Backup / Restore
const btnBackupJson = document.getElementById('btn-backup-json') as HTMLButtonElement;
const btnRestoreJsonTrigger = document.getElementById('btn-restore-json-trigger') as HTMLButtonElement;
const inputRestoreJson = document.getElementById('input-restore-json') as HTMLInputElement;

/** A course picked from the list keeps that course's own name and code; anything else is parsed as typed. */
function parsePickedCourse(value: string): { name: string; code: string } {
  const picked = findPickedCourse(currentUserCourses, value);
  if (picked) return { name: picked.courseName, code: (picked.courseCode || '').trim() || 'UOS' };
  return parseCourseDetails(value);
}

// ============================================================================
// View Navigation
// ============================================================================
type AppView = 'calendar' | 'details' | 'courses' | 'add' | 'settings';
let currentActiveView: AppView = 'calendar';
const dirtyViews = new Set<AppView>(['calendar', 'details', 'courses', 'settings']);

// Unfinished work survives closing the popup (src/popup/popupDraft.ts). Off until the saved draft
// has been restored on open, so the start-up calendar view does not wipe it.
let draftReady = false;

function currentSettingsPage(): string {
  return document.querySelector<HTMLElement>('.settings-nav-tab.active')?.dataset.settingsPage || 'general';
}

function rememberDraft() {
  if (!draftReady) return;
  if (modalEditTask.style.display === 'flex' && editingTaskId) {
    saveDraft({ view: 'edit', taskId: editingTaskId, fields: collectFields(formEditTask) });
  } else if (viewAdd.classList.contains('active')) {
    saveDraft({ view: 'add', fields: collectFields(formAddTask) });
  } else if (viewSettings.classList.contains('active')) {
    saveDraft({ view: 'settings', settingsPage: currentSettingsPage() });
  } else if (viewCourses.classList.contains('active')) {
    saveDraft({ view: 'courses' });
  } else {
    clearDraft();
  }
}

/** Reopens what was being done when the popup closed: adding or editing a deadline, or a settings page. */
async function restoreDraft() {
  try {
    const d = await loadDraft();
    if (!d) return;
    if (d.view === 'add') {
      switchView('add');
      applyFields(d.fields);
      updateAddRoomVisibility();
    } else if (d.view === 'edit') {
      // The quick start-up cache can be empty; fall back to the saved task list
      const task = currentTasks.find(t => t.id === d.taskId) ||
        (await getTasks().catch(() => [] as DeadlineTask[])).find(t => t.id === d.taskId);
      if (!task) return;
      openEditModal(task);
      applyFields(d.fields);
      updateEditRoomVisibility();
    } else if (d.view === 'settings') {
      switchView('settings');
      showSettingsPage(d.settingsPage || 'general');
    } else if (d.view === 'courses') {
      switchView('courses');
    }
  } finally {
    draftReady = true;
    rememberDraft();
  }
}

function switchView(view: AppView) {
  closeDayExpandedDrawer();

  viewCalendar.classList.remove('active');
  viewDetails.classList.remove('active');
  viewCourses.classList.remove('active');
  viewAdd.classList.remove('active');
  viewSettings.classList.remove('active');

  tabNavCalendar.classList.remove('active');
  tabNavDetails.classList.remove('active');
  tabNavCourses.classList.remove('active');

  currentActiveView = view;

  if (view === 'calendar') {
    viewCalendar.classList.add('active');
    tabNavCalendar.classList.add('active');
    if (dirtyViews.has('calendar')) {
      renderCalendar();
      renderSelectedDay();
      dirtyViews.delete('calendar');
    }
    requestAnimationFrame(updateLegendScrollArrows);
  } else if (view === 'details') {
    viewDetails.classList.add('active');
    tabNavDetails.classList.add('active');
    if (dirtyViews.has('details')) {
      renderTasks();
      dirtyViews.delete('details');
    }
  } else if (view === 'courses') {
    viewCourses.classList.add('active');
    tabNavCourses.classList.add('active');
    if (dirtyViews.has('courses')) {
      renderGradeTracker(currentTasks);
      renderUserCoursesManager();
      dirtyViews.delete('courses');
    }
  } else if (view === 'add') {
    viewAdd.classList.add('active');
    updateAddRoomVisibility();
  } else if (view === 'settings') {
    viewSettings.classList.add('active');
    loadSettingsForm();
    renderUserCoursesManager();
    renderQuickLinksManager();
    dirtyViews.delete('settings');
  }
  rememberDraft();
}

// Settings pages: the tab strip shows one group of cards at a time. Every page
// stays inside #form-settings, so Save Settings still saves all fields.
function showSettingsPage(page: string, focusTab = false) {
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
  // A long page may have been scrolled; bring the tab strip back into view without synchronous reflow.
  const nav = document.querySelector<HTMLElement>('.settings-nav');
  if (nav) {
    requestAnimationFrame(() => {
      if (nav.getBoundingClientRect().top < 0) nav.scrollIntoView({ block: 'start' });
    });
  }
}

function initSettingsNav() {
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

// Format date key to 'YYYY-MM-DD'
function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Format month header: "September 2026"
function formatMonthYear(year: number, month: number): string {
  const date = new Date(year, month, 1);
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function getSvgIcon(name: string, extraClass: string = ''): string {
  const cls = extraClass ? `ui-icon ${extraClass}` : 'ui-icon';
  return `<svg class="${cls}"><use href="#icon-${name}"></use></svg>`;
}

function getTaskTypeIcon(type: TaskType): string {
  switch (type) {
    case 'quiz': return getSvgIcon('timer');
    case 'exam': return getSvgIcon('list-check');
    case 'assignment': return getSvgIcon('notebook-pen');
    case 'project': return getSvgIcon('presentation');
    case 'lab': return getSvgIcon('flask-conical');
    case 'meeting': return getSvgIcon('users');
    default: return getSvgIcon('pin');
  }
}

// ============================================================================
// Calendar Rendering
// ============================================================================
// Unannounced gradebook marks (sourceSnippet: 'gradebook' or synthetic gbcol_ without announcement)
// belong in the Grades card in the Courses tab and must never be scheduled as deadlines on the calendar.
function isCalendarDeadline(task: DeadlineTask): boolean {
  if (!task || !task.dueDate) return false;
  if (task.sourceSnippet === 'gradebook') return false;
  if (typeof task.id === 'string' && task.id.startsWith('gbcol_') && !task.announcementId) return false;
  return true;
}

function renderCalendar() {
  calMonthTitle.textContent = formatMonthYear(calendarYear, calendarMonth);

  // Group active tasks by YYYY-MM-DD (filtered by selectedCourseFilter if active)
  const tasksByDate = new Map<string, DeadlineTask[]>();
  currentTasks.forEach(task => {
    if (!matchesSelectedCourseFilter(task, selectedCourseFilter)) return;
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

  // Ensure tasks for every day are sorted chronologically from earliest to latest
  tasksByDate.forEach(dayTasks => {
    dayTasks.sort(compareTasksByTime);
  });

  calendarGrid.innerHTML = '';

  const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay(); // 0 = Sun
  const offset = (firstDayIndex + 6) % 7; // Monday = 0, Sunday = 6
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const prevMonthDays = new Date(calendarYear, calendarMonth, 0).getDate();

  const todayKey = formatDateKey(new Date());
  const fragment = document.createDocumentFragment();

  // 1. Previous Month Leading Days
  for (let i = offset - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    const prevDate = new Date(calendarYear, calendarMonth - 1, dayNum);
    const dateKey = formatDateKey(prevDate);
    const dayEl = createDayCell(dayNum, dateKey, true, tasksByDate.get(dateKey) || []);
    fragment.appendChild(dayEl);
  }

  // 2. Current Month Days
  for (let d = 1; d <= daysInMonth; d++) {
    const currDate = new Date(calendarYear, calendarMonth, d);
    const dateKey = formatDateKey(currDate);
    const dayTasks = tasksByDate.get(dateKey) || [];
    const dayEl = createDayCell(d, dateKey, false, dayTasks, dateKey === todayKey, dateKey === selectedDateStr);
    fragment.appendChild(dayEl);
  }

  // 3. Next Month Trailing Days (fill 42 total slots or end of week)
  const totalSlots = fragment.children.length;
  const remaining = (7 - (totalSlots % 7)) % 7;
  for (let n = 1; n <= remaining; n++) {
    const nextDate = new Date(calendarYear, calendarMonth + 1, n);
    const dateKey = formatDateKey(nextDate);
    const dayEl = createDayCell(n, dateKey, true, tasksByDate.get(dateKey) || []);
    fragment.appendChild(dayEl);
  }

  calendarGrid.appendChild(fragment);

  // Lock the row count (4 rows like Feb 2027, 5 rows like Oct 2026, or 6 rows like Nov 2026) so the
  // calendar grid divides its fixed height evenly and stays the exact same height and width in every month.
  const rowCount = Math.max(4, Math.ceil(calendarGrid.children.length / 7));
  calendarGrid.style.setProperty('--cal-rows', String(rowCount));
  calendarGrid.dataset.rows = String(rowCount);
  calendarGrid.classList.toggle('is-six-rows', rowCount >= 6);
  calendarGrid.classList.toggle('is-four-rows', rowCount <= 4);
}

function openAddModalOnDate(dateStr: string) {
  const addDateInput = document.getElementById('add-date') as HTMLInputElement;
  if (addDateInput) {
    addDateInput.value = dateStr;
  }
  switchView('add');
}

function createDayCell(
  dayNum: number,
  dateKey: string,
  isOtherMonth: boolean,
  tasks: DeadlineTask[],
  isToday: boolean = false,
  isSelected: boolean = false
): HTMLDivElement {
  const cell = document.createElement('div');
  cell.className = 'cal-day';
  cell.dataset.date = dateKey;
  cell.setAttribute('role', 'button');
  cell.setAttribute('tabindex', '0');
  if (isOtherMonth) cell.classList.add('other-month');
  if (isToday) cell.classList.add('is-today');
  if (isSelected) cell.classList.add('is-selected');

  // Day header with number
  const header = document.createElement('div');
  header.className = 'cal-day-header';
  const numSpan = document.createElement('span');
  numSpan.className = 'cal-day-num';
  numSpan.textContent = String(dayNum);
  header.appendChild(numSpan);
  cell.appendChild(header);

  // Event chips container
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

    // The user requested:
    // 1. NO square brackets in the title!
    // 2. The title should be the exact same title present in task/title section (task.title).
    // 3. Gray out and completed styling if completed.
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

    // Clicking directly on chip expands the view of this day
    chip.addEventListener('click', e => {
      e.stopPropagation();
      selectDay(dateKey, true);
    });

    chipsContainer.appendChild(chip);
  });

  if (tasks.length > maxVisibleChips) {
    const more = document.createElement('span');
    more.className = 'cal-event-more';
    more.textContent = `+${tasks.length - maxVisibleChips}`;
    more.addEventListener('click', e => {
      e.stopPropagation();
      selectDay(dateKey, true);
    });
    header.appendChild(more);
  }

  cell.appendChild(chipsContainer);

  // Click handler on day cell to select this day and expand its view
  cell.addEventListener('click', () => {
    selectDay(dateKey, true);
  });

  // Keyboard accessibility
  cell.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectDay(dateKey, true);
    }
  });

  return cell;
}

// Select a day in the calendar and optionally open the expanded day drawer
function selectDay(dateKey: string, openDrawer: boolean = true) {
  selectedDateStr = dateKey;
  document.querySelectorAll('.cal-day.is-selected').forEach(el => el.classList.remove('is-selected'));
  const activeEl = document.querySelector(`.cal-day[data-date="${dateKey}"]`);
  if (activeEl) {
    activeEl.classList.add('is-selected');
  }

  // Update inline drawer below calendar
  renderSelectedDay();

  // If openDrawer is requested, expand the Day View Drawer
  if (openDrawer) {
    openDayExpandedDrawer(dateKey);
  }
}

// Open the expanded day drawer modal with short summary cards
function openDayExpandedDrawer(dateKey: string) {
  if (!dayExpandedDrawer || !dayExpandedBackdrop) return;

  const [y, m, d] = dateKey.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const formattedDate = dateObj.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const tasksOnDate = currentTasks.filter(task => {
    if (!matchesSelectedCourseFilter(task, selectedCourseFilter)) return false;
    if (!isCalendarDeadline(task)) return false;
    const taskD = new Date(task.dueDate);
    return !isNaN(taskD.getTime()) && formatDateKey(taskD) === dateKey;
  });
  tasksOnDate.sort(compareTasksByTime);

  dayDrawerTitle.innerHTML = `${getSvgIcon('calendar', 'mr-1')} <span>${escapeHtml(formattedDate)}</span>`;
  dayDrawerSubtitle.textContent = tasksOnDate.length === 1
    ? '1 Deadline Scheduled'
    : `${tasksOnDate.length} Deadlines Scheduled`;

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
      openAddModalOnDate(dateKey);
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

function closeDayExpandedDrawer() {
  if (!dayExpandedDrawer || !dayExpandedBackdrop) return;
  dayExpandedBackdrop.classList.remove('open');
  dayExpandedDrawer.classList.remove('open');
  setTimeout(() => {
    dayExpandedBackdrop.classList.add('hidden');
    dayExpandedDrawer.classList.add('hidden');
  }, 220);
}

// Renders the doctor's announcement quote box with expand/collapse and inspect modal triggers
function renderDoctorQuoteHtml(
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
      <div class="quote-body ${isLong ? 'clamped' : 'expanded'}" id="${idPrefix}${escapeHtml(task.id)}">${escapeHtml(normalizedText)}</div>
      ${isLong ? `
        <button type="button" class="btn-toggle-quote" data-id="${escapeHtml(task.id)}" data-task-id="${escapeHtml(task.id)}" aria-expanded="false">
          <span class="quote-toggle-icon">${getSvgIcon('book', 'mr-1')}</span>
          <span class="quote-toggle-text">Read Full Announcement ▾</span>
        </button>
      ` : ''}
    </div>
  `;
}

// Create a summary card for a day event: Task Name, Subject (in permanent color), and Time
function createDaySummaryCard(task: DeadlineTask): HTMLDivElement {
  const isCompleted = task.status === 'completed';
  const resolved = resolveCourseInfo(task);
  const courseHex = getCourseHex(resolved.courseName, resolved.courseCode, task.title);
  const courseTheme = getCourseColorTheme(resolved.courseName, resolved.courseCode, task.title);
  const countdown = formatCountdown(task.dueDate, task.hasSpecificTime);
  const timeDisplay = formatTaskTime(task);

  const isHwOrProject = task.type === 'assignment' || (task.type as string) === 'hw' || task.type === 'project';

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

  // Attach event listeners
  card.querySelector('.btn-card-toggle')?.addEventListener('click', async e => {
    e.stopPropagation();
    const prevStatus = task.status;
    const nextStatus: TaskStatus = isCompleted ? 'pending' : 'completed';
    currentTasks = applyTaskUpdateLocal(task.id, { status: nextStatus });
    refreshAllViews();
    syncTasksToCloud(currentTasks, 'Drawer Status Change');
    showToast(
      nextStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
      'Undo',
      async () => {
        currentTasks = applyTaskUpdateLocal(task.id, { status: prevStatus });
        refreshAllViews();
        syncTasksToCloud(currentTasks, 'Revert Status Change');
        showToast('Status reverted');
      }
    );
  });

  card.querySelector('.btn-card-share')?.addEventListener('click', e => {
    e.stopPropagation();
    shareTask(task);
  });

  card.querySelector('.btn-card-edit')?.addEventListener('click', e => {
    e.stopPropagation();
    openEditModal(task);
  });

  card.querySelector('.btn-card-delete')?.addEventListener('click', async e => {
    e.stopPropagation();
    const taskToDelete = task;
    recordLocalTombstone(task.id);
    currentTasks = removeTaskLocal(task.id);
    refreshAllViews();
    syncTasksToCloud(currentTasks, 'Drawer Deleted Deadline');
    showToast(
      `Deleted "${taskToDelete.title.slice(0, 22)}..."`,
      'Undo',
      async () => {
        await removeLocalTombstone(taskToDelete.id);
        currentTasks = await addTask({ ...taskToDelete, updatedAt: new Date().toISOString() });
        refreshAllViews();
        syncTasksToCloud(currentTasks, 'Restored Deadline');
        showToast('Deadline restored');
      }
    );
  });

  // Inspect quote click
  card.querySelector('.btn-inspect-quote')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openReadingSheet(task);
  });

  // Toggle quote expansion
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

  // Quote box click opens reading sheet
  card.querySelector('.doctor-quote-box')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.btn-toggle-quote, .btn-inspect-quote')) return;
    openReadingSheet(task);
  });

  return card;
}

// Render inline selected day drawer below calendar
function renderSelectedDay() {
  const [y, m, d] = selectedDateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const formattedHeader = dateObj.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

  const filterLabel = selectedCourseFilter ? ` <span style="font-weight: 500; font-size: 11px; color: var(--text-muted);">&bull; ${escapeHtml(selectedCourseFilter)}</span>` : '';
  selectedDayTitle.innerHTML = `${getSvgIcon('calendar', 'mr-1')} <span>Deadlines for ${escapeHtml(formattedHeader)}${filterLabel}</span>`;

  const emptyGuide = document.getElementById('calendar-empty-guide');
  const dayContainer = document.getElementById('selected-day-container');
  if (emptyGuide && dayContainer) {
    if (currentTasks.length === 0) {
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

  // That day's classes, from the courses' meeting times
  const classesBox = document.getElementById('selected-day-classes');
  const showClasses = getCachedSettingsSync().showClassesInCalendar !== false;
  if (classesBox) classesBox.hidden = !showClasses;
  if (classesBox && !showClasses) classesBox.innerHTML = '';
  if (classesBox && showClasses) {
    const now = new Date();
    const classes = classesOnDay(currentUserCourses, dateObj)
      .filter(o => matchesSelectedCourseFilter({ courseName: o.courseName, courseCode: o.courseCode } as DeadlineTask, selectedCourseFilter));
    const hasSchedule = currentUserCourses.some(c => (c.scheduleSlots || []).length > 0);
    if (classes.length === 0 && !hasSchedule) {
      classesBox.style.display = 'none';
      classesBox.innerHTML = '';
    } else {
      classesBox.style.display = '';
      classesBox.innerHTML = `<div class="selected-day-classes-title">Classes</div>` + todaysClassesHtml(classes, now, o => o.colorHex || getCourseHex(o.courseName), {
        isToday: formatDateKey(now) === selectedDateStr,
        hasSchedule
      });
    }
  }

  const tasksOnDate = currentTasks.filter(task => {
    if (!matchesSelectedCourseFilter(task, selectedCourseFilter)) return false;
    if (!isCalendarDeadline(task)) return false;
    const taskD = new Date(task.dueDate);
    return !isNaN(taskD.getTime()) && formatDateKey(taskD) === selectedDateStr;
  });
  tasksOnDate.sort(compareTasksByTime);

  selectedDayList.innerHTML = '';

  if (tasksOnDate.length === 0) {
    selectedDayList.innerHTML = `
      <div class="selected-day-empty">
        <span>No deadlines scheduled for this day${selectedCourseFilter ? ' matching selected course' : ''}.</span>
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


// Render permanent course color legend with interactive filtering
function renderLegend() {
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
  legendChipsContainer.classList.toggle('has-filter', selectedCourseFilter !== null);

  // 1. "All" filter chip
  const allChip = document.createElement('div');
  allChip.className = `legend-chip ${selectedCourseFilter === null ? 'is-active' : ''}`;
  allChip.setAttribute('data-course', '');
  allChip.setAttribute('role', 'button');
  allChip.setAttribute('tabindex', '0');
  allChip.setAttribute('title', 'Show deadlines for all courses');
  allChip.innerHTML = `<span>All</span>`;
  allChip.addEventListener('click', () => {
    selectedCourseFilter = null;
    renderLegend();
    renderCalendar();
    renderSelectedDay();
  });
  legendChipsContainer.appendChild(allChip);

  // 2. Individual Course chips (dynamically from active courses)
  getActiveCourseLegend().forEach(course => {
    const chip = document.createElement('div');
    const isActive = selectedCourseFilter === course.name;
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
      selectedCourseFilter = selectedCourseFilter === course.name ? null : course.name;
      renderLegend();
      renderCalendar();
      renderSelectedDay();
    });
    legendChipsContainer.appendChild(chip);
  });
  requestAnimationFrame(updateLegendScrollArrows);
}

let _legendScrollRaf = 0;
function updateLegendScrollArrows() {
  if (_legendScrollRaf) return;
  _legendScrollRaf = requestAnimationFrame(() => {
    _legendScrollRaf = 0;
    const btnLeft = document.getElementById('legend-scroll-left');
    const btnRight = document.getElementById('legend-scroll-right');
    if (!legendChipsContainer || !btnLeft || !btnRight) return;
    const maxScroll = legendChipsContainer.scrollWidth - legendChipsContainer.clientWidth;
    if (maxScroll > 2) {
      const left = legendChipsContainer.scrollLeft;
      const showLeft = left > 4;
      const showRight = left < maxScroll - 4;
      if (btnLeft.style.display !== (showLeft ? 'inline-flex' : 'none')) {
        btnLeft.style.display = showLeft ? 'inline-flex' : 'none';
      }
      if (btnRight.style.display !== (showRight ? 'inline-flex' : 'none')) {
        btnRight.style.display = showRight ? 'inline-flex' : 'none';
      }
    } else {
      if (btnLeft.style.display !== 'none') btnLeft.style.display = 'none';
      if (btnRight.style.display !== 'none') btnRight.style.display = 'none';
    }
  });
}

function initLegendScroll() {
  const btnLeft = document.getElementById('legend-scroll-left');
  const btnRight = document.getElementById('legend-scroll-right');
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
}

// ============================================================================
// My Courses, Schedule & Syllabus Manager
// ============================================================================

function renderUserCoursesManager() {
  const container = document.getElementById('user-courses-list');
  const countPill = document.getElementById('pill-course-count');
  if (!container) return;

  // Filter out any Blackboard navigation tabs (Content, Calendar, Discussions, Gradebook, etc.)
  currentUserCourses = currentUserCourses.filter(c => {
    const name = (c.courseName || '').trim();
    const code = (c.courseCode || '').trim();
    if (isBlackboardSystemNoise(name) && (!code || isBlackboardSystemNoise(code) || code.toLowerCase() === name.toLowerCase())) {
      return false;
    }
    return true;
  });

  if (countPill) {
    countPill.textContent = `${currentUserCourses.length} Active`;
  }

  container.innerHTML = '';

  if (currentUserCourses.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 20px 10px; color: var(--text-muted); background: var(--surface-hover); border-radius: var(--radius-sm); border: 1px dashed var(--surface-border);">
        <p style="font-size: 12px; margin-bottom: 8px;">No courses configured yet. Click <b>+ Add Course</b> or scan Blackboard to detect your courses automatically.</p>
        <button type="button" class="btn-primary" id="btn-empty-add-course" style="font-size: 11px; padding: 4px 10px;">
          + Add Your First Course
        </button>
      </div>
    `;
    container.querySelector('#btn-empty-add-course')?.addEventListener('click', () => openCourseEditor());
    return;
  }

  currentUserCourses.forEach(course => {
    const card = document.createElement('div');
    card.className = 'user-course-card';
    card.style.borderLeft = `3px solid ${course.colorHex}`;

    // Total weight calculation
    const totalWeight = (course.syllabus || []).reduce((acc, c) => acc + (Number(c.totalWeight) || 0), 0);

    // Schedule badges
    let scheduleHtml = '';
    if (course.scheduleSlots && course.scheduleSlots.length > 0) {
      scheduleHtml = course.scheduleSlots.map(slot => {
        const daysDisplay = escapeHtml(slot.days.map(d => String(d).slice(0, 3).toUpperCase()).join('/'));
        const roomDisplay = slot.room ? `Room ${escapeHtml(slot.room)}` : 'Room TBD';
        return `
          <span class="ucc-schedule-badge">
            ${getSvgIcon('calendar', 'mr-1')} <b>${daysDisplay}</b> • ${escapeHtml(slot.startTime)}–${escapeHtml(slot.endTime)} • ${roomDisplay}
          </span>
        `;
      }).join('');
    } else {
      scheduleHtml = `<span style="font-size: 10.5px; color: var(--text-muted); font-style: italic;">No meeting times scheduled</span>`;
    }

    // Syllabus breakdown pills
    let syllabusHtml = '';
    if (course.syllabus && course.syllabus.length > 0) {
      syllabusHtml = course.syllabus.map(comp => {
        const unitText = comp.count && comp.count > 1 && comp.unitWeight !== undefined
          ? ` (${comp.count}x ${comp.unitWeight}%)`
          : '';
        return `
          <span class="ucc-syllabus-pill" title="${escapeHtml(comp.note || comp.name)}">
            ${escapeHtml(comp.name)}: <span class="weight-bold">${comp.totalWeight}%</span>${unitText}
          </span>
        `;
      }).join('');
    } else {
      syllabusHtml = `<span style="font-size: 10.5px; color: var(--text-muted); font-style: italic;">No syllabus breakdown defined</span>`;
    }

    // Weight status badge
    let weightStatusBadge = '';
    if (totalWeight === 100) {
      weightStatusBadge = `<span class="settings-pill pill-green" style="font-size: 10px;">Total Weight: 100%</span>`;
    } else if (totalWeight < 100) {
      weightStatusBadge = `<span class="settings-pill pill-orange" style="font-size: 10px;">Total Weight: ${totalWeight}% (Incomplete)</span>`;
    } else {
      weightStatusBadge = `<span class="settings-pill pill-red" style="font-size: 10px; color: var(--danger);">Total Weight: ${totalWeight}% (Exceeds 100%)</span>`;
    }

    // Code, CRN and credit hours sit under the name so the name is never cut short
    const credits = Number(course.creditHours) > 0 ? Number(course.creditHours) : null;
    const metaParts = [
      course.courseCode ? `<span class="ucc-code">${escapeHtml(course.courseCode)}</span>` : '',
      course.crn ? `<span title="CRN">CRN ${escapeHtml(course.crn)}</span>` : '',
      credits !== null ? `<span>${credits} credit hour${credits === 1 ? '' : 's'}</span>` : ''
    ].filter(Boolean).join('<span aria-hidden="true">·</span>');

    card.innerHTML = `
      <div class="ucc-header">
        <div class="ucc-title-group">
          <span class="ucc-color-dot" style="background-color: ${course.colorHex};"></span>
          <div class="ucc-title-text">
            <span class="ucc-name">${escapeHtml(course.courseName)}</span>
            ${metaParts ? `<span class="ucc-meta">${metaParts}</span>` : ''}
          </div>
        </div>
        <div class="ucc-actions">
          <button type="button" class="ucc-action-btn edit" title="Edit course" aria-label="Edit course">
            <svg class="ui-icon" style="width: 13px; height: 13px;"><use href="#icon-pencil"></use></svg>
          </button>
          <button type="button" class="ucc-action-btn delete" title="Delete course" aria-label="Delete course">
            <svg class="ui-icon" style="width: 13px; height: 13px;"><use href="#icon-trash"></use></svg>
          </button>
        </div>
      </div>
      <div class="ucc-schedule-list">
        ${scheduleHtml}
      </div>
      <div class="ucc-syllabus-section">
        <div class="ucc-syllabus-pills">
          ${syllabusHtml}
        </div>
        <div class="ucc-weight-status">
          <span>Mark breakdown</span>
          ${weightStatusBadge}
        </div>
      </div>
    `;

    card.querySelector('.ucc-action-btn.edit')?.addEventListener('click', () => openCourseEditor(course.id));
    card.querySelector('.ucc-action-btn.delete')?.addEventListener('click', () => handleDeleteCourse(course.id, course.courseName));

    container.appendChild(card);
  });
}

// ============================================================================
// Course & Syllabus Editor Modal
// ============================================================================
let editingCourseId: string | null = null;
const ALL_WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function openCourseEditor(courseId?: string) {
  const modal = document.getElementById('modal-course-editor');
  if (!modal) return;

  editingCourseId = courseId || null;
  const titleEl = document.getElementById('course-editor-title');
  const dotEl = document.getElementById('editor-header-dot');
  const codeInput = document.getElementById('editor-course-code') as HTMLInputElement;
  const nameInput = document.getElementById('editor-course-name') as HTMLInputElement;
  const crnInput = document.getElementById('editor-course-crn') as HTMLInputElement;
  const creditsInput = document.getElementById('editor-course-credits') as HTMLInputElement | null;
  const colorPicker = document.getElementById('editor-color-picker') as HTMLInputElement;
  const colorHexInput = document.getElementById('editor-color-hex') as HTMLInputElement;
  const aliasesInput = document.getElementById('editor-course-aliases') as HTMLInputElement;
  const slotsContainer = document.getElementById('course-editor-slots');
  const syllabusContainer = document.getElementById('course-editor-syllabus');

  if (slotsContainer) slotsContainer.innerHTML = '';
  if (syllabusContainer) syllabusContainer.innerHTML = '';

  const course = courseId ? currentUserCourses.find(c => c.id === courseId) : null;

  if (course) {
    if (titleEl) titleEl.textContent = 'Edit Course';
    if (codeInput) codeInput.value = course.courseCode || '';
    if (nameInput) nameInput.value = course.courseName || '';
    if (crnInput) crnInput.value = course.crn || '';
    if (creditsInput) creditsInput.value = course.creditHours ? String(course.creditHours) : '';
    const color = course.colorHex || '#2563eb';
    if (colorPicker) colorPicker.value = color;
    if (colorHexInput) colorHexInput.value = color;
    if (dotEl) dotEl.style.backgroundColor = color;
    if (aliasesInput) aliasesInput.value = (course.aliases || []).join(', ');

    if (course.scheduleSlots && course.scheduleSlots.length > 0) {
      course.scheduleSlots.forEach(slot => addScheduleSlotRow(slot));
    } else {
      addScheduleSlotRow();
    }

    if (course.syllabus && course.syllabus.length > 0) {
      course.syllabus.forEach(comp => addSyllabusRow(comp));
    } else {
      addSyllabusRow();
    }
  } else {
    if (titleEl) titleEl.textContent = 'Add Course';
    if (codeInput) codeInput.value = '';
    if (nameInput) nameInput.value = '';
    if (crnInput) crnInput.value = '';
    if (creditsInput) creditsInput.value = '';
    const defaultColor = '#2563eb';
    if (colorPicker) colorPicker.value = defaultColor;
    if (colorHexInput) colorHexInput.value = defaultColor;
    if (dotEl) dotEl.style.backgroundColor = defaultColor;
    if (aliasesInput) aliasesInput.value = '';

    addScheduleSlotRow();
    addSyllabusRow();
  }

  updateEditorTotalWeight();
  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function closeCourseEditor() {
  const modal = document.getElementById('modal-course-editor');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
  editingCourseId = null;
}

function addScheduleSlotRow(slot?: Partial<CustomScheduleSlot>) {
  const container = document.getElementById('course-editor-slots');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'slot-editor-row';

  // Stored courses use full names ("Tuesday") while the pills use short keys ("tue"); without
  // normalising, editing a default course showed no days selected and saving dropped its schedule.
  const selectedDays = new Set<string>(
    (slot?.days || ['mon', 'wed']).map(d => String(d).toLowerCase().slice(0, 3))
  );
  const dayPillsHtml = ALL_WEEKDAYS.map(day => {
    const isSelected = selectedDays.has(day);
    const label = day.charAt(0).toUpperCase() + day.slice(1, 3);
    return `<button type="button" class="day-pill-btn ${isSelected ? 'selected' : ''}" data-day="${day}">${label}</button>`;
  }).join('');

  // Fields the editor has no input for (location, instructor) are carried through unchanged
  if (slot) {
    row.dataset.extra = JSON.stringify({ location: slot.location, instructor: slot.instructor });
  }

  row.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span style="font-size: 10px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Meeting Days</span>
      <button type="button" class="ucc-action-btn delete btn-remove-slot" title="Remove slot" style="width: 20px; height: 20px;">✕</button>
    </div>
    <div class="day-pills-row" style="display: flex; gap: 4px; flex-wrap: wrap;">
      ${dayPillsHtml}
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-top: 4px;">
      <div>
        <label style="font-size: 9.5px; color: var(--text-muted); display: block;">Start</label>
        <input type="time" class="form-input slot-start-time" value="${escapeHtml(slot?.startTime || '11:00')}" required style="font-size: 11px; padding: 4px 6px;">
      </div>
      <div>
        <label style="font-size: 9.5px; color: var(--text-muted); display: block;">End</label>
        <input type="time" class="form-input slot-end-time" value="${escapeHtml(slot?.endTime || '12:15')}" required style="font-size: 11px; padding: 4px 6px;">
      </div>
      <div>
        <label style="font-size: 9.5px; color: var(--text-muted); display: block;">Room</label>
        <input type="text" class="form-input slot-room" placeholder="e.g. A8-103" value="${escapeHtml(slot?.room || '')}" style="font-size: 11px; padding: 4px 6px;">
      </div>
    </div>
  `;

  row.querySelectorAll('.day-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('selected');
    });
  });

  row.querySelector('.btn-remove-slot')?.addEventListener('click', () => {
    row.remove();
  });

  container.appendChild(row);
}

function addSyllabusRow(comp?: Partial<CustomSyllabusComponent>) {
  const container = document.getElementById('course-editor-syllabus');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'syllabus-editor-row';
  // Keep id, note and matching keywords; the editor only shows name/type/weight/count
  if (comp) {
    row.dataset.extra = JSON.stringify({ id: comp.id, note: comp.note, keywords: comp.keywords });
  }

  const compType = comp?.type || 'quiz';
  const totalWeight = comp?.totalWeight !== undefined ? comp.totalWeight : 20;
  const count = comp?.count || '';
  const outOf = comp?.outOf || '';
  const unitWeight = comp?.unitWeight !== undefined ? `${comp.unitWeight}% each` : '';

  row.innerHTML = `
    <div style="display: flex; gap: 6px; align-items: center;">
      <input type="text" class="form-input comp-name" placeholder="Component Name (e.g. Quizzes, Midterm)" value="${escapeHtml(comp?.name || '')}" required style="flex: 2; font-size: 11.5px; padding: 4px 6px;">
      <select class="form-select comp-type" style="flex: 1.2; font-size: 11px; padding: 4px 6px;">
        <option value="quiz" ${compType === 'quiz' ? 'selected' : ''}>Quiz</option>
        <option value="exam" ${compType === 'exam' ? 'selected' : ''}>Exam</option>
        <option value="assignment" ${compType === 'assignment' ? 'selected' : ''}>Assignment</option>
        <option value="project" ${compType === 'project' ? 'selected' : ''}>Project</option>
        <option value="lab" ${compType === 'lab' ? 'selected' : ''}>Lab</option>
        <option value="other" ${compType === 'other' ? 'selected' : ''}>Other</option>
      </select>
      <input type="number" min="0" max="100" class="form-input comp-weight" placeholder="Weight %" value="${totalWeight}" required style="width: 60px; font-size: 11.5px; padding: 4px 6px;">
      <input type="number" min="1" max="50" class="form-input comp-count" placeholder="Count" value="${count}" title="Optional number of items that count (e.g. 2 for best 2 of 3)" style="width: 52px; font-size: 11.5px; padding: 4px 6px;">
      <input type="number" min="1" max="50" class="form-input comp-outof" placeholder="Of" value="${outOf}" title="Optional: how many are held when only the best count (e.g. 3 for best 2 of 3)" style="width: 44px; font-size: 11.5px; padding: 4px 6px;">
      <button type="button" class="ucc-action-btn delete btn-remove-syllabus" title="Remove component" style="width: 22px; height: 22px; flex-shrink: 0;">✕</button>
    </div>
    <div class="comp-unit-calc" style="font-size: 10px; color: var(--text-muted); text-align: right; padding-right: 28px;">
      ${unitWeight}
    </div>
  `;

  const weightInput = row.querySelector('.comp-weight') as HTMLInputElement;
  const countInput = row.querySelector('.comp-count') as HTMLInputElement;
  const unitCalcEl = row.querySelector('.comp-unit-calc') as HTMLElement;

  function recalculateUnit() {
    const w = parseFloat(weightInput.value) || 0;
    const c = parseInt(countInput.value, 10) || 0;
    if (c > 1 && w > 0) {
      const u = Math.round((w / c) * 10) / 10;
      const o = parseInt((row.querySelector('.comp-outof') as HTMLInputElement)?.value, 10) || 0;
      unitCalcEl.textContent = o > c ? `best ${c} of ${o}, ${u}% each` : `${c} items x ${u}% each`;
    } else {
      unitCalcEl.textContent = '';
    }
    updateEditorTotalWeight();
  }

  weightInput.addEventListener('input', recalculateUnit);
  countInput.addEventListener('input', recalculateUnit);
  row.querySelector('.comp-outof')?.addEventListener('input', recalculateUnit);

  row.querySelector('.btn-remove-syllabus')?.addEventListener('click', () => {
    row.remove();
    updateEditorTotalWeight();
  });

  container.appendChild(row);
}

function updateEditorTotalWeight() {
  const badge = document.getElementById('editor-syllabus-total-badge');
  if (!badge) return;

  const container = document.getElementById('course-editor-syllabus');
  let total = 0;
  if (container) {
    const weightInputs = container.querySelectorAll('.comp-weight') as NodeListOf<HTMLInputElement>;
    weightInputs.forEach(inp => {
      total += parseFloat(inp.value) || 0;
    });
  }

  badge.textContent = `Total: ${total}% / 100%`;
  badge.classList.remove('pill-green', 'pill-blue', 'pill-orange', 'pill-red');
  if (total === 100) {
    badge.classList.add('pill-green');
  } else if (total < 100) {
    badge.classList.add('pill-orange');
  } else {
    badge.classList.add('pill-red');
  }
}

async function handleSaveCourse(e: Event) {
  e.preventDefault();
  const code = (document.getElementById('editor-course-code') as HTMLInputElement).value.trim();
  const name = (document.getElementById('editor-course-name') as HTMLInputElement).value.trim();
  const crn = (document.getElementById('editor-course-crn') as HTMLInputElement).value.trim();
  const credits = parseFloat((document.getElementById('editor-course-credits') as HTMLInputElement | null)?.value || '');
  const rawHex = (document.getElementById('editor-color-hex') as HTMLInputElement).value.trim();
  const hex = /^#[0-9a-f]{3,8}$/i.test(rawHex) ? rawHex : '#2563eb';
  const aliasesRaw = (document.getElementById('editor-course-aliases') as HTMLInputElement).value;
  const aliases = aliasesRaw.split(',').map(s => s.trim()).filter(Boolean);

  if (!code || !name) {
    alert('Please enter both course code and course name.');
    return;
  }

  // Collect schedule slots
  const slots: CustomScheduleSlot[] = [];
  const slotRows = document.querySelectorAll('#course-editor-slots .slot-editor-row');
  slotRows.forEach(row => {
    const days: Weekday[] = [];
    row.querySelectorAll('.day-pill-btn.selected').forEach(btn => {
      const d = btn.getAttribute('data-day') as Weekday;
      if (d) days.push(d);
    });
    const startTime = (row.querySelector('.slot-start-time') as HTMLInputElement)?.value || '11:00';
    const endTime = (row.querySelector('.slot-end-time') as HTMLInputElement)?.value || '12:15';
    const room = (row.querySelector('.slot-room') as HTMLInputElement)?.value.trim() || '';

    let extra: { location?: string; instructor?: string } = {};
    try {
      extra = JSON.parse((row as HTMLElement).dataset.extra || '{}') || {};
    } catch {}

    if (days.length > 0) {
      slots.push({
        days,
        startTime,
        endTime,
        room,
        ...(extra.location ? { location: extra.location } : {}),
        ...(extra.instructor ? { instructor: extra.instructor } : {})
      });
    }
  });

  // Collect syllabus components
  const syllabus: CustomSyllabusComponent[] = [];
  const syllabusRows = document.querySelectorAll('#course-editor-syllabus .syllabus-editor-row');
  syllabusRows.forEach((row, idx) => {
    const cName = (row.querySelector('.comp-name') as HTMLInputElement)?.value.trim();
    const cType = ((row.querySelector('.comp-type') as HTMLSelectElement)?.value || 'quiz') as TaskType;
    const cWeight = parseFloat((row.querySelector('.comp-weight') as HTMLInputElement)?.value) || 0;
    const cCount = parseInt((row.querySelector('.comp-count') as HTMLInputElement)?.value, 10) || undefined;
    const cOutOf = parseInt((row.querySelector('.comp-outof') as HTMLInputElement)?.value, 10) || undefined;
    const uWeight = (cCount && cCount > 1 && cWeight > 0) ? Math.round((cWeight / cCount) * 10) / 10 : undefined;

    let extra: { id?: string; note?: string; keywords?: string[] } = {};
    try {
      extra = JSON.parse((row as HTMLElement).dataset.extra || '{}') || {};
    } catch {}

    if (cName && cWeight > 0) {
      syllabus.push({
        id: extra.id || `comp_${idx + 1}`,
        name: cName,
        type: cType,
        totalWeight: cWeight,
        count: cCount,
        ...(cCount && cOutOf && cOutOf > cCount ? { outOf: cOutOf } : {}),
        unitWeight: uWeight,
        ...(extra.note ? { note: extra.note } : {}),
        ...(Array.isArray(extra.keywords) && extra.keywords.length > 0 ? { keywords: extra.keywords } : {})
      });
    }
  });

  const courseId = editingCourseId || `course_${Date.now()}`;
  const courseConfig: UserCourseConfig = {
    id: courseId,
    courseCode: code,
    courseName: name,
    crn: crn || undefined,
    ...(credits > 0 ? { creditHours: credits } : {}),
    colorHex: hex,
    aliases,
    scheduleSlots: slots,
    syllabus
  };

  let nextCourses: UserCourseConfig[];
  if (editingCourseId) {
    nextCourses = currentUserCourses.map(c => c.id === editingCourseId ? courseConfig : c);
  } else {
    nextCourses = [...currentUserCourses, courseConfig];
  }

  await handleCoursesUpdated(nextCourses);
  closeCourseEditor();
  showToast(`Saved course "${name}"`);
}

async function handleDeleteCourse(courseId: string, courseName: string) {
  if (!confirm(`Are you sure you want to delete "${courseName}"? Existing deadlines will remain but will no longer match this course schedule.`)) {
    return;
  }
  const nextCourses = currentUserCourses.filter(c => c.id !== courseId);
  await handleCoursesUpdated(nextCourses);
  showToast(`Deleted "${courseName}"`);
}

async function handleCoursesUpdated(courses: UserCourseConfig[]) {
  currentUserCourses = courses;
  await saveUserCourses(courses);
  currentTasks = await recalculateTasksWithActiveCourses();
  currentTasks.sort(compareTasksByTime);

  renderUserCoursesManager();
  renderLegend();
  updateCourseFilterOptions(currentTasks);
  refreshAllViews();

  // Cloud sync to Firebase
  const settings = await getSettings();
  const tombstones = await getLocalTombstones();
  const coursesUpdatedAt = await getCoursesUpdatedAt();
  pushTasksToFirebase(currentTasks, 'Course Configuration Update', settings.syncKey, currentQuickLinks, tombstones, courses, coursesUpdatedAt || undefined, (await getQuickLinksUpdatedAt()) || undefined).catch(() => {});
}

// ============================================================================
// Smart Course & Schedule Importer Modal
// ============================================================================
let detectedImportCourses: CourseDraft[] = [];

/** pdf.js ships inside the extension and is loaded only when a PDF is imported. */
async function loadPdfJs(): Promise<PdfJsLike> {
  const pdfjs = await import(/* @vite-ignore */ chrome.runtime.getURL('vendor/pdfjs/pdf.min.js'));
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.js');
  return pdfjs;
}

function setImportStatus(text: string) {
  const el = document.getElementById('import-status');
  if (el) el.textContent = text;
}

async function openCourseImporter() {
  const modal = document.getElementById('modal-course-import');
  if (!modal) return;
  detectedImportCourses = [];
  const previewContainer = document.getElementById('import-banner-preview-container');
  if (previewContainer) previewContainer.style.display = 'none';
  const bannerText = document.getElementById('import-banner-text') as HTMLTextAreaElement;
  if (bannerText) bannerText.value = '';
  const jsonText = document.getElementById('import-json-text') as HTMLTextAreaElement;
  if (jsonText) jsonText.value = '';
  const fileInput = document.getElementById('input-import-document') as HTMLInputElement | null;
  if (fileInput) fileInput.value = '';
  const fileLabel = document.getElementById('import-file-label');
  if (fileLabel) fileLabel.textContent = 'Choose a PDF, Word or text file';
  setImportStatus('');
  // The AI choice only shows when a model is set up
  const aiRow = document.getElementById('import-ai-row');
  if (aiRow) aiRow.hidden = !resolveAiEndpoint(await getSettings());

  switchImporterTab('banner');
  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function closeCourseImporter() {
  const modal = document.getElementById('modal-course-import');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
}

function switchImporterTab(tab: 'banner' | 'json') {
  const tabBanner = document.getElementById('tab-import-banner');
  const tabJson = document.getElementById('tab-import-json');
  const contentBanner = document.getElementById('tab-content-banner');
  const contentJson = document.getElementById('tab-content-json');

  if (tab === 'banner') {
    tabBanner?.classList.add('active');
    tabJson?.classList.remove('active');
    if (contentBanner) contentBanner.style.display = 'block';
    if (contentJson) contentJson.style.display = 'none';
  } else {
    tabBanner?.classList.remove('active');
    tabJson?.classList.add('active');
    if (contentBanner) contentBanner.style.display = 'none';
    if (contentJson) contentJson.style.display = 'block';
  }
}

async function handleImportDocumentFile(file: File) {
  const label = document.getElementById('import-file-label');
  if (label) label.textContent = file.name;
  setImportStatus(`Reading ${file.name}...`);
  try {
    const text = await fileToText(file, loadPdfJs);
    const area = document.getElementById('import-banner-text') as HTMLTextAreaElement | null;
    if (area) area.value = text;
    await handlePreviewBanner();
  } catch (e: any) {
    setImportStatus(String(e?.message || 'That file could not be read.'));
  }
}

async function handlePreviewBanner() {
  const text = (document.getElementById('import-banner-text') as HTMLTextAreaElement)?.value || '';
  const container = document.getElementById('import-banner-preview-container');
  const list = document.getElementById('import-banner-preview-list');
  if (!text.trim()) {
    setImportStatus('Choose a file or paste the text first.');
    return;
  }
  const useAi = !document.getElementById('import-ai-row')?.hidden && (document.getElementById('import-use-ai') as HTMLInputElement | null)?.checked;
  const ai = useAi ? resolveAiEndpoint(await getSettings()) : null;
  setImportStatus(ai ? 'Reading it with your AI model...' : 'Looking for courses...');
  const result = await findCoursesInDocument(text, ai);
  detectedImportCourses = result.courses;
  if (!container || !list) return;
  if (!detectedImportCourses.length) {
    container.style.display = 'none';
    setImportStatus(`No courses found${result.aiProblem ? ` (AI: ${result.aiProblem})` : ''}. Check the text above, or add the course yourself with Add Course.`);
    return;
  }
  const n = detectedImportCourses.length;
  setImportStatus(`Found ${n} course${n === 1 ? '' : 's'}${result.source === 'ai' ? ' with your AI model' : ''}.${result.aiProblem ? ` The AI could not help (${result.aiProblem}), so the built-in reader was used.` : ''}`);
  list.innerHTML = courseImportReviewHtml(detectedImportCourses, currentUserCourses);
  container.style.display = 'block';
}

async function handleConfirmBannerImport() {
  const list = document.getElementById('import-banner-preview-list');
  if (!list || !detectedImportCourses.length) return;
  const picks = readCourseImportReview(list, detectedImportCourses);
  if (!picks.length) {
    showToast('Nothing ticked to save.');
    return;
  }
  await handleCoursesUpdated(applyCourseImport(currentUserCourses, picks));
  closeCourseImporter();
  showToast(`Saved ${picks.length} course${picks.length === 1 ? '' : 's'}. They sync to your phone.`);
}

async function handleConfirmJsonImport() {
  const jsonText = (document.getElementById('import-json-text') as HTMLTextAreaElement)?.value || '';
  if (!jsonText.trim()) {
    showToast('Please paste JSON course data or select a file.');
    return;
  }
  try {
    const parsed = parseCoursesFromJson(jsonText);
    if (parsed.length === 0) {
      showToast('No valid courses found in JSON.');
      return;
    }
    const merged = mergeImportedCourses(currentUserCourses, parsed);
    await handleCoursesUpdated(merged);
    closeCourseImporter();
    showToast(`Imported ${parsed.length} courses from JSON!`);
  } catch (err: any) {
    alert(`Invalid JSON format: ${err.message || err}`);
  }
}

function exportCoursesJson() {
  const jsonStr = JSON.stringify(currentUserCourses, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'blackboarder-courses.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Exported blackboarder-courses.json');
}

async function handleResetCourses() {
  // There are no built-in courses: a reset starts empty and the next scan fills it in
  if (!confirm('Remove all courses? Your next Blackboard scan adds the courses you are enrolled in.')) {
    return;
  }
  await saveUserCourses([]);
  await handleCoursesUpdated([]);
  showToast('Courses cleared. Scan Blackboard to add yours.');
}

// ============================================================================
// Toast & Native Share Helpers
// ============================================================================
function showToast(message: string, actionText?: string, onAction?: () => void) {
  const container = document.getElementById('toast-container');
  if (!container) return;

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

async function shareTask(task: DeadlineTask) {
  const dueFormatted = new Date(task.dueDate).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: task.hasSpecificTime ? '2-digit' : undefined,
    minute: task.hasSpecificTime ? '2-digit' : undefined
  });
  const text = `📌 ${task.title}\n📚 ${task.courseCode || task.courseName}\n⏰ Due: ${dueFormatted}${task.room ? '\n📍 Room: ' + task.room : ''}${task.weightDisplay ? '\n⚖️ ' + task.weightDisplay : ''}\n\nManaged with Blackboarder`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: task.title,
        text
      });
      return;
    } catch (err: any) {
      if (err.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast('Task details copied to clipboard!');
  } catch (e) {
    showToast('Could not copy task details.');
  }
}

// ============================================================================
// Courses tab: Grades (GPA with every mark) and Syllabus Progress
// ============================================================================
function renderGradeTracker(tasks: DeadlineTask[]) {
  const gradesCard = document.getElementById('grades-tracker');
  const syllabusCard = document.getElementById('syllabus-tracker');
  const hasCoursesOrTasks = currentUserCourses.length > 0 || tasks.length > 0;
  if (gradesCard) gradesCard.style.display = hasCoursesOrTasks ? '' : 'none';
  if (syllabusCard) syllabusCard.style.display = hasCoursesOrTasks ? '' : 'none';
  if (!hasCoursesOrTasks) return;

  // Grades card: the projected GPA, then each course's grade with its marks under it
  const gradesBadge = document.getElementById('grades-tracker-badge');
  const gradesBody = document.getElementById('grades-tracker-breakdown');
  if (gradesBadge && gradesBody) {
    const profile = getCachedProfile();
    const scale = profileGradeScale(profile);
    const uni = profileUniversity(profile);
    const syllabi = getAllSyllabi();
    const gpa = buildGpaSummary(tasks, syllabi, scale);
    const marks = buildMarksSummary(tasks, syllabi);
    gradesBadge.textContent = gradesBadgeText(gpa, marks);
    gradesBody.innerHTML = gradesHtml(gpa, marks, name => getCourseHex(name), {
      name: profile?.gradeScale ? 'Your' : uni.shortName === 'Other' ? 'Standard' : uni.shortName,
      scale,
      fromSyllabus: !profile?.gradeScale && uni.cutoffsFromSyllabus
    });
  }

  // Syllabus Progress card
  const sylBadge = document.getElementById('syllabus-tracker-badge');
  const sylBody = document.getElementById('syllabus-tracker-breakdown');
  if (sylBadge && sylBody) {
    const progress = buildSyllabusProgress(tasks, getAllSyllabi());
    sylBadge.textContent = `${progress.overallPercent}% done`;
    sylBody.innerHTML = syllabusProgressHtml(progress, name => getCourseHex(name));
  }
}

function initGradeTrackerToggle() {
  wireCollapsible('grades-tracker-toggle-btn', 'grades-tracker-breakdown');
  wireCollapsible('syllabus-tracker-toggle-btn', 'syllabus-tracker-breakdown');
}

/** Opens and closes a Courses tab card; the open state is remembered per card. */
function wireCollapsible(btnId: string, bodyId: string) {
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


// ============================================================================
// Details View (Task Cards List)
// ============================================================================
function updateStats(tasks: DeadlineTask[]) {
  const now = Date.now();
  const pendingTasks = tasks.filter(t => t.status === 'pending');

  let urgent = 0;
  let thisWeek = 0;

  for (const t of pendingTasks) {
    const dueTime = new Date(t.dueDate).getTime();
    const diffHours = (dueTime - now) / (1000 * 3600);

    // Same window as the toolbar badge: due within 48h, or overdue by less than 12h
    if (diffHours > -12 && diffHours <= 48) {
      urgent++;
    }
    if (diffHours > 0 && diffHours <= 168) {
      thisWeek++;
    }
  }

  statUrgentCount.textContent = String(urgent);
  statWeekCount.textContent = String(thisWeek);
  statTotalCount.textContent = String(pendingTasks.length);
  navBadgeCount.textContent = String(pendingTasks.length);

  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const allCount = tasks.length;
  const btnPending = document.querySelector('.filter-chip[data-status="pending"]');
  const btnAll = document.querySelector('.filter-chip[data-status="all"]');
  const btnCompleted = document.querySelector('.filter-chip[data-status="completed"]');
  if (btnPending) btnPending.textContent = `Pending (${pendingTasks.length})`;
  if (btnAll) btnAll.textContent = `All (${allCount})`;
  if (btnCompleted) btnCompleted.textContent = `Completed (${completedCount})`;
}

function updateCourseFilterOptions(tasks: DeadlineTask[]) {
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

function renderTasks() {
  const filtered = currentTasks.filter(task => {
    if (currentFilterStatus === 'pending' && task.status !== 'pending') return false;
    if (currentFilterStatus === 'completed' && task.status !== 'completed') return false;

    if (currentFilterCourse !== 'all') {
      const resolved = resolveCourseInfo(task);
      const match = (task.courseCode === currentFilterCourse) ||
                    (task.courseName === currentFilterCourse) ||
                    (resolved.courseName === currentFilterCourse) ||
                    (resolved.courseCode === currentFilterCourse);
      if (!match) return false;
    }

    if (currentFilterType !== 'all' && task.type !== currentFilterType) {
      return false;
    }

    if (currentSearchQuery) {
      const q = currentSearchQuery.toLowerCase();
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

  // Sort tasks: pending first, sorted by dueDate ascending (earliest first); completed/marked tasks newest first
  filtered.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    if (a.status === 'completed' && b.status === 'completed') {
      const parse = (d?: string) => {
        if (!d) return NaN;
        const n = new Date(d).getTime();
        return isNaN(n) ? NaN : n;
      };
      const timeA = parse(a.gradedAt) || parse(a.dueDate) || parse(a.submittedAt) || parse(a.updatedAt) || -Infinity;
      const timeB = parse(b.gradedAt) || parse(b.dueDate) || parse(b.submittedAt) || parse(b.updatedAt) || -Infinity;
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
        <div class="empty-title">${currentTasks.length === 0 ? 'No Deadlines Extracted Yet' : 'No Matching Deadlines'}</div>
        <div class="empty-desc">
          ${currentTasks.length === 0
            ? 'Open Blackboard (e.g. <b>blackboard.sharjah.ac.ae</b>) in a browser tab and click <b>Scan Page</b> to automatically extract upcoming quizzes and assignments!'
            : 'Try adjusting your filters or search terms.'}
        </div>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();

  filtered.forEach(task => {
    const countdown = formatCountdown(task.dueDate, task.hasSpecificTime, task.status);
    const isCompleted = task.status === 'completed';
    const resolved = resolveCourseInfo(task);
    const courseTheme = getCourseColorTheme(resolved.courseName, resolved.courseCode, task.title);
    const gcalUrl = createGoogleCalendarUrl(task);

    // Room pill button (1-click room changer - only if not hw or project)
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

    // Weight badge
    let weightBadgeHtml = '';
    if (task.weightDisplay || task.weight) {
      const weightVal = task.weight || 0;
      const isMajor = weightVal >= 20;
      const isMedium = weightVal >= 10 && weightVal < 20;
      const weightClass = isMajor ? 'weight-major' : (isMedium ? 'weight-medium' : '');
      const displayText = task.weightDisplay || `${task.weight}% of Grade`;
      weightBadgeHtml = `<span class="task-weight-pill ${weightClass}" title="${task.syllabusNote ? escapeHtml(task.syllabusNote) : 'Syllabus weight'}">${getSvgIcon('scale', 'mr-1')} ${escapeHtml(displayText)}</span>`;
    }

    // Class Time Indicator
    let classTimeBadgeHtml = '';
    if (!task.hasSpecificTime) {
      classTimeBadgeHtml = `<span class="meta-pill time-class">${getSvgIcon('clock', 'mr-1')} Class Time</span>`;
    }

    // Clean Doctor's announcement quote with expand/collapse toggle
    const doctorQuoteHtml = renderDoctorQuoteHtml(task, resolved.courseName, resolved.courseCode, 'quote-body-');

    // Student Personal Notes
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
      <!-- Course Banner with Permanent Subject Color -->
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

      <!-- Task Title & Done Toggle -->
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

      <!-- Card Action Buttons matching website -->
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

    // Card body click opens reading sheet
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button, a, input, select')) return;
      openReadingSheet(task);
    });

    // Inspect quote click
    card.querySelector('.btn-inspect-quote')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openReadingSheet(task);
    });

    // Toggle quote expansion
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

    // Quote box click opens full reading sheet
    card.querySelector('.doctor-quote-box')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.btn-toggle-quote, .btn-inspect-quote')) return;
      openReadingSheet(task);
    });

    // Room pill button
    card.querySelector('.room-pill-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openRoomPicker(task.id);
    });

    // Share button
    card.querySelector('.btn-share-card')?.addEventListener('click', (e) => {
      e.stopPropagation();
      shareTask(task);
    });

    // Edit button
    card.querySelector('.btn-edit-card')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(task);
    });

    // Toggle Done
    const handleToggleDone = async (e: Event) => {
      e.stopPropagation();
      const prevStatus = task.status;
      const nextStatus: TaskStatus = isCompleted ? 'pending' : 'completed';
      currentTasks = applyTaskUpdateLocal(task.id, { status: nextStatus });

      // Immediate in-place visual feedback on the card
      const nowCompleted = nextStatus === 'completed';
      card.classList.toggle('status-completed', nowCompleted);
      card.classList.toggle('is-completed', nowCompleted);

      if (currentFilterStatus === 'all') {
        const toggleBtn = card.querySelector('.btn-card-toggle');
        if (toggleBtn) {
          toggleBtn.innerHTML = nowCompleted
            ? `${getSvgIcon('refresh', 'mr-1')} <span class="btn-responsive-label">Mark Pending</span>`
            : `${getSvgIcon('check', 'mr-1')} <span class="btn-responsive-label">Mark Done</span>`;
        }
        updateStats(currentTasks);
        dirtyViews.add('calendar');
        dirtyViews.add('courses');
      } else {
        refreshAllViews();
      }

      syncTasksToCloud(currentTasks, 'Status Change');
      showToast(
        nextStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
        'Undo',
        async () => {
          currentTasks = applyTaskUpdateLocal(task.id, { status: prevStatus });
          refreshAllViews();
          syncTasksToCloud(currentTasks, 'Revert Status Change');
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

// ============================================================================
// MODAL MANAGERS: Reading Sheet, Room Picker & Extract
// ============================================================================

function openReadingSheet(task: DeadlineTask) {
  const modal = document.getElementById('modal-reading-sheet');
  const badgeGroup = document.getElementById('reading-modal-badges');
  const content = document.getElementById('reading-modal-content');
  if (!modal || !badgeGroup || !content) return;

  const resolved = resolveCourseInfo(task);
  const courseTheme = getCourseColorTheme(resolved.courseName, resolved.courseCode, task.title);
  const isCompleted = task.status === 'completed';
  const isHwOrProject = task.type === 'assignment' || (task.type as string) === 'hw' || task.type === 'project';
  const countdown = formatCountdown(task.dueDate, task.hasSpecificTime, task.status);
  const gcalUrl = createGoogleCalendarUrl(task);

  const fullAnnouncement = (task.description || task.sourceSnippet || '').trim();
  const hasAnnouncement = fullAnnouncement && !fullAnnouncement.startsWith('Blackboard Ultra Stream item');

  badgeGroup.innerHTML = `
    <div class="course-badge-main reading-course-badge" title="${escapeHtml(resolved.courseName)}${resolved.courseCode && resolved.courseCode !== 'UOS' ? ` (${escapeHtml(resolved.courseCode)})` : ''}">
      <span class="course-color-dot" style="background: ${courseTheme.hex};"></span>
      <span class="course-name-text">${escapeHtml(resolved.courseName)}</span>
    </div>
    <span class="type-pill type-${escapeHtml(task.type || 'assignment')}">
      <span>${getTaskTypeIcon(task.type)}</span>
      <span>${(task.type || 'assignment').toUpperCase()}</span>
    </span>
  `;

  content.innerHTML = `
    <h2 class="reading-pane-title">${escapeHtml(task.title)}</h2>

    <div class="reading-meta-section">
      <span class="urgency-badge ${countdown.urgency}">
        ${countdown.urgency === 'completed'
          ? `${getSvgIcon('check', 'mr-1')} ${escapeHtml(countdown.label)}`
          : (countdown.urgency === 'overdue' ? `${getSvgIcon('urgent', 'mr-1')} ${escapeHtml(countdown.label)}` : `${getSvgIcon('clock', 'mr-1')} ${escapeHtml(countdown.label)}`)}
      </span>
      ${!isHwOrProject ? `
      <button type="button" class="room-pill-btn modal-reading-room-btn" data-task-id="${escapeHtml(task.id)}">
        <span>${getSvgIcon('pin', 'mr-1')} ${escapeHtml(task.room || 'No room set')}</span>
        <span class="room-edit-hint">${getSvgIcon('pencil')}</span>
      </button>
      ` : ''}
      ${task.weightDisplay || task.weight ? `<span class="task-weight-pill weight-major">${getSvgIcon('scale', 'mr-1')} ${escapeHtml(task.weightDisplay || `${task.weight}%`)}</span>` : ''}
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
      ${task.priority === 'high' ? '<span class="high-priority-tag">HIGH PRIORITY</span>' : ''}
    </div>

    <div class="reading-announcement-box">
      <div class="reading-box-header">
        <span class="reading-box-title">
          <span>${getSvgIcon('message', 'mr-1')}</span>
          <span>Doctor Announcement</span>
        </span>
        ${hasAnnouncement ? `
          <button type="button" class="btn-copy-announcement" id="btn-copy-drawer-text">
            <span>${getSvgIcon('copy', 'mr-1')} Copy</span>
          </button>
        ` : ''}
      </div>
      <div class="reading-box-content">
        ${hasAnnouncement ? escapeHtml(fullAnnouncement) : '<span style="color: var(--text-muted);">No detailed announcement text available.</span>'}
      </div>
    </div>

    ${task.notes && task.notes.trim() ? `
      <div class="reading-notes-box">
        <div class="reading-notes-header">
          ${getSvgIcon('pencil')}
          <span>Student Personal Notes</span>
        </div>
        <div class="reading-notes-content">${escapeHtml(task.notes)}</div>
      </div>
    ` : ''}

    <div class="reading-actions-bar">
      <button type="button" class="btn-primary-action modal-reading-toggle-btn">
        ${isCompleted ? `${getSvgIcon('refresh', 'mr-1')} Mark Pending` : `${getSvgIcon('check', 'mr-1')} Mark Done`}
      </button>
      <button type="button" class="btn-outline-action modal-reading-share-btn">
        <span>${getSvgIcon('share', 'mr-1')} Share</span>
      </button>
      <a class="btn-outline-action modal-reading-gcal-btn" href="${gcalUrl}" target="_blank" rel="noopener noreferrer">
        <span>${getSvgIcon('calendar', 'mr-1')} G-Cal</span>
      </a>
      <button type="button" class="btn-outline-action modal-reading-edit-btn">
        <span>${getSvgIcon('pencil', 'mr-1')} Edit</span>
      </button>
    </div>
  `;

  content.querySelector('#btn-copy-drawer-text')?.addEventListener('click', () => {
    navigator.clipboard.writeText(fullAnnouncement).then(() => {
      showToast('Announcement text copied to clipboard!');
    });
  });

  content.querySelector('.modal-reading-room-btn')?.addEventListener('click', () => {
    closeReadingSheet();
    openRoomPicker(task.id);
  });

  content.querySelector('.modal-reading-toggle-btn')?.addEventListener('click', async () => {
    const nextStatus: TaskStatus = isCompleted ? 'pending' : 'completed';
    currentTasks = applyTaskUpdateLocal(task.id, { status: nextStatus });
    refreshAllViews();
    syncTasksToCloud(currentTasks, 'Status Change');
    closeReadingSheet();
    showToast(nextStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending');
  });

  content.querySelector('.modal-reading-share-btn')?.addEventListener('click', () => {
    shareTask(task);
  });

  content.querySelector('.modal-reading-edit-btn')?.addEventListener('click', () => {
    closeReadingSheet();
    openEditModal(task);
  });

  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function closeReadingSheet() {
  const modal = document.getElementById('modal-reading-sheet');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
}

let activeRoomPickerTaskId: string | null = null;

function openRoomPicker(taskId: string) {
  const task = currentTasks.find(t => t.id === taskId);
  if (!task) return;
  activeRoomPickerTaskId = taskId;

  const modal = document.getElementById('modal-room-picker');
  const presetsContainer = document.getElementById('room-presets-container');
  const customInput = document.getElementById('input-custom-room') as HTMLInputElement;
  if (!modal || !presetsContainer) return;

  const currentRoom = (task.room || '').trim();
  if (customInput) customInput.value = currentRoom;

  // Presets are the rooms on the student's own courses, one button per room
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

  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function closeRoomPicker() {
  const modal = document.getElementById('modal-room-picker');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
  activeRoomPickerTaskId = null;
}

async function applyRoomChange(taskId: string, newRoom: string) {
  const cleanedRoom = (newRoom || '').trim();
  currentTasks = applyTaskUpdateLocal(taskId, { room: cleanedRoom || undefined, userEdited: true });
  refreshAllViews();
  syncTasksToCloud(currentTasks, 'Room Change');
  showToast(`Room updated to "${cleanedRoom || 'None'}"`);
}

// Refresh all views after task change
let refreshScheduled = false;
function refreshAllViews() {
  if (refreshScheduled) return;
  refreshScheduled = true;
  requestAnimationFrame(() => {
    refreshScheduled = false;
    renderAllViewsNow();
  });
}

function updateBrandBadge(): void {
  const badge = document.querySelector<HTMLElement>('.brand-badge');
  if (!badge) return;
  const cached = getCachedProfile();
  const uni = profileUniversity(cached);
  badge.textContent = uni.shortName || 'UOS';
}

function renderAllViewsNow() {
  updateBrandBadge();
  updateStats(currentTasks);
  updateCourseFilterOptions(currentTasks);
  renderQuickLinksBar();

  if (currentActiveView === 'calendar') {
    renderCalendar();
    renderSelectedDay();
  } else if (currentActiveView === 'details') {
    renderTasks();
  } else if (currentActiveView === 'courses') {
    renderGradeTracker(currentTasks);
    renderUserCoursesManager();
  } else if (currentActiveView === 'settings') {
    renderUserCoursesManager();
  }

  // Mark non-active views dirty so they re-render on navigation
  (['calendar', 'details', 'courses', 'settings'] as AppView[]).forEach(v => {
    if (v !== currentActiveView) {
      dirtyViews.add(v);
    }
  });

  if (dayExpandedDrawer && dayExpandedDrawer.classList.contains('open')) {
    openDayExpandedDrawer(selectedDateStr);
  }
}

// Optimistic UI: in-memory state is the source of truth, storage writes are debounced
let persistChain: Promise<void> = Promise.resolve();
let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTasksToPersist: DeadlineTask[] | null = null;

function persistTasksInBackground(tasks: DeadlineTask[], immediate = false): Promise<void> {
  pendingTasksToPersist = tasks;
  if (persistDebounceTimer) {
    clearTimeout(persistDebounceTimer);
    persistDebounceTimer = null;
  }
  if (immediate) {
    const toSave = pendingTasksToPersist;
    pendingTasksToPersist = null;
    persistChain = persistChain.then(() => saveTasksMergingLatest(toSave)).then(() => {}).catch(() => {});
    return persistChain;
  }
  return new Promise<void>(resolve => {
    persistDebounceTimer = setTimeout(() => {
      if (pendingTasksToPersist) {
        const toSave = pendingTasksToPersist;
        pendingTasksToPersist = null;
        persistChain = persistChain.then(() => saveTasksMergingLatest(toSave)).then(() => {}).catch(() => {}).finally(resolve);
      } else {
        resolve();
      }
    }, 150);
  });
}

function applyTaskUpdateLocal(taskId: string, updates: Partial<DeadlineTask>): DeadlineTask[] {
  const now = new Date().toISOString();
  currentTasks = currentTasks.map(t => (t.id === taskId ? { ...t, ...updates, updatedAt: now } : t));
  persistTasksInBackground(currentTasks);
  return currentTasks;
}

function removeTaskLocal(taskId: string): DeadlineTask[] {
  currentTasks = currentTasks.filter(t => t.id !== taskId);
  persistTasksInBackground(currentTasks);
  return currentTasks;
}

const LEGACY_NAMELESS_CLEANUP_KEY = 'bbs_cleanup_nameless_v1';
function readLocalFlag(key: string): Promise<boolean> {
  return new Promise(resolve => {
    const local = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
    if (!local) { resolve(true); return; }
    try { local.get([key], res => resolve(Boolean(res?.[key]))); } catch { resolve(true); }
  });
}
function writeLocalFlag(key: string): Promise<void> {
  return new Promise(resolve => {
    const local = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
    if (!local) { resolve(); return; }
    try { local.set({ [key]: new Date().toISOString() }, () => resolve()); } catch { resolve(); }
  });
}

let tombstoneChain: Promise<void> = Promise.resolve();
function recordLocalTombstone(taskId: string): Promise<void> {
  tombstoneChain = tombstoneChain.then(() => writeLocalTombstone(taskId)).catch(() => {});
  return tombstoneChain;
}

async function writeLocalTombstone(taskId: string): Promise<void> {
  try {
    const raw = await new Promise<any>(resolve => {
      chrome.storage?.local?.get(['bbs_tombstones'], res => resolve(res?.bbs_tombstones || {}));
    });
    const map = (typeof raw === 'object' && raw) ? { ...raw } : {};
    map[taskId] = new Date().toISOString();
    await new Promise<void>(resolve => {
      chrome.storage?.local?.set({ bbs_tombstones: map }, () => resolve());
    });
  } catch {}
}

async function removeLocalTombstone(taskId: string): Promise<void> {
  try {
    const raw = await new Promise<any>(resolve => {
      chrome.storage?.local?.get(['bbs_tombstones'], res => resolve(res?.bbs_tombstones || {}));
    });
    if (typeof raw === 'object' && raw && raw[taskId]) {
      delete raw[taskId];
      await new Promise<void>(resolve => {
        chrome.storage?.local?.set({ bbs_tombstones: raw }, () => resolve());
      });
    }
  } catch {}
}

async function getLocalTombstones(): Promise<Record<string, string>> {
  try {
    const raw = await new Promise<any>(resolve => {
      chrome.storage?.local?.get(['bbs_tombstones'], res => resolve(res?.bbs_tombstones || {}));
    });
    return (typeof raw === 'object' && raw) ? raw : {};
  } catch {
    return {};
  }
}

/**
 * Automatically pushes deadlines to Firebase Realtime Database and Sync Server.
 * Debounces rapid successive updates (e.g. status toggles) to prevent network stalls.
 */
let cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCloudSyncAction = 'Extension Update';

function syncTasksToCloud(tasks: DeadlineTask[], actionDescription: string = 'Extension Update', immediate = false) {
  pendingCloudSyncAction = actionDescription;
  if (cloudSyncTimer) {
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = null;
  }
  if (immediate) {
    executeCloudSync(tasks, actionDescription);
    return;
  }
  cloudSyncTimer = setTimeout(() => {
    executeCloudSync(tasks, pendingCloudSyncAction);
  }, 150);
}

async function executeCloudSync(tasks: DeadlineTask[], actionDescription: string) {
  try {
    await Promise.all([persistChain, tombstoneChain]);
    // Merge in anything the phone changed since the last pull before overwriting the cloud copy
    const pulled = await pullTasksFromFirebaseIfNewer();
    const toPush = pulled ?? tasks;
    const [settings, tombstones, coursesUpdatedAt] = await Promise.all([getSettings(), getLocalTombstones(), getCoursesUpdatedAt()]);

    pushTasksToFirebase(toPush, actionDescription, settings.syncKey, currentQuickLinks, tombstones, currentUserCourses, coursesUpdatedAt || undefined, (await getQuickLinksUpdatedAt()) || undefined).then(res => {
      console.log(`[Firebase Cloud Sync] ${actionDescription}:`, res);
    }).catch(err => {
      console.warn('[Firebase Cloud Sync error]:', err);
    });

    try {
      const channel = new BroadcastChannel('bbs_sync_channel');
      channel.postMessage({ type: 'TASKS_UPDATED', timestamp: Date.now() });
      channel.close();
    } catch {}
  } catch (err) {
    console.warn('[Cloud Sync error]:', err);
  }
}

/**
 * Pulls the cloud copy from Firebase and merges it into local state.
 * Returns the merged list when local data changed, otherwise null.
 */
async function pullTasksFromFirebaseIfNewer(): Promise<DeadlineTask[] | null> {
  let result: DeadlineTask[] | null = null;
  try {
    const settings = await getSettings();
    const res = await fetchTasksFromFirebase(settings.syncKey);
    if (res.success && Array.isArray(res.tasks)) {
      const localTombs = await getLocalTombstones();
      const tombstones = mergeTombstones(localTombs, res.tombstones || {});
      if (JSON.stringify(tombstones) !== JSON.stringify(localTombs)) {
        chrome.storage?.local?.set({ bbs_tombstones: tombstones });
      }

      const { tasks, changed } = mergeCloudTasks(currentTasks, res.tasks, tombstones);
      if (changed) {
        // Merge with what is stored now: a scan may have saved marks since this popup read its tasks
        currentTasks = (await saveTasksMergingLatest(tasks)).sort(compareTasksByTime);
        refreshAllViews();
        result = currentTasks;
        console.log('[Firebase Sync] Merged notes & deadline updates from mobile phone/cloud');
      }

      // Quick links: the newer list wins (an empty list is a real choice once it has a stamp)
      const linksPick = pickNewerList(
        { items: currentQuickLinks, updatedAt: await getQuickLinksUpdatedAt() },
        { items: res.quickLinks, updatedAt: res.quickLinksUpdatedAt },
        true
      );
      if (linksPick.fromCloud && linksPick.items && JSON.stringify(linksPick.items) !== JSON.stringify(currentQuickLinks)) {
        currentQuickLinks = linksPick.items;
        await saveQuickLinks(currentQuickLinks, linksPick.updatedAt);
        renderQuickLinksBar();
        renderQuickLinksManager();
      }

      if (Array.isArray(res.courses)) {
        const localUpdatedAt = await getCoursesUpdatedAt();
        const cloudTime = res.coursesUpdatedAt ? new Date(res.coursesUpdatedAt).getTime() : 0;
        const localTime = localUpdatedAt ? new Date(localUpdatedAt).getTime() : 0;

        // Only overwrite local courses if cloud timestamp is newer, or if local has no timestamp yet
        if (!localUpdatedAt || cloudTime > localTime) {
          if (JSON.stringify(res.courses) !== JSON.stringify(currentUserCourses)) {
            currentUserCourses = res.courses;
            await saveUserCourses(currentUserCourses, res.coursesUpdatedAt);
            currentTasks = await recalculateTasksWithActiveCourses();
            renderUserCoursesManager();
            renderLegend();
            updateCourseFilterOptions(currentTasks);
            refreshAllViews();
          }
        }
      }

      // If this is a brand new or uninitialized syncKey node in Firebase, initialize it
      if (res.lastSync === undefined && settings.syncKey) {
        const coursesUpdatedAt = await getCoursesUpdatedAt();
        pushTasksToFirebase(
          currentTasks,
          'Initial Sync Key Provisioning',
          settings.syncKey,
          currentQuickLinks,
          tombstones,
          currentUserCourses,
          coursesUpdatedAt || undefined,
          (await getQuickLinksUpdatedAt()) || undefined
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[Firebase Sync] Could not pull from cloud:', err);
  }
  return result;
}

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// Edit Task Modal Handlers
// ============================================================================
let editingTaskId: string | null = null;

function openEditModal(task: DeadlineTask) {
  editingTaskId = task.id;
  editTaskIdInput.value = task.id;
  editTitleInput.value = task.title;
  const resolved = resolveCourseInfo(task);
  editCourseInput.value = resolved.courseName || resolved.courseCode;

  const d = new Date(task.dueDate);
  if (!isNaN(d.getTime())) {
    editDateInput.value = formatDateKey(d);
    // Leave the time empty for tasks without a specific time, otherwise saving any edit
    // would flip them to "specific time" and discard their class-schedule time
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    editTimeInput.value = task.hasSpecificTime ? `${hh}:${mm}` : '';
  } else {
    editDateInput.value = selectedDateStr;
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

  modalEditTask.style.display = 'flex';
  rememberDraft();
}

function closeEditModal() {
  modalEditTask.style.display = 'none';
  editingTaskId = null;
  rememberDraft();
}

// ============================================================================
// Backup & Restore
// ============================================================================
async function exportJsonBackup() {
  const settings = await getSettings();
  const courses = await getUserCourses();
  const quickLinks = await getQuickLinks();
  const profile = await getProfile().catch(() => null);
  const backupData = {
    version: BUILD_INFO.version,
    exportedAt: new Date().toISOString(),
    tasks: currentTasks,
    courses,
    quickLinks,
    profile,
    settings
  };

  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `blackboarder_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Downloaded full backup with courses, syllabi and deadlines!');
}

async function handleRestoreJson(file: File) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if ((!data.tasks || !Array.isArray(data.tasks)) && (!data.courses || !Array.isArray(data.courses))) {
      alert('Invalid backup file format.');
      return;
    }

    let restoredTaskCount = 0;
    if (data.tasks && Array.isArray(data.tasks)) {
      const existingMap = new Map<string, DeadlineTask>();
      currentTasks.forEach(t => existingMap.set(t.id, t));

      // Merge imported tasks
      // Backup files are untrusted input: drop tasks with unsafe ids or unusable dates
      sanitizeCloudTasks(data.tasks).forEach((t: DeadlineTask) => {
        if (t.title) {
          existingMap.set(t.id, t);
        }
      });

      const merged = Array.from(existingMap.values()).sort(compareTasksByTime);
      await saveTasks(merged);
      currentTasks = merged;
      restoredTaskCount = data.tasks.length;
    }

    let restoredCourseCount = 0;
    if (data.courses && Array.isArray(data.courses)) {
      const sanitizedCourses = sanitizeCloudCourses(data.courses) || [];
      const cleanCourses = filterCleanUserCourses(sanitizedCourses);
      if (cleanCourses.length > 0) {
        await saveUserCourses(cleanCourses);
        currentUserCourses = cleanCourses;
        restoredCourseCount = cleanCourses.length;
      }
    }

    if (data.quickLinks && Array.isArray(data.quickLinks)) {
      const cleanLinks = sanitizeCloudQuickLinks(data.quickLinks);
      if (cleanLinks && cleanLinks.length > 0) {
        await saveQuickLinks(cleanLinks);
        currentQuickLinks = cleanLinks;
      }
    }

    if (data.profile && typeof data.profile === 'object') {
      await saveProfile(data.profile).catch(() => {});
    }

    if (data.settings && typeof data.settings === 'object') {
      await saveSettings(data.settings);
    }

    refreshAllViews();
    syncTasksToCloud(currentTasks, 'Restored Backup', true);
    const msg = restoredCourseCount > 0
      ? `Successfully restored ${restoredTaskCount} deadlines and ${restoredCourseCount} courses!`
      : `Successfully restored ${restoredTaskCount} deadlines!`;
    alert(msg);
  } catch (err) {
    console.error('Failed to parse backup JSON:', err);
    alert('Failed to read or parse the JSON backup file.');
  }
}

// ============================================================================
// Settings Form
// ============================================================================
// The AI key field shows the key of whichever provider is picked; each provider keeps its own
const AI_PROVIDER_UI: Record<AiProvider, { label: string; placeholder: string; keyField: 'openRouterApiKey' | 'ifmApiKey' | 'customAiApiKey'; hint: string }> = {
  openrouter: {
    label: 'OpenRouter API Key (AI Fallback)',
    placeholder: 'sk-or-v1-...',
    keyField: 'openRouterApiKey',
    hint: 'Paid per use. Pick the model below.'
  },
  ifm: {
    label: 'IFM API Key (AI Fallback)',
    placeholder: 'Key from platform.ifm.ai',
    keyField: 'ifmApiKey',
    hint: `Uses ${IFM_MODEL.replace('IFM/', '')}. Get a free key at platform.ifm.ai.`
  },
  custom: {
    label: 'API Key (AI Fallback)',
    placeholder: 'Key for your provider',
    keyField: 'customAiApiKey',
    hint: 'Any service that offers an OpenAI-compatible /chat/completions API.'
  }
};

function selectedAiProvider(): AiProvider {
  const v = (document.getElementById('setting-ai-provider') as HTMLSelectElement | null)?.value;
  return v === 'ifm' || v === 'custom' ? v : 'openrouter';
}

function showAiProviderFields(provider: AiProvider, settings: Partial<UserSettings>): void {
  const ui = AI_PROVIDER_UI[provider];
  const label = document.getElementById('setting-apikey-label');
  const key = document.getElementById('setting-apikey') as HTMLInputElement | null;
  const hint = document.getElementById('setting-ai-provider-hint');
  if (label) label.textContent = ui.label;
  if (key) {
    key.placeholder = ui.placeholder;
    key.value = (settings[ui.keyField] as string) || '';
  }
  if (hint) hint.textContent = ui.hint;
  const custom = document.getElementById('ai-custom-fields');
  if (custom) custom.hidden = provider !== 'custom';
  const orModel = document.getElementById('ai-openrouter-model');
  if (orModel) orModel.hidden = provider !== 'openrouter';
  const baseUrl = document.getElementById('setting-ai-base-url') as HTMLInputElement | null;
  if (baseUrl) baseUrl.value = settings.customAiBaseUrl || '';
  const customModel = document.getElementById('setting-ai-custom-model') as HTMLInputElement | null;
  if (customModel) customModel.value = settings.customAiModel || '';
  const status = document.getElementById('ai-test-status');
  if (status) { status.textContent = ''; status.classList.remove('is-ok'); }
}

/** Re-locks the AI key on the student's server if it changed, and says what the web app will use. */
async function refreshAiKeyLock(force = false): Promise<void> {
  const line = document.getElementById('ai-webapp-status');
  try {
    await ensureAiPass();
    const status = await syncAiKeyLock(await getSettings(), force);
    if (line) line.textContent = describeAiLock(status);
  } catch {
    if (line) line.textContent = describeAiLock('error');
  }
}

/** A custom AI service needs permission to reach its host. Asked once, on a click or edit. */
async function ensureAiHostPermission(baseUrl: string): Promise<boolean> {
  if (!baseUrl || typeof chrome === 'undefined' || !chrome.permissions?.request) return true;
  const origins = [`${new URL(baseUrl).origin}/*`];
  try {
    // Called first so the click still counts as the user's gesture; no prompt if already allowed
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}

async function loadSettingsForm() {
  const settings = await getSettings();
  const aiProviderSelect = document.getElementById('setting-ai-provider') as HTMLSelectElement | null;
  if (aiProviderSelect) aiProviderSelect.value = settings.aiProvider || 'openrouter';
  showAiProviderFields(settings.aiProvider || 'openrouter', settings);
  getAiLockState().then(state => {
    const line = document.getElementById('ai-webapp-status');
    if (line) line.textContent = describeAiLock(state?.status);
  });
  void refreshAiKeyLock();
  (document.getElementById('setting-model') as HTMLSelectElement).value = settings.openRouterModel || 'google/gemini-3.8-flash';
  (document.getElementById('setting-use-ai') as HTMLInputElement).checked = settings.useAiExtraction;
  (document.getElementById('setting-autoscan') as HTMLInputElement).checked = settings.autoScanOnPageLoad;
  (document.getElementById('setting-badge-notif') as HTMLInputElement).checked = settings.badgeNotification;
  (document.getElementById('setting-reminder-hours') as HTMLSelectElement).value = String(settings.reminderHoursBefore || 24);
  const classReminder = document.getElementById('setting-class-reminder') as HTMLSelectElement | null;
  if (classReminder) classReminder.value = String(settings.classReminderMinutes ?? 15);
  const showClasses = document.getElementById('setting-show-classes') as HTMLInputElement | null;
  if (showClasses) showClasses.checked = settings.showClassesInCalendar !== false;
  const settingTheme = document.getElementById('setting-theme') as HTMLSelectElement | null;
  if (settingTheme) settingTheme.value = settings.theme || 'system';

  const settingBbDark = document.getElementById('setting-blackboard-dark-mode') as HTMLInputElement | null;
  if (settingBbDark) settingBbDark.checked = settings.blackboardDarkMode !== false;

  const settingSyncMidnight = document.getElementById('setting-sync-midnight') as HTMLInputElement | null;
  if (settingSyncMidnight) settingSyncMidnight.checked = settings.autoSyncMidnight !== false;
  const settingSyncOnScan = document.getElementById('setting-sync-onscan') as HTMLInputElement | null;
  if (settingSyncOnScan) settingSyncOnScan.checked = settings.autoSyncOnScan !== false;

  const settingSyncKey = document.getElementById('setting-sync-key') as HTMLInputElement | null;
  if (settingSyncKey) settingSyncKey.value = (settings.syncKey || '').toUpperCase();


  // Check Firebase cloud status
  const fbBadge = document.getElementById('firebase-status-badge');
  if (fbBadge) {
    fetchTasksFromFirebase(settings.syncKey).then(res => {
      fbBadge.classList.toggle('is-warn', !res.success);
      if (res.success) {
        fbBadge.innerHTML = `
          <div class="fb-status-main">
            <svg class="ui-icon fb-status-icon"><use href="#icon-flame"></use></svg>
            <span>Firebase Cloud: Online (${res.tasks.length} tasks synced${settings.syncKey ? ` - ${settings.syncKey}` : ''})</span>
          </div>
          <span class="fb-status-sub">24/7 Always Active</span>
        `;
      } else {
        fbBadge.innerHTML = `
          <div class="fb-status-main">
            <svg class="ui-icon fb-status-icon"><use href="#icon-urgent"></use></svg>
            <span>Firebase Cloud: Connecting...</span>
          </div>
          <span class="fb-status-sub">Offline fallback active</span>
        `;
      }
    }).catch(() => {});
  }

}

// ============================================================================
// Scan Active Tab (Incremental from checkpoint by default, or full rescan)
// ============================================================================
function resetScanButton() {
  btnScanTab.disabled = false;
  btnScanTab.style.background = '';
  btnScanTab.innerHTML = `${getSvgIcon('bolt', 'mr-1')}<span>Scan</span>`;
}

let scanButtonResetTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Shows a scan status saved by the scan running in the Blackboard tab. Called on popup open
 * and whenever the status changes, so reopening the popup mid-scan shows the progress again.
 */
function renderScanStatus(status: ScanStatus | null) {
  if (!status) {
    hideScanBanner();
    return;
  }
  const age = Date.now() - new Date(status.updatedAt).getTime();
  if (scanButtonResetTimer) {
    clearTimeout(scanButtonResetTimer);
    scanButtonResetTimer = null;
  }

  if (status.state === 'running') {
    if (age > SCAN_STALE_MS) {
      hideScanBanner();
      resetScanButton();
      return; // the tab was closed or reloaded mid-scan
    }
    btnScanTab.disabled = true;
    const label = status.total ? 'Parse...' : 'Scan...';
    btnScanTab.innerHTML = `${getSvgIcon(status.total ? 'sparkles' : 'refresh', 'mr-1 is-spinning')}<span>${label}</span>`;
    showScanBanner(status.message, 'active');
    return;
  }

  // Finished: only show completion state on the button if it just happened (<15s)
  if (age > 15 * 1000) {
    hideScanBanner();
    resetScanButton();
    return;
  }

  if (status.state === 'done') {
    const added = status.newCount || 0;
    btnScanTab.disabled = false;
    btnScanTab.style.background = '';
    btnScanTab.innerHTML = `${getSvgIcon('check', 'mr-1')}<span>${added > 0 ? `+${added}` : 'Synced'}</span>`;
    const doneMsg = status.message || (added > 0 ? `Scan complete · ${added} new deadline${added > 1 ? 's' : ''} added` : 'Scan complete · All deadlines up to date');
    showScanBanner(doneMsg, 'success', 3500);
    if (added > 0) {
      switchView('calendar');
    }
    scanButtonResetTimer = setTimeout(resetScanButton, 2200);
  } else if (status.state === 'error') {
    btnScanTab.disabled = false;
    btnScanTab.style.background = '';
    btnScanTab.innerHTML = `${getSvgIcon('urgent', 'mr-1')}<span>Failed</span>`;
    showScanBanner(status.message || 'Scan could not complete. Try again.', 'warning', 4000);
    scanButtonResetTimer = setTimeout(resetScanButton, 3000);
  } else {
    hideScanBanner();
    resetScanButton();
  }
}

/**
 * Starts a scan in the active Blackboard tab. The tab does the work and saves the result, so
 * the scan keeps going if the popup closes; progress comes back through renderScanStatus().
 */
async function scanActiveTab(fullRescan: boolean = false) {
  if (scanButtonResetTimer) {
    clearTimeout(scanButtonResetTimer);
    scanButtonResetTimer = null;
  }
  btnScanTab.disabled = true;
  btnScanTab.style.background = '';
  btnScanTab.innerHTML = `${getSvgIcon('refresh', 'mr-1 is-spinning')}<span>Scan...</span>`;
  showScanBanner(
    fullRescan ? 'Full re-scanning Blackboard stream & courses...' : 'Scanning Blackboard page for deadlines...',
    'active'
  );

  const fail = (message: string) => {
    btnScanTab.innerHTML = `${getSvgIcon('urgent', 'mr-1')}<span>Error</span>`;
    showScanBanner(message, 'warning', 4500);
    setTimeout(resetScanButton, 3500);
  };

  if (!chrome.runtime?.sendMessage) {
    fail('Background scanner unavailable.');
    return;
  }

  const startedAt = Date.now();
  chrome.runtime.sendMessage({ type: 'RUN_HTTP_SCAN', fullRescan }, async res => {
    void chrome.runtime.lastError;
    if (res && !res.ok && res.message) {
      fail(res.message);
      return;
    }
    const status = await getScanStatus().catch(() => null);
    if (status && new Date(status.updatedAt).getTime() >= startedAt) {
      renderScanStatus(status);
    } else {
      resetScanButton();
      hideScanBanner();
    }
    await refreshDataInBackground();
  });

  watchScanEnd(startedAt);
}

/**
 * Backstop for a scan that ends without saving a final status:
 * once the background says no scan is running, refresh tasks and reset button.
 */
function watchScanEnd(startedAt: number) {
  const check = () => {
    if (!btnScanTab.disabled || scanButtonResetTimer) return;
    chrome.runtime.sendMessage({ type: 'PING_HTTP_SCANNER' }, async res => {
      const lost = Boolean(chrome.runtime.lastError) || !res?.ok;
      if (!lost && res.scanning) {
        setTimeout(check, 1500);
        return;
      }
      const status = await getScanStatus().catch(() => null);
      if (!btnScanTab.disabled || scanButtonResetTimer) return;
      if (status && status.state !== 'running' && new Date(status.updatedAt).getTime() >= startedAt) {
        renderScanStatus(status);
        await refreshDataInBackground();
        return;
      }
      resetScanButton();
      hideScanBanner();
      if (lost) {
        await refreshDataInBackground();
      }
    });
  };
  setTimeout(check, 1500);
}

// ============================================================================
// Setup Event Listeners
// ============================================================================
function setupEvents() {
  initLegendScroll();

  // Live Scan Notification Dismissal
  document.getElementById('hsb-close')?.addEventListener('click', e => {
    e.stopPropagation();
    hideScanBanner();
  });
  headerScanBanner?.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    if (target.closest('#hsb-close')) return;
    if (headerScanBanner.classList.contains('is-success') || headerScanBanner.classList.contains('is-warning')) {
      hideScanBanner();
    }
  });

  // Top Navigation Tabs
  tabNavCalendar.addEventListener('click', () => switchView('calendar'));
  tabNavDetails.addEventListener('click', () => switchView('details'));
  tabNavCourses.addEventListener('click', () => switchView('courses'));

  // Calendar Controls
  btnCalPrev.addEventListener('click', () => {
    calendarMonth--;
    if (calendarMonth < 0) {
      calendarMonth = 11;
      calendarYear--;
    }
    renderCalendar();
  });

  btnCalNext.addEventListener('click', () => {
    calendarMonth++;
    if (calendarMonth > 11) {
      calendarMonth = 0;
      calendarYear++;
    }
    renderCalendar();
  });

  btnCalToday.addEventListener('click', () => {
    const now = new Date();
    calendarYear = now.getFullYear();
    calendarMonth = now.getMonth();
    selectedDateStr = formatDateKey(now);
    renderCalendar();
    renderSelectedDay();
  });

  // Add deadline on selected day
  btnAddOnDate.addEventListener('click', () => {
    (document.getElementById('add-date') as HTMLInputElement).value = selectedDateStr;
    switchView('add');
  });

  // Expanded Day View Drawer Controls
  btnDrawerClose?.addEventListener('click', closeDayExpandedDrawer);
  dayExpandedBackdrop?.addEventListener('click', closeDayExpandedDrawer);
  btnDrawerAdd?.addEventListener('click', () => {
    closeDayExpandedDrawer();
    openAddModalOnDate(selectedDateStr);
  });

  // Close drawer on Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && dayExpandedDrawer && dayExpandedDrawer.classList.contains('open')) {
      closeDayExpandedDrawer();
    }
  });

  // Header Actions
  btnAddModal.addEventListener('click', () => {
    (document.getElementById('add-date') as HTMLInputElement).value = selectedDateStr;
    switchView('add');
  });
  btnSettingsToggle.addEventListener('click', () => switchView('settings'));
  const themeSelect = document.getElementById('setting-theme') as HTMLSelectElement | null;
  themeSelect?.addEventListener('change', () => {
    setThemeNow((themeSelect.value || 'system') as 'light' | 'dark' | 'system');
  });
  btnCancelAdd.addEventListener('click', () => switchView('calendar'));
  btnCancelSettings.addEventListener('click', () => switchView('calendar'));
  initSettingsNav();

  // Listen to OS theme changes if user has system theme selected
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentThemeSetting === 'system') {
        applyTheme('system');
      }
    });
  }

  // Scan Button (normal click: incremental from checkpoint; Shift+click: full rescan)
  btnScanTab.title = 'Scan Blackboard (Shift+Click for Full Re-scan)';
  btnScanTab.addEventListener('click', (e: MouseEvent) => scanActiveTab(e.shiftKey));

  // Export All ICS
  btnExportAllIcs.addEventListener('click', () => {
    const activeTasks = currentTasks.filter(t => t.status === 'pending');
    if (activeTasks.length === 0) {
      alert('No active deadlines to export.');
      return;
    }
    downloadIcsFile(activeTasks, 'uos_blackboard_deadlines.ics');
  });

  // Filter Tabs in Details View
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilterStatus = (btn.getAttribute('data-status') || 'all') as any;
      renderTasks();
    });
  });

  // Search input
  searchInput.addEventListener('input', e => {
    currentSearchQuery = (e.target as HTMLInputElement).value;
    renderTasks();
  });

  // Course select filter
  filterCourseSelect.addEventListener('change', () => {
    currentFilterCourse = filterCourseSelect.value;
    renderTasks();
  });

  // Type select filter
  filterTypeSelect.addEventListener('change', () => {
    currentFilterType = filterTypeSelect.value;
    renderTasks();
  });

  // Type selection changes dynamically toggle room visibility
  addTypeSelect?.addEventListener('change', updateAddRoomVisibility);
  editTypeSelect?.addEventListener('change', updateEditRoomVisibility);

  // Course fields list the extension's courses and narrow as you type
  attachCoursePicker(document.getElementById('add-course') as HTMLInputElement, () => currentUserCourses);
  attachCoursePicker(editCourseInput, () => currentUserCourses);

  // Keep what is typed into the Add / Edit forms if the popup closes
  for (const form of [formAddTask, formEditTask]) {
    form.addEventListener('input', rememberDraft);
    form.addEventListener('change', rememberDraft);
  }

  // Auto-suggest class meeting time and default room when user enters course in Add Task
  const addCourseInput = document.getElementById('add-course') as HTMLInputElement;
  addCourseInput?.addEventListener('input', () => {
    const courseVal = addCourseInput.value;
    const sched = findCourseSchedule(courseVal);
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

  // Add Task Form Submit
  formAddTask.addEventListener('submit', async e => {
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
    let weight: number | undefined = weightVal ? parseFloat(weightVal) : undefined;
    let weightDisplay: string | undefined = undefined;
    let syllabusNote: string | undefined = undefined;

    if (weight !== undefined && !isNaN(weight)) {
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
      status: 'pending',
      sourceSnippet: notes,
      notes: notes,
      confidence: 1.0,
      extractedBy: 'manual',
      userEdited: true,
      weight,
      weightDisplay,
      syllabusNote,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    currentTasks = deduplicateTaskList(await addTask(newTask));
    currentTasks.sort(compareTasksByTime);
    currentTasks = await saveTasksMergingLatest(currentTasks);

    formAddTask.reset();
    if (addRoomInput) addRoomInput.value = '';
    if (addWeightInput) addWeightInput.value = '';
    if (addWeightHint) addWeightHint.textContent = '';
    selectedDateStr = dateVal;
    refreshAllViews();
    switchView('calendar');
    syncTasksToCloud(currentTasks, 'Added Deadline');
  });

  // Auto-Weight preview button for Add Task
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

  // Edit Modal Form Submit
  formEditTask.addEventListener('submit', async e => {
    e.preventDefault();
    if (!editingTaskId) return;

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

    const weightVal = editWeightInput ? editWeightInput.value.trim() : '';
    let weight: number | undefined = weightVal ? parseFloat(weightVal) : undefined;
    let weightDisplay: string | undefined = undefined;
    let syllabusNote: string | undefined = undefined;

    if (weight !== undefined && !isNaN(weight)) {
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
      description: descVal,
      sourceSnippet: descVal,
      notes: notesVal,
      weight,
      weightDisplay,
      syllabusNote,
      userEdited: true,
      updatedAt: new Date().toISOString()
    };

    currentTasks = currentTasks.map(t => (t.id === editingTaskId ? { ...t, ...updatedTaskFields } : t));
    currentTasks.sort(compareTasksByTime);

    persistTasksInBackground(currentTasks);

    closeEditModal();
    selectedDateStr = dateVal;
    refreshAllViews();

    if (dayExpandedDrawer && dayExpandedDrawer.classList.contains('open')) {
      openDayExpandedDrawer(dateVal);
    }

    syncTasksToCloud(currentTasks, 'Edited Deadline');
  });

  // Auto-Weight preview button for Edit Modal
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

  // Delete button inside edit modal with 5-Second Undo
  btnDeleteFromModal.addEventListener('click', async () => {
    if (!editingTaskId) return;
    const taskToDelete = currentTasks.find(t => t.id === editingTaskId);
    if (!taskToDelete) return;

    recordLocalTombstone(editingTaskId);
    currentTasks = removeTaskLocal(editingTaskId);
    closeEditModal();
    refreshAllViews();
    syncTasksToCloud(currentTasks, 'Deleted Deadline');

    showToast(
      `Deleted "${taskToDelete.title.slice(0, 22)}..."`,
      'Undo',
      async () => {
        await removeLocalTombstone(taskToDelete.id);
        currentTasks = await addTask({ ...taskToDelete, updatedAt: new Date().toISOString() });
        refreshAllViews();
        syncTasksToCloud(currentTasks, 'Restored Deadline');
        showToast('Deadline restored');
      }
    );
  });

  btnCloseEditModal.addEventListener('click', closeEditModal);
  btnCancelEdit.addEventListener('click', closeEditModal);
  modalEditTask.addEventListener('click', e => {
    if (e.target === modalEditTask) closeEditModal();
  });

  // Helper to toggle Blackboard Ultra Dark Theme and broadcast to active tabs
  async function setBlackboardDarkMode(enabled: boolean) {
    await saveSettings({ blackboardDarkMode: enabled });
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ blackboardDarkMode: enabled, darkModeEnabled: enabled });
    }
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      const notifyOrInjectTab = (tab: chrome.tabs.Tab) => {
        if (!tab.id) return;
        const tabId = tab.id;
        chrome.tabs.sendMessage(tabId, {
          action: 'toggleDarkMode',
          type: 'TOGGLE_BLACKBOARD_DARK_MODE',
          enabled
        }).catch(() => {
          if (enabled && chrome.scripting && tab.url && /(?:sharjah\.ac\.ae|blackboard\.com)/i.test(tab.url)) {
            chrome.scripting.insertCSS({
              target: { tabId, allFrames: true },
              files: ['blackboard-dark.css']
            }).catch(() => {});
            chrome.scripting.executeScript({
              target: { tabId, allFrames: true },
              files: ['blackboard-dark.js']
            }).catch(() => {});
          }
        });
      };

      // 1. Instantly notify active tab for zero-latency response
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        tabs?.forEach(notifyOrInjectTab);
      });
      // 2. Broadcast to all open tabs so background Blackboard pages update immediately
      chrome.tabs.query({}, tabs => {
        tabs?.forEach(notifyOrInjectTab);
      });
    }
  }

  // Live instant toggle for Blackboard Dark Mode
  const settingBbDarkToggle = document.getElementById('setting-blackboard-dark-mode') as HTMLInputElement | null;
  settingBbDarkToggle?.addEventListener('change', async () => {
    const isChecked = settingBbDarkToggle.checked;
    await setBlackboardDarkMode(isChecked);
    showToast(`Blackboard Dark Mode ${isChecked ? 'Enabled' : 'Disabled'}`);
  });

  // AI engine settings save as soon as they change. Before, they only saved
  // with the Save button at the bottom, so closing the popup lost the change.
  const settingUseAi = document.getElementById('setting-use-ai') as HTMLInputElement | null;
  const settingApiKey = document.getElementById('setting-apikey') as HTMLInputElement | null;
  settingUseAi?.addEventListener('change', async () => {
    const enabled = settingUseAi.checked;
    await saveSettings({ useAiExtraction: enabled });
    if (enabled && !settingApiKey?.value.trim()) {
      showToast('AI Deep Extraction on - add an API key to use it');
    } else {
      showToast(`AI Deep Extraction ${enabled ? 'Enabled' : 'Disabled'}`);
    }
  });
  settingApiKey?.addEventListener('change', async () => {
    const ui = AI_PROVIDER_UI[selectedAiProvider()];
    await saveSettings({ [ui.keyField]: settingApiKey.value.trim() });
    showToast('API key saved');
  });
  const settingAiProvider = document.getElementById('setting-ai-provider') as HTMLSelectElement | null;
  settingAiProvider?.addEventListener('change', async () => {
    const provider = selectedAiProvider();
    await saveSettings({ aiProvider: provider });
    showAiProviderFields(provider, await getSettings());
    showToast('AI provider saved');
  });
  const settingAiBaseUrl = document.getElementById('setting-ai-base-url') as HTMLInputElement | null;
  settingAiBaseUrl?.addEventListener('change', async () => {
    const base = normalizeAiBaseUrl(settingAiBaseUrl.value);
    if (settingAiBaseUrl.value.trim() && !base) {
      showToast('Base URL must start with https://');
      return;
    }
    settingAiBaseUrl.value = base;
    await saveSettings({ customAiBaseUrl: base });
    if (base && !(await ensureAiHostPermission(base))) {
      showToast('Saved, but access to that site was not allowed');
      return;
    }
    showToast('Base URL saved');
  });
  const settingAiCustomModel = document.getElementById('setting-ai-custom-model') as HTMLInputElement | null;
  settingAiCustomModel?.addEventListener('change', async () => {
    await saveSettings({ customAiModel: settingAiCustomModel.value.trim() });
    showToast('Model saved');
  });
  // Any AI change is passed on to the web app's server once the handlers above have saved it
  for (const id of ['setting-use-ai', 'setting-apikey', 'setting-ai-provider', 'setting-ai-base-url', 'setting-ai-custom-model', 'setting-model']) {
    document.getElementById(id)?.addEventListener('change', () => {
      setTimeout(() => void refreshAiKeyLock(), 500);
    });
  }
  document.getElementById('btn-new-ai-pass')?.addEventListener('click', async () => {
    if (!confirm('Make a new AI pass? Phones lose AI access until you open the new pairing link on them.')) return;
    await saveSettings({ aiPass: newAiPass() });
    await refreshAiKeyLock(true);
    showToast('New AI pass made. Copy the pairing link to your phone again.');
  });
  document.getElementById('btn-test-ai')?.addEventListener('click', async () => {
    const status = document.getElementById('ai-test-status');
    const show = (text: string, ok = false) => {
      if (!status) return;
      status.textContent = text;
      status.classList.toggle('is-ok', ok);
    };
    const provider = selectedAiProvider();
    const key = settingApiKey?.value.trim() || '';
    const endpoint = resolveAiEndpoint({
      aiProvider: provider,
      [AI_PROVIDER_UI[provider].keyField]: key,
      openRouterModel: (document.getElementById('setting-model') as HTMLSelectElement | null)?.value,
      customAiBaseUrl: settingAiBaseUrl?.value,
      customAiModel: settingAiCustomModel?.value
    });
    if (!endpoint) {
      show(provider === 'custom' ? 'Add the base URL, model and key first' : 'Add an API key first');
      return;
    }
    if (provider === 'custom' && !(await ensureAiHostPermission(normalizeAiBaseUrl(settingAiBaseUrl?.value)))) {
      show('Access to that site was not allowed');
      return;
    }
    show('Testing...');
    const result = await testAiEndpoint(endpoint);
    show(result.message, result.ok);
  });
  // Takes effect straight away, like the phone app's switch
  const settingShowClasses = document.getElementById('setting-show-classes') as HTMLInputElement | null;
  settingShowClasses?.addEventListener('change', async () => {
    await saveSettings({ showClassesInCalendar: settingShowClasses.checked });
    dirtyViews.add('calendar');
    renderCalendar();
    renderSelectedDay();
    showToast(settingShowClasses.checked ? 'Classes shown in the calendar' : 'Classes hidden from the calendar');
  });
  const settingClassReminder = document.getElementById('setting-class-reminder') as HTMLSelectElement | null;
  settingClassReminder?.addEventListener('change', async () => {
    const minutes = Math.max(0, parseInt(settingClassReminder.value, 10) || 0);
    await saveSettings({ classReminderMinutes: minutes });
    showToast(minutes ? `Class reminders ${minutes} minutes before` : 'Class reminders off');
  });
  const settingModel = document.getElementById('setting-model') as HTMLSelectElement | null;
  settingModel?.addEventListener('change', async () => {
    await saveSettings({ openRouterModel: settingModel.value });
    showToast('AI model saved');
  });

  const settingBadgeNotif = document.getElementById('setting-badge-notif') as HTMLInputElement | null;
  settingBadgeNotif?.addEventListener('change', async () => {
    await saveSettings({ badgeNotification: settingBadgeNotif.checked });
    try {
      chrome.runtime?.sendMessage?.({ type: 'UPDATE_BADGE' });
    } catch {}
    showToast(settingBadgeNotif.checked ? 'Toolbar badge active' : 'Toolbar badge disabled');
  });

  const settingReminderHours = document.getElementById('setting-reminder-hours') as HTMLSelectElement | null;
  settingReminderHours?.addEventListener('change', async () => {
    const hours = parseInt(settingReminderHours.value, 10) || 24;
    await saveSettings({ reminderHoursBefore: hours });
    showToast(`Notification alert window ${hours}h`);
  });

  const settingSyncMidnight = document.getElementById('setting-sync-midnight') as HTMLInputElement | null;
  settingSyncMidnight?.addEventListener('change', async () => {
    await saveSettings({ autoSyncMidnight: settingSyncMidnight.checked });
    showToast(settingSyncMidnight.checked ? 'Midnight sync on' : 'Midnight sync off');
  });

  const settingSyncOnScan = document.getElementById('setting-sync-onscan') as HTMLInputElement | null;
  settingSyncOnScan?.addEventListener('change', async () => {
    await saveSettings({ autoSyncOnScan: settingSyncOnScan.checked });
    showToast(settingSyncOnScan.checked ? 'Scan sync on' : 'Scan sync off');
  });

  const settingAutoScan = document.getElementById('setting-autoscan') as HTMLInputElement | null;
  settingAutoScan?.addEventListener('change', async () => {
    await saveSettings({ autoScanOnPageLoad: settingAutoScan.checked });
    showToast(settingAutoScan.checked ? 'Auto-scan on' : 'Auto-scan off');
  });

  const settingSyncKeyInput = document.getElementById('setting-sync-key') as HTMLInputElement | null;
  settingSyncKeyInput?.addEventListener('change', async () => {
    const rawVal = settingSyncKeyInput.value;
    const newKey = extractSyncKey(rawVal);
    if (newKey) {
      settingSyncKeyInput.value = newKey;
      const prevSettings = await getSettings();
      await saveSettings({ syncKey: newKey });
      showToast(`Sync Key saved: ${newKey}`);
      void refreshAiKeyLock(true);
      if (newKey !== prevSettings.syncKey) {
        await pullTasksFromFirebaseIfNewer();
        refreshAllViews();
      }
    }
  });

  // Settings Form Submit
  formSettings.addEventListener('submit', async e => {
    e.preventDefault();
    const apiKey = (document.getElementById('setting-apikey') as HTMLInputElement).value;
    const model = (document.getElementById('setting-model') as HTMLSelectElement).value;
    const useAi = (document.getElementById('setting-use-ai') as HTMLInputElement).checked;
    const autoScan = (document.getElementById('setting-autoscan') as HTMLInputElement).checked;
    const badgeNotif = (document.getElementById('setting-badge-notif') as HTMLInputElement).checked;
    const reminderHours = parseInt((document.getElementById('setting-reminder-hours') as HTMLSelectElement).value, 10);

    const syncMidnight = (document.getElementById('setting-sync-midnight') as HTMLInputElement)?.checked ?? true;
    const syncOnScan = (document.getElementById('setting-sync-onscan') as HTMLInputElement)?.checked ?? true;

    const rawSyncKey = (document.getElementById('setting-sync-key') as HTMLInputElement)?.value || '';
    const syncKey = extractSyncKey(rawSyncKey);
    const inputSyncKey = document.getElementById('setting-sync-key') as HTMLInputElement | null;
    if (inputSyncKey && syncKey) inputSyncKey.value = syncKey;
    const selectedTheme = ((document.getElementById('setting-theme') as HTMLSelectElement)?.value || 'system') as 'light' | 'dark' | 'system';
    const bbDark = (document.getElementById('setting-blackboard-dark-mode') as HTMLInputElement)?.checked ?? true;

    const prevSettings = await getSettings();
    const prevSyncKey = prevSettings.syncKey;

    const aiProvider = selectedAiProvider();
    const customBase = normalizeAiBaseUrl((document.getElementById('setting-ai-base-url') as HTMLInputElement | null)?.value);
    const customModel = (document.getElementById('setting-ai-custom-model') as HTMLInputElement | null)?.value.trim() || '';

    await saveSettings({
      [AI_PROVIDER_UI[aiProvider].keyField]: apiKey.trim(),
      aiProvider,
      customAiBaseUrl: customBase,
      customAiModel: customModel,
      openRouterModel: model,
      useAiExtraction: useAi,
      autoScanOnPageLoad: autoScan,
      badgeNotification: badgeNotif,
      reminderHoursBefore: reminderHours,
      autoSyncMidnight: syncMidnight,
      autoSyncOnScan: syncOnScan,
      syncKey,
      theme: selectedTheme,
      blackboardDarkMode: bbDark
    });

    await setBlackboardDarkMode(bbDark);
    // Save always re-sends, e.g. after AI_KEY_SECRET was changed on the server
    void refreshAiKeyLock(true);

    if (syncKey && syncKey !== prevSyncKey) {
      await pullTasksFromFirebaseIfNewer();
      refreshAllViews();
    }

    applyTheme(selectedTheme);
    try {
      localStorage.setItem('bbs_theme', selectedTheme);
      const channel = new BroadcastChannel('bbs_sync_channel');
      channel.postMessage({ type: 'THEME_CHANGED', theme: selectedTheme });
      channel.close();
    } catch {}

    alert('Settings saved successfully!');
    switchView('calendar');
  });

  // Scanner Maintenance Actions
  const btnTriggerFullRescan = document.getElementById('btn-trigger-full-rescan');
  const btnResetCheckpoint = document.getElementById('btn-reset-checkpoint');
  const rescanStatusMsg = document.getElementById('rescan-status-msg');

  btnTriggerFullRescan?.addEventListener('click', async () => {
    if (rescanStatusMsg) {
      rescanStatusMsg.textContent = 'Triggering Full Re-scan on active tab...';
      rescanStatusMsg.style.color = 'var(--text-muted)';
    }
    await scanActiveTab(true);
    if (rescanStatusMsg) {
      rescanStatusMsg.textContent = 'Full re-scan started. Progress shows at the top; you can close this window.';
      rescanStatusMsg.style.color = 'var(--text-main)';
    }
  });

  btnResetCheckpoint?.addEventListener('click', async () => {
    await saveLastScanCheckpoint({
      lastScannedAt: '',
      processedAnnouncementIds: [],
      processedDirectTaskIds: [],
      processedAnnouncementKeys: []
    });
    if (rescanStatusMsg) {
      rescanStatusMsg.textContent = 'Scan cache cleared! Next scan will evaluate all announcements.';
      rescanStatusMsg.style.color = 'var(--text-main)';
    }
    alert('Scan cache has been cleared. Your next scan will examine all announcements from scratch and update existing tasks in place without resetting your data.');
  });

  // Mobile Sync Actions
  const btnSyncToServer = document.getElementById('btn-sync-to-server');
  const btnOpenMobileWeb = document.getElementById('btn-open-mobile-web');
  const btnCopyWebcalLink = document.getElementById('btn-copy-webcal-link');
  const btnCopyPairingLink = document.getElementById('btn-copy-pairing-link');
  const btnCopySyncKey = document.getElementById('btn-copy-sync-key');
  const btnRegenSyncKey = document.getElementById('btn-regen-sync-key');

  // Copy Sync Key
  btnCopySyncKey?.addEventListener('click', async () => {
    const input = document.getElementById('setting-sync-key') as HTMLInputElement;
    if (input && input.value) {
      try {
        await navigator.clipboard.writeText(input.value.trim());
        showToast(`Copied Sync Key: ${input.value.trim()}`);
      } catch {
        prompt('Your Sync Key:', input.value.trim());
      }
    }
  });

  // Regenerate Sync Key
  btnRegenSyncKey?.addEventListener('click', () => {
    const input = document.getElementById('setting-sync-key') as HTMLInputElement;
    const newKey = generateUniqueSyncKey();
    if (input) {
      input.value = newKey;
      showToast(`Generated new Sync Key: ${newKey}. Click Save Settings to apply.`);
    }
  });

  // Recovery file: the sync key is the only way back to the online copy if this browser's data is lost
  document.getElementById('btn-download-recovery-key')?.addEventListener('click', async () => {
    const settings = await getSettings();
    const key = (settings.syncKey || '').trim();
    if (!key) {
      showToast('No sync key yet. Open the Sync page again in a moment.');
      return;
    }
    const lines = [
      'Blackboarder recovery file',
      '',
      'Sync key: ' + key,
      '',
      'This key is the only way back to your online deadlines if you lose the data in this browser.',
      'Anyone who has it can see your deadlines, so keep the file private.',
      '',
      'To restore: install Blackboarder, open Settings > Sync, paste the key into Personal Sync Key and save.',
      'To open it on a phone: ' + COMPANION_URL + '?key=' + encodeURIComponent(key)
    ];
    const url = URL.createObjectURL(new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'blackboarder-recovery-key.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Recovery file saved. Keep it somewhere private.');
  });

  // Delete the copy kept online. Two clicks, since it cannot be undone; the old key is replaced so the
  // next sync starts a fresh folder instead of refilling the deleted one.
  const btnDeleteCloud = document.getElementById('btn-delete-cloud-data') as HTMLButtonElement | null;
  const deleteCloudStatus = document.getElementById('delete-cloud-status');
  let deleteArmedTimer: ReturnType<typeof setTimeout> | null = null;
  const disarmDeleteCloud = () => {
    if (deleteArmedTimer) clearTimeout(deleteArmedTimer);
    deleteArmedTimer = null;
    const label = btnDeleteCloud?.querySelector('span');
    if (label) label.textContent = 'Delete My Online Data';
  };
  btnDeleteCloud?.addEventListener('click', async () => {
    const label = btnDeleteCloud.querySelector('span');
    if (!deleteArmedTimer) {
      if (label) label.textContent = 'Click again to confirm';
      deleteArmedTimer = setTimeout(disarmDeleteCloud, 6000);
      return;
    }
    disarmDeleteCloud();
    btnDeleteCloud.disabled = true;
    const settings = await getSettings();
    const result = await deleteSyncDataFromFirebase(settings.syncKey || '');
    if (result.success) {
      const newKey = generateUniqueSyncKey();
      await saveSettings({ syncKey: newKey });
      const input = document.getElementById('setting-sync-key') as HTMLInputElement | null;
      if (input) input.value = newKey;
      showToast('Online data deleted. You have a new sync key.');
    }
    if (deleteCloudStatus) {
      deleteCloudStatus.style.display = 'block';
      deleteCloudStatus.textContent = result.success
        ? 'Done. Everything stored online under your old key is gone. Pair your phone again from the Sync page.'
        : result.message;
    }
    btnDeleteCloud.disabled = false;
  });

  // The phone app is at /companion/ and the calendar feed at the site root.
  const SITE_URL = 'https://blackboarder.pages.dev';
  const COMPANION_URL = `${SITE_URL}/companion/`;

  // Copy Phone Pairing Link
  btnCopyPairingLink?.addEventListener('click', async () => {
    const aiPass = await ensureAiPass();
    const settings = await getSettings();
    const appBase = COMPANION_URL;
    const pairUrl = pairingLink(appBase, settings.syncKey || '', aiPass);
    try {
      await navigator.clipboard.writeText(pairUrl);
      alert(`Copied Mobile Pairing Link to clipboard:\n${pairUrl}\n\nOpen this link on your phone to view and sync your deadlines. It also lets that phone use your AI model, so only send it to yourself.`);
    } catch {
      prompt('Mobile Pairing Link:', pairUrl);
    }
  });

  // Pairing QR code: the same link as above, for the phone app's scanner
  const btnShowPairingQr = document.getElementById('btn-show-pairing-qr');
  const pairingQrPanel = document.getElementById('pairing-qr-panel');
  btnShowPairingQr?.addEventListener('click', async () => {
    if (!pairingQrPanel) return;
    const label = btnShowPairingQr.querySelector('span');
    if (!pairingQrPanel.hidden) {
      pairingQrPanel.hidden = true;
      btnShowPairingQr.setAttribute('aria-expanded', 'false');
      if (label) label.textContent = 'Show Pairing QR Code';
      return;
    }
    const aiPass = await ensureAiPass();
    const settings = await getSettings();
    if (!settings.syncKey) {
      showToast('No sync key yet. Open the Sync page again in a moment.');
      return;
    }
    const pairUrl = pairingLink(COMPANION_URL, settings.syncKey, aiPass);
    const holder = document.getElementById('pairing-qr-code');
    if (holder) holder.innerHTML = qrSvg(pairUrl, { label: 'Phone pairing QR code' });
    pairingQrPanel.hidden = false;
    btnShowPairingQr.setAttribute('aria-expanded', 'true');
    if (label) label.textContent = 'Hide Pairing QR Code';
  });

  async function handleManualSyncToMobile() {
    const settings = await getSettings();
    const statusEl = document.getElementById('sync-status-msg');
    if (statusEl) {
      statusEl.textContent = 'Syncing deadlines with cloud (bidirectional)...';
      statusEl.style.color = 'var(--text-muted)';
    }

    // 1. Proactively pull freshest updates from phone / cloud first so mobile edits are preserved
    await pullTasksFromFirebaseIfNewer();

    // 2. Push current tasks & tombstones to Firebase Cloud
    const [tombstones, coursesUpdatedAt] = await Promise.all([getLocalTombstones(), getCoursesUpdatedAt()]);
    const fbRes = await pushTasksToFirebase(currentTasks, 'Extension Manual Sync', settings.syncKey, currentQuickLinks, tombstones, currentUserCourses, coursesUpdatedAt || undefined, (await getQuickLinksUpdatedAt()) || undefined);

    refreshAllViews();

    if (fbRes.success) {
      if (statusEl) {
        statusEl.innerHTML = `<span style="color: var(--text-main); display: inline-flex; align-items: center; gap: 4px;">${getSvgIcon('check')} <span>Synced ${currentTasks.length} deadlines with Firebase Cloud!</span></span>`;
      }
      alert(`Successfully synchronized ${currentTasks.length} deadlines with Firebase Realtime Database!\n\nBoth laptop and mobile devices are now up to date.`);
    } else {
      if (statusEl) {
        statusEl.innerHTML = `<span style="color: var(--text-main); font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">${getSvgIcon('urgent')} <span>${escapeHtml(fbRes.message || 'Sync error')}</span></span>`;
      }
      alert(`Mobile sync failed: ${fbRes.message}`);
    }
  }

  btnSyncToServer?.addEventListener('click', handleManualSyncToMobile);

  btnOpenMobileWeb?.addEventListener('click', async () => {
    const aiPass = await ensureAiPass();
    const settings = await getSettings();
    const appBase = COMPANION_URL;
    const targetUrl = pairingLink(appBase, settings.syncKey || '', aiPass);
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: targetUrl });
    } else {
      window.open(targetUrl, '_blank');
    }
  });

  // What the calendar link shows; remembered on this computer
  const calendarShowSelect = document.getElementById('setting-calendar-show') as HTMLSelectElement | null;
  if (calendarShowSelect) {
    try { calendarShowSelect.value = cleanCalendarFeedShow(localStorage.getItem('bbs_calendar_feed_show')); } catch { /* storage off */ }
    calendarShowSelect.addEventListener('change', () => {
      try { localStorage.setItem('bbs_calendar_feed_show', calendarShowSelect.value); } catch { /* storage off */ }
    });
  }

  btnCopyWebcalLink?.addEventListener('click', async () => {
    const settings = await getSettings();
    const show = cleanCalendarFeedShow(calendarShowSelect?.value);
    const webcalUrl = calendarFeedUrl(SITE_URL, settings.syncKey || '', show, { webcal: true });
    try {
      await navigator.clipboard.writeText(webcalUrl);
      alert(`Copied WebCal link to clipboard:\n${webcalUrl}\n\nPaste this link into Apple Calendar on your iPhone or Google Calendar on the web to subscribe!`);
    } catch {
      prompt('WebCal Subscription Link:', webcalUrl);
    }
  });

  // Backup & Restore
  btnBackupJson.addEventListener('click', exportJsonBackup);
  btnRestoreJsonTrigger.addEventListener('click', () => inputRestoreJson.click());
  inputRestoreJson.addEventListener('change', e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      handleRestoreJson(file);
      (e.target as HTMLInputElement).value = '';
    }
  });

  // Course Manager Toolbar
  document.getElementById('btn-add-course')?.addEventListener('click', () => openCourseEditor());
  document.getElementById('btn-import-courses')?.addEventListener('click', openCourseImporter);
  document.getElementById('btn-export-courses')?.addEventListener('click', exportCoursesJson);
  document.getElementById('btn-reset-courses')?.addEventListener('click', handleResetCourses);

  // Course Editor Modal Events
  document.getElementById('btn-close-course-editor')?.addEventListener('click', closeCourseEditor);
  document.getElementById('btn-cancel-course-editor')?.addEventListener('click', closeCourseEditor);
  document.getElementById('modal-course-editor')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modal-course-editor')) closeCourseEditor();
  });
  document.getElementById('form-course-editor')?.addEventListener('submit', handleSaveCourse);
  document.getElementById('btn-add-schedule-slot')?.addEventListener('click', () => addScheduleSlotRow());
  document.getElementById('btn-add-syllabus-row')?.addEventListener('click', () => addSyllabusRow());

  // Quick Syllabus Text Paste
  document.getElementById('btn-parse-syllabus-paste')?.addEventListener('click', () => {
    const textarea = document.getElementById('editor-syllabus-paste-text') as HTMLTextAreaElement;
    if (!textarea || !textarea.value.trim()) return;
    const comps = parseSyllabusWeightsText(textarea.value);
    if (comps.length > 0) {
      const container = document.getElementById('course-editor-syllabus');
      if (container) container.innerHTML = '';
      comps.forEach(c => addSyllabusRow(c));
      updateEditorTotalWeight();
      showToast(`Parsed ${comps.length} grading components!`);
    } else {
      showToast('Could not detect syllabus weights from text.');
    }
  });

  // Editor Color Picker & Swatches
  const colorPickerEl = document.getElementById('editor-color-picker') as HTMLInputElement;
  const colorHexInputEl = document.getElementById('editor-color-hex') as HTMLInputElement;
  colorPickerEl?.addEventListener('input', () => {
    if (colorHexInputEl) colorHexInputEl.value = colorPickerEl.value;
    const dotEl = document.getElementById('editor-header-dot');
    if (dotEl) dotEl.style.backgroundColor = colorPickerEl.value;
  });
  colorHexInputEl?.addEventListener('input', () => {
    if (/^#([A-Fa-f0-9]{6})$/.test(colorHexInputEl.value)) {
      if (colorPickerEl) colorPickerEl.value = colorHexInputEl.value;
      const dotEl = document.getElementById('editor-header-dot');
      if (dotEl) dotEl.style.backgroundColor = colorHexInputEl.value;
    }
  });
  document.querySelectorAll('#editor-color-swatches .swatch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.getAttribute('data-color') || '#2563eb';
      if (colorPickerEl) colorPickerEl.value = color;
      if (colorHexInputEl) colorHexInputEl.value = color;
      const dotEl = document.getElementById('editor-header-dot');
      if (dotEl) dotEl.style.backgroundColor = color;
    });
  });

  // Course Importer Modal Events
  document.getElementById('btn-close-course-import')?.addEventListener('click', closeCourseImporter);
  document.getElementById('btn-cancel-banner-import')?.addEventListener('click', closeCourseImporter);
  document.getElementById('modal-course-import')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modal-course-import')) closeCourseImporter();
  });
  document.getElementById('tab-import-banner')?.addEventListener('click', () => switchImporterTab('banner'));
  document.getElementById('tab-import-json')?.addEventListener('click', () => switchImporterTab('json'));
  document.getElementById('btn-preview-banner')?.addEventListener('click', handlePreviewBanner);
  document.getElementById('input-import-document')?.addEventListener('change', e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void handleImportDocumentFile(file);
  });
  document.getElementById('btn-confirm-banner-import')?.addEventListener('click', handleConfirmBannerImport);
  document.getElementById('btn-confirm-json-import')?.addEventListener('click', handleConfirmJsonImport);
  document.getElementById('input-import-json-file')?.addEventListener('change', e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = evt => {
        const content = evt.target?.result as string;
        const textarea = document.getElementById('import-json-text') as HTMLTextAreaElement;
        if (textarea && content) {
          textarea.value = content;
        }
      };
      reader.readAsText(file);
    }
  });

  // Global Escape key listener to close modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const editorModal = document.getElementById('modal-course-editor');
      if (editorModal && editorModal.style.display !== 'none' && !editorModal.classList.contains('hidden')) {
        closeCourseEditor();
      }
      const importModal = document.getElementById('modal-course-import');
      if (importModal && importModal.style.display !== 'none' && !importModal.classList.contains('hidden')) {
        closeCourseImporter();
      }
    }
  });
}

// ============================================================================
// Academic Quick Links Logic
// ============================================================================

function openQuickLinkUrl(rawUrl: string) {
  let url = (rawUrl || '').trim();
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function renderQuickLinksBar() {
  const container = document.getElementById('calendar-quick-links-chips');
  const bar = document.getElementById('calendar-quick-links-bar');
  if (!container) return;

  if (!currentQuickLinks || currentQuickLinks.length === 0) {
    if (bar) bar.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  if (bar) bar.style.display = '';

  container.innerHTML = currentQuickLinks.map(link => {
    const meta = quickLinkMeta(link.category);
    return `
      <a class="ql-chip ${meta.badgeClass}" data-id="${escapeHtml(link.id)}" data-url="${escapeHtml(link.url)}" title="${escapeHtml(link.title)} (${escapeHtml(link.url)})">
        ${quickLinkIconHtml(link.category, 'ql-chip-icon')}
        <span>${escapeHtml(link.title)}</span>
        <svg class="ql-chip-external-icon"><use href="#icon-external-link"></use></svg>
      </a>
    `;
  }).join('');

  container.querySelectorAll('.ql-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const url = chip.getAttribute('data-url');
      if (url) openQuickLinkUrl(url);
    });
  });
}

function renderQuickLinksManager() {
  const listContainer = document.getElementById('quick-links-manager-list');
  if (!listContainer) return;

  if (!currentQuickLinks || currentQuickLinks.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 20px 10px; color: var(--text-muted); font-size: 12px;">
        No quick links yet. Click <strong>Add Link</strong> to add your attendance, marks or study plan pages.
      </div>
    `;
    return;
  }

  listContainer.innerHTML = currentQuickLinks.map(link => {
    const meta = quickLinkMeta(link.category);
    let hostname = '';
    try {
      const parsed = new URL(link.url.startsWith('http') ? link.url : `https://${link.url}`);
      hostname = parsed.hostname;
    } catch {
      hostname = link.url;
    }

    return `
      <div class="ql-item-card ${meta.badgeClass}" data-id="${escapeHtml(link.id)}">
        <div class="ql-item-left">
          <div class="ql-item-icon-box">
            ${quickLinkIconHtml(link.category)}
          </div>
          <div class="ql-item-info">
            <div class="ql-item-title-row">
              <span class="ql-item-title" title="${escapeHtml(link.title)}">${escapeHtml(link.title)}</span>
              <span class="ql-category-badge">${meta.label}</span>
            </div>
            <span class="ql-item-url" title="${escapeHtml(link.url)}">${escapeHtml(hostname)}</span>
          </div>
        </div>
        <div class="ql-item-actions">
          <button type="button" class="btn-ql-open btn-open-link" data-url="${escapeHtml(link.url)}" title="Open in new tab">
            <span>Open</span>
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-external-link"></use></svg>
          </button>
          <button type="button" class="btn-ql-action btn-edit-ql" data-id="${escapeHtml(link.id)}" title="Edit link" aria-label="Edit link">
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-pencil"></use></svg>
          </button>
          <button type="button" class="btn-ql-action delete btn-delete-ql" data-id="${escapeHtml(link.id)}" title="Delete link" aria-label="Delete link">
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-trash"></use></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Wire buttons
  listContainer.querySelectorAll('.btn-open-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      if (url) openQuickLinkUrl(url);
    });
  });

  listContainer.querySelectorAll('.btn-edit-ql').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const target = currentQuickLinks.find(l => l.id === id);
      if (!target) return;

      const form = document.getElementById('form-quick-link') as HTMLFormElement | null;
      const editIdInput = document.getElementById('ql-edit-id') as HTMLInputElement | null;
      const titleInput = document.getElementById('ql-title') as HTMLInputElement | null;
      const urlInput = document.getElementById('ql-url') as HTMLInputElement | null;
      const catSelect = document.getElementById('ql-category') as HTMLSelectElement | null;
      const saveBtn = document.getElementById('btn-save-ql') as HTMLButtonElement | null;

      if (form && editIdInput && titleInput && urlInput && catSelect) {
        editIdInput.value = target.id;
        titleInput.value = target.title;
        urlInput.value = target.url;
        catSelect.value = target.category || 'other';
        if (saveBtn) saveBtn.textContent = 'Update Link';
        form.style.display = 'block';
        titleInput.focus();
      }
    });
  });

  listContainer.querySelectorAll('.btn-delete-ql').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (!id) return;
      const target = currentQuickLinks.find(l => l.id === id);
      const title = target ? target.title : 'link';
      currentQuickLinks = await deleteQuickLink(id);
      renderQuickLinksBar();
      renderQuickLinksManager();
      syncQuickLinksToCloud();
      showToast(`Removed "${title}" from quick links`);
    });
  });
}

function initQuickLinksModal() {
  const modal = document.getElementById('modal-quick-links');
  const btnToggle = document.getElementById('btn-quick-links-toggle');
  const btnClose = document.getElementById('btn-close-quick-links');
  const btnBarManage = document.getElementById('btn-bar-manage-links');
  const btnToggleForm = document.getElementById('btn-toggle-add-link-form');
  const btnReset = document.getElementById('btn-reset-quick-links');
  const form = document.getElementById('form-quick-link') as HTMLFormElement | null;
  const btnCancelForm = document.getElementById('btn-cancel-ql-form');

  const openModal = () => {
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.remove('hidden');
      renderQuickLinksManager();
    }
  };

  const closeModal = () => {
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
    if (form) {
      form.reset();
      form.style.display = 'none';
      const editId = document.getElementById('ql-edit-id') as HTMLInputElement | null;
      if (editId) editId.value = '';
      const saveBtn = document.getElementById('btn-save-ql') as HTMLButtonElement | null;
      if (saveBtn) saveBtn.textContent = 'Save Link';
    }
  };

  btnToggle?.addEventListener('click', openModal);
  btnBarManage?.addEventListener('click', openModal);
  btnClose?.addEventListener('click', closeModal);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  btnToggleForm?.addEventListener('click', () => {
    if (form) {
      const isVisible = form.style.display !== 'none';
      if (isVisible) {
        form.style.display = 'none';
      } else {
        form.reset();
        const editId = document.getElementById('ql-edit-id') as HTMLInputElement | null;
        if (editId) editId.value = '';
        const saveBtn = document.getElementById('btn-save-ql') as HTMLButtonElement | null;
        if (saveBtn) saveBtn.textContent = 'Save Link';
        form.style.display = 'block';
        (document.getElementById('ql-title') as HTMLInputElement | null)?.focus();
      }
    }
  });

  btnCancelForm?.addEventListener('click', () => {
    if (form) {
      form.reset();
      form.style.display = 'none';
      const editId = document.getElementById('ql-edit-id') as HTMLInputElement | null;
      if (editId) editId.value = '';
    }
  });

  // Preset chips
  document.querySelectorAll('.btn-preset-ql').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      const titleInput = document.getElementById('ql-title') as HTMLInputElement | null;
      const urlInput = document.getElementById('ql-url') as HTMLInputElement | null;
      const catSelect = document.getElementById('ql-category') as HTMLSelectElement | null;

      if (form) form.style.display = 'block';

      // The university's own link of that kind when one is built in, else just the title
      const filled = quickLinkPreset(profileUniversity(getCachedProfile()).id, (preset || 'other') as any);
      if (titleInput) titleInput.value = filled.title;
      if (urlInput) {
        urlInput.value = filled.url;
        if (!filled.url) urlInput.focus();
      }
      if (catSelect) catSelect.value = filled.category;
    });
  });

  // Reset defaults
  btnReset?.addEventListener('click', async () => {
    const uni = profileUniversity(getCachedProfile());
    const question = (uni.quickLinks || []).length
      ? `Replace your quick links with ${uni.shortName}'s built-in links?`
      : 'Remove all your quick links? Your university has no built-in links, so you add your own.';
    if (confirm(question)) {
      currentQuickLinks = await resetQuickLinksToDefault(profileUniversity(getCachedProfile()).id);
      renderQuickLinksBar();
      renderQuickLinksManager();
      syncQuickLinksToCloud();
      showToast('Quick links reset to defaults');
    }
  });

  // Form submit (Add or Edit)
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = (document.getElementById('ql-edit-id') as HTMLInputElement | null)?.value || '';
    const title = (document.getElementById('ql-title') as HTMLInputElement | null)?.value.trim() || '';
    let url = (document.getElementById('ql-url') as HTMLInputElement | null)?.value.trim() || '';
    const category = ((document.getElementById('ql-category') as HTMLSelectElement | null)?.value || 'other') as QuickLinkCategory;

    if (!title || !url) {
      showToast('Please provide both title and URL.');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    if (editId) {
      currentQuickLinks = await updateQuickLink(editId, { title, url, category });
      showToast(`Updated "${title}"`);
    } else {
      currentQuickLinks = await addQuickLink({ title, url, category });
      showToast(`Added "${title}" to quick links!`);
    }

    form.reset();
    form.style.display = 'none';
    const idInput = document.getElementById('ql-edit-id') as HTMLInputElement | null;
    if (idInput) idInput.value = '';

    renderQuickLinksBar();
    renderQuickLinksManager();
    syncQuickLinksToCloud();
  });
}

async function syncQuickLinksToCloud() {
  try {
    const [settings, tombstones, coursesUpdatedAt] = await Promise.all([getSettings(), getLocalTombstones(), getCoursesUpdatedAt()]);
    await pushTasksToFirebase(currentTasks, 'Chrome Extension', settings.syncKey, currentQuickLinks, tombstones, currentUserCourses, coursesUpdatedAt || undefined, (await getQuickLinksUpdatedAt()) || undefined);
  } catch {}
}

function initAiExtractModal() {
  const extractModal = document.getElementById('modal-ai-extract');
  const btnOpen = document.getElementById('btn-ai-extract-modal');
  const btnClose = document.getElementById('btn-close-extract-modal');
  const btnCancel = document.getElementById('btn-cancel-extract');
  const btnRun = document.getElementById('btn-run-extract');
  const btnAddCustom = document.getElementById('btn-add-deadline-header');

  btnAddCustom?.addEventListener('click', () => {
    switchView('add');
  });

  function closeExtractModal() {
    if (extractModal) {
      extractModal.style.display = 'none';
      extractModal.classList.add('hidden');
    }
  }

  btnOpen?.addEventListener('click', () => {
    if (extractModal) {
      // The course hint lists the student's own courses
      const hint = document.getElementById('extract-course-hint') as HTMLSelectElement | null;
      if (hint) {
        const chosen = hint.value;
        hint.innerHTML = '<option value="">Auto-detect from text</option>' + activeCourseHintOptions()
          .map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
        hint.value = chosen;
      }
      extractModal.style.display = 'flex';
      extractModal.classList.remove('hidden');
      const input = document.getElementById('input-extract-text') as HTMLTextAreaElement;
      if (input) input.focus();
    }
  });

  btnClose?.addEventListener('click', closeExtractModal);
  btnCancel?.addEventListener('click', closeExtractModal);
  extractModal?.addEventListener('click', (e) => {
    if (e.target === extractModal) closeExtractModal();
  });

  // Room picker close bindings
  document.getElementById('btn-close-room-picker')?.addEventListener('click', closeRoomPicker);
  document.getElementById('modal-room-picker')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-room-picker')) closeRoomPicker();
  });

  document.getElementById('btn-apply-custom-room')?.addEventListener('click', async () => {
    if (!activeRoomPickerTaskId) return;
    const customVal = (document.getElementById('input-custom-room') as HTMLInputElement)?.value.trim() || '';
    await applyRoomChange(activeRoomPickerTaskId, customVal);
    closeRoomPicker();
  });

  // Reading sheet close bindings
  document.getElementById('btn-close-reading-sheet')?.addEventListener('click', closeReadingSheet);
  document.getElementById('modal-reading-sheet')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-reading-sheet')) closeReadingSheet();
  });

  // Run extract handler
  btnRun?.addEventListener('click', async () => {
    const textArea = document.getElementById('input-extract-text') as HTMLTextAreaElement;
    const courseSelect = document.getElementById('extract-course-hint') as HTMLSelectElement;
    const statusBox = document.getElementById('extract-status-box') as HTMLElement;
    const previewList = document.getElementById('extract-preview-list') as HTMLElement;
    const btnIcon = document.getElementById('extract-btn-icon') as HTMLElement;
    const btnText = document.getElementById('extract-btn-text') as HTMLElement;

    const text = (textArea?.value || '').trim();
    const courseHint = courseSelect?.value || '';

    if (!text) {
      showToast('Please paste an announcement text first.');
      return;
    }

    if (btnRun) (btnRun as HTMLButtonElement).disabled = true;
    if (btnIcon) btnIcon.innerHTML = getSvgIcon('refresh');
    if (btnText) btnText.textContent = 'Extracting...';
    if (statusBox) {
      statusBox.style.display = 'block';
      statusBox.innerHTML = `
        <div class="extract-status-pill loading">
          <span>${getSvgIcon('bolt', 'mr-1')} Analyzing announcement...</span>
        </div>
      `;
    }
    if (previewList) previewList.innerHTML = '';

    try {
      const extractAnnouncement = {
        id: 'manual-extract',
        courseCode: courseHint || '',
        courseName: courseHint || '',
        title: 'Manual Extract',
        contentText: text,
        sourceUrl: '',
        scannedAt: new Date().toISOString()
      };
      const extracted = extractDeadlinesLocally(extractAnnouncement);
      if (!extracted || extracted.length === 0) {
        if (statusBox) {
          statusBox.innerHTML = `
            <div class="extract-status-pill error">
              <span>No deadline dates detected in this announcement text.</span>
            </div>
          `;
        }
        showToast('No deadlines detected in announcement.');
        return;
      }

      if (statusBox) {
        statusBox.innerHTML = `
          <div class="extract-status-pill success">
            <span>${getSvgIcon('check', 'mr-1')} Found ${extracted.length} deadline(s)!</span>
          </div>
        `;
      }

      previewList.innerHTML = extracted.map((task, idx) => {
        const d = new Date(task.dueDate);
        const dateStr = !isNaN(d.getTime()) ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date pending';
        const timeStr = task.hasSpecificTime && !isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Class time';
        return `
          <div class="extract-result-item" id="extract-item-${idx}">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
              <div>
                <h4 style="font-size: 12.5px; font-weight: 700; color: var(--text-main);">${escapeHtml(task.title)}</h4>
                <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
                  <span>${getSvgIcon('book', 'mr-1')} ${escapeHtml(task.courseName || '')}</span>
                  <span>${getSvgIcon('calendar', 'mr-1')} ${dateStr} at ${timeStr}</span>
                  ${task.room ? `<span style="color:#4338ca; font-weight:600;">${getSvgIcon('pin', 'mr-1')} ${escapeHtml(task.room)}</span>` : ''}
                </div>
              </div>
              <button type="button" class="btn-primary btn-add-extracted-item" data-idx="${idx}" style="font-size: 11px; padding: 4px 10px; white-space: nowrap;">
                <span>${getSvgIcon('plus', 'mr-1')} Add</span>
              </button>
            </div>
          </div>
        `;
      }).join('');

      previewList.querySelectorAll('.btn-add-extracted-item').forEach(addBtn => {
        addBtn.addEventListener('click', async () => {
          const idx = parseInt(addBtn.getAttribute('data-idx') || '0', 10);
          const t = extracted[idx];
          if (!t) return;
          const newTask: DeadlineTask = {
            id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            title: t.title,
            courseName: t.courseName,
            courseCode: t.courseCode,
            dueDate: t.dueDate,
            hasSpecificTime: t.hasSpecificTime,
            type: t.type || 'assignment',
            priority: t.priority || 'medium',
            status: 'pending',
            description: text.trim() || t.description || '',
            sourceSnippet: text.trim() || t.sourceSnippet || '',
            room: t.room,
            weight: t.weight,
            weightDisplay: t.weightDisplay,
            syllabusNote: t.syllabusNote,
            confidence: t.confidence ?? 1.0,
            extractedBy: 'ai',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          currentTasks = await addTask(newTask);
          currentTasks.sort(compareTasksByTime);
          currentTasks = await saveTasksMergingLatest(currentTasks);
          refreshAllViews();
          syncTasksToCloud(currentTasks, 'Extracted Announcement Added');
          (addBtn as HTMLButtonElement).disabled = true;
          addBtn.textContent = '✓ Added';
          showToast(`Added "${t.title}" to deadlines!`);
        });
      });
    } catch (err: any) {
      if (statusBox) {
        statusBox.innerHTML = `
          <div class="extract-status-pill error">
            <span>Extraction error: ${escapeHtml(err.message || 'Unknown error')}</span>
          </div>
        `;
      }
    } finally {
      if (btnRun) (btnRun as HTMLButtonElement).disabled = false;
      if (btnIcon) btnIcon.innerHTML = `<svg class="ui-icon mr-1"><use href="#icon-bolt"></use></svg>`;
      if (btnText) btnText.textContent = 'Extract Deadlines';
    }
  });
}

// ============================================================================
// Initialization
// ============================================================================
function setupStorageAndSyncListeners() {
  // Listen for storage changes from background sync or other tabs to update views reactively
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.bbs_tasks) {
        const newTasks = (changes.bbs_tasks.newValue as DeadlineTask[]) || [];
        try { localStorage.setItem('bbs_tasks', JSON.stringify(newTasks)); } catch {}
        currentTasks = deduplicateTaskList(newTasks.filter(isValidTask));
        currentTasks.sort(compareTasksByTime);
        refreshAllViews();
      }
      if (area === 'local' && changes.bbs_settings) {
        const newSettings = changes.bbs_settings.newValue as any;
        if (newSettings?.theme && newSettings.theme !== currentThemeSetting) {
          applyTheme(newSettings.theme);
        }
      }
      if (area === 'local' && changes[SCAN_STATUS_KEY]) {
        renderScanStatus(changes[SCAN_STATUS_KEY].newValue as ScanStatus);
      }
      if (area === 'local' && changes.bbs_quick_links) {
        currentQuickLinks = (changes.bbs_quick_links.newValue as QuickLink[]) || [];
        renderQuickLinksBar();
        renderQuickLinksManager();
      }
      if (area === 'local' && changes.bbs_user_courses) {
        currentUserCourses = (changes.bbs_user_courses.newValue as UserCourseConfig[]) || [];
        renderUserCoursesManager();
        renderLegend();
        updateCourseFilterOptions(currentTasks);
        refreshAllViews();
      }
    });
  }

  // Cross-tab broadcast listener for theme sync
  try {
    const syncChannel = new BroadcastChannel('bbs_sync_channel');
    syncChannel.onmessage = (event) => {
      if (event.data?.type === 'THEME_CHANGED' && event.data.theme) {
        applyTheme(event.data.theme);
      }
    };
  } catch {}

  // Listen for window focus to pull latest updates if user edited on mobile
  // Global Escape key listener to close active dialogs, drawers, and sheets
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      const editModal = document.getElementById('modal-edit-task');
      if (editModal && editModal.style.display !== 'none') {
        editModal.style.display = 'none';
      }
      const readingSheet = document.getElementById('modal-reading-sheet');
      if (readingSheet && !readingSheet.classList.contains('hidden') && readingSheet.style.display !== 'none') {
        readingSheet.style.display = 'none';
        readingSheet.classList.add('hidden');
      }
      const quickLinks = document.getElementById('modal-quick-links');
      if (quickLinks && !quickLinks.classList.contains('hidden') && quickLinks.style.display !== 'none') {
        quickLinks.style.display = 'none';
        quickLinks.classList.add('hidden');
      }
      const roomPicker = document.getElementById('modal-room-picker');
      if (roomPicker && !roomPicker.classList.contains('hidden') && roomPicker.style.display !== 'none') {
        roomPicker.style.display = 'none';
        roomPicker.classList.add('hidden');
      }
      const drawer = document.getElementById('day-expanded-drawer');
      if (drawer && !drawer.classList.contains('hidden')) {
        drawer.classList.add('hidden');
      }
    }
  });

  window.addEventListener('focus', () => {
    pullTasksFromFirebaseIfNewer();
  });

  // Periodically check for updates while popup is open (every 25 seconds)
  setInterval(() => {
    pullTasksFromFirebaseIfNewer();
  }, 25000);
}

async function refreshDataInBackground() {
  try {
    // 1. Fetch from chrome.storage.local to pick up any background worker or content script additions
    const freshTasks = (await getTasks()).filter(isValidTask);
    const freshLinks = await getQuickLinks();
    const freshCourses = await getUserCourses();
    let viewsNeedUpdate = false;

    if (Array.isArray(freshCourses) && JSON.stringify(freshCourses) !== JSON.stringify(currentUserCourses)) {
      currentUserCourses = freshCourses;
      renderUserCoursesManager();
      renderLegend();
      updateCourseFilterOptions(currentTasks);
      viewsNeedUpdate = true;
    }

    if (freshLinks && freshLinks.length > 0 && JSON.stringify(freshLinks) !== JSON.stringify(currentQuickLinks)) {
      currentQuickLinks = freshLinks;
      renderQuickLinksBar();
      renderQuickLinksManager();
    }

    if (freshTasks && freshTasks.length > 0 && JSON.stringify(freshTasks) !== JSON.stringify(currentTasks)) {
      currentTasks = freshTasks;
      currentTasks.sort(compareTasksByTime);
      viewsNeedUpdate = true;
    }

    const currentSettings = await getSettings();
    // Ensure every user has a unique, isolated Sync Key on first run. The key is never copied into
    // (or read back from) the Blackboard page's localStorage: that origin's scripts could read it,
    // or plant a key of their own for the extension to adopt. chrome.storage.sync already backs it up.
    if (!currentSettings.syncKey) {
      const keyToUse = generateUniqueSyncKey();
      await saveSettings({ syncKey: keyToUse });
      currentSettings.syncKey = keyToUse;
    }

    // 3. Proactively pull freshest updates from Firebase Cloud BEFORE performing retroactive upgrades
    await pullTasksFromFirebaseIfNewer();
    currentTasks = deduplicateTaskList(currentTasks.filter(isValidTask));

    // 4. Retroactively refresh syllabus weights, sanitize doctor quotes, and repair assessment times
    let updatedAny = false;
    currentTasks = currentTasks.map(task => {
      // User-created or user-edited tasks must NEVER have their dates, times, rooms, or course names overridden!
      if (task.userEdited || task.extractedBy === 'manual') {
        return task;
      }

      let taskUpdated = false;
      let description = task.description || '';
      let sourceSnippet = task.sourceSnippet || '';

      // Clean legacy synthetic stream description if present
      if (description.startsWith('Blackboard Ultra Stream item')) {
        description = '';
        taskUpdated = true;
      }

      // Sanitize doctor announcement text in description and sourceSnippet
      const cleanDesc = sanitizeDoctorAnnouncementText(
        description,
        task.courseName,
        task.courseCode,
        task.title
      );
      if (cleanDesc !== description) {
        description = cleanDesc;
        taskUpdated = true;
      }

      const cleanSnippet = sanitizeDoctorAnnouncementText(
        sourceSnippet,
        task.courseName,
        task.courseCode,
        task.title
      );
      if (cleanSnippet !== sourceSnippet) {
        sourceSnippet = cleanSnippet;
        taskUpdated = true;
      }

      // Retroactively resolve course and strip generic 'UOS' code tag
      let courseName = task.courseName;
      let courseCode = task.courseCode;
      if (courseCode === 'UOS') {
        courseCode = '';
        taskUpdated = true;
      }
      const resolvedCourse = resolveCourseInfo({
        courseName,
        courseCode,
        title: task.title,
        description,
        sourceSnippet
      });
      if (resolvedCourse.courseName !== 'General Course' && (!courseName || courseName === 'General Course' || courseName.toLowerCase() === 'uos')) {
        courseName = resolvedCourse.courseName;
        taskUpdated = true;
      }
      if (resolvedCourse.courseCode && !courseCode) {
        courseCode = resolvedCourse.courseCode;
        taskUpdated = true;
      }

      // Refresh weights with updated syllabus database
      const seriesInfo = getTaskSeriesInfo(task, currentTasks);
      const resolved = resolveTaskWeight(
        courseName || courseCode,
        task.title,
        task.type,
        description || sourceSnippet,
        seriesInfo?.index
      );

      let weight = task.weight;
      let weightDisplay = task.weightDisplay;
      let syllabusNote = task.syllabusNote;

      // Only a different weight counts: the label wording varies between callers and would flip back and forth
      if (resolved.weight !== undefined && resolved.weight !== task.weight) {
        weight = resolved.weight;
        weightDisplay = resolved.weightDisplay;
        syllabusNote = resolved.syllabusNote;
        taskUpdated = true;
      }

      let dueDate = task.dueDate;
      let hasSpecificTime = task.hasSpecificTime;

      // Gradebook marks: clear legacy artificial scan dates so they never clutter the calendar
      const isGradebookTask = task.id.startsWith('gbcol_') || task.sourceSnippet === 'gradebook';
      if (isGradebookTask && !task.announcementId) {
        if (dueDate && task.createdAt && dueDate.slice(0, 10) === task.createdAt.slice(0, 10)) {
          dueDate = '';
          hasSpecificTime = false;
          taskUpdated = true;
        }
      } else {
        // Repair task due time if teacher gave an explicit time or if class schedule should apply
        if (!hasSpecificTime) {
          const combinedDoctorText = `${task.title} ${task.sourceSnippet || ''} ${task.description || ''}`;
          const testAnn = {
            id: task.announcementId || 'temp',
            courseCode: courseCode,
            courseName: courseName,
            title: task.title,
            contentText: combinedDoctorText,
            sourceUrl: '',
            scannedAt: new Date().toISOString()
          };
          const extractedTasks = extractDeadlinesLocally(testAnn);
          if (extractedTasks.length > 0) {
            const best = extractedTasks[0];
            const bestDate = new Date(best.dueDate);
            const curDate = new Date(task.dueDate);

            // Only adopt if best has an explicit time
            if (best.hasSpecificTime) {
              curDate.setHours(bestDate.getHours(), bestDate.getMinutes(), 0, 0);
              dueDate = curDate.toISOString();
              hasSpecificTime = true;
              taskUpdated = true;
            }
          }
        }

        // Adjust to class schedule time if no specific teacher time was recorded
        if (!hasSpecificTime && dueDate && !isNaN(new Date(dueDate).getTime())) {
          const schedRes = resolveTaskTimeWithSchedule({
            dueDate: new Date(dueDate),
            courseNameOrCode: courseName || courseCode,
            hasSpecificTime: false,
            announcementText: description || sourceSnippet,
            title: task.title
          });
          if (schedRes.appliedSchedule && schedRes.dueDate && !isNaN(schedRes.dueDate.getTime())) {
            dueDate = schedRes.dueDate.toISOString();
            hasSpecificTime = schedRes.hasSpecificTime;
            taskUpdated = true;
          }
        }
      }

      // Clear room if task is hw or project; otherwise assign from announcement or course schedule if missing
      const isHwOrProj = task.type === 'assignment' || (task.type as string) === 'hw' || task.type === 'project';
      let room = task.room;
      if (isHwOrProj) {
        if (room) {
          room = undefined;
          taskUpdated = true;
        }
      } else if (!room) {
        const resolvedRoom = resolveTaskRoom({
          courseNameOrCode: courseName || courseCode,
          announcementText: description || sourceSnippet,
          title: task.title,
          type: task.type
        });
        if (resolvedRoom.room) {
          room = resolvedRoom.room;
          taskUpdated = true;
        }
      }

      if (taskUpdated) {
        updatedAny = true;
        return {
          ...task,
          courseName,
          courseCode,
          room,
          description,
          sourceSnippet,
          dueDate,
          hasSpecificTime,
          weight,
          weightDisplay,
          syllabusNote,
          updatedAt: new Date().toISOString()
        };
      }

      return task;
    });

    currentTasks = deduplicateTaskList(currentTasks.filter(isValidTask));
    currentTasks.sort(compareTasksByTime);

    // Purge any synthetic deadline tasks that were incorrectly created for unannounced gradebook marks
    const { cleaned: purgedTasks, purgedIds } = purgeSyntheticGradebookTasks(currentTasks);
    if (purgedIds.length > 0) {
      currentTasks = purgedTasks;
      await Promise.all(purgedIds.map(id => recordLocalTombstone(id)));
      await saveTasksMergingLatest(currentTasks);
      syncTasksToCloud(currentTasks, 'Purge synthetic gradebook tasks');
      viewsNeedUpdate = true;
      updatedAny = true;
    }

    // One-time removal of tasks older scans named only "Exam", "Assignment", "Lab" or "quiz".
    // Each gets a delete record so the cloud copy and the phone do not bring it back.
    if (!(await readLocalFlag(LEGACY_NAMELESS_CLEANUP_KEY))) {
      const legacyIds = new Set(findLegacyNamelessTaskIds(
        currentTasks.filter(t => t.sourceSnippet !== 'gradebook' && !t.gradeSourceId && !t.id.startsWith('gbcol_'))
      ));
      if (legacyIds.size > 0) {
        currentTasks = currentTasks.filter(t => !legacyIds.has(t.id));
        legacyIds.forEach(id => recordLocalTombstone(id));
        updatedAny = true;
      }
      await writeLocalFlag(LEGACY_NAMELESS_CLEANUP_KEY);
    }
    // Student notes are only ever written by the student. Older scans copied the AI's wording of
    // the announcement into them; a task the student never edited has no notes of its own.
    for (const task of currentTasks) {
      if (task.notes && !task.userEdited && task.extractedBy !== 'manual') {
        delete task.notes;
        task.updatedAt = new Date().toISOString();
        updatedAny = true;
      }
    }
    const rawLocalTasks = await getTasks();
    if (rawLocalTasks.length !== currentTasks.length) {
      updatedAny = true;
    }
    if (updatedAny) {
      // Merge with what is stored now: a scan may have saved marks while this ran
      currentTasks = (await saveTasksMergingLatest(currentTasks)).sort(compareTasksByTime);
      syncTasksToCloud(currentTasks, 'Retroactive Upgrades & Cleanup');
      refreshAllViews();
    } else if (viewsNeedUpdate) {
      refreshAllViews();
    }
  } catch (err) {
    console.info('[Popup] Background data refresh encountered error:', err);
  }
}

async function initWalkthroughModal() {
  const modal = document.getElementById('modal-walkthrough');
  if (!modal) return;

  const btnClose = document.getElementById('btn-close-walkthrough');
  const btnNext = document.getElementById('btn-walkthrough-next');
  const btnBack = document.getElementById('btn-walkthrough-back');
  const btnSkip = document.getElementById('btn-walkthrough-skip');
  const btnReplay = document.getElementById('btn-replay-walkthrough');
  const keyDisplay = document.getElementById('wt-key-display');
  const btnCopyKey = document.getElementById('btn-wt-copy-key');
  const stepButtons = modal.querySelectorAll<HTMLButtonElement>('.walkthrough-step-btn');
  const panes = modal.querySelectorAll<HTMLDivElement>('.walkthrough-pane');

  let currentStep = 1;
  const totalSteps = 2;

  document.getElementById('btn-wt-open-bb')?.addEventListener('click', () => {
    closeModal(true);
    const cached = getCachedProfile();
    const uni = profileUniversity(cached);
    const bbUrl = uni.blackboardUrl || 'https://elearning.sharjah.ac.ae/ultra/stream';
    try {
      chrome.tabs.create({ url: bbUrl });
    } catch {
      window.open(bbUrl, '_blank', 'noopener');
    }
  });

  const settings = await getSettings();
  if (keyDisplay && settings.syncKey) {
    keyDisplay.textContent = settings.syncKey;
  }

  function setStep(step: number) {
    currentStep = Math.max(1, Math.min(totalSteps, step));

    stepButtons.forEach(btn => {
      const s = parseInt(btn.getAttribute('data-step') || '1', 10);
      btn.classList.toggle('active', s === currentStep);
    });

    panes.forEach(pane => {
      pane.classList.remove('active');
    });
    const activePane = document.getElementById(`walkthrough-pane-${currentStep}`);
    if (activePane) activePane.classList.add('active');

    if (btnBack) {
      btnBack.style.visibility = currentStep > 1 ? 'visible' : 'hidden';
    }

    if (btnNext) {
      btnNext.textContent = currentStep === totalSteps ? 'Get Started' : 'Next Step →';
    }
  }

  function openModal() {
    if (!modal) return;
    getSettings().then(s => {
      if (keyDisplay && s.syncKey) keyDisplay.textContent = s.syncKey;
    }).catch(() => {});
    setStep(1);
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
  }

  function closeModal(markSeen: boolean = true) {
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.add('hidden');
    if (markSeen) {
      try {
        localStorage.setItem('bbs_walkthrough_seen', 'true');
      } catch {}
    }
  }

  btnNext?.addEventListener('click', () => {
    if (currentStep < totalSteps) {
      setStep(currentStep + 1);
    } else {
      closeModal(true);
      showToast('Welcome to Blackboarder! Ready to scan your courses.');
    }
  });

  btnBack?.addEventListener('click', () => {
    if (currentStep > 1) {
      setStep(currentStep - 1);
    }
  });

  btnSkip?.addEventListener('click', () => {
    closeModal(true);
  });

  btnClose?.addEventListener('click', () => {
    closeModal(true);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal(true);
  });

  stepButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const s = parseInt(btn.getAttribute('data-step') || '1', 10);
      setStep(s);
    });
  });

  btnCopyKey?.addEventListener('click', async () => {
    const s = await getSettings();
    const key = s.syncKey;
    if (key) {
      try {
        await navigator.clipboard.writeText(key);
        showToast(`Copied Sync Key: ${key}`);
      } catch {
        showToast(`Sync Key: ${key}`);
      }
    }
  });

  // Same as Settings > Sync > Copy Phone Pairing Link (it carries the AI pass)
  document.getElementById('btn-wt-copy-pairing-link')?.addEventListener('click', () => {
    document.getElementById('btn-copy-pairing-link')?.click();
  });

  btnReplay?.addEventListener('click', () => {
    openModal();
  });

  // Check if first-time user
  const hasSeen = localStorage.getItem('bbs_walkthrough_seen');
  if (!hasSeen) {
    // Show automatically on first download/install
    openModal();
  }
}

/** Shows a banner while the last scan found Blackboard signed out, and hides it once a scan finds it signed in. */
function initSessionBanner() {
  const banner = document.getElementById('session-banner');
  const title = document.getElementById('session-banner-title');
  const text = document.getElementById('session-banner-text');
  const open = document.getElementById('btn-session-open-bb');
  if (!banner) return;
  const render = (status: SessionStatus | null | undefined) => {
    const info = describeSessionBanner(status);
    banner.style.display = info ? 'flex' : 'none';
    if (info) {
      if (title) title.textContent = info.title;
      if (text) text.textContent = info.text;
    }
  };
  try {
    chrome.storage.local.get(SESSION_STATUS_KEY, res => render(res?.[SESSION_STATUS_KEY] as SessionStatus | undefined));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[SESSION_STATUS_KEY]) render(changes[SESSION_STATUS_KEY].newValue as SessionStatus | undefined);
    });
  } catch {}
  open?.addEventListener('click', () => {
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

function initExtensionUpdateSystem() {
  const versionBadge = document.getElementById('ext-version-badge');
  const localCommitEl = document.getElementById('ext-local-commit');
  const localDateEl = document.getElementById('ext-local-date');
  const updateBanner = document.getElementById('ext-update-banner');
  const commitBadge = document.getElementById('eub-commit-badge');
  const bannerTitle = document.getElementById('eub-title');
  const bannerDesc = document.getElementById('eub-desc');
  const btnDismiss = document.getElementById('btn-ext-update-dismiss');
  const btnLater = document.getElementById('btn-ext-update-later');
  const btnDownloadBanner = document.getElementById('btn-ext-download-update');
  const btnReloadBanner = document.getElementById('btn-ext-reload');
  const btnCheckManual = document.getElementById('btn-check-ext-update');
  const btnReloadSettings = document.getElementById('btn-reload-ext-settings');
  const btnDownloadSettings = document.getElementById('btn-download-ext-zip');
  const btnOpenGithub = document.getElementById('btn-open-github-repo');
  const statusPill = document.getElementById('ext-update-status-pill');
  const statusDesc = document.getElementById('ext-update-status-desc');

  if (versionBadge) versionBadge.textContent = 'v' + BUILD_INFO.version;
  if (IS_STORE_BUILD) {
    // The store updates the extension, so there is nothing to check, download or reload here
    const card = document.getElementById('card-extension-updates');
    const subtitle = card?.querySelector('.settings-card-subtitle');
    if (subtitle) subtitle.textContent = 'Your browser updates Blackboarder automatically through its extension store.';
    if (statusPill) statusPill.textContent = 'Managed by the store';
    if (statusDesc) statusDesc.textContent = 'Installed version: v' + BUILD_INFO.version + '. New versions arrive on their own, usually within a day of being published.';
    [btnCheckManual, btnReloadSettings, btnDownloadSettings, btnOpenGithub].forEach(b => {
      const holder = b?.closest('div[style*="display: flex; flex-direction: column"]');
      if (holder) holder.remove();
    });
    return;
  }
  if (localCommitEl) localCommitEl.textContent = BUILD_INFO.shortCommit;
  if (localDateEl) {
    const d = new Date(BUILD_INFO.timestamp);
    localDateEl.textContent = isNaN(d.getTime()) ? 'latest build' : d.toLocaleDateString();
  }

  // While this port is open the background waits; closing the popup lets a downloaded update apply
  try {
    chrome.runtime.connect({ name: POPUP_PORT_NAME });
  } catch {}

  const DISMISSED_KEY = 'bbs_dismissed_update_build';
  const ENABLE_HINT = ENABLE_UPDATES_HINT;
  let shownStatus: AutoUpdateStatus | null = null;

  const openUrl = (url: string) => {
    try {
      if (chrome.tabs?.create) {
        chrome.tabs.create({ url });
        return;
      }
    } catch {}
    window.open(url, '_blank');
  };

  const downloadUpdatePackage = () => {
    openUrl(GITHUB_ZIP_URL);
  };

  const setLabel = (btn: HTMLElement | null, text: string) => {
    const span = btn?.querySelector('span');
    if (span) span.textContent = text;
  };

  const setPill = (text: string, color: 'green' | 'blue' | 'orange' | 'gray') => {
    if (!statusPill) return;
    statusPill.textContent = text;
    statusPill.className = `settings-pill pill-${color}`;
  };

  const showBanner = (title: string, desc: string, primary: 'download' | 'restart' | 'none', dismissible = true) => {
    if (!updateBanner) return;
    updateBanner.style.display = 'flex';
    if (commitBadge) commitBadge.textContent = shownStatus?.remoteShortCommit || shownStatus?.remoteBuild || 'new';
    if (bannerTitle) bannerTitle.textContent = title;
    if (bannerDesc) bannerDesc.textContent = desc;
    if (btnDownloadBanner) btnDownloadBanner.style.display = primary === 'download' ? '' : 'none';
    if (btnReloadBanner) {
      btnReloadBanner.style.display = primary === 'none' ? 'none' : '';
      // Restarting is the one action left once the files are on disk, so it becomes the main button
      btnReloadBanner.className = primary === 'restart' ? 'btn-eub-primary' : 'btn-eub-secondary';
    }
    setLabel(btnReloadBanner, primary === 'restart' ? 'Restart now' : 'Reload');
    if (btnLater) btnLater.style.display = dismissible ? '' : 'none';
    if (btnDismiss) btnDismiss.style.display = dismissible ? '' : 'none';
  };

  const hideBanner = () => {
    if (updateBanner) updateBanner.style.display = 'none';
  };

  const render = (status: AutoUpdateStatus | null, manual: boolean) => {
    shownStatus = status;
    const installed = `build ${BUILD_INFO.build || 'dev'} (${BUILD_INFO.shortCommit})`;
    if (!status) {
      setPill('Checking...', 'blue');
      return;
    }
    const remoteNote = status.remoteMessage ? ` - "${status.remoteMessage}"` : '';
    const dismissedBuild = (() => {
      try {
        return localStorage.getItem(DISMISSED_KEY);
      } catch {
        return null;
      }
    })();
    const banner = describeUpdateBanner(status, manual ? null : dismissedBuild);
    if (banner) showBanner(banner.title, banner.desc, banner.primary, banner.dismissible);
    else hideBanner();

    switch (status.state) {
      case 'updated':
        setPill('Restart pending', 'blue');
        if (statusDesc) statusDesc.textContent = `A new version${remoteNote} was installed. Blackboarder restarts into it when you close this window. Your data stays intact.`;
        if (manual) showToast('Update installed. It applies when you close this window.');
        break;
      case 'update-available':
        setPill('Update Available', 'orange');
        if (statusDesc) {
          statusDesc.textContent = status.helperInstalled
            ? `A new version${remoteNote} is on GitHub and will install with the next check.`
            : `A new version${remoteNote} is on GitHub. To install it and every future update automatically, ${ENABLE_HINT}.`;
        }
        if (manual) showToast('A new version is available.');
        break;
      case 'dev-checkout':
        setPill('Update waiting', 'orange');
        if (statusDesc) statusDesc.textContent = `Git clone: a new version${remoteNote} is on GitHub but was not pulled automatically. ${status.error || 'Run git pull.'}`;
        if (manual) showToast('New version on GitHub. See Settings for why it was not pulled.');
        break;
      case 'offline':
        setPill('Offline', 'gray');
        if (statusDesc) statusDesc.textContent = `Could not reach GitHub. Installed ${installed}; Blackboarder checks again in 15 minutes.`;
        if (manual) showToast('Could not reach GitHub right now.');
        break;
      case 'error':
        setPill('Update failed', 'orange');
        if (statusDesc) statusDesc.textContent = `The automatic update failed (${status.error || 'unknown error'}). It retries every 15 minutes, or ${ENABLE_HINT} to update by hand.`;
        if (manual) showToast('Update failed. See Settings for details.');
        break;
      default:
        setPill('Up to Date', 'green');
        if (statusDesc) {
          statusDesc.textContent = status.helperInstalled
            ? `Automatic updates are on. You have the latest version (${installed}).`
            : `You have the latest version (${installed}). Automatic updates are off: ${ENABLE_HINT} to turn them on.`;
        }
        if (manual) showToast('Blackboarder is up to date!');
    }
  };

  const askBackground = (type: 'RUN_AUTO_UPDATE' | 'GET_AUTO_UPDATE_STATUS'): Promise<AutoUpdateStatus | null> =>
    new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type }, res => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(res?.ok ? (res.status as AutoUpdateStatus) || null : null);
        });
      } catch {
        resolve(null);
      }
    });

  const performCheck = async (manual: boolean) => {
    if (manual) {
      setPill('Checking...', 'blue');
      if (statusDesc) statusDesc.textContent = 'Checking GitHub for a newer version...';
    }
    const status = await askBackground('RUN_AUTO_UPDATE');
    if (status) render(status, manual);
    else if (manual) showToast('Could not check for updates right now.');
  };

  const restart = () => chrome.runtime.reload();

  btnDownloadBanner?.addEventListener('click', downloadUpdatePackage);
  btnDownloadSettings?.addEventListener('click', downloadUpdatePackage);
  btnOpenGithub?.addEventListener('click', () => openUrl(GITHUB_REPO_URL));
  btnReloadBanner?.addEventListener('click', restart);
  btnReloadSettings?.addEventListener('click', restart);
  btnCheckManual?.addEventListener('click', () => performCheck(true));

  const dismissCurrentBanner = () => {
    hideBanner();
    if (shownStatus?.remoteBuild) {
      try {
        localStorage.setItem(DISMISSED_KEY, shownStatus.remoteBuild);
      } catch {}
    }
  };
  btnDismiss?.addEventListener('click', dismissCurrentBanner);
  btnLater?.addEventListener('click', dismissCurrentBanner);

  // Show the last result at once, then check GitHub again unless that result is only minutes old
  setTimeout(async () => {
    const saved = await askBackground('GET_AUTO_UPDATE_STATUS');
    if (saved && saved.installedBuild === BUILD_INFO.build) render(saved, false);
    if (!isUpdateStatusFresh(saved, BUILD_INFO.build)) performCheck(false);
  }, 350);

  // A check finishing in the background (for example the new files landing) updates the banner live
  try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== 'local' || !changes[AUTO_UPDATE_STATUS_KEY]) return;
      const next = changes[AUTO_UPDATE_STATUS_KEY].newValue as AutoUpdateStatus | undefined;
      if (next && next.installedBuild === BUILD_INFO.build) render(next, false);
    });
  } catch {}
}

/*
 * Only the toolbar popup keeps the fixed 480 x 600 size. The side panel and tabs use the full
 * width. Asking Chrome directly works whatever URL opened the page, including a side panel that
 * still uses an older manifest path without ?view=panel.
 */
function isToolbarPopup(): boolean {
  const params = window.location.search;
  if (params.includes('standalone=1') || params.includes('view=panel')) return false;
  try {
    const popups = chrome.extension?.getViews?.({ type: 'popup' });
    if (popups) return popups.includes(window);
  } catch {}
  // Outside the extension (tests, plain previews), guess from the width
  return window.innerWidth <= 520;
}

async function initApp() {
  // Synchronously initialize theme to eliminate light/dark flashes
  if (!isToolbarPopup()) {
    document.documentElement.classList.add('is-standalone');
    document.body.classList.add('is-standalone');
  }

  initThemeSync();
  migrateThemeToSystemDefault();

  const now = new Date();
  calendarYear = now.getFullYear();
  calendarMonth = now.getMonth();
  selectedDateStr = formatDateKey(now);

  setupEvents();
  initAiExtractModal();
  initGradeTrackerToggle();
  // Load and render user courses synchronously from cache
  currentUserCourses = getCachedCoursesSync();
  renderLegend();

  // Load and render academic quick links synchronously from cache
  currentQuickLinks = getCachedQuickLinksSync();
  renderQuickLinksBar();
  initQuickLinksModal();

  // Load and render deadlines: fetch fresh from storage (fallback to cache)
  let rawTasks = await getTasks();
  if (!rawTasks || rawTasks.length === 0) {
    rawTasks = getCachedTasksSync();
  }
  const validTasks = rawTasks.filter(isValidTask);
  const { cleaned: purgedCached, purgedIds: startupPurgedIds } = purgeSyntheticGradebookTasks(validTasks);
  currentTasks = deduplicateTaskList(purgedCached);
  currentTasks.sort(compareTasksByTime);

  if (startupPurgedIds.length > 0) {
    startupPurgedIds.forEach(id => recordLocalTombstone(id));
    saveTasksMergingLatest(currentTasks).catch(() => {});
  }

  // Render all views immediately so the popup appears instantly populated with up-to-date data
  refreshAllViews();
  switchView('calendar');
  // Back to an unfinished add / edit / settings page, if the popup was closed during one
  restoreDraft();

  // Initialize first-time setup walkthrough modal
  initWalkthroughModal();

  // University: grading scale, quick links, Blackboard address
  initUniversitySettings({
    toast: message => showToast(message),
    onProfileChanged: (profile, fromHere, previousUniversityId) => {
      refreshAllViews();
      if (!fromHere) return;
      (async () => {
        // saveProfile already swapped in the university's built-in links; show them and sync
        if (profileUniversity(profile).id !== previousUniversityId) {
          currentQuickLinks = await getQuickLinks();
          renderQuickLinksBar();
          renderQuickLinksManager();
        }
        syncTasksToCloud(currentTasks, 'University Update');
      })();
    }
  }).catch(err => console.error('[University] Settings failed to load:', err));

  initSessionBanner();

  // Initialize extension GitHub update system
  initExtensionUpdateSystem();

  // Set up listeners for reactive updates
  setupStorageAndSyncListeners();

  // If a scan is actively running in the Blackboard tab, restore its progress
  getScanStatus().then(status => {
    if (status?.state === 'running') {
      renderScanStatus(status);
    } else {
      hideScanBanner();
    }
  }).catch(() => {});

  // Run cloud pull and retroactive upgrades non-blockingly in the background
  refreshDataInBackground();
}

document.addEventListener('DOMContentLoaded', initApp);
