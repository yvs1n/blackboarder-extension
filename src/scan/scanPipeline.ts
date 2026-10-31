import { Announcement, DeadlineTask, TaskSubmissionUpdate, TaskType } from '../types';
import { processAnnouncementsBatch, titleCourseKeyFor } from '../engine/hybridExtractor';
import {
  getSettings,
  getTasks,
  saveTasksMergingLatest,
  saveAnnouncements,
  saveLastScanCheckpoint,
  autoRegisterDiscoveredCourses,
  setScanStatus,
  ScanCheckpoint
} from '../utils/storage';
import { isValidTask } from '../core/courseHelper';
import { deduplicateTaskList } from '../utils/taskMerge';
import { applySubmissionUpdates, purgeSyntheticGradebookTasks } from '../utils/gradebook';
import { repairTaskWeightsAndRooms } from '../utils/taskRepair';
import { mergeStreamAndCourseAnnouncements } from '../utils/announcementMerge';
import { getStorageTombstones, setStorageTombstones } from '../utils/tombstones';
import type { ScanSourceOutcomes } from './blackboardApi';
import { describePartialFailures } from './scanFallback';

/**
 * The part of a scan both scanners share: once the announcements, stream items and marks are
 * collected (over HTTP from the service worker, or from the page and HTTP in a Blackboard tab),
 * this extracts deadlines, puts marks on tasks, saves everything and writes the scan checkpoint.
 */

/** The checkpoint a full re-scan starts from: nothing seen yet. */
export function emptyCheckpoint(): ScanCheckpoint {
  return { lastScannedAt: '', processedAnnouncementIds: [], processedDirectTaskIds: [], processedAnnouncementKeys: [] };
}

export interface ScanPipelineInput {
  /** Announcements from the stream; ones the checkpoint already holds are skipped. */
  streamAnnouncements: Announcement[];
  /** Full course announcements (in a tab, already merged with the page's cards and open drawer). */
  courseAnnouncements: Announcement[];
  /** Due-date items from the stream API and, in a tab, the page. */
  directTasks: DeadlineTask[];
  /** Submissions and marks: stream cards and stream API first, the gradebook last (it has every mark, so it wins). */
  submissionUpdates: TaskSubmissionUpdate[];
  /** Courses found on the page, registered with the courses found in tasks. */
  discoveredCourses?: { courseName: string; courseCode?: string }[];
  gradebook: { expired?: boolean; courses: number; coursesRead: number; skipped: string[] };
  /** What the HTTP read managed, for the partial note at the end of the message. */
  sources?: ScanSourceOutcomes;
  checkpoint: ScanCheckpoint;
  fullRescan: boolean;
  /** Read each time progress is written, since a quiet scan can become visible while it runs. */
  isInteractive: () => boolean;
}

export interface ScanPipelineResult {
  ok: true;
  newCount: number;
  marksChanged: number;
  message: string;
  sources?: ScanSourceOutcomes;
  pendingCount: number;
}

function markTaskType(title: string): TaskType {
  const lowTitle = (title || '').toLowerCase();
  if (/quiz|كويز|اختبار\s*قصير/i.test(lowTitle)) return 'quiz';
  if (/\b(?:exam|mid[\s_-]*term|final)\b|امتحان|اختبار\s*(?:نصفي|نهائي|فصلي)/i.test(lowTitle)) return 'exam';
  if (/project|مشروع|بحث/i.test(lowTitle)) return 'project';
  if (/lab|تقرير/i.test(lowTitle)) return 'lab';
  return 'assignment';
}

export async function runScanPipeline(input: ScanPipelineInput): Promise<ScanPipelineResult> {
  const { fullRescan, checkpoint } = input;
  const knownDirectIds = new Set(checkpoint.processedDirectTaskIds);
  const knownAnnIds = new Set(checkpoint.processedAnnouncementIds);

  // Stream task ids are deterministic, so a card the student deleted would come back on a full
  // re-scan unless the deletion record is honoured here
  const tombstones = await getStorageTombstones();
  const directStreamTasks = input.directTasks
    .filter(t => (fullRescan || !knownDirectIds.has(t.id)) && !tombstones[t.id]);
  const announcements = mergeStreamAndCourseAnnouncements(
    input.streamAnnouncements.filter(a => fullRescan || !knownAnnIds.has(a.id)),
    input.courseAnnouncements,
    null
  );
  const submissionUpdates = input.submissionUpdates;

  const settings = await getSettings();
  let existingTasks = await getTasks();
  const { cleaned: cleanedExisting, purgedIds: purgedSyntheticIds } = purgeSyntheticGradebookTasks(existingTasks);
  if (purgedSyntheticIds.length > 0) {
    existingTasks = cleanedExisting;
    purgedSyntheticIds.forEach(id => {
      tombstones[id] = new Date().toISOString();
    });
    await setStorageTombstones(tombstones);
  }

  // Save announcements to storage (merges with existing)
  if (announcements.length > 0) {
    await saveAnnouncements(announcements);
  }

  // Progress is written at most every 400 ms so storage is not flooded
  let lastProgressWrite = 0;
  const reportProgress = (done: number, total: number) => {
    if (!input.isInteractive()) return;
    const now = Date.now();
    if (done !== 0 && done !== total && now - lastProgressWrite < 400) return;
    lastProgressWrite = now;
    void setScanStatus({
      state: 'running',
      message: `Read ${announcements.length} announcements & ${directStreamTasks.length} stream items. Extracting ${done}/${total}...`,
      done,
      total
    });
  };

  // Process announcements for deadlines (skips already processed IDs)
  const { newTasks: extractedTasks, allTasks: mergedAnnTasks } = await processAnnouncementsBatch(
    announcements,
    existingTasks,
    settings,
    fullRescan ? undefined : knownAnnIds,
    reportProgress
  );

  // Merge direct stream tasks with deduplication against existing stored tasks
  const existingIdMap = new Map<string, DeadlineTask>();
  const existingTitleCourseMap = new Map<string, DeadlineTask>();
  const existingDateKeySet = new Set<string>();

  for (const t of mergedAnnTasks) {
    existingIdMap.set(t.id, t);
    const tcKey = titleCourseKeyFor(t);
    if (tcKey) existingTitleCourseMap.set(tcKey, t);
    try {
      existingDateKeySet.add(`${t.courseCode}_${t.title}_${new Date(t.dueDate).toISOString().slice(0, 10)}`);
    } catch {}
  }

  const newlyAddedDirect: DeadlineTask[] = [];
  for (const dt of directStreamTasks) {
    // '' when the course is unknown, so "Quiz 3" from two courses is never merged
    const titleCourseKey = titleCourseKeyFor(dt);
    let dateKey = '';
    try {
      dateKey = `${dt.courseCode}_${dt.title}_${new Date(dt.dueDate).toISOString().slice(0, 10)}`;
    } catch {}

    const matched = existingIdMap.get(dt.id)
      || (titleCourseKey ? existingTitleCourseMap.get(titleCourseKey) : undefined)
      || (dateKey && existingDateKeySet.has(dateKey) ? true : undefined);

    if (matched && typeof matched === 'object') {
      // Matched an existing task! If user edited it, never overwrite user changes.
      if (!matched.userEdited && matched.extractedBy !== 'manual') {
        if (!matched.hasSpecificTime && dt.hasSpecificTime) {
          matched.dueDate = dt.dueDate;
          matched.hasSpecificTime = dt.hasSpecificTime;
          matched.updatedAt = new Date().toISOString();
        }
      }
    } else if (!matched) {
      newlyAddedDirect.push(dt);
      existingIdMap.set(dt.id, dt);
      if (titleCourseKey) existingTitleCourseMap.set(titleCourseKey, dt);
      if (dateKey) existingDateKeySet.add(dateKey);
    }
  }

  let finalTasks = deduplicateTaskList([...newlyAddedDirect, ...mergedAnnTasks]).filter(isValidTask);

  // Put marks and submissions on their tasks (only changed tasks are touched)
  const marksChanged = applySubmissionUpdates(finalTasks, submissionUpdates);

  // Which gradebook marks found no deadline (shown in the scan message and the console)
  const gradebookMarks = submissionUpdates.filter(u => u.sourceId && u.submissionStatus === 'graded');
  const unmatchedMarks = gradebookMarks.filter(u =>
    !finalTasks.some(t => t.gradeSourceId === u.sourceId || (t.gradeSourcesBefore || []).includes(u.sourceId!))
  );

  // Preserve unannounced gradebook marks in the Grades card without creating fake calendar deadlines:
  // If a gradebook mark had no matching announcement task, add a completed task with an empty due
  // date so it appears in the Grades card & GPA without cluttering the calendar.
  const scanTimestamp = new Date().toISOString();
  for (const u of unmatchedMarks) {
    if (typeof u.score !== 'number' || !u.maxScore) continue;
    const courseKey = (u.courseCode || u.courseName || 'other').replace(/[^A-Za-z0-9_]/g, '');
    const colId = (u.sourceId || '').replace(/^gb:/, '');
    const type = markTaskType(u.title);
    finalTasks.push({
      id: `gbcol_${courseKey}_${colId || u.title.replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}`,
      courseCode: u.courseCode || '',
      courseName: u.courseName || u.courseCode || 'Other',
      title: u.title || 'Graded Item',
      description: '',
      dueDate: '',
      hasSpecificTime: false,
      type,
      priority: type === 'exam' || type === 'quiz' ? 'high' : 'medium',
      status: 'completed',
      submissionStatus: 'graded',
      score: u.score,
      maxScore: u.maxScore,
      scoreDisplay: u.scoreDisplay,
      gradeSourceId: u.sourceId,
      gradedAt: u.gradedAt,
      sourceSnippet: 'gradebook',
      confidence: 1.0,
      extractedBy: 'local',
      createdAt: scanTimestamp,
      updatedAt: scanTimestamp
    });
  }

  // Deduplicate again after injecting unmatched gradebook items to prevent duplicates side-by-side
  finalTasks = deduplicateTaskList(finalTasks).filter(t =>
    isValidTask(t) &&
    !/orientation|توجيه|تهيئة/i.test(t.courseName || '') &&
    !/orientation/i.test(t.courseCode || '') &&
    !/orientation|توجيه|تهيئة/i.test(t.title || '')
  );

  const gb = input.gradebook;
  console.info(
    `[Blackboarder] Gradebook: ${gb.coursesRead > 0 ? `${gb.coursesRead}/${gb.courses} courses read, ${gradebookMarks.length} marks` : 'not readable (signed out?)'}` +
    (unmatchedMarks.length ? `; no matching deadline for: ${unmatchedMarks.map(u => `${u.courseName || '?'}: ${u.title}`).join(' | ')}` : '') +
    (gb.skipped.length ? `; not read: ${gb.skipped.join(' | ')}` : '')
  );
  const gradebookNote = gb.expired
    ? ' Your Blackboard session has ended: sign in again, then scan.'
    : gb.coursesRead === 0
      ? ' Marks: gradebook not readable.'
      : ` Marks: ${gradebookMarks.length - unmatchedMarks.length} of ${gradebookMarks.length} matched${
        unmatchedMarks.length ? ` (no deadline for ${unmatchedMarks.slice(0, 4).map(u => u.title).join(', ')}${unmatchedMarks.length > 4 ? ', ...' : ''})` : ''}.${
        gb.skipped.length ? ` Not read: ${gb.skipped.slice(0, 3).join(', ')}.` : ''}`;

  // Correct weights and rooms saved by older rules (tasks the student edited are left alone)
  repairTaskWeightsAndRooms(finalTasks);

  // Auto-register any new courses found in scanned tasks or discovered courses
  await autoRegisterDiscoveredCourses([...finalTasks, ...(input.discoveredCourses || [])]).catch(() => {});

  // Merge with what is stored now: the popup or a phone edit may have saved while this scan ran
  await saveTasksMergingLatest(finalTasks);

  // Update scan checkpoint with newly processed IDs
  await saveLastScanCheckpoint({
    lastScannedAt: new Date().toISOString(),
    processedAnnouncementIds: announcements.map(a => a.id),
    processedDirectTaskIds: directStreamTasks.map(d => d.id),
    processedAnnouncementKeys: announcements.flatMap(a => [
      a.title.toLowerCase().trim(),
      `${a.courseCode}_${a.title.toLowerCase().trim()}`
    ])
  });

  const totalNewCount = newlyAddedDirect.length + extractedTasks.length;
  const message = (totalNewCount > 0
    ? `Added ${totalNewCount} new deadline${totalNewCount > 1 ? 's' : ''} to calendar!`
    : (marksChanged > 0
      ? `Up to date. Added or updated ${marksChanged} mark${marksChanged > 1 ? 's' : ''}.`
      : `Up to date. Read ${announcements.length + directStreamTasks.length} items with no new deadlines.`))
    + gradebookNote + describePartialFailures(input.sources);

  return {
    ok: true,
    newCount: totalNewCount,
    marksChanged,
    message,
    sources: input.sources,
    pendingCount: finalTasks.filter(t => t.status === 'pending').length
  };
}
