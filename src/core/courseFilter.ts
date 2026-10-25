import type { UserCourseConfig } from '../types';
import { isBlackboardSystemNoise, hasValidAcademicCourseCode } from './courseHelper';
import { DEFAULT_USER_COURSES } from './userCourses';
import { sanitizeCloudCourses } from '../utils/cloudSanitize';

/**
 * Filters out Blackboard navigation tabs (Content, Calendar, Discussions, Gradebook, etc.)
 * from registered user courses so that UI elements never masquerade as courses.
 */
export function filterCleanUserCourses(rawCourses: UserCourseConfig[]): UserCourseConfig[] {
  if (!Array.isArray(rawCourses)) return [];
  // Stored courses can originate from the cloud: repair missing arrays and unsafe colors up front
  const courses = sanitizeCloudCourses(rawCourses) ?? [];
  const defaultIds = new Set(DEFAULT_USER_COURSES.map(d => d.id));
  const seenCodes = new Set<string>();
  const seenNames = new Set<string>();
  const result: UserCourseConfig[] = [];

  for (const c of courses) {
    const name = (c.courseName || '').trim();
    const code = (c.courseCode || '').trim();
    if (!name && !code) continue;

    // Reject Blackboard system noise, navigation tabs, and Details & Actions items
    if (isBlackboardSystemNoise(name) || isBlackboardSystemNoise(code)) {
      continue;
    }

    // Require either a valid academic course code or an entry matching default courses
    const isDefault = defaultIds.has(c.id);
    if (!isDefault && !hasValidAcademicCourseCode(code) && !hasValidAcademicCourseCode(name)) {
      continue;
    }

    const normCode = code.replace(/[\s_-]+/g, '').toLowerCase();
    const normName = name.toLowerCase();

    if (normCode && seenCodes.has(normCode)) {
      continue;
    }
    if (normName && seenNames.has(normName)) {
      continue;
    }

    if (normCode) seenCodes.add(normCode);
    if (normName) seenNames.add(normName);
    result.push(c);
  }

  return result;
}
