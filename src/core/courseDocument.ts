/**
 * The built-in reader for a syllabus or class schedule a student uploads or pastes. It finds each
 * course's code and name, credit hours, instructor, weekly meeting times and rooms, and the
 * assessment weights, for any university: course codes like "CSC 201" or UOS's "1502101",
 * times in 12 or 24 hours, days as words, short names or Banner letters (MW, TR), English and Arabic.
 * The student reviews what was found before anything is saved.
 */
import type { CustomScheduleSlot, CustomSyllabusComponent, UserCourseConfig, Weekday } from '../types';
import { parseBannerScheduleText, makeSyllabusComponent, mergeImportedCourses } from './courseImporter';

export interface CourseDraft {
  courseCode: string;
  courseName: string;
  crn?: string;
  creditHours?: number;
  instructor?: string;
  scheduleSlots: CustomScheduleSlot[];
  syllabus: CustomSyllabusComponent[];
}

export interface DocumentAnalysis {
  /** A timetable of several courses, one course's syllabus, or nothing found */
  kind: 'schedule' | 'syllabus' | 'none';
  courses: CourseDraft[];
}

const WEEK: Weekday[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DAY_WORDS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  tues: 2, thur: 4, thurs: 4,
  'الأحد': 0, 'الاحد': 0, 'الإثنين': 1, 'الاثنين': 1, 'الثلاثاء': 2, 'الأربعاء': 3, 'الاربعاء': 3, 'الخميس': 4, 'الجمعة': 5, 'السبت': 6
};
const DAY_SHORT: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const BANNER_LETTERS: Record<string, number> = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };

/** Western digits, plain dashes and colons, so one set of patterns reads every document. */
export function normalizeDocumentText(text: string): string {
  return String(text || '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[‐-―−]/g, '-')
    .replace(/：/g, ':')
    .replace(/\r\n?/g, '\n');
}

/** Weekdays named in a piece of text, in week order. */
export function daysInText(text: string): Weekday[] {
  const found = new Set<number>();
  const labelled = /\bdays?\s*:/i.test(text);
  // A table cell holding only Banner letters ("F", "MW") is a day column
  for (const cell of String(text || '').split('\t')) {
    if (/^[UMTWRFS]{1,5}$/.test(cell.trim())) for (const ch of cell.trim()) found.add(BANNER_LETTERS[ch]);
  }
  for (const token of String(text || '').split(/[^A-Za-z؀-ۿ]+/)) {
    if (!token) continue;
    const lower = token.toLowerCase();
    if (lower in DAY_WORDS) { found.add(DAY_WORDS[lower]); continue; }
    // Arabic joins "and" to the next word: والثلاثاء
    if (token.startsWith('و') && token.slice(1) in DAY_WORDS) { found.add(DAY_WORDS[token.slice(1)]); continue; }
    // "Sun", "Tue": short names only when written with a capital, so "sat" in a sentence is not Saturday
    if (lower in DAY_SHORT && /^[A-Z]/.test(token)) { found.add(DAY_SHORT[lower]); continue; }
    if (/^Th$/.test(token)) { found.add(4); continue; }
    // Banner letters: MW, TR, MWF; a single letter only after "Days:"
    if (/^[UMTWRFS]{2,5}$/.test(token) || (labelled && /^[UMTWRFS]$/.test(token))) {
      for (const ch of token) found.add(BANNER_LETTERS[ch]);
      continue;
    }
    if (/^(?:M|T|W|Th|F|S|Su)+$/.test(token) && /Th/.test(token) && token.length <= 6) {
      for (const part of token.match(/Th|Su|M|T|W|F|S/g) || []) {
        found.add(part === 'Th' ? 4 : part === 'Su' ? 0 : BANNER_LETTERS[part]);
      }
    }
  }
  return [...found].sort((a, b) => a - b).map(i => WEEK[i]);
}

const TIME_RANGE = /(?<![\d:.])(\d{1,2})(?:([:.])(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|to|until|till)\s*(\d{1,2})(?:([:.])(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![\d%])/i;

const pad = (n: number) => String(n).padStart(2, '0');

/** A class time range in a line ("11:00 - 12:15", "2-3:15 PM", "9.30 to 10.45"), as 24-hour times. */
export function timeRangeIn(text: string): { start: string; end: string; index: number; length: number } | null {
  const re = new RegExp(TIME_RANGE.source, 'gi');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const [, h1s, sep1, m1s, ap1raw, h2s, sep2, m2s, ap2raw] = m;
    const hasMinutes = Boolean(m1s || m2s);
    const ap1 = ap1raw ? ap1raw[0].toLowerCase() : '';
    const ap2 = ap2raw ? ap2raw[0].toLowerCase() : '';
    if (!hasMinutes && !ap1 && !ap2) continue;
    // "10.11 - 12.11" is two dates; a dot only counts with both minutes and a sensible length
    if ((sep1 === '.' || sep2 === '.') && (!(m1s && m2s) || (+m1s >= 1 && +m1s <= 12 && +m2s >= 1 && +m2s <= 12))) continue;
    let h1 = +h1s; const mm1 = m1s ? +m1s : 0;
    let h2 = +h2s; const mm2 = m2s ? +m2s : 0;
    if (h1 > 23 || h2 > 23 || mm1 > 59 || mm2 > 59) continue;
    const to24 = (h: number, ap: string) => (ap === 'p' && h < 12 ? h + 12 : ap === 'a' && h === 12 ? 0 : h);
    if (ap2) h2 = to24(h2, ap2);
    if (ap1) h1 = to24(h1, ap1);
    else if (ap2) {
      const withEnd = to24(h1, ap2);
      h1 = withEnd * 60 + mm1 < h2 * 60 + mm2 ? withEnd : h1;
    } else if (h1 >= 1 && h1 <= 7) {
      // No am or pm: classes do not start at 1 to 7 in the morning
      h1 += 12;
    }
    if (!ap2 && h2 * 60 + mm2 <= h1 * 60 + mm1 && h2 < 12) h2 += 12;
    const length = h2 * 60 + mm2 - (h1 * 60 + mm1);
    if (length < 20 || length > 300) continue;
    return { start: `${pad(h1)}:${pad(mm1)}`, end: `${pad(h2)}:${pad(mm2)}`, index: m.index, length: m[0].length };
  }
  return null;
}

const ROOM_LABEL = /(?:\broom|\brm\.?|\bclass\s*room|\bvenue|\blecture\s+hall|\bhall|\blocation|\bbldg\.?|\bbuilding|القاعة|قاعة)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Za-z]{0,6}\s?-?\s?\d{1,4}[A-Za-z]?(?:\s?[-/]\s?[A-Za-z]{0,3}\d{1,4}[A-Za-z]?)?)/i;
const ROOM_SHAPE = /\b([A-Z]\d{1,2}\s?-\s?(?:TH|L)?\d{2,4}[A-Z]?)\b/;

/** A room in a line: labelled ("Room: 2106", "Hall B12-205") or shaped like a UOS room ("A8-103"). */
export function roomIn(text: string): string {
  const labelled = String(text || '').match(ROOM_LABEL);
  if (labelled && /\d/.test(labelled[1])) return labelled[1].replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  const shaped = String(text || '').match(ROOM_SHAPE);
  if (shaped) return shaped[1].replace(/\s+/g, '');
  const central = String(text || '').match(/\bCentral\s*Lab[^\n,;|\t]{0,30}/i);
  return central ? central[0].trim() : '';
}

const CODE_STOP = new Set([
  'ISBN', 'ROOM', 'RM', 'PAGE', 'PAGES', 'PP', 'CHAPTER', 'CH', 'SEC', 'SECTION', 'TEL', 'FAX', 'PO', 'BOX', 'UTC', 'GMT',
  'AM', 'PM', 'WEEK', 'WK', 'LAB', 'HALL', 'EXT', 'NO', 'ID', 'CRN', 'CLO', 'CLOS', 'PLO', 'SO', 'ABET', 'UNIT', 'TERM', 'FALL',
  'SPRING', 'SUMMER', 'WINTER', 'YEAR', 'VOL', 'ED', 'FIG', 'TABLE', 'BLDG', 'ISO', 'IEEE', 'DOI', 'MON', 'TUE', 'WED', 'THU',
  'FRI', 'SAT', 'SUN', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'SEPT', 'OCT', 'NOV', 'DEC', 'TOTAL', 'MW', 'TR', 'MWF'
]);

/** Course codes in a line, as "CSC 201" (letters, a space, the number) or UOS's seven digits. */
export function courseCodesIn(text: string, allowDigits = false): { code: string; index: number; length: number }[] {
  const out: { code: string; index: number; length: number }[] = [];
  const re = /\b([A-Z]{2,5})[ -]?(\d{3,4}[A-Z]?)\b/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (CODE_STOP.has(m[1])) continue;
    out.push({ code: `${m[1]} ${m[2]}`, index: m.index, length: m[0].length });
  }
  if (allowDigits) {
    const digits = /\b(\d{4})\s?(\d{3})\b/g;
    for (let m = digits.exec(text); m; m = digits.exec(text)) {
      // Years (2026 101) are not courses
      if (/^(19|20)\d\d$/.test(m[1]) && m[0].includes(' ')) continue;
      out.push({ code: `${m[1]}${m[2]}`, index: m.index, length: m[0].length });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function normalizeCode(code: string): string {
  return String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The course name written after its code ("CSC 201 - 01 Data Structures MW 9:30"). */
function nameAfterCode(line: string, codeEnd: number): string {
  let rest = line.slice(codeEnd);
  const time = timeRangeIn(rest);
  if (time) rest = rest.slice(0, time.index);
  rest = rest.split('\t').find(cell => /[A-Za-z؀-ۿ]{3}/.test(cell)) || '';
  rest = rest
    .replace(/^[\s\-:|,.]*(?:(?:sec(?:tion)?|lec(?:ture)?|lab|grp|group)\.?\s*)?\d{0,3}[A-Z]?(?=[\s\-:|,.]|$)[\s\-:|,.]*/i, '')
    .replace(/\s+\b(?:[UMTWRFS]{2,5}|(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*)\b.*$/, '')
    .replace(/\s+(?:room|rm\.?|hall|location|venue|bldg\.?|building)\b.*$/i, '')
    .replace(/\s*\(?\d(?:\.\d)?\s*(?:credit\s*hours?|credits?|cr\.?|ch)\)?.*$/i, '')
    .replace(/\b(?:course\s+)?(?:syllabus|outline|specification)\b.*$/i, '')
    .replace(/[\s\-:|,.]+$/, '')
    .trim();
  return rest.length >= 3 && rest.length <= 90 ? rest : '';
}

const NOT_A_CLASS = /\b(?:office|exam|midterm|final|quiz|due|deadline|submission|consult|appointment|presentation|defen[cs]e)\b|مكتب|امتحان/i;

function addSlot(slots: CustomScheduleSlot[], slot: CustomScheduleSlot) {
  // Same time and room on another day joins that slot ("Sun 11:00" and "Tue 11:00" become Sun/Tue)
  const same = slots.find(s => s.startTime === slot.startTime && s.endTime === slot.endTime && (s.room || '') === (slot.room || ''));
  if (same) {
    for (const d of slot.days) if (!same.days.includes(d)) same.days.push(d);
    same.days.sort((a, b) => WEEK.indexOf(a as Weekday) - WEEK.indexOf(b as Weekday));
    if (!same.instructor && slot.instructor) same.instructor = slot.instructor;
    return;
  }
  slots.push(slot);
}

function roomAfterTime(rest: string): string {
  const m = rest.match(/^[\s,|\t-]*(?:(?:[UMTWRFS]{1,5}|(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*)\b[\s,/|\t-]*)*([A-Z]{1,6}[ -]?\d{1,4}[A-Z]?(?:-\d{1,4})?)\b/);
  return m && !CODE_STOP.has(m[1].replace(/[\s\d-]+.*$/, '')) ? m[1].trim() : '';
}

/** Timetable rows: each line with a class time, its course code (on the line or just above) and days. */
function parseTimetable(lines: string[]): CourseDraft[] {
  const byCode = new Map<string, CourseDraft>();
  let lastCode: { code: string; name: string; line: number } | null = null;
  let dayHeader: Weekday[] = [];
  lines.forEach((line, i) => {
    const codes = courseCodesIn(line, true);
    if (codes.length) {
      lastCode = { code: codes[0].code, name: nameAfterCode(line, codes[0].index + codes[0].length), line: i };
    }
    const time = timeRangeIn(line);
    if (!time) {
      // A heading that is just a day ("Sunday", "الأحد") sets the day for the rows under it
      const bare = line.replace(/[\d/.,\-:]+/g, ' ').trim();
      const days = daysInText(bare);
      if (days.length === 1 && bare.split(/\s+/).length <= 3) dayHeader = days;
      return;
    }
    if (NOT_A_CLASS.test(line)) return;
    const current = lastCode as { code: string; name: string; line: number } | null;
    if (!current || i - current.line > 3) return;
    let days = daysInText(line);
    if (!days.length && i > 0 && current.line === i - 1) days = daysInText(lines[i - 1]);
    if (!days.length) days = dayHeader;
    if (!days.length) return;
    const room = roomIn(line) || roomAfterTime(line.slice(time.index + time.length));
    const key = normalizeCode(current.code);
    const draft = byCode.get(key) || { courseCode: current.code, courseName: current.name, scheduleSlots: [], syllabus: [] };
    if (!draft.courseName && current.name) draft.courseName = current.name;
    addSlot(draft.scheduleSlots, { days: [...days], startTime: time.start, endTime: time.end, room: room || 'TBA', location: room || undefined });
    byCode.set(key, draft);
  });
  return [...byCode.values()];
}

function credits(text: string): number | undefined {
  const m = text.match(/credit\s*(?:hours?|hrs?\.?|units?)\s*[:-]?\s*\(?(\d(?:\.\d)?)\b/i)
    || text.match(/\b(\d(?:\.\d)?)\s*(?:credit\s*(?:hours?|hrs?\.?|units?)|credits?\b|cr\.?\s*hrs?\b|sch\b)/i)
    || text.match(/(?:عدد\s*)?الساعات\s*(?:المعتمدة)?\s*[:-]?\s*(\d)/)
    || text.match(/(\d)\s*ساعات\s*معتمدة/);
  const n = m ? parseFloat(m[1]) : NaN;
  return n >= 0.5 && n <= 6 ? n : undefined;
}

function instructorIn(text: string): string | undefined {
  const m = text.match(/(?:\binstructor|\blecturer|\bprofessor|\bcourse\s+(?:coordinator|leader)|\bfaculty\s+member|\btaught\s+by|\bteacher|مدرس\s*المساق|أستاذ\s*المساق)(?:'s)?(?:\s*name)?\s*[:-]\s*([^\n\t,;|]{3,80})/i);
  if (!m) return undefined;
  const name = m[1].split(/\s{2,}|\b(?:e-?mail|office|phone|tel|ext)\b|@/i)[0].replace(/[\s\-:,.]+$/, '').trim();
  return name.length >= 3 && name.length <= 60 ? name : undefined;
}

function courseIdentity(lines: string[]): { code: string; name: string } {
  const text = lines.join('\n');
  const label = text.match(/course\s*(?:code|number|no\.?|#|id)(?:\s*(?:and|&|\/)\s*(?:title|name))?\s*[:-]?\s*([A-Z]{2,5}[ -]?\d{3,4}[A-Z]?|\d{4}\s?\d{3})\b/i);
  const nameLabel = text.match(/course\s*(?:title|name)\s*[:-]\s*([^\n\t]{3,90})/i);
  let code = label ? (courseCodesIn(label[1].toUpperCase(), true)[0]?.code || '') : '';
  let name = nameLabel ? nameLabel[1].replace(/\s*\(?\d(?:\.\d)?\s*(?:credit\s*hours?|credits?)\)?.*$/i, '').replace(/[\s\-:|,.]+$/, '').trim() : '';
  if (!code || !name) {
    // Otherwise the first code near the top, and the name next to it
    for (const line of lines.slice(0, 60)) {
      const found = courseCodesIn(line, Boolean(label))[0];
      if (!found) continue;
      if (!code) code = found.code;
      if (!name && normalizeCode(found.code) === normalizeCode(code)) name = nameAfterCode(line, found.index + found.length);
      if (!name) {
        const before = line.slice(0, found.index).replace(/[\s\-:|,.(]+$/, '').replace(/^.*(?:course|syllabus|outline)\s*[:-]?\s*/i, '').trim();
        if (before.length >= 3 && before.length <= 90 && /[A-Za-z]{3}/.test(before)) name = before;
      }
      if (code && name) break;
    }
  }
  return { code, name };
}

const ASSESSMENT_HEADER = /^(?:\d+(?:\.\d+)*[.)]?\s*)?(?:course\s+)?(?:assessments?|grading|evaluation|grade\s+distribution|marks?\s+distribution|distribution\s+of\s+(?:marks|grades)|weighting|assessment\s+(?:methods?|plan|strategy|tools)|course\s+grade|grading\s+(?:policy|scheme|criteria|system)|methods?\s+of\s+assessment|توزيع\s*(?:الدرجات|العلامات)|التقييم|طرق\s*التقييم)\b/i;
const PROSE = /\b(?:will|must|should|shall|more than|less than|at least|up to|exceed|deduct|penalt|plagiar|similarity|turnitin|absen|late\b|warning|receive|obtain|minimum|maximum)/i;
const GRADE_ROW = /^\s*[A-F][+-]?\s*[:=\t ]\s*\(?\d|\b\d{1,3}(?:\.\d+)?\s*(?:-|to)\s*\d{1,3}(?:\.\d+)?\s*%?/i;

/** One weighted assessment from a line ("Midterm Exam 30%", "Quizzes (4) 20%", "Labs 4 x 5%"), or null. */
export function assessmentFromLine(line: string, inSection: boolean, idx: number): CustomSyllabusComponent | null {
  const text = line.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 160 || /^total\b|\btotal\s*[:=]?\s*100/i.test(text)) return null;
  if (PROSE.test(text) || GRADE_ROW.test(text)) return null;
  const pcts: { value: number; index: number; each: boolean; length: number }[] = [];
  const re = /(\d{1,3}(?:\.\d+)?)\s*%/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12);
    const before = text.slice(Math.max(0, m.index - 4), m.index);
    pcts.push({ value: parseFloat(m[1]), index: m.index, length: m[0].length, each: /^\s*(?:each|per\b|\/\s*each|for each|apiece)/i.test(after) || /[x×*]\s*$/.test(before) });
  }
  let total: number | undefined;
  let unit: number | undefined;
  let numberAt = -1;
  for (const p of pcts) {
    if (p.each && unit === undefined) { unit = p.value; if (numberAt < 0) numberAt = p.index; }
    if (!p.each && total === undefined) { total = p.value; if (numberAt < 0 || p.index < numberAt) numberAt = p.index; }
  }
  if (!pcts.length && inSection) {
    // A table cell with the weight and no % sign: "Midterm Exam<tab>30"
    const cells = line.split('\t').map(c => c.trim()).filter(Boolean);
    const last = cells[cells.length - 1];
    if (cells.length >= 2 && /^\d{1,3}(?:\.\d+)?$/.test(last) && /[A-Za-z؀-ۿ]{3}/.test(cells[0])) {
      total = parseFloat(last);
      numberAt = text.lastIndexOf(last);
    }
  }
  const countMatch = text.match(/best\s+(\d{1,2})\s+(?:out\s+)?of\s+(?:the\s+)?(\d{1,2})/i)
    || text.match(/\((\d{1,2})\)/)
    || text.match(/\b(\d{1,2})\s*[x×]\s*\d/)
    || text.match(/[x×]\s*(\d{1,2})\b(?!\s*%)/)
    || text.match(/\b(\d{1,2})\s+(?:quizzes|quiz|exams|tests|assignments|homeworks?|reports|labs|projects|presentations|activities|tasks|experiments)\b/i);
  const count = countMatch ? parseInt(countMatch[1], 10) : undefined;
  const outOf = countMatch && countMatch[2] ? parseInt(countMatch[2], 10) : undefined;
  if (total === undefined && unit !== undefined && count) total = Number((unit * count).toFixed(2));
  if (total === undefined || !(total > 0 && total <= 100) || numberAt < 0) return null;

  let name = text.slice(0, numberAt)
    .replace(/\s*\([^)]*\d[^)]*\)\s*$/, '')
    .replace(/\b\d{1,2}\s*[x×]\s*$/, '')
    .replace(/^[\s\-•*●▪◦·]+/, '')
    .replace(/^\d{1,2}[.)]\s+/, '')
    .replace(/[\s:=\-–(|,]+$/, '')
    .trim();
  if (!/[A-Za-z؀-ۿ]{2}/.test(name)) {
    name = text.slice(numberAt).replace(/^\d{1,3}(?:\.\d+)?\s*%?\s*(?:each\s*)?[\-:–]?\s*/, '').replace(/\(.*$/, '').trim();
  }
  if (!/[A-Za-z؀-ۿ]{2}/.test(name) || name.length > 60) return null;
  return makeSyllabusComponent(name, total, count && count > 0 ? count : undefined, idx, text, outOf);
}

function weightsFrom(lines: string[], inSection: boolean): CustomSyllabusComponent[] {
  const out: CustomSyllabusComponent[] = [];
  const names = new Set<string>();
  let sum = 0;
  for (const line of lines) {
    const comp = assessmentFromLine(line, inSection, out.length);
    if (!comp) continue;
    const key = comp.name.toLowerCase();
    if (names.has(key)) continue;
    names.add(key);
    out.push(comp);
    sum += comp.totalWeight;
    if (inSection && sum >= 99.5) break;
  }
  return out;
}

const sumOf = (comps: CustomSyllabusComponent[]) => comps.reduce((s, c) => s + c.totalWeight, 0);

/** The assessment weights: from the grading section closest to 100%, else from anywhere if they add up. */
function syllabusWeights(lines: string[]): CustomSyllabusComponent[] {
  let best: CustomSyllabusComponent[] = [];
  lines.forEach((line, i) => {
    if (line.length > 90 || !ASSESSMENT_HEADER.test(line.trim())) return;
    const found = weightsFrom(lines.slice(i + 1, i + 45), true);
    // The header line itself may hold the first row of a table
    if (Math.abs(sumOf(found) - 100) < Math.abs(sumOf(best) - 100) || (!best.length && found.length)) best = found;
  });
  if (best.length >= 2 && Math.abs(sumOf(best) - 100) <= 5) return best;
  const anywhere = weightsFrom(lines, false);
  if (anywhere.length >= 2 && Math.abs(sumOf(anywhere) - 100) <= 5) return anywhere;
  return best.length >= 2 ? best : [];
}

/** Meeting times in a syllabus ("Lectures: Sun/Tue 11:00-12:15, Room A8-103"), not office hours or exams. */
function syllabusMeetings(lines: string[]): CustomScheduleSlot[] {
  const slots: CustomScheduleSlot[] = [];
  let officeUntil = -1;
  lines.forEach((line, i) => {
    if (/office\s*hours?|الساعات\s*المكتبية/i.test(line)) officeUntil = i + 3;
    const time = timeRangeIn(line);
    if (!time || NOT_A_CLASS.test(line)) return;
    if (i <= officeUntil && !/\b(?:lecture|class|lab|tutorial|section|meeting)/i.test(line)) return;
    let days = daysInText(line);
    if (!days.length && i > 0 && !timeRangeIn(lines[i - 1])) days = daysInText(lines[i - 1]);
    if (!days.length) return;
    const room = roomIn(line) || (i + 1 < lines.length && !timeRangeIn(lines[i + 1]) ? roomIn(lines[i + 1]) : '');
    addSlot(slots, { days: [...days], startTime: time.start, endTime: time.end, room: room || 'TBA', location: room || undefined });
  });
  return slots.slice(0, 6);
}

/** Reads a syllabus or schedule. Never throws; finding nothing gives kind 'none'. */
export function analyzeCourseDocument(rawText: string): DocumentAnalysis {
  const text = normalizeDocumentText(rawText);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return { kind: 'none', courses: [] };

  // A timetable: Banner's own layout first, then any table of codes, days and times
  const timetable = new Map<string, CourseDraft>();
  for (const c of parseBannerScheduleText(text)) {
    const slots = (c.scheduleSlots || []).filter(s => s.days.length && s.startTime !== '00:00');
    if (!c.courseCode || !slots.length) continue;
    timetable.set(normalizeCode(c.courseCode), { courseCode: c.courseCode, courseName: c.courseName || '', crn: c.crn, scheduleSlots: slots, syllabus: [] });
  }
  for (const c of parseTimetable(lines)) {
    const key = normalizeCode(c.courseCode);
    if (!timetable.has(key)) timetable.set(key, c);
  }
  const scheduled = [...timetable.values()];
  if (scheduled.length >= 2) return { kind: 'schedule', courses: scheduled };

  // One course's syllabus
  const identity = courseIdentity(lines);
  const syllabus = syllabusWeights(lines);
  let slots = syllabusMeetings(lines);
  if (!slots.length && scheduled.length === 1 && (!identity.code || normalizeCode(scheduled[0].courseCode) === normalizeCode(identity.code))) {
    slots = scheduled[0].scheduleSlots;
  }
  const creditHours = credits(text);
  const instructor = instructorIn(text);
  if (syllabus.length || (identity.code && (slots.length || creditHours))) {
    if (instructor) slots.forEach(s => { if (!s.instructor) s.instructor = instructor; });
    return {
      kind: 'syllabus',
      courses: [{ courseCode: identity.code, courseName: identity.name, creditHours, instructor, scheduleSlots: slots, syllabus }]
    };
  }
  if (scheduled.length === 1) return { kind: 'schedule', courses: scheduled };
  return { kind: 'none', courses: [] };
}

/** Courses from an AI answer, cleaned the same way as the built-in reader's. */
export function sanitizeCourseDrafts(raw: unknown): CourseDraft[] {
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.courses) ? (raw as any).courses : [];
  const out: CourseDraft[] = [];
  for (const item of list.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
    const courseCode = str(item.courseCode ?? item.code, 20);
    const courseName = str(item.courseName ?? item.name ?? item.title, 90);
    if (!courseCode && !courseName) continue;
    const slots: CustomScheduleSlot[] = [];
    for (const m of Array.isArray(item.meetings ?? item.scheduleSlots) ? (item.meetings ?? item.scheduleSlots) : []) {
      if (!m || typeof m !== 'object') continue;
      const days = daysInText(Array.isArray(m.days) ? m.days.join(' ') : str(m.days, 60));
      const time = timeRangeIn(`${str(m.start ?? m.startTime, 12)} - ${str(m.end ?? m.endTime, 12)}`);
      if (!days.length || !time) continue;
      const room = str(m.room, 40);
      addSlot(slots, { days, startTime: time.start, endTime: time.end, room: room || 'TBA', location: room || undefined, instructor: str(m.instructor, 60) || undefined });
    }
    const syllabus: CustomSyllabusComponent[] = [];
    for (const a of Array.isArray(item.assessments ?? item.syllabus) ? (item.assessments ?? item.syllabus) : []) {
      if (!a || typeof a !== 'object') continue;
      const name = str(a.name, 60);
      const weight = Number(a.weight ?? a.totalWeight);
      if (!name || !(weight > 0 && weight <= 100)) continue;
      const count = Number(a.count) > 0 && Number(a.count) <= 50 ? Math.round(Number(a.count)) : undefined;
      const outOf = Number(a.outOf) > 0 && Number(a.outOf) <= 50 ? Math.round(Number(a.outOf)) : undefined;
      if (syllabus.some(c => c.name.toLowerCase() === name.toLowerCase())) continue;
      syllabus.push(makeSyllabusComponent(name, weight, count, syllabus.length, undefined, outOf));
    }
    const ch = Number(item.creditHours);
    const instructor = str(item.instructor, 60) || undefined;
    if (instructor) slots.forEach(s => { if (!s.instructor) s.instructor = instructor; });
    out.push({ courseCode, courseName, creditHours: ch >= 0.5 && ch <= 6 ? ch : undefined, instructor, scheduleSlots: slots, syllabus });
  }
  return out;
}

/** The existing course a found course belongs to: same code, else the same or a containing name or alias. */
export function matchExistingCourse(draft: CourseDraft, courses: UserCourseConfig[]): UserCourseConfig | null {
  const code = normalizeCode(draft.courseCode);
  if (code) {
    const byCode = courses.find(c => normalizeCode(c.courseCode) === code || (c.aliases || []).some(a => normalizeCode(a) === code));
    if (byCode) return byCode;
  }
  const name = normalizeCode(draft.courseName);
  if (name.length >= 4) {
    return courses.find(c => {
      const n = normalizeCode(c.courseName);
      return n === name || (n.length >= 4 && (n.includes(name) || name.includes(n))) || (c.aliases || []).some(a => normalizeCode(a) === name);
    }) || null;
  }
  return null;
}

export interface CourseImportPick {
  draft: CourseDraft;
  /** An existing course's id, or 'new' */
  targetId: string;
}

/**
 * Saves what the student kept: into the chosen course (meeting times and weights replace that
 * course's when found; name, colour and the rest stay), or as a new course.
 */
export function applyCourseImport(existing: UserCourseConfig[], picks: CourseImportPick[]): UserCourseConfig[] {
  let result = existing;
  for (const { draft, targetId } of picks) {
    const target = targetId !== 'new' ? result.find(c => c.id === targetId) : undefined;
    const incoming: Partial<UserCourseConfig> = {
      courseCode: target ? target.courseCode : draft.courseCode,
      courseName: draft.courseName || target?.courseName,
      crn: draft.crn,
      scheduleSlots: draft.scheduleSlots.map(s => ({ ...s, days: [...s.days] })),
      syllabus: draft.syllabus.map(c => ({ ...c }))
    };
    if (target) {
      result = mergeImportedCourses(result, [{ ...incoming, courseName: target.courseName }]);
      // A different name on the document is kept as an alias so announcements using it still match
      const merged = result.find(c => c.id === target.id);
      if (merged && draft.courseName && normalizeCode(draft.courseName) !== normalizeCode(merged.courseName)) {
        const alias = draft.courseName.toLowerCase();
        if (!merged.aliases.includes(alias)) merged.aliases.push(alias);
      }
      if (merged && draft.creditHours) merged.creditHours = draft.creditHours;
    } else {
      const before = new Set(result.map(c => c.id));
      result = mergeImportedCourses(result, [incoming]);
      const added = result.find(c => !before.has(c.id)) || result.find(c => normalizeCode(c.courseCode) === normalizeCode(draft.courseCode));
      if (added && draft.creditHours) added.creditHours = draft.creditHours;
    }
  }
  return result;
}
