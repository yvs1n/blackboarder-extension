import { describe, it, expect } from 'vitest';
import { sanitizeCloudTasks, sanitizeCloudCourses, sanitizeCloudQuickLinks } from '../src/utils/cloudSanitize';
import { filterCleanUserCourses } from '../src/core/courseFilter';
import { isBlackboardSystemNoise } from '../src/core/courseHelper';
import type { UserCourseConfig } from '../src/types';

describe('Unified Backup and Restore Suite', () => {
  it('correctly filters system noise and orientation courses on backup export', () => {
    const rawCourses: Partial<UserCourseConfig>[] = [
      { id: 'c1', courseName: 'Physics 1 Lab', courseCode: 'PHYS101', colorHex: '#0055d4' },
      { id: 'c2', courseName: 'Student Hands-On Orientation', courseCode: 'ORIENT01', colorHex: '#00aa55' },
      { id: 'c3', courseName: 'تهيئة الطلبة المستجدين', courseCode: 'ORNT02', colorHex: '#aa5500' }
    ];

    const exportedCourses = rawCourses.filter(c => !isBlackboardSystemNoise((c.courseName || c.courseCode)!));
    expect(exportedCourses).toHaveLength(1);
    expect(exportedCourses[0].courseName).toBe('Physics 1 Lab');
  });

  it('restores legacy backup files with only tasks and settings without error', () => {
    const legacyBackup = {
      version: '1.4.10',
      exportedAt: '2026-10-20T10:00:00.000Z',
      tasks: [
        { id: 'task-1', title: 'Quiz 1', courseCode: 'PHYS101', courseName: 'Physics 1 Lab', dueDate: '2026-11-01' }
      ],
      settings: {
        remind24h: true
      }
    };

    const sanitizedTasks = sanitizeCloudTasks(legacyBackup.tasks);
    expect(sanitizedTasks).toHaveLength(1);
    expect(sanitizedTasks[0].title).toBe('Quiz 1');

    // Courses and quick links absent in legacy backup
    expect((legacyBackup as any).courses).toBeUndefined();
    expect((legacyBackup as any).quickLinks).toBeUndefined();
  });

  it('restores comprehensive backup files with tasks, courses, quick links, profile and settings', () => {
    const fullBackup = {
      version: '1.4.16',
      exportedAt: '2026-10-30T12:00:00.000Z',
      tasks: [
        { id: 'task-1', title: 'Quiz 3', courseCode: '1420101', courseName: 'Physics 1 Lab', dueDate: '2026-11-05', weight: 10, score: 8.5, maxScore: 10 }
      ],
      courses: [
        {
          id: 'course-phys',
          name: 'Physics 1 Lab',
          code: '1420101',
          color: '#2563eb',
          creditHours: 1,
          scheduleSlots: [{ days: ['Sun'], startTime: '14:00', endTime: '16:00', room: 'Central Lab Men - 105' }],
          syllabus: [{ id: 'comp-1', name: 'Quizzes', type: 'quiz', totalWeight: 30, count: 3 }]
        }
      ],
      quickLinks: [
        { id: 'link-1', title: 'Blackboard', url: 'https://elearning.sharjah.ac.ae' }
      ],
      profile: {
        universityId: 'uos',
        source: 'picked'
      },
      settings: {
        remind24h: true,
        remind1h: true,
        classReminderMinutes: 15,
        autoSync: true
      }
    };

    const sanitizedTasks = sanitizeCloudTasks(fullBackup.tasks);
    const sanitizedCourses = filterCleanUserCourses(sanitizeCloudCourses(fullBackup.courses) || []);
    const sanitizedLinks = sanitizeCloudQuickLinks(fullBackup.quickLinks);

    expect(sanitizedTasks).toHaveLength(1);
    expect(sanitizedTasks[0].title).toBe('Quiz 3');
    expect(sanitizedTasks[0].score).toBe(8.5);

    expect(sanitizedCourses).toHaveLength(1);
    expect(sanitizedCourses[0].courseName).toBe('Physics 1 Lab');
    expect(sanitizedCourses[0].scheduleSlots?.[0].room).toBe('Central Lab Men - 105');
    expect(sanitizedCourses[0].syllabus?.[0].totalWeight).toBe(30);

    expect(sanitizedLinks).toHaveLength(1);
    expect(sanitizedLinks?.[0].url).toBe('https://elearning.sharjah.ac.ae');
  });
});
