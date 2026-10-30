import { describe, it, expect } from 'vitest';
import { parseSubmissionOrGradeCard, findTaskForUpdate } from '../src/utils/streamParser';
import type { DeadlineTask } from '../src/types';

function task(id: string, title: string, courseName: string, courseCode = ''): DeadlineTask {
  return { id, title, courseName, courseCode, type: 'quiz', dueDate: '2026-10-01T10:00:00.000Z' } as DeadlineTask;
}

const tasks = [
  task('hw1', 'HW1_Phys.1_Fall26-27 (chap. 1 & Chap. 2)', 'Physics 1'),
  task('calc-q1', 'Quiz 1', 'Calculus I for Engineering'),
  task('cpe-q1', 'Quiz 1', 'Introduction to Computer Eng.'),
  task('lab-q1', 'Quiz 1', 'Physics 1 Lab'),
  task('phys-q1', 'Quiz 1', 'Physics 1')
];

describe('posted marks find the right task', () => {
  it('drops the "Grade posted:" prefix so the title matches the task', () => {
    const up = parseSubmissionOrGradeCard('Physics 1 - ALL - 1 - الفيزياء-1\nGrade posted: HW1_Phys.1_Fall26-27\n9.5 / 10');
    expect(up?.title).toBe('HW1_Phys.1_Fall26-27');
    expect(findTaskForUpdate(tasks, up!)?.id).toBe('hw1');
  });

  it('drops "New grade available:" too', () => {
    const up = parseSubmissionOrGradeCard('Calculus I for Engineering - 02\nNew grade available: Quiz 1\n85%');
    expect(up?.title).toBe('Quiz 1');
    expect(findTaskForUpdate(tasks, up!)?.id).toBe('calc-q1');
  });

  it('never gives one course\'s Quiz 1 mark to another course', () => {
    const up = parseSubmissionOrGradeCard('Introduction to Computer Eng. - 01\nGrade posted: Quiz 1\n8 / 10');
    expect(findTaskForUpdate(tasks, up!)?.id).toBe('cpe-q1');
  });

  it('keeps Physics 1 and Physics 1 Lab apart', () => {
    const up = parseSubmissionOrGradeCard('Physics 1 Lab - 07\nGrade posted: Quiz 1\n9 / 10');
    expect(findTaskForUpdate(tasks, up!)?.id).toBe('lab-q1');
    const up2 = parseSubmissionOrGradeCard('Physics 1 - ALL - 1\nGrade posted: Quiz 1\n7 / 10');
    expect(findTaskForUpdate(tasks, up2!)?.id).toBe('phys-q1');
  });

  it('skips a mark it cannot place rather than guessing', () => {
    expect(findTaskForUpdate(tasks, { title: 'Quiz 1', submissionStatus: 'graded', score: 5 })).toBeUndefined();
  });

  it('attaches a released mark for "Quiz 3 - Projectile Motion" to an announced task "3rd quiz" in Physics 1 Lab', () => {
    const labTasks = [
      task('phys-lab-q3', '3rd quiz', 'Physics 1 Lab', '1430116')
    ];
    const update = {
      title: 'Quiz 3 - Projectile Motion',
      courseName: 'Physics 1 Lab',
      courseCode: '1430116',
      submissionStatus: 'graded' as const,
      score: 8.5,
      maxScore: 10
    };
    expect(findTaskForUpdate(labTasks, update)?.id).toBe('phys-lab-q3');
  });

  it('attaches a released mark for "EAP Midterm Exam" to an announced task "Midterm worth 25%"', () => {
    const eapTasks = [
      { id: 'eap-mid', title: 'Midterm worth 25%', courseName: 'English for Academic Purposes', courseCode: '0202 112', type: 'exam', dueDate: '2026-10-15T10:00:00.000Z' } as DeadlineTask
    ];
    const update = {
      title: 'EAP Midterm Exam',
      courseName: 'English for Academic Purposes',
      courseCode: '0202 112',
      submissionStatus: 'graded' as const,
      score: 20,
      maxScore: 20
    };
    expect(findTaskForUpdate(eapTasks, update)?.id).toBe('eap-mid');
  });

  it('does NOT attach a specific lab report mark to a generic orientation "Lab" task via substring matching', () => {
    const labTasks = [
      task('gen-lab', 'Lab', 'Physics 1 Lab', '1430116')
    ];
    const update = {
      title: "Vectors Exp. Student Lab Report",
      courseName: 'Physics 1 Lab',
      courseCode: '1430116',
      submissionStatus: 'graded' as const,
      score: 9.25,
      maxScore: 10
    };
    expect(findTaskForUpdate(labTasks, update)).toBeUndefined();
  });

  it('matches the specific lab report task instead of the generic "Lab" task when both are present', () => {
    const labTasks = [
      task('gen-lab', 'Lab', 'Physics 1 Lab', '1430116'),
      task('vectors-rep', 'Vectors Exp. Student Lab Report', 'Physics 1 Lab', '1430116')
    ];
    const update = {
      title: "Vectors Exp. Student Lab Report",
      courseName: 'Physics 1 Lab',
      courseCode: '1430116',
      submissionStatus: 'graded' as const,
      score: 9.25,
      maxScore: 10
    };
    expect(findTaskForUpdate(labTasks, update)?.id).toBe('vectors-rep');
  });

  it('does not match generic "Assignment" with "Assignment 1"', () => {
    const tasksList = [
      task('gen-asgn', 'Assignment', 'Calculus I for Engineering', '1440133')
    ];
    const update = {
      title: 'Assignment 1',
      courseName: 'Calculus I for Engineering',
      courseCode: '1440133',
      submissionStatus: 'graded' as const,
      score: 10,
      maxScore: 10
    };
    expect(findTaskForUpdate(tasksList, update)).toBeUndefined();
  });
});
