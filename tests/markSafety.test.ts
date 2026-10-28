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

  it('a column graded before the task date is skipped until the exam, then shown until another column replaces it', () => {
    const mid = task({ title: 'Midterm', ...english, dueDate: '2026-10-25T06:00:00.000Z' });
    const practice = graded({ title: 'EAP Midterm Exam', ...english, sourceId: 'gb:_1928045_1' });
    expect(applySubmissionUpdates([mid], [practice], NOW)).toBe(0);
    expect(mid.score).toBeUndefined();
    expect(mid.gradeSourcesBefore).toEqual(['gb:_1928045_1']);

    // Oct 30: the exam has passed and that column is still the only one, so it is the course's
    // midterm after all (Blackboard gives no grade dates): shown, but only provisionally
    const later = new Date('2026-10-30T12:00:00Z').getTime();
    expect(applySubmissionUpdates([mid], [practice], later)).toBe(1);
    expect(mid.score).toBe(20);
    expect(mid.markProvisional).toBe(true);
    expect(applySubmissionUpdates([mid], [practice], later)).toBe(0);
    // A second column turns up: it replaces the provisional mark, and the early one stays out
    const real = graded({ title: 'Midterm Exam', ...english, score: 17, sourceId: 'gb:_1999999_1' });
    expect(applySubmissionUpdates([mid], [practice, real], later)).toBe(1);
    expect(mid.score).toBe(17);
    expect(mid.gradeSourceId).toBe('gb:_1999999_1');
    expect(mid.markProvisional).toBeUndefined();
    expect(applySubmissionUpdates([mid], [practice, real], later)).toBe(0);
    expect(mid.score).toBe(17);
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

describe('a refused column is tried again once the task date is corrected', () => {
  const english = { courseName: "English for Academic Purposes", courseCode: "0202 112" };
  it('only when Blackboard dates the grade', () => {
    const NOW2 = new Date('2026-10-30T12:00:00Z').getTime();
    const mid = task({ title: 'Midterm', ...english, dueDate: '2026-11-20T06:00:00.000Z' });
    const real = graded({ title: 'Midterm Exam', ...english, score: 17, sourceId: 'gb:real', gradedAt: '2026-10-28T09:00:00Z' });
    expect(applySubmissionUpdates([mid], [real], NOW2)).toBe(0);
    expect(mid.gradeSourcesBefore).toEqual(['gb:real']);
    mid.dueDate = '2026-10-27T06:00:00.000Z';
    expect(applySubmissionUpdates([mid], [real], NOW2)).toBe(1);
    expect(mid.score).toBe(17);
    expect(mid.gradeSourcesBefore).toEqual([]);
  });
});

describe('the column graded last wins when two columns fit one task', () => {
  const english = { courseName: 'English for Academic Purposes', courseCode: '0202 112' };
  it('a dated real grade replaces an undated practice mark taken after the exam', () => {
    const after = new Date('2026-10-30T12:00:00Z').getTime();
    const mid = task({ title: 'Midterm', ...english, dueDate: '2026-10-25T06:00:00.000Z' });
    const practice = graded({ title: 'EAP Midterm Exam', ...english, score: 20, sourceId: 'gb:practice' });
    expect(applySubmissionUpdates([mid], [practice], after)).toBe(1);
    expect(mid.gradeSourceId).toBe('gb:practice');
    const real = graded({ title: 'Midterm Exam', ...english, score: 17, sourceId: 'gb:real', gradedAt: '2026-10-28T09:00:00Z' });
    expect(applySubmissionUpdates([mid], [practice, real], after)).toBe(1);
    expect(mid.score).toBe(17);
    expect(mid.gradeSourceId).toBe('gb:real');
    expect(applySubmissionUpdates([mid], [practice, real], after)).toBe(0);
    expect(mid.score).toBe(17);
  });
});

describe('columns that hold a grade but are not read say why', () => {
  it('lists hidden, unreleased and number-less grades', () => {
    const skipped: string[] = [];
    const cols = [
      { id: 'a', columnName: 'Midterm Exam', visible: false },
      { id: 'b', columnName: 'Quiz 3', gradesReleased: false },
      { id: 'c', columnName: 'Project', calculationType: 'NON_CALCULATED' },
      { id: 'd', columnName: 'Lab' }
    ];
    const grades = [
      { columnId: 'a', status: 'GRADED', effectiveScore: 26 },
      { columnId: 'b', status: 'GRADED', effectiveScore: 3 },
      { columnId: 'c', status: 'GRADED', displayGrade: { text: 'A' } },
      { columnId: 'd', status: 'NOT_ATTEMPTED' }
    ];
    const updates = gradebookToUpdates(cols, grades, { courseName: 'English for Academic Purposes' }, skipped);
    expect(updates).toHaveLength(0);
    expect(skipped).toEqual(['Midterm Exam (hidden in the gradebook)', 'Quiz 3 (grades not released yet)', 'Project (graded without a number)']);
  });
});

describe('gradebook report', () => {
  it('lists every returned grade and why it was not read', async () => {
    const { gradebookReport } = await import('../src/utils/gradebook');
    const rows = gradebookReport(
      [{ id: 'a', columnName: 'Midterm Exam', possible: 30, visible: false }, { id: 'b', columnName: 'Quiz 1', possible: 5 }],
      [{ columnId: 'a', status: 'GRADED', effectiveScore: 26 }, { columnId: 'b', status: 'GRADED', effectiveScore: 4.5 }, { columnId: 'z', status: 'GRADED', effectiveScore: 9 }],
      'English for Academic Purposes'
    );
    expect(rows).toEqual([
      { course: 'English for Academic Purposes', column: 'Midterm Exam', status: 'GRADED', score: 26, possible: 30, gradedAt: undefined, note: 'hidden' },
      { course: 'English for Academic Purposes', column: 'Quiz 1', status: 'GRADED', score: 4.5, possible: 5, gradedAt: undefined },
      { course: 'English for Academic Purposes', column: '', status: 'GRADED', score: 9, possible: undefined, gradedAt: undefined, note: 'column z not listed' }
    ]);
  });
});

describe('the owner\'s English midterm (gradebook has only "EAP Midterm Exam", no grade dates)', () => {
  it('lands on the Midterm task after the exam date, even though it was seen before it', () => {
    const english = { courseName: 'English for Academic Purposes', courseCode: '' };
    const mid = task({ title: 'Midterm', ...english, dueDate: '2026-10-25T06:00:00.000Z', gradeSourcesBefore: ['gb:_1928045_1'] });
    const col = graded({ title: 'EAP Midterm Exam', courseName: 'English for Academic Purposes', score: 20, maxScore: 20, sourceId: 'gb:_1928045_1' });
    expect(applySubmissionUpdates([mid], [col], new Date('2026-10-27T12:00:00Z').getTime())).toBe(1);
    expect(mid.scoreDisplay).toBeUndefined();
    expect(mid.score).toBe(20);
    expect(mid.gradeSourceId).toBe('gb:_1928045_1');
  });
});

describe('homework with far-future deadline automatically completed upon grade release', () => {
  it('accepts gradebook marks for homework with far deadline and automatically marks as completed', () => {
    const hw = task({
      id: 'hw_far',
      title: 'Homework 3',
      type: 'assignment',
      courseName: 'Calculus I for Engineering',
      courseCode: '1440133',
      dueDate: '2026-12-25T23:59:00.000Z',
      status: 'pending'
    });

    const markUpdate = graded({
      title: 'Homework 3',
      courseName: 'Calculus I for Engineering',
      courseCode: '1440133',
      score: 10,
      maxScore: 10,
      sourceId: 'col_hw3'
    });

    // NOW is 2026-10-22 (more than 2 months before dueDate!)
    // 1. dropImpossibleMarks must NOT wipe marks from homework with far-future deadline
    expect(dropImpossibleMarks([hw], NOW)).toBe(0);

    // 2. applySubmissionUpdates must apply the mark and automatically set status to completed
    const changed = applySubmissionUpdates([hw], [markUpdate], NOW);
    expect(changed).toBe(1);
    expect(hw.score).toBe(10);
    expect(hw.submissionStatus).toBe('graded');
    expect(hw.status).toBe('completed');
    expect(hw.gradeSourceId).toBe('col_hw3');
  });

  it('automatically sets status to completed if homework already has a grade even if student forgot to mark it done', () => {
    const hwPendingWithGrade = task({
      id: 'hw_pending_graded',
      title: 'Lab Report 4',
      type: 'assignment',
      courseName: 'Physics 1 Lab',
      courseCode: '1430116',
      dueDate: '2026-12-30T19:59:00.000Z',
      status: 'pending',
      submissionStatus: 'graded',
      score: 9.5,
      maxScore: 10,
      gradeSourceId: 'col_lab4'
    });

    // dropImpossibleMarks ensures non-exams with released grades are completed
    dropImpossibleMarks([hwPendingWithGrade], NOW);
    expect(hwPendingWithGrade.status).toBe('completed');
    expect(hwPendingWithGrade.score).toBe(9.5);
  });
});
