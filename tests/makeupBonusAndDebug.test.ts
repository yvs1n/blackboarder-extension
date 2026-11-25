// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { DeadlineTask, UserCourseConfig } from '../src/types';
import { setActiveUserCourses } from '../src/core/userCourses';
import {
  isMakeupSupersededByCompletedOriginal,
  isBonusText,
  isUneditedExtraPastSyllabusQuota
} from '../src/core/makeupFilter';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';
import { deduplicateTaskList, mergeCloudTasks } from '../src/utils/taskMerge';
import { saveTasksMergingLatest } from '../src/utils/storage/tasksStorage';
import { getStorageTombstones, setStorageTombstones } from '../src/utils/tombstones';
import { buildElementDebugReport } from '../src/popup/modules/debugStick';

const PHYSICS_COURSE: UserCourseConfig = {
  id: 'phys1',
  courseCode: '1430115',
  courseName: 'Physics 1',
  colorHex: '#3b82f6',
  creditHours: 3,
  aliases: ['Physics I', '0402115'],
  scheduleSlots: [],
  syllabus: [
    { id: 'quizzes', name: 'Quizzes', type: 'quiz', totalWeight: 15, count: 3, outOf: 3, keywords: ['quiz'] },
    { id: 'midterm', name: 'Midterm Exam', type: 'exam', totalWeight: 25, count: 1, keywords: ['midterm'] },
    { id: 'final', name: 'Final Exam', type: 'exam', totalWeight: 40, count: 1, keywords: ['final'] }
  ]
};

function makeTask(partial: Partial<DeadlineTask> & Pick<DeadlineTask, 'id' | 'title' | 'type' | 'dueDate'>): DeadlineTask {
  return {
    courseCode: '1430115',
    courseName: 'Physics 1',
    description: '',
    hasSpecificTime: true,
    priority: 'high',
    status: 'pending',
    sourceSnippet: '',
    confidence: 0.9,
    extractedBy: 'local',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...partial
  };
}

describe('Makeup Purge, Bonus Deduplication, Syllabus Quotas & Debug Stick (v1.8.41)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await setStorageTombstones({});
    setActiveUserCourses([PHYSICS_COURSE]);
  });

  it('purges Physics 1 makeup exam even when weightDisplay starts with "25%" and Midterm 1 has different section code', () => {
    const completedMidterm = makeTask({
      id: 'gbcol_mid1',
      courseCode: '1430115_02',
      courseName: 'Physics I',
      title: 'Midterm 1',
      type: 'exam',
      dueDate: '2026-10-18T17:00:00.000Z',
      status: 'completed',
      submissionStatus: 'graded',
      score: 22,
      maxScore: 25,
      weight: 25,
      weightDisplay: '25% (Midterm Exam)'
    });
    const makeupMidterm = makeTask({
      id: 'task_local_makeup_phys1',
      courseCode: '0402115',
      courseName: 'Physics 1',
      title: 'makeup exam',
      type: 'exam',
      dueDate: '2026-10-27T17:00:00.000Z',
      weight: 25,
      weightDisplay: '25% (Midterm Exam)',
      syllabusNote: 'Physics 1: Midterm Exam (25% total)',
      description:
        'The makeup exam for those who missed the midterm is scheduled as follow: Date: Tuesday, 27-10-2026 Time: 5:00 to 6:00 PM Room: A12-102.',
      sourceSnippet:
        'The makeup exam for those who missed the midterm is scheduled as follow: Date: Tuesday, 27-10-2026 Time: 5:00 to 6:00 PM Room: A12-102.'
    });

    expect(isMakeupSupersededByCompletedOriginal(makeupMidterm, [completedMidterm, makeupMidterm])).toBe(true);
    const deduped = deduplicateTaskList([completedMidterm, makeupMidterm]);
    expect(deduped.map(t => t.id)).toEqual(['gbcol_mid1']);
  });

  it('records tombstones when saveTasksMergingLatest purges a stored makeup exam and prevents cloud resurrection', async () => {
    const completedMidterm = makeTask({
      id: 'task_mid_done',
      title: 'Midterm Exam',
      type: 'exam',
      dueDate: '2026-10-18T17:00:00.000Z',
      status: 'completed',
      weight: 25,
      weightDisplay: '25% (Midterm Exam)'
    });
    const makeupMidterm = makeTask({
      id: 'task_stale_makeup',
      title: 'makeup exam',
      type: 'exam',
      dueDate: '2026-10-27T17:00:00.000Z',
      weight: 25,
      weightDisplay: '25% (Midterm Exam)',
      description: 'The makeup exam for those who missed the midterm is scheduled on Tuesday 27-10-2026.',
      sourceSnippet: 'The makeup exam for those who missed the midterm is scheduled on Tuesday 27-10-2026.'
    });

    const saved = await saveTasksMergingLatest([completedMidterm, makeupMidterm]);
    expect(saved.map(t => t.id)).toEqual(['task_mid_done']);

    const tombs = await getStorageTombstones();
    expect(tombs.task_stale_makeup).toBeTruthy();

    const cloudMerged = mergeCloudTasks(saved, [completedMidterm, makeupMidterm], tombs);
    expect(cloudMerged.tasks.map(t => t.id)).toEqual(['task_mid_done']);
  });

  it('auto-detects bonus announcements and sets isBonus: true in localExtractor', () => {
    expect(isBonusText('There will be a Bonus Quiz on Wednesday')).toBe(true);
    expect(isBonusText('كويز بونص يوم الأربعاء القادم')).toBe(true);
    expect(isBonusText('Quiz 2 (no bonus marks)')).toBe(false);

    const extracted = extractDeadlinesLocally({
      id: 'ann_bonus_1',
      courseCode: '1430115',
      courseName: 'Physics 1',
      title: 'Extra Credit Quiz',
      contentText: 'Dear students, there will be an optional quiz for extra credit on Wednesday, 25/11/2026 at 11:00 AM in room A8-204.',
      postedAt: '2026-11-20T08:00:00.000Z',
      sourceUrl: 'https://elearning.sharjah.ac.ae/ultra/stream',
      scannedAt: '2026-11-20T09:00:00.000Z'
    });
    expect(extracted.length).toBe(1);
    expect(extracted[0].isBonus).toBe(true);
    expect(extracted[0].room).toBe('A8-204');
  });

  it('deduplicates a manually added Bonus Quiz with a scanned unlabeled Quiz in the same course, preserving isBonus and manual title', () => {
    const q1 = makeTask({ id: 'q1', title: 'Quiz 1', type: 'quiz', dueDate: '2026-09-20T10:00:00.000Z', status: 'completed', submissionStatus: 'graded', score: 5, maxScore: 5 });
    const q2 = makeTask({ id: 'q2', title: 'Quiz 2', type: 'quiz', dueDate: '2026-10-10T10:00:00.000Z', status: 'completed', submissionStatus: 'graded', score: 4.5, maxScore: 5 });
    const q3 = makeTask({ id: 'q3', title: 'Quiz 3', type: 'quiz', dueDate: '2026-11-01T10:00:00.000Z', status: 'completed', submissionStatus: 'graded', score: 5, maxScore: 5 });

    const manualBonusQuiz = makeTask({
      id: 'manual_bonus_q',
      title: 'Bonus Quiz',
      type: 'quiz',
      dueDate: '2026-11-26T10:00:00.000Z',
      isBonus: true,
      bonusTarget: 'course',
      weight: 2,
      weightDisplay: '+2% Bonus',
      extractedBy: 'manual',
      userEdited: true
    });

    const scannedNormalQuiz = makeTask({
      id: 'stream_1430115_Quiz_1764',
      title: 'Quiz',
      type: 'quiz',
      dueDate: '2026-11-26T12:30:00.000Z',
      room: 'A12-105',
      description: 'Quiz on Chapter 9 in room A12-105.',
      sourceSnippet: 'Quiz on Chapter 9 in room A12-105.',
      extractedBy: 'local'
    });

    const deduped = deduplicateTaskList([q1, q2, q3, manualBonusQuiz, scannedNormalQuiz]);
    const pendingQuizzes = deduped.filter(t => t.status === 'pending' && t.type === 'quiz');
    expect(pendingQuizzes.length).toBe(1);
    expect(pendingQuizzes[0].isBonus).toBe(true);
    expect(pendingQuizzes[0].title).toBe('Bonus Quiz');
    expect(pendingQuizzes[0].bonusTarget).toBe('course');
  });

  it('suppresses an unedited non-bonus scanned quiz when all syllabus quizzes in that course are already completed', () => {
    const q1 = makeTask({ id: 'q1', title: 'Quiz 1', type: 'quiz', dueDate: '2026-09-20T10:00:00.000Z', status: 'completed' });
    const q2 = makeTask({ id: 'q2', title: 'Quiz 2', type: 'quiz', dueDate: '2026-10-10T10:00:00.000Z', status: 'completed' });
    const q3 = makeTask({ id: 'q3', title: 'Quiz 3', type: 'quiz', dueDate: '2026-11-01T10:00:00.000Z', status: 'completed' });
    const strayScannedQuiz = makeTask({
      id: 'task_stray_q',
      title: 'Quiz',
      type: 'quiz',
      dueDate: '2026-11-28T10:00:00.000Z',
      extractedBy: 'local'
    });

    expect(isUneditedExtraPastSyllabusQuota(strayScannedQuiz, [q1, q2, q3, strayScannedQuiz])).toBe(true);
    const deduped = deduplicateTaskList([q1, q2, q3, strayScannedQuiz]);
    expect(deduped.some(t => t.id === 'task_stray_q')).toBe(false);
  });

  it('generates a redacted X-Ray debug report with engine flags and sibling course tasks for a clicked element', () => {
    const q1 = makeTask({ id: 'q1', title: 'Quiz 1', type: 'quiz', dueDate: '2026-09-20T10:00:00.000Z', status: 'completed' });
    const targetTask = makeTask({
      id: 'task_debug_1',
      title: 'Bonus Quiz',
      type: 'quiz',
      dueDate: '2026-11-26T10:00:00.000Z',
      isBonus: true,
      description: 'Auth token sk-or-v1-testtokenxyz_987654321 should never leak'
    });

    document.body.innerHTML = `
      <div class="task-card" data-id="task_debug_1">
        <span class="task-title">Bonus Quiz</span>
      </div>
    `;
    const span = document.querySelector('.task-title') as HTMLElement;
    const report = buildElementDebugReport(span, {
      tasks: [q1, targetTask],
      courses: [PHYSICS_COURSE],
      payments: [],
      tombstones: {},
      activeView: 'details',
      selectedDateStr: '2026-11-25',
      editingTaskId: null
    });

    expect(report).toContain('Blackboarder Debug Stick Report');
    expect(report).toContain('"id": "task_debug_1"');
    expect(report).toContain('"siblingCourseTasks"');
    expect(report).toContain('"title": "Quiz 1"');
    expect(report).toContain('[REDACTED]');
    expect(report).not.toContain('testtokenxyz_987654321');

    setActiveUserCourses([]);
  });
});
