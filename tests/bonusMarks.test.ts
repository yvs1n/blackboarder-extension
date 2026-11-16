import { describe, it, expect } from 'vitest';
import { buildMarksSummary, deleteMarkFromTasks } from '../src/utils/marks';
import { applySubmissionUpdates } from '../src/utils/gradebook';
import { buildGpaSummary, UOS_GRADE_SCALE } from '../src/utils/gpa';
import { calculateCourseTargetAnalysis } from '../src/core/targetGpa';
import { userCoursesToSyllabi, setActiveUserCourses } from '../src/core/userCourses';
import { bonusTargetOptionsForCourse, formatTaskWeightDisplay } from '../src/core/syllabusWeights';
import { sanitizeCloudTasks } from '../src/utils/cloudSanitize';
import { gradesHtml } from '../src/utils/grades';
import { DeadlineTask, UserCourseConfig } from '../src/types';

describe('Bonus Marks (Extra Credit) functionality', () => {
  const sampleCourses = [
    {
      id: 'c1',
      courseName: 'Computer Networks',
      courseCode: 'CS301',
      creditHours: 3,
      colorHex: '#2563eb',
      aliases: [],
      scheduleSlots: [],
      syllabus: [
        { id: 's1', name: 'Midterm', type: 'exam', totalWeight: 30 },
        { id: 's2', name: 'Final Exam', type: 'exam', totalWeight: 50 },
        { id: 's3', name: 'Quizzes', type: 'quiz', totalWeight: 20, count: 2, outOf: 2 }
      ]
    }
  ] as unknown as UserCourseConfig[];

  const syllabi = userCoursesToSyllabi(sampleCourses);

  it('aggregates bonus marks into earnedWeight without inflating gradedWeight in buildMarksSummary', () => {
    const tasks = [
      {
        id: 't1',
        title: 'Midterm Exam',
        courseName: 'Computer Networks',
        dueDate: '2026-10-15T10:00:00Z',
        type: 'exam',
        status: 'completed',
        submissionStatus: 'graded',
        score: 25,
        maxScore: 30,
        weight: 30
      },
      {
        id: 't_bonus',
        title: 'Network Simulation Bonus',
        courseName: 'Computer Networks',
        dueDate: '2026-10-20T10:00:00Z',
        type: 'other',
        status: 'completed',
        submissionStatus: 'graded',
        score: 3,
        maxScore: 3,
        weight: 3,
        isBonus: true
      }
    ] as unknown as DeadlineTask[];

    const summary = buildMarksSummary(tasks, syllabi);
    expect(summary.courses.length).toBe(1);
    const course = summary.courses[0];

    // Regular midterm: 25/30 * 30 = 25 marks. Graded weight = 30.
    // Bonus: +3 marks directly to earned. Graded weight remains 30!
    expect(course.earnedWeight).toBe(28); // 25 + 3
    expect(course.gradedWeight).toBe(30);
    expect(course.bonusWeight).toBe(3);

    // Verify marks list
    expect(course.marks.length).toBe(2);
    const bonusRow = course.marks.find(r => r.title === 'Network Simulation Bonus');
    expect(bonusRow).toBeDefined();
    expect(bonusRow?.isBonus).toBe(true);
  });

  it('calculates boosted course percentage and caps at 100% in buildGpaSummary', () => {
    const tasks = [
      {
        id: 't1',
        title: 'Midterm Exam',
        courseName: 'Computer Networks',
        dueDate: '2026-10-15T10:00:00Z',
        type: 'exam',
        status: 'completed',
        submissionStatus: 'graded',
        score: 26,
        maxScore: 30,
        weight: 30 // 26 / 30 = 86.67% -> B+ without bonus on UOS scale (cutoff 85)
      },
      {
        id: 't_bonus',
        title: 'Seminar Attendance Bonus',
        courseName: 'Computer Networks',
        dueDate: '2026-10-22T10:00:00Z',
        type: 'other',
        status: 'completed',
        submissionStatus: 'graded',
        score: 2,
        maxScore: 2,
        weight: 2,
        isBonus: true // Adds +2 to earned -> 28 / 30 = 93.3% -> A!
      }
    ] as unknown as DeadlineTask[];

    const gpaSummary = buildGpaSummary(tasks, syllabi, UOS_GRADE_SCALE);
    expect(gpaSummary.courses.length).toBe(1);
    const c = gpaSummary.courses[0];

    expect(c.earnedWeight).toBe(28);
    expect(c.gradedWeight).toBe(30);
    expect(c.bonusWeight).toBe(2);
    expect(c.percent).toBeCloseTo(93.3, 1);
    expect(c.letter).toBe('A');
    expect(c.points).toBe(4.0);
  });

  it('reduces upcoming assessment requirements in target analysis when bonus marks are present', () => {
    // 30% graded out of 100%. Remaining weight = 70%.
    // Base case: 24 points earned. Target A (90%):
    // Need (90 - 24) / 70 = 66 / 70 = 94.3%
    const baseGrade = {
      courseName: 'Computer Networks',
      creditHours: 3,
      earnedWeight: 24,
      gradedWeight: 30,
      percent: 80,
      letter: 'B',
      points: 3.0,
      components: []
    };

    const targetAnalysisBase = calculateCourseTargetAnalysis(baseGrade, [], UOS_GRADE_SCALE);
    const targetABase = targetAnalysisBase.targets.find(t => t.letter === 'A');
    expect(targetABase?.requiredPercent).toBeCloseTo(94.3, 1);

    // Case with +3% bonus mark: 27 points earned out of 30 graded weight.
    // Need (90 - 27) / 70 = 63 / 70 = 90.0%
    const bonusGrade = {
      ...baseGrade,
      earnedWeight: 27,
      bonusWeight: 3
    };

    const targetAnalysisBonus = calculateCourseTargetAnalysis(bonusGrade, [], UOS_GRADE_SCALE);
    const targetABonus = targetAnalysisBonus.targets.find(t => t.letter === 'A');
    expect(targetABonus?.requiredPercent).toBeCloseTo(90.0, 1);

    expect(targetABonus?.requiredPercent).toBeLessThan(targetABase?.requiredPercent || 100);
  });

  it('preserves isBonus during cloud task sanitization', () => {
    const rawTasks = [
      {
        id: 'task_bonus_1',
        title: 'Extra Credit Hackathon',
        courseName: 'CS 101',
        dueDate: '2026-11-01T00:00:00Z',
        status: 'completed',
        submissionStatus: 'graded',
        score: 5,
        maxScore: 5,
        weight: 5,
        isBonus: true
      },
      {
        id: 'task_normal',
        title: 'Standard Quiz',
        courseName: 'CS 101',
        dueDate: '2026-11-02T00:00:00Z',
        status: 'completed',
        submissionStatus: 'graded',
        score: 10,
        maxScore: 10,
        weight: 10,
        isBonus: false
      }
    ];

    const sanitized = sanitizeCloudTasks(rawTasks);
    expect(sanitized[0].isBonus).toBe(true);
    expect(sanitized[1].isBonus).toBeUndefined();
  });

  it('renders bonus indicators and buttons in gradesHtml', () => {
    const tasks = [
      {
        id: 't_mid',
        title: 'Midterm Exam',
        courseName: 'Computer Networks',
        dueDate: '2026-10-15T10:00:00Z',
        type: 'exam',
        status: 'completed',
        submissionStatus: 'graded',
        score: 25,
        maxScore: 30,
        weight: 30
      },
      {
        id: 't_bonus',
        title: 'Doctor Bonus Mark',
        courseName: 'Computer Networks',
        dueDate: '2026-11-01T10:00:00Z',
        type: 'other',
        status: 'completed',
        submissionStatus: 'graded',
        score: 2,
        maxScore: 2,
        weight: 2,
        isBonus: true
      }
    ] as unknown as DeadlineTask[];

    const gpa = buildGpaSummary(tasks, syllabi, UOS_GRADE_SCALE);
    const marks = buildMarksSummary(tasks, syllabi);
    const html = gradesHtml(
      gpa,
      marks,
      () => '#2563eb',
      { name: 'UOS', scale: UOS_GRADE_SCALE },
      undefined,
      { tasks }
    );

    // Assert badges and buttons exist
    expect(html).toContain('btn-add-course-bonus');
    expect(html).toContain('btn-add-bonus-trigger');
    expect(html).toContain('marks-row-bonus');
    expect(html).toContain('+2% extra credit');
    expect(html).toContain('+2% Bonus');
  });

  it('does NOT count pending upcoming bonus deadlines until graded, and supports bonusTarget on Course Total vs syllabus component', () => {
    setActiveUserCourses(sampleCourses);
    const options = bonusTargetOptionsForCourse('Computer Networks', 'CS301');
    expect(options[0].value).toBe('total');
    expect(options.some(o => o.value === 'comp:s3' && o.shortLabel === 'Quizzes')).toBe(true);
    expect(formatTaskWeightDisplay(2, { isBonus: true, bonusTarget: 'total', bonusTargetLabel: 'Course Total' }))
      .toBe('+2 Bonus (Course Total)');
    expect(formatTaskWeightDisplay(2, { isBonus: true, bonusTarget: 'comp:s3', bonusTargetLabel: 'Quizzes' }))
      .toBe('+2 Bonus (Quizzes)');

    // 1. Pending upcoming bonus quiz (not graded yet) must NOT award bonus marks prematurely
    const tasksWithPendingBonus = [
      {
        id: 't_mid',
        title: 'Midterm Exam',
        courseName: 'Computer Networks',
        dueDate: '2026-10-15T10:00:00Z',
        type: 'exam',
        status: 'completed',
        submissionStatus: 'graded',
        score: 24,
        maxScore: 30,
        weight: 30
      },
      {
        id: 't_pending_bonus_quiz',
        title: 'Bonus Quiz',
        courseName: 'Computer Networks',
        dueDate: '2026-11-25T10:00:00Z',
        type: 'quiz',
        status: 'pending',
        weight: 2,
        isBonus: true,
        bonusTarget: 'total',
        bonusTargetLabel: 'Course Total'
      }
    ] as unknown as DeadlineTask[];

    const gpaBeforeGrade = buildGpaSummary(tasksWithPendingBonus, syllabi, UOS_GRADE_SCALE);
    expect(gpaBeforeGrade.courses[0].earnedWeight).toBe(24);
    expect(gpaBeforeGrade.courses[0].bonusWeight).toBeUndefined();

    // 2. Once graded (pure 2 marks added even after full regular syllabus percentage: 88/100 + 2 pure = 90% -> A!)
    const fullTermWithPureBonus = [
      {
        id: 't_mid', title: 'Midterm', courseName: 'Computer Networks', dueDate: '2026-10-15T10:00:00Z',
        type: 'exam', status: 'completed', submissionStatus: 'graded', score: 26, maxScore: 30, weight: 30
      },
      {
        id: 't_fin', title: 'Final Exam', courseName: 'Computer Networks', dueDate: '2026-12-15T10:00:00Z',
        type: 'exam', status: 'completed', submissionStatus: 'graded', score: 44, maxScore: 50, weight: 50
      },
      {
        id: 't_q1', title: 'Quiz 1', courseName: 'Computer Networks', dueDate: '2026-10-05T10:00:00Z',
        type: 'quiz', status: 'completed', submissionStatus: 'graded', score: 9, maxScore: 10, weight: 10
      },
      {
        id: 't_q2', title: 'Quiz 2', courseName: 'Computer Networks', dueDate: '2026-11-05T10:00:00Z',
        type: 'quiz', status: 'completed', submissionStatus: 'graded', score: 9, maxScore: 10, weight: 10
      },
      {
        id: 't_pure_bonus', title: 'Bonus Quiz', courseName: 'Computer Networks', dueDate: '2026-11-25T10:00:00Z',
        type: 'quiz', status: 'completed', submissionStatus: 'graded', score: 2, maxScore: 2, weight: 2,
        isBonus: true, bonusTarget: 'total', bonusTargetLabel: 'Course Total'
      }
    ] as unknown as DeadlineTask[];

    const gpaPure = buildGpaSummary(fullTermWithPureBonus, syllabi, UOS_GRADE_SCALE);
    expect(gpaPure.courses[0].gradedWeight).toBe(100);
    expect(gpaPure.courses[0].earnedWeight).toBe(90); // 26 + 44 + 18 + 2
    expect(gpaPure.courses[0].percent).toBe(90);
    expect(gpaPure.courses[0].letter).toBe('A');

    // 3. Component-targeted bonus (+5 on Quizzes where Quizzes already has 18/20): caps boost at 20/20 (+2 applied)
    const compBonusTasks = [
      ...fullTermWithPureBonus.slice(0, 4),
      {
        id: 't_quiz_bonus', title: 'Quiz Extra Credit', courseName: 'Computer Networks', dueDate: '2026-11-25T10:00:00Z',
        type: 'quiz', status: 'completed', submissionStatus: 'graded', score: 5, maxScore: 5, weight: 5,
        isBonus: true, bonusTarget: 'comp:s3', bonusTargetLabel: 'Quizzes'
      }
    ] as unknown as DeadlineTask[];
    const gpaComp = buildGpaSummary(compBonusTasks, syllabi, UOS_GRADE_SCALE);
    expect(gpaComp.courses[0].bonusWeight).toBe(2); // 18 + 2 = 20 max for Quizzes
    expect(gpaComp.courses[0].earnedWeight).toBe(90);

    // 4. Cloud sanitization preserves bonusTarget & bonusTargetLabel when isBonus is true and removes them when false
    const sanitized = sanitizeCloudTasks([
      fullTermWithPureBonus[4],
      { ...fullTermWithPureBonus[0], bonusTarget: 'comp:s3', bonusTargetLabel: 'Quizzes' }
    ]);
    expect(sanitized[0].bonusTarget).toBe('total');
    expect(sanitized[0].bonusTargetLabel).toBe('Course Total');
    expect(sanitized[1].bonusTarget).toBeUndefined();
    expect(sanitized[1].bonusTargetLabel).toBeUndefined();
  });

  it('deletes standalone bonus/gradebook marks and clears marks from scheduled deadlines cleanly', () => {
    const bonusTask = {
      id: 'task_bonus_12345',
      title: 'Participation Bonus',
      courseName: 'Computer Networks',
      courseCode: 'CS301',
      dueDate: '2026-11-16T10:00:00Z',
      type: 'other',
      status: 'completed',
      submissionStatus: 'graded',
      score: 2,
      maxScore: 2,
      weight: 2,
      isBonus: true,
      bonusTarget: 'total',
      bonusTargetLabel: 'Course Total',
      extractedBy: 'manual'
    } as unknown as DeadlineTask;

    const gbColTask = {
      id: 'gbcol_CS301__999_1',
      title: 'Lab Exercise 1',
      courseName: 'Computer Networks',
      courseCode: 'CS301',
      dueDate: '',
      type: 'lab',
      status: 'completed',
      submissionStatus: 'graded',
      score: 10,
      maxScore: 10,
      gradeSourceId: 'gb:_999_1',
      sourceSnippet: 'gradebook'
    } as unknown as DeadlineTask;

    const scheduledQuiz = {
      id: 'task_quiz1',
      title: 'Quiz 1',
      courseName: 'Computer Networks',
      courseCode: 'CS301',
      dueDate: '2026-10-10T10:00:00Z',
      type: 'quiz',
      status: 'completed',
      submissionStatus: 'graded',
      score: 8,
      maxScore: 10,
      weight: 10,
      gradeSourceId: 'gb:_101_1'
    } as unknown as DeadlineTask;

    const list = [bonusTask, gbColTask, scheduledQuiz];

    // 0. gradesHtml exposes delete buttons for bonus & regular marks
    const html = gradesHtml(
      buildGpaSummary(list, syllabi, UOS_GRADE_SCALE),
      buildMarksSummary(list, syllabi),
      () => '#2563eb'
    );
    expect(html).toContain('class="btn-delete-mark" data-mark-id="task_bonus_12345"');
    expect(html).toContain('class="btn-delete-mark" data-mark-id="task_quiz1"');

    // 1. Standalone bonus mark is removed completely
    const delBonus = deleteMarkFromTasks(list, 'task_bonus_12345');
    expect(delBonus.action).toBe('deleted');
    expect(delBonus.tasks.some(t => t.id === 'task_bonus_12345')).toBe(false);

    // 2. Standalone gradebook mark is removed completely
    const delGb = deleteMarkFromTasks(delBonus.tasks, 'gbcol_CS301__999_1');
    expect(delGb.action).toBe('deleted');
    expect(delGb.tasks).toHaveLength(1);

    // 3. Scheduled deadline keeps its deadline while clearing score & dismissing gradeSourceId
    const clearQuiz = deleteMarkFromTasks(delGb.tasks, 'task_quiz1');
    expect(clearQuiz.action).toBe('cleared');
    expect(clearQuiz.tasks).toHaveLength(1);
    const cleanedQuiz = clearQuiz.tasks[0];
    expect(cleanedQuiz.dueDate).toBe('2026-10-10T10:00:00Z');
    expect(cleanedQuiz.score).toBeUndefined();
    expect(cleanedQuiz.maxScore).toBeUndefined();
    expect(cleanedQuiz.submissionStatus).toBeUndefined();
    expect(cleanedQuiz.gradeSourceId).toBeUndefined();
    expect(cleanedQuiz.dismissedGradeSources).toEqual(['gb:_101_1']);

    // 4. Re-scanning the dismissed Blackboard grade column must not re-apply the deleted mark
    const updates = [{
      courseCode: 'CS301',
      courseName: 'Computer Networks',
      title: 'Quiz 1',
      submissionStatus: 'graded' as const,
      score: 8,
      maxScore: 10,
      sourceId: 'gb:_101_1'
    }];
    const updatedCount = applySubmissionUpdates(clearQuiz.tasks, updates);
    expect(updatedCount).toBe(0);
    expect(clearQuiz.tasks[0].score).toBeUndefined();
    expect(clearQuiz.tasks[0].submissionStatus).toBeUndefined();
  });
});
