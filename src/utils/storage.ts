export {
  normalizeRestoredSyncKey,
  isExtensionContextValid,
  safeGetLocalStorage,
  safeSetLocalStorage,
} from './storage/env';

export {
  SYNC_KEY_RANDOM_LENGTH,
  PREFERENCES_UPDATED_AT_KEY,
  CALENDAR_FEED_SHOW_KEY,
  generateUniqueSyncKey,
  getCachedSettingsSync,
  getSettings,
  saveSettings,
  getPreferencesUpdatedAt,
  savePreferencesUpdatedAt,
  getCalendarFeedShow,
  saveCalendarFeedShow,
  getLocalSharedPreferences,
  applyCloudSharedPreferences,
} from './storage/settingsStorage';

export {
  getCachedTasksSync,
  getTasks,
  saveTasksMergingLatest,
  saveTasks,
  addTask,
} from './storage/tasksStorage';

export {
  type ScanCheckpoint,
  getLastScanCheckpoint,
  saveLastScanCheckpoint,
  getAnnouncements,
  saveAnnouncements,
  SCAN_STATUS_KEY,
  type ScanStatus,
  SCAN_STALE_MS,
  setScanStatus,
  getScanStatus,
} from './storage/scanStorage';

export {
  getCachedQuickLinksSync,
  getQuickLinks,
  getQuickLinksUpdatedAt,
  saveQuickLinks,
  addQuickLink,
  updateQuickLink,
  deleteQuickLink,
  moveQuickLink,
  reorderQuickLinks,
  resetQuickLinksToDefault,
} from './storage/quickLinksStorage';

export {
  filterCleanUserCourses,
  getCachedCoursesSync,
  getUserCourses,
  getCoursesUpdatedAt,
  saveUserCourses,
  autoRegisterDiscoveredCourses,
  recalculateTasksWithActiveCourses,
} from './storage/coursesStorage';

export {
  PAYMENTS_STORAGE_KEY,
  PAYMENTS_UPDATED_AT_KEY,
  getCachedPaymentsSync,
  getStoredPayments,
  getStoredPaymentsUpdatedAt,
  saveStoredPayments,
  mergeCloudPaymentsStorage,
} from './paymentsStorage';

export {
  SEMESTERS_STORAGE_KEY,
  SEMESTERS_UPDATED_AT_KEY,
  getStoredSemesters,
  getStoredSemestersUpdatedAt,
  saveStoredSemesters,
  mergeCloudSemesters,
} from './semestersStorage';
