import type { DeadlineTask } from '../types';
import { stripAlreadyAllocatedWeights } from '../core/makeupFilter';
import { isHiddenTask } from './b5-applicability';

/**
 * Branch B6: Grade Allocation & Marks Impact.
 * - B6.3.1: Hidden tasks NEVER carry syllabus weight or count toward Marks/GPA/Target GPA.
 * - B6.3.2: Kept extension/catch-up reminders or unnumbered extras in a fully allocated syllabus
 *   component have their duplicate grade allocation stripped (`weight: undefined`, `ignoreMark: true`).
 */
export function applyGradeAllocationRules(tasks: DeadlineTask[]): DeadlineTask[] {
  if (!Array.isArray(tasks) || tasks.length === 0) return tasks || [];

  const activeCleaned = stripAlreadyAllocatedWeights(
    tasks.map(task => {
      if (!task || !isHiddenTask(task)) return task;
      if (task.weight === undefined && !task.weightDisplay && !task.syllabusNote && task.ignoreMark) {
        return task;
      }
      const prevMs = Date.parse(task.updatedAt || task.createdAt || '') || 0;
      const next: DeadlineTask = {
        ...task,
        ignoreMark: true,
        updatedAt: new Date(Math.max(Date.now(), prevMs + 1)).toISOString()
      };
      delete next.weight;
      delete next.weightDisplay;
      delete next.syllabusNote;
      return next;
    })
  );

  return activeCleaned;
}
