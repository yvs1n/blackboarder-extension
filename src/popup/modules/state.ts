import type {
  DeadlineTask,
  QuickLink,
  UserCourseConfig,
  ArchivedSemester,
} from '../../types';

export type AppView = 'calendar' | 'details' | 'marks' | 'courses' | 'add' | 'settings';

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatMonthYear(year: number, month: number): string {
  const d = new Date(year, month, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

const todayDate = new Date();

export const popupState = {
  currentTasks: [] as DeadlineTask[],
  currentQuickLinks: [] as QuickLink[],
  currentUserCourses: [] as UserCourseConfig[],
  currentFilterStatus: 'pending' as 'all' | 'pending' | 'completed',
  currentFilterCourse: 'all',
  currentFilterType: 'all',
  currentSearchQuery: '',
  cachedSemesters: [] as ArchivedSemester[],
  selectedSemesterViewId: 'active',

  calendarYear: todayDate.getFullYear(),
  calendarMonth: todayDate.getMonth(),
  selectedDateStr: formatDateKey(todayDate),
  selectedCourseFilter: null as string | null,

  currentActiveView: 'calendar' as AppView,
  dirtyViews: new Set<AppView>(['calendar', 'details', 'marks', 'courses', 'settings']),
  draftReady: false,

  editingTaskId: null as string | null,
  editingCourseId: null as string | null,
  activeRoomPickerTaskId: null as string | null,
  scanCancelledByUser: false,
  currentThemeSetting: 'light' as 'light' | 'dark' | 'system',
};

/** Cached DOM element lookups used across popup modules. */
export const dom = {
  tabNavCalendar: () => document.getElementById('tab-nav-calendar') as HTMLButtonElement,
  tabNavDetails: () => document.getElementById('tab-nav-details') as HTMLButtonElement,
  tabNavMarks: () => document.getElementById('tab-nav-marks') as HTMLButtonElement,
  tabNavCourses: () => document.getElementById('tab-nav-courses') as HTMLButtonElement,
  navBadgeCount: () => document.getElementById('nav-badge-count') as HTMLElement,

  viewCalendar: () => document.getElementById('view-calendar') as HTMLElement,
  viewDetails: () => document.getElementById('view-details') as HTMLElement,
  viewMarks: () => document.getElementById('view-marks') as HTMLElement,
  viewCourses: () => document.getElementById('view-courses') as HTMLElement,
  viewAdd: () => document.getElementById('view-add') as HTMLElement,
  viewSettings: () => document.getElementById('view-settings') as HTMLElement,

  calMonthTitle: () => document.getElementById('cal-month-title') as HTMLElement,
  btnCalPrev: () => document.getElementById('btn-cal-prev') as HTMLButtonElement,
  btnCalNext: () => document.getElementById('btn-cal-next') as HTMLButtonElement,
  btnCalToday: () => document.getElementById('btn-cal-today') as HTMLButtonElement,
  calendarGrid: () => document.getElementById('calendar-grid') as HTMLDivElement,
  legendChipsContainer: () => document.getElementById('legend-chips-container') as HTMLDivElement,
  selectedDayTitle: () => document.getElementById('selected-day-title') as HTMLElement,
  selectedDayList: () => document.getElementById('selected-day-list') as HTMLDivElement,
  btnAddOnDate: () => document.getElementById('btn-add-on-date') as HTMLButtonElement,

  dayExpandedBackdrop: () => document.getElementById('day-expanded-backdrop') as HTMLDivElement,
  dayExpandedDrawer: () => document.getElementById('day-expanded-drawer') as HTMLElement,
  dayDrawerTitle: () => document.getElementById('day-drawer-title') as HTMLElement,
  dayDrawerSubtitle: () => document.getElementById('day-drawer-subtitle') as HTMLElement,
  btnDrawerAdd: () => document.getElementById('btn-drawer-add') as HTMLButtonElement,
  btnDrawerClose: () => document.getElementById('btn-drawer-close') as HTMLButtonElement,
  dayDrawerBody: () => document.getElementById('day-drawer-body') as HTMLDivElement,

  taskListEl: () => document.getElementById('task-list') as HTMLDivElement,
  searchInput: () => document.getElementById('search-input') as HTMLInputElement,
  filterCourseSelect: () => document.getElementById('filter-course') as HTMLSelectElement,
  filterTypeSelect: () => document.getElementById('filter-type') as HTMLSelectElement,

  statUrgentCount: () => document.getElementById('stat-urgent-count') as HTMLElement,
  statWeekCount: () => document.getElementById('stat-week-count') as HTMLElement,
  statTotalCount: () => document.getElementById('stat-total-count') as HTMLElement,

  btnScanTab: () => document.getElementById('btn-scan-tab') as HTMLButtonElement,
  btnAddModal: () => document.getElementById('btn-add-modal') as HTMLButtonElement,
  btnExportAllIcs: () => document.getElementById('btn-export-all-ics') as HTMLButtonElement,
  btnSettingsToggle: () => document.getElementById('btn-settings-toggle') as HTMLButtonElement,
  btnCancelAdd: () => document.getElementById('btn-cancel-add') as HTMLButtonElement,
  btnCancelSettings: () => document.getElementById('btn-cancel-settings') as HTMLButtonElement,

  headerScanBanner: () => document.getElementById('header-scan-banner') as HTMLDivElement | null,
  hsbIcon: () => document.getElementById('hsb-icon') as SVGElement | null,
  hsbText: () => document.getElementById('hsb-text') as HTMLSpanElement | null,

  modalEditTask: () => document.getElementById('modal-edit-task') as HTMLElement,
  formAddTask: () => document.getElementById('form-add-task') as HTMLFormElement,
  formEditTask: () => document.getElementById('form-edit-task') as HTMLFormElement,
  formSettings: () => document.getElementById('form-settings') as HTMLFormElement,
};

/**
 * Cross-module action registry wired at boot in popup.ts so modules never form circular imports.
 */
export const popupActions = {
  refreshAllViews: () => {},
  renderAllViewsNow: () => {},
  switchView: (_view: AppView) => {},
  showSettingsPage: (_page: string, _focusTab = false) => {},
  rememberDraft: () => {},
  restoreDraft: async () => {},

  renderCalendar: (_anim: 'next' | 'prev' | 'none' = 'none') => {},
  renderLegend: () => {},
  updateLegendScrollArrows: () => {},
  selectDay: (_dateKey: string, _openDrawer = true) => {},
  renderSelectedDay: () => {},
  openDayExpandedDrawer: (_dateKey: string) => {},
  closeDayExpandedDrawer: () => {},

  updateStats: (_tasks: DeadlineTask[]) => {},
  updateCourseFilterOptions: (_tasks: DeadlineTask[]) => {},
  renderTasks: () => {},
  showToast: (_message: string, _actionText?: string, _onAction?: () => void) => {},
  shareTask: async (_task: DeadlineTask) => {},

  renderGradeTracker: (_tasks: DeadlineTask[]) => {},
  updateSemesterSelector: async () => {},
  renderUserCoursesManager: () => {},
  openCourseEditor: (_courseId?: string) => {},
  openCourseImporter: async () => {},
  handleCoursesUpdated: async (_courses: UserCourseConfig[]) => {},

  renderQuickLinksBar: () => {},
  renderQuickLinksManager: () => {},
  openQuickLinkUrl: (_rawUrl: string) => {},

  openReadingSheet: (_task: DeadlineTask) => {},
  closeReadingSheet: () => {},
  openRoomPicker: (_taskId: string) => {},
  closeRoomPicker: () => {},
  openEditModal: (_task: DeadlineTask) => {},
  closeEditModal: () => {},
  openAddModalOnDate: (_dateStr: string) => {},
  updateAddRoomVisibility: () => {},
  updateEditRoomVisibility: () => {},

  persistTasksInBackground: async (_tasks: DeadlineTask[], _immediate = false) => {},
  applyTaskUpdateLocal: (_taskId: string, _updates: Partial<DeadlineTask>): DeadlineTask[] => [],
  removeTaskLocal: (_taskId: string): DeadlineTask[] => [],
  syncTasksToCloud: (_tasks: DeadlineTask[], _desc = 'Extension Update', _immediate = false) => {},
  executeCloudSync: async (_tasks: DeadlineTask[], _desc: string) => {},
  pullTasksFromFirebaseIfNewer: async (): Promise<DeadlineTask[] | null> => null,

  loadSettingsForm: async () => {},
  refreshAiKeyLock: async (_force = false) => {},
  scanActiveTab: async (_fullRescan = false) => {},
  renderScanStatus: (_status: any) => {},
  resetScanButton: () => {},
};
