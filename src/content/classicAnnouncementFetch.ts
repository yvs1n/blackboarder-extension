import { Announcement } from '../types';
import { getActiveUserCourses } from '../core/userCourses';
import { parseCourseDetails, sanitizeDoctorAnnouncementText } from '../core/courseHelper';
import { GET_BLACKBOARD_XSRF, needsXsrf, XSRF_HEADER } from '../utils/extension/blackboardXsrf';
import { detectUniversityFromHost, getProfile, saveProfile } from '../utils/storage/profile';
import {
  ApiResult,
  BbFetch,
  CourseMeta,
  fetchEnrolledCourses,
  isGenericPlaceholderName,
  isOrientationOrSandboxCourse,
  mergeCourseMaps
} from '../scan/blackboardApi';
import { findCourseIdForText } from '../scan/courseLookup';

export type EnrolledCourses = ApiResult<{ courses: Map<string, CourseMeta>; skipped: Set<string> }>;

/**
 * fetch() for a Blackboard path resolved against window.location.origin so Ultra <base href>
 * does not redirect API requests to CloudFront.
 */
export function bbFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, window.location.origin).href, init);
}

/** Resolves standard Blackboard AJAX headers including CSRF token if present. */
export function getBlackboardFetchHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest'
  };
  try {
    const match = document.cookie.match(/(?:^|;\s*)(?:XSRF-TOKEN|xsrfToken|Bb-Xsrf)=([^;]+)/i);
    if (match) {
      const token = decodeURIComponent(match[1]);
      headers['X-Blackboard-XSRF'] = token;
      headers['X-XSRF-TOKEN'] = token;
    }
  } catch {}
  return headers;
}

/** GET a Blackboard API path as JSON (throws on a failed request). */
export async function getBlackboardJson(path: string): Promise<any> {
  const res = await bbFetch(path, { headers: getBlackboardFetchHeaders(), credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Blackboard ${res.status}`);
  return res.json();
}

/** The session's XSRF token from the service worker (the cookie holding it is HttpOnly). */
function tabXsrfToken(): Promise<string | null> {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type: GET_BLACKBOARD_XSRF }, res => {
        void chrome.runtime.lastError;
        resolve(typeof res?.token === 'string' ? res.token : null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** bbFetch with Blackboard's AJAX headers and HttpOnly session XSRF token. */
export const tabFetch: BbFetch = async (path, init) => {
  const extra: Record<string, string> = {};
  if (needsXsrf(init)) {
    const token = await tabXsrfToken();
    if (token) extra[XSRF_HEADER] = token;
  }
  return bbFetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { ...getBlackboardFetchHeaders(), ...extra, ...((init?.headers as Record<string, string>) || {}) }
  });
};

function courseMetaFromPageText(raw: string): CourseMeta {
  const parsed = parseCourseDetails(raw);
  return {
    name: parsed.name !== 'General Course' ? parsed.name : raw,
    code: parsed.code !== 'UOS' ? parsed.code : ''
  };
}

/**
 * Course ids and names the page itself shows (URL, data attributes, course links), and the
 * orientation or sandbox courses it links to.
 */
export function collectPageCourses(): { courses: Map<string, CourseMeta>; skipped: Set<string> } {
  const courses = new Map<string, CourseMeta>();
  const skipped = new Set<string>();
  const add = (cid: string, rawName: string = '') => {
    if (!cid || !cid.startsWith('_') || skipped.has(cid)) return;
    if (rawName && isOrientationOrSandboxCourse(rawName)) {
      skipped.add(cid);
      courses.delete(cid);
      return;
    }
    const known = courses.get(cid);
    if (known && known.name) return;
    courses.set(cid, rawName ? courseMetaFromPageText(rawName) : { name: '', code: '' });
  };

  const urlMatch = window.location.href.match(/(?:courses\/|course_id=|[?&]id=)(_\d+_\d+)/);

  document.querySelectorAll('[data-course-id], [data-course]').forEach(el => {
    add(el.getAttribute('data-course-id') || el.getAttribute('data-course') || '');
  });

  document.querySelectorAll('a[href*="/courses/"], a[href*="course_id="], a[href*="launcher?type=Course"]').forEach(a => {
    const href = (a as HTMLAnchorElement).getAttribute('href') || '';
    const m = href.match(/(?:courses\/|course_id=|[?&]id=)(_\d+_\d+)/);
    if (!m) return;
    const name = a.textContent?.trim() || '';
    if (isOrientationOrSandboxCourse(name)) {
      skipped.add(m[1]);
      courses.delete(m[1]);
      return;
    }
    add(m[1], name);
  });

  if (urlMatch && !skipped.has(urlMatch[1]) && !courses.get(urlMatch[1])?.name) {
    const heading = document.querySelector('#courseMenuPalette_paletteTitleHeading, .course-title, header h1, [aria-label*="Course Name"], #course-title-header, .bb-course-title');
    const hText = heading?.textContent?.trim() || '';
    if (isOrientationOrSandboxCourse(hText)) {
      skipped.add(urlMatch[1]);
      courses.delete(urlMatch[1]);
    } else {
      courses.delete(urlMatch[1]);
      add(urlMatch[1], hText);
    }
  }

  return { courses, skipped };
}

/** Starts reading the enrolment list once per scan for course resolution. */
export function startCourseLookup(page: { courses: Map<string, CourseMeta>; skipped: Set<string> }) {
  const enrolled: Promise<EnrolledCourses> = fetchEnrolledCourses(tabFetch)
    .catch(err => ({ ok: false as const, error: String(err) }));
  const courses = async () => mergeCourseMaps(await enrolled, page.courses, page.skipped);
  const resolve = async (text: string) => findCourseIdForText(text, await courses(), getActiveUserCourses());
  return { enrolled, courses, resolve };
}

const classicCourseAnnouncementsCache = new Map<string, Map<string, { html: string; text: string }>>();

async function fetchCourseAnnouncementsClassicWebapp(courseId: string): Promise<Map<string, { html: string; text: string }>> {
  if (classicCourseAnnouncementsCache.has(courseId)) {
    return classicCourseAnnouncementsCache.get(courseId)!;
  }
  const map = new Map<string, { html: string; text: string }>();
  try {
    const res = await bbFetch(`/webapps/blackboard/execute/announcement?method=search&course_id=${encodeURIComponent(courseId)}`, {
      credentials: 'same-origin'
    });
    if (res.ok) {
      const htmlText = await res.text();
      const doc = new DOMParser().parseFromString(htmlText, 'text/html');
      doc.querySelectorAll('#announcementList > li, .announcementList > li, li[id*="announcement"], .item').forEach(item => {
        const titleEl = item.querySelector('h3, .item h3, .announcement-title, [role="heading"]');
        const title = titleEl?.textContent?.trim().toLowerCase() || '';
        const bodyEl = item.querySelector('.vtbegenerated, .details, .announcement-content, .announcement-body') || item;
        const html = bodyEl.innerHTML || '';
        const text = bodyEl.textContent?.trim() || '';
        const itemId = item.getAttribute('id') || '';
        if (title && text) {
          map.set(title, { html, text });
          if (itemId) map.set(itemId, { html, text });
        }
      });
    }
  } catch {
    // webapp search unavailable
  }
  classicCourseAnnouncementsCache.set(courseId, map);
  return map;
}

function htmlBodyToText(html: string): { text: string; html: string } | null {
  if (!html) return null;
  const temp = document.createElement('div');
  temp.innerHTML = html;
  const clean = temp.textContent?.trim() || '';
  return clean ? { text: clean, html } : null;
}

/**
 * Orchestrates unabridged announcement retrieval directly via REST API or Classic Webapp.
 */
export async function fetchFullAnnouncementBodyFromCode(
  courseId: string | null,
  announcementId: string | null,
  title: string
): Promise<{ text: string; html: string } | null> {
  if (!courseId) return null;
  const bbHeaders = getBlackboardFetchHeaders();

  if (announcementId) {
    const endpoints = [
      `/learn/api/public/v1/courses/${encodeURIComponent(courseId)}/announcements/${encodeURIComponent(announcementId)}`,
      `/learn/api/v1/courses/${encodeURIComponent(courseId)}/announcements/${encodeURIComponent(announcementId)}`
    ];
    for (const url of endpoints) {
      try {
        const res = await bbFetch(url, { headers: bbHeaders, credentials: 'same-origin' });
        if (res.ok) {
          const data = await res.json();
          const parsed = data?.body ? htmlBodyToText(data.body) : null;
          if (parsed) return parsed;
        }
      } catch {}
    }
  }

  const classicMap = await fetchCourseAnnouncementsClassicWebapp(courseId);
  const titleLower = title.toLowerCase().trim();
  const cleanTokens = titleLower.replace(/[^a-z0-9\u0600-\u06FF]/g, ' ').split(/\s+/).filter(w => w.length >= 3);

  if (classicMap.size > 0) {
    if (announcementId && classicMap.has(announcementId)) return classicMap.get(announcementId)!;
    if (classicMap.has(titleLower)) return classicMap.get(titleLower)!;
    for (const [key, val] of classicMap.entries()) {
      const keyLower = key.toLowerCase().trim();
      if (titleLower && (keyLower.includes(titleLower) || titleLower.includes(keyLower))) return val;
      if (cleanTokens.length > 0 && cleanTokens.filter(t => keyLower.includes(t)).length >= Math.min(2, cleanTokens.length)) {
        return val;
      }
    }
  }

  try {
    const listRes = await bbFetch(`/learn/api/public/v1/courses/${encodeURIComponent(courseId)}/announcements`, {
      headers: bbHeaders,
      credentials: 'same-origin'
    });
    if (listRes.ok) {
      const listData = await listRes.json();
      if (listData && Array.isArray(listData.results)) {
        for (const item of listData.results) {
          if (!item.body) continue;
          const itemTitle = (item.title || '').toLowerCase().trim();
          const matchesId = announcementId && item.id === announcementId;
          const matchesSub = titleLower && (itemTitle.includes(titleLower) || titleLower.includes(itemTitle));
          const tokenMatch = cleanTokens.length > 0 && cleanTokens.filter((t: string) => itemTitle.includes(t)).length >= Math.min(2, cleanTokens.length);
          if (matchesId || matchesSub || tokenMatch) {
            const parsed = htmlBodyToText(item.body);
            if (parsed) return parsed;
          }
        }
      }
    }
  } catch {}

  return null;
}

/** Saves student profile identity extracted from Blackboard session, DOM, or exam page. */
export async function saveStudentProfileIfFound(info?: { studentName?: string; studentId?: string; studentEmail?: string; college?: string; major?: string } | null): Promise<void> {
  if (!info || (!info.studentName && !info.studentId)) return;
  const nameToUse = (info.studentName && !isGenericPlaceholderName(info.studentName)) ? info.studentName.trim() : undefined;
  try {
    const current = await getProfile();
    if (current) {
      const hasNewName = !!(nameToUse && (current.studentName !== nameToUse || isGenericPlaceholderName(current.studentName || '')));
      const hasNewId = !!(info.studentId && current.studentId !== info.studentId);
      const hasNewCollege = !!(info.college && current.college !== info.college);
      const hasNewMajor = !!(info.major && current.major !== info.major);
      const hasNewEmail = !!(info.studentEmail && current.studentEmail !== info.studentEmail);
      if (hasNewName || hasNewId || hasNewCollege || hasNewMajor || hasNewEmail) {
        await saveProfile({
          ...current,
          studentName: nameToUse || current.studentName,
          studentId: info.studentId || current.studentId,
          studentEmail: info.studentEmail || current.studentEmail,
          college: info.college || current.college,
          major: info.major || current.major
        });
      }
    } else {
      const uniId = (await detectUniversityFromHost(window.location.hostname)) || 'other';
      await saveProfile({
        universityId: uniId,
        studentName: nameToUse,
        studentId: info.studentId,
        studentEmail: info.studentEmail,
        college: info.college,
        major: info.major
      });
    }
  } catch {}
}

/** Logs summary line in page console for tracing missed deadlines. */
export function logCourseAnnouncementRead(streamCount: number, courseCount: number, courseIds: string[], failedIds: string[]): void {
  if (courseIds.length === 0) return;
  console.info(
    `[Blackboarder] Scan read ${streamCount} stream announcements and ${courseCount} course announcements ` +
    `from ${courseIds.length - failedIds.length} of ${courseIds.length} courses` +
    (failedIds.length ? ` (${failedIds.length} refused: ${failedIds.join(', ')})` : '')
  );
}

function stableHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** Scrapes announcements from an open side panel / drawer / peek panel if visible. */
export function scrapeOpenDrawerAnnouncement(): Announcement | null {
  const drawer = document.querySelector('aside.bb-slideout, div[role="dialog"], div.bb-peek-panel, bb-drawer, .panel-content');
  if (!drawer) return null;

  const titleEl = drawer.querySelector('h1, h2, h3, [role="heading"], .panel-header-title');
  const bodyEl = drawer.querySelector('.panel-content, .panel-body, .announcement-body, .vtbegenerated, [bb-translate]') || drawer;
  const courseEl = document.querySelector('#courseMenuPalette_paletteTitleHeading, .course-title, header h1, .bb-course-title');

  const title = titleEl?.textContent?.trim() || '';
  const text = bodyEl?.textContent?.trim() || '';
  if (!title && text.length < 20) return null;

  const courseInfo = parseCourseDetails(courseEl?.textContent || (document.title !== 'Activity' ? document.title : ''));
  const cleanText = sanitizeDoctorAnnouncementText(text, courseInfo.name, courseInfo.code, title);

  return {
    id: `ann_drawer_${stableHash(`${courseInfo.code}|${title}|${cleanText.slice(0, 200)}`)}`,
    courseCode: courseInfo.code,
    courseName: courseInfo.name,
    title: title || 'Course Announcement',
    contentText: cleanText,
    contentHtml: bodyEl?.innerHTML || '',
    sourceUrl: window.location.href,
    scannedAt: new Date().toISOString()
  };
}

/** Extracts a rough ISO date string from free text if present. */
export function extractDateStringFromText(text: string): string | undefined {
  if (!text) return undefined;
  const dateMatch = text.match(/\b(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})\b/) ||
    text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?\b/i);
  if (dateMatch) {
    const d = new Date(dateMatch[0]);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}
