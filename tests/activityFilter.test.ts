import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  activityItemMatches,
  classifyActivityItem,
  sanitizeActivityFilter,
  ACTIVITY_CATEGORIES
} from '../src/core/activityCategories';
import { activityCourseLabel, courseKeyFor, isActivityPage } from '../src/content/activityFilter';

const item = (icon: string, title: string, text = '') => classifyActivityItem({ icon: `bb-ui-icon-large-${icon}`, title, text });

describe('Activity filter: what an item is about', () => {
  it('grades by icon or "Grade posted"', () => {
    expect(item('grades', 'Grade posted: Attendance')).toBe('grades');
    expect(item('document-text', 'Grade posted: Midterm')).toBe('grades');
  });

  it('exams and quizzes, including file names with underscores or glued digits', () => {
    expect(item('pdf', 'Added: Formula Sheet - Phys 1 - midterm.pdf')).toBe('exams');
    expect(item('pdf', 'Added: Physics1_Final_2025.pdf')).toBe('exams');
    expect(item('pdf', 'Added: Midterm_Exam_ Phys1_Summer_2022-2023.pdf')).toBe('exams');
    expect(item('announcement', 'Quiz 2', 'Dear students, the quiz is on Monday')).toBe('exams');
    expect(item('announcement', 'تنبيه', 'امتحان نصفي يوم الاثنين')).toBe('exams');
  });

  it('assignments and labs, including lab experiment sheets', () => {
    expect(item('document-text', 'Added: 3rd assignment physics 1 lab.docx')).toBe('assignments');
    expect(item('document-text', 'Added: Exp. (08)- Work-Kinetic Energy Theorem')).toBe('assignments');
    expect(item('announcement', 'Homework 3 is posted')).toBe('assignments');
  });

  it('other announcements stay announcements and other files are materials', () => {
    expect(item('announcement', 'Course Evaluation', 'Please fill in the evaluation')).toBe('announcements');
    expect(item('pdf', 'Added: 3.7 Optimization.pdf')).toBe('materials');
    expect(item('presentation', 'Added: PP implied main idea')).toBe('materials');
    expect(classifyActivityItem({ icon: '', title: '' })).toBe('materials');
  });
});

describe('Activity filter: matching and saved choices', () => {
  it('any chosen chip in a row matches; both rows must match; empty means all', () => {
    const none = { courses: [], types: [] };
    expect(activityItemMatches(none, 'physics 1', 'grades')).toBe(true);
    const f = { courses: ['physics 1', 'calculus i for engineering'], types: ['exams' as const] };
    expect(activityItemMatches(f, 'physics 1', 'exams')).toBe(true);
    expect(activityItemMatches(f, 'calculus i for engineering', 'exams')).toBe(true);
    expect(activityItemMatches(f, 'physics 1', 'materials')).toBe(false);
    expect(activityItemMatches(f, 'university', 'exams')).toBe(false);
  });

  it('a saved filter keeps only known types and sensible course keys', () => {
    expect(sanitizeActivityFilter(null)).toEqual({ courses: [], types: [] });
    expect(sanitizeActivityFilter({ courses: ['physics 1', 'physics 1', 3, ''], types: ['exams', 'hacked', 'exams'] })).toEqual({
      courses: ['physics 1'],
      types: ['exams']
    });
    expect(ACTIVITY_CATEGORIES.map(c => c.id)).toEqual(['exams', 'assignments', 'grades', 'materials', 'announcements']);
  });
});

describe('Activity filter: course chips', () => {
  it('one chip per course: section and Arabic parts are dropped, hyphenated words stay', () => {
    expect(activityCourseLabel('Physics 1- ALL - الفيزياء-1')).toBe('Physics 1');
    expect(activityCourseLabel('Physics 1- 02 - الفيزياء-1')).toBe('Physics 1');
    expect(activityCourseLabel('Calculus I for Engineering- 02 - حسبان 1 للمهندسين')).toBe('Calculus I for Engineering');
    expect(activityCourseLabel('Student Hands-On Orientation')).toBe('Student Hands-On Orientation');
    expect(courseKeyFor('Physics 1')).toBe(courseKeyFor('physics  1'));
  });

  it('runs only on the Activity page', () => {
    expect(isActivityPage('/ultra/stream')).toBe(true);
    expect(isActivityPage('/ultra/stream/')).toBe(true);
    expect(isActivityPage('/ultra/stream/announcement/bb-announcement1')).toBe(false);
    expect(isActivityPage('/ultra/courses/_1_1/outline')).toBe(false);
  });

  it('is started by the content script, loads more through Blackboard\'s own button, and hides with a class', () => {
    expect(fs.readFileSync('src/content/scraper.ts', 'utf8')).toContain('startActivityFilter(getBlackboardJson)');
    expect(fs.readFileSync('src/content/activityFilter.ts', 'utf8')).toContain("'button.load-more-items'");
    const css = fs.readFileSync('src/content/content.css', 'utf8').replace(/\r\n/g, '\n');
    expect(css).toContain('html body li.bbs-af-hidden {\n  display: none !important;\n}');
    expect(css).toMatch(/html\.bbs-dark-active #bbs-activity-filter \.bbs-af-chip\[aria-pressed="true"\]/);
  });
});
