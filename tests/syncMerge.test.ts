import { describe, it, expect } from 'vitest';
import { pickNewerList, mergeForCloudWrite, readCloudSide } from '../src/utils/syncMerge';
import { mergeCloudTasks } from '../src/utils/taskMerge';
import { swapUniversityQuickLinks, universityQuickLinks } from '../src/core/universities';
import { DeadlineTask, QuickLink } from '../src/types';

// Made-up data only
function task(overrides: Partial<DeadlineTask> = {}): DeadlineTask {
  return {
    id: 't1',
    courseCode: 'TEST101',
    courseName: 'Test Course',
    title: 'Quiz 1',
    description: 'Quiz 1 next week',
    dueDate: '2026-11-15T09:00:00.000Z',
    hasSpecificTime: true,
    type: 'quiz',
    priority: 'high',
    status: 'pending',
    sourceSnippet: 'Quiz 1 next week',
    confidence: 1,
    extractedBy: 'local',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides
  };
}
const link = (id: string, title = id): QuickLink => ({ id, title, url: `https://example.test/${id}`, category: 'other', createdAt: '2026-10-01T00:00:00.000Z' });
const course = (id: string, name = id): any => ({ id, courseName: name, courseCode: id.toUpperCase() });

describe('pickNewerList', () => {
  it('keeps the list with the newer stamp', () => {
    const r = pickNewerList({ items: [1], updatedAt: '2026-10-02T00:00:00Z' }, { items: [2], updatedAt: '2026-10-01T00:00:00Z' }, false);
    expect(r).toMatchObject({ items: [1], fromCloud: false });
    const r2 = pickNewerList({ items: [1], updatedAt: '2026-10-01T00:00:00Z' }, { items: [2], updatedAt: '2026-10-02T00:00:00Z' }, true);
    expect(r2).toMatchObject({ items: [2], fromCloud: true });
  });

  it('on a tie an empty list never wins over a full one', () => {
    expect(pickNewerList({ items: [] }, { items: [5] }, true).items).toEqual([5]);
    expect(pickNewerList({ items: [5] }, { items: [] }, false).items).toEqual([5]);
  });

  it('on a tie the tie-break decides; a missing side loses', () => {
    expect(pickNewerList({ items: [1] }, { items: [2] }, true).items).toEqual([1]);
    expect(pickNewerList({ items: [1] }, { items: [2] }, false).items).toEqual([2]);
    expect(pickNewerList({ items: undefined }, { items: [2] }, true).items).toEqual([2]);
    expect(pickNewerList({ items: [1] }, { items: undefined }, false).items).toEqual([1]);
  });
});

describe('mergeForCloudWrite: what each device writes to Firebase', () => {
  it('keeps the other device\'s new course list when it is newer than this one', () => {
    const merged = mergeForCloudWrite(
      { courses: [course('a')], coursesUpdatedAt: '2026-10-01T00:00:00Z' },
      { courses: [course('a'), course('b')], coursesUpdatedAt: '2026-10-05T00:00:00Z' }
    );
    expect(merged.courses?.map(c => c.id)).toEqual(['a', 'b']);
    expect(merged.coursesFromCloud).toBe(true);
  });

  it('writes this device\'s course edit when it is the newer one', () => {
    const merged = mergeForCloudWrite(
      { courses: [course('a', 'Renamed')], coursesUpdatedAt: '2026-10-06T00:00:00Z' },
      { courses: [course('a')], coursesUpdatedAt: '2026-10-05T00:00:00Z' }
    );
    expect(merged.courses?.[0].courseName).toBe('Renamed');
    expect(merged.coursesUpdatedAt).toBe('2026-10-06T00:00:00Z');
    expect(merged.coursesFromCloud).toBe(false);
  });

  it('quick links: the newer list wins, so a link added on the phone is not wiped by the laptop', () => {
    const merged = mergeForCloudWrite(
      { quickLinks: [link('x')], quickLinksUpdatedAt: '2026-10-01T00:00:00Z' },
      { quickLinks: [link('x'), link('phone')], quickLinksUpdatedAt: '2026-10-03T00:00:00Z' }
    );
    expect(merged.quickLinks?.map(l => l.id)).toEqual(['x', 'phone']);
    expect(merged.quickLinksFromCloud).toBe(true);
  });

  it('a deleted quick link stays deleted when the deletion is newer', () => {
    const merged = mergeForCloudWrite(
      { quickLinks: [], quickLinksUpdatedAt: '2026-10-04T00:00:00Z' },
      { quickLinks: [link('old')], quickLinksUpdatedAt: '2026-10-03T00:00:00Z' }
    );
    expect(merged.quickLinks).toEqual([]);
  });

  it('tasks: keeps tasks only the cloud has and the newer copy of each', () => {
    const merged = mergeForCloudWrite(
      { tasks: [task({ id: 'a', notes: 'mine', userEdited: true, updatedAt: '2026-10-05T00:00:00Z' })] },
      { tasks: [task({ id: 'a', notes: 'old', updatedAt: '2026-10-02T00:00:00Z' }), task({ id: 'b', title: 'Lab Report 2', type: 'assignment', dueDate: '2026-11-20T09:00:00.000Z' })] }
    );
    expect(merged.tasks.map(t => t.id).sort()).toEqual(['a', 'b']);
    expect(merged.tasks.find(t => t.id === 'a')?.notes).toBe('mine');
  });

  it('a task deleted on another device does not come back', () => {
    const merged = mergeForCloudWrite(
      { tasks: [task({ id: 'gone' }), task({ id: 'kept', title: 'Lab 1' })] },
      { tasks: [task({ id: 'kept', title: 'Lab 1' })], tombstones: { gone: '2026-10-09T00:00:00Z' } }
    );
    expect(merged.tasks.map(t => t.id)).toEqual(['kept']);
    expect(merged.tombstones.gone).toBe('2026-10-09T00:00:00Z');
  });

  it('with an empty cloud the device\'s own data is written as is (minus its own deletions)', () => {
    const merged = mergeForCloudWrite(
      { tasks: [task({ id: 'a' }), task({ id: 'b', title: 'Lab 1' })], tombstones: { b: '2026-10-09T00:00:00Z' }, courses: [course('a')], quickLinks: [link('x')] },
      null
    );
    expect(merged.tasks.map(t => t.id)).toEqual(['a']);
    expect(merged.courses?.map(c => c.id)).toEqual(['a']);
    expect(merged.quickLinks?.map(l => l.id)).toEqual(['x']);
  });

  it('profile: the newer university choice wins', () => {
    const merged = mergeForCloudWrite(
      { profile: { universityId: 'uos', updatedAt: '2026-10-01T00:00:00Z' } },
      { profile: { universityId: 'zu', updatedAt: '2026-10-02T00:00:00Z' } }
    );
    expect(merged.profile?.universityId).toBe('zu');
  });
});

describe('readCloudSide', () => {
  it('reads the stored document and its stamps, and ignores junk', () => {
    const side = readCloudSide({
      tasks: [task({ id: 'a' })],
      quickLinks: [link('x')],
      quickLinksUpdatedAt: '2026-10-03T00:00:00Z',
      coursesUpdatedAt: 42,
      tombstones: { gone: '2026-10-09T00:00:00Z' }
    });
    expect(side.tasks?.map(t => t.id)).toEqual(['a']);
    expect(side.quickLinksUpdatedAt).toBe('2026-10-03T00:00:00Z');
    expect(side.coursesUpdatedAt).toBeUndefined();
    expect(side.tombstones).toEqual({ gone: '2026-10-09T00:00:00Z' });
    expect(readCloudSide(null)).toEqual({});
  });
});

describe('a cleared note stays cleared after sync', () => {
  it('does not fill a field the student emptied back in from an older cloud copy', () => {
    const local = task({ id: 'a', notes: '', userEdited: true, updatedAt: '2026-10-05T00:00:00Z' });
    const cloud = task({ id: 'a', notes: 'old note', updatedAt: '2026-10-02T00:00:00Z' });
    const { tasks } = mergeCloudTasks([local], [cloud]);
    expect(tasks[0].notes || '').toBe('');
  });
});

describe('quick links when the university is set', () => {
  it('a new UOS student gets the UOS links; anyone else keeps an empty list', () => {
    const toUos = swapUniversityQuickLinks([], 'other', 'uos', p => ({ ...p, createdAt: 'now' }));
    expect(toUos.map(l => l.id)).toEqual(universityQuickLinks('uos', 'now').map(l => l.id));
    expect(swapUniversityQuickLinks([], 'other', 'zu', p => ({ ...p, createdAt: 'now' }))).toEqual([]);
  });

  it('switching away from UOS keeps the student\'s own links', () => {
    const own = link('mine');
    const start = [...universityQuickLinks('uos', 'now'), own];
    const next = swapUniversityQuickLinks(start, 'uos', 'zu', p => ({ ...p, createdAt: 'now' }));
    expect(next.map(l => l.id)).toEqual(['mine']);
  });
});
