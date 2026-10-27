import { DeadlineTask, TaskSubmissionUpdate } from '../types';
import { findTaskForUpdate } from './streamParser';

/** One gradebook column as Ultra's /learn/api/v1/courses/{id}/gradebook/columns returns it. */
export interface GradebookColumn {
  id: string;
  columnName?: string;
  effectiveColumnName?: string;
  possible?: number;
  calculationType?: string;
  scoreProviderHandle?: string;
  visible?: boolean;
  gradesReleased?: boolean;
}

/** One of the student's grades from /learn/api/v1/courses/{id}/gradebook/grades?userId=... */
export interface GradebookGrade {
  columnId: string;
  status?: string;
  pointsPossible?: number;
  effectiveScore?: number;
  displayGrade?: { score?: number; text?: string } | null;
  isExempt?: boolean;
  gradedDate?: string;
  lastGradedDate?: string;
  modifiedDate?: string;
  lastModified?: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Gradebook names come HTML-escaped ("3 &amp; 4"); task titles do not. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Turns a course's gradebook into mark updates for its deadlines. Totals, attendance and
 * hidden or unreleased columns are skipped; work waiting to be marked counts as submitted.
 */
export function gradebookToUpdates(
  columns: GradebookColumn[],
  grades: GradebookGrade[],
  course: { courseName?: string; courseCode?: string },
  /** Receives "Title (reason)" for each column that holds a grade but was not read, so a scan can say why. */
  skipped?: string[]
): TaskSubmissionUpdate[] {
  const byId = new Map(columns.map(c => [c.id, c]));
  const updates: TaskSubmissionUpdate[] = [];

  for (const g of grades) {
    const col = byId.get(g.columnId);
    const hasGrade = g.status === 'GRADED' || typeof g.displayGrade?.score === 'number' || typeof g.effectiveScore === 'number';
    const title = decodeEntities(col?.effectiveColumnName || col?.columnName || '').trim();
    const skip = (reason: string) => { if (hasGrade && title && skipped) skipped.push(`${title} (${reason})`); };
    if (!col) continue;
    if (col.visible === false) { skip('hidden in the gradebook'); continue; }
    if (col.gradesReleased === false) { skip('grades not released yet'); continue; }
    if (col.calculationType && col.calculationType !== 'NON_CALCULATED') { skip('a calculated column'); continue; }
    if ((col.scoreProviderHandle || '').includes('attendance')) continue;
    if (g.isExempt) { skip('exempt'); continue; }
    if (!title) continue;

    const gradedAt = g.gradedDate || g.lastGradedDate || g.modifiedDate || g.lastModified;
    const base = {
      courseName: course.courseName || undefined,
      courseCode: course.courseCode && course.courseCode !== 'UOS' ? course.courseCode : undefined,
      title,
      sourceId: `gb:${col.id}`,
      gradedAt: gradedAt && !isNaN(new Date(gradedAt).getTime()) ? gradedAt : undefined
    };

    const raw = typeof g.displayGrade?.score === 'number' ? g.displayGrade.score : g.effectiveScore;
    if (g.status === 'GRADED' && typeof raw === 'number' && !isNaN(raw)) {
      const score = round(raw);
      const max = g.pointsPossible || col.possible;
      const maxScore = typeof max === 'number' && max > 0 ? round(max) : undefined;
      updates.push({
        ...base,
        submissionStatus: 'graded',
        score,
        maxScore,
        scoreDisplay: maxScore ? `${score} / ${maxScore} (${Math.round((score / maxScore) * 100)}%)` : `${score} pts`
      });
    } else if (g.status === 'NEEDS_GRADING') {
      updates.push({ ...base, submissionStatus: 'submitted' });
    } else if (g.status === 'GRADED') {
      skip('graded without a number');
    }
  }
  return updates;
}

/**
 * Puts marks and submissions on their tasks. A task is only touched (and its updatedAt
 * bumped, which triggers a sync) when something actually changed. Returns how many marks
 * were added or changed.
 */
/** A mark cannot exist before its item happens; allow a day for time zones and early marking. */
const MARK_SLACK_MS = 24 * 60 * 60 * 1000;

function dueTime(t: DeadlineTask): number {
  return new Date(t.dueDate).getTime();
}

/**
 * Removes marks from tasks that have not happened yet: such a mark came from another item
 * (a practice midterm's mark on the real midterm). Returns how many tasks were cleared.
 */
export function dropImpossibleMarks(tasks: DeadlineTask[], nowMs: number = Date.now()): number {
  let cleared = 0;
  for (const t of tasks) {
    if (t.submissionStatus !== 'graded') continue;
    const due = dueTime(t);
    if (isNaN(due) || due <= nowMs + MARK_SLACK_MS) continue;
    if (t.gradeSourceId) {
      t.gradeSourcesBefore = Array.from(new Set([...(t.gradeSourcesBefore || []), t.gradeSourceId]));
    }
    delete t.score;
    delete t.maxScore;
    delete t.scoreDisplay;
    delete t.gradeSourceId;
    delete t.submissionStatus;
    t.status = 'pending';
    t.updatedAt = new Date(nowMs).toISOString();
    cleared++;
  }
  return cleared;
}

/**
 * True when the update was graded before the task's date, so it is a practice run. A column once
 * refused for that reason is tried again when Blackboard dates its grade and the task's date has
 * since been corrected; a column with no grade date stays refused.
 */
/** A dated column graded after the one the task has its mark from replaces it (an undated practice column came first). */
function gradedLater(t: DeadlineTask, update: import('../types').TaskSubmissionUpdate): boolean {
  const next = update.gradedAt ? new Date(update.gradedAt).getTime() : NaN;
  if (isNaN(next)) return false;
  const had = t.gradedAt ? new Date(t.gradedAt).getTime() : NaN;
  return isNaN(had) || next > had;
}

function gradedBeforeItem(t: DeadlineTask, update: import('../types').TaskSubmissionUpdate, nowMs: number): boolean {
  const due = dueTime(t);
  const gradedMs = update.gradedAt ? new Date(update.gradedAt).getTime() : nowMs;
  return !isNaN(due) && gradedMs + MARK_SLACK_MS < due;
}

export function applySubmissionUpdates(tasks: DeadlineTask[], updates: TaskSubmissionUpdate[], nowMs: number = Date.now()): number {
  let marksChanged = 0;
  const now = new Date(nowMs).toISOString();
  dropImpossibleMarks(tasks, nowMs);
  for (const update of updates) {
    const src = update.sourceId;
    const match = findTaskForUpdate(tasks, update, t =>
      // A task that already has its mark from one column is not taken by another one,
      // and a column seen graded before this task's date (a practice run) never applies to it
      !(src && t.gradeSourceId && t.gradeSourceId !== src && !gradedLater(t, update)) &&
      !(src && (t.gradeSourcesBefore || []).includes(src) && (!update.gradedAt || gradedBeforeItem(t, update, nowMs)))
    );
    if (!match) continue;
    if (src && (match.gradeSourcesBefore || []).includes(src)) {
      match.gradeSourcesBefore = match.gradeSourcesBefore!.filter(s => s !== src);
    }
    if (update.submissionStatus === 'graded') {
      const due = dueTime(match);
      const gradedMs = update.gradedAt ? new Date(update.gradedAt).getTime() : nowMs;
      if (!isNaN(due) && gradedMs + MARK_SLACK_MS < due) {
        // Graded before the item took place: a different (practice) item. Remember it so it never lands here.
        if (src && !(match.gradeSourcesBefore || []).includes(src)) {
          match.gradeSourcesBefore = [...(match.gradeSourcesBefore || []), src];
          match.updatedAt = now;
        }
        continue;
      }
      const changed = match.submissionStatus !== 'graded' ||
        (!!src && match.gradeSourceId !== src) ||
        (update.score !== undefined && match.score !== update.score) ||
        (update.maxScore !== undefined && match.maxScore !== update.maxScore) ||
        (!!update.scoreDisplay && match.scoreDisplay !== update.scoreDisplay);
      if (!changed) continue;
      match.submissionStatus = 'graded';
      if (src) match.gradeSourceId = src;
      if (update.gradedAt) match.gradedAt = update.gradedAt;
      if (update.score !== undefined) match.score = update.score;
      if (update.maxScore !== undefined) match.maxScore = update.maxScore;
      if (update.scoreDisplay) match.scoreDisplay = update.scoreDisplay;
      match.status = 'completed';
      match.updatedAt = now;
      marksChanged++;
    } else if (update.submissionStatus === 'submitted' && match.submissionStatus !== 'graded' && match.submissionStatus !== 'submitted') {
      match.submissionStatus = 'submitted';
      if (update.submittedAt) match.submittedAt = update.submittedAt;
      if (update.submissionReceipt) match.submissionReceipt = update.submissionReceipt;
      match.status = 'completed';
      match.updatedAt = now;
    }
  }
  return marksChanged;
}
