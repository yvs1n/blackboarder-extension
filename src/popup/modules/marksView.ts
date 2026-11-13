import type { ArchivedSemester, DeadlineTask, StudentProfile, UserCourseConfig } from '../../types';
import { getAllSyllabi } from '../../core/syllabusWeights';
import { getCourseHex } from '../../core/courseColors';
import { saveTasksMergingLatest, saveUserCourses } from '../../utils/storage';
import { getStoredSemesters, saveStoredSemesters } from '../../utils/semestersStorage';
import { saveProfile } from '../../utils/profile';
import { getCachedProfile, renderStudentIdentity } from '../universitySettings';
import {
  initMarksViewController,
  renderGradeTracker as marksRenderGradeTracker,
  updateSemesterSelector as marksUpdateSemesterSelector,
} from '../marksViewController';
import { popupActions, popupState } from './state';

export function getMarksControllerHooks() {
  return {
    getTasks: () => popupState.currentTasks,
    saveTasks: async (tasks: DeadlineTask[]) => {
      popupState.currentTasks = await saveTasksMergingLatest(tasks);
      return popupState.currentTasks;
    },
    getUserCourses: () => popupState.currentUserCourses,
    saveUserCourses: async (courses: UserCourseConfig[], updatedAt: string) => {
      popupState.currentUserCourses = courses;
      await saveUserCourses(courses, updatedAt);
    },
    getSemesters: () => popupState.cachedSemesters,
    saveSemesters: async (semesters: ArchivedSemester[]) => {
      popupState.cachedSemesters = semesters;
      await saveStoredSemesters(semesters);
    },
    getProfile: () => getCachedProfile(),
    saveProfile: async (p: StudentProfile) => {
      await saveProfile(p);
    },
    getAllSyllabi: () => getAllSyllabi(),
    getCourseHex: (name: string) => getCourseHex(name),
    renderStudentIdentity: (p: StudentProfile | null) => renderStudentIdentity(p),
    renderTasks: () => popupActions.renderTasks(),
    refreshAllViews: () => popupActions.refreshAllViews(),
    syncCloud: (tasks: DeadlineTask[], reason: string) => popupActions.syncTasksToCloud(tasks, reason),
    showToast: (msg: string) => popupActions.showToast(msg),
    getSelectedSemesterId: () => popupState.selectedSemesterViewId,
    setSelectedSemesterId: (id: string) => { popupState.selectedSemesterViewId = id; },
  };
}

export async function updateSemesterSelector(): Promise<void> {
  try {
    popupState.cachedSemesters = await getStoredSemesters();
  } catch {}
  await marksUpdateSemesterSelector(getMarksControllerHooks());
}

export function renderGradeTracker(tasks: DeadlineTask[]) {
  marksRenderGradeTracker(tasks, getMarksControllerHooks());
}

export function initGradeTrackerToggle() {
  initMarksViewController(getMarksControllerHooks());
}
