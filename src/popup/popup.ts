import { isValidTask } from '../core/courseHelper';
import { setActiveUserCourses } from '../core/userCourses';
import { sanitizeSemesters } from '../core/semesters';
import { profileUniversity } from '../core/studentProfile';
import { compareTasksByTime } from '../utils/calendar';
import { purgeSyntheticGradebookTasks } from '../utils/gradebook';
import { SEMESTERS_STORAGE_KEY } from '../utils/semestersStorage';
import {
  getCachedCoursesSync,
  getCachedPaymentsSync,
  getCachedQuickLinksSync,
  getCachedTasksSync,
  getQuickLinks,
  getScanStatus,
  getStoredPayments,
  getTasks,
  getUserCourses,
  saveTasksMergingLatest,
} from '../utils/storage';
import { deduplicateTaskList } from '../utils/taskMerge';
import { recordLocalTombstone } from '../utils/tombstones';
import { initUniversitySettings } from './universitySettings';
import { initAiExtractModal } from './modules/aiExtractModal';
import {
  initCalendarGestures,
  initLegendScroll,
  openAddModalOnDate,
  renderCalendar,
  renderLegend,
  setupCalendarEvents,
  updateLegendScrollArrows,
} from './modules/calendarView';
import { openCourseImporter } from './modules/courseImporter';
import {
  handleCoursesUpdated,
  openCourseEditor,
  renderUserCoursesManager,
  setupCourseEvents,
} from './modules/coursesView';
import {
  closeDayExpandedDrawer,
  openDayExpandedDrawer,
  renderSelectedDay,
  selectDay,
  setupDayDrawerEvents,
} from './modules/dayDrawer';
import {
  initGradeTrackerToggle,
  renderGradeTracker,
  updateSemesterSelector,
} from './modules/marksView';
import {
  closeAddTaskModal,
  openAddTaskModal,
  rememberDraft,
  restoreDraft,
  setupNavigationAndTaskEvents,
  showSettingsPage,
  switchView,
} from './modules/navigation';
import { initOverlayKeyboardHandler } from './modules/overlayController';
import { initDebugStick } from './modules/debugStick';
import {
  initPaymentsView,
  openPaymentModal,
  renderPaymentsView,
  togglePaymentPaid,
  deletePaymentItem,
  updatePaymentsHeaderBadge,
} from './modules/paymentsView';
import {
  initQuickLinksModal,
  openQuickLinkUrl,
  renderQuickLinksBar,
  renderQuickLinksManager,
} from './modules/quickLinksView';
import {
  closeEditModal,
  closeReadingSheet,
  closeRoomPicker,
  openEditModal,
  openReadingSheet,
  openRoomPicker,
  updateAddRoomVisibility,
  updateEditRoomVisibility,
} from './modules/readingModal';
import {
  hideScanBanner,
  isScanUiActive,
  renderScanStatus,
  resetScanButton,
  scanActiveTab,
  stopActiveScan,
} from './modules/scanBanner';
import {
  initExtensionUpdateSystem,
  initSessionBanner,
  initWalkthroughModal,
  loadSettingsForm,
  refreshAiKeyLock,
  setupSettingsEvents,
} from './modules/settingsView';
import { dom, formatDateKey, popupActions, popupState } from './modules/state';
import {
  applyTaskUpdateLocal,
  executeCloudSync,
  persistTasksInBackground,
  pullTasksFromFirebaseIfNewer,
  refreshAllViews,
  refreshDataInBackground,
  removeTaskLocal,
  renderAllViewsNow,
  setupStorageAndSyncListeners,
  syncTasksToCloud,
} from './modules/syncController';
import {
  shareTask,
  showToast,
  renderTasks,
  setupTaskFilterEvents,
  updateCourseFilterOptions,
  updateStats,
} from './modules/tasksView';
import { initThemeSync, migrateThemeToSystemDefault } from './modules/theme';
import { initLanguageSync } from './modules/language';
import { initCalibrationModal, maybeRunFirstScanCalibration } from './modules/calibrationModal';

// Wire cross-module action registry once at startup
Object.assign(popupActions, {
  refreshAllViews,
  renderAllViewsNow,
  switchView,
  showSettingsPage,
  rememberDraft,
  restoreDraft,
  renderCalendar,
  renderLegend,
  updateLegendScrollArrows,
  selectDay,
  renderSelectedDay,
  openDayExpandedDrawer,
  closeDayExpandedDrawer,
  updateStats,
  updateCourseFilterOptions,
  renderTasks,
  showToast,
  shareTask,
  renderGradeTracker,
  updateSemesterSelector,
  renderUserCoursesManager,
  openCourseEditor,
  openCourseImporter,
  handleCoursesUpdated,
  renderQuickLinksBar,
  renderQuickLinksManager,
  openQuickLinkUrl,
  openReadingSheet,
  closeReadingSheet,
  openRoomPicker,
  closeRoomPicker,
  openEditModal,
  closeEditModal,
  openAddTaskModal,
  closeAddTaskModal,
  openAddModalOnDate,
  updateAddRoomVisibility,
  updateEditRoomVisibility,
  persistTasksInBackground,
  applyTaskUpdateLocal,
  removeTaskLocal,
  syncTasksToCloud,
  executeCloudSync,
  pullTasksFromFirebaseIfNewer,
  loadSettingsForm,
  refreshAiKeyLock,
  scanActiveTab: (fullRescan = false) => scanActiveTab(fullRescan, refreshDataInBackground),
  renderScanStatus,
  resetScanButton,
  renderPaymentsView,
  updatePaymentsHeaderBadge,
  togglePaymentPaid,
  deletePaymentItem,
  openPaymentModal,
});

function setupEvents() {
  initOverlayKeyboardHandler();
  initLegendScroll();
  initCalendarGestures();
  setupCalendarEvents();
  setupDayDrawerEvents();
  setupTaskFilterEvents();
  setupNavigationAndTaskEvents();
  setupSettingsEvents();
  setupCourseEvents();
  initPaymentsView();

  const btnScanTab = dom.btnScanTab();
  const headerScanBanner = dom.headerScanBanner();
  document.getElementById('hsb-close')?.addEventListener('click', e => {
    e.stopPropagation();
    if (isScanUiActive()) stopActiveScan();
    else hideScanBanner();
  });
  headerScanBanner?.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    if (target.closest('#hsb-close')) return;
    if (!isScanUiActive() && (headerScanBanner.classList.contains('is-success') || headerScanBanner.classList.contains('is-warning'))) {
      hideScanBanner();
    }
  });
  btnScanTab.title = 'Scan Blackboard (Shift+Click for Full Re-scan)';
  btnScanTab.addEventListener('click', (e: MouseEvent) => void scanActiveTab(e.shiftKey, refreshDataInBackground));
}

function isToolbarPopup(): boolean {
  const params = window.location.search;
  if (params.includes('standalone=1') || params.includes('view=panel')) return false;
  try {
    const popups = chrome.extension?.getViews?.({ type: 'popup' });
    if (popups) return popups.includes(window);
  } catch {}
  return window.innerWidth <= 520;
}

async function initApp() {
  if (!isToolbarPopup()) {
    document.documentElement.classList.add('is-standalone');
    document.body.classList.add('is-standalone');
  }

  initThemeSync();
  migrateThemeToSystemDefault();
  void initLanguageSync();

  const now = new Date();
  popupState.calendarYear = now.getFullYear();
  popupState.calendarMonth = now.getMonth();
  popupState.selectedDateStr = formatDateKey(now);

  setupEvents();
  initAiExtractModal();
  initGradeTrackerToggle();

  popupState.currentUserCourses = getCachedCoursesSync();
  renderLegend();

  popupState.currentQuickLinks = getCachedQuickLinksSync();
  renderQuickLinksBar();
  initQuickLinksModal();

  popupState.currentPayments = getCachedPaymentsSync();
  updatePaymentsHeaderBadge();

  const cachedTasks = getCachedTasksSync();
  if (cachedTasks && cachedTasks.length > 0) {
    const validCached = cachedTasks.filter(isValidTask);
    popupState.currentTasks = deduplicateTaskList(validCached);
    popupState.currentTasks.sort(compareTasksByTime);
  }
  try {
    const rawSemesters = localStorage.getItem(SEMESTERS_STORAGE_KEY);
    if (rawSemesters) popupState.cachedSemesters = sanitizeSemesters(JSON.parse(rawSemesters));
  } catch {}

  renderAllViewsNow();
  switchView('calendar');
  restoreDraft();

  (async () => {
    const taskSig = (list: typeof popupState.currentTasks) =>
      list.map(t => `${t.id}:${t.updatedAt}:${t.status}:${t.visibility || ''}:${t.hiddenReason || ''}:${t.ignoreMark ? 1 : 0}:${t.dueDate}:${t.room || ''}:${t.weight ?? ''}:${t.score ?? ''}:${t.submissionStatus || ''}:${(t.description || '').length}`).join('\n');

    updateSemesterSelector().catch(() => {});
    const storedCourses = await getUserCourses().catch(() => []);
    if (Array.isArray(storedCourses) && JSON.stringify(storedCourses) !== JSON.stringify(popupState.currentUserCourses)) {
      popupState.currentUserCourses = storedCourses;
      setActiveUserCourses(storedCourses);
      renderLegend();
    }

    let rawTasks = await getTasks();
    if (!rawTasks || rawTasks.length === 0) rawTasks = getCachedTasksSync();
    const validTasks = rawTasks.filter(isValidTask);
    const { cleaned: purgedCached, purgedIds: startupPurgedIds } = purgeSyntheticGradebookTasks(validTasks);
    const freshTasks = deduplicateTaskList(purgedCached);
    const dedupPurgedIds = purgedCached
      .filter(t => t && t.id && !(t.id.startsWith('gbcol_') && t.sourceSnippet === 'gradebook'))
      .map(t => t.id)
      .filter(id => !freshTasks.some(f => f.id === id));
    const allStartupPurged = [...startupPurgedIds, ...dedupPurgedIds];
    freshTasks.sort(compareTasksByTime);
    const startupRuleChanged = taskSig(freshTasks) !== taskSig(validTasks);

    if (taskSig(freshTasks) !== taskSig(popupState.currentTasks)) {
      popupState.currentTasks = freshTasks;
      refreshAllViews();
    }

    if (allStartupPurged.length > 0 || startupRuleChanged) {
      allStartupPurged.forEach(id => recordLocalTombstone(id));
      saveTasksMergingLatest(popupState.currentTasks)
        .then(saved => {
          popupState.currentTasks = saved.sort(compareTasksByTime);
          syncTasksToCloud(popupState.currentTasks, allStartupPurged.length > 0 ? 'Auto-Purge Redundant Deadlines' : 'Apply Rulebook Visibility');
        })
        .catch(() => {});
    }

    const storedPayments = await getStoredPayments().catch(() => []);
    if (JSON.stringify(storedPayments) !== JSON.stringify(popupState.currentPayments)) {
      popupState.currentPayments = storedPayments;
      refreshAllViews();
    }
  })().catch(() => {});

  initWalkthroughModal();

  initUniversitySettings({
    toast: message => showToast(message),
    onProfileChanged: (profile, fromHere, previousUniversityId) => {
      refreshAllViews();
      if (!fromHere) return;
      (async () => {
        if (profileUniversity(profile).id !== previousUniversityId) {
          popupState.currentQuickLinks = await getQuickLinks();
          renderQuickLinksBar();
          renderQuickLinksManager();
        }
        syncTasksToCloud(popupState.currentTasks, 'University Update');
      })();
    }
  }).catch(err => console.error('[University] Settings failed to load:', err));

  initSessionBanner();
  initExtensionUpdateSystem();
  initDebugStick();
  initCalibrationModal();
  setupStorageAndSyncListeners();

  getScanStatus().then(status => {
    if (status?.state === 'running') renderScanStatus(status);
    else hideScanBanner();
    if (status?.state === 'done') {
      void maybeRunFirstScanCalibration(true);
    }
  }).catch(() => {});

  const runBackgroundRefresh = () => refreshDataInBackground().catch(() => {});
  if (typeof (window as any).requestIdleCallback === 'function') {
    (window as any).requestIdleCallback(runBackgroundRefresh, { timeout: 1200 });
  } else {
    setTimeout(runBackgroundRefresh, 250);
  }
}

document.addEventListener('DOMContentLoaded', initApp);
