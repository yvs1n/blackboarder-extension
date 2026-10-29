import { describe, it, expect, beforeEach } from 'vitest';
import { processAnnouncementsBatch } from '../src/engine/hybridExtractor';
import { resolveTaskRoom } from '../src/core/courseSchedule';
import { Announcement, DeadlineTask, UserSettings } from '../src/types';
import { setActiveUserCourses } from '../src/core/userCourses';
import { SAMPLE_COURSES } from './fixtures/sampleCourses';

describe('Batch Rescan & In-Place Task Updating Engine', () => {
  beforeEach(() => {
    setActiveUserCourses(SAMPLE_COURSES);
  });
  const defaultSettings: UserSettings = {
    customDomains: [],
    openRouterApiKey: '',
    openRouterModel: 'google/gemini-3.8-flash',
    useAiExtraction: false,
    autoScanOnPageLoad: false,
    badgeNotification: true,
    reminderHoursBefore: 24,
    autoSyncMidnight: true,
    autoSyncOnScan: true
  };

  it('updates truncated announcement description in place without resetting task status or id', async () => {
    // 1. Existing task previously scanned with truncated text ending in ellipsis
    const existingTask: DeadlineTask = {
      id: 'task_1789205760583_5hhhx',
      title: 'Midterm',
      courseName: 'Introduction to Computer Eng.',
      courseCode: '1502 101',
      dueDate: '2026-10-12T08:30:00.000Z',
      hasSpecificTime: true,
      type: 'exam',
      priority: 'high',
      status: 'completed', // User already marked it completed!
      confidence: 0.9,
      extractedBy: 'local',
      description: 'The Midterm exam is scheduled on Monday, 12 October 2026, from 12:30 pm to 13:30 …',
      sourceSnippet: 'The Midterm exam is scheduled on Monday, 12 October 2026, from 12:30 pm to 13:30 …',
      room: 'A8-103', // Default schedule room
      weight: 30,
      weightDisplay: '30% (Midterm Exam)',
      createdAt: '2026-09-12T09:36:00.583Z',
      updatedAt: '2026-09-12T09:36:00.583Z'
    };

    // 2. Incoming announcement discovered on rescan with full unabridged text and custom room
    const fullAnnouncement: Announcement = {
      id: 'ann_full_midterm_123',
      courseCode: '1502 101',
      courseName: 'Introduction to Computer Eng.',
      title: 'Midterm',
      postedAt: '2026-09-12T09:36:00.000Z',
      contentText: 'The Midterm exam is scheduled on Monday, 12 October 2026, from 12:30 pm to 13:30 pm in room A8-204. Please bring your student ID card and pencils.',
      sourceUrl: 'https://elearning.sharjah.ac.ae/ultra/courses/_87148_1/outline',
      scannedAt: '2026-09-22T10:00:00.000Z'
    };

    const { newTasks, allTasks, updatedTasks } = await processAnnouncementsBatch(
      [fullAnnouncement],
      [existingTask],
      defaultSettings
    );

    // Should NOT create duplicate task
    expect(newTasks.length).toBe(0);
    expect(allTasks.length).toBe(1);
    expect(updatedTasks.length).toBe(1);

    const updated = allTasks[0];

    // Preserves original task ID, completion status, and creation date
    expect(updated.id).toBe('task_1789205760583_5hhhx');
    expect(updated.status).toBe('completed');
    expect(updated.createdAt).toBe('2026-09-12T09:36:00.583Z');

    // Description is updated with complete text (no longer ending in '…')
    expect(updated.description).toContain('room A8-204');
    expect(updated.description).toContain('Please bring your student ID card');
    expect(updated.description).not.toContain('…');

    // Room is updated from regular default A8-103 to doctor announced room A8-204
    expect(updated.room).toBe('A8-204');
  });

  it('prioritizes doctor announced room over default schedule room in resolveTaskRoom', () => {
    // Regular room for Intro to Comp Eng is A8-103
    const defaultRes = resolveTaskRoom({
      courseNameOrCode: 'Introduction to Computer Eng.',
      announcementText: 'Midterm will take place next week.',
      title: 'Midterm'
    });
    expect(defaultRes.room).toBe('A8-103');
    expect(defaultRes.isCustom).toBe(false);

    // Doctor posts custom exam room: A8-204
    const customRes = resolveTaskRoom({
      courseNameOrCode: 'Introduction to Computer Eng.',
      announcementText: 'Midterm exam will take place in room A8-204.',
      title: 'Midterm',
      existingRoom: 'A8-103' // previously set to default
    });
    expect(customRes.room).toBe('A8-204');
    expect(customRes.isCustom).toBe(true);
  });

  it('preserves user-edited due date across rescans without reverting or creating duplicates', async () => {
    // Student manually edited this task's due date from Oct 12 to Oct 15
    const userEditedTask: DeadlineTask = {
      id: 'task_1789205760583_5hhhx',
      announcementId: 'ann_full_midterm_123',
      title: 'Midterm',
      courseName: 'Introduction to Computer Eng.',
      courseCode: '1502 101',
      dueDate: '2026-10-15T10:00:00.000Z', // User edited date!
      hasSpecificTime: true,
      userEdited: true, // Marked as userEdited
      type: 'exam',
      priority: 'high',
      status: 'pending',
      confidence: 1,
      extractedBy: 'local',
      description: 'Midterm exam originally Oct 12',
      sourceSnippet: 'Midterm exam originally Oct 12',
      room: 'A8-103',
      createdAt: '2026-09-12T09:36:00.583Z',
      updatedAt: '2026-10-10T08:00:00.000Z'
    };

    // The announcement on Blackboard still has the original Oct 12 date
    const blackboardAnnouncement: Announcement = {
      id: 'ann_full_midterm_123',
      courseCode: '1502 101',
      courseName: 'Introduction to Computer Eng.',
      title: 'Midterm',
      postedAt: '2026-09-12T09:36:00.000Z',
      contentText: 'Midterm exam Monday 12 October 2026 from 12:30 pm to 13:30 pm',
      sourceUrl: '',
      scannedAt: '2026-10-10T12:00:00.000Z'
    };

    const { newTasks, allTasks } = await processAnnouncementsBatch(
      [blackboardAnnouncement],
      [userEditedTask],
      defaultSettings
    );

    // ZERO duplicate tasks created!
    expect(newTasks.length).toBe(0);
    expect(allTasks.length).toBe(1);

    // The student's edited due date is 100% PRESERVED!
    expect(allTasks[0].dueDate).toBe('2026-10-15T10:00:00.000Z');
    expect(allTasks[0].userEdited).toBe(true);
  });
});
