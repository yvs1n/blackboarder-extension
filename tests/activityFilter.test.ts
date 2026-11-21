// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import {
  activityItemMatches,
  classifyActivityItem,
  sanitizeActivityFilter,
  ACTIVITY_CATEGORIES
} from '../src/core/activityCategories';
import {
  PRELOADER_ID,
  activityCourseLabel,
  courseKeyFor,
  isActivityPage,
  isExcludedActivityCourse,
  startActivityFilter
} from '../src/content/activityFilter';
import { setActiveUserCourses } from '../src/core/userCourses';

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

  it('a saved filter keeps only known types and sensible course keys, stripping non-courses', () => {
    expect(sanitizeActivityFilter(null)).toEqual({ courses: [], types: [] });
    expect(
      sanitizeActivityFilter({
        courses: ['physics 1', 'physics 1', 'university', 'student hands on orientation', 3, ''],
        types: ['exams', 'hacked', 'exams']
      })
    ).toEqual({
      courses: ['physics 1'],
      types: ['exams']
    });
    expect(ACTIVITY_CATEGORIES.map(c => c.id)).toEqual(['exams', 'assignments', 'grades', 'materials', 'announcements']);
  });
});

describe('Activity filter: course chips & background preloader', () => {
  beforeEach(() => {
    setActiveUserCourses([]);
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/ultra/stream');
  });

  it('one chip per course: section and Arabic parts are dropped, hyphenated words stay', () => {
    expect(activityCourseLabel('Physics 1- ALL - الفيزياء-1')).toBe('Physics 1');
    expect(activityCourseLabel('Physics 1- 02 - الفيزياء-1')).toBe('Physics 1');
    expect(activityCourseLabel('Calculus I for Engineering- 02 - حسبان 1 للمهندسين')).toBe('Calculus I for Engineering');
    expect(activityCourseLabel('RES691_SEP26 - Qualitative Research Methods and Paradigms')).toBe('Qualitative Research Methods and Paradigms');
    expect(activityCourseLabel('Student Hands-On Orientation')).toBe('Student Hands-On Orientation');
    expect(courseKeyFor('Physics 1')).toBe(courseKeyFor('physics  1'));
  });

  it('excludes Student Hands-On Orientation, University, and sandbox shells while keeping real academic courses', () => {
    expect(isExcludedActivityCourse('Student Hands-On Orientation')).toBe(true);
    expect(isExcludedActivityCourse('Library Essentials: Your Complete Student Guide')).toBe(true);
    expect(isExcludedActivityCourse('University')).toBe(true);
    expect(isExcludedActivityCourse('university')).toBe(true);
    expect(isExcludedActivityCourse('Orientation_2026', 'ORIENT_101')).toBe(true);
    expect(isExcludedActivityCourse('Faculty Sandbox', 'SANDBOX_01')).toBe(true);

    expect(isExcludedActivityCourse('Calculus I for Engineering')).toBe(false);
    expect(isExcludedActivityCourse('English for Academic Purposes')).toBe(false);
    expect(isExcludedActivityCourse('Introduction to Computer Eng.')).toBe(false);
    expect(isExcludedActivityCourse('Islamic Culture')).toBe(false);
    expect(isExcludedActivityCourse('Physics 1')).toBe(false);
    expect(isExcludedActivityCourse('Physics 1 Lab')).toBe(false);
  });

  it('seeds all real courses immediately without scrolling, never shows Orientation or University chips, and runs the preloader', async () => {
    setActiveUserCourses([
      { id: 'c1', courseName: 'Calculus I for Engineering', courseCode: '1411116', colorHex: '#ef4444', aliases: [], scheduleSlots: [], syllabus: [] },
      { id: 'c2', courseName: 'Physics 1', courseCode: '1430115', colorHex: '#3b82f6', aliases: [], scheduleSlots: [], syllabus: [] },
      { id: 'c3', courseName: 'Islamic Culture', courseCode: '0104100', colorHex: '#10b981', aliases: [], scheduleSlots: [], syllabus: [] }
    ]);

    document.body.innerHTML = `
      <div class="stream-wrap" style="overflow-y: auto;">
        <ul class="activity-stream">
          <li class="stream-item-container">
            <a href="/ultra/courses/_101_1/outline" analytics-id="stream.entry.course">Physics 1- 02 - الفيزياء-1</a>
            <a class="js-title-link">Quiz 1 Reminder</a>
          </li>
          <li class="stream-item-container">
            <a href="/ultra/courses/_999_1/outline" analytics-id="stream.entry.course">Student Hands-On Orientation</a>
            <a class="js-title-link">Welcome to Blackboard</a>
          </li>
          <li class="stream-item-container">
            <a class="js-title-link">Campus-wide Wi-Fi Maintenance</a>
          </li>
        </ul>
        <button class="load-more-items" type="button">Load more</button>
      </div>
    `;

    const loadMoreBtn = document.querySelector<HTMLButtonElement>('button.load-more-items')!;
    let clicks = 0;
    loadMoreBtn.addEventListener('click', () => {
      clicks++;
      const stream = document.querySelector('.activity-stream')!;
      const li = document.createElement('li');
      li.className = 'stream-item-container';
      li.innerHTML = `<a href="/ultra/courses/_102_1/outline">Calculus I for Engineering</a><a class="js-title-link">Homework ${clicks}</a>`;
      stream.appendChild(li);
      if (clicks >= 3) loadMoreBtn.disabled = true;
    });

    startActivityFilter(async () => ({ results: [] }));

    // Wait for initial render and preloader mount
    await new Promise(r => setTimeout(r, 60));

    const bar = document.getElementById('bbs-activity-filter');
    expect(bar).toBeTruthy();

    const courseRow = bar!.querySelector('[aria-label="Course"]')!;
    const chipLabels = Array.from(courseRow.querySelectorAll('button.bbs-af-chip')).map(b => b.textContent?.trim());

    // All 3 configured courses show immediately even before their items are scrolled into view,
    // and neither Student Hands-On Orientation nor University appears as a course chip
    expect(chipLabels).toEqual(['All', 'Calculus I for Engineering', 'Islamic Culture', 'Physics 1']);
    expect(chipLabels).not.toContain('Student Hands-On Orientation');
    expect(chipLabels).not.toContain('University');

    // Preloader mounts while background batches load, clicks load-more-items, and removes itself once done
    await vi.waitFor(() => {
      expect(clicks).toBeGreaterThanOrEqual(3);
      expect(document.getElementById(PRELOADER_ID)).toBeNull();
    }, { timeout: 2500 });
  });

  it('shows our single preloader even before .activity-stream mounts (covering Blackboard\'s initial loader)', async () => {
    document.body.innerHTML = `<div class="loading-spinner">Blackboard loading...</div>`;
    startActivityFilter(async () => ({ results: [] }));

    await vi.waitFor(() => {
      const preloader = document.getElementById(PRELOADER_ID);
      expect(preloader).toBeTruthy();
      expect(preloader?.textContent).toContain('Connecting to Blackboard stream...');
    }, { timeout: 1000 });

    // Clicking Skip dismisses the unified preloader immediately
    document.getElementById('bbs-af-preloader-skip-btn')?.click();
    expect(document.getElementById(PRELOADER_ID)).toBeNull();
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
    expect(fs.readFileSync('src/content/blackboard-dark.js', 'utf8')).toContain('ensureEarlyActivityPreloader');
    const css = fs.readFileSync('src/content/content.css', 'utf8').replace(/\r\n/g, '\n');
    expect(css).toContain('html body li.bbs-af-hidden {\n  display: none !important;\n}');
    expect(css).toMatch(/html\.bbs-dark-active #bbs-activity-filter \.bbs-af-chip\[aria-pressed="true"\]/);
    expect(css).toContain('#bbs-activity-preloader');
  });
});
