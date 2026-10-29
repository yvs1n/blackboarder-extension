import { describe, it, expect, beforeEach } from 'vitest';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';
import { Announcement } from '../src/types';
import { setActiveUserCourses } from '../src/core/userCourses';
import { SAMPLE_COURSES } from './fixtures/sampleCourses';

describe('Local NLP Deadline Extractor', () => {
  beforeEach(() => {
    setActiveUserCourses(SAMPLE_COURSES);
  });
  it('extracts quiz date, time, and title accurately', () => {
    const ann: Announcement = {
      id: 'ann-1',
      courseCode: '0401201',
      courseName: 'Computer Programming',
      title: 'Important Announcement: Quiz 2 Schedule',
      postedAt: '2026-10-01T08:00:00.000Z',
      contentText: 'Dear students, please note that Quiz 2 will take place on Thursday, October 15 at 2:00 PM in Lab 102. Please bring your student ID cards.',
      sourceUrl: 'https://blackboard.sharjah.ac.ae',
      scannedAt: '2026-10-01T09:00:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks.length).toBeGreaterThanOrEqual(1);

    const quizTask = tasks[0];
    expect(quizTask.type).toBe('quiz');
    expect(quizTask.title).toContain('Quiz 2');
    expect(quizTask.hasSpecificTime).toBe(true);

    const dueDate = new Date(quizTask.dueDate);
    expect(dueDate.getMonth()).toBe(9); // October (0-indexed)
    expect(dueDate.getDate()).toBe(15);
    expect(dueDate.getHours()).toBe(14); // 2:00 PM
    expect(dueDate.getMinutes()).toBe(0);
  });

  it('extracts assignment deadline with 11:59 PM correctly', () => {
    const ann: Announcement = {
      id: 'ann-2',
      courseCode: '0402202',
      courseName: 'Data Structures',
      title: 'Assignment 3 Extension',
      postedAt: '2026-10-10T10:00:00.000Z',
      contentText: 'Good afternoon, Assignment 3 submission deadline has been extended to Sunday, October 18th, 11:59 PM on Blackboard.',
      sourceUrl: 'https://blackboard.sharjah.ac.ae',
      scannedAt: '2026-10-10T11:00:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks.length).toBe(1);

    const hwTask = tasks[0];
    expect(hwTask.type).toBe('assignment');
    expect(hwTask.title).toContain('Assignment 3');
    expect(hwTask.hasSpecificTime).toBe(true);

    const dueDate = new Date(hwTask.dueDate);
    expect(dueDate.getMonth()).toBe(9); // October
    expect(dueDate.getDate()).toBe(18);
    expect(dueDate.getHours()).toBe(23);
    expect(dueDate.getMinutes()).toBe(59);
  });

  it('extracts relative "tomorrow" deadlines accurately', () => {
    const ann: Announcement = {
      id: 'ann-3',
      courseCode: 'CS101',
      courseName: 'Intro to CS',
      title: 'Lab Report 1 Reminder',
      postedAt: '2026-10-14T09:00:00.000Z', // Wednesday
      contentText: 'Friendly reminder that Homework 1 is due tomorrow by 5:00 PM.',
      sourceUrl: 'https://blackboard.sharjah.ac.ae',
      scannedAt: '2026-10-14T10:00:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks.length).toBe(1);

    const task = tasks[0];
    const dueDate = new Date(task.dueDate);
    expect(dueDate.getDate()).toBe(15); // tomorrow from 14th
    expect(dueDate.getHours()).toBe(17); // 5:00 PM
  });

  it('handles Arabic announcements with quiz and morning time', () => {
    const ann: Announcement = {
      id: 'ann-4',
      courseCode: '0401100',
      courseName: 'Mathematics',
      title: 'تذكير بموعد الكويز الأول',
      postedAt: '2026-10-10T08:00:00.000Z',
      contentText: 'السلام عليكم، تذكير: موعد كويز 1 يوم الثلاثاء القادم الساعة 10 صباحاً في القاعة الرئيسية.',
      sourceUrl: 'https://blackboard.sharjah.ac.ae',
      scannedAt: '2026-10-10T09:00:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks.length).toBe(1);
    const task = tasks[0];
    expect(task.type).toBe('quiz');
    expect(task.hasSpecificTime).toBe(true);
    const dueDate = new Date(task.dueDate);
    expect(dueDate.getHours()).toBe(10);
  });

  it('ignores announcements with no deadlines', () => {
    const ann: Announcement = {
      id: 'ann-5',
      courseCode: '0401201',
      courseName: 'Computer Programming',
      title: 'Welcome to the New Semester',
      postedAt: '2026-09-01T08:00:00.000Z',
      contentText: 'Welcome to the course! The syllabus and lecture slides are uploaded under Course Materials. Have a great semester.',
      sourceUrl: 'https://blackboard.sharjah.ac.ae',
      scannedAt: '2026-09-01T09:00:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks.length).toBe(0);
  });

  it('preserves the doctor announcement text in description and applies class schedule time when time is omitted', () => {
    const doctorMessage = 'Dear Students, Quiz 1 will be held on Tuesday, October 20. Please bring scientific calculators and be on time.';
    const ann: Announcement = {
      id: 'ann-6',
      courseCode: '1440133',
      courseName: 'Calculus I for Engineering',
      title: 'Quiz 1 Announcement',
      postedAt: '2026-10-10T08:00:00.000Z',
      contentText: doctorMessage,
      sourceUrl: 'https://blackboard.sharjah.ac.ae',
      scannedAt: '2026-10-10T09:00:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks.length).toBe(1);

    const task = tasks[0];
    // Must contain doctor's actual message
    expect(task.description).toBe(doctorMessage);
    expect(task.sourceSnippet).toBe(doctorMessage);

    // Time must match Calculus I class time (12:30 PM)
    const dueDate = new Date(task.dueDate);
    expect(dueDate.getHours()).toBe(12);
    expect(dueDate.getMinutes()).toBe(30);
  });

  it('extracts quiz deadline when date is specified as Thursday 24 in the title and chapters in the body', () => {
    const doctorMessage = 'Quiz 1 will cover three chapters:\n1. Determine the Meaning an unfamiliar words from the context\n2. Reading Comprehension\n3. Academic Vocabulary';
    const ann: Announcement = {
      id: 'ann-7',
      courseCode: '0202 112 09',
      courseName: 'English for Academic Purposes- 09 - اللغة الإنجليزية لأغراض أكاديمية',
      title: 'Quiz 1 Thursday 24',
      postedAt: '2026-09-18T10:00:00.000Z',
      contentText: doctorMessage,
      sourceUrl: 'https://elearning.sharjah.ac.ae/ultra/stream',
      scannedAt: '2026-09-18T10:05:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks.length).toBe(1);

    const task = tasks[0];
    expect(task.type).toBe('quiz');
    expect(task.title).toContain('Quiz 1');
    const dueDate = new Date(task.dueDate);
    expect(dueDate.getDate()).toBe(24);
    expect(dueDate.getMonth()).toBe(8); // September (0-indexed)
    expect(task.description).toBe(doctorMessage);
  });

  it('rejects announcements whose content is purely a grade fraction like .25 / 10', () => {
    const ann: Announcement = {
      id: 'ann-bogus-fraction',
      courseCode: '1430116',
      courseName: 'Physics 1 Lab',
      title: 'Lab',
      postedAt: '2026-10-15T10:00:00.000Z',
      contentText: '.25 / 10',
      sourceUrl: 'https://elearning.sharjah.ac.ae/ultra/stream',
      scannedAt: '2026-10-15T10:05:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks).toEqual([]);
  });

  it('rejects grade posting announcements that lack future deadline actions', () => {
    const ann: Announcement = {
      id: 'ann-bogus-grades',
      courseCode: '1430115',
      courseName: 'Physics 1',
      title: 'درجة الكويز الأول',
      postedAt: '2026-10-15T10:00:00.000Z',
      contentText: 'السلام عليكم ورحمة الله، تم رصد درجات الكويز الأول على البلاك بورد ويمكنكم الاطلاع على النتائج.',
      sourceUrl: 'https://elearning.sharjah.ac.ae/ultra/stream',
      scannedAt: '2026-10-15T10:05:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks).toEqual([]);
  });
});

