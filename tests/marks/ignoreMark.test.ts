import { describe, expect, it } from 'vitest';
import { DeadlineTask } from '../../src/types';
import { UOS_GRADE_SCALE, buildGpaSummary, type GpaSyllabus } from '../../src/utils/marks/gpa';
import { buildMarksSummary, toggleMarkIgnoredInTasks } from '../../src/utils/marks/marks';
import { gradesBadgeText, gradesHtml } from '../../src/utils/marks/grades';
import { sanitizeCloudTasks } from '../../src/utils/sync/cloudSanitize';
import { mergeCloudTasks } from '../../src/utils/tasks/taskMerge';
import { applySubmissionUpdates } from '../../src/utils/marks/gradebook';

function makeMarkTask(overrides: Partial<DeadlineTask>): DeadlineTask {
  return {
    id: 'gbcol_c1',
    courseCode: 'CS101',
    courseName: 'Intro to CS',
    title: 'Quiz 1',
    description: '',
    dueDate: '',
    hasSpecificTime: false,
    type: 'quiz',
    priority: 'medium',
    status: 'completed',
    submissionStatus: 'graded',
    score: 20,
    maxScore: 25,
    weight: 10,
    sourceSnippet: 'gradebook',
    confidence: 1,
    extractedBy: 'local',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides
  };
}

describe('Ignore Mark in Marks Tab & GPA Calculations', () => {
  const syllabi: GpaSyllabus[] = [
    {
      courseName: 'Intro to CS',
      courseCodePattern: /CS101|Intro to CS/i,
      totalWeight: 100,
      creditHours: 3,
      components: [
        { name: 'Quizzes', type: 'quiz', totalWeight: 20, count: 2, matcher: /quiz/i },
        { name: 'Midterm Exam', type: 'exam', totalWeight: 30, matcher: /midterm/i }
      ]
    }
  ];

  it('excludes ignored duplicate/aggregate columns from GPA and course totals while keeping them listed in Marks', () => {
    const tasks: DeadlineTask[] = [
      makeMarkTask({ id: 'gbcol_q1', title: 'Quiz1', type: 'quiz', score: 25, maxScore: 25, weight: 10, gradeSourceId: 'gb:_q1' }),
      makeMarkTask({ id: 'gbcol_mid', title: 'Midterm', type: 'exam', score: 30, maxScore: 30, weight: 30, gradeSourceId: 'gb:_mid' }),
      // Aggregate column from professor gradebook (e.g. "Out of 55" or "CourseWork_without_Bonus") with lower %
      makeMarkTask({ id: 'gbcol_cw_nobonus', title: 'CourseWork_without_Bonus', type: 'other', score: 15, maxScore: 25, weight: 25, gradeSourceId: 'gb:_cw0', ignoreMark: true }),
      // Ignored bonus mark so it does not double count
      makeMarkTask({ id: 'gbcol_bonus_dup', title: 'CourseWork_with_Bonus', type: 'other', isBonus: true, score: 22, maxScore: 25, weight: 25, gradeSourceId: 'gb:_cwb', ignoreMark: true })
    ];

    const gpa = buildGpaSummary(tasks, syllabi, UOS_GRADE_SCALE);
    expect(gpa.courses).toHaveLength(1);
    expect(gpa.courses[0].percent).toBe(100);
    expect(gpa.courses[0].letter).toBe('A');
    expect(gpa.gpa).toBe(4.0);

    const marks = buildMarksSummary(tasks, [
      { courseName: 'Intro to CS', courseCodePattern: /CS101|Intro to CS/i, totalWeight: 100 }
    ]);
    // Only non-ignored marks count towards header count & course totals
    expect(marks.gradedCount).toBe(2);
    expect(marks.courses[0].marks).toHaveLength(4);
    expect(marks.courses[0].marks.filter(m => m.ignoreMark)).toHaveLength(2);
    // Ignored rows stay sorted below active rows and display "Ignored" badge + toggle button
    const html = gradesHtml(gpa, marks, () => '#4b99d2', { name: 'UOS', scale: UOS_GRADE_SCALE });
    expect(html).toContain('marks-row--ignored');
    expect(html).toContain('marks-ignored-pill');
    expect(html).toContain('btn-toggle-ignore-mark');
    expect(gradesBadgeText(gpa, marks)).toContain('GPA 4.00 · 2 marks');
  });

  it('toggles ignoreMark cleanly and restores calculation when unignored', () => {
    const initial: DeadlineTask[] = [
      makeMarkTask({ id: 'gbcol_q1', title: 'Quiz1', type: 'quiz', score: 20, maxScore: 20, weight: 10 }),
      makeMarkTask({ id: 'gbcol_out55', title: 'Out of 55', type: 'assignment', score: 27.5, maxScore: 55, weight: 30 })
    ];

    const ignoredRes = toggleMarkIgnoredInTasks(initial, 'gbcol_out55');
    expect(ignoredRes.ignored).toBe(true);
    const gpaIgnored = buildGpaSummary(ignoredRes.tasks, syllabi, UOS_GRADE_SCALE);
    expect(gpaIgnored.courses[0].percent).toBe(100);

    const restoredRes = toggleMarkIgnoredInTasks(ignoredRes.tasks, 'gbcol_out55');
    expect(restoredRes.ignored).toBe(false);
    expect(restoredRes.tasks.find(t => t.id === 'gbcol_out55')?.ignoreMark).toBeUndefined();
    const gpaRestored = buildGpaSummary(restoredRes.tasks, syllabi, UOS_GRADE_SCALE);
    expect(gpaRestored.courses[0].percent).toBeLessThan(70);
  });

  it('preserves ignoreMark across cloud sanitize, cloud merge, and subsequent Blackboard gradebook scans', () => {
    const task = makeMarkTask({
      id: 'gbcol_out55',
      title: 'Out of 55',
      gradeSourceId: 'gb:_55',
      score: 48,
      maxScore: 55,
      ignoreMark: true,
      updatedAt: '2026-11-20T12:00:00.000Z'
    });

    const sanitized = sanitizeCloudTasks([task]);
    expect(sanitized[0].ignoreMark).toBe(true);

    const unignoredCloud = { ...task, ignoreMark: undefined, updatedAt: '2026-11-20T13:00:00.000Z' };
    const merged = mergeCloudTasks([task], [unignoredCloud]);
    expect(merged.tasks[0].ignoreMark).toBeUndefined();

    // Gradebook re-scan updating score on an ignored task keeps ignoreMark: true
    const scanTarget = [{ ...task }];
    applySubmissionUpdates(scanTarget, [
      {
        courseCode: 'CS101',
        courseName: 'Intro to CS',
        title: 'Out of 55',
        submissionStatus: 'graded',
        score: 50,
        maxScore: 55,
        sourceId: 'gb:_55',
        gradedAt: '2026-11-20T14:00:00.000Z'
      }
    ]);
    expect(scanTarget[0].score).toBe(50);
    expect(scanTarget[0].ignoreMark).toBe(true);
  });
});
