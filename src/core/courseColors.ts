/**
 * Permanent course color mapping for University of Sharjah subjects.
 * Colors requested by user:
 * - intro to comp eng: #7c7c7c
 * - calculus 1 for engineering: #dc2626
 * - physics 1: #4b99d2
 * - physics 1 lab: #4b99d2
 * - english for academic purposes: #525252
 * - islamic culture: #489160
 */

export interface CourseColorTheme {
  hex: string;
  bgLight: string;
  border: string;
  textDark: string;
}

const PERMANENT_COLORS: Array<{ pattern: RegExp; hex: string }> = [
  // Physics 1 Lab (must precede Physics 1)
  { pattern: /(?:phys(?:ics)?.*lab|lab.*phys(?:ics)?|مختبر.*فيزياء|1430116|1430117|0401116)/i, hex: '#4b99d2' },
  // Physics 1
  { pattern: /(?:phys(?:ics)?|الفيزياء|فيزياء|1430115|1430111|0401115)/i, hex: '#4b99d2' },
  // Calculus 1 for Engineering (supports Roman numeral I, digits, Arabic, and codes)
  { pattern: /(?:calculus|calc\b|حسبان|1440133|1440131|0401101|0401201)/i, hex: '#dc2626' },
  // Islamic Culture
  { pattern: /(?:islamic|إسلام|اسلام|0104100|0104101)/i, hex: '#489160' },
  // Intro to Comp Eng
  { pattern: /(?:intro.*comp|comp(?:uter)?\s*eng|هندسة.*حاسوب|حاسوب|1502101|0402101|0402102)/i, hex: '#7c7c7c' },
  // English for Academic Purposes
  { pattern: /(?:english|eap\b|academic\s*english|إنجليز|انجليز|0202112|0202111)/i, hex: '#525252' }
];

export const PERMANENT_COURSE_LEGEND = [
  { name: 'Intro to Comp Eng', code: '1502101', pattern: /(?:intro.*comp|comp(?:uter)?\s*eng|هندسة.*حاسوب|حاسوب|1502101|0402101|0402102)/i, hex: '#7c7c7c' },
  { name: 'Calculus 1 for Engineering', code: '1440133', pattern: /(?:calculus|calc\b|حسبان|1440133|1440131|0401101|0401201)/i, hex: '#dc2626' },
  { name: 'Physics 1', code: '1430115', pattern: /(?:physics\s*1(?!\s*lab)|phys\s*1(?!\s*lab)|فيزياء\s*1(?!\s*عملي)|1430115)/i, hex: '#4b99d2' },
  { name: 'Physics 1 Lab', code: '1430116', pattern: /(?:physics\s*1\s*lab|phys\s*1\s*lab|فيزياء\s*1\s*عملي|lab\s*phys|1430116)/i, hex: '#4b99d2' },
  { name: 'English for Academic Purposes', code: '0202112', pattern: /(?:english|eap\b|academic\s*english|إنجليز|انجليز|0202112|0202111)/i, hex: '#525252' },
  { name: 'Islamic Culture', code: '0104100', pattern: /(?:islamic|إسلام|اسلام|0104100|0104101)/i, hex: '#489160' }
];

// Fallback deterministic colors for any other courses
const FALLBACK_PALETTE = [
  '#2563eb', // Blue
  '#7c3aed', // Purple
  '#059669', // Emerald
  '#d97706', // Amber
  '#db2777', // Pink
  '#0891b2'  // Cyan
];

import { getActiveCourseLegend } from './userCourses';

/**
 * Returns the permanent hex color for a given course name/code or task context.
 */
export function getCourseHex(courseName: string = '', courseCode: string = '', extraContext: string = ''): string {
  const combined = `${courseName} ${courseCode} ${extraContext}`.trim();

  // First check active course legend (from UserCourseConfig or defaults)
  const activeLegend = getActiveCourseLegend();
  for (const item of activeLegend) {
    if (item.pattern.test(combined)) {
      return item.hex;
    }
  }

  for (const item of PERMANENT_COLORS) {
    if (item.pattern.test(combined)) {
      return item.hex;
    }
  }

  // Deterministic fallback based on course string
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash << 5) - hash + combined.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[index];
}

/**
 * The colour the student set for a course, or null when the course is not in their course list
 * (no made-up fallback colour). The 7-digit code is checked first, then the name patterns.
 */
export function findConfiguredCourseHex(courseName: string = '', courseCode: string = ''): string | null {
  const legend = getActiveCourseLegend();
  const items = legend.length ? legend : PERMANENT_COURSE_LEGEND;
  const valid = (hex: string) => (/^#[0-9a-f]{3,8}$/i.test(hex) ? hex : null);
  const code = courseCode.replace(/\s+/g, '');
  if (code) {
    const byCode = items.find(item => item.code && item.code.replace(/\s+/g, '') === code);
    if (byCode) return valid(byCode.hex);
  }
  const combined = `${courseName} ${courseCode}`.trim();
  if (!combined) return null;
  const byName = items.find(item => item.pattern.test(combined));
  return byName ? valid(byName.hex) : null;
}

/**
 * Generates complementary light background and border styles for UI badges and chips.
 */
export function getCourseColorTheme(courseName: string = '', courseCode: string = '', extraContext: string = ''): CourseColorTheme {
  const rawHex = getCourseHex(courseName, courseCode, extraContext);
  // Colors can arrive from the cloud; only accept plain hex values so they cannot break out of style attributes
  const hex = /^#[0-9a-f]{3,8}$/i.test(rawHex) ? rawHex : '#64748b';

  return {
    hex,
    bgLight: `${hex}18`, // 10% opacity for card/badge background
    border: `${hex}45`,  // 27% opacity for borders
    textDark: hex
  };
}
