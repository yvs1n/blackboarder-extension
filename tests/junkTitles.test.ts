import { describe, it, expect } from 'vitest';
import { isValidTask, findLegacyNamelessTaskIds } from '../src/core/courseHelper';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';
import { deduplicateTaskList } from '../src/utils/taskMerge';
import { Announcement, DeadlineTask } from '../src/types';

const QUIZ3 = 'Dear Students,Quiz 3 will be conducted on Thursday, 29 October 2026, during the lecture time. Quiz 3 will cover Modules 6 and 7 and will be paper-based. Calculators of any type are not allowed during the exam.';
const PRESENTATIONS = 'أعزائي الطلبة،ستبدأ عروض المقالات الأكاديمية الأسبوع المقبل، وستُعقد العروض كل يوم اثنين وأربعاء. الاثنين، 26 أكتوبر 2026 المجموعتان 1 و2';

function task(extra: Partial<DeadlineTask>): DeadlineTask {
  return {
    id: 'task_x',
    courseCode: '',
    courseName: 'Islamic Culture',
    title: 'Meeting',
    type: 'meeting',
    dueDate: '2026-10-26T13:00:00.000Z',
    hasSpecificTime: true,
    status: 'pending',
    extractedBy: 'local',
    description: PRESENTATIONS,
    sourceSnippet: PRESENTATIONS,
    ...extra
  } as DeadlineTask;
}

function ann(title: string, contentText: string, courseName = 'English for Academic Purposes'): Announcement {
  return {
    id: 'ann_api__1_1',
    courseCode: '',
    courseName,
    title,
    contentText,
    sourceUrl: 'https://elearning.sharjah.ac.ae/ultra/stream',
    postedAt: '2026-10-20T08:00:00.000Z',
    scannedAt: '2026-10-22T08:00:00.000Z'
  } as Announcement;
}

describe('tasks titled only with a type word', () => {
  it('removes scanned "Meeting" and "Other" tasks', () => {
    expect(isValidTask(task({}))).toBe(false);
    expect(isValidTask(task({ title: 'Other', type: 'other' }))).toBe(false);
  });

  it('lists old "Exam", "Assignment", "Lab" and "quiz" tasks once for cleanup, never edited ones or due-date items', () => {
    const ids = findLegacyNamelessTaskIds([
      task({ id: 'exam', title: 'Exam' }),
      task({ id: 'quiz', title: 'quiz' }),
      task({ id: 'edited', title: 'Exam', userEdited: true }),
      task({ id: 'mine', title: 'Lab', extractedBy: 'manual' }),
      task({ id: 'stream', title: 'Assignment', description: '', sourceSnippet: 'Due date: 9/11/26, 11:59 PM (UTC+4)' }),
      task({ id: 'named', title: 'Quiz 3' })
    ]);
    expect(ids).toEqual(['exam', 'quiz']);
  });

  it('skips a presentation schedule that lists many dates', () => {
    const sched = 'ستُعقد العروض كل يوم اثنين وأربعاء. الاثنين، 26 أكتوبر 2026 المجموعتان 1 و2 الأربعاء، 28 أكتوبر 2026 المجموعتان 3 و4 الاثنين، 2 نوفمبر 2026 المجموعتان 5 و6';
    expect(extractDeadlinesLocally(ann('عروض المقالات', sched, 'Islamic Culture'))).toHaveLength(0);
  });

  it('keeps Blackboard due-date items, named tasks, and anything the student made or edited', () => {
    expect(isValidTask(task({ title: 'Assignment', courseName: 'Physics 1', description: '', sourceSnippet: 'Due date: 9/11/26, 11:59 PM (UTC+4)' }))).toBe(true);
    expect(isValidTask(task({ title: 'Midterm', type: 'exam' }))).toBe(true);
    expect(isValidTask(task({ title: 'Quiz 3', type: 'quiz' }))).toBe(true);
    expect(isValidTask(task({ extractedBy: 'manual' }))).toBe(true);
    expect(isValidTask(task({ userEdited: true }))).toBe(true);
  });

  it('names a date-only sentence after the announcement heading', () => {
    const tasks = extractDeadlinesLocally(ann('Midterm Exam', 'Dear All,Please note the following concerning your exam.\nDate: Thursday 22 October 2026 Time: 5:00 - 6:00 PM'));
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every(t => t.title === 'Midterm')).toBe(true);
  });

  it('makes no nameless task from office hours or a start date', () => {
    const office = extractDeadlinesLocally(ann('Office hours', 'My office hours are as follows. Mon/Wed : 2-3 pm. Meeting by appointment on Monday, 7 September 2026.', 'Calculus I for Engineering'));
    expect(office.filter(t => /^(meeting|other)$/i.test(t.title))).toHaveLength(0);
    const start = extractDeadlinesLocally(ann('Online homework', 'Please access the assignment from the Blackboard link only. Start date is Sept 4 at 3:55 pm.', 'Calculus I for Engineering'));
    expect(start.filter(t => /^assignment$/i.test(t.title))).toHaveLength(0);
  });
});

describe('announcement filed under the wrong course', () => {
  it('drops the stream copy of Quiz 3 that sits in Physics 1 Lab on the wrong day', () => {
    const right = task({ id: 'right', title: 'Quiz 3', type: 'quiz', courseName: 'Introduction to Computer Eng.', announcementId: 'ann_api__597049_1', dueDate: '2026-10-29T07:00:00.000Z', description: QUIZ3, sourceSnippet: QUIZ3 });
    const wrong = task({ id: 'wrong', title: 'Quiz 3', type: 'quiz', courseName: 'Physics 1 Lab', announcementId: 'ann_ultra__596674_1', dueDate: '2026-10-28T10:00:00.000Z', description: QUIZ3, sourceSnippet: QUIZ3 });
    const out = deduplicateTaskList([wrong, right]);
    expect(out.map(t => t.id)).toEqual(['right']);
    expect(out[0].dueDate.slice(0, 10)).toBe('2026-10-29');
  });

  it('keeps a copy the student edited (Physics 1 Lab has its own Quiz 3)', () => {
    const right = task({ id: 'right', title: 'Quiz 3', type: 'quiz', courseName: 'Introduction to Computer Eng.', announcementId: 'ann_api__597049_1', dueDate: '2026-10-29T07:00:00.000Z', description: QUIZ3, sourceSnippet: QUIZ3 });
    const lab = task({ id: 'lab', title: 'Quiz 3', type: 'quiz', courseName: 'Physics 1 Lab', announcementId: 'ann_ultra__596674_1', dueDate: '2026-10-28T10:00:00.000Z', userEdited: true, description: QUIZ3, sourceSnippet: QUIZ3 });
    expect(deduplicateTaskList([lab, right]).map(t => t.id).sort()).toEqual(['lab', 'right']);
  });

  it('removes scanned extras that are not graded work, like a paper review deadline', () => {
    expect(isValidTask(task({ title: 'Midterm Exam Paper Review Deadline', type: 'other', extractedBy: 'ai' }))).toBe(false);
    expect(isValidTask(task({ title: 'Midterm Exam Paper Review Deadline', type: 'other', extractedBy: 'ai', userEdited: true }))).toBe(true);
  });

  it('keeps the same quiz text in two courses when both came from the announcement list', () => {
    const a = task({ id: 'a', title: 'Quiz 3', courseName: 'Physics 1', announcementId: 'ann_api__1_1', description: QUIZ3, sourceSnippet: QUIZ3 });
    const b = task({ id: 'b', title: 'Quiz 3', courseName: 'Calculus I for Engineering', announcementId: 'ann_api__2_1', description: QUIZ3, sourceSnippet: QUIZ3 });
    expect(deduplicateTaskList([a, b])).toHaveLength(2);
  });
});
