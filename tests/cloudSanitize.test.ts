import { describe, it, expect } from 'vitest';
import { sanitizeCloudTasks, pruneExpiredTombstones } from '../src/utils/cloudSanitize';
import type { DeadlineTask } from '../src/types';

describe('sanitizeCloudTasks Gradebook & Empty Due Date Support', () => {
  const makeTask = (overrides: Partial<DeadlineTask> = {}): any => ({
    id: 'task_default',
    title: 'Assignment 1',
    courseName: 'Calculus I for Engineering',
    courseCode: '1440133',
    dueDate: '2026-10-30T10:00:00.000Z',
    hasSpecificTime: true,
    type: 'assignment',
    status: 'pending',
    priority: 'medium',
    ...overrides
  });

  it('retains gradebook tasks with empty dueDate when sourceSnippet is "gradebook"', () => {
    const raw = [
      makeTask({
        id: 'gbcol_1',
        title: 'Quiz 1 Grade',
        dueDate: '',
        sourceSnippet: 'gradebook',
        submissionStatus: 'graded',
        status: 'completed',
        score: 9.5,
        maxScore: 10
      })
    ];
    const sanitized = sanitizeCloudTasks(raw);
    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].id).toBe('gbcol_1');
    expect(sanitized[0].dueDate).toBe('');
    expect(sanitized[0].score).toBe(9.5);
    expect(sanitized[0].maxScore).toBe(10);
    expect(sanitized[0].submissionStatus).toBe('graded');
  });

  it('retains gradebook tasks with empty dueDate when submissionStatus is "graded"', () => {
    const raw = [
      makeTask({
        id: 'grade_mark_2',
        title: 'Midterm Exam',
        dueDate: '',
        submissionStatus: 'graded',
        status: 'completed',
        score: 24,
        maxScore: 25
      })
    ];
    const sanitized = sanitizeCloudTasks(raw);
    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].id).toBe('grade_mark_2');
    expect(sanitized[0].dueDate).toBe('');
    expect(sanitized[0].score).toBe(24);
  });

  it('retains gradebook tasks with empty dueDate when gradeSourceId is present', () => {
    const raw = [
      makeTask({
        id: 'task_col_3',
        title: 'Participation',
        dueDate: '',
        gradeSourceId: 'gb:_1902479_1',
        status: 'completed',
        score: 10,
        maxScore: 10
      })
    ];
    const sanitized = sanitizeCloudTasks(raw);
    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].id).toBe('task_col_3');
    expect(sanitized[0].dueDate).toBe('');
  });

  it('retains gradebook tasks with empty dueDate when id starts with "gbcol_"', () => {
    const raw = [
      makeTask({
        id: 'gbcol_0202112_colX',
        title: 'Graded Item',
        dueDate: '',
        status: 'completed'
      })
    ];
    const sanitized = sanitizeCloudTasks(raw);
    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].id).toBe('gbcol_0202112_colX');
    expect(sanitized[0].dueDate).toBe('');
  });

  it('drops standard non-gradebook tasks with empty or invalid dueDate', () => {
    const raw = [
      makeTask({ id: 'bad_1', title: 'Normal task missing date', dueDate: '' }),
      makeTask({ id: 'bad_2', title: 'Normal task invalid date', dueDate: 'not-a-real-date' })
    ];
    const sanitized = sanitizeCloudTasks(raw);
    expect(sanitized).toHaveLength(0);
  });

  it('correctly coerces scores and strips notes from unedited gradebook tasks', () => {
    const raw = [
      makeTask({
        id: 'gbcol_notes',
        title: 'HW 1',
        dueDate: '',
        sourceSnippet: 'gradebook',
        submissionStatus: 'graded',
        score: '18.5' as any,
        maxScore: '20' as any,
        notes: 'scanned note should be stripped',
        userEdited: false,
        extractedBy: 'local'
      })
    ];
    const sanitized = sanitizeCloudTasks(raw);
    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].score).toBe(18.5);
    expect(sanitized[0].maxScore).toBe(20);
    expect(sanitized[0].notes).toBeUndefined();
  });

  it('prunes tombstones older than the maxAge cutoff while keeping recent ones', () => {
    const now = new Date('2026-11-03T12:00:00Z').getTime();
    const tombstones = {
      recent_1: new Date('2026-11-01T12:00:00Z').toISOString(), // 2 days old
      recent_2: new Date('2026-10-15T12:00:00Z').toISOString(), // ~19 days old
      expired_1: new Date('2026-08-01T12:00:00Z').toISOString(), // ~94 days old (expired)
      expired_2: new Date('2026-05-01T12:00:00Z').toISOString()  // ~6 months old (expired)
    };

    const pruned = pruneExpiredTombstones(tombstones, 60, now);
    expect(Object.keys(pruned)).toEqual(['recent_1', 'recent_2']);
    expect(pruned.expired_1).toBeUndefined();
    expect(pruned.expired_2).toBeUndefined();
  });

  it('handles empty or malformed tombstones safely', () => {
    expect(pruneExpiredTombstones(null as any)).toEqual({});
    expect(pruneExpiredTombstones(undefined as any)).toEqual({});
    expect(pruneExpiredTombstones({ bad_date: 'invalid-date-string' })).toEqual({});
  });
});
