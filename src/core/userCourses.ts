import type { UserCourseConfig, CustomSyllabusComponent, Weekday } from '../types';
import type { CourseScheduleEntry } from './courseSchedule';
import type { CourseSyllabus, SyllabusComponent } from './syllabusWeights';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Turns a user/cloud supplied alias or keyword into a regex fragment. Strings that look like
 * patterns are used as-is only when they compile and cannot obviously backtrack catastrophically;
 * anything else is matched literally so one bad entry can never throw or hang every lookup.
 */
function toPatternPart(raw: string): string {
  const trimmed = raw.trim();
  // Pattern syntax: ".*", "\s", "\b", "\d", "\w", "(?!", "(?:", "[", "^" or "$" ("calc\b", "eap\b")
  if (/(?:\.\*|\\[sbdwSDW]|\(\?[!:=]|\[|\^|\$)/.test(trimmed)) {
    const nestedQuantifier = /\([^)]*[+*][^)]*\)[+*{]/.test(trimmed);
    if (trimmed.length <= 120 && !nestedQuantifier) {
      try {
        new RegExp(trimmed, 'i');
        return trimmed;
      } catch {
        // fall through to literal matching
      }
    }
  }
  return escapeRegex(trimmed);
}

/**
 * Builds the regex that finds a course in text. `siblings` are the student's other courses: when one
 * of their names starts with this course's name ("Physics 1 Lab" after "Physics 1"), the name only
 * matches when that longer name does not follow, so the lab's text never lands on the lecture course.
 */
export function compileCoursePattern(course: UserCourseConfig, siblings: UserCourseConfig[] = []): RegExp {
  const parts: string[] = [];

  if (course.courseCode) {
    const rawCode = course.courseCode.trim();
    parts.push(escapeRegex(rawCode));
    const noSpaces = rawCode.replace(/\s+/g, '');
    if (noSpaces !== rawCode) {
      parts.push(escapeRegex(noSpaces));
    }
  }

  if (course.courseName) {
    const name = course.courseName.trim();
    const lower = name.toLowerCase();
    const longerSuffixes = (name && Array.isArray(siblings) ? siblings : [])
      .filter(o => o && o !== course && typeof o.courseName === 'string')
      .map(o => o.courseName.trim())
      .filter(n => n.length > name.length && n.toLowerCase().startsWith(lower))
      .map(n => n.slice(name.length).trim())
      .filter(Boolean)
      .map(sfx => escapeRegex(sfx).replace(/\s+/g, '\\s*'));
    parts.push(longerSuffixes.length
      ? `${escapeRegex(name)}(?!\\s*(?:${longerSuffixes.join('|')}))`
      : escapeRegex(name));
  }

  if (Array.isArray(course.aliases)) {
    for (const a of course.aliases) {
      if (typeof a !== 'string' || !a.trim()) continue;
      parts.push(toPatternPart(a));
    }
  }

  if (parts.length === 0) {
    return new RegExp(escapeRegex(course.id || 'general'), 'i');
  }

  return new RegExp(`(?:${parts.join('|')})`, 'i');
}

// Lab words in English and Arabic (no \b: it does not see Arabic letters)
const LAB_WORD = /(?:^|[^a-z])lab(?:s|oratory)?(?:[^a-z]|$)|مختبر|عملي/i;

/**
 * Picks the course a text belongs to from items whose pattern matches it. When several match, a
 * course whose name says lab wins text that mentions a lab, and a course whose name does not
 * wins text that does not; otherwise the first match in the student's order wins.
 */
export function pickCourseMatch<T>(
  items: T[],
  text: string,
  patternOf: (item: T) => RegExp | undefined | null,
  nameOf: (item: T) => string
): T | null {
  if (!text || !Array.isArray(items)) return null;
  const matches = items.filter(item => {
    const pattern = patternOf(item);
    return pattern ? pattern.test(text) : false;
  });
  if (matches.length <= 1) return matches[0] || null;
  const mentionsLab = LAB_WORD.test(text);
  const preferred = matches.find(m => LAB_WORD.test(nameOf(m) || '') === mentionsLab);
  return preferred || matches[0];
}

/** Course choices for the paste-an-announcement hint: each of the student's courses, with its first room. */
export function activeCourseHintOptions(): Array<{ value: string; label: string }> {
  const seen = new Set<string>();
  const options: Array<{ value: string; label: string }> = [];
  for (const c of getActiveUserCourses()) {
    const name = (c?.courseName || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const room = (Array.isArray(c.scheduleSlots) ? c.scheduleSlots : []).map(s => (s?.room || '').trim()).find(Boolean);
    options.push({ value: name, label: room ? `${name} (${room})` : name });
  }
  return options;
}

/** The student's course that a text names, or null. */
export function findActiveCourseInText(text: string): UserCourseConfig | null {
  const courses = getActiveUserCourses();
  if (!activePatternCache) activePatternCache = courses.map(c => compileCoursePattern(c, courses));
  const patterns = activePatternCache;
  return pickCourseMatch(courses, text, c => patterns[courses.indexOf(c)], c => c.courseName);
}

export function compileSyllabusComponentMatcher(comp: CustomSyllabusComponent): RegExp {
  const parts: string[] = [];

  if (Array.isArray(comp.keywords) && comp.keywords.length > 0) {
    for (const kw of comp.keywords) {
      if (typeof kw !== 'string' || !kw.trim()) continue;
      parts.push(toPatternPart(kw));
    }
  }

  if (comp.name && parts.length === 0) {
    parts.push(escapeRegex(comp.name.trim()));
  }

  if (parts.length === 0) {
    return new RegExp(escapeRegex(comp.id || 'item'), 'i');
  }

  return new RegExp(`(?:${parts.join('|')})`, 'i');
}

export const DAY_INDEX_MAP: Record<Weekday, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6
};

function format12Hour(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const padH = String(h12).padStart(2, '0');
  const padM = String(minute).padStart(2, '0');
  return `${padH}:${padM} ${period}`;
}

export function userCoursesToScheduleEntries(courses: UserCourseConfig[]): CourseScheduleEntry[] {
  const entries: CourseScheduleEntry[] = [];

  for (const course of courses) {
    const matcher = compileCoursePattern(course, courses);
    for (const slot of course.scheduleSlots) {
      const [startH, startM] = (slot.startTime || '00:00').split(':').map(n => parseInt(n, 10) || 0);
      const [endH, endM] = (slot.endTime || '00:00').split(':').map(n => parseInt(n, 10) || 0);

      // Unknown day names are dropped; they used to silently become Sunday
      const dayIndices = (slot.days || [])
        .map(d => DAY_INDEX_MAP[d])
        .filter((n): n is number => typeof n === 'number');
      const timeRangeDisplay = `${format12Hour(startH, startM)} - ${format12Hour(endH, endM)}`;

      entries.push({
        courseId: course.id,
        courseName: course.courseName,
        courseCode: course.courseCode,
        crn: course.crn || '',
        days: slot.days || [],
        dayIndices,
        startHour: startH,
        startMinute: startM,
        endHour: endH,
        endMinute: endM,
        timeRangeDisplay,
        location: slot.location || slot.room,
        room: slot.room,
        instructor: slot.instructor || '',
        matcher
      });
    }
  }

  return entries;
}

export function userCoursesToSyllabi(courses: UserCourseConfig[]): CourseSyllabus[] {
  return courses.map(course => {
    const courseCodePattern = compileCoursePattern(course, courses);
    const components: SyllabusComponent[] = (course.syllabus || []).map(comp => ({
      id: comp.id,
      name: comp.name,
      type: comp.type,
      totalWeight: comp.totalWeight,
      count: comp.count,
      outOf: comp.outOf,
      unitWeight: comp.unitWeight !== undefined ? comp.unitWeight : (comp.count && comp.count > 0 ? Number((comp.totalWeight / comp.count).toFixed(2)) : comp.totalWeight),
      note: comp.note,
      matcher: compileSyllabusComponentMatcher(comp)
    }));

    const totalWeight = components.reduce((acc, c) => acc + (c.totalWeight || 0), 0) || 100;

    return {
      courseId: course.id,
      courseName: course.courseName,
      courseCodePattern,
      sourcePdf: `${course.id}.pdf`,
      totalWeight,
      // Courses saved without credit hours count as the usual 3
      creditHours: Number(course.creditHours) > 0 ? Number(course.creditHours) : 3,
      components
    };
  });
}

export function userCoursesToLegend(courses: UserCourseConfig[]): Array<{
  name: string;
  code: string;
  pattern: RegExp;
  hex: string;
}> {
  return courses.map(course => ({
    name: course.courseName,
    code: course.courseCode,
    pattern: compileCoursePattern(course, courses),
    hex: course.colorHex
  }));
}

// In-Memory Active State
let activeUserCourses: UserCourseConfig[] = [];
let activeScheduleCache: CourseScheduleEntry[] | null = null;
let activeSyllabiCache: CourseSyllabus[] | null = null;
let activeLegendCache: Array<{ name: string; code: string; pattern: RegExp; hex: string }> | null = null;
let activePatternCache: RegExp[] | null = null;

function clearCaches(): void {
  activeScheduleCache = null;
  activeSyllabiCache = null;
  activeLegendCache = null;
  activePatternCache = null;
}

export function getActiveUserCourses(): UserCourseConfig[] {
  return activeUserCourses;
}

export function setActiveUserCourses(courses: UserCourseConfig[]): void {
  if (Array.isArray(courses)) {
    activeUserCourses = courses;
  } else {
    activeUserCourses = [];
  }
  clearCaches();
}

export function resetActiveUserCourses(): void {
  activeUserCourses = [];
  clearCaches();
}

export function getActiveScheduleEntries(): CourseScheduleEntry[] {
  if (!activeScheduleCache) {
    activeScheduleCache = userCoursesToScheduleEntries(activeUserCourses);
  }
  return activeScheduleCache;
}

export function getActiveSyllabi(): CourseSyllabus[] {
  if (!activeSyllabiCache) {
    activeSyllabiCache = userCoursesToSyllabi(activeUserCourses);
  }
  return activeSyllabiCache;
}

export function getActiveCourseLegend(): Array<{
  name: string;
  code: string;
  pattern: RegExp;
  hex: string;
}> {
  if (!activeLegendCache) {
    activeLegendCache = userCoursesToLegend(activeUserCourses);
  }
  return activeLegendCache;
}
