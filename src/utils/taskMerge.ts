import { DeadlineTask } from '../types';
import { resolveCourseInfo, isValidTask } from '../core/courseHelper';

export type TombstoneMap = Record<string, string>;

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
// omission is deliberate (the user cleared it) and must propagate.
const OPTIONAL_FIELDS = ['room', 'notes', 'weight', 'weightDisplay', 'syllabusNote'] as const;

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
    if ((cloud as any)[field] === undefined) merged[field] = undefined;
  }
  return merged as DeadlineTask;
}

function fillGaps(local: DeadlineTask, cloud: DeadlineTask, sameTime: boolean): DeadlineTask {
  const merged: any = { ...local };
  if (local.userEdited || cloud.userEdited) {
    merged.userEdited = true;
  }
  for (const field of GAP_FILL_FIELDS) {
    const localVal = (local as any)[field];
    const cloudVal = (cloud as any)[field];
    const localEmpty = localVal === undefined || localVal === null || localVal === '';
    const cloudHas = cloudVal !== undefined && cloudVal !== null && cloudVal !== '';
    if (localEmpty && cloudHas) merged[field] = cloudVal;
  }
  if (sameTime && cloud.status && cloud.status !== local.status) {
    merged.status = cloud.status;
  }
  return merged as DeadlineTask;
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

  for (const task of localTasks) {
    if (isDeleted(task, tombstones)) {
      changed = true;
      continue;
    }
    merged.set(task.id, task);
  }

  for (const cloud of cloudTasks) {
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
  const deduped = deduplicateTaskList(rawTasks);
  if (deduped.length !== rawTasks.length) {
    changed = true;
  }

  const tasks = deduped.sort(
    (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
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
  const cleanA = (a.title || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
  const cleanB = (b.title || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');

  // One announcement can announce several deadlines, so a shared announcement only
  // means "same task" when the titles also match.
  if (a.announcementId && b.announcementId && a.announcementId === b.announcementId && cleanA === cleanB) return true;

  const courseA = resolveCourseInfo(a).courseName.toLowerCase();
  const courseB = resolveCourseInfo(b).courseName.toLowerCase();
  if (courseA !== courseB) return false;

  const timeA = new Date(a.dueDate).getTime();
  const timeB = new Date(b.dueDate).getTime();
  if (isNaN(timeA) || isNaN(timeB)) return false;

  const diffMs = Math.abs(timeA - timeB);
  const typeA = normalizeAssessmentType(a.type);
  const typeB = normalizeAssessmentType(b.type);

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
  const dateStrA = new Date(a.dueDate).toISOString().slice(0, 10);
  const dateStrB = new Date(b.dueDate).toISOString().slice(0, 10);

  if (dateStrA === dateStrB) {
    if (cleanA && cleanB && (cleanA === cleanB || cleanA.includes(cleanB) || cleanB.includes(cleanA))) {
      if (typeA === typeB || isGenericA || isGenericB) return true;
    }
  }

  return false;
}

/**
 * Merges two duplicate tasks into a single comprehensive task, preserving user edits,
 * the most specific title, and completed status.
 */
export function mergeDuplicatePair(existing: DeadlineTask, incoming: DeadlineTask): DeadlineTask {
  const isUserEdited = Boolean(existing.userEdited || incoming.userEdited);

  // Prefer specific title over generic ('Assignment', 'Untitled', etc.)
  const isExistingGeneric = /^(?:assignment|homework|hw|due|duedate|task|untitled)$/i.test(existing.title.trim());
  const isIncomingGeneric = /^(?:assignment|homework|hw|due|duedate|task|untitled)$/i.test(incoming.title.trim());
  let title = existing.title;
  if (isExistingGeneric && !isIncomingGeneric) {
    title = incoming.title;
  } else if (!isExistingGeneric && !isIncomingGeneric) {
    title = existing.title.length >= incoming.title.length ? existing.title : incoming.title;
  }

  // Prefer specific time over class time
  let dueDate = existing.dueDate;
  let hasSpecificTime = existing.hasSpecificTime;
  if (!existing.hasSpecificTime && incoming.hasSpecificTime) {
    dueDate = incoming.dueDate;
    hasSpecificTime = true;
  }

  // Status: if either is completed, it stays completed!
  const status = (existing.status === 'completed' || incoming.status === 'completed')
    ? 'completed'
    : (existing.status === 'dismissed' ? 'dismissed' : incoming.status);

  // Description / sourceSnippet: pick longer
  const desc = (existing.description || '').length >= (incoming.description || '').length
    ? existing.description
    : incoming.description;
  const snippet = (existing.sourceSnippet || '').length >= (incoming.sourceSnippet || '').length
    ? existing.sourceSnippet
    : incoming.sourceSnippet;

  // Notes: combine or keep non-empty
  const notes = existing.notes || incoming.notes || '';

  // Room & weight: keep whichever has value
  const room = existing.room || incoming.room;
  const weight = existing.weight !== undefined ? existing.weight : incoming.weight;
  const weightDisplay = existing.weightDisplay || incoming.weightDisplay;
  const syllabusNote = existing.syllabusNote || incoming.syllabusNote;

  // Stable ID: prefer non-generic stream ID or existing ID
  let id = existing.id;
  if (existing.id.startsWith('stream_UOS_Assignment_') && !incoming.id.startsWith('stream_UOS_Assignment_')) {
    id = incoming.id;
  }

  return {
    ...existing,
    ...incoming,
    id,
    title,
    dueDate,
    hasSpecificTime,
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
  if (!tasks || tasks.length <= 1) return tasks || [];

  const result: DeadlineTask[] = [];

  for (const incoming of dropMisfiledCopies(tasks)) {
    if (!incoming || !incoming.title) continue;

    const existingIndex = result.findIndex(existing => areTasksDuplicates(existing, incoming));
    if (existingIndex === -1) {
      result.push({ ...incoming });
    } else {
      result[existingIndex] = mergeDuplicatePair(result[existingIndex], incoming);
    }
  }

  return result.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
}
