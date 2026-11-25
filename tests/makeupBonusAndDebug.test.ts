// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { DeadlineTask, UserCourseConfig } from '../src/types';
import { setActiveUserCourses } from '../src/core/userCourses';
import {
  extractReferencedAssessmentNumbers,
  isBonusText,
  isCompletedExtensionOrRangeTask,
  isMakeupSupersededByCompletedOriginal,
  isUneditedExtraPastSyllabusQuota
} from '../src/core/makeupFilter';
import { calculateCourseTargetAnalysis } from '../src/core/targetGpa';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';
import { deduplicateTaskList, mergeCloudTasks } from '../src/utils/taskMerge';
import { saveTasksMergingLatest } from '../src/utils/storage/tasksStorage';
import { setStorageTombstones } from '../src/utils/tombstones';
import { buildElementDebugReport } from '../src/popup/modules/debugStick';
import { evaluateTaskList, explainTaskDecision, extractHiddenReviewSessionTask, isVisibleActiveTask } from '../src/rulebook';
import { generateIcsContent } from '../src/utils/calendar';

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
    const activeIds = deduped.filter(isVisibleActiveTask).map(t => t.id);
    expect(activeIds).toEqual(['gbcol_mid1']);
    const hiddenMakeup = deduped.find(t => t.id === 'task_local_makeup_phys1');
    expect(hiddenMakeup?.visibility).toBe('hidden');
    expect(hiddenMakeup?.hiddenReason).toBe('makeup_completed');
    expect(hiddenMakeup?.weight).toBeUndefined();
    expect(hiddenMakeup?.ignoreMark).toBe(true);
  });

  it('routes superseded makeup exam to Hidden (for friend lookup) and excludes it from ICS feed while preserving across sync', async () => {
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
      room: 'A12-102',
      description: 'The makeup exam for those who missed the midterm is scheduled on Tuesday 27-10-2026.',
      sourceSnippet: 'The makeup exam for those who missed the midterm is scheduled on Tuesday 27-10-2026.'
    });

    const saved = await saveTasksMergingLatest([completedMidterm, makeupMidterm]);
    expect(saved.filter(isVisibleActiveTask).map(t => t.id)).toEqual(['task_mid_done']);
    const hiddenItem = saved.find(t => t.id === 'task_stale_makeup');
    expect(hiddenItem?.visibility).toBe('hidden');
    expect(hiddenItem?.room).toBe('A12-102');
    expect(hiddenItem?.weight).toBeUndefined();
    expect(hiddenItem?.ignoreMark).toBe(true);

    // Hidden items never leak into ICS calendar exports
    const ics = generateIcsContent(saved);
    expect(ics).toContain('Midterm Exam');
    expect(ics).not.toContain('makeup exam');

    // Syncing keeps it hidden without turning it back into an active deadline
    const cloudMerged = mergeCloudTasks(saved, [completedMidterm, makeupMidterm], {});
    const evaluated = evaluateTaskList(cloudMerged.tasks);
    expect(evaluated.filter(isVisibleActiveTask).map(t => t.id)).toEqual(['task_mid_done']);
    expect(evaluated.find(t => t.id === 'task_stale_makeup')?.visibility).toBe('hidden');
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
    expect(deduped.filter(isVisibleActiveTask).some(t => t.id === 'task_stray_q')).toBe(false);
    const hiddenQuiz = deduped.find(t => t.id === 'task_stray_q');
    expect(hiddenQuiz?.visibility).toBe('hidden');
    expect(hiddenQuiz?.hiddenReason).toBe('quota_exhausted');
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

  it('suppresses "Assignments 1-3 (Extended Deadline)" when Assignments 1, 2, and 3 are all completed, and strips grade allocation if one is still missed', () => {
    const calcCourse: UserCourseConfig = {
      id: 'course_1440133_2flz',
      courseCode: '1440133',
      courseName: 'Calculus I for Engineering',
      colorHex: '#dc2626',
      creditHours: 3,
      aliases: ['1440 133'],
      scheduleSlots: [],
      syllabus: [
        { id: 'calc1_assignments', name: 'Homeworks', type: 'assignment', totalWeight: 10, count: 3, outOf: 4, unitWeight: 3.3, keywords: ['assignment', 'hw'] },
        { id: 'calc1_final', name: 'Final Exam', type: 'exam', totalWeight: 40, count: 1, keywords: ['final'] }
      ]
    };
    setActiveUserCourses([calcCourse]);

    expect(extractReferencedAssessmentNumbers('Assignments 1-3 (Extended Deadline)')).toEqual([1, 2, 3]);
    expect(extractReferencedAssessmentNumbers('Assignments 1, 2, and 3')).toEqual([1, 2, 3]);

    const a1 = makeTask({ id: 'a1', courseCode: '1440 133', courseName: 'Calculus I for Engineering', title: 'Assignment 1', type: 'assignment', dueDate: '2026-09-18T18:59:00.000Z', status: 'completed', submissionStatus: 'graded', score: 15, maxScore: 15, weight: 3.3 });
    const a2 = makeTask({ id: 'a2', courseCode: '1440 133', courseName: 'Calculus I for Engineering', title: 'Assignment 2', type: 'assignment', dueDate: '2026-10-08T19:00:00.000Z', status: 'completed', submissionStatus: 'graded', score: 10, maxScore: 10, weight: 3.3 });
    const a3 = makeTask({ id: 'a3', courseCode: '1440 133', courseName: 'Calculus I for Engineering', title: 'Assignment 3', type: 'assignment', dueDate: '2026-11-19T19:59:00.000Z', status: 'completed', submissionStatus: 'graded', score: 10, maxScore: 10, weight: 3.3 });
    const a4 = makeTask({ id: 'a4', courseCode: '1440 133', courseName: 'Calculus I for Engineering', title: 'Assignment 4', type: 'assignment', dueDate: '2026-12-03T08:30:00.000Z', status: 'pending', weight: 3.3 });
    const ext = makeTask({
      id: 'task_ai_ext_1_3',
      courseCode: '1440 133',
      courseName: 'Calculus I for Engineering',
      title: 'Assignments 1-3 (Extended Deadline)',
      type: 'assignment',
      dueDate: '2026-12-02T08:30:00.000Z',
      description: 'This is your chance to do a missed assignment.',
      sourceSnippet: 'This is your chance to do a missed assignment.',
      extractedBy: 'ai',
      weight: 3.3,
      weightDisplay: '3.3% (Homeworks 1 of 3)'
    });

    // Case 1: All 1, 2, 3 completed -> routed to Hidden (extension_completed) with zero grade allocation
    expect(isCompletedExtensionOrRangeTask(ext, [a1, a2, a3, a4, ext])).toBe(true);
    const dedupedAllDone = deduplicateTaskList([a1, a2, a3, a4, ext]);
    expect(dedupedAllDone.filter(isVisibleActiveTask).some(t => t.id === 'task_ai_ext_1_3')).toBe(false);
    const hiddenExt = dedupedAllDone.find(t => t.id === 'task_ai_ext_1_3');
    expect(hiddenExt?.visibility).toBe('hidden');
    expect(hiddenExt?.hiddenReason).toBe('extension_completed');
    expect(hiddenExt?.weight).toBeUndefined();
    expect(hiddenExt?.ignoreMark).toBe(true);
    expect(explainTaskDecision(hiddenExt!, dedupedAllDone).some(line => line.includes('B5.2.1'))).toBe(true);

    // Case 2: Assignment 3 NOT completed yet -> kept Active as a Due Date reminder, weight stripped & excluded from Target GPA
    const a3Pending = { ...a3, status: 'pending' as const, submissionStatus: undefined, score: undefined, maxScore: undefined };
    const dedupedMissedOne = deduplicateTaskList([a1, a2, a3Pending, a4, ext]);
    const keptExt = dedupedMissedOne.find(t => t.id === 'task_ai_ext_1_3');
    expect(keptExt).toBeTruthy();
    expect(keptExt?.visibility).toBeUndefined();
    expect(keptExt?.weight).toBeUndefined();
    expect(keptExt?.weightDisplay).toBeUndefined();
    expect(keptExt?.ignoreMark).toBe(true);

    // Case 3: Post-exam review session with a date is captured as a Hidden reference card
    const reviewTask = extractHiddenReviewSessionTask({
      id: 'ann_rev_1',
      courseCode: '1430 115',
      courseName: 'Physics 1',
      title: 'Exam sheet review',
      postedAt: '2026-10-28T10:00:00.000Z',
      contentText: 'You can review your exam sheet tomorrow (Thursday 29th) from 2:00 pm to 2:30 pm in room M10-104.',
      sourceUrl: '',
      scannedAt: '2026-10-28T10:00:00.000Z'
    });
    expect(reviewTask).not.toBeNull();
    expect(reviewTask?.visibility).toBe('hidden');
    expect(reviewTask?.hiddenReason).toBe('review_session');
    expect(reviewTask?.room).toBe('M10-104');
    expect(reviewTask?.ignoreMark).toBe(true);

    const targetAnalysis = calculateCourseTargetAnalysis(
      {
        courseName: 'Calculus I for Engineering',
        creditHours: 3,
        gradedWeight: 56.6,
        earnedWeight: 50,
        percent: 88.3,
        letter: 'B+',
        points: 3.5,
        components: []
      },
      dedupedMissedOne
    );
    const targetA = targetAnalysis.targets.find(t => t.letter === 'A');
    expect(targetA?.upcomingTasks?.some(u => u.id === 'task_ai_ext_1_3')).toBe(false);

    setActiveUserCourses([]);
  });

  it('bumps updatedAt on Rulebook visibility transition so mergeCloudTasks persists hidden state and catches unnumbered makeup quizzes', () => {
    const staleStamp = '2026-10-20T00:00:00.000Z';
    const completedMidterm: DeadlineTask = {
      id: 'phys_midterm_done',
      courseCode: '1430 115',
      courseName: 'Physics 1',
      title: 'Midterm Exam',
      description: '',
      dueDate: '2026-10-18T10:00:00.000Z',
      hasSpecificTime: true,
      type: 'exam',
      priority: 'high',
      status: 'completed',
      submissionStatus: 'graded',
      score: 21,
      maxScore: 25,
      sourceSnippet: '',
      confidence: 1,
      extractedBy: 'local',
      createdAt: staleStamp,
      updatedAt: staleStamp
    };
    const pendingMakeup: DeadlineTask = {
      id: 'phys_makeup_stale',
      courseCode: '1430 115',
      courseName: 'Physics 1',
      title: 'makeup exam',
      description: 'The makeup exam for those who missed the midterm is scheduled on Oct 27.',
      dueDate: '2026-10-27T13:00:00.000Z',
      hasSpecificTime: true,
      type: 'exam',
      priority: 'high',
      status: 'pending',
      weight: 25,
      weightDisplay: '25% (Midterm Exam)',
      sourceSnippet: 'makeup exam for those who missed the midterm',
      confidence: 1,
      extractedBy: 'local',
      createdAt: staleStamp,
      updatedAt: staleStamp
    };
    const completedQuiz1: DeadlineTask = {
      id: 'phys_quiz_1',
      courseCode: '1430 115',
      courseName: 'Physics 1',
      title: 'Quiz 1',
      description: '',
      dueDate: '2026-10-05T08:30:00.000Z',
      hasSpecificTime: true,
      type: 'quiz',
      priority: 'medium',
      status: 'completed',
      sourceSnippet: '',
      confidence: 1,
      extractedBy: 'local',
      createdAt: staleStamp,
      updatedAt: staleStamp
    };
    const pendingUnnumberedMakeupQuiz: DeadlineTask = {
      id: 'phys_makeup_quiz',
      courseCode: '1430 115',
      courseName: 'Physics 1',
      title: 'Makeup Quiz',
      description: 'Makeup quiz for students who missed the quiz.',
      dueDate: '2026-10-12T08:30:00.000Z',
      hasSpecificTime: true,
      type: 'quiz',
      priority: 'medium',
      status: 'pending',
      sourceSnippet: 'Makeup quiz for students who missed the quiz.',
      confidence: 1,
      extractedBy: 'local',
      createdAt: staleStamp,
      updatedAt: staleStamp
    };

    const evaluated = evaluateTaskList([completedMidterm, pendingMakeup, completedQuiz1, pendingUnnumberedMakeupQuiz]);
    const hiddenMidtermMakeup = evaluated.find(t => t.id === 'phys_makeup_stale');
    const hiddenQuizMakeup = evaluated.find(t => t.id === 'phys_makeup_quiz');

    expect(hiddenMidtermMakeup?.visibility).toBe('hidden');
    expect(hiddenMidtermMakeup?.hiddenReason).toBe('makeup_completed');
    expect(hiddenMidtermMakeup?.ignoreMark).toBe(true);
    expect(Date.parse(hiddenMidtermMakeup!.updatedAt)).toBeGreaterThan(Date.parse(staleStamp));

    expect(hiddenQuizMakeup?.visibility).toBe('hidden');
    expect(hiddenQuizMakeup?.hiddenReason).toBe('makeup_completed');

    // Cloud sync carrying stale pre-Rulebook active snapshot must not wipe hidden fields
    const cloudStaleCopy: DeadlineTask[] = [
      { ...completedMidterm },
      { ...pendingMakeup },
      { ...completedQuiz1 },
      { ...pendingUnnumberedMakeupQuiz }
    ];
    const merged = mergeCloudTasks(evaluated, cloudStaleCopy, {});
    const afterCloud = deduplicateTaskList(merged.tasks);
    expect(afterCloud.find(t => t.id === 'phys_makeup_stale')?.visibility).toBe('hidden');
    expect(afterCloud.find(t => t.id === 'phys_makeup_quiz')?.visibility).toBe('hidden');

    // When a cloud copy explicitly restores visibilityLocked='active', OPTIONAL_FIELDS clears visibility
    const restoredCloud = {
      ...pendingMakeup,
      visibilityLocked: 'active' as const,
      updatedAt: new Date(Date.now() + 60_000).toISOString()
    };
    const mergedRestore = mergeCloudTasks(evaluated, [completedMidterm, restoredCloud], {});
    expect(mergedRestore.tasks.find(t => t.id === 'phys_makeup_stale')?.visibility).toBeUndefined();
    expect(mergedRestore.tasks.find(t => t.id === 'phys_makeup_stale')?.visibilityLocked).toBe('active');
  });

  it('hides Makeup Assignment and reversed-order Midterm Make-up when original work is completed', () => {
    const completedAssign1: DeadlineTask = {
      id: 'assign_1_done',
      courseCode: '1440 133',
      courseName: 'Calculus I for Engineering',
      title: 'Assignment 1',
      description: '',
      dueDate: '2026-10-01T19:00:00.000Z',
      hasSpecificTime: true,
      type: 'assignment',
      priority: 'medium',
      status: 'completed',
      sourceSnippet: '',
      confidence: 1,
      extractedBy: 'local',
      createdAt: '2026-09-25T00:00:00.000Z',
      updatedAt: '2026-10-01T19:00:00.000Z'
    };
    const makeupAssign: DeadlineTask = {
      id: 'assign_makeup_1',
      courseCode: '1440 133',
      courseName: 'Calculus I for Engineering',
      title: 'Makeup Assignment',
      description: 'Makeup assignment for those who missed the homework.',
      dueDate: '2026-10-20T19:00:00.000Z',
      hasSpecificTime: true,
      type: 'assignment',
      priority: 'medium',
      status: 'pending',
      sourceSnippet: 'Makeup assignment for those who missed the homework.',
      confidence: 1,
      extractedBy: 'local',
      createdAt: '2026-10-15T00:00:00.000Z',
      updatedAt: '2026-10-15T00:00:00.000Z'
    };
    const completedPhysMidterm: DeadlineTask = {
      id: 'phys_midterm_only',
      courseCode: '1430 115',
      courseName: 'Physics 1',
      title: 'Midterm',
      description: '',
      dueDate: '2026-10-18T10:00:00.000Z',
      hasSpecificTime: true,
      type: 'exam',
      priority: 'high',
      status: 'completed',
      sourceSnippet: '',
      confidence: 1,
      extractedBy: 'local',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-18T10:00:00.000Z'
    };
    const reversedMidtermMakeup: DeadlineTask = {
      id: 'phys_midterm_makeup_rev',
      courseCode: '1430 115',
      courseName: 'Physics 1',
      title: 'Midterm Make-up',
      description: 'For students who missed the midterm.',
      dueDate: '2026-10-27T13:00:00.000Z',
      hasSpecificTime: true,
      type: 'exam',
      priority: 'high',
      status: 'pending',
      sourceSnippet: 'For students who missed the midterm.',
      confidence: 1,
      extractedBy: 'local',
      createdAt: '2026-10-21T00:00:00.000Z',
      updatedAt: '2026-10-21T00:00:00.000Z'
    };

    const evaluated = evaluateTaskList([completedAssign1, makeupAssign, completedPhysMidterm, reversedMidtermMakeup]);
    expect(evaluated.find(t => t.id === 'assign_makeup_1')?.visibility).toBe('hidden');
    expect(evaluated.find(t => t.id === 'assign_makeup_1')?.hiddenReason).toBe('makeup_completed');
    expect(evaluated.find(t => t.id === 'phys_midterm_makeup_rev')?.visibility).toBe('hidden');
    expect(evaluated.find(t => t.id === 'phys_midterm_makeup_rev')?.hiddenReason).toBe('makeup_completed');
  });
});
