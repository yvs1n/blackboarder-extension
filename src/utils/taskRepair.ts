import { DeadlineTask } from '../types';
import { resolveTaskWeight } from '../core/syllabusWeights';
import { resolveTaskRoom, isPlausibleRoom } from '../core/courseSchedule';

/**
 * Re-checks weight and room on every task the student has not edited, so values saved by an
 * older, wrong rule ("75% of Grade" from "final exam out of 75%", a room of "s") get corrected.
 * A task only changes (and gets a new updatedAt, which syncs) when a value actually differs.
 * Returns how many tasks changed.
 */
export function repairTaskWeightsAndRooms(tasks: DeadlineTask[]): number {
  let changed = 0;
  const now = new Date().toISOString();
  for (const t of tasks) {
    if (!t || t.userEdited || t.extractedBy === 'manual') continue;
    let touched = false;

    const w = resolveTaskWeight(t, t.courseName);
    if (w.weight !== undefined && w.weight !== t.weight) {
      t.weight = w.weight;
      t.weightDisplay = w.weightDisplay;
      t.syllabusNote = w.syllabusNote;
      touched = true;
    }

    const type = (t.type || '').toLowerCase();
    if (type === 'assignment' || type === 'hw' || type === 'project') {
      if (t.room) { t.room = undefined; touched = true; }
    } else if (t.room && !isPlausibleRoom(t.room)) {
      const r = resolveTaskRoom({
        courseNameOrCode: t.courseName || t.courseCode,
        announcementText: t.description || t.sourceSnippet,
        title: t.title,
        type: t.type
      });
      t.room = r.room || undefined;
      touched = true;
    }

    if (touched) {
      t.updatedAt = now;
      changed++;
    }
  }
  return changed;
}
