import type { DeadlineTask, TaskHiddenReason, TaskVisibility } from '../types';

export type TaskIntent = 'regular' | 'bonus' | 'makeup' | 'extension' | 'review' | 'practice';

export interface RuleTraceEntry {
  ruleId: string;
  branch: 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6';
  outcome: string;
}

export interface VisibilityDecision {
  visibility: TaskVisibility;
  hiddenReason?: TaskHiddenReason;
  hiddenReasonLabel?: string;
  ruleId: string;
  explanation: string;
}

export interface RulebookTaskContext {
  allTasks: ReadonlyArray<DeadlineTask>;
}
