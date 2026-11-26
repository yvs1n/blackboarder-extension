import type { DeadlineTask, QuickLink, UserCourseConfig, PaymentItem } from '../../types';
import { sanitizePayments } from '../../core/payments';

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

/**
 * Prunes tombstones older than maxAgeDays (defaults to 90 days / 1 semester) to prevent infinite payload growth.
 */
export function pruneExpiredTombstones(
  tombstones: Record<string, string> | undefined | null,
  maxAgeDays = 90,
  now = Date.now()
): Record<string, string> {
  if (!tombstones || typeof tombstones !== 'object') return {};
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const out: Record<string, string> = {};
  for (const [id, dateStr] of Object.entries(tombstones)) {
    const t = new Date(dateStr).getTime();
    if (!isNaN(t) && now - t < maxAgeMs) {
      out[id] = dateStr;
    }
  }
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
    const isGradebookTask = Boolean(
      t.sourceSnippet === 'gradebook' ||
      t.gradeSourceId ||
      t.submissionStatus === 'graded' ||
      t.isBonus ||
      (typeof t.id === 'string' && (t.id.startsWith('gbcol_') || t.id.startsWith('task_bonus_')))
    );
    const hasValidDate = !isNaN(new Date(t.dueDate).getTime());
    if (!hasValidDate) {
      const isEmptyDueDate = t.dueDate === '' || t.dueDate === undefined || t.dueDate === null;
      if (!isGradebookTask || !isEmptyDueDate) {
        continue;
      }
    }

    const clean: any = {
      ...t,
      id: t.id,
      ...(typeof t.announcementPostedAt === 'string' && !isNaN(new Date(t.announcementPostedAt).getTime())
        ? { announcementPostedAt: t.announcementPostedAt }
        : {}),
      title: str(t.title),
      courseCode: str(t.courseCode),
      courseName: str(t.courseName),
      description: str(t.description),
      sourceSnippet: str(t.sourceSnippet),
      dueDate: hasValidDate ? str(t.dueDate) : '',
      ...(typeof t.columnDueDate === 'string' && !isNaN(new Date(t.columnDueDate).getTime()) ? { columnDueDate: t.columnDueDate } : {}),
      ...(typeof t.columnCreated === 'string' && !isNaN(new Date(t.columnCreated).getTime()) ? { columnCreated: t.columnCreated } : {}),
      ...(typeof t.columnPosition === 'number' && Number.isFinite(t.columnPosition) ? { columnPosition: t.columnPosition } : {}),
      hasSpecificTime: Boolean(t.hasSpecificTime),
      ...(t.timeSource === 'explicit' || t.timeSource === 'schedule' || t.timeSource === 'default' ? { timeSource: t.timeSource } : {}),
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
    if (t.summary && typeof t.summary === 'object') {
      const cleanSummary: { topics?: string; formatRules?: string; brief?: string } = {};
      if (typeof t.summary.topics === 'string' && t.summary.topics.trim()) cleanSummary.topics = t.summary.topics.trim().slice(0, 260);
      if (typeof t.summary.formatRules === 'string' && t.summary.formatRules.trim()) cleanSummary.formatRules = t.summary.formatRules.trim().slice(0, 260);
      if (typeof t.summary.brief === 'string' && t.summary.brief.trim()) cleanSummary.brief = t.summary.brief.trim().slice(0, 360);
      if (cleanSummary.topics || cleanSummary.formatRules || cleanSummary.brief) {
        clean.summary = cleanSummary;
      } else {
        delete clean.summary;
      }
    } else {
      delete clean.summary;
    }
    if (t.isBonus) {
      clean.isBonus = true;
      clean.bonusUnit = t.bonusUnit === 'percent' ? 'percent' : 'points';
      if (typeof t.bonusTarget === 'string' && t.bonusTarget.trim()) {
        clean.bonusTarget = t.bonusTarget.trim().slice(0, 120);
      } else {
        delete clean.bonusTarget;
      }
      if (typeof t.bonusTargetLabel === 'string' && t.bonusTargetLabel.trim()) {
        clean.bonusTargetLabel = t.bonusTargetLabel.trim().slice(0, 120);
      } else {
        delete clean.bonusTargetLabel;
      }
    } else {
      delete clean.isBonus;
      delete clean.bonusUnit;
      delete clean.bonusTarget;
      delete clean.bonusTargetLabel;
    }
    if (t.ignoreMark === true) clean.ignoreMark = true;
    else delete clean.ignoreMark;

    if (t.visibility === 'hidden') {
      clean.visibility = 'hidden';
      const validReasons = ['makeup_completed', 'extension_completed', 'quota_exhausted', 'review_session', 'manual_hide'];
      if (validReasons.includes(t.hiddenReason)) clean.hiddenReason = t.hiddenReason;
      else delete clean.hiddenReason;
      if (typeof t.hiddenReasonLabel === 'string' && t.hiddenReasonLabel.trim()) {
        clean.hiddenReasonLabel = t.hiddenReasonLabel.trim().slice(0, 140);
      } else {
        delete clean.hiddenReasonLabel;
      }
    } else {
      delete clean.visibility;
      delete clean.hiddenReason;
      delete clean.hiddenReasonLabel;
    }
    if (t.visibilityLocked === 'active' || t.visibilityLocked === 'hidden') {
      clean.visibilityLocked = t.visibilityLocked;
    } else {
      delete clean.visibilityLocked;
    }
    if (t.ar && typeof t.ar === 'object' && typeof t.ar.title === 'string' && t.ar.title.trim()) {
      const arRaw = t.ar;
      clean.ar = {
        title: String(arRaw.title).trim().slice(0, 240),
        ...(typeof arRaw.courseName === 'string' && arRaw.courseName.trim() ? { courseName: arRaw.courseName.trim().slice(0, 140) } : {}),
        ...(typeof arRaw.description === 'string' && arRaw.description.trim() ? { description: arRaw.description.trim().slice(0, 6000) } : {}),
        ...(typeof arRaw.sourceSnippet === 'string' && arRaw.sourceSnippet.trim() ? { sourceSnippet: arRaw.sourceSnippet.trim().slice(0, 6000) } : {}),
        ...(typeof arRaw.brief === 'string' && arRaw.brief.trim() ? { brief: arRaw.brief.trim().slice(0, 400) } : {}),
        ...(typeof arRaw.topics === 'string' && arRaw.topics.trim() ? { topics: arRaw.topics.trim().slice(0, 300) } : {}),
        ...(typeof arRaw.formatRules === 'string' && arRaw.formatRules.trim() ? { formatRules: arRaw.formatRules.trim().slice(0, 300) } : {}),
        ...(typeof arRaw.weightDisplay === 'string' && arRaw.weightDisplay.trim() ? { weightDisplay: arRaw.weightDisplay.trim().slice(0, 140) } : {}),
        ...(typeof arRaw.syllabusNote === 'string' && arRaw.syllabusNote.trim() ? { syllabusNote: arRaw.syllabusNote.trim().slice(0, 260) } : {}),
        ...(typeof arRaw.room === 'string' && arRaw.room.trim() ? { room: arRaw.room.trim().slice(0, 80) } : {}),
        ...(typeof arRaw.hiddenReasonLabel === 'string' && arRaw.hiddenReasonLabel.trim() ? { hiddenReasonLabel: arRaw.hiddenReasonLabel.trim().slice(0, 160) } : {}),
        ...(arRaw.translatedBy === 'ai' || arRaw.translatedBy === 'local' || arRaw.translatedBy === 'source' ? { translatedBy: arRaw.translatedBy } : {}),
        ...(typeof arRaw.sourceSig === 'string' && arRaw.sourceSig ? { sourceSig: arRaw.sourceSig.slice(0, 32) } : {}),
        updatedAt: typeof arRaw.updatedAt === 'string' && arRaw.updatedAt ? arRaw.updatedAt.slice(0, 40) : clean.updatedAt
      };
    } else {
      delete clean.ar;
    }

    out.push(clean as DeadlineTask);
  }
  return out;
}

/**
 * A scan the phone asked the extension to run (`data.scanRequest`). The phone sets it to pending,
 * the extension marks it done or error. It is read back from the cloud, so only the known shape is kept.
 */
export interface CloudScanRequest {
  state: 'pending' | 'running' | 'done' | 'error';
  requestedAt: string;
  completedAt?: string;
  requestedBy?: string;
  message?: string;
}

const SCAN_STATES = ['pending', 'running', 'done', 'error'];
const isStamp = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !isNaN(Date.parse(v));

export function sanitizeScanRequest(raw: unknown): CloudScanRequest | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as any;
  if (!SCAN_STATES.includes(r.state) || !isStamp(r.requestedAt)) return undefined;
  const out: CloudScanRequest = { state: r.state, requestedAt: r.requestedAt };
  if (isStamp(r.completedAt)) out.completedAt = r.completedAt;
  if (typeof r.requestedBy === 'string' && r.requestedBy) out.requestedBy = r.requestedBy.slice(0, 40);
  if (typeof r.message === 'string' && r.message) out.message = r.message.slice(0, 300);
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
    const fallbackId = `course_${str(c.courseCode || c.code || c.courseName || c.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) || 'unnamed'}`;
    const id = isSafeCloudId(c.id) ? c.id : fallbackId;
    out.push({
      ...c,
      id,
      courseCode: str(c.courseCode || c.code),
      courseName: str(c.courseName || c.name),
      crn: typeof c.crn === 'string' ? c.crn : undefined,
      creditHours: optNum(c.creditHours),
      colorHex: safeHexColor(c.colorHex || c.color),
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

export function sanitizeCloudPayments(payments: unknown): PaymentItem[] | undefined {
  if (!Array.isArray(payments)) return undefined;
  return sanitizePayments(payments);
}
