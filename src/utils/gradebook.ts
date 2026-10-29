import { DeadlineTask, TaskSubmissionUpdate, TaskType } from '../types';
import { findTaskForUpdate, findAllTasksForUpdate } from './streamParser';
import { parseCourseDetails } from '../core/courseHelper';
import { resolveTaskWeight, extractExplicitPoints } from '../core/syllabusWeights';
import { resolveTaskRoom } from '../core/courseSchedule';

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
  dueDate?: string;
  userCreatedColumn?: boolean;
  contentId?: string;
  deleted?: boolean;
  gradebookCategory?: { title?: string } | null;
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

/** Where the last scan's gradebook summary is kept (this device only), to explain a mark that did not arrive. */
export const GRADEBOOK_REPORT_KEY = 'bbs_gradebook_report';

export interface GradebookReportRow {
  course: string;
  column: string;
  status?: string;
  score?: number;
  possible?: number;
  gradedAt?: string;
  note?: string;
}

/** One row per grade Blackboard returned, with whatever kept it from being read. */
export function gradebookReport(columns: GradebookColumn[], grades: GradebookGrade[], course: string): GradebookReportRow[] {
  const byId = new Map(columns.map(c => [c.id, c]));
  return grades.map(g => {
    const col = byId.get(g.columnId);
    const score = typeof g.displayGrade?.score === 'number' ? g.displayGrade.score : g.effectiveScore;
    const notes = [
      !col ? `column ${g.columnId} not listed` : '',
      col?.visible === false ? 'hidden' : '',
      col?.gradesReleased === false ? 'not released' : '',
      col?.calculationType && col.calculationType !== 'NON_CALCULATED' ? col.calculationType.toLowerCase() : '',
      g.isExempt ? 'exempt' : ''
    ].filter(Boolean);
    return {
      course,
      column: decodeEntities(col?.effectiveColumnName || col?.columnName || ''),
      status: g.status,
      score: typeof score === 'number' ? round(score) : undefined,
      possible: g.pointsPossible || col?.possible,
      gradedAt: g.gradedDate || g.lastGradedDate || g.modifiedDate || g.lastModified,
      ...(notes.length ? { note: notes.join(', ') } : {})
    };
  });
}

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
    if (!col) { if (hasGrade && skipped) skipped.push(`a grade whose column Blackboard did not list (${g.columnId})`); continue; }
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
      dueDate: col?.dueDate && !col.userCreatedColumn && !isNaN(new Date(col.dueDate).getTime()) ? new Date(col.dueDate).toISOString() : undefined,
      gradedAt: gradedAt && !isNaN(new Date(gradedAt).getTime()) ? gradedAt : undefined
    };

    const raw = typeof g.displayGrade?.score === 'number' ? g.displayGrade.score : g.effectiveScore;
    if ((g.status === 'GRADED' || typeof g.displayGrade?.score === 'number') && typeof raw === 'number' && !isNaN(raw)) {
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
 * Extracts direct deadline tasks from Blackboard gradebook columns that represent real
 * linked course assessments/assignments (`userCreatedColumn === false && contentId && dueDate`).
 * Manually created instructor grade columns (`userCreatedColumn: true`) are skipped because
 * Blackboard sets their `dueDate` to the column creation timestamp.
 */
export function gradebookColumnsToTasks(
  columns: GradebookColumn[],
  course: { courseName?: string; courseCode?: string; courseId?: string },
  nowIso: string = new Date().toISOString()
): DeadlineTask[] {
  const tasks: DeadlineTask[] = [];
  if (!Array.isArray(columns) || columns.length === 0) return tasks;

  const parsedCourse = parseCourseDetails(`${course.courseCode || ''} ${course.courseName || ''}`.trim());
  const cleanCourseCode = (course.courseCode && course.courseCode !== 'UOS')
    ? course.courseCode
    : (parsedCourse.code && parsedCourse.code !== 'UOS' ? parsedCourse.code : '');
  const cleanCourseName = (course.courseName && course.courseName !== 'General Course' && course.courseName.toLowerCase() !== 'uos')
    ? course.courseName
    : (parsedCourse.name && parsedCourse.name !== 'General Course' ? parsedCourse.name : '');
  if (!cleanCourseName && !cleanCourseCode) return tasks;

  for (const col of columns) {
    if (!col || col.visible === false || col.deleted) continue;
    if (col.calculationType && col.calculationType !== 'NON_CALCULATED') continue;
    if ((col.scoreProviderHandle || '').includes('attendance')) continue;
    if (col.userCreatedColumn !== false || !col.contentId || !col.dueDate) continue;

    const due = new Date(col.dueDate);
    if (isNaN(due.getTime())) continue;

    const title = decodeEntities(col.effectiveColumnName || col.columnName || '').trim();
    if (!title || /blackboard\s*orientation/i.test(title)) continue;

    const catTitle = col.gradebookCategory?.title || '';
    let type: TaskType = 'assignment';
    if (/quiz|كويز|اختبار\s*قصير/i.test(title) || /quiz/i.test(catTitle)) {
      type = 'quiz';
    } else if (/\b(?:exam|mid[\s_-]*term|final)\b|امتحان|اختبار\s*(?:نصفي|نهائي|فصلي)/i.test(title)) {
      type = 'exam';
    } else if (/project|مشروع|بحث/i.test(title)) {
      type = 'project';
    }

    const weightInfo = resolveTaskWeight({
      title,
      courseName: cleanCourseName,
      courseCode: cleanCourseCode,
      type,
      sourceSnippet: title
    });
    const roomInfo = resolveTaskRoom({
      courseNameOrCode: cleanCourseName || cleanCourseCode,
      title,
      type
    });

    const courseKey = (course.courseId || cleanCourseCode || cleanCourseName).replace(/[^A-Za-z0-9_]/g, '');
    const id = `gbcol_${courseKey}_${col.id}`;

    tasks.push({
      id,
      courseCode: cleanCourseCode,
      courseName: cleanCourseName || cleanCourseCode,
      title,
      description: '',
      dueDate: due.toISOString(),
      hasSpecificTime: true,
      type,
      priority: type === 'exam' || type === 'quiz' ? 'high' : 'medium',
      status: 'pending',
      sourceSnippet: title,
      confidence: 1.0,
      extractedBy: 'local',
      weight: weightInfo.weight,
      weightDisplay: weightInfo.weightDisplay,
      syllabusNote: weightInfo.syllabusNote,
      room: roomInfo.room || undefined,
      createdAt: nowIso,
      updatedAt: nowIso
    });
  }

  return tasks;
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

/** Exams (midterms, finals) are proctored events that cannot happen before their scheduled date.
 * Homework, assignments, lab reports and projects can be submitted and graded early. */
export function isExamItem(t: { type?: string; title?: string }): boolean {
  const type = (t.type || '').toLowerCase();
  if (type === 'exam') return true;
  const title = (t.title || '').toLowerCase();
  return /\b(?:exam|mid[\s_-]*term|final)\b|امتحان|اختبار\s*(?:نصفي|نهائي|فصلي)/i.test(title);
}

/**
 * Removes marks from exams that have not happened yet: such a mark came from another item
 * (a practice midterm's mark on the real midterm). Homework and assignments with future
 * deadlines are kept and automatically marked completed when a mark is released.
 */
export function dropImpossibleMarks(tasks: DeadlineTask[], nowMs: number = Date.now()): number {
  let cleared = 0;
  // Build map of official gradebook column IDs to courses from gbcol_ tasks
  const colToCourse = new Map<string, string>();
  for (const t of tasks) {
    const m = (t.id || '').match(/^gbcol_.*(_\d+_\d+)$/);
    const cKey = (t.courseCode || t.courseName || '').toLowerCase().trim();
    if (m && cKey && cKey !== 'general course' && cKey !== 'uos') {
      colToCourse.set(m[1], cKey);
    }
  }

  for (const t of tasks) {
    if (t.submissionStatus !== 'graded') {
      if (
        t.score !== undefined ||
        t.maxScore !== undefined ||
        t.scoreDisplay !== undefined ||
        t.gradedAt !== undefined ||
        t.markProvisional !== undefined
      ) {
        delete t.score;
        delete t.maxScore;
        delete t.scoreDisplay;
        delete t.gradedAt;
        delete t.markProvisional;
        t.updatedAt = new Date(nowMs).toISOString();
        cleared++;
      }
      continue;
    }

    // 1. Explicit points in title must agree with maxScore (e.g. "15 درجة" vs maxScore 10);
    // syllabus weights (e.g. "worth 25%", "20%") do not bound maxScore
    const isWeightPhrase = /(?:worth\s*\d|\bweight\b|%|بنسبة|وزن)/i.test(t.title);
    const explicitPts = isWeightPhrase ? null : extractExplicitPoints(t.title);
    if (explicitPts !== null && typeof t.maxScore === 'number' && Math.abs(explicitPts - t.maxScore) > 0.5) {
      delete t.score;
      delete t.maxScore;
      delete t.scoreDisplay;
      delete t.gradedAt;
      delete t.markProvisional;
      delete t.gradeSourceId;
      t.submissionStatus = (t.status === 'completed' || (t.id || '').startsWith('gbcol_')) ? 'submitted' : undefined;
      t.updatedAt = new Date(nowMs).toISOString();
      cleared++;
      continue;
    }

    // 2. A gbcol_ task whose gradeSourceId points to a different column had a cross-matched mark
    const colM = (t.id || '').match(/^gbcol_.*(_\d+_\d+)$/);
    if (colM && t.gradeSourceId) {
      const srcCol = t.gradeSourceId.replace(/^(?:gb:|col_)/, '');
      if (srcCol !== colM[1]) {
        delete t.score;
        delete t.maxScore;
        delete t.scoreDisplay;
        delete t.gradedAt;
        delete t.markProvisional;
        t.gradeSourceId = `gb:${colM[1]}`;
        t.submissionStatus = t.status === 'completed' ? 'submitted' : undefined;
        t.updatedAt = new Date(nowMs).toISOString();
        cleared++;
        continue;
      }
    }

    // 3. Cross-course gradeSourceId check
    if (t.gradeSourceId) {
      const srcCol = t.gradeSourceId.replace(/^(?:gb:|col_)/, '');
      const ownerCourse = colToCourse.get(srcCol);
      const tCourse = (t.courseCode || t.courseName || '').toLowerCase().trim();
      if (ownerCourse && tCourse && ownerCourse !== tCourse) {
        delete t.score;
        delete t.maxScore;
        delete t.scoreDisplay;
        delete t.gradedAt;
        delete t.markProvisional;
        delete t.gradeSourceId;
        t.submissionStatus = t.status === 'completed' ? 'submitted' : undefined;
        t.updatedAt = new Date(nowMs).toISOString();
        cleared++;
        continue;
      }
    }

    // Homework, assignments, lab reports and projects can be submitted and graded early
    if (!isExamItem(t)) {
      if (t.status !== 'completed' && t.status !== 'dismissed') {
        t.status = 'completed';
        t.updatedAt = new Date(nowMs).toISOString();
      }
      continue;
    }
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
  if (!isExamItem(t)) return false;
  const due = dueTime(t);
  const gradedMs = update.gradedAt ? new Date(update.gradedAt).getTime() : nowMs;
  return !isNaN(due) && gradedMs + MARK_SLACK_MS < due;
}

export function applySubmissionUpdates(tasks: DeadlineTask[], updates: TaskSubmissionUpdate[], nowMs: number = Date.now()): number {
  const changedTasks = new Set<DeadlineTask>();
  const now = new Date(nowMs).toISOString();
  const snapBefore = new Map<DeadlineTask, string>(tasks.map(t => [t, JSON.stringify(t)]));
  dropImpossibleMarks(tasks, nowMs);
  for (const t of tasks) {
    if (JSON.stringify(t) !== snapBefore.get(t)) changedTasks.add(t);
  }

  // Strip any mark whose gradeSourceId belongs to a gradebook update from a different course
  for (const update of updates) {
    if (!update.sourceId) continue;
    const uCourse = parseCourseDetails(update.courseName || update.courseCode || '');
    const uCode = (update.courseCode || uCourse.code || '').toLowerCase().trim();
    const uName = (uCourse.name || update.courseName || '').toLowerCase().trim();
    for (const t of tasks) {
      if (t.gradeSourceId !== update.sourceId) continue;
      const tCourse = parseCourseDetails(t.courseName || t.courseCode || '');
      const tCode = (t.courseCode || tCourse.code || '').toLowerCase().trim();
      const tName = (tCourse.name || t.courseName || '').toLowerCase().trim();
      const sameCourse = (uCode && tCode && (uCode === tCode || (uCode.length >= 6 && tCode.length >= 6 && (uCode.startsWith(tCode) || tCode.startsWith(uCode))))) ||
        (uName && tName && (uName === tName || uName.includes(tName) || tName.includes(uName)));
      if (!sameCourse && (uCode || uName) && (tCode || tName)) {
        delete t.score;
        delete t.maxScore;
        delete t.scoreDisplay;
        delete t.gradedAt;
        delete t.markProvisional;
        delete t.gradeSourceId;
        t.submissionStatus = t.status === 'completed' ? 'submitted' : undefined;
        t.updatedAt = now;
        changedTasks.add(t);
      }
    }
  }

  for (const update of updates) {
    const src = update.sourceId;
    const seenEarly = (t: DeadlineTask) => Boolean(src && (t.gradeSourcesBefore || []).includes(src));
    if (update.submissionStatus === 'submitted') {
      const matches = findAllTasksForUpdate(tasks, update, () => true);
      for (const match of matches) {
        const hadSpuriousMark = match.submissionStatus === 'graded' || match.score !== undefined || match.maxScore !== undefined || match.scoreDisplay !== undefined;
        const changed = match.submissionStatus !== 'submitted' ||
          match.status !== 'completed' ||
          hadSpuriousMark ||
          (!!src && match.gradeSourceId !== src);
        if (!changed) continue;
        delete match.score;
        delete match.maxScore;
        delete match.scoreDisplay;
        delete match.gradedAt;
        delete match.markProvisional;
        match.submissionStatus = 'submitted';
        if (src) match.gradeSourceId = src;
        if (update.submittedAt) match.submittedAt = update.submittedAt;
        if (update.submissionReceipt) match.submissionReceipt = update.submissionReceipt;
        match.status = 'completed';
        match.updatedAt = now;
        changedTasks.add(match);
      }
      continue;
    }

    const match = findTaskForUpdate(tasks, update, t => {
      if (src && t.id.endsWith(src.replace(/^gb:/, ''))) return true;
      return !(src && t.gradeSourceId && t.gradeSourceId !== src && !gradedLater(t, update) && !(t.markProvisional && !seenEarly(t))) &&
        !(seenEarly(t) && (gradedBeforeItem(t, update, nowMs) || (!update.gradedAt && !!t.gradeSourceId)));
    });
    if (!match) continue;
    const fromEarlyColumn = seenEarly(match);
    // Undated and first seen before the item: shown, but a mark from any other column replaces it
    const provisional = !update.gradedAt && (fromEarlyColumn || (!!match.markProvisional && match.gradeSourceId === src));
    if (fromEarlyColumn) {
      match.gradeSourcesBefore = match.gradeSourcesBefore!.filter(s => s !== src);
    }
    if (update.submissionStatus === 'graded') {
      if (isExamItem(match)) {
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
      }
      const changed = match.submissionStatus !== 'graded' ||
        match.status !== 'completed' ||
        !!match.markProvisional !== provisional ||
        (!!src && match.gradeSourceId !== src) ||
        (update.score !== undefined && match.score !== update.score) ||
        (update.maxScore !== undefined && match.maxScore !== update.maxScore) ||
        (!!update.scoreDisplay && match.scoreDisplay !== update.scoreDisplay);
      if (!changed) continue;
      match.submissionStatus = 'graded';
      if (src) match.gradeSourceId = src;
      if (update.gradedAt) match.gradedAt = update.gradedAt;
      if (provisional) match.markProvisional = true;
      else delete match.markProvisional;
      if (update.score !== undefined) match.score = update.score;
      if (update.maxScore !== undefined) match.maxScore = update.maxScore;
      if (update.scoreDisplay) match.scoreDisplay = update.scoreDisplay;
      match.status = 'completed';
      match.updatedAt = now;
      changedTasks.add(match);
    }
  }

  // Any non-exam task with a released mark in the gradebook is automatically marked as completed,
  // even if its due date is far in the future or the student forgot to mark it as done.
  for (const t of tasks) {
    if (t.submissionStatus === 'graded' && !isExamItem(t) && t.status !== 'completed' && t.status !== 'dismissed') {
      t.status = 'completed';
      t.updatedAt = now;
      changedTasks.add(t);
    }
  }

  return changedTasks.size;
}

/**
 * Identifies synthetic deadline tasks created from gradebook columns.
 * Gradebook columns are for marks and grades only; they must never be deadline tasks on the calendar.
 *
 * Targets:
 * 1. Any task with id starting with 'gbmark_'.
 * 2. Completed gradebook column tasks ('gbcol_') with artificial scan-time due dates.
 * 3. Duplicate exam items (e.g. 'EAP Midterm Exam') where an announced exam ('Midterm') already exists.
 * 4. Completed local tasks with empty description and matching sourceSnippet that duplicate an existing real task.
 */
export function isSyntheticGradebookTask(t: DeadlineTask, allTasks?: DeadlineTask[]): boolean {
  if (!t || !t.id) return false;
  const id = t.id;

  // 1. Any task with id starting with gbmark_ is always synthetic
  if (id.startsWith('gbmark_')) return true;

  if (id.startsWith('gbcol_')) {
    // Duplicate exam items: if this is an exam and another non-gbcol exam exists in the same course
    if (allTasks && isExamItem(t)) {
      const hasOtherExam = allTasks.some(other => {
        if (!other || other.id === t.id || other.id.startsWith('gbcol_') || other.id.startsWith('gbmark_') || !isExamItem(other)) {
          return false;
        }
        const res = parseCourseDetails(`${other.courseCode || ''} ${other.courseName || ''}`);
        const sRes = parseCourseDetails(`${t.courseCode || ''} ${t.courseName || ''}`);
        const sName = (sRes.name || t.courseName || '').toLowerCase().trim();
        const oName = (res.name || other.courseName || '').toLowerCase().trim();
        const sCode = (sRes.code || t.courseCode || '').toLowerCase().trim();
        const oCode = (res.code || other.courseCode || '').toLowerCase().trim();
        const sameCourse = (sCode && oCode && (sCode === oCode || (sCode.length >= 6 && oCode.length >= 6 && (sCode.startsWith(oCode) || oCode.startsWith(sCode))))) ||
          (sName && oName && (sName === oName || sName.includes(oName) || oName.includes(sName)));
        if (!sameCourse) return false;

        const isMidterm = /(?:\bmidterm\b|نصفي)/i.test(t.title) && /(?:\bmidterm\b|نصفي)/i.test(other.title);
        const isFinal = /(?:\bfinal\b|نهائي)/i.test(t.title) && /(?:\bfinal\b|نهائي)/i.test(other.title);
        if (!isMidterm && !isFinal) return false;

        const tNums = (t.title.replace(/\(\s*\d+(?:\.\d+)?\s*(?:pts?|points?|marks?|درجات|درجة|علامات|علامة)?\s*\)/gi, ' ').match(/\d+/g) || []).map(Number);
        const oNums = (other.title.replace(/\(\s*\d+(?:\.\d+)?\s*(?:pts?|points?|marks?|درجات|درجة|علامات|علامة)?\s*\)/gi, ' ').match(/\d+/g) || []).map(Number);
        if (tNums.length > 0 && oNums.length > 0 && !tNums.some(n => oNums.includes(n))) return false;
        return true;
      });
      if (hasOtherExam) return true;
    }

    // 2. Completed gradebook column tasks with artificial scan-time due dates (e.g. 2026-10-28)
    const isScanDate = Boolean(
      (t.dueDate || '').startsWith('2026-10-28') ||
      (t.dueDate && t.createdAt && t.dueDate.slice(0, 10) === t.createdAt.slice(0, 10))
    );

    if (t.status === 'completed' && isScanDate && !t.announcementId) {
      if (t.sourceSnippet === 'gradebook') {
        if (t.dueDate !== '') {
          t.dueDate = '';
          t.hasSpecificTime = false;
        }
        return false;
      }
      return true;
    }
  }

  return false;
}

/**
 * Removes synthetic deadline tasks created from gradebook columns (starting with gbcol_ or gbmark_).
 * Gradebook columns are for marks and grades only; they must never be deadline tasks on the calendar.
 *
 * If any synthetic task carried a real score for a matching task in the course (e.g. EAP Midterm Exam -> Midterm),
 * the mark is transferred to the real task so no legitimate grade is lost.
 */
export function purgeSyntheticGradebookTasks(tasks: DeadlineTask[]): { cleaned: DeadlineTask[]; purgedIds: string[] } {
  if (!Array.isArray(tasks) || tasks.length === 0) return { cleaned: [], purgedIds: [] };

  const synthetic = tasks.filter(t => isSyntheticGradebookTask(t, tasks));
  if (synthetic.length === 0) return { cleaned: tasks, purgedIds: [] };

  const purgedIds = synthetic.map(t => t.id);
  const syntheticSet = new Set(purgedIds);
  const realTasks = tasks.filter(t => !syntheticSet.has(t.id));

  // Transfer marks from purged synthetic tasks to matching real tasks in the same course
  for (const s of synthetic) {
    if (s.submissionStatus !== 'graded' || typeof s.score !== 'number') continue;

    // First try standard findTaskForUpdate
    let realMatch = findTaskForUpdate(realTasks, {
      courseName: s.courseName,
      courseCode: s.courseCode,
      title: s.title,
      submissionStatus: 'graded',
      score: s.score,
      maxScore: s.maxScore,
      sourceId: s.gradeSourceId
    });

    // If not found and this is an exam (e.g. "EAP Midterm Exam"), match to the course's midterm exam
    if (!realMatch && isExamItem(s)) {
      realMatch = realTasks.find(other => {
        if (!other || !isExamItem(other)) return false;
        const res = parseCourseDetails(`${other.courseCode || ''} ${other.courseName || ''}`);
        const sRes = parseCourseDetails(`${s.courseCode || ''} ${s.courseName || ''}`);
        const sName = (sRes.name || s.courseName || '').toLowerCase();
        const oName = (res.name || other.courseName || '').toLowerCase();
        const sCode = (sRes.code || s.courseCode || '').toLowerCase();
        const oCode = (res.code || other.courseCode || '').toLowerCase();
        const sameCourse = (sCode && oCode && sCode === oCode) || (sName && oName && (sName.includes(oName) || oName.includes(sName)));
        if (!sameCourse) return false;
        if (/(?:\bmidterm\b|نصفي)/i.test(s.title) && /(?:\bmidterm\b|نصفي)/i.test(other.title)) return true;
        if (/(?:\bfinal\b|نهائي)/i.test(s.title) && /(?:\bfinal\b|نهائي)/i.test(other.title)) return true;
        return false;
      });
    }

    if (realMatch) {
      realMatch.submissionStatus = 'graded';
      realMatch.score = s.score;
      realMatch.maxScore = s.maxScore;
      realMatch.scoreDisplay = s.scoreDisplay || `${s.score} / ${s.maxScore}`;
      if (s.gradeSourceId) realMatch.gradeSourceId = s.gradeSourceId;
      if (s.gradedAt) realMatch.gradedAt = s.gradedAt;
      realMatch.status = 'completed';
      realMatch.updatedAt = new Date().toISOString();
    }
  }

  const cleaned = tasks.filter(t => !syntheticSet.has(t.id));
  return { cleaned, purgedIds };
}
