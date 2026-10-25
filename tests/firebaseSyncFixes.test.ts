import { describe, it, expect, vi, afterEach } from 'vitest';
import { sanitizeCloudTasks } from '../src/utils/cloudSanitize';
import { fetchTasksFromFirebase } from '../src/utils/firebaseSync';
import { mergeCloudTasks } from '../src/utils/taskMerge';
import { DeadlineTask } from '../src/types';

function task(overrides: Partial<DeadlineTask> = {}): DeadlineTask {
  return {
    id: 't1',
    courseCode: '',
    courseName: 'Islamic Culture',
    title: 'واجب (10 درجات)',
    description: '',
    dueDate: '2026-10-25T01:59:00.000Z',
    hasSpecificTime: true,
    type: 'assignment',
    priority: 'high',
    status: 'pending',
    sourceSnippet: 'Due Date: 10/25/26, 5:59 AM (UTC+4)',
    extractedBy: 'local',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides
  } as DeadlineTask;
}

afterEach(() => vi.restoreAllMocks());

describe('cloud task ids', () => {
  it('keeps stream tasks whose ids contain Arabic, brackets or an apostrophe', () => {
    const ids = ['stream_UOS_واجب(10درجات)_1792893540000', "stream_task_Newton's2ndLa_1791575940000"];
    expect(sanitizeCloudTasks(ids.map(id => task({ id }))).map(t => t.id)).toEqual(ids);
  });

  it('still drops ids that could break out of markup', () => {
    const bad = ['x"><img src=x>', 'a`b', 'line\nbreak', ''];
    expect(sanitizeCloudTasks(bad.map(id => task({ id })))).toHaveLength(0);
  });
});

describe('merging the cloud copy', () => {
  it('does not bring back a junk task this device already cleaned up', () => {
    const junk = task({ id: 'junk', title: 'Meeting', type: 'meeting', sourceSnippet: 'Office hours Mon 2-3 pm', description: 'Office hours Mon 2-3 pm' });
    const { tasks } = mergeCloudTasks([task()], [task(), junk]);
    expect(tasks.map(t => t.id)).toEqual(['t1']);
  });

  it('still adds real tasks that only the cloud has', () => {
    const fromPhone = task({ id: 'phone', title: 'Quiz 3', type: 'quiz', courseName: 'Physics 1 Lab', extractedBy: 'manual' });
    const { tasks, changed } = mergeCloudTasks([task()], [task(), fromPhone]);
    expect(changed).toBe(true);
    expect(tasks.map(t => t.id).sort()).toEqual(['phone', 't1']);
  });
});

describe('an empty task list in the cloud', () => {
  it('is read as empty, not as a brand-new sync key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ lastSync: '2026-10-22T10:00:00.000Z', count: 0 })));
    const res = await fetchTasksFromFirebase('BBS-ABCDEFGHIJ');
    expect(res.success).toBe(true);
    expect(res.tasks).toEqual([]);
    expect(res.lastSync).toBe('2026-10-22T10:00:00.000Z');
  });
});
