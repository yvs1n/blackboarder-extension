// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  sanitizeSemesters,
  mergeArchivedSemesters,
  calculateCgpa,
  archiveActiveSemester,
  detectSemesterName,
  detectCourseSemesterInfo,
  partitionCoursesBySemester,
  autoPartitionPastSemesters
} from '../src/core/semesters';
import { getStoredSemesters, saveStoredSemesters, mergeCloudSemesters } from '../src/utils/semestersStorage';
import { UOS_GRADE_SCALE } from '../src/utils/gpa';
import type { UserCourseConfig, DeadlineTask, ArchivedSemester } from '../src/types';

describe('Semester Sanitization and Merging', () => {
  it('sanitizes valid semester objects and drops corrupt entries', () => {
    const corrupt = [
      null,
      {},
      { id: '', name: 'Fall 2026' },
      { id: 'sem_1', name: '' },
      {
        id: 'sem_valid',
        name: 'Fall 2026',
        archivedAt: '2026-10-30T10:00:00.000Z',
        termGpa: 3.75,
        gradedCredits: 15,
        totalCredits: 15,
        courses: [
          { code: 'CS101', name: 'Intro to CS', creditHours: 3, grade: 'A', points: 4.0 },
          { code: 'MATH201', name: 'Calculus III', creditHours: 4, grade: 'B+', points: 3.5 }
        ]
      }
    ];

    const result = sanitizeSemesters(corrupt);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('sem_valid');
    expect(result[0].termGpa).toBe(3.75);
    expect(result[0].courses).toHaveLength(2);
    expect(result[0].courses[0].points).toBe(4.0);
  });

  it('merges local and cloud semesters with newer archivedAt winning on collision', () => {
    const local: ArchivedSemester[] = [
      {
        id: 'sem_fall25',
        name: 'Fall 2025 (Local Edit)',
        archivedAt: '2026-01-15T12:00:00.000Z',
        gradedCredits: 15,
        totalCredits: 15,
        termGpa: 3.8,
        courses: []
      },
      {
        id: 'sem_spring26',
        name: 'Spring 2026',
        archivedAt: '2026-06-01T10:00:00.000Z',
        gradedCredits: 16,
        totalCredits: 16,
        termGpa: 3.6,
        courses: []
      }
    ];

    const cloud: ArchivedSemester[] = [
      {
        id: 'sem_fall25',
        name: 'Fall 2025 (Cloud Stale)',
        archivedAt: '2026-01-10T12:00:00.000Z', // older than local
        gradedCredits: 15,
        totalCredits: 15,
        termGpa: 3.5,
        courses: []
      },
      {
        id: 'sem_summer25',
        name: 'Summer 2025',
        archivedAt: '2025-08-01T10:00:00.000Z',
        gradedCredits: 6,
        totalCredits: 6,
        termGpa: 4.0,
        courses: []
      }
    ];

    const merged = mergeArchivedSemesters(local, cloud);
    expect(merged).toHaveLength(3);
    const fall = merged.find(s => s.id === 'sem_fall25');
    expect(fall?.name).toBe('Fall 2025 (Local Edit)');
    expect(fall?.termGpa).toBe(3.8);
    expect(merged.some(s => s.id === 'sem_summer25')).toBe(true);
  });
});

describe('CGPA and Academic Journey Calculations', () => {
  it('calculates CGPA identical to term GPA when no prior history exists', () => {
    const activeGpa = {
      courses: [
        { courseName: 'Course 1', creditHours: 3, points: 4.0, letter: 'A', gradedWeight: 100, earnedWeight: 100, components: [] },
        { courseName: 'Course 2', creditHours: 3, points: 3.0, letter: 'B', gradedWeight: 100, earnedWeight: 80, components: [] }
      ],
      gpa: 3.5,
      gradedCredits: 6,
      totalCredits: 6
    };

    const cgpaSummary = calculateCgpa(activeGpa, []);
    expect(cgpaSummary.termGpa).toBe(3.5);
    expect(cgpaSummary.cgpa).toBe(3.5);
    expect(cgpaSummary.totalGradedCredits).toBe(6);
    expect(cgpaSummary.totalCompletedCredits).toBe(6);
  });

  it('blends prior academic baseline and archived semesters with active semester', () => {
    // Prior Baseline: 45 credits at 3.40 GPA -> 153.0 weighted points
    const baseline = {
      priorCredits: 45,
      priorGpa: 3.40,
      targetCredits: 132
    };

    // Archived Semester: 15 credits with 3.80 GPA -> 57.0 weighted points
    const archived: ArchivedSemester[] = [
      {
        id: 'sem_1',
        name: 'Fall 2025',
        archivedAt: '2026-01-01T00:00:00.000Z',
        gradedCredits: 15,
        totalCredits: 15,
        termGpa: 3.80,
        courses: [
          { code: 'MATH101', name: 'Calculus I', creditHours: 3, grade: 'A', points: 4.0 },
          { code: 'PHYS101', name: 'Physics I', creditHours: 4, grade: 'A', points: 4.0 },
          { code: 'ENG101', name: 'English', creditHours: 3, grade: 'B+', points: 3.5 },
          { code: 'CS101', name: 'Intro CS', creditHours: 5, grade: 'B+', points: 3.5 }
        ]
      }
    ];

    // Active Term: 6 graded credits with 3.50 GPA -> 21.0 weighted points
    const activeGpa = {
      courses: [
        { courseName: 'Data Structures', creditHours: 3, points: 4.0, letter: 'A', gradedWeight: 100, earnedWeight: 100, components: [] },
        { courseName: 'Linear Algebra', creditHours: 3, points: 3.0, letter: 'B', gradedWeight: 100, earnedWeight: 80, components: [] }
      ],
      gpa: 3.5,
      gradedCredits: 6,
      totalCredits: 15
    };

    // Total points = 153.0 (prior) + (3*4 + 4*4 + 3*3.5 + 5*3.5 = 12 + 16 + 10.5 + 17.5 = 56.0) + (3*4 + 3*3 = 21.0)
    // Total credits = 45 + 15 + 6 = 66
    // Expected CGPA = (153.0 + 56.0 + 21.0) / 66 = 230.0 / 66 = 3.4848... -> 3.48
    const summary = calculateCgpa(activeGpa, archived, baseline);
    expect(summary.termGpa).toBe(3.5);
    expect(summary.cgpa).toBe(3.48);
    expect(summary.totalGradedCredits).toBe(66);
    expect(summary.totalCompletedCredits).toBe(66);
    // Degree progress: 66 / 132 = 50%
    expect(summary.degreeProgressPercent).toBe(50);
  });

  it('supports course retake grade replacement when enabled', () => {
    // Student took Physics 1 in Fall 2025 and got F (0.0 points), then retook in Spring 2026 and got A (4.0 points)
    const archived: ArchivedSemester[] = [
      {
        id: 'sem_spring26',
        name: 'Spring 2026',
        archivedAt: '2026-06-01T00:00:00.000Z',
        gradedCredits: 3,
        totalCredits: 3,
        termGpa: 4.0,
        courses: [
          { code: 'PHYS101', name: 'Physics I', creditHours: 3, grade: 'A', points: 4.0 }
        ]
      },
      {
        id: 'sem_fall25',
        name: 'Fall 2025',
        archivedAt: '2026-01-01T00:00:00.000Z',
        gradedCredits: 3,
        totalCredits: 3,
        termGpa: 0.0,
        courses: [
          { code: 'PHYS101', name: 'Physics I', creditHours: 3, grade: 'F', points: 0.0 }
        ]
      }
    ];

    const activeGpa = { courses: [], gradedCredits: 0, totalCredits: 0 };
    // With replaceRetakes enabled, only the Spring 2026 A counts!
    const summary = calculateCgpa(activeGpa, archived, null, { replaceRetakes: true });
    expect(summary.cgpa).toBe(4.0);
    expect(summary.totalGradedCredits).toBe(3);
  });
});

describe('Semester Archiving Action', () => {
  it('creates an archived semester snapshot from active courses and marks', () => {
    const courses: UserCourseConfig[] = [
      {
        id: 'c1',
        courseName: 'Calculus I',
        courseCode: '0401101',
        creditHours: 3,
        colorHex: '#10b981',
        aliases: [],
        scheduleSlots: [],
        syllabus: [{ id: 'comp_final', name: 'Final Exam', type: 'exam', totalWeight: 100 }]
      }
    ];

    const tasks: DeadlineTask[] = [
      {
        id: 't1',
        title: 'Final Exam',
        courseName: 'Calculus I',
        courseCode: '0401101',
        type: 'exam',
        dueDate: '2026-10-15T09:00:00.000Z',
        status: 'completed',
        submissionStatus: 'graded',
        score: 95,
        maxScore: 100
      } as DeadlineTask
    ];

    const snapshot = archiveActiveSemester({
      name: 'Fall 2026',
      courses,
      tasks,
      scale: UOS_GRADE_SCALE,
      mode: 'compact'
    });

    expect(snapshot.name).toBe('Fall 2026');
    expect(snapshot.termGpa).toBe(4.0); // 95% = A (4.0)
    expect(snapshot.gradedCredits).toBe(3);
    expect(snapshot.courses).toHaveLength(1);
    expect(snapshot.courses[0].grade).toBe('A');
    expect(snapshot.courses[0].points).toBe(4.0);
    expect(snapshot.fullCourses).toBeUndefined(); // compact mode
  });

  it('preserves full courses and tasks snapshot when mode is full', () => {
    const courses: UserCourseConfig[] = [
      {
        id: 'c1',
        courseName: 'Calculus I',
        courseCode: '0401101',
        creditHours: 3,
        colorHex: '#10b981',
        aliases: [],
        scheduleSlots: [],
        syllabus: [{ id: 'comp_final', name: 'Final Exam', type: 'exam', totalWeight: 100 }]
      }
    ];

    const tasks: DeadlineTask[] = [
      {
        id: 't1',
        title: 'Final Exam',
        courseName: 'Calculus I',
        courseCode: '0401101',
        type: 'exam',
        dueDate: '2026-10-15T09:00:00.000Z',
        status: 'completed',
        submissionStatus: 'graded',
        score: 95,
        maxScore: 100
      } as DeadlineTask
    ];

    const snapshot = archiveActiveSemester({
      name: 'Fall 2026',
      courses,
      tasks,
      scale: UOS_GRADE_SCALE,
      mode: 'full'
    });

    expect(snapshot.fullCourses).toHaveLength(1);
    expect(snapshot.fullTasks).toHaveLength(1);
  });
});

describe('Semester Term Detection', () => {
  it('detects term from Banner term codes', () => {
    expect(detectSemesterName([{ courseCode: '0401101_202610' } as UserCourseConfig])).toBe('Fall 2026');
    expect(detectSemesterName([{ courseCode: '0401101_202620' } as UserCourseConfig])).toBe('Spring 2026');
  });

  it('detects term from explicit course strings', () => {
    expect(detectSemesterName([{ courseName: 'Calculus I (Fall 2026)' } as UserCourseConfig])).toBe('Fall 2026');
    expect(detectSemesterName([{ courseName: 'Physics II - Spring 2027' } as UserCourseConfig])).toBe('Spring 2027');
  });

  it('falls back to month and year when no codes exist', () => {
    const oct = new Date('2026-10-15');
    expect(detectSemesterName([], [], oct)).toBe('Fall 2026');
    const mar = new Date('2027-03-10');
    expect(detectSemesterName([], [], mar)).toBe('Spring 2027');
  });
});

describe('Multi-Semester Course Partitioning & Separation', () => {
  it('detects semester info from course codes and terms correctly', () => {
    // 6-digit Banner code
    const c1 = { courseCode: '0401101_202610', courseName: 'Calculus I' } as UserCourseConfig;
    expect(detectCourseSemesterInfo(c1)).toEqual({
      termCode: '202610',
      termName: 'Fall 2026',
      sortKey: 202610
    });

    // 4-digit Banner code (e.g. UOS format _2510)
    const c2 = { courseCode: '1440133_21_2510', courseName: 'Programming I' } as UserCourseConfig;
    expect(detectCourseSemesterInfo(c2)).toEqual({
      termCode: '2510',
      termName: 'Fall 2025',
      sortKey: 202510
    });

    // Arabic seasonal term
    const c3 = { courseName: 'تاريخ الإمارات (خريف 2025)' } as UserCourseConfig;
    expect(detectCourseSemesterInfo(c3)).toEqual({
      termName: 'Fall 2025',
      sortKey: 202510
    });
  });

  it('partitions Year 1 and Year 2 courses into distinct semester buckets', () => {
    const courses: UserCourseConfig[] = [
      { courseName: 'Calculus I', courseCode: 'MATH101_2510', creditHours: 3 } as UserCourseConfig, // Year 1 Fall 2025
      { courseName: 'Physics I', courseCode: 'PHYS101_2520', creditHours: 4 } as UserCourseConfig,   // Year 1 Spring 2026
      { courseName: 'Data Structures', courseCode: 'CS201_2610', creditHours: 3 } as UserCourseConfig, // Year 2 Fall 2026
      { courseName: 'Algorithms', courseCode: 'CS202_2610', creditHours: 3 } as UserCourseConfig      // Year 2 Fall 2026
    ];

    const tasks: DeadlineTask[] = [
      { id: 't1', courseName: 'Calculus I', title: 'Midterm', dueDate: '2025-10-15', status: 'completed' } as DeadlineTask,
      { id: 't2', courseName: 'Data Structures', title: 'Assignment 1', dueDate: '2026-10-05', status: 'pending' } as DeadlineTask
    ];

    const partitions = partitionCoursesBySemester(courses, tasks);
    expect(partitions).toHaveLength(3);

    // Sorted descending (newest first)
    expect(partitions[0].termName).toBe('Fall 2026');
    expect(partitions[0].courses).toHaveLength(2);
    expect(partitions[0].tasks).toHaveLength(1);
    expect(partitions[0].tasks[0].id).toBe('t2');

    expect(partitions[1].termName).toBe('Spring 2025');
    expect(partitions[1].courses).toHaveLength(1);

    expect(partitions[2].termName).toBe('Fall 2025');
    expect(partitions[2].courses).toHaveLength(1);
    expect(partitions[2].tasks).toHaveLength(1);
    expect(partitions[2].tasks[0].id).toBe('t1');
  });

  it('autoPartitions past semesters, leaving current term active and archiving completed years', () => {
    const courses: UserCourseConfig[] = [
      { courseName: 'Calculus I', courseCode: 'MATH101_2510', creditHours: 3 } as UserCourseConfig, // Year 1 Fall 2025
      { courseName: 'Physics I', courseCode: 'PHYS101_2520', creditHours: 4 } as UserCourseConfig,   // Year 1 Spring 2026
      { courseName: 'Data Structures', courseCode: 'CS201_2610', creditHours: 3 } as UserCourseConfig // Year 2 Fall 2026
    ];

    const tasks: DeadlineTask[] = [
      {
        id: 't_past',
        courseName: 'Calculus I',
        title: 'Final Exam',
        status: 'completed',
        weight: 40,
        score: 38,
        maxScore: 40
      } as DeadlineTask,
      {
        id: 't_active',
        courseName: 'Data Structures',
        title: 'Project 1',
        status: 'pending',
        weight: 20
      } as DeadlineTask
    ];

    const result = autoPartitionPastSemesters({
      courses,
      tasks,
      scale: UOS_GRADE_SCALE
    });

    expect(result.partitionedCoursesCount).toBe(2);
    expect(result.archivedSemestersCreated).toBe(2);

    // Active courses must contain only Year 2 Fall 2026
    expect(result.activeCourses).toHaveLength(1);
    expect(result.activeCourses[0].courseName).toBe('Data Structures');

    // Active tasks must contain only active tasks
    expect(result.activeTasks).toHaveLength(1);
    expect(result.activeTasks[0].id).toBe('t_active');

    // Archived semesters must contain Fall 2025 and Spring 2026
    expect(result.archivedSemesters).toHaveLength(2);
    const fall25 = result.archivedSemesters.find((s: any) => s.name === 'Fall 2025');
    expect(fall25).toBeDefined();
    expect(fall25!.courses[0].name).toBe('Calculus I');
  });
});

describe('Semesters Storage Layer', () => {
  it('saves, reads, and merges cloud semesters into local storage', async () => {
    localStorage.clear();
    expect(await getStoredSemesters()).toEqual([]);

    const initial = [
      {
        id: 'sem_1',
        name: 'Fall 2025',
        archivedAt: '2025-12-20T10:00:00.000Z',
        termGpa: 3.5,
        gradedCredits: 15,
        totalCredits: 15,
        courses: []
      }
    ];

    await saveStoredSemesters(initial, '2025-12-20T10:00:00.000Z');
    const stored = await getStoredSemesters();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Fall 2025');

    const cloud = [
      {
        id: 'sem_2',
        name: 'Spring 2026',
        archivedAt: '2026-05-20T10:00:00.000Z',
        termGpa: 3.8,
        gradedCredits: 16,
        totalCredits: 16,
        courses: []
      }
    ];

    const updated = await mergeCloudSemesters(cloud, '2026-05-20T10:00:00.000Z');
    expect(updated).toBe(true);

    const merged = await getStoredSemesters();
    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe('sem_2'); // Newest first
    expect(merged[1].id).toBe('sem_1');
  });
});
