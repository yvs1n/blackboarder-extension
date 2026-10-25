import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { filterCourses, findPickedCourse } from '../src/popup/coursePicker';
import { isDraftFresh, DRAFT_MAX_AGE_MS } from '../src/popup/popupDraft';
import type { UserCourseConfig } from '../src/types';

const c = (courseName: string, courseCode: string, aliases: string[] = []): UserCourseConfig =>
  ({ id: courseCode, courseName, courseCode, aliases, colorHex: '#000', scheduleSlots: [], syllabus: [] });

const courses = [
  c('Introduction to Computer Eng.', '1502101', ['comp eng']),
  c('Calculus I for Engineering', '1440133', ['calc']),
  c('English for Academic Purposes', '0202112'),
  c('Physics 1 Lab', '1430116'),
  c('Physics 1', '1430115'),
  c('Islamic Culture', '0104100')
];
const names = (q: string) => filterCourses(courses, q).map(x => x.courseName);

describe('course picker', () => {
  it('lists every course when the field is empty', () => {
    expect(names('')).toHaveLength(6);
  });

  it('narrows as you type, best match first', () => {
    expect(names('cal')).toEqual(['Calculus I for Engineering']);
    expect(names('phy')).toEqual(['Physics 1 Lab', 'Physics 1']);
    expect(names('eng')).toEqual(['English for Academic Purposes', 'Introduction to Computer Eng.', 'Calculus I for Engineering']);
    expect(names('1440')).toEqual(['Calculus I for Engineering']);
    expect(names('comp eng')).toEqual(['Introduction to Computer Eng.']);
    expect(names('zzz')).toEqual([]);
  });

  it('a picked course keeps its own name and code', () => {
    expect(findPickedCourse(courses, 'calculus i for engineering')?.courseCode).toBe('1440133');
    expect(findPickedCourse(courses, '1440 133')?.courseName).toBe('Calculus I for Engineering');
    expect(findPickedCourse(courses, 'Calc')).toBeUndefined();
  });

  it('is attached to the Add and Edit course fields', () => {
    const src = fs.readFileSync('src/popup/popup.ts', 'utf8');
    expect(src).toContain("attachCoursePicker(document.getElementById('add-course') as HTMLInputElement");
    expect(src).toContain('attachCoursePicker(editCourseInput');
    expect(src.match(/const parsedCourse = parsePickedCourse\(course\);/g)).toHaveLength(2);
  });
});

describe('popup reopens unfinished work', () => {
  it('only add, edit and settings drafts that are recent count', () => {
    const now = Date.now();
    expect(isDraftFresh({ view: 'add', savedAt: now - 1000 }, now)).toBe(true);
    expect(isDraftFresh({ view: 'edit', taskId: 'x', savedAt: now }, now)).toBe(true);
    expect(isDraftFresh({ view: 'add', savedAt: now - DRAFT_MAX_AGE_MS - 1 }, now)).toBe(false);
    expect(isDraftFresh({ view: 'calendar' as any, savedAt: now }, now)).toBe(false);
    expect(isDraftFresh(null, now)).toBe(false);
  });

  it('the calendar and details views clear the draft; opening restores it', () => {
    const src = fs.readFileSync('src/popup/popup.ts', 'utf8');
    expect(src).toContain('restoreDraft();');
    expect(src).toMatch(/function switchView[\s\S]*?rememberDraft\(\);\r?\n\}/);
  });
});
