import { describe, it, expect } from 'vitest';
import { applySubmissionUpdates, dropImpossibleMarks, gradebookToUpdates } from '../src/utils/gradebook';
import { findTaskForUpdate, isPracticeTitle } from '../src/utils/streamParser';
import type { DeadlineTask, TaskSubmissionUpdate } from '../src/types';

const NOW = new Date('2026-10-22T12:00:00Z').getTime();

function task(o: Partial<DeadlineTask>): DeadlineTask {
  return {
    id: o.title!, type: 'exam', status: 'pending', extractedBy: 'local',
    dueDate: '2026-10-01T10:00:00.000Z', createdAt: '', updatedAt: 'old', ...o
  } as DeadlineTask;
}

const graded = (o: Partial<TaskSubmissionUpdate>): TaskSubmissionUpdate =>
  ({ submissionStatus: 'graded', score: 20, maxScore: 20, ...o } as TaskSubmissionUpdate);

describe('a practice midterm mark never lands on the real midterm', () => {
  // The owner's case: English midterm on Sunday Oct 25, a practice midterm already graded 20/20 on Oct 22
  const english = { courseName: 'English for Academic Purposes', courseCode: '0202 112' };

  it('removes a mark from a task that has not happened yet, and remembers its column', () => {
    const mid = task({ title: 'Midterm', ...english, courseCode: 'UOS', extractedBy: 'manual', userEdited: true,
      dueDate: '2026-10-25T06:00:00.000Z', submissionStatus: 'graded', score: 20, maxScore: 20, status: 'completed', gradeSourceId: 'gb:_1928045_1' });
    expect(dropImpossibleMarks([mid], NOW)).toBe(1);
    expect(mid.score).toBeUndefined();
    expect(mid.submissionStatus).toBeUndefined();
    expect(mid.status).toBe('pending');
    expect(mid.gradeSourcesBefore).toEqual(['gb:_1928045_1']);
  });

  it('a column graded before the task date is skipped now and after the exam', () => {
    const mid = task({ title: 'Midterm', ...english, dueDate: '2026-10-25T06:00:00.000Z' });
    const practice = graded({ title: 'EAP Midterm Exam', ...english, sourceId: 'gb:_1928045_1' });
    expect(applySubmissionUpdates([mid], [practice], NOW)).toBe(0);
    expect(mid.score).toBeUndefined();
    expect(mid.gradeSourcesBefore).toEqual(['gb:_1928045_1']);

    // Oct 30: the exam has passed, the same practice column is still there, the real one is new
    const later = new Date('2026-10-30T12:00:00Z').getTime();
    expect(applySubmissionUpdates([mid], [practice], later)).toBe(0);
    expect(mid.score).toBeUndefined();
    const real = graded({ title: 'Midterm Exam', ...english, score: 17, sourceId: 'gb:_1999999_1' });
    expect(applySubmissionUpdates([mid], [practice, real], later)).toBe(1);
    expect(mid.score).toBe(17);
    expect(mid.gradeSourceId).toBe('gb:_1999999_1');
  });

  it('uses the grade date when Blackboard gives one', () => {
    const mid = task({ title: 'Midterm', ...english, dueDate: '2026-10-25T06:00:00.000Z' });
    const later = new Date('2026-10-30T12:00:00Z').getTime();
    const early = graded({ title: 'Midterm', ...english, sourceId: 'gb:a', gradedAt: '2026-10-20T09:00:00Z' });
    expect(applySubmissionUpdates([mid], [early], later)).toBe(0);
    expect(mid.gradeSourcesBefore).toEqual(['gb:a']);
  });

  it('titles that say practice or mock only match each other', () => {
    expect(isPracticeTitle('Midterm Practice')).toBe(true);
    expect(isPracticeTitle('Mock Midterm')).toBe(true);
    expect(isPracticeTitle('امتحان تجريبي')).toBe(true);
    expect(isPracticeTitle('Midterm Exam')).toBe(false);
    const tasks = [task({ title: 'Midterm', ...english }), task({ title: 'Midterm Practice', ...english })];
    expect(findTaskForUpdate(tasks, graded({ title: 'Practice Midterm', ...english }))?.title).toBe('Midterm Practice');
    expect(findTaskForUpdate([tasks[0]], graded({ title: 'Practice Midterm', ...english }))).toBeUndefined();
  });

  it('a task keeps the column its mark came from', () => {
    const q = task({ title: 'Quiz 1', ...english, submissionStatus: 'graded', score: 4.5, maxScore: 5, gradeSourceId: 'gb:q1' });
    applySubmissionUpdates([q], [graded({ title: 'Quiz 1 Retake', ...english, score: 1, maxScore: 5, sourceId: 'gb:other' })], NOW);
    expect(q.score).toBe(4.5);
  });
});

describe('a task added by hand gets its gradebook mark', () => {
  it('Calculus "Assignment-1-Graded" lands on a hand-added "Assignment 1" with the course list code', () => {
    const a1 = task({ title: 'Assignment 1', type: 'assignment', extractedBy: 'manual', userEdited: true,
      courseName: 'Calculus I for Engineering', courseCode: '1440133', dueDate: '2026-09-28T19:00:00.000Z' });
    const a2 = task({ title: 'Assignment 2', type: 'assignment', courseName: 'Calculus I for Engineering', dueDate: '2026-10-08T19:00:00.000Z' });
    const [up] = gradebookToUpdates(
      [{ id: '_1', effectiveColumnName: 'Assignment-1-Graded', possible: 10, visible: true, gradesReleased: true, calculationType: 'NON_CALCULATED' }],
      [{ columnId: '_1', status: 'GRADED', pointsPossible: 10, displayGrade: { score: 9 } }],
      // Blackboard's own course name can carry a section ("1440133-02")
      { courseName: 'Calculus I for Engineering', courseCode: '1440133-02' }
    );
    expect(applySubmissionUpdates([a1, a2], [up], NOW)).toBe(1);
    expect(a1.score).toBe(9);
    expect(a2.score).toBeUndefined();
  });

  it('codes that differ and names that differ are still different courses', () => {
    const t = task({ title: 'Quiz 1', courseName: 'Islamic Culture', courseCode: '0104100' });
    expect(findTaskForUpdate([t], graded({ title: 'Quiz 1', courseName: 'Calculus I for Engineering', courseCode: '1440133' }))).toBeUndefined();
  });

  it('"Quiz 1" never takes the mark of "Quiz 10"', () => {
    const t = task({ title: 'Quiz 1', courseName: 'Calculus I for Engineering' });
    expect(findTaskForUpdate([t], graded({ title: 'Quiz 10', courseName: 'Calculus I for Engineering' }))).toBeUndefined();
  });
});
