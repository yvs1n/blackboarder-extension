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

  it('never adds 2 tasks for the same singleton deadline (HW 1 vs Assignment 1) and completes information', async () => {
    const annHw1: Announcement = {
      id: 'ann_hw1_early',
      courseCode: '0401100',
      courseName: 'Calculus I',
      title: 'HW 1 Announcement',
      contentText: 'HW 1 is assigned, due on Thursday, 12 November 2026.',
      sourceUrl: 'https://elearning.sharjah.ac.ae',
      scannedAt: new Date().toISOString()
    };
    const annAssign1: Announcement = {
      id: 'ann_assign1_later',
      courseCode: '0401100',
      courseName: 'Calculus I',
      title: 'Assignment 1 Details',
      contentText: 'Assignment 1 submission deadline is Thursday, 12 November 2026. Worth 10% of grade.',
      sourceUrl: 'https://elearning.sharjah.ac.ae',
      scannedAt: new Date().toISOString()
    };

    const r = await processAnnouncementsBatch([annHw1, annAssign1], [], DEFAULT_SETTINGS);
    expect(r.newTasks).toHaveLength(1);
    const task = r.allTasks[0];
    expect(task.title).toMatch(/^(?:Homework 1|Assignment 1)$/);
    expect(task.dueDate.slice(0, 10)).toBe('2026-11-12');
    expect(task.weight).toBe(10);
  });

  it('updates existing exam with doctor announcement mentioning what was not mentioned previously', async () => {
    const existingMidterm: DeadlineTask = {
      id: 'task_midterm_init',
      courseCode: '0401201',
      courseName: 'Physics I',
      title: 'Midterm',
      type: 'exam',
      description: 'Midterm exam will cover chapters 1 to 4 on Wednesday, 18 November 2026.',
      dueDate: '2026-11-18T10:00:00.000Z',
      hasSpecificTime: true,
      status: 'pending',
      extractedBy: 'local',
      priority: 'high',
      sourceSnippet: 'Midterm exam will cover chapters 1 to 4 on Wednesday, 18 November 2026.',
      confidence: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const doctorUpdateAnn: Announcement = {
      id: 'ann_doctor_update',
      courseCode: '0401201',
      courseName: 'Physics I',
      title: 'Midterm Exam Doctor Update',
      contentText: 'Doctor Update: Midterm will take place in room M9-012. Scientific calculators are permitted.',
      sourceUrl: 'https://elearning.sharjah.ac.ae',
      scannedAt: new Date().toISOString()
    };

    const r = await processAnnouncementsBatch([doctorUpdateAnn], [existingMidterm], DEFAULT_SETTINGS);
    expect(r.newTasks).toHaveLength(0);
    const updated = r.allTasks.find(t => t.id === 'task_midterm_init')!;
    expect(updated).toBeDefined();
    expect(updated.room).toBe('M9-012');
    expect(updated.description).toContain('[Doctor Update]:');
    expect(updated.description).toContain('Scientific calculators are permitted');
    expect(updated.description).toContain('Midterm exam will cover chapters 1 to 4');
  });

  it('ensures all deadline titles are in English for Arabic announcements', async () => {
    const arabicAnn: Announcement = {
      id: 'ann_arabic_quiz',
      courseCode: '0104100',
      courseName: 'Islamic Culture',
      title: 'تذكير: كويز 1',
      contentText: 'السلام عليكم، تذكير بموعد كويز 1 يوم الأحد، 15 نوفمبر 2026 الساعة 10:00 صباحاً.',
      sourceUrl: 'https://elearning.sharjah.ac.ae',
      scannedAt: new Date().toISOString()
    };

    const r = await processAnnouncementsBatch([arabicAnn], [], DEFAULT_SETTINGS);
    expect(r.newTasks).toHaveLength(1);
    expect(r.newTasks[0].title).toBe('Quiz 1');
    expect(/[\u0600-\u06FF]/.test(r.newTasks[0].title)).toBe(false);
  });
});
