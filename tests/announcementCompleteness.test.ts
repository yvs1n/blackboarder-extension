import { describe, it, expect, beforeEach } from 'vitest';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';
import { sanitizeDoctorAnnouncementText } from '../src/core/courseHelper';
import { Announcement } from '../src/types';
import { setActiveUserCourses, DEFAULT_USER_COURSES } from '../src/core/userCourses';

describe('Announcement Text Extraction Completeness Suite', () => {
  beforeEach(() => {
    setActiveUserCourses(DEFAULT_USER_COURSES);
  });

  it('preserves the complete unabridged doctor announcement body without truncation', () => {
    const fullBody = `Dear Students,

Please note that Quiz 1 will be held on Monday, October 19, 2026 at 11:00 AM.
The quiz will cover Chapters 1, 2, and 3 from the textbook.
Requirements:
1. Bring your scientific calculators.
2. No mobile phones or smartwatches allowed.
3. Seating will be strictly according to the roster posted on the board.

Good luck to all of you,
Dr. Smith`;

    const ann: Announcement = {
      id: 'ann-complete-test',
      courseCode: '1502 101',
      courseName: 'Introduction to Computer Eng.',
      title: 'Quiz 1 Announcement',
      postedAt: '2026-10-12T08:00:00.000Z',
      contentText: fullBody,
      sourceUrl: 'https://blackboard.sharjah.ac.ae/ultra/stream',
      scannedAt: '2026-10-12T08:30:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks.length).toBeGreaterThanOrEqual(1);

    const task = tasks[0];
    expect(task.description).toBe(fullBody.trim());
    expect(task.sourceSnippet).toBe(fullBody.trim());
    expect(task.description).toContain('Requirements:');
    expect(task.description).toContain('Bring your scientific calculators.');
    expect(task.description).toContain('Dr. Smith');
  });

  it('does not slice off the beginning of sentences starting with days, months, or titles', () => {
    const textStartingWithDay = `Monday, 19 October 2026 is the deadline for submitting the term project proposal. Late submissions will receive a 10% penalty per day.`;
    const cleanDay = sanitizeDoctorAnnouncementText(textStartingWithDay, 'Introduction to Computer Eng.', '1502 101', 'Term Project');
    expect(cleanDay).toBe(textStartingWithDay);

    const textStartingWithTitle = `Quiz 1 will take place on Thursday, Oct 22 at 2:00 PM. Please be in class on time.`;
    const cleanTitle = sanitizeDoctorAnnouncementText(textStartingWithTitle, 'Introduction to Computer Eng.', '1502 101', 'Quiz 1');
    expect(cleanTitle).toBe(textStartingWithTitle);
    expect(cleanTitle.startsWith('Quiz 1 will take place')).toBe(true);

    const textStartingWithMonth = `May I remind you that Assignment 2 is due on Sunday, October 25 at 11:59 PM.`;
    const cleanMonth = sanitizeDoctorAnnouncementText(textStartingWithMonth, 'Calculus I for Engineering', '1440 133', 'Assignment 2');
    expect(cleanMonth).toBe(textStartingWithMonth);
  });

  it('strips only stream card noise headers while preserving the full announcement', () => {
    const streamScrapedText = `10:45 AM
Introduction to Computer Eng. - 01 - مقدمة في هندسة الحاسوب
Dear Students,

Midterm Exam will take place on Wednesday, October 21, 2026 from 10:00 AM to 11:30 AM in M11-105.
Please review lecture notes 1 through 5.`;

    const cleaned = sanitizeDoctorAnnouncementText(streamScrapedText, 'Introduction to Computer Eng.', '1502 101', 'Midterm Exam');
    expect(cleaned).not.toContain('10:45 AM');
    expect(cleaned).not.toContain('مقدمة في هندسة الحاسوب');
    expect(cleaned).toContain('Dear Students,');
    expect(cleaned).toContain('Midterm Exam will take place on Wednesday, October 21, 2026');
    expect(cleaned).toContain('Please review lecture notes 1 through 5.');
  });
});
