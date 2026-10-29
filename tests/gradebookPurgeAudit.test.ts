import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { purgeSyntheticGradebookTasks, isSyntheticGradebookTask } from '../src/utils/gradebook';
import { mergeCloudTasks } from '../src/utils/taskMerge';
import { mergeForCloudWrite } from '../src/utils/syncMerge';
import type { DeadlineTask } from '../src/types';

function gbTask(over: Partial<DeadlineTask> = {}): DeadlineTask {
  return {
    id: 'gbcol_x_1',
    title: 'Quiz 3',
    courseName: 'Test Course',
    courseCode: '1000',
    type: 'quiz',
    hasSpecificTime: false,
    extractedBy: 'local',
    status: 'completed',
    submissionStatus: 'graded',
    score: 9,
    maxScore: 10,
    scoreDisplay: '9 / 10',
    gradeSourceId: 'gb:_1_1',
    sourceSnippet: 'gradebook',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    dueDate: '2026-10-28T09:00:00.000Z',
    ...over
  } as DeadlineTask;
}

describe('gradebook purge audit: no hardcoded dates', () => {
  it('keeps a real gradebook item due 2026-10-28 that was created earlier', () => {
    const real = gbTask({ id: 'gbcol_real', sourceSnippet: undefined });
    expect(isSyntheticGradebookTask(real, [real])).toBe(false);
    const { cleaned, purgedIds, normalizedIds } = purgeSyntheticGradebookTasks([real]);
    expect(purgedIds).toEqual([]);
    expect(normalizedIds).toEqual([]);
    expect(cleaned[0].dueDate).toBe('2026-10-28T09:00:00.000Z');
  });

  it('is not tombstoned by mergeForCloudWrite and keeps its due date in task merge', () => {
    const real = gbTask({ id: 'gbcol_real', sourceSnippet: undefined });
    const merged = mergeForCloudWrite({ tasks: [real], tombstones: {} }, { tasks: [real], tombstones: {} });
    expect(merged.tombstones['gbcol_real']).toBeUndefined();
    expect(merged.tasks).toHaveLength(1);
    const newer = { ...real, updatedAt: '2026-10-05T08:00:00.000Z' };
    const r = mergeCloudTasks([real], [newer], {});
    expect(r.tasks[0].dueDate).toBe('2026-10-28T09:00:00.000Z');
  });

  it('still purges a completed gbcol task due the day it was created (generic rule), any date', () => {
    const fake = gbTask({ id: 'gbcol_fake', sourceSnippet: undefined, createdAt: '2027-03-04T08:00:00.000Z', dueDate: '2027-03-04T09:00:00.000Z' });
    expect(isSyntheticGradebookTask(fake, [fake])).toBe(true);
    expect(purgeSyntheticGradebookTasks([fake]).purgedIds).toEqual(['gbcol_fake']);
  });
});

describe('gradebook purge audit: purity and normalization', () => {
  it('isSyntheticGradebookTask does not mutate its input', () => {
    const t = gbTask({ createdAt: '2026-10-28T08:00:00.000Z', hasSpecificTime: true });
    const before = JSON.stringify(t);
    expect(isSyntheticGradebookTask(t, [t])).toBe(false);
    expect(JSON.stringify(t)).toBe(before);
  });

  it('purge returns new normalized objects, bumps updatedAt once, and leaves the input alone', () => {
    const t = gbTask({ createdAt: '2026-10-28T08:00:00.000Z', hasSpecificTime: true });
    const input = [t];
    const before = JSON.stringify(input);
    const first = purgeSyntheticGradebookTasks(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(first.purgedIds).toEqual([]);
    expect(first.normalizedIds).toEqual([t.id]);
    expect(first.cleaned[0]).not.toBe(t);
    expect(first.cleaned[0].dueDate).toBe('');
    expect(first.cleaned[0].hasSpecificTime).toBe(false);
    expect(first.cleaned[0].score).toBe(9);
    expect(new Date(first.cleaned[0].updatedAt!).getTime()).toBeGreaterThan(new Date(t.updatedAt!).getTime());

    // A second pass has nothing to do and returns the same array
    const second = purgeSyntheticGradebookTasks(first.cleaned);
    expect(second.normalizedIds).toEqual([]);
    expect(second.cleaned).toBe(first.cleaned);
  });

  it('the normalized task wins over the older cloud copy in the next merge', () => {
    const cloudCopy = gbTask({ createdAt: '2026-10-28T08:00:00.000Z' });
    const { cleaned } = purgeSyntheticGradebookTasks([cloudCopy]);
    const merged = mergeCloudTasks(cleaned, [cloudCopy], {});
    expect(merged.tasks[0].dueDate).toBe('');
  });

  it('mark transfer does not mutate the real task object passed in', () => {
    const real = { id: 'ann_mid', title: 'Midterm', courseName: 'English for Academic Purposes', courseCode: '0202 112', type: 'exam', status: 'pending', dueDate: '2026-10-26T17:00:00.000Z' } as DeadlineTask;
    const fake = gbTask({
      id: 'gbcol_mid', title: 'EAP Midterm Exam', type: 'exam', courseName: 'English for Academic Purposes', courseCode: '0202 112',
      sourceSnippet: undefined, score: 20, maxScore: 20, scoreDisplay: '20 / 20', createdAt: '2026-10-28T08:00:00.000Z'
    });
    const { cleaned, purgedIds } = purgeSyntheticGradebookTasks([real, fake]);
    expect(purgedIds).toEqual(['gbcol_mid']);
    expect(real.score).toBeUndefined();
    expect(cleaned[0].score).toBe(20);
  });
});

describe('saveTasksMergingLatest records tombstones for purged tasks', () => {
  const originalChrome = (globalThis as any).chrome;
  let store: Record<string, any>;

  beforeEach(() => {
    store = { bbs_tombstones: { old_id: '2026-09-01T00:00:00.000Z' } };
    (globalThis as any).chrome = {
      runtime: { id: 'test-id', sendMessage: vi.fn() },
      storage: {
        local: {
          get: (keys: any, cb?: (r: any) => void) => {
            const out: Record<string, any> = {};
            for (const k of Array.isArray(keys) ? keys : [keys]) if (k in store) out[k] = store[k];
            if (cb) { cb(out); return undefined; }
            return Promise.resolve(out);
          },
          set: (items: Record<string, any>, cb?: () => void) => {
            Object.assign(store, items);
            if (cb) { cb(); return undefined; }
            return Promise.resolve();
          }
        }
      }
    };
  });

  afterEach(() => {
    (globalThis as any).chrome = originalChrome;
  });

  it('tombstones purged ids and keeps existing tombstones', async () => {
    const { saveTasksMergingLatest } = await import('../src/utils/storage');
    const fake = gbTask({ id: 'gbcol_fake', sourceSnippet: undefined, createdAt: '2026-10-28T08:00:00.000Z' });
    const keep = gbTask({ id: 'ann_keep', sourceSnippet: undefined, dueDate: '2026-11-02T09:00:00.000Z', status: 'pending' });
    const saved = await saveTasksMergingLatest([fake, keep]);
    expect(saved.map(t => t.id)).toEqual(['ann_keep']);
    expect(store.bbs_tombstones.gbcol_fake).toBeTruthy();
    expect(store.bbs_tombstones.old_id).toBe('2026-09-01T00:00:00.000Z');
    expect(store.bbs_tombstones.ann_keep).toBeUndefined();
  });

  it('writes no tombstones when nothing was purged', async () => {
    const { saveTasksMergingLatest } = await import('../src/utils/storage');
    const keep = gbTask({ id: 'ann_keep', sourceSnippet: undefined, dueDate: '2026-11-02T09:00:00.000Z', status: 'pending' });
    await saveTasksMergingLatest([keep]);
    expect(Object.keys(store.bbs_tombstones)).toEqual(['old_id']);
  });
});
