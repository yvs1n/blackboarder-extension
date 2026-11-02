import { describe, it, expect } from 'vitest';
import { buildMarksSummary } from '../src/utils/marks';
import { buildGpaSummary, UOS_GRADE_SCALE } from '../src/utils/gpa';
import { calculateCourseTargetAnalysis } from '../src/core/targetGpa';
import { userCoursesToSyllabi } from '../src/core/userCourses';
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
});
