/**
 * University presets: grading scale, home domains (to recognise the university from its
 * Blackboard address) and default quick links. A student picks one in onboarding, or the first
 * scan picks it from the Blackboard address. Every scale can be edited in Settings.
 *
 * Sources (checked October 2026):
 * - UOS: undergraduate catalog 2025-2026.
 * - UAEU: policy ACA-ADM-09 (Chancellor Decree 128/2004).
 * - ADU: undergraduate catalog 2024-2025.
 * - ZU: policy ACA-PRO-203 v5.1 (February 2024).
 * - AUD: undergraduate grading system policy (points only; instructors set the percentages).
 * - AUS: academic information page (points only; instructors set the percentages).
 * - AURAK: catalog 2023-2024, Grading System (page 63).
 */

export interface GradeRow {
  letter: string;
  /** Lowest course percentage that earns this letter */
  min: number;
  points: number;
}

export interface QuickLinkPreset {
  id: string;
  title: string;
  url: string;
  category: 'attendance' | 'study_plan' | 'marks' | 'portal' | 'other';
}

export interface UniversityPreset {
  id: string;
  name: string;
  shortName: string;
  /** Home domains; any Blackboard address ending in one of these belongs to this university */
  domains: string[];
  gradeScale: GradeRow[];
  /** True when the university publishes points only and instructors set the percentage cutoffs */
  cutoffsFromSyllabus?: boolean;
  /** Lowest passing letter, shown with the scale */
  lowestPass: string;
  /** Blackboard address, when known; used for the default Blackboard quick link */
  blackboardUrl?: string;
  quickLinks?: QuickLinkPreset[];
  /**
   * The student's exam schedule page (midterms and finals), when known. A Scan reads it directly
   * over HTTP with credentials (src/background/examRefresh.ts); they must be signed in.
   */
  examSchedulePage?: string;
  timeZone: string;
}

/** Plus and minus letters with steps of 4 or 3 points: Zayed University's published table. */
const PLUS_MINUS_SCALE: GradeRow[] = [
  { letter: 'A', min: 90, points: 4.0 },
  { letter: 'A-', min: 87, points: 3.7 },
  { letter: 'B+', min: 84, points: 3.3 },
  { letter: 'B', min: 80, points: 3.0 },
  { letter: 'B-', min: 77, points: 2.7 },
  { letter: 'C+', min: 74, points: 2.3 },
  { letter: 'C', min: 70, points: 2.0 },
  { letter: 'C-', min: 67, points: 1.7 },
  { letter: 'D+', min: 64, points: 1.3 },
  { letter: 'D', min: 60, points: 1.0 },
  { letter: 'F', min: 0, points: 0 }
];

/** Half steps of 0.5 and bands of 5 points (UOS, UAEU, ADU). */
const HALF_STEP_SCALE: GradeRow[] = [
  { letter: 'A', min: 90, points: 4.0 },
  { letter: 'B+', min: 85, points: 3.5 },
  { letter: 'B', min: 80, points: 3.0 },
  { letter: 'C+', min: 75, points: 2.5 },
  { letter: 'C', min: 70, points: 2.0 },
  { letter: 'D+', min: 65, points: 1.5 },
  { letter: 'D', min: 60, points: 1.0 },
  { letter: 'F', min: 0, points: 0 }
];

/** AURAK's published table (catalog 2023-2024): bands of 3 to 6 points, A from 95. */
const AURAK_SCALE: GradeRow[] = [
  { letter: 'A', min: 95, points: 4.0 },
  { letter: 'A-', min: 90, points: 3.7 },
  { letter: 'B+', min: 86, points: 3.3 },
  { letter: 'B', min: 83, points: 3.0 },
  { letter: 'B-', min: 80, points: 2.7 },
  { letter: 'C+', min: 76, points: 2.3 },
  { letter: 'C', min: 73, points: 2.0 },
  { letter: 'C-', min: 70, points: 1.7 },
  { letter: 'D+', min: 66, points: 1.3 },
  { letter: 'D', min: 60, points: 1.0 },
  { letter: 'F', min: 0, points: 0 }
];

export const GENERIC_UNIVERSITY_ID = 'other';

export const UNIVERSITY_PRESETS: UniversityPreset[] = [
  {
    id: 'uos',
    name: 'University of Sharjah',
    shortName: 'UOS',
    domains: ['sharjah.ac.ae'],
    gradeScale: HALF_STEP_SCALE,
    lowestPass: 'D',
    blackboardUrl: 'https://elearning.sharjah.ac.ae/ultra/course',
    quickLinks: [
      { id: 'ql-attendance', title: 'Attendance (Banner)', url: 'https://banner.sharjah.ac.ae', category: 'attendance' },
      { id: 'ql-studyplan', title: 'Study Plan & Degree Audit', url: 'https://banner.sharjah.ac.ae/StudentRegistrationSsb/', category: 'study_plan' },
      { id: 'ql-marks', title: 'Final Marks & Transcript', url: 'https://banner.sharjah.ac.ae', category: 'marks' },
      { id: 'ql-exams', title: 'Exam Schedule (Banner)', url: 'https://generalssb-prod.ec.sharjah.ac.ae/BannerExtensibility/customPage/page/StudentExamPage', category: 'other' },
      { id: 'ql-blackboard', title: 'Blackboard Ultra Portal', url: 'https://elearning.sharjah.ac.ae/ultra/course', category: 'portal' }
    ],
    examSchedulePage: 'https://generalssb-prod.ec.sharjah.ac.ae/BannerExtensibility/customPage/page/StudentExamPage',
    timeZone: 'Asia/Dubai'
  },
  {
    id: 'uaeu',
    name: 'United Arab Emirates University',
    shortName: 'UAEU',
    domains: ['uaeu.ac.ae'],
    gradeScale: HALF_STEP_SCALE,
    lowestPass: 'D',
    blackboardUrl: 'https://learn.uaeu.ac.ae/ultra/course',
    timeZone: 'Asia/Dubai'
  },
  {
    id: 'adu',
    name: 'Abu Dhabi University',
    shortName: 'ADU',
    domains: ['adu.ac.ae'],
    gradeScale: HALF_STEP_SCALE,
    lowestPass: 'D',
    blackboardUrl: 'https://blackboard.adu.ac.ae/ultra/course',
    timeZone: 'Asia/Dubai'
  },
  {
    id: 'zu',
    name: 'Zayed University',
    shortName: 'ZU',
    domains: ['zu.ac.ae'],
    gradeScale: PLUS_MINUS_SCALE,
    lowestPass: 'D',
    blackboardUrl: 'https://learn.zu.ac.ae/ultra/course',
    timeZone: 'Asia/Dubai'
  },
  {
    id: 'aud',
    name: 'American University in Dubai',
    shortName: 'AUD',
    domains: ['aud.edu'],
    gradeScale: PLUS_MINUS_SCALE,
    cutoffsFromSyllabus: true,
    lowestPass: 'D',
    blackboardUrl: 'https://blackboard.aud.edu/ultra/course',
    timeZone: 'Asia/Dubai'
  },
  {
    id: 'aus',
    name: 'American University of Sharjah',
    shortName: 'AUS',
    domains: ['aus.edu'],
    // AUS has no D+ or D-; C- is the lowest pass
    gradeScale: PLUS_MINUS_SCALE.filter(g => g.letter !== 'D+'),
    cutoffsFromSyllabus: true,
    lowestPass: 'C-',
    blackboardUrl: 'https://ilearn.aus.edu/ultra/course',
    timeZone: 'Asia/Dubai'
  },
  {
    id: 'aurak',
    name: 'American University of Ras Al Khaimah',
    shortName: 'AURAK',
    domains: ['aurak.ac.ae'],
    gradeScale: AURAK_SCALE,
    lowestPass: 'D',
    blackboardUrl: 'https://blackboard.aurak.ac.ae/ultra/course',
    timeZone: 'Asia/Dubai'
  },
  {
    id: GENERIC_UNIVERSITY_ID,
    name: 'Other university',
    shortName: 'Other',
    domains: [],
    gradeScale: PLUS_MINUS_SCALE,
    cutoffsFromSyllabus: true,
    lowestPass: 'D',
    timeZone: 'Asia/Dubai'
  }
];

export const DEFAULT_UNIVERSITY_ID = 'uos';

export function getUniversity(id?: string | null): UniversityPreset {
  return UNIVERSITY_PRESETS.find(u => u.id === id)
    || UNIVERSITY_PRESETS.find(u => u.id === GENERIC_UNIVERSITY_ID)!;
}

/** The university a Blackboard address belongs to, from its home domain; null when unknown. */
export function findUniversityByHost(hostname: string): UniversityPreset | null {
  const host = (hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  for (const u of UNIVERSITY_PRESETS) {
    if (u.domains.some(d => host === d || host.endsWith(`.${d}`))) return u;
  }
  return null;
}

/** A cleaned copy of a scale: valid rows only, highest cutoff first, always ending in a 0 row. */
export function normalizeGradeScale(rows: unknown): GradeRow[] | null {
  if (!Array.isArray(rows)) return null;
  const clean = rows
    .map(r => ({
      letter: String((r as any)?.letter ?? '').trim().slice(0, 4),
      min: Number((r as any)?.min),
      points: Number((r as any)?.points)
    }))
    .filter(r => r.letter && Number.isFinite(r.min) && r.min >= 0 && r.min <= 100 && Number.isFinite(r.points) && r.points >= 0 && r.points <= 5)
    .sort((a, b) => b.min - a.min);
  if (!clean.length) return null;
  if (clean[clean.length - 1].min !== 0) clean.push({ letter: 'F', min: 0, points: 0 });
  return clean.slice(0, 20);
}

/**
 * A university's built-in quick links, ready to save. Only links checked to be right are built in
 * (UOS today); every other university starts with none and the student adds their own.
 */
export function universityQuickLinks(universityId: string, createdAt: string): Array<QuickLinkPreset & { createdAt: string }> {
  return (getUniversity(universityId).quickLinks || []).map(p => ({ ...p, createdAt }));
}

const PRESET_TITLES: Record<QuickLinkPreset['category'], string> = {
  attendance: 'Attendance',
  study_plan: 'Study Plan',
  marks: 'Marks & Transcript',
  portal: 'Blackboard',
  other: 'Link'
};

/**
 * What the "+ Attendance", "+ Marks" and similar buttons fill in: the university's own built-in link
 * of that kind, else only a title, so no other university's address is ever filled in.
 */
export function quickLinkPreset(universityId: string, category: QuickLinkPreset['category']): { title: string; url: string; category: QuickLinkPreset['category'] } {
  const own = (getUniversity(universityId).quickLinks || []).find(p => p.category === category);
  return own ? { title: own.title, url: own.url, category } : { title: PRESET_TITLES[category] || 'Link', url: '', category };
}

/**
 * Quick links after switching university: the old university's built-in links that the student
 * did not edit are removed, and the new university's built-in links are added. Links the
 * student made or edited stay.
 */
export function swapUniversityQuickLinks<T extends { id: string; url: string; title: string; category: string }>(
  links: T[],
  fromId: string,
  toId: string,
  makeLink: (p: QuickLinkPreset) => T
): T[] {
  const from = getUniversity(fromId);
  const to = getUniversity(toId);
  const untouched = (l: T) => (from.quickLinks || []).some(p => p.id === l.id && p.url === l.url && p.title === l.title);
  const kept = (links || []).filter(l => !untouched(l));
  const add = (to.quickLinks || []).filter(p => !kept.some(l => l.id === p.id || l.url === p.url)).map(makeLink);
  return [...kept, ...add];
}

/** "A 90+ · B+ 85+ · ... · F below 60", for the GPA card. */
export function describeGradeScale(scale: GradeRow[]): string {
  const rows = scale.filter(g => g.min > 0);
  const lowest = rows[rows.length - 1];
  const parts = rows.map(g => `${g.letter} ${g.min}+`);
  if (lowest) parts.push(`F below ${lowest.min}`);
  return parts.join(' · ');
}
