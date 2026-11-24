import { DeadlineTask } from '../types';
import { resolveTaskWeight } from '../core/syllabusWeights';
import { resolveTaskRoom, isPlausibleRoom } from '../core/courseSchedule';
import { resolveLatestFieldsFromNotes } from '../core/announcementReconcile';

/**
 * Re-checks weight, room, and multi-announcement professor-note updates on every task the student
 * has not edited, walking `[Doctor Update]:` segments chronologically so the latest professor
 * update wins rather than letting the initial announcement shadow later changes.
 * Returns how many tasks changed.
 */
export function repairTaskWeightsAndRooms(tasks: DeadlineTask[]): number {
  let changed = 0;
  const now = new Date().toISOString();
  for (const t of tasks) {
    if (!t || t.userEdited || t.extractedBy === 'manual') continue;
    let touched = false;

    const notesText = t.description || t.sourceSnippet || '';
    const latestFromNotes = resolveLatestFieldsFromNotes({
      title: t.title,
      notesText,
      courseNameOrCode: t.courseName || t.courseCode,
      taskType: t.type,
      baseDate: t.createdAt ? new Date(t.createdAt) : undefined
    });

    const w = latestFromNotes.latestWeight || resolveTaskWeight(t, t.courseName);
    if (w.weight !== undefined && w.weight !== t.weight) {
      t.weight = w.weight;
      t.weightDisplay = w.weightDisplay;
      t.syllabusNote = w.syllabusNote;
      touched = true;
    }

    const type = (t.type || '').toLowerCase();
    if (type === 'assignment' || type === 'hw' || type === 'project') {
      if (t.room) { t.room = undefined; touched = true; }
    } else if (latestFromNotes.latestRoom && latestFromNotes.latestRoom !== t.room) {
      t.room = latestFromNotes.latestRoom;
      touched = true;
    } else if (t.room && !isPlausibleRoom(t.room)) {
      const r = resolveTaskRoom({
        courseNameOrCode: t.courseName || t.courseCode,
        announcementText: notesText,
        title: t.title,
        type: t.type
      });
      t.room = r.room || undefined;
      touched = true;
    }

    if (latestFromNotes.latestTime && t.dueDate && t.status !== 'completed' && t.submissionStatus !== 'graded') {
      const due = new Date(t.dueDate);
      if (!isNaN(due.getTime())) {
        due.setHours(latestFromNotes.latestTime.hour, latestFromNotes.latestTime.minute, 0, 0);
        const nextIso = due.toISOString();
        if (nextIso !== t.dueDate) {
          t.dueDate = nextIso;
          t.hasSpecificTime = true;
          t.timeSource = 'explicit';
          touched = true;
        }
      }
    }

    if (touched) {
      t.updatedAt = now;
      changed++;
    }
  }
  return changed;
}
