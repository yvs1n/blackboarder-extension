import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refreshExamSchedule, examRefreshNote, isExamPageUrl, EXAM_READ_KEY } from '../src/background/examRefresh';
import { mergeExamScheduleTasks } from '../src/core/examSchedule';
import { getUniversity } from '../src/core/universities';
import { DeadlineTask } from '../src/types';

const PAGE = getUniversity('uos').examSchedulePage!;

function fakeChrome(opts: { profile?: any; lastRead?: any; tabUrl?: string; reply?: any }) {
  const store: Record<string, any> = { bbs_profile: opts.profile, [EXAM_READ_KEY]: opts.lastRead };
  const chromeMock = {
    runtime: { id: 'test' },
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map(k => [k, store[k]]))),
        set: vi.fn(async (o: Record<string, any>) => { Object.assign(store, o); })
      }
    },
    tabs: {
      create: vi.fn(async () => ({ id: 7 })),
      get: vi.fn(async () => ({ id: 7, status: 'complete', url: opts.tabUrl ?? `${PAGE}?x=1` })),
      sendMessage: vi.fn(async () => opts.reply),
      remove: vi.fn(async () => {})
    }
  };
  vi.stubGlobal('chrome', chromeMock);
  return { chromeMock, store };
}

describe('reading the exam schedule in a background tab', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('opens the page without focusing it, reads it, saves when, and closes the tab', async () => {
    const { chromeMock, store } = fakeChrome({ reply: { found: 11, added: 6, updated: 1 } });
    const p = refreshExamSchedule();
    await vi.advanceTimersByTimeAsync(2000);
    const res = await p;
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: PAGE, active: false });
    expect(res).toMatchObject({ state: 'read', found: 11, added: 6, updated: 1 });
    expect(store[EXAM_READ_KEY].readAt).toBeTruthy();
    expect(chromeMock.tabs.remove).toHaveBeenCalledWith(7);
  });

  it('says to sign in when the page never arrives (sign-in page instead)', async () => {
    const { chromeMock } = fakeChrome({ tabUrl: 'https://login.example.test/sso', reply: undefined });
    const p = refreshExamSchedule();
    await vi.advanceTimersByTimeAsync(47000);
    expect((await p).state).toBe('signed-out');
    expect(chromeMock.tabs.sendMessage).not.toHaveBeenCalled();
    expect(chromeMock.tabs.remove).toHaveBeenCalledWith(7);
  });

  it('does not open a tab again within the hour, unless it is a full re-scan', async () => {
    const lastRead = { state: 'read', found: 3, readAt: new Date().toISOString() };
    const { chromeMock } = fakeChrome({ lastRead, reply: { found: 3 } });
    expect((await refreshExamSchedule()).state).toBe('recent');
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();
    const p = refreshExamSchedule(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await p).state).toBe('read');
  });

  it('does nothing for a university without a known exam page', async () => {
    const { chromeMock } = fakeChrome({ profile: { universityId: 'zu', updatedAt: '2026-10-01T00:00:00.000Z' } });
    expect((await refreshExamSchedule()).state).toBe('none');
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
});
