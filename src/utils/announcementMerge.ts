import { Announcement } from '../types';

const normCode = (s?: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normName = (s?: string) => {
  const n = (s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
  return n === 'generalcourse' || n === 'uos' ? '' : n;
};
const normTitle = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
const blackboardId = (id: string) => (id.match(/_\d+_\d+$/) || [''])[0];

/**
 * True unless the two announcements are known to belong to different courses.
 * Course codes are often blank, so names are compared too; unknown means "maybe the same".
 */
export function sameCourse(a: Announcement, b: Announcement): boolean {
  const ca = normCode(a.courseCode === 'UOS' ? '' : a.courseCode);
  const cb = normCode(b.courseCode === 'UOS' ? '' : b.courseCode);
  if (ca && cb) return ca === cb;
  const na = normName(a.courseName);
  const nb = normName(b.courseName);
  if (na && nb) return na === nb;
  return true;
}

/** Whether a stream card and a full course announcement are the same post. */
function isSamePost(existing: Announcement, apiAnn: Announcement): boolean {
  const apiId = blackboardId(apiAnn.id);
  const existingId = blackboardId(existing.id);
  // Blackboard ids are unique: same id is the same post, different ids are different posts
  if (apiId && existingId) return apiId === existingId;
  if (!sameCourse(existing, apiAnn)) return false;
  const a = normTitle(apiAnn.title);
  const e = normTitle(existing.title);
  return a.length >= 4 && (e === a || (a.length >= 6 && (e.includes(a) || a.includes(e))));
}

/**
 * Combines announcements read from the activity stream (often cut short) with the full
 * bodies read from each course. A full body only ever replaces a card from the same course,
 * so two courses posting "Quiz 3" never swap texts.
 */
export function mergeStreamAndCourseAnnouncements(
  domAnnouncements: Announcement[],
  apiAnnouncements: Announcement[],
  drawerAnn?: Announcement | null
): Announcement[] {
  // The stream can list a card twice; keep the last copy per course and title
  const byKey = new Map<string, Announcement>();
  for (const ann of domAnnouncements) {
    byKey.set(`${normCode(ann.courseCode)}|${normName(ann.courseName)}|${ann.title.toLowerCase().trim()}`, ann);
  }
  const merged: Announcement[] = [...byKey.values()];

  for (const apiAnn of apiAnnouncements) {
    const existing = merged.find(m => isSamePost(m, apiAnn));
    if (!existing) {
      merged.push(apiAnn);
      continue;
    }
    const isExistingTruncated = /(?:…|\.\.\.)\s*$/.test(existing.contentText) || existing.contentText.includes('…');
    if (isExistingTruncated || apiAnn.contentText.length >= existing.contentText.length) {
      existing.contentText = apiAnn.contentText;
      existing.contentHtml = apiAnn.contentHtml || existing.contentHtml;
      if (apiAnn.title && apiAnn.title.length > existing.title.length) existing.title = apiAnn.title;
      if (!existing.courseCode && apiAnn.courseCode) existing.courseCode = apiAnn.courseCode;
      if ((!existing.courseName || existing.courseName === 'General Course') && apiAnn.courseName) {
        existing.courseName = apiAnn.courseName;
      }
    }
  }

  // An open side panel shows the whole post, so it replaces that post's card
  if (drawerAnn) {
    const i = merged.findIndex(m => sameCourse(m, drawerAnn) && m.title.toLowerCase().trim() === drawerAnn.title.toLowerCase().trim());
    if (i >= 0) merged[i] = drawerAnn;
    else merged.push(drawerAnn);
  }
  return merged;
}
