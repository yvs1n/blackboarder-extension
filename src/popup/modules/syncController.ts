import type { DeadlineTask, QuickLink, UserCourseConfig } from '../../types';
import { resolveTaskRoom, resolveTaskTimeWithSchedule } from '../../core/courseSchedule';
import { sanitizeSemesters } from '../../core/semesters';
import { profileUniversity } from '../../core/studentProfile';
import { resolveTaskWeight } from '../../core/syllabusWeights';
import { extractDeadlinesLocally } from '../../engine/localExtractor';
import { fetchTasksFromFirebase, pushTasksToFirebase } from '../../utils/firebaseSync';
import { purgeSyntheticGradebookTasks } from '../../utils/gradebook';
import { compareTasksByTime } from '../../utils/calendar';
import { SEMESTERS_STORAGE_KEY } from '../../utils/semestersStorage';
import {
  generateUniqueSyncKey,
  getCoursesUpdatedAt,
  getQuickLinks,
  getQuickLinksUpdatedAt,
  getSettings,
  getTasks,
  getUserCourses,
  recalculateTasksWithActiveCourses,
  safeSetLocalStorage,
  saveQuickLinks,
  saveSettings,
  saveTasksMergingLatest,
  saveUserCourses,
  SCAN_STATUS_KEY,
  type ScanStatus,
} from '../../utils/storage';
import { pickNewerList } from '../../utils/syncMerge';
import {
  findLegacyNamelessTaskIds,
  isValidTask,
  resolveCourseInfo,
  sanitizeDoctorAnnouncementText,
} from '../../core/courseHelper';
import { deduplicateTaskList, getTaskSeriesInfo, mergeCloudTasks, mergeTombstones } from '../../utils/taskMerge';
import { awaitTombstonesPersisted, getLocalTombstones, recordLocalTombstone } from '../../utils/tombstones';
import { getCachedProfile } from '../universitySettings';
import { applyTheme } from './theme';
import { dom, popupActions, popupState, type AppView } from './state';

let refreshScheduled = false;
export function refreshAllViews() {
  if (refreshScheduled) return;
  refreshScheduled = true;
  requestAnimationFrame(() => {
    refreshScheduled = false;
    renderAllViewsNow();
  });
}

export function updateBrandBadge(): void {
  const badge = document.querySelector<HTMLElement>('.brand-badge');
  if (!badge) return;
  const cached = getCachedProfile();
  const uni = profileUniversity(cached);
  badge.textContent = uni.shortName || 'UOS';
}

export function renderAllViewsNow() {
  updateBrandBadge();
  popupActions.updateStats(popupState.currentTasks);
  popupActions.updateCourseFilterOptions(popupState.currentTasks);
  popupActions.renderQuickLinksBar();

  if (popupState.currentActiveView === 'calendar') {
    popupActions.renderCalendar();
    popupActions.renderSelectedDay();
  } else if (popupState.currentActiveView === 'details') {
    popupActions.renderTasks();
  } else if (popupState.currentActiveView === 'marks') {
    popupActions.renderGradeTracker(popupState.currentTasks);
  } else if (popupState.currentActiveView === 'courses') {
    popupActions.renderUserCoursesManager();
  } else if (popupState.currentActiveView === 'settings') {
    popupActions.renderUserCoursesManager();
  }

  (['calendar', 'details', 'marks', 'courses', 'settings'] as AppView[]).forEach(v => {
    if (v !== popupState.currentActiveView) {
      popupState.dirtyViews.add(v);
    }
  });

  const drawer = dom.dayExpandedDrawer();
  if (drawer && drawer.classList.contains('open')) {
    popupActions.openDayExpandedDrawer(popupState.selectedDateStr);
  }
}

let persistChain: Promise<void> = Promise.resolve();
let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTasksToPersist: DeadlineTask[] | null = null;

export function persistTasksInBackground(tasks: DeadlineTask[], immediate = false): Promise<void> {
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

export function applyTaskUpdateLocal(taskId: string, updates: Partial<DeadlineTask>): DeadlineTask[] {
  const now = new Date().toISOString();
  popupState.currentTasks = popupState.currentTasks.map(t => (t.id === taskId ? { ...t, ...updates, updatedAt: now } : t));
  persistTasksInBackground(popupState.currentTasks);
  return popupState.currentTasks;
}

export function removeTaskLocal(taskId: string): DeadlineTask[] {
  popupState.currentTasks = popupState.currentTasks.filter(t => t.id !== taskId);
  persistTasksInBackground(popupState.currentTasks);
  return popupState.currentTasks;
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

let cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCloudSyncAction = 'Extension Update';

export function syncTasksToCloud(tasks: DeadlineTask[], actionDescription: string = 'Extension Update', immediate = false) {
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

export async function executeCloudSync(tasks: DeadlineTask[], actionDescription: string) {
  try {
    await Promise.all([persistChain, awaitTombstonesPersisted()]);
    const pulled = await pullTasksFromFirebaseIfNewer();
    const toPush = pulled ?? tasks;
    const [settings, tombstones, coursesUpdatedAt] = await Promise.all([getSettings(), getLocalTombstones(), getCoursesUpdatedAt()]);

    pushTasksToFirebase(
      toPush,
      actionDescription,
      settings.syncKey,
      popupState.currentQuickLinks,
      tombstones,
      popupState.currentUserCourses,
      coursesUpdatedAt || undefined,
      (await getQuickLinksUpdatedAt()) || undefined
    ).then(res => {
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

export async function pullTasksFromFirebaseIfNewer(): Promise<DeadlineTask[] | null> {
  let result: DeadlineTask[] | null = null;
  try {
    const settings = await getSettings();
    const res = await fetchTasksFromFirebase(settings.syncKey);
    if (res.deleted && settings.syncKey) {
      console.warn('[Firebase Sync] Sync key was deleted on another device. Unpairing...');
      await saveSettings({ syncKey: '' });
      safeSetLocalStorage('bbs_persistent_sync_key', '');
      safeSetLocalStorage('bbs_sync_key', '');
      const input = document.getElementById('setting-sync-key') as HTMLInputElement | null;
      if (input) input.value = '';
      popupActions.showToast('Your Sync Key was deleted on another device. This device has been unpaired.');
      refreshAllViews();
      return null;
    }
    if (res.success && Array.isArray(res.tasks)) {
      const localTombs = await getLocalTombstones();
      const tombstones = mergeTombstones(localTombs, res.tombstones || {});
      if (JSON.stringify(tombstones) !== JSON.stringify(localTombs)) {
        chrome.storage?.local?.set({ bbs_tombstones: tombstones });
      }

      const { tasks, changed } = mergeCloudTasks(popupState.currentTasks, res.tasks, tombstones);
      if (changed) {
        popupState.currentTasks = (await saveTasksMergingLatest(tasks)).sort(compareTasksByTime);
        refreshAllViews();
        result = popupState.currentTasks;
        console.log('[Firebase Sync] Merged notes & deadline updates from mobile phone/cloud');
      }

      const linksPick = pickNewerList(
        { items: popupState.currentQuickLinks, updatedAt: await getQuickLinksUpdatedAt() },
        { items: res.quickLinks, updatedAt: res.quickLinksUpdatedAt },
        true
      );
      if (linksPick.fromCloud && linksPick.items && JSON.stringify(linksPick.items) !== JSON.stringify(popupState.currentQuickLinks)) {
        popupState.currentQuickLinks = linksPick.items;
        await saveQuickLinks(popupState.currentQuickLinks, linksPick.updatedAt);
        popupActions.renderQuickLinksBar();
        (popupActions as any).renderQuickLinksManager?.();
      }

      const coursesPick = pickNewerList(
        { items: popupState.currentUserCourses, updatedAt: await getCoursesUpdatedAt() },
        { items: res.courses, updatedAt: res.coursesUpdatedAt },
        true
      );
      if (coursesPick.fromCloud && coursesPick.items && JSON.stringify(coursesPick.items) !== JSON.stringify(popupState.currentUserCourses)) {
        popupState.currentUserCourses = coursesPick.items;
        await saveUserCourses(popupState.currentUserCourses, coursesPick.updatedAt);
        popupState.currentTasks = await recalculateTasksWithActiveCourses();
        popupActions.renderUserCoursesManager();
        popupActions.renderLegend();
        popupActions.updateCourseFilterOptions(popupState.currentTasks);
        refreshAllViews();
      }

      if (res.semesters) {
        await popupActions.updateSemesterSelector();
      }

      if (res.lastSync === undefined && settings.syncKey) {
        const coursesUpdatedAt = await getCoursesUpdatedAt();
        pushTasksToFirebase(
          popupState.currentTasks,
          'Initial Sync Key Provisioning',
          settings.syncKey,
          popupState.currentQuickLinks,
          tombstones,
          popupState.currentUserCourses,
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

export function setupStorageAndSyncListeners() {
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.bbs_tasks) {
        const newTasks = (changes.bbs_tasks.newValue as DeadlineTask[]) || [];
        try { localStorage.setItem('bbs_tasks', JSON.stringify(newTasks)); } catch {}
        popupState.currentTasks = deduplicateTaskList(newTasks.filter(isValidTask));
        popupState.currentTasks.sort(compareTasksByTime);
        refreshAllViews();
      }
      if (area === 'local' && changes.bbs_settings) {
        const newSettings = changes.bbs_settings.newValue as any;
        if (newSettings?.theme && newSettings.theme !== popupState.currentThemeSetting) {
          applyTheme(newSettings.theme);
        }
      }
      if (area === 'local' && changes[SCAN_STATUS_KEY]) {
        popupActions.renderScanStatus(changes[SCAN_STATUS_KEY].newValue as ScanStatus);
      }
      if (area === 'local' && changes.bbs_quick_links) {
        popupState.currentQuickLinks = (changes.bbs_quick_links.newValue as QuickLink[]) || [];
        popupActions.renderQuickLinksBar();
        (popupActions as any).renderQuickLinksManager?.();
      }
      if (area === 'local' && changes.bbs_user_courses) {
        popupState.currentUserCourses = (changes.bbs_user_courses.newValue as UserCourseConfig[]) || [];
        popupActions.renderUserCoursesManager();
        popupActions.renderLegend();
        popupActions.updateCourseFilterOptions(popupState.currentTasks);
        refreshAllViews();
      }
      if (area === 'local' && changes[SEMESTERS_STORAGE_KEY]) {
        popupState.cachedSemesters = sanitizeSemesters(changes[SEMESTERS_STORAGE_KEY].newValue);
        popupActions.updateSemesterSelector().catch(() => {});
        refreshAllViews();
      }
    });
  }

  try {
    const syncChannel = new BroadcastChannel('bbs_sync_channel');
    syncChannel.onmessage = (event) => {
      if (event.data?.type === 'THEME_CHANGED' && event.data.theme) {
        applyTheme(event.data.theme);
      }
    };
  } catch {}

  window.addEventListener('focus', () => {
    pullTasksFromFirebaseIfNewer();
  });

  setInterval(() => {
    pullTasksFromFirebaseIfNewer();
  }, 25000);
}

export async function refreshDataInBackground() {
  try {
    const freshTasks = (await getTasks()).filter(isValidTask);
    const freshLinks = await getQuickLinks();
    const freshCourses = await getUserCourses();
    let viewsNeedUpdate = false;

    if (Array.isArray(freshCourses) && JSON.stringify(freshCourses) !== JSON.stringify(popupState.currentUserCourses)) {
      popupState.currentUserCourses = freshCourses;
      popupActions.renderUserCoursesManager();
      popupActions.renderLegend();
      popupActions.updateCourseFilterOptions(popupState.currentTasks);
      viewsNeedUpdate = true;
    }

    if (freshLinks && freshLinks.length > 0 && JSON.stringify(freshLinks) !== JSON.stringify(popupState.currentQuickLinks)) {
      popupState.currentQuickLinks = freshLinks;
      popupActions.renderQuickLinksBar();
      (popupActions as any).renderQuickLinksManager?.();
    }

    if (freshTasks && freshTasks.length > 0 && JSON.stringify(freshTasks) !== JSON.stringify(popupState.currentTasks)) {
      popupState.currentTasks = freshTasks;
      popupState.currentTasks.sort(compareTasksByTime);
      viewsNeedUpdate = true;
    }

    const currentSettings = await getSettings();
    if (!currentSettings.syncKey) {
      const keyToUse = generateUniqueSyncKey();
      await saveSettings({ syncKey: keyToUse });
      currentSettings.syncKey = keyToUse;
    }

    await pullTasksFromFirebaseIfNewer();
    popupState.currentTasks = deduplicateTaskList(popupState.currentTasks.filter(isValidTask));

    let updatedAny = false;
    popupState.currentTasks = popupState.currentTasks.map(task => {
      if (task.userEdited || task.extractedBy === 'manual') {
        return task;
      }

      let taskUpdated = false;
      let description = task.description || '';
      let sourceSnippet = task.sourceSnippet || '';

      if (description.startsWith('Blackboard Ultra Stream item')) {
        description = '';
        taskUpdated = true;
      }

      const cleanDesc = sanitizeDoctorAnnouncementText(description, task.courseName, task.courseCode, task.title);
      if (cleanDesc !== description) {
        description = cleanDesc;
        taskUpdated = true;
      }

      const cleanSnippet = sanitizeDoctorAnnouncementText(sourceSnippet, task.courseName, task.courseCode, task.title);
      if (cleanSnippet !== sourceSnippet) {
        sourceSnippet = cleanSnippet;
        taskUpdated = true;
      }

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
        sourceSnippet,
      });
      if (resolvedCourse.courseName !== 'General Course' && (!courseName || courseName === 'General Course' || courseName.toLowerCase() === 'uos')) {
        courseName = resolvedCourse.courseName;
        taskUpdated = true;
      }
      if (resolvedCourse.courseCode && !courseCode) {
        courseCode = resolvedCourse.courseCode;
        taskUpdated = true;
      }

      const seriesInfo = getTaskSeriesInfo(task, popupState.currentTasks);
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

      if (resolved.weight !== undefined && resolved.weight !== task.weight) {
        weight = resolved.weight;
        weightDisplay = resolved.weightDisplay;
        syllabusNote = resolved.syllabusNote;
        taskUpdated = true;
      }

      let dueDate = task.dueDate;
      let hasSpecificTime = task.hasSpecificTime;

      const isGradebookTask = task.id.startsWith('gbcol_') || task.sourceSnippet === 'gradebook';
      if (isGradebookTask && !task.announcementId) {
        if (dueDate && task.createdAt && dueDate.slice(0, 10) === task.createdAt.slice(0, 10)) {
          dueDate = '';
          hasSpecificTime = false;
          taskUpdated = true;
        }
      } else {
        if (!hasSpecificTime) {
          const combinedDoctorText = `${task.title} ${task.sourceSnippet || ''} ${task.description || ''}`;
          const testAnn = {
            id: task.announcementId || 'temp',
            courseCode,
            courseName,
            title: task.title,
            contentText: combinedDoctorText,
            sourceUrl: '',
            scannedAt: new Date().toISOString(),
          };
          const extractedTasks = extractDeadlinesLocally(testAnn);
          if (extractedTasks.length > 0) {
            const best = extractedTasks[0];
            const bestDate = new Date(best.dueDate);
            const curDate = new Date(task.dueDate);
            if (best.hasSpecificTime) {
              curDate.setHours(bestDate.getHours(), bestDate.getMinutes(), 0, 0);
              dueDate = curDate.toISOString();
              hasSpecificTime = true;
              taskUpdated = true;
            }
          }
        }

        if (!hasSpecificTime && dueDate && !isNaN(new Date(dueDate).getTime())) {
          const schedRes = resolveTaskTimeWithSchedule({
            dueDate: new Date(dueDate),
            courseNameOrCode: courseName || courseCode,
            hasSpecificTime: false,
            announcementText: description || sourceSnippet,
            title: task.title,
          });
          if (schedRes.appliedSchedule && schedRes.dueDate && !isNaN(schedRes.dueDate.getTime())) {
            dueDate = schedRes.dueDate.toISOString();
            hasSpecificTime = schedRes.hasSpecificTime;
            taskUpdated = true;
          }
        }
      }

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
          type: task.type,
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
          updatedAt: new Date().toISOString(),
        };
      }

      return task;
    });

    popupState.currentTasks = deduplicateTaskList(popupState.currentTasks.filter(isValidTask));
    popupState.currentTasks.sort(compareTasksByTime);

    const { cleaned: purgedTasks, purgedIds } = purgeSyntheticGradebookTasks(popupState.currentTasks);
    if (purgedIds.length > 0) {
      popupState.currentTasks = purgedTasks;
      await Promise.all(purgedIds.map(id => recordLocalTombstone(id)));
      await saveTasksMergingLatest(popupState.currentTasks);
      syncTasksToCloud(popupState.currentTasks, 'Purge synthetic gradebook tasks');
      viewsNeedUpdate = true;
      updatedAny = true;
    }

    if (!(await readLocalFlag(LEGACY_NAMELESS_CLEANUP_KEY))) {
      const legacyIds = new Set<string>(findLegacyNamelessTaskIds(
        popupState.currentTasks.filter(t => t.sourceSnippet !== 'gradebook' && !t.gradeSourceId && !t.id.startsWith('gbcol_'))
      ));
      if (legacyIds.size > 0) {
        popupState.currentTasks = popupState.currentTasks.filter(t => !legacyIds.has(t.id));
        legacyIds.forEach(id => recordLocalTombstone(id));
        updatedAny = true;
      }
      await writeLocalFlag(LEGACY_NAMELESS_CLEANUP_KEY);
    }

    for (const task of popupState.currentTasks) {
      if (task.notes && !task.userEdited && task.extractedBy !== 'manual') {
        delete task.notes;
        task.updatedAt = new Date().toISOString();
        updatedAny = true;
      }
    }

    const rawLocalTasks = await getTasks();
    if (rawLocalTasks.length !== popupState.currentTasks.length) {
      updatedAny = true;
    }
    if (updatedAny) {
      popupState.currentTasks = (await saveTasksMergingLatest(popupState.currentTasks)).sort(compareTasksByTime);
      syncTasksToCloud(popupState.currentTasks, 'Retroactive Upgrades & Cleanup');
      refreshAllViews();
    } else if (viewsNeedUpdate) {
      refreshAllViews();
    }
  } catch (err) {
    console.info('[Popup] Background data refresh encountered error:', err);
  }
}
