import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTasksFromFirebase } from '../src/utils/firebaseSync';
import {
  applyBackupAuthoritatively,
  applyCloudSnapshotAuthoritatively,
  getLocalBackupEpoch,
  isCloudBackupEpochNewer,
} from '../src/utils/backupRestore';
import { getProfile } from '../src/utils/profile';
import { getStoredPayments } from '../src/utils/paymentsStorage';
import { getStoredSemesters } from '../src/utils/semestersStorage';
import { getQuickLinks, getSettings, getTasks, getUserCourses, saveQuickLinks, saveSettings, saveStoredPayments, saveStoredSemesters, saveTasks, saveUserCourses } from '../src/utils/storage';
import { getStorageTombstones, setStorageTombstones } from '../src/utils/tombstones';
import { saveProfile } from '../src/utils/profile';
import { unwrapCloudVault, wrapCloudVault } from '../src/utils/vaultCrypto';

function installTestStorage() {
  const chromeStore: Record<string, any> = {};
  const lsStore = new Map<string, string>();
  const chromeMock = {
    runtime: { id: 'test-ext-id' },
    storage: {
      local: {
        get: (keys: string | string[], cb?: (res: Record<string, any>) => void) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, any> = {};
          for (const k of list) {
            if (k in chromeStore) out[k] = chromeStore[k];
          }
          if (typeof cb === 'function') {
            cb(out);
            return undefined;
          }
          return Promise.resolve(out);
        },
        set: (obj: Record<string, any>, cb?: () => void) => {
          Object.assign(chromeStore, obj);
          if (typeof cb === 'function') {
            cb();
            return undefined;
          }
          return Promise.resolve();
        },
        remove: (keys: string | string[], cb?: () => void) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete chromeStore[k];
          if (typeof cb === 'function') {
            cb();
            return undefined;
          }
          return Promise.resolve();
        }
      }
    }
  };
  const localStorageMock = {
    getItem: (k: string) => (lsStore.has(k) ? lsStore.get(k)! : null),
    setItem: (k: string, v: string) => { lsStore.set(k, String(v)); },
    removeItem: (k: string) => { lsStore.delete(k); },
    clear: () => { lsStore.clear(); }
  };
  vi.stubGlobal('chrome', chromeMock);
  vi.stubGlobal('localStorage', localStorageMock);
  return { chromeStore, lsStore };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Authoritative Sync Key switching & JSON Restore', () => {
  const OLD_KEY = 'BBS-OLDKEY88';
  const CLOUD_KEY = 'BBS-RESTORE9';

  it('Use Existing Key unconditionally takes Firebase data regardless of newer local data and NEVER writes to Firebase', async () => {
    installTestStorage();

    // Pre-populate dirty local extension state with NEWER timestamps than Firebase
    const futureTs = '2026-12-30T12:00:00.000Z';
    await saveTasks([
      {
        id: 'local_dirty_task',
        courseCode: '9999100',
        courseName: 'Local Junk Course',
        title: 'Local Dirty Task',
        description: '',
        dueDate: '2026-12-01T10:00:00.000Z',
        hasSpecificTime: false,
        type: 'quiz',
        priority: 'high',
        status: 'pending',
        sourceSnippet: '',
        confidence: 1,
        extractedBy: 'manual',
        createdAt: futureTs,
        updatedAt: futureTs
      }
    ]);
    await saveUserCourses([{
      id: 'local_course',
      courseCode: '9999100',
      courseName: 'Local Junk Course',
      colorHex: '#ef4444',
      aliases: [],
      scheduleSlots: [],
      syllabus: []
    }], futureTs);
    await saveQuickLinks([{ id: 'local_link', title: 'Local Link', url: 'https://example.com', category: 'other', createdAt: futureTs }], futureTs);
    await saveStoredPayments([{ id: 'local_pay', title: 'Local Fee', amount: 500, currency: 'AED', dueDate: '2026-12-05', status: 'pending', category: 'tuition', source: 'manual', updatedAt: futureTs }], futureTs);
    await saveStoredSemesters([{ id: 'local_sem', name: 'Spring 2027', archivedAt: futureTs, gradedCredits: 3, totalCredits: 3, courses: [] }], futureTs);
    await saveProfile({ universityId: 'other', studentName: 'Wrong Student', updatedAt: futureTs });
    await setStorageTombstones({ cloud_task_1: futureTs });
    await saveSettings({ syncKey: 'BBS-TEMPCWS1' });

    const cloudTs = '2026-10-10T08:00:00.000Z';
    const firebaseDoc = await wrapCloudVault({
      tasks: [{
        id: 'cloud_task_1',
        courseCode: '1502101',
        courseName: 'Intro to CS',
        title: 'Midterm Exam',
        description: '',
        dueDate: '2026-10-20T09:00:00.000Z',
        hasSpecificTime: true,
        type: 'exam',
        priority: 'high',
        status: 'pending',
        sourceSnippet: '',
        confidence: 1,
        extractedBy: 'local',
        createdAt: cloudTs,
        updatedAt: cloudTs
      }],
      courses: [{
        id: 'c_cs',
        courseCode: '1502101',
        courseName: 'Intro to CS',
        colorHex: '#2563eb',
        aliases: [],
        scheduleSlots: [],
        syllabus: []
      }],
      coursesUpdatedAt: cloudTs,
      quickLinks: [{ id: 'ql_uos', title: 'Blackboard', url: 'https://elearning.sharjah.ac.ae', category: 'portal', createdAt: cloudTs }],
      quickLinksUpdatedAt: cloudTs,
      payments: [{ id: 'pay_uos', title: 'Installment 1', amount: 12000, currency: 'AED', dueDate: '2026-10-25', status: 'paid', category: 'tuition', source: 'manual', updatedAt: cloudTs }],
      paymentsUpdatedAt: cloudTs,
      semesters: [{ id: 'sem_fall25', name: 'Fall 2025', archivedAt: cloudTs, gradedCredits: 15, totalCredits: 15, termGpa: 3.8, courses: [] }],
      semestersUpdatedAt: cloudTs,
      profile: { universityId: 'uos', studentName: 'Yassin Real', updatedAt: cloudTs },
      tombstones: { deleted_elsewhere: cloudTs },
      lastSync: cloudTs
    }, OLD_KEY);

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method && init.method !== 'GET') {
        throw new Error(`Unexpected Firebase write (${init.method}) during Use Existing Key!`);
      }
      return {
        ok: true,
        status: 200,
        json: async () => firebaseDoc
      } as any;
    });
    vi.stubGlobal('fetch', fetchMock);

    // Fetch raw without local timestamp merging, apply authoritatively, then switch key
    const snap = await fetchTasksFromFirebase(OLD_KEY, { skipLocalMerge: true });
    expect(snap.success).toBe(true);
    await applyCloudSnapshotAuthoritatively(snap);
    await saveSettings({ syncKey: OLD_KEY });

    // ZERO PUT/POST writes to Firebase
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();

    // Every single local store now matches Firebase 100% — zero dirty local leftovers
    const tasks = await getTasks();
    expect(tasks.map(t => t.id)).toEqual(['cloud_task_1']);
    expect((await getUserCourses()).map(c => c.id)).toEqual(['c_cs']);
    expect((await getQuickLinks()).map(q => q.id)).toEqual(['ql_uos']);
    expect((await getStoredPayments()).map(p => p.id)).toEqual(['pay_uos']);
    expect((await getStoredSemesters()).map(s => s.id)).toEqual(['sem_fall25']);
    expect((await getProfile())?.studentName).toBe('Yassin Real');
    expect(await getStorageTombstones()).toEqual({ deleted_elsewhere: cloudTs });
    expect((await getSettings()).syncKey).toBe(OLD_KEY);
  });

  it('Restore JSON completely overrides both stale local data AND existing Firebase vault under the Sync Key', async () => {
    installTestStorage();

    // Stale local state before restoring JSON
    await saveSettings({ syncKey: CLOUD_KEY });
    await saveTasks([{
      id: 'stale_local_task',
      courseCode: '0000',
      courseName: 'Stale Local',
      title: 'Old Local Task',
      description: '',
      dueDate: '2026-11-11T10:00:00.000Z',
      hasSpecificTime: false,
      type: 'other',
      priority: 'low',
      status: 'pending',
      sourceSnippet: '',
      confidence: 1,
      extractedBy: 'local',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-30T00:00:00.000Z'
    }]);
    await setStorageTombstones({ json_task_1: '2026-11-30T00:00:00.000Z' });

    // Existing corrupted/mixed Firebase vault under CLOUD_KEY
    const corruptedCloudDoc = await wrapCloudVault({
      tasks: [{
        id: 'corrupted_cloud_task',
        courseCode: '9999',
        courseName: 'Mixed Course',
        title: 'Poisoned Firebase Task',
        description: '',
        dueDate: '2026-12-15T10:00:00.000Z',
        hasSpecificTime: false,
        type: 'exam',
        priority: 'high',
        status: 'pending',
        sourceSnippet: '',
        confidence: 1,
        extractedBy: 'local',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-12-20T00:00:00.000Z'
      }],
      courses: [{ id: 'bad_cloud_course', courseCode: '9999', courseName: 'Mixed Course', colorHex: '#000', aliases: [], scheduleSlots: [], syllabus: [] }],
      coursesUpdatedAt: '2026-12-20T00:00:00.000Z',
      scanRequest: { requestedAt: '2026-11-21T10:00:00.000Z', state: 'done', message: 'ok' },
      lastSync: '2026-12-20T00:00:00.000Z'
    }, CLOUD_KEY);

    let capturedPutBody: any = null;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        capturedPutBody = JSON.parse(String(init.body || 'null'));
        return { ok: true, status: 200, json: async () => capturedPutBody } as any;
      }
      return { ok: true, status: 200, json: async () => corruptedCloudDoc } as any;
    });
    vi.stubGlobal('fetch', fetchMock);

    const backupJson = {
      version: '1.8.36',
      tasks: [{
        id: 'json_task_1',
        courseCode: '1440133',
        courseName: 'Calculus I for Engineering',
        title: 'Final Exam',
        description: '',
        dueDate: '2026-12-10T09:00:00.000Z',
        hasSpecificTime: true,
        type: 'exam',
        priority: 'high',
        status: 'pending',
        sourceSnippet: '',
        confidence: 1,
        extractedBy: 'manual',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z'
      }],
      courses: [{
        id: 'calc1',
        courseCode: '1440133',
        courseName: 'Calculus I for Engineering',
        colorHex: '#2563eb',
        aliases: [],
        scheduleSlots: [],
        syllabus: []
      }],
      quickLinks: [{ id: 'ql_1', title: 'Portal', url: 'https://uos.ac.ae', category: 'other', createdAt: '2026-10-01T00:00:00.000Z' }],
      payments: [{ id: 'pay_json', title: 'Tuition Balance', amount: 2500, currency: 'AED', dueDate: '2026-12-01', status: 'pending', category: 'tuition', source: 'manual', updatedAt: '2026-10-01T00:00:00.000Z' }],
      semesters: [{ id: 'sem_1', name: 'Spring 2026', archivedAt: '2026-06-01T00:00:00.000Z', gradedCredits: 18, totalCredits: 18, termGpa: 3.9, courses: [] }],
      tombstones: { old_deleted: '2026-10-01T00:00:00.000Z' },
      profile: { universityId: 'uos', studentName: 'Backup Owner', updatedAt: '2026-10-01T00:00:00.000Z' },
      settings: { syncKey: CLOUD_KEY, badgeNotification: false }
    };

    const outcome = await applyBackupAuthoritatively(backupJson, { activeSyncKey: CLOUD_KEY });
    expect(outcome.cloudResult?.success).toBe(true);
    expect(capturedPutBody).toBeTruthy();

    // Unwrap the encrypted Firebase payload actually written via PUT
    const writtenPlain = await unwrapCloudVault(capturedPutBody, CLOUD_KEY);
    expect(writtenPlain).toBeTruthy();
    expect((writtenPlain as any).tasks.map((t: any) => t.id)).toEqual(['json_task_1']);
    expect((writtenPlain as any).courses.map((c: any) => c.id)).toEqual(['calc1']);
    expect((writtenPlain as any).payments.map((p: any) => p.id)).toEqual(['pay_json']);
    expect((writtenPlain as any).semesters.map((s: any) => s.id)).toEqual(['sem_1']);
    expect((writtenPlain as any).backupEpoch).toBe(await getLocalBackupEpoch());
    expect((writtenPlain as any).scanRequest?.state).toBe('done');

    // Neither stale local task nor poisoned Firebase task survives anywhere
    const localTasks = await getTasks();
    expect(localTasks.map(t => t.id)).toEqual(['json_task_1']);
    expect(await getStorageTombstones()).toEqual({ old_deleted: '2026-10-01T00:00:00.000Z' });
    expect((await getProfile())?.studentName).toBe('Backup Owner');

    // Other devices with older or empty epoch recognize the authoritative restore epoch
    expect(isCloudBackupEpochNewer((writtenPlain as any).backupEpoch, '')).toBe(true);
    expect(isCloudBackupEpochNewer((writtenPlain as any).backupEpoch, '2026-10-01T00:00:00.000Z')).toBe(true);
    expect(isCloudBackupEpochNewer((writtenPlain as any).backupEpoch, (writtenPlain as any).backupEpoch)).toBe(false);
  });

  it('Restore JSON refreshes task updatedAt, clears self-contradictory tombstones, and preserves Islamic Final Exam against older tombstones', async () => {
    installTestStorage();
    await saveSettings({ syncKey: CLOUD_KEY });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => (init?.method === 'PUT' ? JSON.parse(String(init.body || 'null')) : null)
    })));

    const backupWithExamAndStaleTomb = {
      version: '1.8.40',
      tasks: [{
        id: 'islamic_final_1',
        courseCode: '0104100',
        courseName: 'Islamic Culture',
        title: 'Final Exam',
        description: 'Official Final Exam',
        dueDate: '2026-12-12T08:30:00.000Z',
        hasSpecificTime: true,
        type: 'exam',
        priority: 'high',
        status: 'pending',
        sourceSnippet: 'Official Final Exam',
        confidence: 1,
        extractedBy: 'local',
        createdAt: '2026-10-10T00:00:00.000Z',
        updatedAt: '2026-10-10T00:00:00.000Z'
      }],
      courses: [],
      tombstones: {
        islamic_final_1: '2026-11-24T00:00:00.000Z',
        unrelated_deleted: '2026-10-15T00:00:00.000Z'
      },
      settings: { syncKey: CLOUD_KEY }
    };

    const outcome = await applyBackupAuthoritatively(backupWithExamAndStaleTomb, { activeSyncKey: CLOUD_KEY });
    expect(outcome.applied.tasks.map(t => t.id)).toEqual(['islamic_final_1']);
    expect(Date.parse(outcome.applied.tasks[0].updatedAt)).toBeGreaterThan(Date.parse('2026-11-24T00:00:00.000Z'));
    expect(await getStorageTombstones()).toEqual({ unrelated_deleted: '2026-10-15T00:00:00.000Z' });
  });
});
