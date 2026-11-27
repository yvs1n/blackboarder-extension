import { describe, it, expect } from 'vitest';
import { processAnnouncementsBatch } from '../../src/engine/hybridExtractor';
import { deduplicateTaskList } from '../../src/utils/tasks/taskMerge';
import { Announcement, DEFAULT_SETTINGS, DeadlineTask } from '../../src/types';

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

    const professorUpdateAnn: Announcement = {
      id: 'ann_professor_update',
      courseCode: '0401201',
      courseName: 'Physics I',
      title: 'Midterm Exam Professor Update',
      contentText: 'Professor Update: Midterm will take place in room M9-012. Scientific calculators are permitted.',
      sourceUrl: 'https://elearning.sharjah.ac.ae',
      scannedAt: new Date().toISOString()
    };

    const r = await processAnnouncementsBatch([professorUpdateAnn], [existingMidterm], DEFAULT_SETTINGS);
    expect(r.newTasks).toHaveLength(0);
    const updated = r.allTasks.find(t => t.id === 'task_midterm_init')!;
    expect(updated).toBeDefined();
    expect(updated.room).toBe('M9-012');
    expect(updated.description).toContain('[Professor Update]:');
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

  it('extracts multi-line quiz announcement with topics list and DD/MM date when not yet added', async () => {
    const topicQuizAnn: Announcement = {
      id: 'ann_quiz_topics_date',
      courseCode: '1411116',
      courseName: 'Calculus I for Engineering',
      title: 'Quiz 2 Topics & Schedule',
      postedAt: '2026-11-10T08:00:00.000Z',
      contentText: 'Dear Students,\nQuiz 2 will cover the following topics:\n- Derivatives\n- Chain Rule\n- Implicit Differentiation\nIt will be held on 18/11 at 11:00 AM.',
      sourceUrl: 'https://elearning.sharjah.ac.ae',
      scannedAt: '2026-11-10T09:00:00.000Z'
    };

    const r = await processAnnouncementsBatch([topicQuizAnn], [], DEFAULT_SETTINGS);
    expect(r.newTasks).toHaveLength(1);
    expect(r.newTasks[0].title).toBe('Quiz 2');
    expect(r.newTasks[0].type).toBe('quiz');
    expect(r.newTasks[0].dueDate.slice(0, 10)).toBe('2026-11-18');
    expect(r.newTasks[0].description).toContain('Chain Rule');
  });

  it('appends new scan quiz topics/instructions onto an already-added manual or scanned quiz without creating duplicates', async () => {
    const existingQuiz: DeadlineTask = {
      id: 'task_manual_quiz2',
      courseCode: 'UOS',
      courseName: 'Calculus I for Engineering',
      title: 'Quiz 2',
      type: 'quiz',
      description: 'Added from syllabus schedule',
      dueDate: '2026-11-18T11:00:00.000Z',
      hasSpecificTime: true,
      status: 'pending',
      extractedBy: 'manual',
      userEdited: true,
      priority: 'high',
      sourceSnippet: 'Added from syllabus schedule',
      confidence: 1,
      createdAt: '2026-11-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z'
    };

    const datedInstructionsAnn: Announcement = {
      id: 'ann_quiz2_topics',
      courseCode: '1411116',
      courseName: 'Calculus I for Engineering',
      title: 'Quiz 2 Instructions',
      postedAt: '2026-11-14T08:00:00.000Z',
      contentText: 'Quiz 2 covers Lectures 4-7 (Limits & Continuity) and will be held on November 18.',
      sourceUrl: 'https://elearning.sharjah.ac.ae',
      scannedAt: '2026-11-14T09:00:00.000Z'
    };

    const undatedFollowUpAnn: Announcement = {
      id: 'ann_quiz2_rules',
      courseCode: '1411116',
      courseName: 'Calculus I for Engineering',
      title: 'Quiz 2 Rules Reminder',
      postedAt: '2026-11-15T08:00:00.000Z',
      contentText: 'Please bring a blue pen. Formula sheet is provided during Quiz 2.',
      sourceUrl: 'https://elearning.sharjah.ac.ae',
      scannedAt: '2026-11-15T09:00:00.000Z'
    };

    const r = await processAnnouncementsBatch(
      [datedInstructionsAnn, undatedFollowUpAnn],
      [existingQuiz],
      DEFAULT_SETTINGS
    );
    expect(r.newTasks).toHaveLength(0);
    expect(r.allTasks).toHaveLength(1);
    const merged = r.allTasks[0];
    expect(merged.id).toBe('task_manual_quiz2');
    expect(merged.dueDate).toBe('2026-11-18T11:00:00.000Z');
    expect(merged.description).toContain('Added from syllabus schedule');
    expect(merged.description).toContain('Lectures 4-7');
    expect(merged.description).toContain('Formula sheet is provided');
  });

  it('preserves line breaks across HTML list items and keeps title-only quiz announcements in Blackboard API reads', async () => {
    const { stripHtmlToText, fetchCourseAnnouncements } = await import('../../src/scan/blackboardApi');
    const text = stripHtmlToText('<p>Quiz 2 topics:</p><ul><li>Vectors</li><li>Motion</li></ul><p>On Thursday, Nov 19</p>');
    expect(text).toContain('Quiz 2 topics:\n');
    expect(text).toContain('Vectors\nMotion');

    const mockFetch = async () => new Response(JSON.stringify({
      results: [
        { id: '_a1', title: 'Quiz 2 on Thursday, Nov 19', body: '', created: '2026-11-16T08:00:00.000Z' }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const res = await fetchCourseAnnouncements(
      mockFetch as any,
      '_100_1',
      { name: 'Physics 1', code: '1430115' },
      'https://elearning.sharjah.ac.ae'
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.announcements).toHaveLength(1);
      expect(res.announcements[0].contentText).toContain('Quiz 2 on Thursday, Nov 19');
    }
  });

  it('merges same-day relative AI follow-up ("Tomorrow\'s Test") into Banner Final Exam and strips relative titles', async () => {
    const { toEnglishDeadlineTitle } = await import('../../src/core/courseHelper');
    expect(toEnglishDeadlineTitle("Tomorrow's Test", 'quiz')).toBe('Quiz');
    expect(toEnglishDeadlineTitle('اختبار الغد', 'exam')).toBe('Exam');

    const bannerFinal: DeadlineTask = {
      id: 'banner_exam_0104100_final_2026-11-28',
      courseCode: '0104 100',
      courseName: 'Islamic Culture',
      title: 'Final Exam',
      type: 'exam',
      priority: 'high',
      status: 'pending',
      dueDate: '2026-11-28T04:30:00.000Z',
      hasSpecificTime: true,
      timeSource: 'explicit',
      room: 'A13-006',
      weight: 50,
      weightDisplay: '50% (Final Exam)',
      description: 'سينعقد الامتحان النهائي يوم السبت 28/11/2026 بالقاعة (A13-006 و A13-008)',
      sourceSnippet: 'سينعقد الامتحان النهائي يوم السبت 28/11/2026 بالقاعة (A13-006 و A13-008)',
      confidence: 1,
      extractedBy: 'local',
      createdAt: '2026-10-27T18:40:18.886Z',
      updatedAt: '2026-11-26T05:53:59.689Z'
    };
    const aiFollowUpDup: DeadlineTask = {
      id: 'task_ai_1795785648447_r6kpc',
      announcementId: 'ann_api__607871_1',
      announcementPostedAt: '2026-11-27T11:47:03.142Z',
      courseCode: '0104 100',
      courseName: 'Islamic Culture',
      title: "Tomorrow's Test",
      type: 'quiz',
      priority: 'medium',
      status: 'pending',
      dueDate: '2026-11-28T13:00:00.000Z',
      hasSpecificTime: true,
      timeSource: 'schedule',
      room: 'A8-TH005',
      description: 'أعزائي الطلبة، يرجى اتّباع التعليمات الآتية في اختبار الغد: تحديد نموذج الاختبار Bubble Sheet',
      sourceSnippet: 'أعزائي الطلبة، يرجى اتّباع التعليمات الآتية في اختبار الغد: تحديد نموذج الاختبار Bubble Sheet',
      confidence: 0.95,
      summary: { brief: 'Follow version and shading rules.', formatRules: 'Shade Version A or B on the answer sheet.' },
      ar: {
        title: 'اختبار الغد',
        room: 'A8-TH005',
        courseName: 'الثقافة الإسلامية',
        sourceSig: 'sig1',
        brief: 'اتبع تعليمات التظليل.',
        formatRules: 'ظلل نموذج A أو B.',
        updatedAt: '2026-11-27T13:20:48.448Z'
      },
      extractedBy: 'ai',
      createdAt: '2026-11-27T13:20:48.447Z',
      updatedAt: '2026-11-27T13:20:48.447Z'
    };

    const deduped = deduplicateTaskList([bannerFinal, aiFollowUpDup]);
    expect(deduped).toHaveLength(1);
    const kept = deduped[0];
    expect(kept.id).toBe('banner_exam_0104100_final_2026-11-28');
    expect(kept.title).toBe('Final Exam');
    expect(kept.type).toBe('exam');
    expect(kept.dueDate).toBe('2026-11-28T04:30:00.000Z');
    expect(kept.room).toBe('A13-006');
    expect(kept.weight).toBe(50);
    expect(kept.description).toContain('نموذج الاختبار Bubble Sheet');
    expect(kept.summary?.formatRules).toContain('Version A or B');
    expect(kept.ar?.title).toBe('الامتحان النهائي');
    expect(kept.ar?.room).toBe('A13-006');

    // Explicit same-day Quiz 1 must remain separate and never merge into Final Exam
    const realQuiz1: DeadlineTask = {
      id: 'task_real_quiz1',
      courseCode: '0104 100',
      courseName: 'Islamic Culture',
      title: 'Quiz 1',
      type: 'quiz',
      priority: 'medium',
      status: 'pending',
      dueDate: '2026-11-28T10:00:00.000Z',
      hasSpecificTime: true,
      timeSource: 'explicit',
      description: 'Quiz 1 at 2:00 PM',
      sourceSnippet: 'Quiz 1 at 2:00 PM',
      confidence: 1,
      extractedBy: 'local',
      createdAt: '2026-11-20T08:00:00.000Z',
      updatedAt: '2026-11-20T08:00:00.000Z'
    };
    expect(deduplicateTaskList([bannerFinal, realQuiz1])).toHaveLength(2);

    // Undated instruction post for "اختبار الغد" merges directly into tomorrow's Final Exam
    const followUpAnn: Announcement = {
      id: 'ann_api__607871_1',
      courseCode: '0104 100',
      courseName: 'Islamic Culture',
      title: 'تعليمات اختبار الغد',
      contentText: 'أعزائي الطلبة، يرجى اتّباع التعليمات الآتية في اختبار الغد: تحديد نموذج الاختبار Version A/B والتظليل على Bubble Sheet.',
      postedAt: '2026-11-27T11:47:03.142Z',
      sourceUrl: 'https://elearning.sharjah.ac.ae/ultra/stream',
      scannedAt: '2026-11-27T13:20:00.000Z'
    };
    const batchRes = await processAnnouncementsBatch([followUpAnn], [bannerFinal], DEFAULT_SETTINGS);
    expect(batchRes.newTasks).toHaveLength(0);
    expect(batchRes.allTasks).toHaveLength(1);
    expect(batchRes.allTasks[0].id).toBe('banner_exam_0104100_final_2026-11-28');
    expect(batchRes.allTasks[0].description).toContain('Bubble Sheet');
  });
});
