import type { UserCourseConfig } from '../types';
import { compileCoursePattern } from '../core/userCourses';
import type { CourseMeta } from './blackboardApi';

const normCode = (s?: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normText = (s?: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The Blackboard course id for a stream card that carries no course link, from the student's own
 * Blackboard courses (enrolment list and page links): by code, by name, or through the saved
 * course the text matches. '' when nothing matches or more than one course would.
 */
export function findCourseIdForText(
  text: string,
  courses: Map<string, CourseMeta>,
  savedCourses: UserCourseConfig[] = []
): string {
  const raw = String(text || '');
  if (!raw.trim() || courses.size === 0) return '';
  const lower = normText(raw);
  const compact = normCode(raw);
  const unique = (ids: Set<string>) => (ids.size === 1 ? [...ids][0] : '');

  // 1. The course code (spaces ignored, so "1440133" and "1440 133" agree)
  const byCode = new Set<string>();
  courses.forEach((meta, cid) => {
    const code = normCode(meta.code);
    if (code.length >= 5 && compact.includes(code)) byCode.add(cid);
  });
  if (byCode.size) return unique(byCode);

  // 2. The course name as Blackboard writes it
  const named: { cid: string; name: string }[] = [];
  courses.forEach((meta, cid) => {
    const name = normText(meta.name);
    if (name.length >= 4 && name !== 'general course' && lower.includes(name)) named.push({ cid, name });
  });
  // "Physics 1" inside "Physics 1 Lab" is the longer course, not both
  const byName = new Set(named.filter(n => !named.some(o => o.name !== n.name && o.name.includes(n.name))).map(n => n.cid));
  if (byName.size) return unique(byName);

  // 3. A saved course the text matches (its name, code or aliases), then that course's Blackboard id
  const bySaved = new Set<string>();
  for (const saved of savedCourses) {
    let pattern: RegExp;
    try {
      pattern = compileCoursePattern(saved);
    } catch {
      continue;
    }
    if (!pattern.test(raw)) continue;
    courses.forEach((meta, cid) => {
      if (pattern.test(`${meta.code} ${meta.name}`)) bySaved.add(cid);
    });
  }
  return unique(bySaved);
}
