import { isValidTask } from '../core/courseHelper';
import { sanitizeSemesters } from '../core/semesters';
import { profileUniversity } from '../core/studentProfile';
import { compareTasksByTime } from '../utils/calendar';
import { purgeSyntheticGradebookTasks } from '../utils/gradebook';
import { SEMESTERS_STORAGE_KEY } from '../utils/semestersStorage';
import {
  getCachedCoursesSync,
  getCachedQuickLinksSync,
  getCachedTasksSync,
  getQuickLinks,
  getScanStatus,
  getTasks,
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
  rememberDraft,
  restoreDraft,
  setupNavigationAndTaskEvents,
  showSettingsPage,
  switchView,
} from './modules/navigation';
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
});

function setupEvents() {
  initLegendScroll();
  initCalendarGestures();
  setupCalendarEvents();
  setupDayDrawerEvents();
  setupTaskFilterEvents();
  setupNavigationAndTaskEvents();
  setupSettingsEvents();
  setupCourseEvents();

  const btnScanTab = dom.btnScanTab();
  const headerScanBanner = dom.headerScanBanner();
  document.getElementById('hsb-close')?.addEventListener('click', e => {
    e.stopPropagation();
    const isScanRunning = btnScanTab.disabled || (headerScanBanner?.classList.contains('is-active') &&
      !headerScanBanner?.classList.contains('is-success') &&
      !headerScanBanner?.classList.contains('is-warning'));
    if (isScanRunning) stopActiveScan();
    else hideScanBanner();
  });
  headerScanBanner?.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    if (target.closest('#hsb-close')) return;
    if (headerScanBanner.classList.contains('is-success') || headerScanBanner.classList.contains('is-warning')) {
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
    updateSemesterSelector().catch(() => {});
    let rawTasks = await getTasks();
    if (!rawTasks || rawTasks.length === 0) rawTasks = getCachedTasksSync();
    const validTasks = rawTasks.filter(isValidTask);
    const { cleaned: purgedCached, purgedIds: startupPurgedIds } = purgeSyntheticGradebookTasks(validTasks);
    const freshTasks = deduplicateTaskList(purgedCached);
    freshTasks.sort(compareTasksByTime);

    if (JSON.stringify(freshTasks) !== JSON.stringify(popupState.currentTasks)) {
      popupState.currentTasks = freshTasks;
      refreshAllViews();
    }

    if (startupPurgedIds.length > 0) {
      startupPurgedIds.forEach(id => recordLocalTombstone(id));
      saveTasksMergingLatest(popupState.currentTasks).catch(() => {});
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
  setupStorageAndSyncListeners();

  getScanStatus().then(status => {
    if (status?.state === 'running') renderScanStatus(status);
    else hideScanBanner();
  }).catch(() => {});

  const runBackgroundRefresh = () => refreshDataInBackground().catch(() => {});
  if (typeof (window as any).requestIdleCallback === 'function') {
    (window as any).requestIdleCallback(runBackgroundRefresh, { timeout: 1200 });
  } else {
    setTimeout(runBackgroundRefresh, 250);
  }
}

document.addEventListener('DOMContentLoaded', initApp);
