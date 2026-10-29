import { DeadlineTask } from '../types';
import { resolveCourseInfo, isValidTask, stripAutoNotes } from '../core/courseHelper';
import { coreTitle, isPracticeTitle } from './streamParser';
import { extractAssessmentNumber, extractExplicitPoints } from '../core/syllabusWeights';
import { purgeSyntheticGradebookTasks, isExamItem } from './gradebook';

export { extractAssessmentNumber };

export type TombstoneMap = Record<string, string>;

/**
 * Strips impossible or orphaned marks from a single task:
 * - Tasks whose `submissionStatus` is not `'graded'` (e.g. `'submitted'`) never keep a score.
 * - Tasks whose title states explicit points (e.g. "15 درجة") never keep a mark with a different `maxScore` (e.g. 10).
 * - Gradebook column tasks (`gbcol_<course>_<colId>`) never keep a mark from a different gradebook column.
 */
export function sanitizeTaskMarks(task: DeadlineTask): DeadlineTask {
  if (!task || typeof task !== 'object') return task;

  if (task.submissionStatus !== 'graded') {
    if (
      task.score !== undefined ||
      task.maxScore !== undefined ||
      task.scoreDisplay !== undefined ||
      task.gradedAt !== undefined ||
      task.markProvisional !== undefined
    ) {
      const copy: any = { ...task };
      delete copy.score;
      delete copy.maxScore;
      delete copy.scoreDisplay;
      delete copy.gradedAt;
      delete copy.markProvisional;
      return copy as DeadlineTask;
    }
    return task;
  }

  const isWeightPhrase = /(?:worth\s*\d|\bweight\b|%|بنسبة|وزن)/i.test(task.title);
  const explicitPts = isWeightPhrase ? null : extractExplicitPoints(task.title);
  const pointsMismatch = explicitPts !== null && typeof task.maxScore === 'number' && Math.abs(explicitPts - task.maxScore) > 0.5;

  const colMatch = (task.id || '').match(/^gbcol_.*(_\d+_\d+)$/);
  const srcCol = task.gradeSourceId ? task.gradeSourceId.replace(/^(?:gb:|col_)/, '') : '';
  const colMismatch = Boolean(colMatch && srcCol && srcCol !== colMatch[1]);

  if (pointsMismatch || colMismatch) {
    const copy: any = { ...task };
    delete copy.score;
    delete copy.maxScore;
    delete copy.scoreDisplay;
    delete copy.gradedAt;
    delete copy.markProvisional;
    if (colMatch) {
      copy.gradeSourceId = `gb:${colMatch[1]}`;
    } else {
      delete copy.gradeSourceId;
    }
    if (task.status === 'completed' || Boolean(colMatch)) {
      copy.submissionStatus = 'submitted';
    } else {
      delete copy.submissionStatus;
    }
    return copy as DeadlineTask;
  }

  return task;
}

/**
 * Sanitizes marks across a list of tasks, also clearing stolen cross-course `gradeSourceId` marks
 * where a gradebook column belongs to another course.
 */
export function sanitizeTaskListMarks(tasks: DeadlineTask[]): DeadlineTask[] {
  if (!Array.isArray(tasks) || tasks.length === 0) return tasks || [];
  const { cleaned: nonSynthetic } = purgeSyntheticGradebookTasks(tasks);
  const cleaned = nonSynthetic.map(sanitizeTaskMarks);

  // Determine true course ownership for each gradebook column id
  const colOwnerCourse = new Map<string, string>();
  for (const t of cleaned) {
    if (!t) continue;
    const m = (t.id || '').match(/^gbcol_.*(_\d+_\d+)$/);
    if (m) {
      const course = resolveCourseInfo(t).courseName.toLowerCase();
      if (course && course !== 'general course') {
        colOwnerCourse.set(m[1], course);
      }
    }
  }

  // Group graded tasks by source column id to detect cross-course collisions
  const byCol = new Map<string, DeadlineTask[]>();
  for (const t of cleaned) {
    if (!t || !t.gradeSourceId) continue;
    const colId = t.gradeSourceId.replace(/^(?:gb:|col_)/, '');
    if (!colId) continue;
    const list = byCol.get(colId) || [];
    list.push(t);
    byCol.set(colId, list);
  }

  for (const [colId, group] of byCol.entries()) {
    if (colOwnerCourse.has(colId)) continue;
    const courses = new Set(group.map(t => resolveCourseInfo(t).courseName.toLowerCase()));
    if (courses.size <= 1) continue;
    // Prefer the task with an explicit sequence number (e.g. "Quiz 1", "Assignment 2") over generic/unnumbered titles
    const numbered = group.find(t => extractAssessmentNumber(t.title) !== null);
    if (numbered) {
      colOwnerCourse.set(colId, resolveCourseInfo(numbered).courseName.toLowerCase());
    }
  }

  return cleaned.map(t => {
    if (!t || t.submissionStatus !== 'graded') return t;
    const myCourse = resolveCourseInfo(t).courseName.toLowerCase();

    // 1. Cross-course gradeSourceId collision
    if (t.gradeSourceId) {
      const colId = t.gradeSourceId.replace(/^(?:gb:|col_)/, '');
      const owner = colOwnerCourse.get(colId);
      if (owner && myCourse && owner !== myCourse) {
        const copy: any = { ...t };
        delete copy.score;
        delete copy.maxScore;
        delete copy.scoreDisplay;
        delete copy.gradedAt;
        delete copy.markProvisional;
        delete copy.gradeSourceId;
        if (t.status === 'completed') {
          copy.submissionStatus = 'submitted';
        } else {
          delete copy.submissionStatus;
        }
        return copy as DeadlineTask;
      }
    }

    // 2. If an official gbcol_ task in the same course for the same item is 'submitted' (not graded),
    // a duplicate announcement task for that item cannot be 'graded'.
    if (!(t.id || '').startsWith('gbcol_')) {
      const myCore = coreTitle(t.title);
      if (myCore.length >= 4) {
        const officialSubmitted = cleaned.find(other =>
          other &&
          (other.id || '').startsWith('gbcol_') &&
          other.submissionStatus === 'submitted' &&
          resolveCourseInfo(other).courseName.toLowerCase() === myCourse &&
          coreTitle(other.title) === myCore
        );
        if (officialSubmitted) {
          const copy: any = { ...t };
          delete copy.score;
          delete copy.maxScore;
          delete copy.scoreDisplay;
          delete copy.gradedAt;
          delete copy.markProvisional;
          delete copy.gradeSourceId;
          copy.submissionStatus = 'submitted';
          return copy as DeadlineTask;
        }
      }
    }

    return t;
  });
}

function taskTime(task: DeadlineTask): number {
  return new Date(task.updatedAt || task.createdAt || 0).getTime() || 0;
}

/** Union of two tombstone maps; for the same id the later deletion time wins. */
export function mergeTombstones(a: TombstoneMap = {}, b: TombstoneMap = {}): TombstoneMap {
  const out: TombstoneMap = { ...a };
  for (const [id, time] of Object.entries(b)) {
    const existing = out[id];
    if (!existing || new Date(time).getTime() > new Date(existing).getTime()) {
      out[id] = time;
    }
  }
  return out;
}

function isDeleted(task: DeadlineTask, tombstones: TombstoneMap): boolean {
  const tomb = tombstones[task.id];
  if (!tomb) return false;
  const tombTime = new Date(tomb).getTime();
  return !isNaN(tombTime) && tombTime >= taskTime(task);
}

// Optional fields: when the cloud copy is newer and omits one of these, the
// omission is deliberate (the user cleared it or a bogus mark was dropped) and must propagate.
const OPTIONAL_FIELDS = [
  'room', 'notes', 'weight', 'weightDisplay', 'syllabusNote',
  'submissionStatus', 'score', 'maxScore', 'scoreDisplay', 'gradedAt', 'gradeSourceId', 'markProvisional'
] as const;

// Fields that fill a gap on a locally-newer task without overriding local edits.
const GAP_FILL_FIELDS = [
  'courseName', 'courseCode', 'notes', 'room', 'description', 'sourceSnippet',
  'weight', 'weightDisplay', 'syllabusNote'
] as const;

function adoptCloud(local: DeadlineTask, cloud: DeadlineTask): DeadlineTask {
  const merged: any = {
    ...local,
    ...cloud,
    courseName: cloud.courseName || local.courseName,
    courseCode: cloud.courseCode !== undefined ? cloud.courseCode : local.courseCode,
    title: cloud.title || local.title,
    dueDate: cloud.dueDate || local.dueDate,
    type: cloud.type || local.type,
    priority: cloud.priority || local.priority,
    status: cloud.status || local.status,
    updatedAt: cloud.updatedAt || local.updatedAt
  };
  if (cloud.userEdited || local.userEdited) {
    merged.userEdited = true;
  }
  for (const field of OPTIONAL_FIELDS) {
    if ((cloud as any)[field] === undefined) delete merged[field];
  }
  return sanitizeTaskMarks(merged as DeadlineTask);
}

// Fields the student edits by hand: on a task they edited, an empty one was cleared on purpose
const STUDENT_FIELDS = new Set<string>(['notes', 'room', 'weight', 'weightDisplay']);

function fillGaps(local: DeadlineTask, cloud: DeadlineTask, sameTime: boolean): DeadlineTask {
  const merged: any = { ...local };
  if (local.userEdited || cloud.userEdited) {
    merged.userEdited = true;
  }
  // Only a strictly newer local edit keeps its cleared fields; an older cloud copy must not refill them
  const clearedOnPurpose = Boolean(local.userEdited) && !sameTime;
  for (const field of GAP_FILL_FIELDS) {
    if (clearedOnPurpose && STUDENT_FIELDS.has(field)) continue;
    const localVal = (local as any)[field];
    const cloudVal = (cloud as any)[field];
    const localEmpty = localVal === undefined || localVal === null || localVal === '';
    const cloudHas = cloudVal !== undefined && cloudVal !== null && cloudVal !== '';
    if (localEmpty && cloudHas) merged[field] = cloudVal;
  }
  if (sameTime && cloud.status && cloud.status !== local.status) {
    merged.status = cloud.status;
  }
  return sanitizeTaskMarks(merged as DeadlineTask);
}

/**
 * Safely compares tasks chronologically without producing NaN sort instability:
 * 1. Tasks with valid due dates sort earliest first.
 * 2. Tasks with empty or invalid due dates sort stably after dated tasks.
 * 3. Ties break by createdAt timestamp, then by task id.
 */
export function compareTasksChronologically(a: DeadlineTask, b: DeadlineTask): number {
  const timeA = a.dueDate ? new Date(a.dueDate).getTime() : NaN;
  const timeB = b.dueDate ? new Date(b.dueDate).getTime() : NaN;
  const validA = !isNaN(timeA);
  const validB = !isNaN(timeB);

  if (validA && validB) {
    if (timeA !== timeB) return timeA - timeB;
    return a.id.localeCompare(b.id);
  }
  if (validA) return -1;
  if (validB) return 1;

  const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (!isNaN(createdA) && !isNaN(createdB) && createdA !== createdB) {
    return createdA - createdB;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Merges the cloud task list into the local list.
 * - Newer `updatedAt` wins per task; a locally-newer task is never overridden.
 * - Tombstones delete matching tasks on either side unless the task was edited after the deletion.
 * - Cloud-only tasks are added unless tombstoned.
 */
export function mergeCloudTasks(
  localTasks: DeadlineTask[],
  cloudTasks: DeadlineTask[],
  tombstones: TombstoneMap = {}
): { tasks: DeadlineTask[]; changed: boolean } {
  const merged = new Map<string, DeadlineTask>();
  let changed = false;

  const cleanLocal = sanitizeTaskListMarks(localTasks || []);
  const cleanCloud = sanitizeTaskListMarks(cloudTasks || []);

  for (let i = 0; i < cleanLocal.length; i++) {
    const task = cleanLocal[i];
    if (JSON.stringify(task) !== JSON.stringify(localTasks[i])) {
      changed = true;
    }
    if (isDeleted(task, tombstones)) {
      changed = true;
      continue;
    }
    merged.set(task.id, task);
  }

  for (const cloud of cleanCloud) {
    if (isDeleted(cloud, tombstones)) continue;

    const local = merged.get(cloud.id);
    if (!local) {
      // A task this device's cleanup removed (junk, not tombstoned) must not come back from
      // a cloud copy written before the cleanup reached it.
      if (!isValidTask(cloud)) continue;
      merged.set(cloud.id, cloud);
      changed = true;
      continue;
    }

    const localTime = taskTime(local);
    const cloudTime = taskTime(cloud);
    const next = cloudTime > localTime ? adoptCloud(local, cloud) : fillGaps(local, cloud, cloudTime === localTime);
    if (JSON.stringify(next) !== JSON.stringify(local)) {
      merged.set(cloud.id, next);
      changed = true;
    }
  }

  const rawTasks = Array.from(merged.values());

  // Notes a scan wrote (not the student) must not come back from another device's copy
  const tasks = sanitizeTaskListMarks(rawTasks).map((t, idx) => {
    const clean = stripAutoNotes(t);
    if (clean !== t || JSON.stringify(clean) !== JSON.stringify(rawTasks[idx])) changed = true;
    // If a task has a released mark in the gradebook, it is automatically completed even with far-future deadline
    if (clean.submissionStatus === 'graded' && clean.status !== 'completed' && clean.status !== 'dismissed') {
      clean.status = 'completed';
      changed = true;
    }
    return clean;
  }).sort(
    compareTasksChronologically
  );
  return { tasks, changed };
}

/**
 * Normalizes assessment type category for grouping series:
 * 'hw', 'homework', 'assignment' -> 'assignment'
 * 'quiz', 'test' -> 'quiz'
 * 'exam', 'midterm', 'final' -> 'exam'
 * 'lab' -> 'lab'
 * 'project' -> 'project'
 */
export function normalizeAssessmentType(type?: string): string {
  const t = (type || 'assignment').toLowerCase().trim();
  if (t === 'hw' || t === 'homework' || t === 'assignment') return 'assignment';
  if (t === 'quiz' || t === 'test') return 'quiz';
  if (t === 'exam' || t === 'midterm' || t === 'final') return 'exam';
  if (t === 'lab') return 'lab';
  if (t === 'project') return 'project';
  return t;
}

/**
 * Returns series information (e.g. "1 of 2", "2 of 2") for an assessment task within its subject and type.
 * When multiple assessments of the same type exist for a subject (e.g. Quiz 1 and Quiz 2 in Physics 1),
 * returns { index: 1, total: 2, label: '1 of 2' }.
 * If only 1 assessment of that type exists, returns null.
 */
export function getTaskSeriesInfo(
  task: DeadlineTask,
  allTasks: DeadlineTask[]
): { index: number; total: number; label: string } | null {
  if (!task || !Array.isArray(allTasks)) return null;

  const targetCourse = resolveCourseInfo(task).courseName.toLowerCase();
  const targetType = normalizeAssessmentType(task.type);

  // Group all non-dismissed tasks belonging to the exact same course and assessment category
  const seriesPool = allTasks.filter(t => {
    if (!t || t.status === 'dismissed') return false;
    const c = resolveCourseInfo(t).courseName.toLowerCase();
    if (c !== targetCourse) return false;
    const ty = normalizeAssessmentType(t.type);
    return ty === targetType;
  });

  // Only number when there are 2 or more in the series
  if (seriesPool.length < 2) {
    return null;
  }

  // Sort series chronologically (earliest dueDate first)
  seriesPool.sort((a, b) => {
    const timeA = new Date(a.dueDate).getTime() || 0;
    const timeB = new Date(b.dueDate).getTime() || 0;
    if (timeA !== timeB) return timeA - timeB;
    const createdA = new Date(a.createdAt || 0).getTime() || 0;
    const createdB = new Date(b.createdAt || 0).getTime() || 0;
    if (createdA !== createdB) return createdA - createdB;
    return a.id.localeCompare(b.id);
  });

  const index = seriesPool.findIndex(t => t.id === task.id) + 1;
  if (index <= 0) return null;

  return {
    index,
    total: seriesPool.length,
    label: `${index} of ${seriesPool.length}`
  };
}

/**
 * Checks if two tasks represent the exact same real-world deadline.
 */
export function areTasksDuplicates(a: DeadlineTask, b: DeadlineTask): boolean {
  if (!a || !b) return false;
  if (a.id === b.id) return true;

  // Exact same grade source ID from gradebook column (e.g. col__1924969_1) when in the same course
  const courseA = resolveCourseInfo(a).courseName.toLowerCase();
  const courseB = resolveCourseInfo(b).courseName.toLowerCase();
  if (courseA !== courseB) return false;

  if (a.gradeSourceId && b.gradeSourceId && a.gradeSourceId === b.gradeSourceId) return true;

  // A practice run, mock exam, or sample paper never matches a real assessment
  if (isPracticeTitle(a.title) !== isPracticeTitle(b.title)) return false;

  const cleanA = (a.title || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
  const cleanB = (b.title || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');

  // One announcement can announce several deadlines, so a shared announcement only
  // means "same task" when the titles also match.
  if (a.announcementId && b.announcementId && a.announcementId === b.announcementId && cleanA === cleanB) return true;

  const typeA = normalizeAssessmentType(a.type);
  const typeB = normalizeAssessmentType(b.type);

  // Check assessment sequence numbers (e.g. Quiz 1 vs Quiz 2)
  const numA = extractAssessmentNumber(a.title);
  const numB = extractAssessmentNumber(b.title);

  // If both have explicit sequence numbers and they differ, they are NEVER duplicates
  if (numA !== null && numB !== null && numA !== numB) {
    return false;
  }

  const timeA = new Date(a.dueDate).getTime();
  const timeB = new Date(b.dueDate).getTime();
  const hasTimeA = !isNaN(timeA);
  const hasTimeB = !isNaN(timeB);
  const diffMs = (hasTimeA && hasTimeB) ? Math.abs(timeA - timeB) : Infinity;

  // Case 0: Same course, same assessment number for quizzes, labs, or same assessment type
  if (numA !== null && numB !== null && numA === numB) {
    const isQuizA = /quiz|كويز/i.test(a.title);
    const isQuizB = /quiz|كويز/i.test(b.title);
    if (isQuizA && isQuizB) return true;
    const isLabA = /lab|تقرير/i.test(a.title);
    const isLabB = /lab|تقرير/i.test(b.title);
    if (isLabA && isLabB) return true;
    if (typeA === typeB && !((isQuizA && isLabB) || (isLabA && isQuizB))) {
      return true;
    }
  }

  // Case 0b: Normalized coreTitle match within the same course (e.g. "3rd quiz" and "Quiz 3")
  const coreA = coreTitle(a.title);
  const coreB = coreTitle(b.title);
  if (coreA && coreB && coreA.length >= 4 && coreA === coreB) {
    return true;
  }

  const compatibleCoursework = (typeA === typeB) ||
    ((typeA === 'assignment' || typeA === 'project' || typeA === 'lab') &&
     (typeB === 'assignment' || typeB === 'project' || typeB === 'lab'));

  // Case 0c: Both are exams in the same course (e.g. "Midterm" and "EAP Midterm Exam", or "Final" and "Final Exam")
  if (isExamItem(a) && isExamItem(b)) {
    const isMidA = /(?:\bmidterm\b|نصفي)/i.test(a.title);
    const isMidB = /(?:\bmidterm\b|نصفي)/i.test(b.title);
    const isFinA = /(?:\bfinal\b|نهائي)/i.test(a.title);
    const isFinB = /(?:\bfinal\b|نهائي)/i.test(b.title);
    if ((isMidA && isMidB) || (isFinA && isFinB)) {
      if (!(numA !== null && numB !== null && numA !== numB)) {
        return true;
      }
    }
  }

  // Case 0d: Gradebook task matching an announcement task in the same course
  const isGbA = (a.id || '').startsWith('gbcol_') || a.sourceSnippet === 'gradebook';
  const isGbB = (b.id || '').startsWith('gbcol_') || b.sourceSnippet === 'gradebook';
  if ((isGbA || isGbB) && !(isGbA && isGbB)) {
    if (numA !== null && numB !== null && numA === numB && (typeA === typeB || compatibleCoursework)) return true;
    if (cleanA && cleanB && (cleanA === cleanB || cleanA.includes(cleanB) || cleanB.includes(cleanA))) return true;
    if (coreA && coreB && coreA.length >= 4 && (coreA === coreB || coreA.includes(coreB) || coreB.includes(coreA)) && (typeA === typeB || compatibleCoursework)) return true;
  }

  const isGenericA = /^(?:assignment|homework|hw|due|duedate|task|untitled)$/i.test(a.title.trim());
  const isGenericB = /^(?:assignment|homework|hw|due|duedate|task|untitled)$/i.test(b.title.trim());

  // Case 1: Same exact due date timestamp (within 5 minutes) for the same course
  if (diffMs <= 5 * 60 * 1000) {
    // If one is generic title (e.g. Blackboard stream "Assignment" vs "Measuring Density - Lab Report")
    if (isGenericA || isGenericB) return true;
    // Or if types match
    if (typeA === typeB) return true;
    // Or if titles match or contain each other
    if (cleanA && cleanB && (cleanA === cleanB || cleanA.includes(cleanB) || cleanB.includes(cleanA))) return true;
  }

  // Case 2: Same calendar day (YYYY-MM-DD) for the same course
  if (hasTimeA && hasTimeB) {
    const dateStrA = new Date(a.dueDate).toISOString().slice(0, 10);
    const dateStrB = new Date(b.dueDate).toISOString().slice(0, 10);

    if (dateStrA === dateStrB) {
      if (cleanA && cleanB && (cleanA === cleanB || cleanA.includes(cleanB) || cleanB.includes(cleanA))) {
        if (typeA === typeB || isGenericA || isGenericB || compatibleCoursework) return true;
      }
      if (coreA && coreB && coreA.length >= 4 && (coreA.includes(coreB) || coreB.includes(coreA)) && compatibleCoursework) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Merges two duplicate tasks into a single comprehensive task, preserving user edits,
 * the most specific title, and completed status.
 */
export function mergeDuplicatePair(rawExisting: DeadlineTask, rawIncoming: DeadlineTask): DeadlineTask {
  const existing = sanitizeTaskMarks(rawExisting);
  const incoming = sanitizeTaskMarks(rawIncoming);
  const isUserEdited = Boolean(existing.userEdited || incoming.userEdited);

  // Stable ID: prefer announcement task ID so real announcements stay in place, then gbcol
  let id = existing.id;
  if (existing.id.startsWith('ann_')) {
    id = existing.id;
  } else if (incoming.id.startsWith('ann_')) {
    id = incoming.id;
  } else if (incoming.id.startsWith('gbcol_') && !existing.id.startsWith('gbcol_')) {
    id = incoming.id;
  } else if (existing.id.startsWith('stream_UOS_Assignment_') && !incoming.id.startsWith('stream_UOS_Assignment_')) {
    id = incoming.id;
  }

  // Title: student edits win (Rule 3); otherwise prefer official gbcol title over extension-announcement wrapper or longer informative title
  let title = existing.title;
  const isExtensionWrapper = (s: string) => /^(?:تمديد\s*(?:فترة|موعد)?|موعد\s*تسليم|إعلان\s*:)/i.test((s || '').trim());
  if (existing.userEdited && !incoming.userEdited) {
    title = existing.title;
  } else if (incoming.userEdited && !existing.userEdited) {
    title = incoming.title;
  } else if (incoming.id.startsWith('gbcol_') && !existing.id.startsWith('gbcol_') && isExtensionWrapper(existing.title)) {
    title = incoming.title;
  } else if (existing.id.startsWith('gbcol_') && !incoming.id.startsWith('gbcol_') && isExtensionWrapper(incoming.title)) {
    title = existing.title;
  } else {
    const isExistingGeneric = /^(?:assignment|homework|hw|due|duedate|task|untitled)$/i.test(existing.title.trim());
    const isIncomingGeneric = /^(?:assignment|homework|hw|due|duedate|task|untitled)$/i.test(incoming.title.trim());
    if (isExistingGeneric && !isIncomingGeneric) {
      title = incoming.title;
    } else if (!isExistingGeneric && isIncomingGeneric) {
      title = existing.title;
    } else {
      title = existing.title.length >= incoming.title.length ? existing.title : incoming.title;
    }
  }

  // Due date: student edits win (Rule 3); otherwise prefer real announcement/schedule date over scan-time gbcol date
  let dueDate = existing.dueDate;
  let hasSpecificTime = existing.hasSpecificTime;
  if (existing.userEdited && !incoming.userEdited) {
    dueDate = existing.dueDate;
    hasSpecificTime = existing.hasSpecificTime;
  } else if (incoming.userEdited && !existing.userEdited) {
    dueDate = incoming.dueDate;
    hasSpecificTime = incoming.hasSpecificTime;
  } else {
    const isScanDate = (d?: string) => Boolean(d && d.startsWith('2026-10-28'));
    const existReal = Boolean(existing.dueDate && !isScanDate(existing.dueDate));
    const inReal = Boolean(incoming.dueDate && !isScanDate(incoming.dueDate));
    if (existReal && !inReal) {
      dueDate = existing.dueDate;
      hasSpecificTime = existing.hasSpecificTime;
    } else if (inReal && !existReal) {
      dueDate = incoming.dueDate;
      hasSpecificTime = incoming.hasSpecificTime;
    } else if (incoming.hasSpecificTime && !existing.hasSpecificTime) {
      dueDate = incoming.dueDate;
      hasSpecificTime = true;
    }
  }

  // Type: prefer specific type over generic assignment
  const type = (existing.type && existing.type !== 'assignment' ? existing.type : incoming.type) || existing.type;

  // Room & weight: prefer weight matching the resolved specific type (e.g. project 15% over assignment 10%)
  const room = existing.room || incoming.room;
  const preferIncomingWeight = incoming.type === type && existing.type !== type && incoming.weight !== undefined;
  const weight = preferIncomingWeight
    ? incoming.weight
    : (existing.weight !== undefined ? existing.weight : incoming.weight);
  const weightDisplay = preferIncomingWeight
    ? (incoming.weightDisplay || existing.weightDisplay)
    : (existing.weightDisplay || incoming.weightDisplay);
  const syllabusNote = preferIncomingWeight
    ? (incoming.syllabusNote || existing.syllabusNote)
    : (existing.syllabusNote || incoming.syllabusNote);

  const isMarkValidForMerged = (t: DeadlineTask): boolean => {
    if (t.submissionStatus !== 'graded' || typeof t.score !== 'number') return false;
    const isWeightPhrase = /(?:worth\s*\d|\bweight\b|%|بنسبة|وزن)/i.test(title);
    const explicitPts = isWeightPhrase ? null : extractExplicitPoints(title);
    if (explicitPts !== null && typeof t.maxScore === 'number' && Math.abs(explicitPts - t.maxScore) > 0.5) {
      return false;
    }
    return true;
  };

  const existingGradedValid = isMarkValidForMerged(existing);
  const incomingGradedValid = isMarkValidForMerged(incoming);

  let submissionStatus: DeadlineTask['submissionStatus'];
  if (existingGradedValid || incomingGradedValid) {
    submissionStatus = 'graded';
  } else if (existing.submissionStatus === 'submitted' || incoming.submissionStatus === 'submitted') {
    submissionStatus = 'submitted';
  } else {
    submissionStatus = undefined;
  }

  const status = (existing.status === 'completed' || incoming.status === 'completed' ||
                  submissionStatus === 'graded' || submissionStatus === 'submitted')
    ? 'completed'
    : (existing.status === 'dismissed' ? 'dismissed' : incoming.status);

  // Description / sourceSnippet: pick longer
  const desc = (existing.description || '').length >= (incoming.description || '').length
    ? existing.description
    : incoming.description;
  const snippet = (existing.sourceSnippet || '').length >= (incoming.sourceSnippet || '').length
    ? existing.sourceSnippet
    : incoming.sourceSnippet;

  // Notes: only the student's own (see stripAutoNotes)
  const notes = stripAutoNotes(existing).notes || stripAutoNotes(incoming).notes || '';

  // Marks & grade sources: only keep score fields when submissionStatus === 'graded'
  const gradedSource = existingGradedValid ? existing : (incomingGradedValid ? incoming : null);
  const score = submissionStatus === 'graded' && gradedSource ? gradedSource.score : undefined;
  const maxScore = submissionStatus === 'graded' && gradedSource ? gradedSource.maxScore : undefined;
  const scoreDisplay = submissionStatus === 'graded' && gradedSource ? gradedSource.scoreDisplay : undefined;
  const gradedAt = submissionStatus === 'graded' && gradedSource ? gradedSource.gradedAt : undefined;
  const markProvisional = submissionStatus === 'graded' && gradedSource ? gradedSource.markProvisional : undefined;
  const gradeSourceId = gradedSource?.gradeSourceId || existing.gradeSourceId || incoming.gradeSourceId;
  const gradeSourcesBefore = Array.from(new Set([
    ...(existing.gradeSourcesBefore || []),
    ...(incoming.gradeSourcesBefore || [])
  ]));
  const submissionReceipt = existing.submissionReceipt || incoming.submissionReceipt;
  const submittedAt = existing.submittedAt || incoming.submittedAt;

  const merged: any = {
    ...existing,
    ...incoming,
    id,
    title,
    dueDate,
    hasSpecificTime,
    type,
    status,
    description: desc,
    sourceSnippet: snippet,
    notes,
    room,
    weight,
    weightDisplay,
    syllabusNote,
    userEdited: isUserEdited,
    updatedAt: new Date(Math.max(
      new Date(existing.updatedAt || existing.createdAt || 0).getTime(),
      new Date(incoming.updatedAt || incoming.createdAt || 0).getTime(),
      Date.now()
    )).toISOString()
  };

  delete merged.submissionStatus;
  delete merged.score;
  delete merged.maxScore;
  delete merged.scoreDisplay;
  delete merged.gradedAt;
  delete merged.gradeSourceId;
  delete merged.markProvisional;
  delete merged.gradeSourcesBefore;
  delete merged.submissionReceipt;
  delete merged.submittedAt;

  if (submissionStatus) merged.submissionStatus = submissionStatus;
  if (score !== undefined) merged.score = score;
  if (maxScore !== undefined) merged.maxScore = maxScore;
  if (scoreDisplay) merged.scoreDisplay = scoreDisplay;
  if (gradedAt) merged.gradedAt = gradedAt;
  if (gradeSourceId) merged.gradeSourceId = gradeSourceId;
  if (markProvisional !== undefined) merged.markProvisional = markProvisional;
  if (gradeSourcesBefore.length) merged.gradeSourcesBefore = gradeSourcesBefore;
  if (submissionReceipt) merged.submissionReceipt = submissionReceipt;
  if (submittedAt) merged.submittedAt = submittedAt;

  return sanitizeTaskMarks(merged as DeadlineTask);
}

const normText = (t: DeadlineTask) => (t.sourceSnippet || t.description || '').replace(/\s+/g, ' ').trim().toLowerCase();
const normTitle = (t: DeadlineTask) => (t.title || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');

/**
 * Older stream scans could pair a card with another course's announcement text, filing
 * e.g. Computer Eng's "Quiz 3" under Physics Lab on the wrong day. When a task has the same
 * title and the same full announcement text as one read from Blackboard's announcement list
 * (`ann_api_`), but a different course, the list copy is right and the other copy is dropped.
 * Tasks the student made or edited are never dropped: they may have fixed the course and date.
 */
function dropMisfiledCopies(tasks: DeadlineTask[]): DeadlineTask[] {
  const fromApi = tasks.filter(t => t && (t.announcementId || '').startsWith('ann_api_') && normText(t).length >= 80);
  if (fromApi.length === 0) return tasks;
  return tasks.filter(t => {
    if (!t || t.extractedBy === 'manual' || t.userEdited || (t.announcementId || '').startsWith('ann_api_')) return true;
    const text = normText(t);
    if (text.length < 80) return true;
    const course = resolveCourseInfo(t).courseName.toLowerCase();
    return !fromApi.some(a =>
      normText(a) === text &&
      normTitle(a) === normTitle(t) &&
      resolveCourseInfo(a).courseName.toLowerCase() !== course
    );
  });
}

/**
 * Deduplicates a list of tasks, merging duplicates and preserving chronological order.
 */
export function deduplicateTaskList(tasks: DeadlineTask[]): DeadlineTask[] {
  if (!tasks || tasks.length === 0) return tasks || [];
  const sanitized = sanitizeTaskListMarks(tasks);
  if (sanitized.length <= 1) return sanitized;

  const result: DeadlineTask[] = [];

  for (const incoming of dropMisfiledCopies(sanitized)) {
    if (!incoming || !incoming.title) continue;

    const existingIndex = result.findIndex(existing => areTasksDuplicates(existing, incoming));
    if (existingIndex === -1) {
      result.push({ ...incoming });
    } else {
      result[existingIndex] = mergeDuplicatePair(result[existingIndex], incoming);
    }
  }

  return sanitizeTaskListMarks(result).sort(compareTasksChronologically);
}
