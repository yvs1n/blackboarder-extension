import { Announcement, DeadlineTask, TaskSubmissionUpdate } from '../types';
import { parseCourseDetails, sanitizeDoctorAnnouncementText } from '../core/courseHelper';
import { parseUltraStreamEntries } from '../utils/streamParser';
import { gradebookToUpdates, gradebookReport, GradebookReportRow } from '../utils/gradebook';
import { isSessionExpiredResponse } from '../utils/sessionStatus';

/**
 * The Blackboard REST calls both scanners make. Each one takes the fetch to use: the service
 * worker sends absolute URLs on the university origin with credentials, the Blackboard tab uses
 * bbFetch (Rule 1). Every call says whether it worked instead of swallowing the failure, so a
 * scan that read nothing never reports "up to date".
 */

export type BbFetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface ApiFailure {
  ok: false;
  status?: number;
  error: string;
}

export type ApiResult<T> = ({ ok: true } & T) | ApiFailure;

export interface CourseMeta {
  name: string;
  code: string;
}

export type SessionState = 'ok' | 'expired' | 'unreachable';

/** What each part of the HTTP read did, for the scan message and the fallback decision. */
export interface ScanSourceOutcomes {
  session: SessionState;
  courses: { ok: boolean; count: number; status?: number; error?: string };
  stream: { ok: boolean; status?: number; error?: string };
  announcements: { ok: number; failed: number; failedCourseIds: string[] };
  gradebook: { ok: number; failed: number; failedCourseIds: string[] };
}

export const ULTRA_STREAM_PATH = '/learn/api/v1/streams/ultra';
export const ULTRA_STREAM_BODY = JSON.stringify({ providers: {}, forOverview: false, retrieveOnly: true, flushCache: false });
const MAX_EXTRA_PAGES = 10;

export function isOrientationOrSandboxCourse(name?: string, externalId?: string): boolean {
  const n = String(name || '');
  const ext = String(externalId || '');
  return /orientation|sandbox|mock[_\s-]*exam/i.test(ext) ||
    /orientation|توجيه|تهيئة/i.test(n);
}

export function extractCodeFromExternalId(externalId?: string): string {
  const s = String(externalId || '').trim();
  const m = s.match(/^(\d{4})\s*(\d{3})(?:[_\s-]|$)/) || s.match(/^([A-Za-z]{2,4}[-\s]?\d{3})(?:[_\s-]|$)/);
  if (!m) return '';
  return m[2] ? `${m[1]} ${m[2]}` : m[1].toUpperCase();
}

/** Announcement HTML to text without a DOM (the service worker has none, and the tab never parses Blackboard HTML into its page). */
export function stripHtmlToText(html: string): string {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Course name and code from Blackboard's name and external id (for example "1440133_21_2610"). */
export function courseMetaFromBlackboard(rawName: string, externalId?: string): CourseMeta {
  const name = String(rawName || '').trim();
  const extCode = extractCodeFromExternalId(externalId);
  const parsed = parseCourseDetails(`${extCode} ${name}`.trim());
  return {
    name: parsed.name !== 'General Course' ? parsed.name : name,
    code: extCode || (parsed.code !== 'UOS' ? parsed.code : '')
  };
}

const failure = (error: string, status?: number): ApiFailure => (status === undefined ? { ok: false, error } : { ok: false, status, error });

/** One JSON request. A refused request, a sign-in page instead of JSON, or a network error is a failure. */
export async function readJson(fetchFn: BbFetch, path: string, init?: RequestInit): Promise<ApiResult<{ data: any }>> {
  let res: Response;
  try {
    res = await fetchFn(path, init);
  } catch (err) {
    return failure(`network: ${String((err as any)?.message || err)}`);
  }
  if (!res.ok) return failure(`HTTP ${res.status}`, res.status);
  const type = (res.headers?.get('content-type') || '').toLowerCase();
  if (type && !type.includes('json')) return failure('not JSON', res.status);
  try {
    return { ok: true, data: await res.json() };
  } catch {
    return failure('not JSON', res.status);
  }
}

/** Every page of a list (Blackboard pages long lists through paging.nextPage). Only a refused first page is a failure. */
export async function fetchAllPages(fetchFn: BbFetch, path: string, maxExtraPages: number = MAX_EXTRA_PAGES): Promise<ApiResult<{ results: any[] }>> {
  const first = await readJson(fetchFn, path);
  if (!first.ok) return first;
  if (!Array.isArray(first.data?.results)) return failure('no results list');
  const results = [...first.data.results];
  let next: string | undefined = first.data?.paging?.nextPage;
  for (let page = 0; next && page < maxExtraPages; page++) {
    const more = await readJson(fetchFn, next);
    if (!more.ok || !Array.isArray(more.data?.results)) break;
    results.push(...more.data.results);
    next = more.data?.paging?.nextPage;
  }
  return { ok: true, results };
}

/** users/me: ok with the user id, expired (signed out), or unreachable (network error or an answer that is neither). */
export async function fetchSession(fetchFn: BbFetch): Promise<{ state: SessionState; userId: string; status?: number; error?: string }> {
  let res: Response;
  try {
    res = await fetchFn('/learn/api/v1/users/me');
  } catch (err) {
    return { state: 'unreachable', userId: '', error: `network: ${String((err as any)?.message || err)}` };
  }
  if (isSessionExpiredResponse(res.status, res.headers?.get('content-type') ?? null)) {
    return { state: 'expired', userId: '', status: res.status };
  }
  if (!res.ok) return { state: 'unreachable', userId: '', status: res.status, error: `HTTP ${res.status}` };
  try {
    const id = (await res.json())?.id;
    if (typeof id === 'string' && id) return { state: 'ok', userId: id, status: res.status };
  } catch {}
  return { state: 'unreachable', userId: '', status: res.status, error: 'no user id' };
}

/** The courses the student is enrolled in, every page of them. Orientation and sandbox courses are left out. */
export async function fetchEnrolledCourses(fetchFn: BbFetch): Promise<ApiResult<{ courses: Map<string, CourseMeta>; skipped: Set<string> }>> {
  const list = await fetchAllPages(fetchFn, '/learn/api/public/v1/users/me/courses?expand=course');
  if (!list.ok) return list;
  const courses = new Map<string, CourseMeta>();
  const skipped = new Set<string>();
  for (const item of list.results) {
    const cid = item?.courseId;
    if (typeof cid !== 'string' || !cid.startsWith('_')) continue;
    const rawName = typeof item.course?.name === 'string' ? item.course.name.trim() : '';
    const extId = String(item.course?.courseId || item.course?.externalId || '');
    if (isOrientationOrSandboxCourse(rawName, extId)) {
      skipped.add(cid);
      courses.delete(cid);
      continue;
    }
    courses.set(cid, courseMetaFromBlackboard(rawName, extId));
  }
  return { ok: true, courses, skipped };
}

/** One course's announcements with their full bodies: the public API first, then the internal one Ultra uses (the public one can refuse students). */
export async function fetchCourseAnnouncements(
  fetchFn: BbFetch,
  courseId: string,
  meta: CourseMeta | undefined,
  origin: string
): Promise<ApiResult<{ announcements: Announcement[] }>> {
  if (isOrientationOrSandboxCourse(meta?.name, meta?.code)) {
    return { ok: true, announcements: [] };
  }
  let last: ApiFailure = failure('not read');
  for (const base of ['/learn/api/public/v1', '/learn/api/v1']) {
    const res = await readJson(fetchFn, `${base}/courses/${encodeURIComponent(courseId)}/announcements`);
    if (!res.ok) {
      last = res;
      continue;
    }
    if (!Array.isArray(res.data?.results)) {
      last = failure('no results list');
      continue;
    }
    const code = meta?.code && meta.code !== 'UOS' ? meta.code : '';
    const name = meta?.name && meta.name.toLowerCase() !== 'uos' ? meta.name : 'General Course';
    const scannedAt = new Date().toISOString();
    const announcements = res.data.results.map((item: any, idx: number): Announcement => {
      // Public API: body is an HTML string. Internal API: { displayText, rawText }.
      const bodyHtml = typeof item?.body === 'string' ? item.body : (item?.body?.displayText || item?.body?.rawText || '');
      const text = sanitizeDoctorAnnouncementText(stripHtmlToText(bodyHtml), name, code, item?.title);
      return {
        id: `ann_api_${item?.id || idx}`,
        courseCode: code,
        courseName: name,
        title: item?.title || `Announcement ${idx + 1}`,
        postedAt: item?.created || scannedAt,
        contentText: text,
        contentHtml: bodyHtml,
        sourceUrl: `${origin.replace(/\/+$/, '')}/ultra/courses/${courseId}/outline`,
        scannedAt
      };
    }).filter((a: Announcement) => a.contentText && a.contentText.length > 5);
    return { ok: true, announcements };
  }
  return last;
}

/** Adds the course names the stream response carries for ids the enrolment list did not give. */
function addStreamCourses(payload: any, courses: Map<string, CourseMeta>): Map<string, CourseMeta> {
  const extra = payload?.sv_extras?.sx_courses;
  if (!Array.isArray(extra)) return courses;
  const out = new Map(courses);
  for (const c of extra) {
    const cid = c?.id;
    if (typeof cid !== 'string' || !cid.startsWith('_') || out.has(cid)) continue;
    const name = typeof c.name === 'string' ? c.name : '';
    if (!name || isOrientationOrSandboxCourse(name, c.courseId)) continue;
    out.set(cid, courseMetaFromBlackboard(name, c.courseId));
  }
  return out;
}

/** The Ultra activity stream: due dates, announcements, submissions and grade cards. */
export async function fetchUltraStream(
  fetchFn: BbFetch,
  courses: Map<string, CourseMeta>,
  origin: string
): Promise<ApiResult<{ directTasks: DeadlineTask[]; announcements: Announcement[]; submissionUpdates: TaskSubmissionUpdate[] }>> {
  const res = await readJson(fetchFn, ULTRA_STREAM_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ULTRA_STREAM_BODY
  });
  if (!res.ok) return res;
  return { ok: true, ...parseUltraStreamEntries(res.data, addStreamCourses(res.data, courses), origin) };
}

/**
 * Reads the student's marks from one course gradebook, the same requests Ultra's Grades page
 * makes: columns (names, max points) and the student's grades.
 */
export async function fetchCourseGradebook(
  fetchFn: BbFetch,
  courseId: string,
  userId: string,
  meta: CourseMeta | undefined,
  skippedGrades: string[]
): Promise<ApiResult<{ updates: TaskSubmissionUpdate[]; report: GradebookReportRow[] }>> {
  if (isOrientationOrSandboxCourse(meta?.name, meta?.code)) {
    return { ok: true, updates: [], report: [] };
  }
  const cid = encodeURIComponent(courseId);
  const [cols, grades] = await Promise.all([
    fetchAllPages(fetchFn, `/learn/api/v1/courses/${cid}/gradebook/columns?includeInvisible=false&limit=200`),
    fetchAllPages(fetchFn, `/learn/api/v1/courses/${cid}/gradebook/grades?limit=200&userId=${encodeURIComponent(userId)}`)
  ]);
  const label = meta?.name || courseId;
  if (!cols.ok || !grades.ok) {
    const bad = !cols.ok ? cols : (grades as ApiFailure);
    return { ...bad, error: `gradebook not readable (${bad.error})` };
  }
  const updates = gradebookToUpdates(cols.results, grades.results, {
    courseName: meta?.name && meta.name !== 'General Course' ? meta.name : undefined,
    courseCode: meta?.code || ''
  }, skippedGrades);
  return { ok: true, updates, report: gradebookReport(cols.results, grades.results, label) };
}

/**
 * The courses to read: the enrolment list, plus course ids the page links to (their link text
 * names a course the list did not name). Orientation and sandbox courses are left out.
 */
export function mergeCourseMaps(
  enrolled: ApiResult<{ courses: Map<string, CourseMeta>; skipped: Set<string> }> | null,
  pageCourses?: Map<string, CourseMeta>,
  pageSkipped?: Set<string>
): Map<string, CourseMeta> {
  const courses = new Map<string, CourseMeta>();
  const skipped = new Set<string>(pageSkipped || []);
  if (enrolled?.ok) {
    enrolled.courses.forEach((meta, cid) => {
      if (isOrientationOrSandboxCourse(meta.name, meta.code)) {
        skipped.add(cid);
        return;
      }
      courses.set(cid, meta);
    });
    enrolled.skipped.forEach(cid => skipped.add(cid));
  }
  pageCourses?.forEach((meta, cid) => {
    if (isOrientationOrSandboxCourse(meta.name, meta.code)) {
      skipped.add(cid);
      return;
    }
    const known = courses.get(cid);
    if (!known) courses.set(cid, meta);
    else if (!known.name && meta.name) courses.set(cid, { name: meta.name, code: known.code || meta.code });
  });
  skipped.forEach(cid => courses.delete(cid));
  return courses;
}

export interface BlackboardApiRead {
  userId: string;
  sources: ScanSourceOutcomes;
  /** Course id to name and code: the enrolment list, then names found on the page. */
  courses: Map<string, CourseMeta>;
  courseIds: string[];
  stream: { directTasks: DeadlineTask[]; announcements: Announcement[]; submissionUpdates: TaskSubmissionUpdate[] };
  courseAnnouncements: Announcement[];
  gradebookUpdates: TaskSubmissionUpdate[];
  gradebookReport: GradebookReportRow[];
  skippedGrades: string[];
}

export interface ReadBlackboardOptions {
  origin: string;
  /** Course ids and names found on the page (tab scanner only). Enrolment names win. */
  pageCourses?: Map<string, CourseMeta>;
  /** Course ids the page showed as orientation or sandbox courses. */
  pageSkipped?: Set<string>;
  /** An enrolment read already started by the caller, so it is not made twice. */
  enrolled?: Promise<ApiResult<{ courses: Map<string, CourseMeta>; skipped: Set<string> }>>;
}

/**
 * Reads everything the scan needs over HTTP: the session, the course list, the stream, each
 * course's announcements and gradebook. Signed out or unreachable stops after users/me.
 */
export async function readBlackboardApi(fetchFn: BbFetch, options: ReadBlackboardOptions): Promise<BlackboardApiRead> {
  const sources: ScanSourceOutcomes = {
    session: 'unreachable',
    courses: { ok: false, count: 0, error: 'not read' },
    stream: { ok: false, error: 'not read' },
    announcements: { ok: 0, failed: 0, failedCourseIds: [] },
    gradebook: { ok: 0, failed: 0, failedCourseIds: [] }
  };
  const empty: BlackboardApiRead = {
    userId: '',
    sources,
    courses: new Map(),
    courseIds: [],
    stream: { directTasks: [], announcements: [], submissionUpdates: [] },
    courseAnnouncements: [],
    gradebookUpdates: [],
    gradebookReport: [],
    skippedGrades: []
  };

  const session = await fetchSession(fetchFn);
  sources.session = session.state;
  if (session.state !== 'ok') return empty;

  const enrolled = await (options.enrolled || fetchEnrolledCourses(fetchFn)).catch(err => failure(String(err)));
  sources.courses = enrolled.ok
    ? { ok: true, count: enrolled.courses.size }
    : { ok: false, count: 0, status: enrolled.status, error: enrolled.error };
  const courses = mergeCourseMaps(enrolled, options.pageCourses, options.pageSkipped);
  const courseIds = Array.from(courses.keys());

  const skippedGrades: string[] = [];
  const [stream, annLists, gradebooks] = await Promise.all([
    fetchUltraStream(fetchFn, courses, options.origin),
    Promise.all(courseIds.map(cid => fetchCourseAnnouncements(fetchFn, cid, courses.get(cid), options.origin))),
    Promise.all(courseIds.map(cid => {
      const meta = courses.get(cid);
      if (isOrientationOrSandboxCourse(meta?.name)) return Promise.resolve(null);
      return fetchCourseGradebook(fetchFn, cid, session.userId, meta, skippedGrades);
    }))
  ]);

  sources.stream = stream.ok ? { ok: true } : { ok: false, status: stream.status, error: stream.error };
  const courseAnnouncements: Announcement[] = [];
  annLists.forEach((r, i) => {
    if (r.ok) {
      sources.announcements.ok++;
      courseAnnouncements.push(...r.announcements);
    } else {
      sources.announcements.failed++;
      sources.announcements.failedCourseIds.push(courseIds[i]);
    }
  });
  const gradebookUpdates: TaskSubmissionUpdate[] = [];
  const report: GradebookReportRow[] = [];
  gradebooks.forEach((r, i) => {
    if (!r) return;
    if (r.ok) {
      sources.gradebook.ok++;
      gradebookUpdates.push(...r.updates);
      report.push(...r.report);
    } else {
      sources.gradebook.failed++;
      sources.gradebook.failedCourseIds.push(courseIds[i]);
      report.push({ course: courses.get(courseIds[i])?.name || courseIds[i], column: '', note: 'gradebook not readable' });
    }
  });

  return {
    userId: session.userId,
    sources,
    courses,
    courseIds,
    stream: stream.ok
      ? { directTasks: stream.directTasks, announcements: stream.announcements, submissionUpdates: stream.submissionUpdates }
      : empty.stream,
    courseAnnouncements,
    gradebookUpdates,
    gradebookReport: report,
    skippedGrades
  };
}
