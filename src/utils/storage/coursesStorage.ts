import { DeadlineTask, UserCourseConfig } from '../../types';
import { filterCleanUserCourses } from '../../core/courseFilter';
import { hasValidAcademicCourseCode, isBlackboardSystemNoise } from '../../core/courseHelper';
import { resolveTaskRoom, resolveTaskTimeWithSchedule } from '../../core/courseSchedule';
import { resolveTaskWeight } from '../../core/syllabusWeights';
import { setActiveUserCourses } from '../../core/userCourses';
import {
  STORAGE_KEYS,
  isExtensionContextValid,
  safeGetLocalStorage,
  safeSetLocalStorage,
} from './env';
import { getTasks, saveTasks } from './tasksStorage';

// Lives in core so the phone app runs the same filter
export { filterCleanUserCourses };

export function getCachedCoursesSync(): UserCourseConfig[] {
  const raw = safeGetLocalStorage(STORAGE_KEYS.COURSES);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const clean = filterCleanUserCourses(parsed);
        setActiveUserCourses(clean);
        return clean;
      }
    } catch {}
  }
  return [];
}

export async function getUserCourses(): Promise<UserCourseConfig[]> {
  const finalizeAndClean = (courses: UserCourseConfig[]): UserCourseConfig[] => {
    const rawList = Array.isArray(courses) ? courses : [];
    const clean = filterCleanUserCourses(rawList);
    // If corrupted system tabs were found, automatically prune them from storage
    if (clean.length !== rawList.length) {
      getCoursesUpdatedAt().then(stamp => saveUserCourses(clean, stamp || undefined)).catch(() => {});
    } else {
      setActiveUserCourses(clean);
    }
    return clean;
  };

  if (isExtensionContextValid()) {
    try {
      return await new Promise<UserCourseConfig[]>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.COURSES], (result: { [key: string]: any }) => {
            try {
              if (chrome.runtime?.lastError) {
                const raw = safeGetLocalStorage(STORAGE_KEYS.COURSES);
                const courses = raw ? JSON.parse(raw) : [];
                resolve(finalizeAndClean(courses));
                return;
              }
              const courses = result?.[STORAGE_KEYS.COURSES];
              const resolved = Array.isArray(courses) ? courses : [];
              safeSetLocalStorage(STORAGE_KEYS.COURSES, JSON.stringify(resolved));
              resolve(finalizeAndClean(resolved));
            } catch {
              const raw = safeGetLocalStorage(STORAGE_KEYS.COURSES);
              const courses = raw ? JSON.parse(raw) : [];
              resolve(finalizeAndClean(courses));
            }
          });
        } catch {
          const raw = safeGetLocalStorage(STORAGE_KEYS.COURSES);
          const courses = raw ? JSON.parse(raw) : [];
          resolve(finalizeAndClean(courses));
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }

  const raw = safeGetLocalStorage(STORAGE_KEYS.COURSES);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return finalizeAndClean(parsed);
      }
    } catch {}
  }
  setActiveUserCourses([]);
  return [];
}

export async function getCoursesUpdatedAt(): Promise<string | null> {
  if (isExtensionContextValid()) {
    try {
      return await new Promise<string | null>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.COURSES_UPDATED_AT], (result: { [key: string]: any }) => {
            if (chrome.runtime?.lastError) {
              resolve(safeGetLocalStorage(STORAGE_KEYS.COURSES_UPDATED_AT));
              return;
            }
            const stamp = result?.[STORAGE_KEYS.COURSES_UPDATED_AT] || safeGetLocalStorage(STORAGE_KEYS.COURSES_UPDATED_AT);
            resolve(stamp || null);
          });
        } catch {
          resolve(safeGetLocalStorage(STORAGE_KEYS.COURSES_UPDATED_AT));
        }
      });
    } catch {
      // Fall through
    }
  }
  return safeGetLocalStorage(STORAGE_KEYS.COURSES_UPDATED_AT);
}

export async function saveUserCourses(courses: UserCourseConfig[], updatedAt?: string): Promise<void> {
  const safeCourses = Array.isArray(courses) ? courses : [];
  const stamp = updatedAt || new Date().toISOString();
  safeSetLocalStorage(STORAGE_KEYS.COURSES, JSON.stringify(safeCourses));
  safeSetLocalStorage(STORAGE_KEYS.COURSES_UPDATED_AT, stamp);
  setActiveUserCourses(safeCourses);

  if (isExtensionContextValid()) {
    try {
      await new Promise<void>(resolve => {
        try {
          chrome.storage.local.set({
            [STORAGE_KEYS.COURSES]: safeCourses,
            [STORAGE_KEYS.COURSES_UPDATED_AT]: stamp
          }, () => resolve());
        } catch {
          resolve();
        }
      });
      return;
    } catch {
      // Fall through
    }
  }
}

/**
 * Automatically registers newly discovered courses from scraped tasks or course lists into bbs_user_courses
 * if they do not already match any existing configured course, assigning vibrant unique palette colors.
 */
export async function autoRegisterDiscoveredCourses(
  tasksOrCourses: (DeadlineTask | { courseName?: string; courseCode?: string; colorHex?: string })[]
): Promise<UserCourseConfig[]> {
  const currentCourses = await getUserCourses();
  const palette = [
    '#2563eb', '#dc2626', '#059669', '#d97706',
    '#7c3aed', '#db2777', '#0891b2', '#ea580c',
    '#4f46e5', '#16a34a', '#9333ea', '#0284c7',
    '#b91c1c', '#0d9488', '#c026d3', '#65a30d'
  ];

  let addedCount = 0;
  const updatedCourses = [...currentCourses];

  for (const item of tasksOrCourses) {
    let rawName = (item.courseName || '').trim();
    let rawCode = (item.courseCode || '').trim();

    if (isBlackboardSystemNoise(rawName) || isBlackboardSystemNoise(rawCode)) continue;

    if (rawCode.toUpperCase() === 'UOS') rawCode = '';
    if (rawName.toLowerCase() === 'uos') rawName = '';
    if (rawName.toLowerCase() === 'general course') continue;
    if (!rawName && !rawCode) continue;

    if (!hasValidAcademicCourseCode(rawCode)) continue;

    const normTargetCode = rawCode.replace(/[\s_-]+/g, '').toLowerCase();
    const tName = rawName.toLowerCase();

    const exists = updatedCourses.some(c => {
      const cCodeNorm = (c.courseCode || '').replace(/[\s_-]+/g, '').toLowerCase();
      const cName = (c.courseName || '').trim().toLowerCase();

      if (cCodeNorm && normTargetCode && cCodeNorm === normTargetCode) return true;
      if (cName && tName && (cName === tName || tName.includes(cName) || cName.includes(tName))) return true;
      if (Array.isArray(c.aliases)) {
        return c.aliases.some(a => {
          const cleanA = a.trim().toLowerCase();
          const normA = cleanA.replace(/[\s_-]+/g, '');
          return cleanA && (
            (tName && tName.includes(cleanA)) ||
            (normTargetCode && normA && normTargetCode === normA)
          );
        });
      }
      return false;
    });

    if (!exists) {
      const usedColors = new Set(updatedCourses.map(c => c.colorHex?.toLowerCase()));
      const availableColors = palette.filter(hex => !usedColors.has(hex.toLowerCase()));
      const blackboardColor = (item as { colorHex?: string }).colorHex;
      const nextColor = typeof blackboardColor === 'string' && /^#[0-9a-f]{6}$/i.test(blackboardColor)
        ? blackboardColor.toLowerCase()
        : availableColors.length > 0
        ? availableColors[Math.floor(Math.random() * availableColors.length)]
        : palette[Math.floor(Math.random() * palette.length)];

      const id = 'course_' + (rawCode || rawName).toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 20) + '_' + Math.random().toString(36).substring(2, 6);

      updatedCourses.push({
        id,
        courseCode: rawCode || rawName,
        courseName: rawName || rawCode,
        colorHex: nextColor,
        aliases: rawCode && rawName && rawCode !== rawName ? [rawCode, rawName] : [rawCode || rawName],
        scheduleSlots: [],
        syllabus: []
      });
      addedCount++;
    }
  }

  if (addedCount > 0) {
    await saveUserCourses(updatedCourses);
  }

  return updatedCourses;
}

export async function recalculateTasksWithActiveCourses(): Promise<DeadlineTask[]> {
  const tasks = await getTasks();
  let changed = false;

  const updatedTasks = tasks.map(task => {
    if (task.userEdited || task.extractedBy === 'manual') return task;

    const resolvedWeight = resolveTaskWeight(task);
    let newWeight = task.weight;
    let newWeightDisplay = task.weightDisplay;

    if (resolvedWeight.weight !== undefined) {
      newWeight = resolvedWeight.weight;
      newWeightDisplay = resolvedWeight.weightDisplay;
    }

    let newRoom = task.room;
    if (!task.userEdited) {
      const roomRes = resolveTaskRoom({
        courseNameOrCode: task.courseName || task.courseCode,
        announcementText: task.description || task.sourceSnippet || '',
        title: task.title,
        type: task.type,
        existingRoom: task.room
      });
      if (roomRes.room) {
        newRoom = roomRes.room;
      }
    }

    let newDueDate = task.dueDate;
    let newHasSpecificTime = task.hasSpecificTime;
    if (!task.userEdited && task.hasSpecificTime === false && task.dueDate) {
      const timeRes = resolveTaskTimeWithSchedule({
        dueDate: new Date(task.dueDate),
        courseNameOrCode: task.courseName || task.courseCode,
        hasSpecificTime: false,
        announcementText: task.description || task.sourceSnippet || '',
        title: task.title
      });
      if (timeRes.appliedSchedule) {
        newDueDate = timeRes.dueDate.toISOString();
        newHasSpecificTime = true;
      }
    }

    if (
      newWeight !== task.weight ||
      newWeightDisplay !== task.weightDisplay ||
      newRoom !== task.room ||
      newDueDate !== task.dueDate ||
      newHasSpecificTime !== task.hasSpecificTime
    ) {
      changed = true;
      return {
        ...task,
        weight: newWeight,
        weightDisplay: newWeightDisplay,
        room: newRoom,
        dueDate: newDueDate,
        hasSpecificTime: newHasSpecificTime,
        updatedAt: new Date().toISOString()
      };
    }
    return task;
  });

  if (changed) {
    await saveTasks(updatedTasks);
  }
  return updatedTasks;
}

// Automatically sync cached courses into active state on module load
try {
  const cachedInitialCourses = getCachedCoursesSync();
  if (Array.isArray(cachedInitialCourses) && cachedInitialCourses.length > 0) {
    setActiveUserCourses(cachedInitialCourses);
  }
} catch {}
