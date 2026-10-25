import { describe, it, expect } from 'vitest';
import { processAnnouncementsBatch } from '../src/engine/hybridExtractor';
import { deduplicateTaskList } from '../src/utils/taskMerge';
import { Announcement, DEFAULT_SETTINGS, DeadlineTask } from '../src/types';

const QUIZ3_BODY = 'Dear Students,\nQuiz 3 will be conducted on Thursday, 29 October 2026, during the lecture time. Quiz 3 will cover Modules 6 and 7 and will be paper-based.\nRegards,';

function ann(courseCode: string, courseName: string): Announcement {
  return {
    id: `ann_ultra_${courseCode}`,
    courseCode,
    courseName,
    title: 'Quiz 3 - Thursday 29 October 2026',
    contentText: QUIZ3_BODY,
    sourceUrl: 'https://elearning.sharjah.ac.ae/ultra/stream',
    scannedAt: new Date().toISOString()
  };
}

function oldQuiz3(courseCode: string, courseName: string, extra: Partial<DeadlineTask> = {}): DeadlineTask {
  return {
    id: 'task_old_quiz3',
    courseCode,
    courseName,
    title: 'Quiz 3',
    type: 'quiz',
    dueDate: '2026-10-08T08:00:00.000Z',
    hasSpecificTime: true,
    status: 'pending',
    extractedBy: 'local',
    ...extra
  } as DeadlineTask;
}

describe('announcement tasks are not swallowed by an older task with the same title', () => {
  it('adds Quiz 3 when an undetected-course Quiz 3 on another date already exists', async () => {
    const r = await processAnnouncementsBatch([ann('UOS', 'General Course')], [oldQuiz3('UOS', 'General Course')], DEFAULT_SETTINGS);
    expect(r.newTasks).toHaveLength(1);
    expect(r.newTasks[0].dueDate.slice(0, 10)).toBe('2026-10-29');
  });

  it('moves the date when the same course re-announces Quiz 3 (reschedule)', async () => {
    const r = await processAnnouncementsBatch([ann('MATH101', 'Calculus')], [oldQuiz3('MATH101', 'Calculus')], DEFAULT_SETTINGS);
    expect(r.newTasks).toHaveLength(0);
    const kept = r.allTasks.find(t => t.id === 'task_old_quiz3')!;
    expect(kept.dueDate.slice(0, 10)).toBe('2026-10-29');
  });

  it('never moves a date the student edited', async () => {
    const r = await processAnnouncementsBatch([ann('MATH101', 'Calculus')], [oldQuiz3('MATH101', 'Calculus', { userEdited: true })], DEFAULT_SETTINGS);
    const kept = r.allTasks.find(t => t.id === 'task_old_quiz3')!;
    expect(kept.dueDate.slice(0, 10)).toBe('2026-10-08');
  });

  it('keeps two deadlines announced together', async () => {
    const two: Announcement = {
      ...ann('MATH101', 'Calculus'),
      title: 'Upcoming assessments',
      contentText: 'Quiz 3 will be on Thursday, 29 October 2026.\nAssignment 2 is due on Sunday, 1 November 2026.'
    };
    const r = await processAnnouncementsBatch([two], [], DEFAULT_SETTINGS);
    expect(r.newTasks.map(t => t.type).sort()).toEqual(['assignment', 'quiz']);
    expect(deduplicateTaskList(r.allTasks)).toHaveLength(2);
  });

  it('reports progress and keeps announcement order when extracting in parallel', async () => {
    const anns: Announcement[] = [1, 2, 3, 4, 5, 6].map(n => ({
      ...ann('MATH101', 'Calculus'),
      id: `ann_${n}`,
      title: `Quiz ${n}`,
      contentText: `Quiz ${n} will be on Thursday, ${n} November 2026.`
    }));
    const progress: Array<[number, number]> = [];
    const r = await processAnnouncementsBatch(anns, [], DEFAULT_SETTINGS, undefined, (d, t) => progress.push([d, t]));
    expect(r.newTasks.map(t => t.title)).toEqual(['Quiz 1', 'Quiz 2', 'Quiz 3', 'Quiz 4', 'Quiz 5', 'Quiz 6']);
    expect(progress[0]).toEqual([0, 6]);
    expect(progress[progress.length - 1]).toEqual([6, 6]);
  });

  it('still merges the same quiz scanned twice', async () => {
    const first = await processAnnouncementsBatch([ann('UOS', 'General Course')], [], DEFAULT_SETTINGS);
    const second = await processAnnouncementsBatch([{ ...ann('UOS', 'General Course'), id: 'ann_ultra_other' }], first.allTasks, DEFAULT_SETTINGS);
    expect(second.newTasks).toHaveLength(0);
    expect(second.allTasks).toHaveLength(1);
  });
});
