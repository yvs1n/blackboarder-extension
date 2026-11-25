import type { Announcement, DeadlineTask } from '../types';
import { resolveCourseInfo, isExamReviewSession, sanitizeDoctorAnnouncementText } from '../core/courseHelper';
import { resolveTaskRoom, resolveTaskTimeWithSchedule } from '../core/courseSchedule';
import {
  countCompletedInSyllabusComponent,
  extractReferencedAssessmentNumbers,
  isBonusTaskText,
  isExtensionOrMissedWorkTask,
  isMakeupTask,
  resolveMatchedSyllabusComponent
} from '../core/makeupFilter';
import { resolveSingletonSyllabusKey } from '../core/syllabusWeights';
import { parseDateString } from '../engine/localDateTime';
import { evaluateTaskVisibility, isHiddenTask, isVisibleActiveTask } from './b5-applicability';
import { applyGradeAllocationRules } from './b6-allocation';

export { evaluateTaskVisibility, isHiddenTask, isVisibleActiveTask, applyGradeAllocationRules };
export type { RuleTraceEntry, TaskIntent, VisibilityDecision } from './types';

/**
 * Evaluates Branch B5 (Applicability & Visibility) and Branch B6 (Grade Allocation) across a
 * task list in a single fast pass. Hidden tasks stay in storage so students can still inspect
 * and share them when a friend asks, while staying completely out of active views and GPA.
 */
function bumpMonotonicUpdatedAt(task: DeadlineTask): string {
  const prevMs = Date.parse(task.updatedAt || task.createdAt || '') || 0;
  return new Date(Math.max(Date.now(), prevMs + 1)).toISOString();
}

export function evaluateTaskList(tasks: DeadlineTask[]): DeadlineTask[] {
  if (!Array.isArray(tasks) || tasks.length === 0) return tasks || [];

  const withVisibility = tasks.map(task => {
    if (!task) return task;
    const decision = evaluateTaskVisibility(task, tasks);
    if (decision.visibility === 'hidden') {
      if (
        task.visibility === 'hidden' &&
        task.hiddenReason === decision.hiddenReason &&
        task.hiddenReasonLabel === decision.hiddenReasonLabel
      ) {
        return task;
      }
      return {
        ...task,
        visibility: 'hidden' as const,
        hiddenReason: decision.hiddenReason,
        hiddenReasonLabel: decision.hiddenReasonLabel,
        updatedAt: bumpMonotonicUpdatedAt(task)
      };
    }

    // Active: clear stale auto-hidden flags if task was restored or original exam unchecked
    if (task.visibility === 'hidden' && task.visibilityLocked !== 'hidden') {
      const next: DeadlineTask = { ...task, updatedAt: bumpMonotonicUpdatedAt(task) };
      delete next.visibility;
      delete next.hiddenReason;
      delete next.hiddenReasonLabel;
      return next;
    }
    return task;
  });

  return applyGradeAllocationRules(withVisibility);
}

/**
 * Lazy diagnostic trace for the Debug Stick X-Ray inspector.
 * Never called on normal render/scan paths, so it adds zero runtime overhead.
 */
export function explainTaskDecision(task: DeadlineTask, allTasks: ReadonlyArray<DeadlineTask>): string[] {
  const trace: string[] = [];
  const resolved = resolveCourseInfo(task);
  trace.push(`B2.2: course=${resolved.courseName}${resolved.courseCode ? ` (${resolved.courseCode})` : ''}`);

  const singleton = resolveSingletonSyllabusKey(task);
  if (singleton) trace.push(`B4.1: singletonKey=${singleton}`);

  if (isBonusTaskText(task)) trace.push('B3.3.1: intent=bonus');
  else if (isMakeupTask(task)) trace.push('B3.3.2: intent=makeup');
  else if (isExtensionOrMissedWorkTask(task)) {
    const nums = extractReferencedAssessmentNumbers(task.title || '');
    trace.push(`B3.3.3: intent=extension${nums.length ? ` nums=[${nums.join(',')}]` : ''}`);
  } else {
    trace.push(`B3.3.0: intent=regular (${task.type})`);
  }

  const comp = resolveMatchedSyllabusComponent(task);
  if (comp) {
    const done = countCompletedInSyllabusComponent(comp, task, allTasks, task.id);
    trace.push(`B4.0: syllabusComp=${comp.comp.name} (${done}/${comp.maxItems || '∞'} completed)`);
  }

  const vis = evaluateTaskVisibility(task, allTasks);
  trace.push(`${vis.ruleId}: visibility=${vis.visibility}${vis.hiddenReason ? ` (${vis.hiddenReason})` : ''} | ${vis.explanation}`);

  if (vis.visibility === 'hidden' || task.ignoreMark) {
    trace.push('B6.3.1: gradeAllocation=none (ignoreMark=true, excluded from Marks/GPA/Target)');
  } else if (task.isBonus) {
    trace.push(`B6.2.1: gradeAllocation=bonus (${task.weightDisplay || 'extra credit'})`);
  } else if (typeof task.weight === 'number' && task.weight > 0) {
    trace.push(`B6.1.1: gradeAllocation=regular (${task.weightDisplay || `${task.weight}%`})`);
  } else {
    trace.push('B6.3.2: gradeAllocation=unweighted');
  }

  return trace;
}

/**
 * Converts a dated post-exam review / paper viewing announcement into a Hidden reference card
 * (`visibility: 'hidden', hiddenReason: 'review_session'`) so it stays out of active deadlines
 * and GPA while remaining searchable and shareable under Hidden.
 */
export function extractHiddenReviewSessionTask(announcement: Announcement): DeadlineTask | null {
  const cleanBody = sanitizeDoctorAnnouncementText(
    announcement.contentText || '',
    announcement.courseName,
    announcement.courseCode,
    announcement.title
  ).trim();
  if (!isExamReviewSession(announcement.title, cleanBody)) return null;

  const baseDate = announcement.postedAt ? new Date(announcement.postedAt) : new Date();
  const dateMatch = parseDateString(`${announcement.title || ''}\n${cleanBody}`, baseDate);
  if (!dateMatch) return null;

  const sched = resolveTaskTimeWithSchedule({
    dueDate: dateMatch.date,
    courseNameOrCode: announcement.courseName || announcement.courseCode,
    hasSpecificTime: dateMatch.hasSpecificTime,
    announcementText: cleanBody,
    title: announcement.title || 'Exam Sheet Review'
  });
  const roomInfo = resolveTaskRoom({
    courseNameOrCode: announcement.courseName || announcement.courseCode,
    announcementText: `${announcement.title || ''}\n${cleanBody}`,
    title: announcement.title || 'Exam Sheet Review',
    type: 'meeting'
  });
  const nowIso = new Date().toISOString();

  return {
    id: `task_review_${announcement.id || Date.now()}`,
    announcementId: announcement.id,
    ...(announcement.postedAt ? { announcementPostedAt: announcement.postedAt } : {}),
    courseCode: announcement.courseCode || '',
    courseName: announcement.courseName || 'General Course',
    title: (announcement.title || 'Exam Sheet Review').trim().slice(0, 80),
    description: cleanBody,
    dueDate: sched.dueDate.toISOString(),
    hasSpecificTime: sched.hasSpecificTime,
    timeSource: dateMatch.hasSpecificTime ? 'explicit' : 'default',
    type: 'meeting',
    priority: 'low',
    status: 'pending',
    visibility: 'hidden',
    hiddenReason: 'review_session',
    hiddenReasonLabel: 'Post-exam review / paper viewing',
    ignoreMark: true,
    sourceSnippet: cleanBody,
    confidence: 0.85,
    extractedBy: 'local',
    room: roomInfo.room || undefined,
    createdAt: nowIso,
    updatedAt: nowIso
  };
}
