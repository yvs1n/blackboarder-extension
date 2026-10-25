import { describe, it, expect, beforeEach } from 'vitest';
import { resolveTaskWeight, findCourseSyllabus, DEFAULT_SYLLABUS_DATABASE, extractAssessmentNumber } from '../src/core/syllabusWeights';
import { setActiveUserCourses, DEFAULT_USER_COURSES } from '../src/core/userCourses';

describe('Syllabus Weights Database & Resolution', () => {
  beforeEach(() => {
    setActiveUserCourses(DEFAULT_USER_COURSES);
  });
  it('contains all 6 configured courses with totalWeight of 100%', () => {
    expect(DEFAULT_SYLLABUS_DATABASE.length).toBe(6);
    expect(findCourseSyllabus('Calculus 1')?.courseId).toBe('calc1');
    DEFAULT_SYLLABUS_DATABASE.forEach(course => {
      const sum = course.components.reduce((acc, c) => acc + c.totalWeight, 0);
      expect(sum).toBe(100);
    });
  });

  describe('Calculus 1 for Engineering (calc_1.pdf)', () => {
    it('assigns 10% to a Quiz in Calculus 1 (best 2 of 3 quizzes = 20% total)', () => {
      const res = resolveTaskWeight({
        title: 'Quiz 1',
        courseName: 'Calculus I for Engineering',
        type: 'quiz'
      });
      expect(res.weight).toBe(10);
      expect(res.weightDisplay).toContain('10%');
      expect(res.componentName).toBe('Quizzes');
    });

    it('assigns 3.33% to Assignment-1-Graded in Calculus 1 (best 3 of 4 homeworks = 10% total)', () => {
      const res = resolveTaskWeight({
        title: 'Assignment-1-Graded',
        courseName: 'Calculus I for Engineering - 02 - حسبان 1 للمهندسين',
        type: 'assignment'
      });
      expect(res.weight).toBe(3.33);
      expect(res.weightDisplay).toContain('3.33%');
      expect(res.componentName).toBe('Homeworks');
    });

    it('assigns 30% to Midterm Exam in Calculus 1', () => {
      const res = resolveTaskWeight({
        title: 'Midterm Exam Fall 2026',
        courseName: 'Calculus 1',
        type: 'exam'
      });
      expect(res.weight).toBe(30);
      expect(res.weightDisplay).toBe('30% (Midterm Exam)');
    });

    it('assigns 40% to Final Exam in Calculus 1', () => {
      const res = resolveTaskWeight({
        title: 'Final Examination',
        courseName: 'Calculus 1 for Engineering',
        type: 'exam'
      });
      expect(res.weight).toBe(40);
      expect(res.weightDisplay).toBe('40% (Final Exam)');
    });
  });

  describe('English for Academic Purposes (eap.pdf)', () => {
    it('assigns 10% to Quiz 1 in EAP (2 quizzes = 20% total)', () => {
      const res = resolveTaskWeight({
        title: 'Quiz (1): Chapters 1+2',
        courseName: 'English for Academic Purposes (EAP)',
        type: 'quiz'
      });
      expect(res.weight).toBe(10);
      expect(res.weightDisplay).toContain('10%');
    });

    it('assigns 10% to Cause-Effect Essay in EAP', () => {
      const res = resolveTaskWeight({
        title: 'Cause-Effect Essay Submission',
        courseName: 'Academic English',
        type: 'assignment'
      });
      expect(res.weight).toBe(10);
      expect(res.weightDisplay).toContain('10%');
    });

    it('assigns 2% to Employability Task in EAP', () => {
      const res = resolveTaskWeight({
        title: 'Employability Skills Task 2',
        courseName: 'English for Academic Purposes',
        type: 'assignment'
      });
      expect(res.weight).toBe(2);
      expect(res.weightDisplay).toContain('2%');
    });

    it('assigns 20% to Midterm Exam in EAP', () => {
      const res = resolveTaskWeight({
        title: 'EAP Midterm Exam',
        courseName: 'English for Academic Purposes',
        type: 'exam'
      });
      expect(res.weight).toBe(20);
    });
  });

  describe('Physics 1 Lab (phy1lab.pdf)', () => {
    it('assigns 10% to Lab Quiz in Physics 1 Lab (top 3 counted = 30% total)', () => {
      const res = resolveTaskWeight({
        title: 'Lab Quiz 1: Vectors & Measurements',
        courseName: 'Physics 1 Lab',
        type: 'quiz'
      });
      expect(res.weight).toBe(10);
      expect(res.weightDisplay).toContain('10%');
    });

    it('assigns 3.33% to Weekly Lab Report in Physics 1 Lab (9 reports = 30% total)', () => {
      const res = resolveTaskWeight({
        title: 'Experiment 4 Report: Projectile Motion',
        courseName: 'Physics 1 Lab',
        type: 'lab'
      });
      expect(res.weight).toBe(3.33);
      expect(res.weightDisplay).toContain('3.33%');
    });

    it('assigns 40% to Final Practical Exam in Physics 1 Lab', () => {
      const res = resolveTaskWeight({
        title: 'Practical Final Exam',
        courseName: 'Physics 1 Lab',
        type: 'exam'
      });
      expect(res.weight).toBe(40);
    });
  });

  describe('Islamic Culture (islamicculture.pdf)', () => {
    it('extracts explicit 15 marks from "البحث العلمي (واجب جماعي) 15 درجة"', () => {
      const res = resolveTaskWeight({
        title: 'البحث العلمي (واجب جماعي) 15 درجة',
        courseName: 'Islamic Culture - 13A - الثقافة الإسلامية',
        type: 'project'
      });
      expect(res.weight).toBe(15);
      expect(res.weightDisplay).toBe('15% of Grade');
    });

    it('assigns 25% to Midterm Exam in Islamic Culture', () => {
      const res = resolveTaskWeight({
        title: 'امتحان المنتصف',
        courseName: 'الثقافة الإسلامية',
        type: 'exam'
      });
      expect(res.weight).toBe(25);
    });

    it('assigns 50% to Final Exam in Islamic Culture', () => {
      const res = resolveTaskWeight({
        title: 'امتحان نهائي',
        courseName: 'Islamic Culture',
        type: 'exam'
      });
      expect(res.weight).toBe(50);
    });
  });

  describe('Intro to Computer Engineering (introtocompeng.pdf)', () => {
    it('assigns 8.33% to Quizzes (best 3 of 4 = 25% total, no HWs)', () => {
      const res = resolveTaskWeight({
        title: 'Quiz 2 on Chapter 3',
        courseName: 'Intro to Computer Engineering',
        type: 'quiz'
      });
      expect(res.weight).toBe(8.33);
      expect(res.weightDisplay).toContain('8.33%');
    });

    it('assigns 30% to Midterm Exam', () => {
      const res = resolveTaskWeight({
        title: 'Midterm Exam',
        courseName: 'Intro to Comp Eng',
        type: 'exam'
      });
      expect(res.weight).toBe(30);
    });

    it('assigns 45% to Final Exam', () => {
      const res = resolveTaskWeight({
        title: 'Final Exam',
        courseName: 'Introduction to Computer Engineering',
        type: 'exam'
      });
      expect(res.weight).toBe(45);
    });
  });

  describe('Physics 1 (phy1.pdf / 100 marks breakdown)', () => {
    it('assigns 45% to Final Exam in Physics 1', () => {
      const res = resolveTaskWeight({
        title: 'Physics 1 Final Exam',
        courseName: 'Physics 1',
        type: 'exam'
      });
      expect(res.weight).toBe(45);
      expect(res.weightDisplay).toContain('45%');
    });

    it('assigns 25% to Midterm Exam in Physics 1', () => {
      const res = resolveTaskWeight({
        title: 'Midterm Exam',
        courseName: 'Physics 1 - 02',
        type: 'exam'
      });
      expect(res.weight).toBe(25);
    });

    it('assigns 20% to Quizzes in Physics 1 (average = 20 marks)', () => {
      const res = resolveTaskWeight({
        title: 'Quiz 1: Kinematics',
        courseName: 'General Physics 1',
        type: 'quiz'
      });
      expect(res.weight).toBe(20);
    });

    it('assigns 10% to Assignments in Physics 1', () => {
      const res = resolveTaskWeight({
        title: 'Homework 1 on Forces',
        courseName: 'Physics 1',
        type: 'assignment'
      });
      expect(res.weight).toBe(10);
    });
  });

  describe('Direct Explicit Point Extraction Fallback', () => {
    it('extracts explicit "10 marks" from title even if course is generic', () => {
      const res = resolveTaskWeight({
        title: 'Special Homework Assignment (10 marks)',
        courseName: 'General Course',
        type: 'assignment'
      });
      expect(res.weight).toBe(10);
      expect(res.weightDisplay).toBe('10% of Grade');
    });
  });

  describe('extractAssessmentNumber', () => {
    it('extracts numbers from explicit titles', () => {
      expect(extractAssessmentNumber('Quiz 1')).toBe(1);
      expect(extractAssessmentNumber('Quiz 2')).toBe(2);
      expect(extractAssessmentNumber('Quiz (1): Chapters 1+2')).toBe(1);
      expect(extractAssessmentNumber('Quiz (2): Chapters 3+4')).toBe(2);
      expect(extractAssessmentNumber('Review Quiz 1')).toBe(1);
      expect(extractAssessmentNumber('Quiz #2')).toBe(2);
      expect(extractAssessmentNumber('HW2')).toBe(2);
      expect(extractAssessmentNumber('Assignment 3')).toBe(3);
      expect(extractAssessmentNumber('Lab 2')).toBe(2);
      expect(extractAssessmentNumber('Quiz II')).toBe(2);
      expect(extractAssessmentNumber('Quiz (II)')).toBe(2);
      expect(extractAssessmentNumber('First Quiz')).toBe(1);
      expect(extractAssessmentNumber('Second Quiz')).toBe(2);
    });

    it('returns null when no number is specified', () => {
      expect(extractAssessmentNumber('General Quiz')).toBeNull();
      expect(extractAssessmentNumber('Midterm Exam')).toBeNull();
    });
  });

  describe('Sequential Assessment Weight Display (X of Y inside weight box)', () => {
    it('correctly labels Quiz 1 as "1 of 2" and Quiz 2 as "2 of 2" in EAP', () => {
      const quiz1 = resolveTaskWeight({
        title: 'Quiz 1',
        courseName: 'English for Academic Purposes',
        type: 'quiz'
      });
      expect(quiz1.weight).toBe(10);
      expect(quiz1.weightDisplay).toBe('10% (Quizzes 1 of 2)');

      const quiz2 = resolveTaskWeight({
        title: 'Quiz 2',
        courseName: 'English for Academic Purposes',
        type: 'quiz'
      });
      expect(quiz2.weight).toBe(10);
      expect(quiz2.weightDisplay).toBe('10% (Quizzes 2 of 2)');
    });

    it('correctly labels Quiz 1 and Quiz 2 in Physics 1 Lab (1 of 3 vs 2 of 3)', () => {
      const q1 = resolveTaskWeight({
        title: 'Quiz 1',
        courseName: 'Physics 1 Lab',
        type: 'quiz'
      });
      expect(q1.weight).toBe(10);
      expect(q1.weightDisplay).toBe('10% (Lab Quizzes 1 of 3)');

      const q2 = resolveTaskWeight({
        title: 'Quiz 2',
        courseName: 'Physics 1 Lab',
        type: 'quiz'
      });
      expect(q2.weight).toBe(10);
      expect(q2.weightDisplay).toBe('10% (Lab Quizzes 2 of 3)');
    });

    it('uses seriesIndex when title has no explicit number', () => {
      const qFirst = resolveTaskWeight(
        'English for Academic Purposes',
        'Pop Quiz',
        'quiz',
        '',
        1
      );
      expect(qFirst.weightDisplay).toBe('10% (Quizzes 1 of 2)');

      const qSecond = resolveTaskWeight(
        'English for Academic Purposes',
        'Pop Quiz',
        'quiz',
        '',
        2
      );
      expect(qSecond.weightDisplay).toBe('10% (Quizzes 2 of 2)');
    });
  });
});
