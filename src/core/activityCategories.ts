/**
 * What an item on Blackboard's Activity page is about, for the Activity filter bar.
 */
import { guessAssessmentType } from '../engine/hybridExtractor';

export type ActivityCategory = 'exams' | 'assignments' | 'grades' | 'materials' | 'announcements';

export const ACTIVITY_CATEGORIES: { id: ActivityCategory; label: string }[] = [
  { id: 'exams', label: 'Exams & quizzes' },
  { id: 'assignments', label: 'Assignments & labs' },
  { id: 'grades', label: 'Grades' },
  { id: 'materials', label: 'Materials' },
  { id: 'announcements', label: 'Announcements' }
];

export interface ActivityItemInfo {
  /** Tag name of Blackboard's icon, such as bb-ui-icon-large-announcement */
  icon: string;
  title: string;
  /** The item's preview text (announcement body), if any */
  text?: string;
}

/**
 * Grades by icon or "Grade posted"; then what the wording is about (exam or quiz, assignment, lab
 * or project); otherwise announcements stay announcements and everything else is course material.
 */
export function classifyActivityItem(item: ActivityItemInfo): ActivityCategory {
  const icon = (item.icon || '').toLowerCase();
  const title = (item.title || '').trim();
  if (icon.includes('grade') || /^grade (?:posted|updated)/i.test(title)) return 'grades';
  // File names such as "Physics1_Final_2025.pdf": underscores, dots and a digit glued to a word hide the words
  const words = `${title}\n${item.text || ''}`.replace(/[_.]+/g, ' ').replace(/([a-z])(\d)/gi, '$1 $2');
  const about = guessAssessmentType(words);
  if (about === 'exam' || about === 'quiz') return 'exams';
  if (about === 'assignment' || about === 'lab' || about === 'project') return 'assignments';
  // Lab experiment sheets: "Exp. (08)", "Exp 3"
  if (/\bexp\s*\(?\d/i.test(words)) return 'assignments';
  if (icon.includes('announcement')) return 'announcements';
  return 'materials';
}

export interface ActivityFilterState {
  /** Course chip keys; empty means every course */
  courses: string[];
  /** Categories; empty means every type */
  types: ActivityCategory[];
}

export const EMPTY_ACTIVITY_FILTER: ActivityFilterState = { courses: [], types: [] };

/** Keeps only known categories and string course keys, so stored or synced junk cannot break the bar. */
export function sanitizeActivityFilter(raw: unknown): ActivityFilterState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const known = new Set(ACTIVITY_CATEGORIES.map(c => c.id));
  const courses = Array.isArray(o.courses) ? o.courses.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length < 200) : [];
  const types = Array.isArray(o.types) ? o.types.filter((t): t is ActivityCategory => known.has(t as ActivityCategory)) : [];
  return { courses: [...new Set(courses)], types: [...new Set(types)] };
}

/** Within a row any chosen chip matches; both rows must match. */
export function activityItemMatches(filter: ActivityFilterState, courseKey: string, category: ActivityCategory): boolean {
  if (filter.courses.length && !filter.courses.includes(courseKey)) return false;
  if (filter.types.length && !filter.types.includes(category)) return false;
  return true;
}
