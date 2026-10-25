import { describe, it, expect } from 'vitest';
import { getCourseHex, getCourseColorTheme, PERMANENT_COURSE_LEGEND } from '../src/core/courseColors';

describe('Permanent Course Colors Mapping', () => {
  it('assigns #7c7c7c to Intro to Computer Engineering', () => {
    expect(getCourseHex('intro to comp eng')).toBe('#7c7c7c');
    expect(getCourseHex('Introduction to Computer Engineering')).toBe('#7c7c7c');
    expect(getCourseHex('Intro to Comp Eng - 0402101')).toBe('#7c7c7c');
    expect(getCourseHex('Computer Engineering')).toBe('#7c7c7c');
    expect(getCourseHex('مقدمة في هندسة الحاسوب')).toBe('#7c7c7c');
  });

  it('assigns #dc2626 to Calculus 1 for Engineering and Roman numeral variants', () => {
    expect(getCourseHex('calculus 1 for engineering')).toBe('#dc2626');
    expect(getCourseHex('Calculus I for Engineering')).toBe('#dc2626'); // Roman numeral I
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
    expect(getCourseHex('Physics I')).toBe('#4b99d2');
    expect(getCourseHex('General Physics 1')).toBe('#4b99d2');
    expect(getCourseHex('Phys 1')).toBe('#4b99d2');
    expect(getCourseHex('الفيزياء')).toBe('#4b99d2');
  });

  it('assigns #4b99d2 to Physics 1 Lab', () => {
    expect(getCourseHex('physics 1 lab')).toBe('#4b99d2');
    expect(getCourseHex('Physics I Lab')).toBe('#4b99d2');
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
    expect(getCourseHex('الثقافة الاسلامية')).toBe('#489160'); // without hamza
    expect(getCourseHex('Islamic Studies')).toBe('#489160');
  });

  it('assigns color based on task title context when courseName is generic', () => {
    expect(getCourseHex('General Course', 'UOS', 'Calculus Assignment 1')).toBe('#dc2626');
    expect(getCourseHex('', '', 'Physics 1 Quiz')).toBe('#4b99d2');
    expect(getCourseHex('General Course', '', 'Islamic Culture HW')).toBe('#489160');
  });

  it('provides complete PERMANENT_COURSE_LEGEND with all 6 subjects', () => {
    expect(PERMANENT_COURSE_LEGEND.length).toBe(6);
    expect(PERMANENT_COURSE_LEGEND.map(c => c.hex)).toEqual([
      '#7c7c7c',
      '#dc2626',
      '#4b99d2',
      '#4b99d2',
      '#525252',
      '#489160'
    ]);
  });
});
