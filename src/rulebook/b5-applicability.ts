import type { DeadlineTask } from '../types';
import { isExamReviewTask } from '../core/courseHelper';
import {
  extractReferencedAssessmentNumbers,
  isCompletedExtensionOrRangeTask,
  isMakeupSupersededByCompletedOriginal,
  isUneditedExtraPastSyllabusQuota,
  resolveMakeupTarget,
  resolveMatchedSyllabusComponent
} from '../core/makeupFilter';
import type { VisibilityDecision } from './types';

export function isHiddenTask(task?: Pick<DeadlineTask, 'visibility'> | null): boolean {
  return Boolean(task && task.visibility === 'hidden');
}

export function isVisibleActiveTask(task?: Pick<DeadlineTask, 'visibility'> | null): boolean {
  return Boolean(task && task.visibility !== 'hidden');
}

/**
 * Branch B5: Applicability & Visibility Decision Tree.
 * Determines whether a task belongs in the student's active Deadlines/Calendar or should be
 * tucked into Hidden ("Not For Me") for reference and sharing with friends.
 */
export function evaluateTaskVisibility(
  task: DeadlineTask,
  allTasks: Iterable<DeadlineTask>
): VisibilityDecision {
  // B5.4.1: Explicit user override or manual/edited task always stays active unless manually hidden
  if (task.visibilityLocked === 'active') {
    return {
      visibility: 'active',
      ruleId: 'B5.4.1',
      explanation: 'User restored this deadline to active view (visibilityLocked=active)'
    };
  }
  if (task.visibilityLocked === 'hidden') {
    return {
      visibility: 'hidden',
      hiddenReason: task.hiddenReason || 'manual_hide',
      hiddenReasonLabel: task.hiddenReasonLabel || 'Hidden by you',
      ruleId: 'B5.4.2',
      explanation: 'User manually hid this deadline (visibilityLocked=hidden)'
    };
  }
  if (task.userEdited || task.extractedBy === 'manual') {
    return {
      visibility: 'active',
      ruleId: 'B5.4.1',
      explanation: 'Manual or user-edited task stays active'
    };
  }

  // B5.0.1: Post-exam review / paper viewing sessions stay accessible under Hidden for reference
  if (task.hiddenReason === 'review_session' || isExamReviewTask(task)) {
    return {
      visibility: 'hidden',
      hiddenReason: 'review_session',
      hiddenReasonLabel: 'Post-exam review / paper viewing',
      ruleId: 'B5.0.1',
      explanation: 'Post-exam review or paper viewing session routed to Hidden'
    };
  }

  // B5.1.1: Makeup exam/quiz whose original assessment is already completed or graded
  if (isMakeupSupersededByCompletedOriginal(task, allTasks)) {
    const target = resolveMakeupTarget(task);
    const labelMap: Record<typeof target.kind, string> = {
      midterm: 'Original Midterm already completed',
      final: 'Original Final Exam already completed',
      quiz: target.num ? `Original Quiz ${target.num} already completed` : 'Original Quiz already completed',
      lab: target.num ? `Original Lab ${target.num} already completed` : 'Original Lab already completed',
      assignment: target.num ? `Original Assignment ${target.num} already completed` : 'Original Assignment already completed',
      exam: 'Original Exam already completed'
    };
    return {
      visibility: 'hidden',
      hiddenReason: 'makeup_completed',
      hiddenReasonLabel: labelMap[target.kind],
      ruleId: 'B5.1.1',
      explanation: `Superseded makeup (${target.kind}) hidden because original assessment is completed`
    };
  }

  // B5.2.1: Multi-item / range extension where ALL referenced items are already completed
  if (isCompletedExtensionOrRangeTask(task, allTasks)) {
    const nums = extractReferencedAssessmentNumbers(task.title || '');
    const rangeText = nums.length > 1
      ? `${nums[0]}-${nums[nums.length - 1]}`
      : (nums.length === 1 ? `${nums[0]}` : 'referenced items');
    return {
      visibility: 'hidden',
      hiddenReason: 'extension_completed',
      hiddenReasonLabel: `Items ${rangeText} already completed`,
      ruleId: 'B5.2.1',
      explanation: `Extended deadline hidden because all referenced items (${nums.join(', ')}) are completed`
    };
  }

  // B5.3.1: Unedited non-bonus extra item past a completed syllabus component quota
  if (isUneditedExtraPastSyllabusQuota(task, allTasks)) {
    const compInfo = resolveMatchedSyllabusComponent(task);
    const compName = compInfo?.comp.name || 'syllabus category';
    return {
      visibility: 'hidden',
      hiddenReason: 'quota_exhausted',
      hiddenReasonLabel: `All ${compName} already completed`,
      ruleId: 'B5.3.1',
      explanation: `Extra item hidden because ${compName} quota (${compInfo?.maxItems ?? 0}) is already completed`
    };
  }

  return {
    visibility: 'active',
    ruleId: 'B5.0.0',
    explanation: 'Active deadline applicable to student'
  };
}
