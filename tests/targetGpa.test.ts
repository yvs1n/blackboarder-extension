// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  calculateCourseTargetAnalysis,
  calculateTermTargetPlan,
  calculateTrajectoryTargetPlan
} from '../src/core/targetGpa';
import { UOS_GRADE_SCALE, GpaSummary, CourseGrade } from '../src/utils/gpa';
import { DeadlineTask } from '../src/types';

describe('Target Grade & Required Score Calculator', () => {
  it('calculates required score on remaining weight for standard cutoffs', () => {
    // Student in Calculus I: 35 points earned out of 40 graded weight. Remaining weight = 60.
    const courseGrade: CourseGrade = {
      courseName: 'Calculus I',
      creditHours: 3,
      gradedWeight: 40,
      earnedWeight: 35,
      percent: 87.5,
      components: []
    };

    const tasks: DeadlineTask[] = [
      {
        id: 't_final',
        courseName: 'Calculus I',
        title: 'Final Exam',
        type: 'exam',
        dueDate: '2026-12-15T09:00:00.000Z',
        weight: 40,
        maxScore: 100,
        status: 'pending'
      } as DeadlineTask,
      {
        id: 't_lab',
        courseName: 'Calculus I',
        title: 'Lab Project',
        type: 'project',
        dueDate: '2026-11-20T23:59:00.000Z',
        weight: 20,
        maxScore: 50,
        status: 'pending'
      } as DeadlineTask
    ];

    const analysis = calculateCourseTargetAnalysis(courseGrade, tasks, UOS_GRADE_SCALE);
    expect(analysis.courseName).toBe('Calculus I');
    expect(analysis.gradedWeight).toBe(40);
    expect(analysis.earnedWeight).toBe(35);
    expect(analysis.remainingWeight).toBe(60);
    expect(analysis.maxPossiblePercent).toBe(95);

    // Target A (90%): Need (90 - 35) / 60 * 100 = 55 / 60 * 100 = 91.7%
    const targetA = analysis.targets.find(t => t.letter === 'A');
    expect(targetA).toBeDefined();
    expect(targetA?.requiredPercent).toBe(91.7);
    expect(targetA?.guaranteed).toBe(false);
    expect(targetA?.unattainable).toBe(false);
    expect(targetA?.statusLabel).toContain('Need 91.7%');

    // Check upcoming task breakdown for Target A (91.7%)
    const finalExamReq = targetA?.upcomingTasks?.find(t => t.title === 'Final Exam');
    expect(finalExamReq).toBeDefined();
    expect(finalExamReq?.targetScore).toBe(91.7); // 91.7% of 100

    const labReq = targetA?.upcomingTasks?.find(t => t.title === 'Lab Project');
    expect(labReq).toBeDefined();
    expect(labReq?.targetScore).toBe(45.8); // (55/60)*50 = 45.83 -> 45.8

    // Target B+ (85%): Need (85 - 35) / 60 * 100 = 50 / 60 * 100 = 83.3%
    const targetBPlus = analysis.targets.find(t => t.letter === 'B+');
    expect(targetBPlus?.requiredPercent).toBe(83.3);
    expect(targetBPlus?.statusLabel).toContain('Need 83.3%');

    // Target B (80%): Need (80 - 35) / 60 * 100 = 45 / 60 * 100 = 75.0%
    const targetB = analysis.targets.find(t => t.letter === 'B');
    expect(targetB?.requiredPercent).toBe(75.0);
  });

  it('marks unattainable targets when remaining weight is insufficient', () => {
    // Student scored 20 points out of 50 graded weight. Remaining weight = 50. Max possible = 70%.
    const courseGrade: CourseGrade = {
      courseName: 'Physics I',
      creditHours: 3,
      gradedWeight: 50,
      earnedWeight: 20,
      percent: 40.0,
      components: []
    };

    const analysis = calculateCourseTargetAnalysis(courseGrade, [], UOS_GRADE_SCALE);
    expect(analysis.maxPossiblePercent).toBe(70);

    // Target A (90%): Unattainable
    const targetA = analysis.targets.find(t => t.letter === 'A');
    expect(targetA?.unattainable).toBe(true);
    expect(targetA?.guaranteed).toBe(false);
    expect(targetA?.statusLabel).toBe('Unattainable (max 70.0%)');

    // Target B (80%): Unattainable
    const targetB = analysis.targets.find(t => t.letter === 'B');
    expect(targetB?.unattainable).toBe(true);

    // Target C (70%): Need 100.0% on remaining 50% weight
    const targetC = analysis.targets.find(t => t.letter === 'C');
    expect(targetC?.unattainable).toBe(false);
    expect(targetC?.requiredPercent).toBe(100.0);
    expect(targetC?.statusLabel).toContain('Need 100.0%');
  });

  it('marks guaranteed targets when earned points already exceed cutoff', () => {
    // Student scored 91 points out of 90 graded weight. Remaining weight = 10.
    const courseGrade: CourseGrade = {
      courseName: 'Technical Writing',
      creditHours: 3,
      gradedWeight: 90,
      earnedWeight: 91,
      percent: 100.0,
      components: []
    };

    const analysis = calculateCourseTargetAnalysis(courseGrade, [], UOS_GRADE_SCALE);

    const targetA = analysis.targets.find(t => t.letter === 'A');
    expect(targetA?.guaranteed).toBe(true);
    expect(targetA?.unattainable).toBe(false);
    expect(targetA?.requiredPercent).toBe(0);
    expect(targetA?.statusLabel).toBe('Guaranteed');
  });

  it('handles fully completed courses with zero remaining weight', () => {
    const courseGrade: CourseGrade = {
      courseName: 'Chemistry',
      creditHours: 3,
      gradedWeight: 100,
      earnedWeight: 88,
      percent: 88.0,
      letter: 'B+',
      points: 3.5,
      components: []
    };

    const analysis = calculateCourseTargetAnalysis(courseGrade, [], UOS_GRADE_SCALE);
    expect(analysis.remainingWeight).toBe(0);

    const targetA = analysis.targets.find(t => t.letter === 'A');
    expect(targetA?.unattainable).toBe(true);
    expect(targetA?.statusLabel).toBe('Unattainable');

    const targetBPlus = analysis.targets.find(t => t.letter === 'B+');
    expect(targetBPlus?.guaranteed).toBe(true);
    expect(targetBPlus?.statusLabel).toBe('Achieved');
  });
});

describe('Term Target GPA Planning', () => {
  it('determines required course grades to hit a target Term SGPA', () => {
    const gpaSummary: GpaSummary = {
      gradedCredits: 6,
      totalCredits: 12,
      gpa: 3.5,
      courses: [
        {
          courseName: 'Course 1',
          creditHours: 3,
          gradedWeight: 50,
          earnedWeight: 45, // on track for A
          percent: 90,
          letter: 'A',
          points: 4.0,
          components: []
        },
        {
          courseName: 'Course 2',
          creditHours: 3,
          gradedWeight: 50,
          earnedWeight: 40, // on track for B
          percent: 80,
          letter: 'B',
          points: 3.0,
          components: []
        },
        {
          courseName: 'Course 3',
          creditHours: 3,
          gradedWeight: 0,
          earnedWeight: 0,
          components: []
        },
        {
          courseName: 'Course 4',
          creditHours: 3,
          gradedWeight: 0,
          earnedWeight: 0,
          components: []
        }
      ]
    };

    // Target Term GPA 3.75 across 12 credits = 45 total grade points needed (avg 3.75/course)
    const plan = calculateTermTargetPlan(gpaSummary, 3.75, UOS_GRADE_SCALE);
    expect(plan.possible).toBe(true);
    expect(plan.targetGpa).toBe(3.75);
    expect(plan.requiredTotalPoints).toBe(45);
    expect(plan.coursePlans).toHaveLength(4);

    // Each course plan recommends a target grade
    for (const cp of plan.coursePlans) {
      expect(cp.targetLetter).toBeDefined();
      expect(cp.targetPoints).toBeGreaterThanOrEqual(2.0);
    }
  });

  it('flags impossible target GPA when mathematically unattainable', () => {
    const gpaSummary: GpaSummary = {
      gradedCredits: 9,
      totalCredits: 12,
      gpa: 2.0,
      courses: [
        {
          courseName: 'Course 1',
          creditHours: 3,
          gradedWeight: 100,
          earnedWeight: 70,
          percent: 70,
          letter: 'C',
          points: 2.0,
          components: []
        },
        {
          courseName: 'Course 2',
          creditHours: 3,
          gradedWeight: 100,
          earnedWeight: 70,
          percent: 70,
          letter: 'C',
          points: 2.0,
          components: []
        },
        {
          courseName: 'Course 3',
          creditHours: 3,
          gradedWeight: 100,
          earnedWeight: 70,
          percent: 70,
          letter: 'C',
          points: 2.0,
          components: []
        },
        {
          courseName: 'Course 4',
          creditHours: 3,
          gradedWeight: 0,
          earnedWeight: 0,
          components: []
        }
      ]
    };

    // Even if Course 4 gets an A (4.0), max GPA = (2+2+2+4)/4 = 2.5. Target 3.5 is impossible.
    const plan = calculateTermTargetPlan(gpaSummary, 3.5, UOS_GRADE_SCALE);
    expect(plan.possible).toBe(false);
    expect(plan.maxPossibleGpa).toBe(2.5);
  });

  describe('Trajectory-Weighted Course Target Allocation', () => {
    it('allocates targets proportionally based on prior marks and maps to upcoming task cards', () => {
      // Math: strong average (38/40 = 95%). Remaining = 60%.
      // Physics: struggling average (24/40 = 60%). Remaining = 60%.
      const gpaSummary: GpaSummary = {
        gradedCredits: 6,
        totalCredits: 6,
        courses: [
          {
            courseName: 'Mathematics',
            creditHours: 3,
            gradedWeight: 40,
            earnedWeight: 38,
            percent: 95.0,
            components: []
          },
          {
            courseName: 'Physics',
            creditHours: 3,
            gradedWeight: 40,
            earnedWeight: 24,
            percent: 60.0,
            components: []
          }
        ]
      };

      const tasks: DeadlineTask[] = [
        {
          id: 'task_math_final',
          courseName: 'Mathematics',
          title: 'Final Exam',
          type: 'exam',
          maxScore: 100,
          weight: 40,
          status: 'pending'
        } as DeadlineTask,
        {
          id: 'task_phys_final',
          courseName: 'Physics',
          title: 'Final Exam',
          type: 'exam',
          maxScore: 100,
          weight: 40,
          status: 'pending'
        } as DeadlineTask
      ];

      // Student wants Term GPA 3.50 (e.g. A in Math = 4.0, B in Physics = 3.0 -> avg 3.50)
      const plan = calculateTrajectoryTargetPlan(gpaSummary, 3.50, tasks, UOS_GRADE_SCALE);
      expect(plan.possible).toBe(true);
      expect(plan.plannedGpa).toBeGreaterThanOrEqual(3.50);

      const mathPlan = plan.courses.find(c => c.courseName === 'Mathematics');
      expect(mathPlan).toBeDefined();
      expect(mathPlan?.targetLetter).toBe('A');
      // For Math A (90%): Need (90 - 38)/60 = 52/60 = 86.7%
      expect(mathPlan?.requiredPercent).toBe(86.7);

      const physPlan = plan.courses.find(c => c.courseName === 'Physics');
      expect(physPlan).toBeDefined();
      // Physics should be allocated a realistic B or B+, NOT an impossible A
      expect(['B', 'B+', 'C+']).toContain(physPlan?.targetLetter);

      // Verify taskTargetMap accurately maps to upcoming task IDs
      expect(plan.taskTargetMap['task_math_final']).toBeDefined();
      expect(plan.taskTargetMap['task_math_final'].targetLetter).toBe('A');
      expect(plan.taskTargetMap['task_math_final'].targetScore).toBe(86.7); // 86.7% of 100

      expect(plan.taskTargetMap['task_phys_final']).toBeDefined();
      expect(plan.taskTargetMap['task_phys_final'].targetLetter).toBe(physPlan?.targetLetter);
      expect(plan.taskTargetMap['task_phys_final'].targetScore).toBeGreaterThan(0);
    });
  });
});
