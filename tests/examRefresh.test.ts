import { describe, it, expect, vi, afterEach } from 'vitest';
import { refreshExamSchedule, examRefreshNote, isExamPageUrl, EXAM_READ_KEY } from '../src/background/examRefresh';
import { mergeExamScheduleTasks } from '../src/core/examSchedule';
import { getUniversity } from '../src/core/universities';
import { DeadlineTask } from '../src/types';

const PAGE = getUniversity('uos').examSchedulePage!;

const SAMPLE_EXAM_HTML = `
  <table>
    <tr>
      <th>CRN</th>
      <th>Course Number</th>
      <th>Course Title</th>
      <th>Exam Date</th>
      <th>From / Time</th>
      <th>To / Time</th>
      <th>Building</th>
      <th>Room</th>
      <th>Exam Type</th>
      <th>Exam Method</th>
      <th>Comment</th>
    </tr>
    <tr>
      <td>10806</td>
      <td>1440133</td>
      <td>Calculus I for Engineering</td>
      <td>22/10/2026</td>
      <td>14:30PM</td>
      <td>15:30PM</td>
      <td>A12</td>
      <td>110</td>
      <td>MIDTERM</td>
      <td>Paper_Based</td>
      <td></td>
    </tr>
    <tr>
      <td>10806</td>
      <td>1440133</td>
      <td>Calculus I for Engineering</td>
      <td>06/12/2026</td>
      <td>08:30AM</td>
      <td>10:30AM</td>
      <td>A12</td>
      <td>TH007</td>
      <td>FINAL</td>
      <td>Paper_Based</td>
      <td></td>
    </tr>
    <tr>
      <td>12056</td>
      <td>1502101</td>
      <td>Introduction to Computer Eng.</td>
      <td>06/12/2026</td>
      <td>13:30PM</td>
      <td>15:30PM</td>
      <td>A8</td>
      <td>103</td>
      <td>FINAL</td>
      <td>Paper_Based</td>
      <td></td>
    </tr>
  </table>
`;

function fakeEnv(opts: {
  profile?: any;
  lastRead?: any;
  responseUrl?: string;
  status?: number;
  html?: string;
  tasks?: DeadlineTask[];
}) {
  const store: Record<string, any> = {
    bbs_profile: opts.profile,
    [EXAM_READ_KEY]: opts.lastRead,
    bbs_tasks: opts.tasks || []
  };
  const getImpl = (keys: string[] | string, cb?: (res: any) => void) => {
    const arr = Array.isArray(keys) ? keys : [keys];
    const res = Object.fromEntries(arr.map(k => [k, store[k]]));
    if (cb) cb(res);
    return Promise.resolve(res);
  };
  const setImpl = (o: Record<string, any>, cb?: () => void) => {
    Object.assign(store, o);
    if (cb) cb();
    return Promise.resolve();
  };
  const chromeMock = {
    runtime: { id: 'test' },
    storage: {
      local: {
        get: vi.fn(getImpl),
        set: vi.fn(setImpl)
      }
    },
    tabs: {
      create: vi.fn(),
      get: vi.fn(),
      sendMessage: vi.fn(),
      remove: vi.fn()
    }
  };
  const fetchMock = vi.fn(async () => ({
    ok: (opts.status ?? 200) >= 200 && (opts.status ?? 200) < 300,
    status: opts.status ?? 200,
    url: opts.responseUrl ?? `${PAGE}?x=1`,
    text: async () => opts.html ?? SAMPLE_EXAM_HTML,
    json: async () => JSON.parse(opts.html ?? '[]')
  }));
  vi.stubGlobal('chrome', chromeMock);
  vi.stubGlobal('fetch', fetchMock);
  return { chromeMock, fetchMock, store };
}

describe('reading the exam schedule via direct HTTP request (no background tab)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fetches the exam schedule over HTTP with credentials, parses and merges exams, and never opens a tab', async () => {
    const { chromeMock, fetchMock, store } = fakeEnv({});
    const res = await refreshExamSchedule();
    expect(fetchMock).toHaveBeenCalledWith(PAGE, expect.objectContaining({ credentials: 'include' }));
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();
    expect(res).toMatchObject({ state: 'read', found: 3, added: 3, updated: 0 });
    expect(store[EXAM_READ_KEY].readAt).toBeTruthy();
    expect(store.bbs_tasks).toHaveLength(3);
  });

  it('says to sign in when the request redirects to a sign-in page', async () => {
    const { chromeMock, fetchMock } = fakeEnv({ responseUrl: 'https://login.example.test/sso', html: '<html><input type="password"></html>' });
    const res = await refreshExamSchedule();
    expect(res.state).toBe('signed-out');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();
  });

  it('does not fetch again within the hour, unless it is a full re-scan', async () => {
    const lastRead = { state: 'read', found: 3, readAt: new Date().toISOString() };
    const { fetchMock, chromeMock } = fakeEnv({ lastRead });
    expect((await refreshExamSchedule()).state).toBe('recent');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();
    expect((await refreshExamSchedule(true)).state).toBe('read');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a university without a known exam page', async () => {
    const { fetchMock, chromeMock } = fakeEnv({ profile: { universityId: 'zu', updatedAt: '2026-10-01T00:00:00.000Z' } });
    expect((await refreshExamSchedule()).state).toBe('none');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();
  });
});

describe('exam refresh helpers', () => {
  it('matches the exam page with or without a query string or trailing slash', () => {
    expect(isExamPageUrl(`${PAGE}/?a=b`, PAGE)).toBe(true);
    expect(isExamPageUrl('https://generalssb-prod.ec.sharjah.ac.ae/other', PAGE)).toBe(false);
    expect(isExamPageUrl(undefined, PAGE)).toBe(false);
  });

  it('adds a short line to the scan message', () => {
    expect(examRefreshNote({ state: 'read', found: 11, added: 2, updated: 0 })).toBe(' Exams: 11 on your exam schedule, 2 new.');
    expect(examRefreshNote({ state: 'signed-out' })).toContain('sign in to Banner');
    expect(examRefreshNote({ state: 'recent' })).toBe('');
    expect(examRefreshNote(null)).toBe('');
  });
});

describe('two midterms in one course', () => {
  const exam = (id: string, title: string, dueDate: string): DeadlineTask => ({
    id, courseCode: '9990101', courseName: 'Test Course', title, description: '', dueDate, hasSpecificTime: true,
    type: 'exam', priority: 'high', status: 'pending', sourceSnippet: '', confidence: 1, extractedBy: 'local',
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z'
  });

  it('keep their own deadlines, each matched to the nearest date', () => {
    const announced = [exam('a1', 'Midterm Exam', '2026-10-05T08:00:00.000Z'), exam('a2', 'Midterm Exam', '2026-11-09T08:00:00.000Z')];
    const banner = [
      exam('banner_exam_9990101_mid_2026-11-10', 'Midterm Exam', '2026-11-10T10:00:00.000Z'),
      exam('banner_exam_9990101_mid_2026-10-05', 'Midterm Exam', '2026-10-05T10:00:00.000Z')
    ];
    const { tasks, addedCount } = mergeExamScheduleTasks(announced, banner);
    expect(addedCount).toBe(0);
    expect(tasks.find(t => t.id === 'a1')!.dueDate).toBe('2026-10-05T10:00:00.000Z');
    expect(tasks.find(t => t.id === 'a2')!.dueDate).toBe('2026-11-10T10:00:00.000Z');
  });

  it('does not let a hidden review session or dismissed task absorb an incoming official Final Exam', () => {
    const hiddenReview: DeadlineTask = {
      ...exam('rev_islamic', 'Final Exam Sheet Review', '2026-12-01T10:00:00.000Z'),
      visibility: 'hidden',
      hiddenReason: 'review_session',
      courseCode: '0104100',
      courseName: 'Islamic Culture'
    };
    const officialFinal: DeadlineTask = {
      ...exam('banner_exam_0104100_final_2026-12-10', 'Final Exam', '2026-12-10T08:30:00.000Z'),
      courseCode: '0104100',
      courseName: 'Islamic Culture'
    };
    const { tasks, addedCount } = mergeExamScheduleTasks([hiddenReview], [officialFinal]);
    expect(addedCount).toBe(1);
    expect(tasks.some(t => t.id === 'banner_exam_0104100_final_2026-12-10' && t.visibility !== 'hidden')).toBe(true);
  });

  it('recovers deleted upcoming official exams on Full Re-scan while keeping deleted past exams suppressed', async () => {
    const futureYear = new Date().getFullYear() + 1;
    const htmlWithPastAndFuture = `
      <table>
        <tr><th>CRN</th><th>Course Number</th><th>Course Title</th><th>Exam Date</th><th>From / Time</th><th>To / Time</th><th>Building</th><th>Room</th><th>Exam Type</th><th>Exam Method</th><th>Comment</th></tr>
        <tr><td>11111</td><td>1440133</td><td>Calculus I</td><td>22/10/2025</td><td>14:30PM</td><td>15:30PM</td><td>A12</td><td>110</td><td>MIDTERM</td><td>Paper_Based</td><td></td></tr>
        <tr><td>22222</td><td>0104100</td><td>Islamic Culture</td><td>15/12/${futureYear}</td><td>08:30AM</td><td>10:30AM</td><td>M5</td><td>101</td><td>FINAL</td><td>Paper_Based</td><td></td></tr>
      </table>
    `;
    const pastId = 'banner_exam_1440133_midterm_2025-10-22';
    const upcomingIslamicId = `banner_exam_0104100_final_${futureYear}-12-15`;
    const env = fakeEnv({ html: htmlWithPastAndFuture });
    env.store.bbs_tombstones = {
      [pastId]: '2026-10-25T00:00:00.000Z',
      [upcomingIslamicId]: '2026-11-24T00:00:00.000Z'
    };

    const res = await refreshExamSchedule(true);
    expect(res).toMatchObject({ state: 'read', found: 1, added: 1 });
    expect(env.store.bbs_tasks.some((t: DeadlineTask) => t.id === upcomingIslamicId)).toBe(true);
    expect(env.store.bbs_tasks.some((t: DeadlineTask) => t.id === pastId)).toBe(false);
    expect(env.store.bbs_tombstones[upcomingIslamicId]).toBeUndefined();
    expect(env.store.bbs_tombstones[pastId]).toBeTruthy();

    // Even when a course already has a hidden review, dismissed exam, or final project,
    // deduplicateTaskList must not collapse the restored Banner Final Exam into it or re-tombstone it.
    const existingWithCollidingItems: DeadlineTask[] = [
      {
        ...exam('task_islamic_review', 'Final Exam Review', `${futureYear}-12-10T10:00:00.000Z`),
        courseCode: '0104100',
        courseName: 'Islamic Culture',
        visibility: 'hidden',
        hiddenReason: 'review_session'
      },
      {
        ...exam('task_islamic_project', 'Final Project', `${futureYear}-12-01T10:00:00.000Z`),
        type: 'project',
        status: 'completed',
        courseCode: '0104100',
        courseName: 'Islamic Culture'
      }
    ];
    const env2 = fakeEnv({ html: htmlWithPastAndFuture, tasks: existingWithCollidingItems });
    env2.store.bbs_tombstones = {
      [pastId]: '2026-10-25T00:00:00.000Z',
      [upcomingIslamicId]: '2026-11-24T00:00:00.000Z'
    };
    const firstPass = await refreshExamSchedule(true);
    expect(firstPass).toMatchObject({ state: 'read', found: 1, added: 1 });
    const restoredTask = env2.store.bbs_tasks.find((t: DeadlineTask) => t.id === upcomingIslamicId);
    expect(restoredTask).toBeTruthy();
    expect(restoredTask?.status).toBe('pending');
    expect(restoredTask?.visibility).toBeUndefined();
    expect(env2.store.bbs_tombstones[upcomingIslamicId]).toBeUndefined();
    expect(env2.store.bbs_tombstones[pastId]).toBeTruthy();

    // A second scan recognizes the exam is now in the calendar and does not re-add it
    const secondPass = await refreshExamSchedule(true);
    expect(secondPass).toMatchObject({ state: 'read', found: 1, added: 0 });
  });
});
