import { describe, it, expect, beforeEach } from 'vitest';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';
import { sanitizeDoctorAnnouncementText } from '../src/core/courseHelper';
import { Announcement } from '../src/types';
import { setActiveUserCourses, DEFAULT_USER_COURSES } from '../src/core/userCourses';

describe('Midterm Exam Announcement Extraction & Text Sanitization', () => {
  beforeEach(() => {
    setActiveUserCourses(DEFAULT_USER_COURSES);
  });
  it('extracts date and exact doctor time (12:30 PM) from announcement with leading post timestamp', () => {
    const ann: Announcement = {
      id: 'ann-user-test',
      courseCode: '1502 101 01',
      courseName: 'Introduction to Computer Eng.',
      title: 'Announcement 1',
      postedAt: '2026-09-12T09:21:00.000Z', // 1:21 PM in UTC+4
      contentText: `1:21 PM Introduction to Computer Eng. - 01 - مقدمة في هندسة الحاسوب Midterm Exam: Monday 12 October 2026 from 12:30 pm to 13:30 pm Dear Students, The Midterm exam is scheduled on Monday, 12 October 2026, from 12:30 pm to 13:30 ...`,
      sourceUrl: 'https://blackboard.sharjah.ac.ae/ultra/stream',
      scannedAt: '2026-09-12T09:35:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    const task = tasks[0];
    const d = new Date(task.dueDate);

    // Assessment time must be 12:30, NOT 13:21 (the post time)!
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(30);

    // Description must NOT have the 1:21 PM or course header prepended
    expect(task.description).not.toContain('1:21 PM');
    expect(task.description).not.toContain('Introduction to Computer Eng. - 01');
    expect(task.description).toContain('Midterm exam');
  });

  it('extracts 12:30 PM even when course name has no period and 24h range is used', () => {
    const ann: Announcement = {
      id: 'ann-24h-test',
      courseCode: '1502 101 01',
      courseName: 'Introduction to Computer Eng',
      title: 'Midterm',
      postedAt: '2026-09-12T09:21:00.000Z',
      contentText: `1:21 PM Introduction to Computer Eng - 01 - مقدمة في هندسة الحاسوب Midterm Exam: Monday 12 October 2026 from 12:30 to 13:30 Dear Students...`,
      sourceUrl: 'https://blackboard.sharjah.ac.ae/ultra/stream',
      scannedAt: '2026-09-12T09:35:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    const task = tasks[0];
    const d = new Date(task.dueDate);
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(30);
  });

  it('extracts start time for Arabic ranges (من الساعة 12:30 إلى 13:30)', () => {
    const ann: Announcement = {
      id: 'ann-ar-test',
      courseCode: '1502 101 01',
      courseName: 'Introduction to Computer Eng.',
      title: 'امتحان نصفي',
      postedAt: '2026-09-12T09:21:00.000Z',
      contentText: `امتحان نصفي: يوم الإثنين 12 أكتوبر 2026 من الساعة 12:30 إلى 13:30 في القاعة...`,
      sourceUrl: 'https://blackboard.sharjah.ac.ae/ultra/stream',
      scannedAt: '2026-09-12T09:35:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    const task = tasks[0];
    const d = new Date(task.dueDate);
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(30);
  });

  it('falls back to class schedule start time (11:00 AM) when doctor gives NO specific time', () => {
    const ann: Announcement = {
      id: 'ann-sched-test',
      courseCode: '1502 101 01',
      courseName: 'Introduction to Computer Eng.',
      title: 'Midterm Announcement',
      postedAt: '2026-09-12T09:21:00.000Z',
      contentText: `Dear Students, Midterm Exam will be held on Monday 12 October 2026 in the regular classroom.`,
      sourceUrl: 'https://blackboard.sharjah.ac.ae/ultra/stream',
      scannedAt: '2026-09-12T09:35:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    const task = tasks[0];
    const d = new Date(task.dueDate);
    // Intro to Comp Eng schedule is 11:00 AM - 12:15 PM!
    expect(d.getHours()).toBe(11);
    expect(d.getMinutes()).toBe(0);
  });

  it('sanitizeDoctorAnnouncementText strips leading timestamps, relative indicators, and course headers', () => {
    const raw1 = `1:21 PM Introduction to Computer Eng. - 01 - مقدمة في هندسة الحاسوب Midterm Exam: Monday 12 October 2026 from 12:30 pm to 13:30 pm Dear Students, The Midterm exam is scheduled on Monday...`;
    const clean1 = sanitizeDoctorAnnouncementText(raw1, 'Introduction to Computer Eng.', '1502 101 01');
    expect(clean1.startsWith('1:21 PM')).toBe(false);
    expect(clean1.startsWith('Introduction to Computer Eng.')).toBe(false);
    expect(clean1).toContain('Midterm Exam: Monday 12 October 2026');

    const raw2 = `14 minutes ago Introduction to Computer Eng. - 01 Dear Students, please submit...`;
    const clean2 = sanitizeDoctorAnnouncementText(raw2, 'Introduction to Computer Eng.', '1502 101 01');
    expect(clean2.startsWith('14 minutes ago')).toBe(false);
    expect(clean2).toBe('Dear Students, please submit...');

    const raw3 = `Today at 1:21 PM Calculus I for Engineering - 02 - حسبان 1 للمهندسين HW 3 is due tomorrow at 11:59 pm`;
    const clean3 = sanitizeDoctorAnnouncementText(raw3, 'Calculus I for Engineering', '1440 133 02');
    expect(clean3).toBe('HW 3 is due tomorrow at 11:59 pm');
  });
});
