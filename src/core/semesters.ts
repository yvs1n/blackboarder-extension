import type {
  ArchivedCourseRecord,
  ArchivedSemester,
  AcademicBaseline,
  CumulativeGpaSummary,
  DeadlineTask,
  UserCourseConfig
} from '../types';
import { GradeRow } from './universities';
import { buildGpaSummary, GpaSummary, DEFAULT_CREDIT_HOURS } from '../utils/gpa';
import { userCoursesToSyllabi } from './userCourses';

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Cleans and normalizes an array of archived semesters from storage or cloud sync. */
export function sanitizeSemesters(raw: unknown): ArchivedSemester[] {
  if (!Array.isArray(raw)) return [];
  const out: ArchivedSemester[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : '';
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : '';
    if (!id || !name) continue;
    const archivedAt = typeof r.archivedAt === 'string' && !isNaN(Date.parse(r.archivedAt))
      ? r.archivedAt
      : new Date(0).toISOString();
    const academicYear = typeof r.academicYear === 'string' ? r.academicYear.trim() : undefined;
    const termGpa = typeof r.termGpa === 'number' && !isNaN(r.termGpa) ? round2(r.termGpa) : undefined;
    const gradedCredits = typeof r.gradedCredits === 'number' && !isNaN(r.gradedCredits) ? Math.max(0, r.gradedCredits) : 0;
    const totalCredits = typeof r.totalCredits === 'number' && !isNaN(r.totalCredits) ? Math.max(0, r.totalCredits) : 0;

    const rawCourses = Array.isArray(r.courses) ? r.courses : [];
    const courses: ArchivedCourseRecord[] = [];
    for (const c of rawCourses) {
      if (!c || typeof c !== 'object') continue;
      const cr = c as Record<string, unknown>;
      const code = typeof cr.code === 'string' ? cr.code.trim() : '';
      const cName = typeof cr.name === 'string' ? cr.name.trim() : '';
      if (!code && !cName) continue;
      const creditHours = typeof cr.creditHours === 'number' && cr.creditHours > 0 ? cr.creditHours : DEFAULT_CREDIT_HOURS;
      const grade = typeof cr.grade === 'string' ? cr.grade.trim() : undefined;
      const points = typeof cr.points === 'number' && !isNaN(cr.points) ? round2(cr.points) : undefined;
      const percent = typeof cr.percent === 'number' && !isNaN(cr.percent) ? round1(cr.percent) : undefined;
      const colorHex = typeof cr.colorHex === 'string' && /^#[0-9a-fA-F]{6}$/.test(cr.colorHex) ? cr.colorHex : undefined;
      courses.push({
        code,
        name: cName || code,
        creditHours,
        grade,
        points,
        percent,
        colorHex
      });
    }

    const sem: ArchivedSemester = {
      id,
      name,
      academicYear,
      archivedAt,
      termGpa,
      gradedCredits,
      totalCredits,
      courses
    };

    if (Array.isArray(r.fullCourses) && r.fullCourses.length > 0) {
      sem.fullCourses = r.fullCourses as UserCourseConfig[];
    }
    if (Array.isArray(r.fullTasks) && r.fullTasks.length > 0) {
      sem.fullTasks = r.fullTasks as DeadlineTask[];
    }

    out.push(sem);
  }

  // Sort newest first by archivedAt
  return out.sort((a, b) => (Date.parse(b.archivedAt) || 0) - (Date.parse(a.archivedAt) || 0));
}

/** Merges local and cloud archived semesters without data loss; newer archivedAt wins on id collision. */
export function mergeArchivedSemesters(
  local?: ArchivedSemester[] | null,
  cloud?: ArchivedSemester[] | null
): ArchivedSemester[] {
  const l = sanitizeSemesters(local);
  const c = sanitizeSemesters(cloud);
  if (!l.length) return c;
  if (!c.length) return l;

  const map = new Map<string, ArchivedSemester>();
  for (const s of c) {
    map.set(s.id, s);
  }
  for (const s of l) {
    const existing = map.get(s.id);
    if (!existing) {
      map.set(s.id, s);
    } else {
      const timeL = Date.parse(s.archivedAt) || 0;
      const timeE = Date.parse(existing.archivedAt) || 0;
      map.set(s.id, timeL >= timeE ? s : existing);
    }
  }

  return Array.from(map.values()).sort((a, b) => (Date.parse(b.archivedAt) || 0) - (Date.parse(a.archivedAt) || 0));
}

/**
 * Calculates true university Cumulative GPA (CGPA) combining:
 * 1. Prior Academic Baseline (credits + GPA from before using Blackboarder)
 * 2. All Archived Semesters transcripts
 * 3. Active Semester graded courses so far
 * Optional: replaceRetakes flag replaces older grades for the same course code.
 */
export function calculateCgpa(
  activeGpa: GpaSummary,
  archivedSemesters: ArchivedSemester[],
  baseline?: AcademicBaseline | null,
  options?: { replaceRetakes?: boolean }
): CumulativeGpaSummary {
  const replaceRetakes = options?.replaceRetakes ?? false;
  const seenCourseCodes = new Set<string>();

  let totalWeightedPoints = 0;
  let totalGradedCredits = 0;
  let totalCompletedCredits = 0;

  // 1. Active Term Graded Courses (most recent)
  const termGraded = (activeGpa.courses || []).filter(c => typeof c.points === 'number');
  for (const c of termGraded) {
    const credits = c.creditHours > 0 ? c.creditHours : DEFAULT_CREDIT_HOURS;
    totalWeightedPoints += c.points! * credits;
    totalGradedCredits += credits;
    if (c.points! > 0 || (c.letter && !/^(F|WF|U)$/i.test(c.letter))) {
      totalCompletedCredits += credits;
    }
  }

  // 2. Archived Semesters (sorted newest first)
  const validSemesters = sanitizeSemesters(archivedSemesters);
  for (const sem of validSemesters) {
    for (const c of sem.courses) {
      const codeKey = (c.code || '').trim().toUpperCase();
      if (replaceRetakes && codeKey && codeKey.length >= 3 && seenCourseCodes.has(codeKey)) {
        // Skip older attempt of retaken course
        continue;
      }
      if (codeKey && codeKey.length >= 3) {
        seenCourseCodes.add(codeKey);
      }
      const credits = c.creditHours > 0 ? c.creditHours : DEFAULT_CREDIT_HOURS;
      if (typeof c.points === 'number' && !isNaN(c.points)) {
        totalWeightedPoints += c.points * credits;
        totalGradedCredits += credits;
        if (c.points > 0 || (c.grade && !/^(F|WF|U)$/i.test(c.grade))) {
          totalCompletedCredits += credits;
        }
      }
    }
  }

  // 3. Prior Baseline
  const priorCredits = baseline?.priorCredits && baseline.priorCredits > 0 ? baseline.priorCredits : 0;
  const priorGpa = typeof baseline?.priorGpa === 'number' && !isNaN(baseline.priorGpa) ? baseline.priorGpa : undefined;
  if (priorCredits > 0 && priorGpa !== undefined) {
    totalWeightedPoints += priorCredits * priorGpa;
    totalGradedCredits += priorCredits;
    totalCompletedCredits += priorCredits;
  }

  const cgpa = totalGradedCredits > 0 ? round2(totalWeightedPoints / totalGradedCredits) : undefined;
  const targetCredits = baseline?.targetCredits && baseline.targetCredits > 0 ? baseline.targetCredits : undefined;
  const degreeProgressPercent = targetCredits
    ? Math.min(100, Math.round((totalCompletedCredits / targetCredits) * 100))
    : undefined;

  return {
    termGpa: activeGpa.gpa,
    termGradedCredits: activeGpa.gradedCredits,
    termTotalCredits: activeGpa.totalCredits,
    cgpa,
    totalGradedCredits: round1(totalGradedCredits),
    totalCompletedCredits: round1(totalCompletedCredits),
    targetCredits,
    degreeProgressPercent,
    archivedSemestersCount: validSemesters.length
  };
}

/**
 * Creates an ArchivedSemester snapshot from active courses, tasks, and grading scale.
 */
export function archiveActiveSemester(params: {
  name: string;
  courses: UserCourseConfig[];
  tasks: DeadlineTask[];
  scale: ReadonlyArray<GradeRow>;
  mode?: 'compact' | 'full';
  id?: string;
  academicYear?: string;
}): ArchivedSemester {
  const syllabi = userCoursesToSyllabi(params.courses || []);
  const gpa = buildGpaSummary(params.tasks || [], syllabi, params.scale);
  const courseGradeMap = new Map((gpa.courses || []).map(c => [c.courseName.toLowerCase(), c]));

  const archivedCourses: ArchivedCourseRecord[] = (params.courses || []).map(c => {
    const found = courseGradeMap.get((c.courseName || '').toLowerCase());
    return {
      code: c.courseCode || c.crn || '',
      name: c.courseName,
      creditHours: c.creditHours || DEFAULT_CREDIT_HOURS,
      grade: found?.letter,
      points: found?.points,
      percent: found?.percent,
      colorHex: c.colorHex
    };
  });

  const id = params.id || `sem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const archivedAt = new Date().toISOString();

  const semester: ArchivedSemester = {
    id,
    name: params.name.trim(),
    academicYear: params.academicYear,
    archivedAt,
    termGpa: gpa.gpa,
    gradedCredits: gpa.gradedCredits,
    totalCredits: gpa.totalCredits,
    courses: archivedCourses
  };

  if (params.mode === 'full') {
    semester.fullCourses = params.courses;
    semester.fullTasks = params.tasks;
  }

  return semester;
}

/**
 * Auto-detects an academic semester name (e.g. "Fall 2026" or "Spring 2027") from active course metadata
 * or the current wall-clock date.
 */
export function detectSemesterName(
  courses?: UserCourseConfig[],
  tasks?: DeadlineTask[],
  now = new Date()
): string {
  // Check course names or codes for explicit term patterns
  const allTexts: string[] = [];
  for (const c of courses || []) {
    if (c.courseName) allTexts.push(c.courseName);
    if (c.courseCode) allTexts.push(c.courseCode);
    if (c.crn) allTexts.push(c.crn);
  }
  for (const t of tasks || []) {
    if (t.courseName) allTexts.push(t.courseName);
    if (t.courseCode) allTexts.push(t.courseCode);
  }

  for (const text of allTexts) {
    // Standard Banner term code: 202610 = Fall 2026, 202620 = Spring 2026, 202630 = Summer
    const bannerMatch = text.match(/(?:^|[^0-9])(20\d{2})(10|20|30)(?![0-9])/);
    if (bannerMatch) {
      const year = bannerMatch[1];
      const termCode = bannerMatch[2];
      const term = termCode === '10' ? 'Fall' : termCode === '20' ? 'Spring' : 'Summer';
      return `${term} ${year}`;
    }

    // Explicit seasonal names: "Fall 2026", "Spring 2027", "خريف 2026", "ربيع 2027"
    // Rule 2: Never put \b around Arabic text
    const termMatch = text.match(/(?:^|[^\w\u0600-\u06FF])(Fall|Spring|Summer|Winter|خريف|ربيع|صيف)\s*(?:Term\s*|Semester\s*)?(\d{4}(?:-\d{4})?)/i);
    if (termMatch) {
      const engTerm = /خريف/i.test(termMatch[1]) ? 'Fall' : /ربيع/i.test(termMatch[1]) ? 'Spring' : /صيف/i.test(termMatch[1]) ? 'Summer' : termMatch[1];
      return `${engTerm} ${termMatch[2]}`;
    }
  }

  // Fallback to wall-clock month
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();
  if (month >= 8 && month <= 12) {
    return `Fall ${year}`;
  } else if (month >= 1 && month <= 5) {
    return `Spring ${year}`;
  } else {
    return `Summer ${year}`;
  }
}

export interface CourseSemesterInfo {
  termCode?: string;
  termName: string;
  sortKey: number;
}

/**
 * Extracts semester and term information from course codes, CRNs, or course names.
 * Supports standard Banner 6-digit term codes (202510, 202610), 4-digit codes (_2510, _2620),
 * and seasonal Arabic or English terms ("Fall 2025", "Spring 2026", "خريف 2025").
 */
export function detectCourseSemesterInfo(course: UserCourseConfig): CourseSemesterInfo {
  const texts = [course.courseCode, course.crn, course.courseName].filter(Boolean) as string[];

  for (const text of texts) {
    // 6-digit Banner: 202510, 202610, 202620, etc.
    const banner6 = text.match(/(?:^|[^0-9])(20\d{2})(10|20|30)(?![0-9])/);
    if (banner6) {
      const year = banner6[1];
      const termCode = banner6[2];
      const termName = `${termCode === '10' ? 'Fall' : termCode === '20' ? 'Spring' : 'Summer'} ${year}`;
      const sortKey = Number(year) * 100 + Number(termCode);
      return { termCode: `${year}${termCode}`, termName, sortKey };
    }

    // 4-digit Banner: _2510, _2520, _2610, etc.
    const banner4 = text.match(/(?:^|[^0-9])_?(\d{2})(10|20|30)(?![0-9])/);
    if (banner4) {
      const year = String(2000 + Number(banner4[1]));
      const termCode = banner4[2];
      const termName = `${termCode === '10' ? 'Fall' : termCode === '20' ? 'Spring' : 'Summer'} ${year}`;
      const sortKey = Number(year) * 100 + Number(termCode);
      return { termCode: `${banner4[1]}${termCode}`, termName, sortKey };
    }

    // Named terms: "Fall 2025", "Spring 2026", "خريف 2025"
    // Rule 2: Never put \b around Arabic text
    const named = text.match(/(?:^|[^\w\u0600-\u06FF])(Fall|Spring|Summer|Winter|خريف|ربيع|صيف)\s*(?:Term\s*|Semester\s*)?(\d{4})/i);
    if (named) {
      const termStr = named[1];
      const year = named[2];
      const isFall = /Fall|خريف/i.test(termStr);
      const isSpring = /Spring|ربيع/i.test(termStr);
      const isSummer = /Summer|صيف/i.test(termStr);
      const termCodeNum = isFall ? 10 : isSpring ? 20 : isSummer ? 30 : 15;
      const engTerm = isFall ? 'Fall' : isSpring ? 'Spring' : isSummer ? 'Summer' : 'Winter';
      const termName = `${engTerm} ${year}`;
      const sortKey = Number(year) * 100 + termCodeNum;
      return { termName, sortKey };
    }
  }

  return { termName: 'Current Term', sortKey: 0 };
}

export interface SemesterPartition {
  termName: string;
  termCode?: string;
  sortKey: number;
  courses: UserCourseConfig[];
  tasks: DeadlineTask[];
}

/**
 * Groups active courses and tasks into distinct semester partitions, sorted newest first.
 */
export function partitionCoursesBySemester(
  courses: UserCourseConfig[],
  tasks: DeadlineTask[] = []
): SemesterPartition[] {
  if (!courses.length) return [];

  const map = new Map<number, SemesterPartition>();

  for (const c of courses) {
    const info = detectCourseSemesterInfo(c);
    let p = map.get(info.sortKey);
    if (!p) {
      p = {
        termName: info.termName,
        termCode: info.termCode,
        sortKey: info.sortKey,
        courses: [],
        tasks: []
      };
      map.set(info.sortKey, p);
    }
    p.courses.push(c);
  }

  // Associate tasks with partitions based on course name or code match
  for (const t of tasks) {
    const tCourseName = (t.courseName || '').toLowerCase();
    const tCourseCode = (t.courseCode || '').toLowerCase();

    for (const p of map.values()) {
      const hasCourse = p.courses.some(c => {
        const cName = (c.courseName || '').toLowerCase();
        const cCode = (c.courseCode || '').toLowerCase();
        return (cName && tCourseName && (cName === tCourseName || tCourseName.includes(cName) || cName.includes(tCourseName)))
          || (cCode && tCourseCode && (cCode === tCourseCode || tCourseCode.includes(cCode) || cCode.includes(tCourseCode)));
      });

      if (hasCourse) {
        p.tasks.push(t);
        break;
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.sortKey - a.sortKey);
}

export interface AutoPartitionResult {
  activeCourses: UserCourseConfig[];
  activeTasks: DeadlineTask[];
  archivedSemesters: ArchivedSemester[];
  partitionedCoursesCount: number;
  archivedSemestersCreated: number;
}

/**
 * When courses from multiple semesters are detected (e.g. Year 1 courses alongside Year 2 courses on Blackboard),
 * automatically keeps the latest term as active and archives older completed terms into ArchivedSemesters.
 */
export function autoPartitionPastSemesters(params: {
  courses: UserCourseConfig[];
  tasks: DeadlineTask[];
  scale?: ReadonlyArray<GradeRow>;
  existingSemesters?: ArchivedSemester[];
  mode?: 'compact' | 'full';
}): AutoPartitionResult {
  const partitions = partitionCoursesBySemester(params.courses, params.tasks);
  const existing = sanitizeSemesters(params.existingSemesters);

  if (partitions.length <= 1) {
    return {
      activeCourses: params.courses,
      activeTasks: params.tasks,
      archivedSemesters: existing,
      partitionedCoursesCount: 0,
      archivedSemestersCreated: 0
    };
  }

  // The first partition (highest sortKey) is the latest active semester
  const activePartition = partitions[0];
  const olderPartitions = partitions.slice(1);

  const newArchivedSemesters: ArchivedSemester[] = [];
  let partitionedCoursesCount = 0;

  for (const p of olderPartitions) {
    partitionedCoursesCount += p.courses.length;
    const archived = archiveActiveSemester({
      name: p.termName,
      courses: p.courses,
      tasks: p.tasks,
      scale: params.scale || [],
      mode: params.mode || 'full'
    });
    newArchivedSemesters.push(archived);
  }

  const mergedSemesters = mergeArchivedSemesters(existing, newArchivedSemesters);

  return {
    activeCourses: activePartition.courses,
    activeTasks: activePartition.tasks,
    archivedSemesters: mergedSemesters,
    partitionedCoursesCount,
    archivedSemestersCreated: newArchivedSemesters.length
  };
}
