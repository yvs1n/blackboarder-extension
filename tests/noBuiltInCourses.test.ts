import { describe, it, expect, beforeEach } from 'vitest';
import { filterCleanUserCourses } from '../src/core/courseFilter';
import * as userCourses from '../src/core/userCourses';
import * as courseColors from '../src/core/courseColors';
import * as courseSchedule from '../src/core/courseSchedule';
import * as syllabusWeights from '../src/core/syllabusWeights';
import { compileCoursePattern, setActiveUserCourses, resetActiveUserCourses, activeCourseHintOptions } from '../src/core/userCourses';
import { findCourseSchedule } from '../src/core/courseSchedule';
import { findCourseSyllabus } from '../src/core/syllabusWeights';
import { parseCourseDetails, resolveCourseInfo, sanitizeDoctorAnnouncementText } from '../src/core/courseHelper';
import type { UserCourseConfig } from '../src/types';
import { SAMPLE_COURSES } from './fixtures/sampleCourses';

function course(partial: Partial<UserCourseConfig>): UserCourseConfig {
  return { id: 'c', courseCode: '', courseName: '', colorHex: '#123456', aliases: [], scheduleSlots: [], syllabus: [], ...partial };
}

describe('no built-in courses', () => {
  beforeEach(() => resetActiveUserCourses());

  it('ships no default course, schedule, syllabus or colour tables', () => {
    expect('DEFAULT_USER_COURSES' in userCourses).toBe(false);
    expect('PERMANENT_COURSE_LEGEND' in courseColors).toBe(false);
    expect('STUDENT_CLASS_SCHEDULE' in courseSchedule).toBe(false);
    expect('DEFAULT_SYLLABUS_DATABASE' in syllabusWeights).toBe(false);
  });

  it('knows no course until the student has some', () => {
    expect(findCourseSchedule('Calculus I for Engineering')).toBeNull();
    expect(findCourseSyllabus('Calculus I for Engineering', '1440133')).toBeNull();
    expect(resolveCourseInfo({ courseName: 'General Course', title: 'Calculus quiz' }).courseName).toBe('General Course');
    expect(parseCourseDetails('حسبان 1 للمهندسين').code).toBe('UOS');
    expect(activeCourseHintOptions()).toEqual([]);
  });

  it('keeps saved courses shaped like the old built-in ones, including ones without an academic code', () => {
    // Courses saved by older versions: same ids as the removed defaults, plus a course added by hand
    expect(filterCleanUserCourses(SAMPLE_COURSES).map(c => c.id)).toEqual(['compeng', 'calc1', 'eap', 'phy1lab', 'phy1', 'islamic']);
    const saved = [
      // Passed only because its id was a built-in id: no academic code in either field
      course({ id: 'compeng', courseCode: 'COMPENG', courseName: 'Intro to Comp Eng' }),
      course({ id: 'phy1lab', courseCode: '', courseName: 'Physics 1 Lab' }),
      course({ id: 'manual_1', courseCode: '', courseName: 'Arabic Language Skills' }),
      course({ id: 'manual_2', courseCode: 'Seminar', courseName: 'Research Seminar' })
    ];
    expect(filterCleanUserCourses(saved).map(c => c.id)).toEqual(['compeng', 'phy1lab', 'manual_1', 'manual_2']);
  });

  it('still drops Blackboard navigation labels and duplicates', () => {
    const kept = filterCleanUserCourses([
      course({ id: 'a', courseName: 'Content' }),
      course({ id: 'b', courseName: 'Gradebook', courseCode: 'Grades' }),
      course({ id: 'c', courseName: 'Physics 1', courseCode: '1430115' }),
      course({ id: 'd', courseName: 'physics 1', courseCode: '1430 115' }),
      course({ id: 'e', courseName: '', courseCode: '' })
    ]);
    expect(kept.map(c => c.id)).toEqual(['c']);
  });

  it('keeps a lecture course off its lab\'s text because the lab is one of the student\'s courses', () => {
    const lecture = course({ id: 'l', courseName: 'Chemistry 1', courseCode: 'CHEM 101' });
    const lab = course({ id: 'b', courseName: 'Chemistry 1 Lab', courseCode: 'CHEM 102' });
    const alone = compileCoursePattern(lecture);
    const withLab = compileCoursePattern(lecture, [lecture, lab]);
    expect(alone.test('Chemistry 1 Lab report')).toBe(true);
    expect(withLab.test('Chemistry 1 Lab report')).toBe(false);
    expect(withLab.test('Chemistry 1 quiz')).toBe(true);

    setActiveUserCourses([lecture, lab]);
    expect(resolveCourseInfo({ courseName: '', title: 'Chemistry 1 Lab report 2' }).courseName).toBe('Chemistry 1 Lab');
    expect(resolveCourseInfo({ courseName: '', title: 'Chemistry 1 midterm' }).courseName).toBe('Chemistry 1');
  });

  it('attributes Physics 1 and Physics 1 Lab text from the student\'s courses', () => {
    setActiveUserCourses(SAMPLE_COURSES);
    expect(findCourseSchedule('Physics 1 Lab')?.courseId).toBe('phy1lab');
    expect(findCourseSchedule('Physics 1')?.courseId).toBe('phy1');
    expect(findCourseSchedule('physics lab report')?.courseId).toBe('phy1lab');
    expect(findCourseSyllabus('Physics 1 Lab')?.courseId).toBe('phy1lab');
    expect(findCourseSyllabus('Physics 1')?.courseId).toBe('phy1');
    expect(resolveCourseInfo({ courseName: 'General Course', title: 'Free Fall Exp. - Lab Report' }).courseName).toBe('Physics 1 Lab');
    expect(parseCourseDetails('Measuring Density - Lab Report')).toEqual({ code: '1430116', name: 'Physics 1 Lab' });
  });

  it('strips a "<name> - <section> - <Arabic name>" header for any of the student\'s courses', () => {
    setActiveUserCourses([course({ id: 'x', courseName: 'Organic Chemistry', courseCode: 'CHEM 201', aliases: ['orgo'] })]);
    const text = '2:05 PM Organic Chemistry - 03 - الكيمياء العضوية Quiz 2 is on Monday in room B12-105';
    expect(sanitizeDoctorAnnouncementText(text)).toBe('Quiz 2 is on Monday in room B12-105');
    expect(sanitizeDoctorAnnouncementText('orgo - 01 Dear students, the lab moves online')).toBe('Dear students, the lab moves online');
  });

  it('lists the student\'s courses with their first room for the paste hint', () => {
    setActiveUserCourses(SAMPLE_COURSES);
    const options = activeCourseHintOptions();
    expect(options).toHaveLength(6);
    expect(options).toContainEqual({ value: 'Calculus I for Engineering', label: 'Calculus I for Engineering (A12-110)' });
  });
});
