export {
  normalizeRestoredSyncKey,
  isExtensionContextValid,
  safeGetLocalStorage,
  safeSetLocalStorage,
} from './storage/env';

export {
  SYNC_KEY_RANDOM_LENGTH,
  generateUniqueSyncKey,
  getCachedSettingsSync,
  getSettings,
  saveSettings,
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
