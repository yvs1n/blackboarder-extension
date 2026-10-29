import type { UserCourseConfig } from '../types';
import { isBlackboardSystemNoise } from './courseHelper';
import { sanitizeCloudCourses } from '../utils/cloudSanitize';

/**
 * Filters out Blackboard navigation tabs (Content, Calendar, Discussions, Gradebook, etc.)
 * from registered user courses so that UI elements never masquerade as courses.
 */
export function filterCleanUserCourses(rawCourses: UserCourseConfig[]): UserCourseConfig[] {
  if (!Array.isArray(rawCourses)) return [];
  // Stored courses can originate from the cloud: repair missing arrays and unsafe colors up front
  const courses = sanitizeCloudCourses(rawCourses) ?? [];
  const seenCodes = new Set<string>();
  const seenNames = new Set<string>();
  const result: UserCourseConfig[] = [];

  for (const c of courses) {
    const name = (c.courseName || '').trim();
    const code = (c.courseCode || '').trim();
    if (!name && !code) continue;

    // Reject Blackboard system noise, navigation tabs, and Details & Actions items
    // (an empty field is not noise: a course added by hand may have no code)
    if ((name && isBlackboardSystemNoise(name)) || (code && isBlackboardSystemNoise(code))) {
      continue;
    }

    // Anything else with a name or code stays: courses the student added by hand or imported need
    // no academic code, and a saved course is never dropped just because it has none

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
