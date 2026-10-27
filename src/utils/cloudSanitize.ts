import type { DeadlineTask, QuickLink, UserCourseConfig } from '../types';

/**
 * Cloud data is only protected by the sync key, so everything read back from it is untrusted.
 * These helpers drop or repair records that could crash a renderer or be used as an HTML/CSS
 * injection payload once interpolated into the UI.
 */

// Ids are always HTML-escaped where they are rendered, so only characters that could break out
// of markup or a stored key are refused. Arabic letters, brackets and apostrophes are allowed:
// stream task ids are built from titles such as "واجب (10 درجات)" or "Newton's 2nd Law".
const SAFE_ID = /^[^\u0000-\u001f\u007f<>"`\\]{1,200}$/;
const SAFE_HEX = /^#[0-9a-f]{3,8}$/i;
const TASK_TYPES = ['quiz', 'assignment', 'exam', 'project', 'lab', 'meeting', 'other'];
const PRIORITIES = ['high', 'medium', 'low'];
const STATUSES = ['pending', 'completed', 'dismissed'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const optNum = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Firebase refuses object keys containing . $ # [ ] / (and a key cannot be empty). Deletion
 * records are keyed by task id, and ids come from titles ("HW1_Phys.1"), so the keys are encoded
 * on the way to Firebase and decoded on the way back. "%" is encoded too so it round-trips.
 */
export function encodeCloudKey(key: string): string {
  const k = String(key).replace(/[%.$#\[\]/]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  return k === '' ? '%00' : k;
}

export function decodeCloudKey(key: string): string {
  if (key === '%00') return '';
  return String(key).replace(/%(25|2E|24|23|5B|5D|2F)/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export function encodeCloudKeys<T>(map: Record<string, T> | undefined | null): Record<string, T> | undefined {
  if (!map || typeof map !== 'object') return undefined;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(map)) out[encodeCloudKey(k)] = v;
  return out;
}

export function decodeCloudKeys<T>(map: Record<string, T> | undefined | null): Record<string, T> | undefined {
  if (!map || typeof map !== 'object') return undefined;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(map)) out[decodeCloudKey(k)] = v;
  return out;
}

export function isSafeCloudId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID.test(id);
}

export function safeHexColor(value: unknown, fallback = '#2563eb'): string {
  return typeof value === 'string' && SAFE_HEX.test(value) ? value : fallback;
}

export function sanitizeCloudTasks(tasks: unknown): DeadlineTask[] {
  if (!Array.isArray(tasks)) return [];
  const out: DeadlineTask[] = [];
  for (const raw of tasks) {
    if (!raw || typeof raw !== 'object' || !isSafeCloudId((raw as any).id)) continue;
    const t = raw as any;
    // A task without a usable due date would break sorting, calendars and ICS export
    if (isNaN(new Date(t.dueDate).getTime())) continue;

    const clean: any = {
      ...t,
      id: t.id,
      title: str(t.title),
      courseCode: str(t.courseCode),
      courseName: str(t.courseName),
      description: str(t.description),
      sourceSnippet: str(t.sourceSnippet),
      dueDate: t.dueDate,
      hasSpecificTime: Boolean(t.hasSpecificTime),
      type: TASK_TYPES.includes(t.type) ? t.type : 'other',
      priority: PRIORITIES.includes(t.priority) ? t.priority : 'medium',
      status: STATUSES.includes(t.status) ? t.status : 'pending'
    };
    // Numeric fields are interpolated into markup; coerce or drop them
    for (const key of ['weight', 'score', 'maxScore', 'confidence']) {
      const n = optNum(t[key]);
      if (n === undefined) delete clean[key];
      else clean[key] = n;
    }
    // Student notes are only the student's; a task they never made or edited has none
    if (clean.notes && !clean.userEdited && clean.extractedBy !== 'manual') delete clean.notes;
    out.push(clean as DeadlineTask);
  }
  return out;
}

export function sanitizeCloudQuickLinks(links: unknown): QuickLink[] | undefined {
  if (!Array.isArray(links)) return undefined;
  return links.filter(
    (l): l is QuickLink => Boolean(l) && typeof l === 'object' && isSafeCloudId((l as any).id) && typeof (l as any).url === 'string'
  ).map(l => ({ ...l, title: str(l.title), url: l.url }));
}

export function sanitizeCloudCourses(courses: unknown): UserCourseConfig[] | undefined {
  if (!Array.isArray(courses)) return undefined;
  const out: UserCourseConfig[] = [];
  for (const raw of courses) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as any;
    // Courses with a missing or unsafe id are repaired rather than dropped
    const fallbackId = `course_${str(c.courseCode || c.courseName).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) || 'unnamed'}`;
    const id = isSafeCloudId(c.id) ? c.id : fallbackId;
    out.push({
      ...c,
      id,
      courseCode: str(c.courseCode),
      courseName: str(c.courseName),
      crn: typeof c.crn === 'string' ? c.crn : undefined,
      creditHours: optNum(c.creditHours),
      colorHex: safeHexColor(c.colorHex),
      aliases: Array.isArray(c.aliases) ? c.aliases.filter((a: unknown) => typeof a === 'string') : [],
      scheduleSlots: (Array.isArray(c.scheduleSlots) ? c.scheduleSlots : [])
        .filter((s: any) => s && typeof s === 'object')
        .map((s: any) => ({
          ...s,
          days: (Array.isArray(s.days) ? s.days : []).filter((d: unknown) => typeof d === 'string' && WEEKDAYS.includes(d.toLowerCase())),
          startTime: str(s.startTime) || '00:00',
          endTime: str(s.endTime) || '00:00',
          room: str(s.room)
        })),
      syllabus: (Array.isArray(c.syllabus) ? c.syllabus : [])
        .filter((s: any) => s && typeof s === 'object')
        .map((s: any, idx: number) => ({
          ...s,
          id: typeof s.id === 'string' && s.id ? s.id : `${id}_comp_${idx + 1}`,
          name: str(s.name),
          type: TASK_TYPES.includes(s.type) ? s.type : 'other',
          totalWeight: optNum(s.totalWeight) ?? 0,
          count: optNum(s.count),
          outOf: optNum(s.outOf),
          unitWeight: optNum(s.unitWeight)
        }))
    });
  }
  return out;
}
