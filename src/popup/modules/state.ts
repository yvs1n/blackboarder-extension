import type {
  DeadlineTask,
  PaymentItem,
  QuickLink,
  UserCourseConfig,
  ArchivedSemester,
} from '../../types';

export type AppView = 'calendar' | 'details' | 'marks' | 'courses' | 'payments' | 'settings';

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
  currentPayments: [] as PaymentItem[],
  currentQuickLinks: [] as QuickLink[],
  currentUserCourses: [] as UserCourseConfig[],
  currentFilterStatus: 'pending' as 'all' | 'pending' | 'completed' | 'hidden',
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
  dirtyViews: new Set<AppView>(['calendar', 'details', 'marks', 'courses', 'payments', 'settings']),
  draftReady: false,

  editingTaskId: null as string | null,
  editingCourseId: null as string | null,
  activeRoomPickerTaskId: null as string | null,
  scanCancelledByUser: false,
  currentThemeSetting: 'light' as 'light' | 'dark' | 'system',
};

const domElementCache = new Map<string, HTMLElement>();
function cachedEl<T extends HTMLElement>(id: string): T {
  const hit = domElementCache.get(id);
  if (hit && hit.isConnected) return hit as T;
  const el = document.getElementById(id) as T | null;
  if (el) domElementCache.set(id, el);
  return el as T;
}

/** Cached DOM element lookups used across popup modules (memoized while connected). */
export const dom = {
  tabNavCalendar: () => cachedEl<HTMLButtonElement>('tab-nav-calendar'),
  tabNavDetails: () => cachedEl<HTMLButtonElement>('tab-nav-details'),
  tabNavMarks: () => cachedEl<HTMLButtonElement>('tab-nav-marks'),
  tabNavCourses: () => cachedEl<HTMLButtonElement>('tab-nav-courses'),
  navBadgeCount: () => cachedEl<HTMLElement>('nav-badge-count'),

  viewCalendar: () => cachedEl<HTMLElement>('view-calendar'),
  viewDetails: () => cachedEl<HTMLElement>('view-details'),
  viewMarks: () => cachedEl<HTMLElement>('view-marks'),
  viewCourses: () => cachedEl<HTMLElement>('view-courses'),
  viewPayments: () => cachedEl<HTMLElement>('view-payments'),
  viewSettings: () => cachedEl<HTMLElement>('view-settings'),

  calMonthTitle: () => cachedEl<HTMLElement>('cal-month-title'),
  btnCalPrev: () => cachedEl<HTMLButtonElement>('btn-cal-prev'),
  btnCalNext: () => cachedEl<HTMLButtonElement>('btn-cal-next'),
  btnCalToday: () => cachedEl<HTMLButtonElement>('btn-cal-today'),
  calendarGrid: () => cachedEl<HTMLDivElement>('calendar-grid'),
  legendChipsContainer: () => cachedEl<HTMLDivElement>('legend-chips-container'),
  selectedDayTitle: () => cachedEl<HTMLElement>('selected-day-title'),
  selectedDayList: () => cachedEl<HTMLDivElement>('selected-day-list'),
  btnAddOnDate: () => cachedEl<HTMLButtonElement>('btn-add-on-date'),

  dayExpandedBackdrop: () => cachedEl<HTMLDivElement>('day-expanded-backdrop'),
  dayExpandedDrawer: () => cachedEl<HTMLElement>('day-expanded-drawer'),
  dayDrawerTitle: () => cachedEl<HTMLElement>('day-drawer-title'),
  dayDrawerSubtitle: () => cachedEl<HTMLElement>('day-drawer-subtitle'),
  btnDrawerAdd: () => cachedEl<HTMLButtonElement>('btn-drawer-add'),
  btnDrawerClose: () => cachedEl<HTMLButtonElement>('btn-drawer-close'),
  dayDrawerBody: () => cachedEl<HTMLDivElement>('day-drawer-body'),

  taskListEl: () => cachedEl<HTMLDivElement>('task-list'),
  searchInput: () => cachedEl<HTMLInputElement>('search-input'),
  filterCourseSelect: () => cachedEl<HTMLSelectElement>('filter-course'),
  filterTypeSelect: () => cachedEl<HTMLSelectElement>('filter-type'),

  statUrgentCount: () => cachedEl<HTMLElement>('stat-urgent-count'),
  statWeekCount: () => cachedEl<HTMLElement>('stat-week-count'),
  statTotalCount: () => cachedEl<HTMLElement>('stat-total-count'),

  btnScanTab: () => cachedEl<HTMLButtonElement>('btn-scan-tab'),
  btnAddModal: () => cachedEl<HTMLButtonElement>('btn-add-modal'),
  btnExportAllIcs: () => cachedEl<HTMLButtonElement>('btn-export-all-ics'),
  btnSettingsToggle: () => cachedEl<HTMLButtonElement>('btn-settings-toggle'),
  btnCancelAdd: () => cachedEl<HTMLButtonElement>('btn-cancel-add'),
  btnCancelSettings: () => cachedEl<HTMLButtonElement>('btn-cancel-settings'),

  headerScanBanner: () => cachedEl<HTMLDivElement>('header-scan-banner') as HTMLDivElement | null,
  hsbIcon: () => document.getElementById('hsb-icon') as SVGElement | null,
  hsbText: () => cachedEl<HTMLSpanElement>('hsb-text') as HTMLSpanElement | null,

  modalAddTask: () => cachedEl<HTMLElement>('modal-add-task') as HTMLElement | null,
  btnCloseAddModal: () => cachedEl<HTMLButtonElement>('btn-close-add-modal') as HTMLButtonElement | null,
  modalEditTask: () => cachedEl<HTMLElement>('modal-edit-task'),
  formAddTask: () => cachedEl<HTMLFormElement>('form-add-task'),
  formEditTask: () => cachedEl<HTMLFormElement>('form-edit-task'),
  formSettings: () => cachedEl<HTMLFormElement>('form-settings'),
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
  openAddTaskModal: (_options?: { dateStr?: string; focus?: boolean }) => {},
  closeAddTaskModal: () => {},
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
  renderPaymentsView: () => {},
  updatePaymentsHeaderBadge: () => {},
  togglePaymentPaid: async (_paymentId: string) => {},
  deletePaymentItem: async (_paymentId: string) => {},
  openPaymentModal: (_existing?: PaymentItem) => {},
};
