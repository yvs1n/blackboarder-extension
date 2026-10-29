import { describe, it, expect } from 'vitest';
import { buildGpaSummary, gradeForPercent, bestOfFromNote, UOS_GRADE_SCALE } from '../src/utils/gpa';
import { buildMarksSummary } from '../src/utils/marks';
import { gradesHtml } from '../src/utils/grades';
import { DEFAULT_USER_COURSES, userCoursesToSyllabi } from '../src/core/userCourses';
import { sanitizeCloudCourses } from '../src/utils/cloudSanitize';
import type { DeadlineTask } from '../src/types';

let n = 0;
function mark(courseName: string, title: string, type: DeadlineTask['type'], score: number, maxScore = 10): DeadlineTask {
  return {
    id: `t${++n}`, title, courseName, courseCode: '', type, dueDate: '2026-10-01T09:00:00.000Z',
    status: 'completed', submissionStatus: 'graded', score, maxScore
  } as DeadlineTask;
}

const syllabi = userCoursesToSyllabi(DEFAULT_USER_COURSES);

describe('UOS grade scale', () => {
  it('maps percentages to letters and points', () => {
    expect(gradeForPercent(95)).toEqual({ letter: 'A', points: 4 });
    expect(gradeForPercent(90)).toEqual({ letter: 'A', points: 4 });
    expect(gradeForPercent(89.9)).toEqual({ letter: 'B+', points: 3.5 });
    expect(gradeForPercent(80)).toEqual({ letter: 'B', points: 3 });
    expect(gradeForPercent(77)).toEqual({ letter: 'C+', points: 2.5 });
    expect(gradeForPercent(70)).toEqual({ letter: 'C', points: 2 });
    expect(gradeForPercent(66)).toEqual({ letter: 'D+', points: 1.5 });
    expect(gradeForPercent(60)).toEqual({ letter: 'D', points: 1 });
    expect(gradeForPercent(59.9)).toEqual({ letter: 'F', points: 0 });
    expect(UOS_GRADE_SCALE).toHaveLength(8);
  });
});

describe('best N of M', () => {
  it('reads the rule from syllabus notes', () => {
    expect(bestOfFromNote('On paper, best 2 of 3 quizzes')).toEqual({ count: 2, outOf: 3 });
    expect(bestOfFromNote('4 scheduled, top 3 counted (10% each)')).toEqual({ count: 3, outOf: 4 });
    expect(bestOfFromNote('Best 3 out of 4 quizzes')).toEqual({ count: 3, outOf: 4 });
    expect(bestOfFromNote('Week 8 (20%)')).toBeNull();
  });

  it('default courses carry the rule and credit hours', () => {
    const calc = syllabi.find(s => s.courseName.startsWith('Calculus'))!;
    expect(calc.creditHours).toBe(3);
    expect(calc.components.find(c => c.type === 'quiz')).toMatchObject({ count: 2, outOf: 3 });
    expect(syllabi.find(s => s.courseName === 'Physics 1 Lab')!.creditHours).toBe(1);
  });

  it('counts only the best 2 of 3 quizzes', () => {
    const calc = 'Calculus I for Engineering';
    const s = buildGpaSummary([
      mark(calc, 'Quiz 1', 'quiz', 4),
      mark(calc, 'Quiz 2', 'quiz', 9),
      mark(calc, 'Quiz 3', 'quiz', 8)
    ], syllabi);
    const c = s.courses.find(x => x.courseName === calc)!;
    // Quizzes are 20%: 10% each for the best two (90% and 80%)
    expect(c.gradedWeight).toBe(20);
    expect(c.earnedWeight).toBe(17);
    expect(c.percent).toBe(85);
    expect(c.letter).toBe('B+');
    const quizzes = c.components.find(k => k.name === 'Quizzes')!;
    expect(quizzes.counted.map(i => i.title)).toEqual(['Quiz 2', 'Quiz 3']);
    expect(quizzes.dropped.map(i => i.title)).toEqual(['Quiz 1']);
    expect(quizzes.rule).toBe('best 2 of 3');
  });

  it('with fewer marks than the rule, every mark counts', () => {
    const calc = 'Calculus I for Engineering';
    const c = buildGpaSummary([mark(calc, 'Quiz 1', 'quiz', 7)], syllabi).courses.find(x => x.courseName === calc)!;
    expect(c.gradedWeight).toBe(10);
    expect(c.percent).toBe(70);
  });
});

describe('projected GPA', () => {
  it('weights each course by its credit hours', () => {
    const s = buildGpaSummary([
      mark('Calculus I for Engineering', 'Midterm Exam', 'exam', 27, 30), // 90% -> A (3 cr)
      mark('Physics 1 Lab', 'Lab Quiz 1', 'quiz', 5)                       // 50% -> F (1 cr)
    ], syllabi);
    expect(s.gradedCredits).toBe(4);
    expect(s.gpa).toBe(3); // (4 x 3 + 0 x 1) / 4
    expect(s.totalCredits).toBe(16);
  });

  it('averages a component without a count (Physics 1 quizzes)', () => {
    const c = buildGpaSummary([
      mark('Physics 1', 'Quiz 1', 'quiz', 6),
      mark('Physics 1', 'Quiz 2', 'quiz', 10)
    ], syllabi).courses.find(x => x.courseName === 'Physics 1')!;
    expect(c.gradedWeight).toBe(20);
    expect(c.percent).toBe(80);
  });

  it('has no GPA before the first mark, and ignores ungraded items', () => {
    const t = mark('Physics 1', 'Quiz 1', 'quiz', 6);
    t.submissionStatus = 'submitted';
    const s = buildGpaSummary([t], syllabi);
    expect(s.gpa).toBeUndefined();
    expect(gradesHtml(s, buildMarksSummary([t], syllabi), () => '#000')).toContain('No marks yet');
  });

  it('credit hours survive sync', () => {
    const [c] = sanitizeCloudCourses([{ ...DEFAULT_USER_COURSES[0], creditHours: 4, syllabus: [{ id: 'q', name: 'Quizzes', type: 'quiz', totalWeight: 20, count: 2, outOf: 3 }] }])!;
    expect(c.creditHours).toBe(4);
    expect(c.syllabus[0].outOf).toBe(3);
  });

  it('a synced course without credit hours keeps the default course value', () => {
    const lab = DEFAULT_USER_COURSES.find(c => c.id === 'phy1lab')!;
    const [syl] = userCoursesToSyllabi([{ ...lab, creditHours: undefined }]);
    expect(syl.creditHours).toBe(1);
  });

  it('the card escapes titles and shows the dropped item', () => {
    const tasks = [
      mark('Calculus I for Engineering', 'Quiz <1>', 'quiz', 2),
      mark('Calculus I for Engineering', 'Quiz 2', 'quiz', 9),
      mark('Calculus I for Engineering', 'Quiz 3', 'quiz', 9)
    ];
    const html = gradesHtml(buildGpaSummary(tasks, syllabi), buildMarksSummary(tasks, syllabi), () => '#000');
    expect(html).toContain('Quiz &lt;1&gt; 20%');
    expect(html).toContain('best 2 of 3');
    expect(html).not.toMatch(/—/);
  });
  it('deduplicates duplicate tasks so an item is never counted or dropped twice', () => {
    const tasks = [
      mark('Calculus I for Engineering', 'Quiz 1', 'quiz', 9),
      mark('Calculus I for Engineering', 'Quiz 1', 'quiz', 9),
      mark('Calculus I for Engineering', 'Quiz 2', 'quiz', 10)
    ];
    const s = buildGpaSummary(tasks, syllabi);
    const calc = s.courses.find(c => c.courseName.startsWith('Calculus'))!;
    const quizComp = calc.components.find(k => k.name === 'Quizzes')!;
    expect(quizComp.dropped).toHaveLength(0);
    expect(quizComp.counted).toHaveLength(2);
  });
});
