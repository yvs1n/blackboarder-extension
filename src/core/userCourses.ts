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
  if (/(?:\.\*|\\s\*|\(\?!|\[|\^|\$)/.test(trimmed)) {
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

export function compileCoursePattern(course: UserCourseConfig): RegExp {
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
    if (course.id === 'phy1' || name.toLowerCase() === 'physics 1') {
      parts.push(`${escapeRegex(name)}(?!\\s*lab)`);
    } else {
      parts.push(escapeRegex(name));
    }
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

export const DEFAULT_USER_COURSES: UserCourseConfig[] = [
  // 1. Introduction to Computer Eng.
  {
    id: 'compeng',
    courseCode: '1502101',
    courseName: 'Introduction to Computer Eng.',
    crn: '12056',
    creditHours: 3,
    colorHex: '#7c7c7c',
    aliases: [
      'intro.*comp',
      'comp(?:uter)?\\s*eng',
      'هندسة.*حاسوب',
      'حاسوب',
      '1502 101 01',
      '1502 101',
      '1502101',
      '0402101',
      '0402102'
    ],
    scheduleSlots: [
      {
        days: ['Tuesday', 'Thursday'],
        startTime: '11:00',
        endTime: '12:15',
        room: 'A8-103',
        location: "Room A8-103",
        instructor: 'Course Faculty'
      }
    ],
    syllabus: [
      {
        id: 'compeng_final',
        name: 'Final Exam',
        type: 'exam',
        totalWeight: 45,
        unitWeight: 45,
        note: 'TBA (45%)',
        keywords: ['final\\s*exam', 'final', 'امتحان\\s*نهائي', 'نهائي']
      },
      {
        id: 'compeng_midterm',
        name: 'Midterm Exam',
        type: 'exam',
        totalWeight: 30,
        unitWeight: 30,
        note: 'TBA (30%)',
        keywords: ['midterm\\s*exam', 'midterm', 'امتحان\\s*نصفي', 'نصفي', 'منتصف']
      },
      {
        id: 'compeng_quizzes',
        name: 'Quizzes',
        type: 'quiz',
        totalWeight: 25,
        count: 3,
        outOf: 4,
        unitWeight: 8.33,
        note: 'Best 3 of 4 quizzes (average taken, ~8.33% each, 25% total, no HWs)',
        keywords: ['quiz', 'كويز', 'امتحان\\s*قصير']
      }
    ]
  },

  // 2. Calculus I for Engineering
  {
    id: 'calc1',
    courseCode: '1440133',
    courseName: 'Calculus I for Engineering',
    crn: '10806',
    creditHours: 3,
    colorHex: '#dc2626',
    aliases: [
      'calculus',
      'calc\\b',
      'حسبان',
      '1440 133 02',
      '1440 133',
      '1440133',
      '1440131',
      '0401101',
      '0401201'
    ],
    scheduleSlots: [
      {
        days: ['Tuesday', 'Thursday'],
        startTime: '12:30',
        endTime: '13:45',
        room: 'A12-110',
        location: "Room A12-110",
        instructor: 'Course Faculty'
      }
    ],
    syllabus: [
      {
        id: 'calc1_final',
        name: 'Final Exam',
        type: 'exam',
        totalWeight: 40,
        unitWeight: 40,
        note: 'On paper (40%)',
        keywords: ['final\\s*exam', 'final', 'امتحان\\s*نهائي', 'نهائي']
      },
      {
        id: 'calc1_midterm',
        name: 'Midterm Exam',
        type: 'exam',
        totalWeight: 30,
        unitWeight: 30,
        note: 'On paper (30%)',
        keywords: ['midterm\\s*exam', 'midterm', 'امتحان\\s*نصفي', 'نصفي', 'منتصف']
      },
      {
        id: 'calc1_quizzes',
        name: 'Quizzes',
        type: 'quiz',
        totalWeight: 20,
        count: 2,
        outOf: 3,
        unitWeight: 10,
        note: 'On paper, best 2 of 3 quizzes (10% each, 20% total)',
        keywords: ['quiz', 'كويز', 'امتحان\\s*قصير']
      },
      {
        id: 'calc1_assignments',
        name: 'Homeworks',
        type: 'assignment',
        totalWeight: 10,
        count: 3,
        outOf: 4,
        unitWeight: 3.33,
        note: 'Online, best 3 of 4 homeworks (~3.33% each, 10% total)',
        keywords: ['assignment', 'hw', 'homework', 'واجب', 'connect']
      }
    ]
  },

  // 3. English for Academic Purposes
  {
    id: 'eap',
    courseCode: '0202112',
    courseName: 'English for Academic Purposes',
    crn: '10175',
    creditHours: 3,
    colorHex: '#525252',
    aliases: [
      'english',
      'eap\\b',
      'academic\\s*purposes',
      'academic\\s*english',
      'إنجليزي',
      'انجليزي',
      '0202 112 09',
      '0202 112',
      '0202112',
      '0202111'
    ],
    scheduleSlots: [
      {
        days: ['Tuesday', 'Thursday'],
        startTime: '14:00',
        endTime: '15:15',
        room: 'A3-184',
        location: "Room A3-184",
        instructor: 'Course Faculty'
      }
    ],
    syllabus: [
      {
        id: 'eap_final',
        name: 'Final Exam',
        type: 'exam',
        totalWeight: 40,
        unitWeight: 40,
        note: 'Week 16 (40%)',
        keywords: ['final\\s*exam', 'final', 'نهائي']
      },
      {
        id: 'eap_midterm',
        name: 'Midterm Exam',
        type: 'exam',
        totalWeight: 20,
        unitWeight: 20,
        note: 'Week 8 (20%)',
        keywords: ['midterm\\s*exam', 'midterm', 'نصفي', 'منتصف']
      },
      {
        id: 'eap_quizzes',
        name: 'Quizzes',
        type: 'quiz',
        totalWeight: 20,
        count: 2,
        unitWeight: 10,
        note: '2 Quizzes: Quiz 1 in Wk 4, Quiz 2 in Wk 7 (10% each, 20% total)',
        keywords: ['quiz', 'كويز']
      },
      {
        id: 'eap_essay',
        name: 'Cause-Effect Essay',
        type: 'assignment',
        totalWeight: 10,
        unitWeight: 10,
        note: 'Week 12 Writing Assignment (10%)',
        keywords: ['essay', 'cause.*effect', 'writing\\s*assignment', 'مقال']
      },
      {
        id: 'eap_employability',
        name: 'Employability Skills',
        type: 'assignment',
        totalWeight: 10,
        count: 5,
        unitWeight: 2,
        note: '5 Employability Tasks across Weeks 2-13 (2% each, 10% total)',
        keywords: ['employability', 'skill', 'task', 'مهام', 'مهارات']
      }
    ]
  },

  // 4. Physics 1 Lab (Ordered before Physics 1 to guarantee priority matching)
  {
    id: 'phy1lab',
    courseCode: '1430116',
    courseName: 'Physics 1 Lab',
    crn: '10708',
    creditHours: 1,
    colorHex: '#4b99d2',
    aliases: [
      'physics.*lab',
      'phy(?:sics)?\\s*1\\s*lab',
      'مختبر.*فيزياء',
      'فيزياء.*عملي',
      '1430 116 11L',
      '1430 116',
      '1430116',
      '1430117',
      '0401116',
      'measuring\\s*density',
      'free\\s*fall',
      "student'?s\\s*lab"
    ],
    scheduleSlots: [
      {
        days: ['Wednesday'],
        startTime: '14:00',
        endTime: '16:45',
        room: 'Central Lab Men - 105',
        location: "Central Lab 105",
        instructor: 'Course Faculty'
      }
    ],
    syllabus: [
      {
        id: 'phy1lab_final',
        name: 'Final Examination',
        type: 'exam',
        totalWeight: 40,
        unitWeight: 40,
        note: 'Practical Final Exam during last week (40%)',
        keywords: ['final\\s*exam', 'final', 'امتحان\\s*نهائي', 'نهائي', 'عملي']
      },
      {
        id: 'phy1lab_quizzes',
        name: 'Lab Quizzes',
        type: 'quiz',
        totalWeight: 30,
        count: 3,
        outOf: 4,
        unitWeight: 10,
        note: '4 scheduled, top 3 counted (10% each, 30% total)',
        keywords: ['quiz', 'كويز']
      },
      {
        id: 'phy1lab_reports',
        name: 'Experiments & Lab Reports',
        type: 'lab',
        totalWeight: 30,
        count: 9,
        unitWeight: 3.33,
        note: '9 Weekly lab reports (approx 3.33% each, 30% total)',
        keywords: ['report', 'experiment', 'تقرير', 'تجربة', 'مختبر']
      }
    ]
  },

  // 5. Physics 1
  {
    id: 'phy1',
    courseCode: '1430115',
    courseName: 'Physics 1',
    crn: '10668',
    creditHours: 3,
    colorHex: '#4b99d2',
    aliases: [
      'physics\\s*1(?!\\s*lab)',
      'general\\s*physics\\s*1',
      'فيزياء\\s*1(?!\\s*عملي)',
      'فيزياء\\s*عامة\\s*1',
      '1430 115 02',
      '1430 115',
      '1430115',
      '1430111',
      '0401115'
    ],
    scheduleSlots: [
      {
        days: ['Monday', 'Wednesday'],
        startTime: '11:00',
        endTime: '12:15',
        room: 'A8-110',
        location: "Room A8-110",
        instructor: 'Course Faculty'
      }
    ],
    syllabus: [
      {
        id: 'phy1_final',
        name: 'Final Exam',
        type: 'exam',
        totalWeight: 45,
        unitWeight: 45,
        note: 'Final Examination (45 marks)',
        keywords: ['final\\s*exam', 'final', 'امتحان\\s*نهائي', 'نهائي']
      },
      {
        id: 'phy1_midterm',
        name: 'Midterm Exam',
        type: 'exam',
        totalWeight: 25,
        unitWeight: 25,
        note: 'Midterm Exam (25 marks)',
        keywords: ['midterm\\s*exam', 'midterm', 'امتحان\\s*نصفي', 'نصفي', 'منتصف']
      },
      {
        id: 'phy1_quizzes',
        name: 'Quizzes',
        type: 'quiz',
        totalWeight: 20,
        unitWeight: 20,
        note: 'Quizzes throughout semester (average = 20 marks)',
        keywords: ['quiz', 'كويز', 'امتحان\\s*قصير']
      },
      {
        id: 'phy1_assignments',
        name: 'Assignments',
        type: 'assignment',
        totalWeight: 10,
        unitWeight: 10,
        note: 'Assignments / Homework (10 marks total)',
        keywords: ['assignment', 'hw', 'homework', 'واجب']
      }
    ]
  },

  // 6. Islamic Culture
  {
    id: 'islamic',
    courseCode: '0104100',
    courseName: 'Islamic Culture',
    crn: '10475',
    creditHours: 3,
    colorHex: '#489160',
    aliases: [
      'islamic',
      'ثقافة\\s*إسلامية',
      'ثقافة\\s*اسلامية',
      'إسلام',
      'اسلام',
      '0104 100 13A',
      '0104 100',
      '0104100',
      '0104101'
    ],
    scheduleSlots: [
      {
        days: ['Monday', 'Wednesday'],
        startTime: '17:00',
        endTime: '18:15',
        room: 'A8-TH005',
        location: "Room A8-TH005",
        instructor: 'Course Faculty'
      }
    ],
    syllabus: [
      {
        id: 'islamic_final',
        name: 'Final Exam',
        type: 'exam',
        totalWeight: 50,
        unitWeight: 50,
        note: 'Comprehensive final exam (50%)',
        keywords: ['final\\s*exam', 'final', 'امتحان\\s*نهائي', 'نهائي']
      },
      {
        id: 'islamic_midterm',
        name: 'Midterm Exam',
        type: 'exam',
        totalWeight: 25,
        unitWeight: 25,
        note: 'Midterm exam (25%)',
        keywords: ['midterm\\s*exam', 'midterm', 'امتحان\\s*نصفي', 'نصفي', 'منتصف']
      },
      {
        id: 'islamic_coursework',
        name: 'Coursework & Research',
        type: 'project',
        totalWeight: 25,
        unitWeight: 15,
        note: 'واجبات، تقارير، مشروعات، امتحانات قصيرة (25% total)',
        keywords: ['بحث', 'مشروع', 'تقرير', 'واجب', 'عرض', 'project', 'research', 'assignment', 'report', 'quiz', 'كويز']
      }
    ]
  }
];

export function userCoursesToScheduleEntries(courses: UserCourseConfig[]): CourseScheduleEntry[] {
  const entries: CourseScheduleEntry[] = [];

  for (const course of courses) {
    const matcher = compileCoursePattern(course);
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
    const courseCodePattern = compileCoursePattern(course);
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
      // Courses saved before credit hours existed take the default course's value
      creditHours: Number(course.creditHours) > 0 ? Number(course.creditHours) : DEFAULT_USER_COURSES.find(d => d.id === course.id)?.creditHours,
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
    pattern: compileCoursePattern(course),
    hex: course.colorHex
  }));
}

// In-Memory Active State
let activeUserCourses: UserCourseConfig[] = [];
let activeScheduleCache: CourseScheduleEntry[] | null = null;
let activeSyllabiCache: CourseSyllabus[] | null = null;
let activeLegendCache: Array<{ name: string; code: string; pattern: RegExp; hex: string }> | null = null;

function clearCaches(): void {
  activeScheduleCache = null;
  activeSyllabiCache = null;
  activeLegendCache = null;
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
