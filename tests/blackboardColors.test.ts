import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import {
  BLACKBOARD_COURSE_PALETTE,
  blackboardColorSlot,
  blackboardCourseHex,
  colorSlotFromClass,
  courseIdFromHref,
  parseMemberships,
  slotColorMap,
  isVividColor
} from '../src/core/blackboardColors';
import { findConfiguredCourseHex } from '../src/core/courseColors';
import { setActiveUserCourses } from '../src/core/userCourses';
import { courseChromeCss } from '../src/content/courseColorPainter';

// Made-up memberships in the shape /learn/api/v1/users/me/memberships?expand=course returns
const membershipsJson = {
  results: [
    { courseId: '_10001_1', courseCardColorIndex: 29, course: { courseId: '1440133_10806_FALL2026-2027', name: 'Calculus I for Engineering- 02 - حسبان 1 للمهندسين' } },
    { courseId: '_10002_1', courseCardColorIndex: 124, course: { courseId: '1430115_All_Fall2026-2027', name: 'Physics 1- ALL - الفيزياء-1' } },
    { courseId: '_10003_1', courseCardColorIndex: 42, course: { courseId: '1430115_10668_FALL2026-2027', name: 'Physics 1- 02 - الفيزياء-1' } },
    { courseId: '_10004_1', courseCardColorIndex: 2326, course: { courseId: 'Mock_Exam_Fall2026-2027', name: 'Student Hands-On Orientation' } },
    { courseId: 'not-an-id', courseCardColorIndex: 3, course: { name: 'Broken' } }
  ]
};

const course = (id: string, courseCode: string, courseName: string, colorHex: string, aliases: string[] = []) =>
  ({ id, courseCode, courseName, colorHex, aliases, scheduleSlots: [], syllabus: [] });

describe("Blackboard's course colours", () => {
  it('turns a membership colour index into the course-color-N class Ultra draws (index % 10 + 1)', () => {
    expect(blackboardColorSlot(29)).toBe(10);
    expect(blackboardColorSlot(124)).toBe(5);
    expect(blackboardColorSlot(1)).toBe(2);
    expect(blackboardColorSlot(0)).toBe(1);
    expect(blackboardColorSlot(-1)).toBeNull();
    expect(blackboardColorSlot('x')).toBeNull();
    expect(blackboardCourseHex(29)).toBe('#157afb');
    expect(BLACKBOARD_COURSE_PALETTE).toHaveLength(10);
  });

  it('reads the slot from a class list and the course id from links', () => {
    expect(colorSlotFromClass('element-details course-color-10')).toBe(10);
    expect(colorSlotFromClass('course-color-0')).toBeNull();
    expect(colorSlotFromClass('my-course-color-3x')).toBeNull();
    expect(courseIdFromHref('https://elearning.example/ultra/courses/_86929_1/outline')).toBe('_86929_1');
    expect(courseIdFromHref('/ultra/stream/announcement-detail?courseId=_86929_1&announcementId=_5_1')).toBe('_86929_1');
    expect(courseIdFromHref('/webapps/x?course_id=_7_1')).toBe('_7_1');
    expect(courseIdFromHref('/ultra/stream')).toBeNull();
  });

  it('parses memberships with code, slot and colour, and skips bad ids', () => {
    const list = parseMemberships(membershipsJson);
    expect(list.map(m => m.courseId)).toEqual(['_10001_1', '_10002_1', '_10003_1', '_10004_1']);
    expect(list[0]).toMatchObject({ code: '1440133', slot: 10, hex: '#157afb' });
    expect(list[3].code).toBe('');
    expect(parseMemberships(null)).toEqual([]);
  });

  it('a colour slot is only painted when every course using it agrees', () => {
    const list = parseMemberships(membershipsJson);
    const map = slotColorMap(list, m => (m.code === '1430115' ? '#4b99d2' : m.code === '1440133' ? '#dc2626' : null));
    expect(map.get(10)).toBe('#dc2626');
    expect(map.get(5)).toBe('#4b99d2');
    expect(map.get(3)).toBe('#4b99d2');
    expect(map.has(7)).toBe(false); // the orientation shell is not a set-up course

    const clash = slotColorMap(
      [
        { courseId: '_1_1', name: 'A', code: '1111111', slot: 4, hex: null },
        { courseId: '_2_1', name: 'B', code: '2222222', slot: 4, hex: null }
      ],
      m => (m.code === '1111111' ? '#111111' : '#222222')
    );
    expect(clash.has(4)).toBe(false);
  });

  it('only clearly coloured values count as course colour', () => {
    expect(isVividColor('rgb(21, 122, 251)')).toBe(true);
    expect(isVividColor('rgb(102, 102, 102)')).toBe(false);
    expect(isVividColor('rgba(21, 122, 251, 0.2)')).toBe(false);
    expect(isVividColor('transparent')).toBe(false);
  });
});

describe("The student's own course colour wins on Blackboard", () => {
  beforeEach(() => {
    setActiveUserCourses([
      course('phy1', '1430115', 'Physics 1', '#4b99d2', ['physics\\s*1(?!\\s*lab)']),
      course('phy1lab', '1430116', 'Physics 1 Lab', '#123456', ['physics.*lab', 'الفيزياء']),
      course('calc1', '1440133', 'Calculus I for Engineering', '#dc2626', ['calculus'])
    ] as any);
  });

  it('matches the 7-digit code before the name, and has no made-up fallback', () => {
    // The lab's alias also matches the Physics 1 Arabic name; the code decides
    expect(findConfiguredCourseHex('Physics 1- 02 - الفيزياء-1', '1430115')).toBe('#4b99d2');
    expect(findConfiguredCourseHex('Calculus I for Engineering- 02', '')).toBe('#dc2626');
    expect(findConfiguredCourseHex('Student Hands-On Orientation', '')).toBeNull();
  });

  it('inside a course, the banner tint and the selected tab take the course colour', () => {
    const css = courseChromeCss('#dc2626');
    expect(css).toContain('[class*="emptyCourseBanner"] { background-color: #dc2626b3 !important; }');
    expect(css).toContain('a[aria-current="page"][class] { border-bottom-color: #dc2626 !important; }');
    expect(courseChromeCss('red; } body { display: none')).toBe('');
    expect(courseChromeCss(null)).toBe('');
  });
});

describe('New courses take the colour Blackboard gives them', () => {
  it('autoRegisterDiscoveredCourses uses the colour read from Blackboard', async () => {
    const { autoRegisterDiscoveredCourses } = await import('../src/utils/storage');
    const result = await autoRegisterDiscoveredCourses([
      { courseName: 'Digital Logic Design', courseCode: '1502240', colorHex: '#FF6417' }
    ]);
    expect(result.find(c => c.courseCode === '1502240')?.colorHex).toBe('#ff6417');
  });
});

describe('Content script wiring', () => {
  it('the scan registers courses with Blackboard colours and the painter starts on Blackboard pages', () => {
    const scraper = fs.readFileSync('src/content/scraper.ts', 'utf8');
    expect(scraper).toContain('autoRegisterDiscoveredCourses(await discoveredCoursesWithColors(getBlackboardJson))');
    expect(scraper).toContain('startCourseColorPainter(getBlackboardJson)');
    const css = fs.readFileSync('src/content/content.css', 'utf8');
    expect(css).toContain('[data-bbs-cc-before~="bg"]::before { background-color: var(--bbs-cc) !important; }');
  });
});

describe('Dark mode no longer turns on Blackboard\'s own dark mode', () => {
  const js = fs.readFileSync('src/content/blackboard-dark.js', 'utf8');
  it('never adds mode-dark (it paints pages #666) and scopes rewritten rules to the theme class', () => {
    expect(js).not.toMatch(/classList\.add\([^)]*BB_DARK_CLASS/);
    expect(js).not.toContain('html.bbs-dark-active.mode-dark');
    expect(js).toContain('return `html.bbs-dark-active ${s}`;');
  });

  it('has clear selected states and readable grade pills', () => {
    const css = fs.readFileSync('src/content/blackboard-dark.css', 'utf8');
    for (const sel of ['a.base-navigation-button-content.active', 'button.active-switch', '.fc-today.date-selected', '.customGradePill', '.base-grades-empty-element', '.stream-item-container .stream-item::before', '.stream-item-container .element-image']) {
      expect(css).toContain(`html.bbs-dark-active ${sel}`);
    }
  });
});
