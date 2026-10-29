import { describe, it, expect } from 'vitest';
import {
  mergeCloudTasks,
  mergeTombstones,
  getTaskSeriesInfo,
  areTasksDuplicates,
  deduplicateTaskList
} from '../src/utils/taskMerge';
import { DeadlineTask } from '../src/types';

function makeTask(overrides: Partial<DeadlineTask> = {}): DeadlineTask {
  return {
    id: 't1',
    courseCode: '1440133',
    courseName: 'Calculus I for Engineering',
    title: 'Quiz 1',
    description: 'Dr announced',
    dueDate: '2026-10-15T12:30:00.000Z',
    hasSpecificTime: true,
    type: 'quiz',
    priority: 'high',
    status: 'pending',
    sourceSnippet: 'Dr announced',
    confidence: 1,
    extractedBy: 'local',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides
  };
}

describe('mergeCloudTasks', () => {
  it('keeps a locally-newer edit instead of reverting it to stale cloud values', () => {
    const local = makeTask({ room: 'A8-200', notes: 'bring calculator', userEdited: true, updatedAt: '2026-10-05T10:00:00.000Z' });
    const cloud = makeTask({ room: 'A8-103', notes: 'old note', userEdited: true, updatedAt: '2026-10-02T10:00:00.000Z' });
    const { tasks, changed } = mergeCloudTasks([local], [cloud]);
    expect(changed).toBe(false);
    expect(tasks[0].room).toBe('A8-200');
    expect(tasks[0].notes).toBe('bring calculator');
  });

  it('adopts a cloud-newer edit including fields the phone cleared', () => {
    const local = makeTask({ room: 'A8-103', notes: 'old note' });
    const cloud = makeTask({ notes: '', updatedAt: '2026-10-05T10:00:00.000Z', title: 'Quiz 1 (moved)' });
    const { tasks, changed } = mergeCloudTasks([local], [cloud]);
    expect(changed).toBe(true);
    expect(tasks[0].title).toBe('Quiz 1 (moved)');
    expect(tasks[0].room).toBeUndefined();
    expect(tasks[0].notes).toBe('');
  });

  it('fills gaps on a locally-newer task without overriding existing values', () => {
    const local = makeTask({ updatedAt: '2026-10-05T10:00:00.000Z' });
    const cloud = makeTask({ room: 'A8-103', updatedAt: '2026-10-02T10:00:00.000Z' });
    const { tasks } = mergeCloudTasks([local], [cloud]);
    expect(tasks[0].room).toBe('A8-103');
  });

  it('adds cloud-only tasks', () => {
    const { tasks, changed } = mergeCloudTasks([], [makeTask({ id: 'new' })]);
    expect(changed).toBe(true);
    expect(tasks.map(t => t.id)).toEqual(['new']);
  });

  it('removes tasks deleted on the other device and does not resurrect them', () => {
    const task = makeTask();
    const tombstones = { t1: '2026-10-03T00:00:00.000Z' };
    const { tasks, changed } = mergeCloudTasks([task], [task], tombstones);
    expect(changed).toBe(true);
    expect(tasks).toHaveLength(0);
  });

  it('does not resurrect a task deleted locally when the cloud copy is still old', () => {
    const cloud = makeTask();
    const { tasks } = mergeCloudTasks([], [cloud], { t1: '2026-10-03T00:00:00.000Z' });
    expect(tasks).toHaveLength(0);
  });

  it('keeps a task that was edited after its tombstone (undo restore)', () => {
    const restored = makeTask({ updatedAt: '2026-10-04T00:00:00.000Z' });
    const { tasks } = mergeCloudTasks([restored], [], { t1: '2026-10-03T00:00:00.000Z' });
    expect(tasks).toHaveLength(1);
  });

  it('sorts merged tasks by due date', () => {
    const a = makeTask({ id: 'a', dueDate: '2026-10-20T00:00:00.000Z' });
    const b = makeTask({ id: 'b', dueDate: '2026-10-10T00:00:00.000Z' });
    const { tasks } = mergeCloudTasks([a], [b]);
    expect(tasks.map(t => t.id)).toEqual(['b', 'a']);
  });
});

describe('mergeTombstones', () => {
  it('keeps the later deletion time per id', () => {
    const merged = mergeTombstones(
      { a: '2026-10-01T00:00:00.000Z', b: '2026-10-05T00:00:00.000Z' },
      { a: '2026-10-02T00:00:00.000Z', b: '2026-10-04T00:00:00.000Z', c: '2026-10-03T00:00:00.000Z' }
    );
    expect(merged).toEqual({
      a: '2026-10-02T00:00:00.000Z',
      b: '2026-10-05T00:00:00.000Z',
      c: '2026-10-03T00:00:00.000Z'
    });
  });
});

describe('getTaskSeriesInfo', () => {
  it('returns null when only 1 quiz exists for a subject', () => {
    const q1 = makeTask({ id: 'q1', courseName: 'Physics 1', title: 'Quiz 1', dueDate: '2026-09-21T10:00:00.000Z', type: 'quiz' });
    expect(getTaskSeriesInfo(q1, [q1])).toBeNull();
  });

  it('labels 1 of 2 and 2 of 2 when a second quiz is added on the same subject', () => {
    const q1 = makeTask({ id: 'q1', courseName: 'Physics 1', title: 'Quiz 1', dueDate: '2026-09-21T10:00:00.000Z', type: 'quiz', status: 'completed' });
    const q2 = makeTask({ id: 'q2', courseName: 'Physics 1', title: 'Quiz 2', dueDate: '2026-10-05T07:00:00.000Z', type: 'quiz', status: 'pending' });
    const all = [q1, q2];

    const series1 = getTaskSeriesInfo(q1, all);
    const series2 = getTaskSeriesInfo(q2, all);

    expect(series1).toEqual({ index: 1, total: 2, label: '1 of 2' });
    expect(series2).toEqual({ index: 2, total: 2, label: '2 of 2' });
  });

  it('updates to 1 of 3, 2 of 3, 3 of 3 when a third quiz is added', () => {
    const q1 = makeTask({ id: 'q1', courseName: 'Introduction to Computer Eng.', title: 'Quiz 1', dueDate: '2026-09-10T07:00:00.000Z', type: 'quiz' });
    const q2 = makeTask({ id: 'q2', courseName: 'Introduction to Computer Eng.', title: 'Review Quiz 1', dueDate: '2026-09-15T07:00:00.000Z', type: 'quiz' });
    const q3 = makeTask({ id: 'q3', courseName: 'Introduction to Computer Eng.', title: 'Quiz 2', dueDate: '2026-09-29T07:00:00.000Z', type: 'quiz' });
    const all = [q1, q2, q3];

    expect(getTaskSeriesInfo(q1, all)?.label).toBe('1 of 3');
    expect(getTaskSeriesInfo(q2, all)?.label).toBe('2 of 3');
    expect(getTaskSeriesInfo(q3, all)?.label).toBe('3 of 3');
  });

  it('does not cross-contaminate series between different subjects', () => {
    const physQuiz = makeTask({ id: 'pq', courseName: 'Physics 1', title: 'Quiz 1', dueDate: '2026-09-21T10:00:00.000Z', type: 'quiz' });
    const calcQuiz = makeTask({ id: 'cq', courseName: 'Calculus I for Engineering', title: 'Quiz 1', dueDate: '2026-09-17T08:30:00.000Z', type: 'quiz' });
    const all = [physQuiz, calcQuiz];

    expect(getTaskSeriesInfo(physQuiz, all)).toBeNull();
    expect(getTaskSeriesInfo(calcQuiz, all)).toBeNull();
  });

  it('does not mix different assessment types (e.g. Midterm exam vs Quizzes)', () => {
    const quiz1 = makeTask({ id: 'q1', courseName: 'Calculus I for Engineering', title: 'Quiz 1', dueDate: '2026-09-17T08:30:00.000Z', type: 'quiz' });
    const midterm = makeTask({ id: 'm1', courseName: 'Calculus I for Engineering', title: 'Midterm', dueDate: '2026-10-10T10:30:00.000Z', type: 'exam' });
    const all = [quiz1, midterm];

    expect(getTaskSeriesInfo(quiz1, all)).toBeNull();
    expect(getTaskSeriesInfo(midterm, all)).toBeNull();
  });
});

describe('areTasksDuplicates & deduplicateTaskList', () => {
  it('detects duplicate stream items with generic Assignment title vs specific lab report', () => {
    const genericStream = makeTask({
      id: 'stream_UOS_Assignment_1789156740000',
      title: 'Assignment',
      courseName: "Measuring Density, Student's Lab. ReportDue date: 9/11/26, 11:59 PM (UTC+4)New Group 7",
      dueDate: '2026-09-11T19:59:00.000Z',
      type: 'assignment'
    });
    const specificLab = makeTask({
      id: 'stream_1430116_MeasuringDensi_1789156740000',
      title: 'Measuring Density - Lab Report',
      courseName: 'Physics 1 Lab',
      dueDate: '2026-09-11T19:59:00.000Z',
      type: 'assignment'
    });

    expect(areTasksDuplicates(genericStream, specificLab)).toBe(true);

    const deduped = deduplicateTaskList([genericStream, specificLab]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].title).toBe('Measuring Density - Lab Report');
    expect(deduped[0].courseName).toBe('Physics 1 Lab');
  });

  it('does not treat distinct quizzes on different dates as duplicates', () => {
    const q1 = makeTask({ id: 'q1', courseName: 'Physics 1', title: 'Quiz 1', dueDate: '2026-09-21T10:00:00.000Z' });
    const q2 = makeTask({ id: 'q2', courseName: 'Physics 1', title: 'Quiz 2', dueDate: '2026-10-05T07:00:00.000Z' });

    expect(areTasksDuplicates(q1, q2)).toBe(false);
    expect(deduplicateTaskList([q1, q2])).toHaveLength(2);
  });

  it('merges "3rd quiz" and "Quiz 3" in Physics 1 Lab into a single task preserving score', () => {
    const announcementQuiz = makeTask({
      id: 'ann_phy1lab_quiz3',
      courseName: 'Physics 1 Lab',
      courseCode: '1430116',
      title: '3rd quiz',
      type: 'quiz',
      status: 'completed',
      submissionStatus: 'graded',
      score: 8.5,
      maxScore: 10,
      scoreDisplay: '8.5 / 10 (85%)',
      room: 'Central Lab Men - 105',
      dueDate: '2026-10-28T14:00:00.000Z',
      description: "Dear Students, This is to inform you that the 3rd Quiz will be held next week and will cover the following experiments: Projectile Motion, Newton's 2nd Law, Best Regards"
    });

    const streamQuiz = makeTask({
      id: 'stream_1430116_Quiz3_1793215200000',
      courseName: 'Physics 1 Lab',
      courseCode: '1430116',
      title: 'Quiz 3',
      type: 'assignment',
      status: 'completed',
      submissionStatus: 'submitted',
      room: 'Central Lab Men - 105',
      dueDate: '2026-10-28T14:00:00.000Z'
    });

    expect(areTasksDuplicates(announcementQuiz, streamQuiz)).toBe(true);

    const merged = deduplicateTaskList([announcementQuiz, streamQuiz]);
    expect(merged).toHaveLength(1);
    expect(merged[0].submissionStatus).toBe('graded');
    expect(merged[0].score).toBe(8.5);
    expect(merged[0].maxScore).toBe(10);
    expect(merged[0].status).toBe('completed');
  });
});

describe('deduplicateTaskList and mergeCloudTasks with empty due dates', () => {
  it('deduplicateTaskList processes tasks with empty dueDate without throwing RangeError', () => {
    const t1 = makeTask({
      id: 'gbcol_1',
      title: 'In-Class Quiz 1',
      courseCode: '1440133',
      courseName: 'Calculus I for Engineering',
      dueDate: '',
      sourceSnippet: 'gradebook',
      submissionStatus: 'graded',
      score: 10
    });
    const t2 = makeTask({
      id: 'gbcol_2',
      title: 'In-Class Quiz 2',
      courseCode: '1440133',
      courseName: 'Calculus I for Engineering',
      dueDate: '',
      sourceSnippet: 'gradebook',
      submissionStatus: 'graded',
      score: 9
    });

    expect(() => {
      const result = deduplicateTaskList([t1, t2]);
      expect(result).toHaveLength(2);
      expect(result.map(t => t.id).sort()).toEqual(['gbcol_1', 'gbcol_2']);
    }).not.toThrow();
  });

  it('deduplicateTaskList correctly merges identical gradebook tasks with empty dueDate', () => {
    const existing = makeTask({
      id: 'gbcol_math_q1',
      title: 'Quiz 1 Grade',
      courseCode: '1440133',
      dueDate: '',
      sourceSnippet: 'gradebook',
      submissionStatus: 'graded',
      score: 10,
      maxScore: 10
    });
    const incoming = makeTask({
      id: 'gbcol_math_q1',
      title: 'Quiz 1 Grade',
      courseCode: '1440133',
      dueDate: '',
      sourceSnippet: 'gradebook',
      submissionStatus: 'graded',
      score: 10,
      maxScore: 10
    });

    const result = deduplicateTaskList([existing, incoming]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('gbcol_math_q1');
    expect(result[0].score).toBe(10);
  });

  it('mergeCloudTasks sorts empty dueDate tasks stably to the end without NaN comparison error', () => {
    const dated1 = makeTask({ id: 't_early', dueDate: '2026-10-10T10:00:00.000Z', title: 'Early Task' });
    const dated2 = makeTask({ id: 't_late', dueDate: '2026-10-25T10:00:00.000Z', title: 'Late Task' });
    const undatedA = makeTask({ id: 't_undated_a', dueDate: '', title: 'Alpha Undated', sourceSnippet: 'gradebook', submissionStatus: 'graded' });
    const undatedB = makeTask({ id: 't_undated_b', dueDate: '', title: 'Beta Undated', sourceSnippet: 'gradebook', submissionStatus: 'graded' });

    const { tasks } = mergeCloudTasks([dated2, undatedB], [dated1, undatedA]);
    expect(tasks).toHaveLength(4);
    // Dated tasks should come first chronologically
    expect(tasks[0].id).toBe('t_early');
    expect(tasks[1].id).toBe('t_late');
    // Undated tasks should be sorted predictably at the end
    expect(tasks.slice(2).map(t => t.id)).toEqual(['t_undated_a', 't_undated_b']);
  });

  it('mergeCloudTasks preserves local unannounced gradebook marks during cloud merge', () => {
    const localGradebook = makeTask({
      id: 'gbcol_part',
      title: 'Participation',
      courseCode: '0401201',
      dueDate: '',
      sourceSnippet: 'gradebook',
      submissionStatus: 'graded',
      score: 10,
      maxScore: 10,
      updatedAt: '2026-10-29T10:00:00.000Z'
    });
    const cloudTask = makeTask({
      id: 'cloud_exam',
      title: 'Final Exam',
      dueDate: '2026-12-15T09:00:00.000Z',
      updatedAt: '2026-10-20T10:00:00.000Z'
    });

    const { tasks } = mergeCloudTasks([localGradebook], [cloudTask]);
    expect(tasks.find(t => t.id === 'gbcol_part')).toBeDefined();
    expect(tasks.find(t => t.id === 'gbcol_part')?.score).toBe(10);
    expect(tasks.find(t => t.id === 'cloud_exam')).toBeDefined();
  });
});

