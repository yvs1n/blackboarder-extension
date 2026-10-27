import type { DeadlineTask, QuickLink, UserCourseConfig, StudentProfile } from '../types';
import { mergeCloudTasks, mergeTombstones, TombstoneMap } from './taskMerge';
import { newerProfile, sanitizeProfile } from '../core/studentProfile';
import { sanitizeCloudTasks, sanitizeCloudCourses, sanitizeCloudQuickLinks, decodeCloudKeys } from './cloudSanitize';

/**
 * Every write to Firebase replaces the whole `users/{syncKey}/data` object, so each device first
 * merges what it has with the copy in the cloud and writes the result. Each part keeps its own rule:
 * - tasks: the newer `updatedAt` wins per task, deletions (tombstones) win unless the task was edited after
 * - courses and quick links: the list with the newer `...UpdatedAt` wins as a whole
 * - profile (university and grading scale): the newer `updatedAt` wins
 * Used by the extension (`pushTasksToFirebase`) and the phone app (`pushStateToCloud`, via BBCore).
 */

export interface SyncSide {
  tasks?: DeadlineTask[];
  tombstones?: TombstoneMap;
  courses?: UserCourseConfig[];
  coursesUpdatedAt?: string | null;
  quickLinks?: QuickLink[];
  quickLinksUpdatedAt?: string | null;
  profile?: StudentProfile | null;
}

export interface MergedSync {
  tasks: DeadlineTask[];
  tombstones: TombstoneMap;
  courses?: UserCourseConfig[];
  coursesUpdatedAt?: string;
  quickLinks?: QuickLink[];
  quickLinksUpdatedAt?: string;
  profile?: StudentProfile;
  /** True when the cloud's courses or quick links won, so this device should take them too */
  coursesFromCloud: boolean;
  quickLinksFromCloud: boolean;
}

const time = (stamp?: string | null) => {
  const t = stamp ? Date.parse(stamp) : NaN;
  return isNaN(t) ? 0 : t;
};

/**
 * Which copy of a whole list to keep. The newer stamp wins; on a tie (the same version, or neither
 * stamped, as before stamps existed) `preferLocalOnTie` decides, and an empty side never beats a full one.
 */
export function pickNewerList<T>(
  local: { items?: T[]; updatedAt?: string | null },
  cloud: { items?: T[]; updatedAt?: string | null },
  preferLocalOnTie: boolean
): { items?: T[]; updatedAt?: string; fromCloud: boolean } {
  const localOut = { items: local.items, updatedAt: local.updatedAt || undefined, fromCloud: false };
  const cloudOut = { items: cloud.items, updatedAt: cloud.updatedAt || undefined, fromCloud: true };
  if (!Array.isArray(cloud.items)) return localOut;
  if (!Array.isArray(local.items)) return cloudOut;
  const lt = time(local.updatedAt);
  const ct = time(cloud.updatedAt);
  if (ct > lt) return cloudOut;
  if (lt > ct) return localOut;
  if (cloud.items.length === 0 && local.items.length > 0) return localOut;
  if (local.items.length === 0 && cloud.items.length > 0) return cloudOut;
  return preferLocalOnTie ? localOut : cloudOut;
}

/** The cloud document (`users/{syncKey}/data`) as one side of the merge, cleaned. */
export function readCloudSide(data: any): SyncSide {
  if (!data || typeof data !== 'object') return {};
  return {
    tasks: sanitizeCloudTasks(Array.isArray(data.tasks) ? data.tasks : []),
    tombstones: (data.tombstones && typeof data.tombstones === 'object' && decodeCloudKeys<string>(data.tombstones)) || {},
    courses: sanitizeCloudCourses(data.courses),
    coursesUpdatedAt: typeof data.coursesUpdatedAt === 'string' ? data.coursesUpdatedAt : undefined,
    quickLinks: sanitizeCloudQuickLinks(data.quickLinks),
    quickLinksUpdatedAt: typeof data.quickLinksUpdatedAt === 'string' ? data.quickLinksUpdatedAt : undefined,
    profile: sanitizeProfile(data.profile)
  };
}

/** What to write to Firebase: this device's data merged with the cloud copy read just before. */
export function mergeForCloudWrite(local: SyncSide, cloud: SyncSide | null | undefined): MergedSync {
  const c = cloud || {};
  const tombstones = mergeTombstones(local.tombstones || {}, c.tombstones || {});
  const tasks = Array.isArray(c.tasks) && c.tasks.length > 0
    ? mergeCloudTasks(local.tasks || [], c.tasks, tombstones).tasks
    : (local.tasks || []).filter(t => {
      const tomb = tombstones[t.id];
      return !(tomb && time(tomb) >= time(t.updatedAt || t.createdAt));
    });
  // Courses: on a tie the cloud copy is kept (it is what the other devices already have)
  const courses = pickNewerList({ items: local.courses, updatedAt: local.coursesUpdatedAt }, { items: c.courses, updatedAt: c.coursesUpdatedAt }, false);
  // Quick links: before they had a stamp, the device writing kept its own list
  const links = pickNewerList({ items: local.quickLinks, updatedAt: local.quickLinksUpdatedAt }, { items: c.quickLinks, updatedAt: c.quickLinksUpdatedAt }, true);
  return {
    tasks,
    tombstones,
    courses: courses.items,
    coursesUpdatedAt: courses.updatedAt,
    quickLinks: links.items,
    quickLinksUpdatedAt: links.updatedAt,
    profile: newerProfile(local.profile, c.profile) || undefined,
    coursesFromCloud: courses.fromCloud,
    quickLinksFromCloud: links.fromCloud
  };
}
