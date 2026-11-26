import { DeadlineTask } from '../../types';
import { resolveCourseInfo } from '../../core/courseHelper';
import { coreTitle } from './streamParser';
import { extractAssessmentNumber, extractExplicitPoints } from '../../core/syllabusWeights';
import { purgeSyntheticGradebookTasks } from '../marks/gradebook';

function clearScoreFields(task: DeadlineTask, opts?: { keepGradeSource?: boolean; submissionStatus?: 'submitted' }): DeadlineTask {
  const copy: any = { ...task };
  delete copy.score;
  delete copy.maxScore;
  delete copy.scoreDisplay;
  delete copy.gradedAt;
  delete copy.markProvisional;
  if (!opts?.keepGradeSource) delete copy.gradeSourceId;
  if (opts?.submissionStatus) copy.submissionStatus = opts.submissionStatus;
  else delete copy.submissionStatus;
  return copy as DeadlineTask;
}

/**
 * Strips impossible or orphaned marks from a single task:
 * - Tasks whose `submissionStatus` is not `'graded'` never keep a score.
 * - Tasks whose title states explicit points never keep a mismatched `maxScore`.
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
    const cleaned = clearScoreFields(task, {
      keepGradeSource: Boolean(colMatch),
      submissionStatus: (task.status === 'completed' || Boolean(colMatch)) ? 'submitted' : undefined
    });
    if (colMatch) cleaned.gradeSourceId = `gb:${colMatch[1]}`;
    return cleaned;
  }

  return task;
}

/**
 * Sanitizes marks across a list of tasks, clearing stolen cross-course `gradeSourceId` marks.
 */
export function sanitizeTaskListMarks(tasks: DeadlineTask[]): DeadlineTask[] {
  if (!Array.isArray(tasks) || tasks.length === 0) return tasks || [];
  const { cleaned: nonSynthetic } = purgeSyntheticGradebookTasks(tasks);
  const cleaned = nonSynthetic.map(sanitizeTaskMarks);

  const colOwnerCourse = new Map<string, string>();
  for (const t of cleaned) {
    if (!t) continue;
    const m = (t.id || '').match(/^gbcol_.*(_\d+_\d+)$/);
    if (m) {
      const course = resolveCourseInfo(t).courseName.toLowerCase();
      if (course && course !== 'general course') colOwnerCourse.set(m[1], course);
    }
  }

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
    const numbered = group.find(t => extractAssessmentNumber(t.title) !== null);
    if (numbered) colOwnerCourse.set(colId, resolveCourseInfo(numbered).courseName.toLowerCase());
  }

  return cleaned.map(t => {
    if (!t || t.submissionStatus !== 'graded') return t;
    const myCourse = resolveCourseInfo(t).courseName.toLowerCase();

    if (t.gradeSourceId) {
      const colId = t.gradeSourceId.replace(/^(?:gb:|col_)/, '');
      const owner = colOwnerCourse.get(colId);
      if (owner && myCourse && owner !== myCourse) {
        return clearScoreFields(t, { submissionStatus: t.status === 'completed' ? 'submitted' : undefined });
      }
    }

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
          return clearScoreFields(t, { submissionStatus: 'submitted' });
        }
      }
    }

    return t;
  });
}
