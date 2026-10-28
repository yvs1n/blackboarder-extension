import { describe, it, expect } from 'vitest';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';
import { isValidTask, isExamReviewTitle, hasMakeupExamAction, isExamReviewTask } from '../src/core/courseHelper';
import { Announcement, DeadlineTask } from '../src/types';

function makeTask(overrides: Partial<DeadlineTask>): DeadlineTask {
  return {
    id: 'task_test_1',
    courseCode: '1430 115',
    courseName: 'Physics 1',
    title: 'exam',
    description: 'Exam details',
    sourceSnippet: 'Exam details',
    dueDate: '2026-10-29T10:00:00.000Z',
    hasSpecificTime: true,
    type: 'exam',
    priority: 'high',
    status: 'pending',
    confidence: 0.85,
    extractedBy: 'local',
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:00:00.000Z',
    ...overrides
  };
}

describe('Post-Exam Review and Paper Viewing Filtering', () => {
  it('does not extract any deadline from the Akkindi exam sheet review announcement', () => {
    const ann: Announcement = {
      id: 'ann_physics_review_1',
      courseCode: '1430 115',
      courseName: 'Physics 1',
      title: 'Exam sheet review',
      postedAt: '2026-10-28T10:00:00.000Z',
      contentText: 'Dear students, You are supposed to get a copy of your Akkindi sheet so you can grade yourself using the correct answers that are already shared on Blackboard (Physics 1 – All Sections). If you still believe that your grade should be higher than what you received, you can review your exam sheet tomorrow (Thursday 29th) from 2:00 pm to 2:30 pm on the first floor of M10 (we will use an empty room there). There will be no review outside this time window, so please be on time. Regards, Amine',
      sourceUrl: '',
      scannedAt: '2026-10-28T10:00:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks).toHaveLength(0);
  });

  it('drops bogus exam review tasks in isValidTask', () => {
    const bogusTask = makeTask({
      title: 'exam',
      type: 'exam',
      description: 'Dear students, You are supposed to get a copy of your Akkindi sheet so you can grade yourself using the correct answers that are already shared on Blackboard (Physics 1 – All Sections). If you still believe that your grade should be higher than what you received, you can review your exam sheet tomorrow (Thursday 29th) from 2:00 pm to 2:30 pm on the first floor of M10 (we will use an empty room there). There will be no review outside this time window, so please be on time. Regards, Amine',
      sourceSnippet: 'Dear students, You are supposed to get a copy of your Akkindi sheet so you can grade yourself using the correct answers that are already shared on Blackboard (Physics 1 – All Sections). If you still believe that your grade should be higher than what you received, you can review your exam sheet tomorrow (Thursday 29th) from 2:00 pm to 2:30 pm on the first floor of M10 (we will use an empty room there). There will be no review outside this time window, so please be on time. Regards, Amine'
    });

    expect(isExamReviewTask(bogusTask)).toBe(true);
    expect(isValidTask(bogusTask)).toBe(false);
  });

  it('drops tasks whose title is explicitly an exam sheet review or paper viewing session', () => {
    expect(isExamReviewTitle('Exam sheet review')).toBe(true);
    expect(isExamReviewTitle('Midterm paper viewing')).toBe(true);
    expect(isExamReviewTitle('Quiz 1 Sheet Review')).toBe(true);
    expect(isExamReviewTitle('مراجعة أوراق امتحان المنتصف')).toBe(true);
    expect(isExamReviewTitle('الاطلاع على ورقة الإجابة')).toBe(true);
    expect(isExamReviewTitle('معاينة أوراق الاختبار')).toBe(true);

    const taskWithReviewTitle = makeTask({
      title: 'Exam sheet review',
      type: 'exam'
    });
    expect(isValidTask(taskWithReviewTitle)).toBe(false);
  });

  it('filters out Arabic exam paper review announcements', () => {
    const annArabic: Announcement = {
      id: 'ann_math_review',
      courseCode: '1440 201',
      courseName: 'Calculus III',
      title: 'مراجعة أوراق امتحان المنتصف',
      postedAt: '2026-10-28T09:00:00.000Z',
      contentText: 'أعزائي الطلبة، لمن يرغب في مراجعة ورقة الامتحان، يمكنكم الحضور غداً الخميس من الساعة 10 إلى 11 صباحاً في مكتب 204.',
      sourceUrl: '',
      scannedAt: '2026-10-28T09:00:00.000Z'
    };

    const tasks = extractDeadlinesLocally(annArabic);
    expect(tasks).toHaveLength(0);
  });

  it('filters out Arabic answer sheet inspection announcements', () => {
    const annInspect: Announcement = {
      id: 'ann_physics_inspect',
      courseCode: '1430 115',
      courseName: 'Physics 1',
      title: 'الاطلاع على ورقة الإجابة',
      postedAt: '2026-10-28T09:00:00.000Z',
      contentText: 'يمكن للطلبة الاطلاع على ورقة الإجابة ونموذج الحل يوم الأحد القادم من الساعة 12 إلى 1 ظهراً.',
      sourceUrl: '',
      scannedAt: '2026-10-28T09:00:00.000Z'
    };

    const tasks = extractDeadlinesLocally(annInspect);
    expect(tasks).toHaveLength(0);
  });

  it('extracts real homework deadline from mixed announcement while skipping exam review sentence', () => {
    const mixedAnn: Announcement = {
      id: 'ann_mixed_1',
      courseCode: '1430 115',
      courseName: 'Physics 1',
      title: 'Course Updates: Homework and Exam Sheet Review',
      postedAt: '2026-10-28T08:00:00.000Z',
      contentText: 'Dear students. Homework 4 is due on Sunday at 11:59 pm. Also you can review your exam sheet tomorrow from 2:00 pm to 2:30 pm in M10.',
      sourceUrl: '',
      scannedAt: '2026-10-28T08:00:00.000Z'
    };

    const tasks = extractDeadlinesLocally(mixedAnn);
    expect(tasks.length).toBe(1);
    expect(tasks[0].type).toBe('assignment');
    expect(tasks[0].title.toLowerCase()).toContain('homework');
    expect(isValidTask(tasks[0])).toBe(true);
  });

  it('still extracts genuine scheduled makeup exams', () => {
    const makeupAnn: Announcement = {
      id: 'ann_makeup_1',
      courseCode: '1430 115',
      courseName: 'Physics 1',
      title: 'Makeup Exam for Midterm',
      postedAt: '2026-10-28T08:00:00.000Z',
      contentText: 'Students who missed the midterm with an approved excuse can take the makeup exam next Tuesday at 2:00 pm in room A8-110.',
      sourceUrl: '',
      scannedAt: '2026-10-28T08:00:00.000Z'
    };

    expect(hasMakeupExamAction(makeupAnn.title)).toBe(true);
    expect(hasMakeupExamAction(makeupAnn.contentText)).toBe(true);

    const tasks = extractDeadlinesLocally(makeupAnn);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].type).toBe('exam');
    expect(isValidTask(tasks[0])).toBe(true);
  });

  it('still extracts genuine scheduled Arabic makeup exams', () => {
    const makeupAnnAr: Announcement = {
      id: 'ann_makeup_ar',
      courseCode: '1430 115',
      courseName: 'Physics 1',
      title: 'امتحان تعويضي',
      postedAt: '2026-10-28T08:00:00.000Z',
      contentText: 'سيعقد الامتحان التعويضي للطلاب المتغيبين بعذر رسمي يوم الخميس القادم الساعة 10:00 صباحاً في قاعة A8-110.',
      sourceUrl: '',
      scannedAt: '2026-10-28T08:00:00.000Z'
    };

    expect(hasMakeupExamAction(makeupAnnAr.title)).toBe(true);
    expect(hasMakeupExamAction(makeupAnnAr.contentText)).toBe(true);

    const tasks = extractDeadlinesLocally(makeupAnnAr);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].type).toBe('exam');
    expect(isValidTask(tasks[0])).toBe(true);
  });

  it('never drops user-created or user-edited tasks even if titled exam review (Rule 3)', () => {
    const userTask = makeTask({
      title: 'Exam sheet review',
      userEdited: true
    });
    expect(isValidTask(userTask)).toBe(true);

    const manualTask = makeTask({
      title: 'Exam sheet review',
      extractedBy: 'manual'
    });
    expect(isValidTask(manualTask)).toBe(true);
  });
});
