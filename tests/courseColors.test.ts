import { describe, it, expect, beforeEach } from 'vitest';
import { getCourseHex, getCourseColorTheme, findConfiguredCourseHex } from '../src/core/courseColors';
import { setActiveUserCourses, resetActiveUserCourses } from '../src/core/userCourses';
import { SAMPLE_COURSES } from './fixtures/sampleCourses';
import type { UserCourseConfig } from '../src/types';

const FALLBACK_PALETTE = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#db2777', '#0891b2'];

describe('Course colours come from the student\'s own courses', () => {
  beforeEach(() => {
    setActiveUserCourses(SAMPLE_COURSES);
  });

  it('assigns #7c7c7c to Intro to Computer Engineering', () => {
    expect(getCourseHex('intro to comp eng')).toBe('#7c7c7c');
    expect(getCourseHex('Introduction to Computer Engineering')).toBe('#7c7c7c');
    expect(getCourseHex('Intro to Comp Eng - 0402101')).toBe('#7c7c7c');
    expect(getCourseHex('Computer Engineering')).toBe('#7c7c7c');
    expect(getCourseHex('مقدمة في هندسة الحاسوب')).toBe('#7c7c7c');
  });

  it('assigns #dc2626 to Calculus 1 for Engineering and Roman numeral variants', () => {
    expect(getCourseHex('calculus 1 for engineering')).toBe('#dc2626');
    expect(getCourseHex('Calculus I for Engineering')).toBe('#dc2626');
    expect(getCourseColorTheme('Calculus 1').hex).toBe('#dc2626');
    expect(getCourseHex('Calculus I for Engineering - 02 - حسبان 1 للمهندسين')).toBe('#dc2626');
    expect(getCourseHex('Calculus 1')).toBe('#dc2626');
    expect(getCourseHex('Calculus I')).toBe('#dc2626');
    expect(getCourseHex('Calculus')).toBe('#dc2626');
    expect(getCourseHex('Calc 1 Engineering')).toBe('#dc2626');
    expect(getCourseHex('حسبان 1 للمهندسين')).toBe('#dc2626');
    expect(getCourseHex('حسبان')).toBe('#dc2626');
    expect(getCourseHex('1440131')).toBe('#dc2626');
  });

  it('assigns #4b99d2 to Physics 1 and its stream card string', () => {
    expect(getCourseHex('physics 1')).toBe('#4b99d2');
    expect(getCourseHex('Physics 1 - ALL - 1 - الفيزياء-1')).toBe('#4b99d2');
    expect(getCourseHex('General Physics 1')).toBe('#4b99d2');
  });

  it('assigns #4b99d2 to Physics 1 Lab', () => {
    expect(getCourseHex('physics 1 lab')).toBe('#4b99d2');
    expect(getCourseHex('Physics Lab 1')).toBe('#4b99d2');
    expect(getCourseHex('Lab Physics 1')).toBe('#4b99d2');
    expect(getCourseHex('مختبر فيزياء 1')).toBe('#4b99d2');
  });

  it('assigns #525252 to English for Academic Purposes', () => {
    expect(getCourseHex('english for academic purposes')).toBe('#525252');
    expect(getCourseHex('English for Academic Purposes (EAP)')).toBe('#525252');
    expect(getCourseHex('Academic English')).toBe('#525252');
    expect(getCourseHex('EAP')).toBe('#525252');
    expect(getCourseHex('English')).toBe('#525252');
  });

  it('assigns #489160 to Islamic Culture', () => {
    expect(getCourseHex('islamic culture')).toBe('#489160');
    expect(getCourseHex('Islamic Culture - 13A - الثقافة الإسلامية')).toBe('#489160');
    expect(getCourseHex('الثقافة الإسلامية')).toBe('#489160');
    expect(getCourseHex('الثقافة الاسلامية')).toBe('#489160');
    expect(getCourseHex('Islamic Studies')).toBe('#489160');
  });

  it('assigns color based on task title context when courseName is generic', () => {
    expect(getCourseHex('General Course', 'UOS', 'Calculus Assignment 1')).toBe('#dc2626');
    expect(getCourseHex('', '', 'Physics 1 Quiz')).toBe('#4b99d2');
    expect(getCourseHex('General Course', '', 'Islamic Culture HW')).toBe('#489160');
  });

  it('only finds a course through the student\'s own names and aliases', () => {
    // These used to hit a built-in table of this semester's courses; they name none of the
    // sample courses' names or aliases, so they take a steady fallback colour
    for (const text of ['Physics I', 'Phys 1', 'الفيزياء']) {
      expect(FALLBACK_PALETTE).toContain(getCourseHex(text));
      expect(getCourseHex(text)).toBe(getCourseHex(text));
    }
    // An alias the student adds makes them match
    const withAlias = SAMPLE_COURSES.map(c => c.id === 'phy1' ? { ...c, aliases: [...c.aliases, 'phys\\s*(?:1|i)(?!\\s*lab)', 'الفيزياء'] } : c);
    setActiveUserCourses(withAlias);
    expect(getCourseHex('Physics I')).toBe('#4b99d2');
    expect(getCourseHex('Phys 1')).toBe('#4b99d2');
    expect(getCourseHex('الفيزياء')).toBe('#4b99d2');
  });

  it('uses each course\'s own colour for a lecture course and its lab', () => {
    const courses: UserCourseConfig[] = [
      { id: 'a', courseCode: 'CHEM 101', courseName: 'Chemistry 1', colorHex: '#111111', aliases: [], scheduleSlots: [], syllabus: [] },
      { id: 'b', courseCode: 'CHEM 102', courseName: 'Chemistry 1 Lab', colorHex: '#222222', aliases: [], scheduleSlots: [], syllabus: [] }
    ];
    setActiveUserCourses(courses);
    expect(getCourseHex('Chemistry 1')).toBe('#111111');
    expect(getCourseHex('Chemistry 1 Lab')).toBe('#222222');
    expect(getCourseHex('Chemistry 1 Lab report')).toBe('#222222');
    expect(findConfiguredCourseHex('Chemistry 1 Lab')).toBe('#222222');
    expect(findConfiguredCourseHex('', 'CHEM101')).toBe('#111111');
  });

  it('has no built-in course colours when the student has no courses', () => {
    resetActiveUserCourses();
    expect(FALLBACK_PALETTE).toContain(getCourseHex('Calculus I for Engineering'));
    expect(findConfiguredCourseHex('Calculus I for Engineering', '1440133')).toBeNull();
  });
});
