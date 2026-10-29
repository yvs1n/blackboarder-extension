/**
 * Course colours: the colour the student set on each course (colorHex, which a scan fills in from
 * Blackboard's own course card palette), else a steady colour picked from FALLBACK_PALETTE.
 */

export interface CourseColorTheme {
  hex: string;
  bgLight: string;
  border: string;
  textDark: string;
}

// Fallback deterministic colors for any other courses
const FALLBACK_PALETTE = [
  '#2563eb', // Blue
  '#7c3aed', // Purple
  '#059669', // Emerald
  '#d97706', // Amber
  '#db2777', // Pink
  '#0891b2'  // Cyan
];

import { getActiveCourseLegend, pickCourseMatch } from './userCourses';

/**
 * Returns the hex color for a given course name/code or task context.
 */
export function getCourseHex(courseName: string = '', courseCode: string = '', extraContext: string = ''): string {
  const combined = `${courseName} ${courseCode} ${extraContext}`.trim();

  // The student's own course colour first
  const match = pickCourseMatch(getActiveCourseLegend(), combined, item => item.pattern, item => item.name);
  if (match && match.hex) return match.hex;

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
  const items = getActiveCourseLegend();
  const valid = (hex: string) => (/^#[0-9a-f]{3,8}$/i.test(hex) ? hex : null);
  const code = courseCode.replace(/\s+/g, '');
  if (code) {
    const byCode = items.find(item => item.code && item.code.replace(/\s+/g, '') === code);
    if (byCode) return valid(byCode.hex);
  }
  const combined = `${courseName} ${courseCode}`.trim();
  if (!combined) return null;
  const byName = pickCourseMatch(items, combined, item => item.pattern, item => item.name);
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
