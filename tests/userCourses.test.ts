import { describe, it, expect, beforeEach } from 'vitest';
import {
  userCoursesToScheduleEntries,
  userCoursesToSyllabi,
  userCoursesToLegend,
  getActiveUserCourses,
  setActiveUserCourses,
  resetActiveUserCourses,
  getActiveCourseLegend
} from '../src/core/userCourses';
import { findCourseSchedule } from '../src/core/courseSchedule';
import { findCourseSyllabus, resolveTaskWeight } from '../src/core/syllabusWeights';
import { UserCourseConfig, DeadlineTask } from '../src/types';
import {
  saveUserCourses,
  recalculateTasksWithActiveCourses,
  saveTasks,
  autoRegisterDiscoveredCourses
} from '../src/utils/storage';
import { SAMPLE_COURSES } from './fixtures/sampleCourses';

describe('Dynamic User Courses & Adapters (userCourses.ts)', () => {
  beforeEach(() => {
    resetActiveUserCourses();
  });

  it('sample fixture has 6 courses with valid schedule and syllabus definitions', () => {
    expect(SAMPLE_COURSES.length).toBe(6);

    const calc = SAMPLE_COURSES.find(c => c.id === 'calc1');
    expect(calc).toBeDefined();
    expect(calc?.scheduleSlots[0].startTime).toBe('12:30');
    expect(calc?.scheduleSlots[0].endTime).toBe('13:45');
    expect(calc?.scheduleSlots[0].room).toBe('A12-110');
    expect(calc?.syllabus.length).toBeGreaterThan(0);

    const phyLab = SAMPLE_COURSES.find(c => c.id === 'phy1lab');
    expect(phyLab).toBeDefined();
    expect(phyLab?.scheduleSlots[0].room).toBe('Central Lab Men - 105');
  });

  it('converts UserCourseConfig[] into CourseScheduleEntry[]', () => {
    const entries = userCoursesToScheduleEntries(SAMPLE_COURSES);
    expect(entries.length).toBe(6);

    const comp = entries.find(e => e.courseId === 'compeng');
    expect(comp).toBeDefined();
    expect(comp?.startHour).toBe(11);
    expect(comp?.startMinute).toBe(0);
    expect(comp?.room).toBe('A8-103');
    expect(comp?.matcher.test('Introduction to Computer Eng.')).toBe(true);
    expect(comp?.matcher.test('1502101')).toBe(true);
  });

  it('converts UserCourseConfig[] into CourseSyllabus[]', () => {
    const syllabi = userCoursesToSyllabi(SAMPLE_COURSES);
    expect(syllabi.length).toBe(6);

    const eap = syllabi.find(s => s.courseId === 'eap');
    expect(eap).toBeDefined();
    expect(eap?.components.length).toBe(5);

    const finalExam = eap?.components.find(c => c.id === 'eap_final');
    expect(finalExam?.totalWeight).toBe(40);
    expect(finalExam?.matcher.test('Final Exam')).toBe(true);
  });

  it('converts UserCourseConfig[] into course legend items', () => {
    const legend = userCoursesToLegend(SAMPLE_COURSES);
    expect(legend.length).toBe(6);
    expect(legend.find(l => l.name === 'Calculus I for Engineering')?.hex).toBe('#dc2626');
  });

  it('dynamically adapts findCourseSchedule and resolveTaskWeight when active courses change', () => {
    const customCourses: UserCourseConfig[] = [
      {
        id: 'softeng',
        courseCode: '1501 301',
        courseName: 'Software Engineering',
        colorHex: '#8b5cf6',
        aliases: ['software eng', 'sw eng'],
        scheduleSlots: [
          {
            days: ['Monday', 'Wednesday'],
            startTime: '10:00',
            endTime: '11:15',
            room: 'M9-205'
          }
        ],
        syllabus: [
          {
            id: 'se_sprint1',
            name: 'Sprint 1 Deliverable',
            type: 'project',
            totalWeight: 25,
            keywords: ['sprint 1', 'deliverable']
          }
        ]
      }
    ];

    setActiveUserCourses(customCourses);

    // Verify schedule entry matches custom course
    const schedule = findCourseSchedule('Software Engineering');
    expect(schedule).toBeDefined();
    expect(schedule?.room).toBe('M9-205');
    expect(schedule?.startHour).toBe(10);

    // Verify syllabus weights resolve custom component
    const syllabus = findCourseSyllabus('Software Engineering');
    expect(syllabus).toBeDefined();

    const weightRes = resolveTaskWeight({
      courseName: 'Software Engineering',
      title: 'Sprint 1 Deliverable submission'
    });
    expect(weightRes.weight).toBe(25);
    expect(weightRes.componentName).toBe('Sprint 1 Deliverable');
  });

  it('recalculates task weights and rooms when recalculateTasksWithActiveCourses is called', async () => {
    const customCourses: UserCourseConfig[] = [
      {
        id: 'bio101',
        courseCode: '1410 101',
        courseName: 'General Biology',
        colorHex: '#10b981',
        aliases: ['biology', 'bio'],
        scheduleSlots: [
          {
            days: ['Sunday', 'Tuesday', 'Thursday'],
            startTime: '09:00',
            endTime: '09:50',
            room: 'W11-102'
          }
        ],
        syllabus: [
          {
            id: 'bio_midterm',
            name: 'Midterm Exam',
            type: 'exam',
            totalWeight: 35,
            keywords: ['midterm']
          }
        ]
      }
    ];

    // Set custom courses
    await saveUserCourses(customCourses);

    // Create a task that previously had no weight and no room
    const testTask = {
      id: 'task_bio_test',
      title: 'Midterm Exam Biology',
      courseName: 'General Biology',
      courseCode: '1410 101',
      type: 'exam',
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      hasSpecificTime: false,
      status: 'pending',
      userEdited: false,
      createdAt: new Date().toISOString()
    } as unknown as DeadlineTask;

    await saveTasks([testTask]);

    const updated = await recalculateTasksWithActiveCourses();
    const recalculated = updated.find(t => t.id === 'task_bio_test');

    expect(recalculated).toBeDefined();
    expect(recalculated?.weight).toBe(35);
    expect(recalculated?.room).toBe('W11-102');

    // Clean up
    await saveUserCourses(SAMPLE_COURSES);
  });

  it('reactively updates active legend when custom courses are added or modified', async () => {
    const initialLegend = getActiveCourseLegend();
    expect(initialLegend.length).toBe(0);

    const extraCourse: UserCourseConfig = {
      id: 'chem1',
      courseCode: '1420 101',
      courseName: 'General Chemistry I',
      colorHex: '#059669',
      aliases: ['chem 1', 'chemistry'],
      scheduleSlots: [],
      syllabus: []
    };

    await saveUserCourses([...SAMPLE_COURSES, extraCourse]);
    const updatedLegend = getActiveCourseLegend();
    expect(updatedLegend.length).toBe(7);

    const chemEntry = updatedLegend.find(l => l.name === 'General Chemistry I');
    expect(chemEntry).toBeDefined();
    expect(chemEntry?.hex).toBe('#059669');
    expect(chemEntry?.pattern.test('chem 1')).toBe(true);

    await saveUserCourses(SAMPLE_COURSES);
    expect(getActiveCourseLegend().length).toBe(6);
  });

  it('automatically registers newly discovered courses during scans into user courses', async () => {
    // Start with empty custom courses
    await saveUserCourses([]);
    expect(getActiveUserCourses().length).toBe(0);

    const scannedTasks = [
      {
        id: 't-stat',
        title: 'Homework 1',
        courseName: 'Applied Statistics',
        courseCode: '1440 211',
        type: 'assignment',
        dueDate: '2026-10-20T23:59:00.000Z',
        hasSpecificTime: false,
        status: 'pending',
        userEdited: false,
        createdAt: new Date().toISOString()
      },
      {
        id: 't-algo',
        title: 'Quiz 1',
        courseName: 'Analysis of Algorithms',
        courseCode: '1501 331',
        type: 'quiz',
        dueDate: '2026-10-22T10:00:00.000Z',
        hasSpecificTime: true,
        status: 'pending',
        userEdited: false,
        createdAt: new Date().toISOString()
      }
    ] as unknown as DeadlineTask[];

    const result = await autoRegisterDiscoveredCourses(scannedTasks);
    expect(result.length).toBe(2);
    expect(result.some(c => c.courseName === 'Applied Statistics')).toBe(true);
    expect(result.some(c => c.courseName === 'Analysis of Algorithms')).toBe(true);

    // Running again with the same tasks should not create duplicates
    const rerun = await autoRegisterDiscoveredCourses(scannedTasks);
    expect(rerun.length).toBe(2);

    // Active legend reflects the newly auto-registered courses
    const legend = getActiveCourseLegend();
    expect(legend.length).toBe(2);
  });

  it('rejects navigation tabs from being auto-registered and cleanses corrupted courses', async () => {
    const { autoRegisterDiscoveredCourses, filterCleanUserCourses, getUserCourses, saveUserCourses } = await import('../src/utils/storage');

    // Start with empty
    await saveUserCourses([]);

    // Attempt to register navigation tabs
    const noisyItems = [
      { courseName: 'Content' },
      { courseName: 'Calendar' },
      { courseName: 'Discussions' },
      { courseName: 'Gradebook' },
      { courseName: 'Messages' },
      { courseName: 'Analytics' },
      { courseName: 'Organic Chemistry', courseCode: '1420 211' }
    ];

    const registered = await autoRegisterDiscoveredCourses(noisyItems);
    expect(registered.length).toBe(1);
    expect(registered[0].courseName).toBe('Organic Chemistry');
    expect(registered.some(c => c.courseName === 'Content')).toBe(false);
    expect(registered.some(c => c.courseName === 'Calendar')).toBe(false);
    expect(registered.some(c => c.courseName === 'Discussions')).toBe(false);
    expect(registered.some(c => c.courseName === 'Gradebook')).toBe(false);

    // If storage already contains legacy corrupted courses, filterCleanUserCourses cleans them
    const corruptedList: any[] = [
      { id: 'c1', courseName: 'Content', courseCode: 'Content' },
      { id: 'c2', courseName: 'Calendar', courseCode: 'Calendar' },
      { id: 'c3', courseName: 'Physics 1', courseCode: '1430 115' },
      { id: 'c4', courseName: 'Discussions', courseCode: 'Discussions' },
      { id: 'c5', courseName: 'Gradebook', courseCode: 'Gradebook' }
    ];
    const cleaned = filterCleanUserCourses(corruptedList);
    expect(cleaned.length).toBe(1);
    expect(cleaned[0].courseName).toBe('Physics 1');

    // When getUserCourses loads corrupted courses, it prunes them automatically
    await saveUserCourses(corruptedList);
    const loaded = await getUserCourses();
    expect(loaded.length).toBe(1);
    expect(loaded[0].courseName).toBe('Physics 1');
  });

  it('rejects Blackboard Details & Actions sidebar items and deduplicates whitespace-variant course codes', async () => {
    const { autoRegisterDiscoveredCourses, filterCleanUserCourses, saveUserCourses } = await import('../src/utils/storage');

    await saveUserCourses([]);

    const detailsAndActionsNoise = [
      { courseName: 'Achievements', courseCode: 'Achievements' },
      { courseName: 'Join session', courseCode: 'Join session' },
      { courseName: 'Course Room', courseCode: 'Course Room' },
      { courseName: 'Roster View everyone in your', courseCode: 'Roster View everyone in your' },
      { courseName: 'Attendance View your attendance', courseCode: 'Attendance View your attendance' },
      { courseName: 'Books & Tools View & institution tools', courseCode: 'Books & Tools View & institution tools' },
      { courseName: 'Topic of a paragraph', courseCode: 'Topic of a paragraph' },
      { courseName: 'Physics 1', courseCode: '1430 115' },
      { courseName: 'Physics 1', courseCode: '1430115' }
    ];

    const registered = await autoRegisterDiscoveredCourses(detailsAndActionsNoise);
    expect(registered.length).toBe(1);
    expect(registered[0].courseName).toBe('Physics 1');

    const cleaned = filterCleanUserCourses(detailsAndActionsNoise as any);
    expect(cleaned.length).toBe(1);
    expect(cleaned[0].courseName).toBe('Physics 1');
  });

  it('normalizes sync keys to uppercase and does not hardcode personal keys in getCachedSettingsSync', async () => {
    const { normalizeRestoredSyncKey, getCachedSettingsSync } = await import('../src/utils/storage');

    expect(normalizeRestoredSyncKey('  bbs-test01  ')).toBe('BBS-TEST01');
    expect(normalizeRestoredSyncKey('')).toBe('');

    const cached = getCachedSettingsSync();
    expect(cached.openRouterApiKey).toBe('');
  });
});
