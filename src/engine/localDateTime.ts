import { normalizeDigits } from '../core/titleLocalization';

export interface DateMatchResult {
  date: Date;
  hasSpecificTime: boolean;
  matchedText: string;
}

const MONTHS_MAP: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
  // Arabic months
  'يناير': 0, 'فبراير': 1, 'مارس': 2, 'أبريل': 3, 'ابريل': 3,
  'مايو': 4, 'يونيو': 5, 'يوليو': 6, 'أغسطس': 7, 'اغسطس': 7,
  'سبتمبر': 8, 'أكتوبر': 9, 'اكتوبر': 9, 'نوفمبر': 10, 'ديسمبر': 11
};

const DAY_OF_WEEK_MAP: Record<string, number> = {
  sunday: 0, sun: 0, 'الأحد': 0, 'الاحد': 0,
  monday: 1, mon: 1, 'الاثنين': 1, 'الإثنين': 1,
  tuesday: 2, tue: 2, tues: 2, 'الثلاثاء': 2,
  wednesday: 3, wed: 3, 'الأربعاء': 3, 'الاربعاء': 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, 'الخميس': 4,
  friday: 5, fri: 5, 'الجمعة': 5,
  saturday: 6, sat: 6, 'السبت': 6
};

interface DateCandidate {
  date: Date;
  matchedText: string;
  index: number;
}

const DATE_SCHEDULE_CUE_RE = /(?:will\s+be(?:\s+held|\s+conducted|\s+given|\s+on)?|held|conducted|takes?\s+place|scheduled(?:\s+for)?|due(?:\s+(?:on|by))?|submit(?:ted)?(?:\s+by)?|deadline|opens?|closes?|until|date|(?:moved|rescheduled|postponed|shifted|changed)\s+(?:[^.\n]{0,35}\s+)?(?:to|until)|new\s+(?:date|deadline)|updated\s+(?:date|deadline)|سيكون|سيعقد|موعد|بتاريخ|حتى|تأجيل\S*(?:\s+\S+){0,4}?\s+إلى|تعديل\S*(?:\s+\S+){0,4}?\s+إلى|الموعد\s*الجديد)\b/i;
const DATE_PAST_TOPIC_CUE_RE = /(?:from|since|lectures?\s+(?:of|on|from)|class(?:es)?\s+(?:of|on)|covered(?:\s+on)?|material\s+from|posted\s+on|originally(?:\s+(?:on|scheduled\s+(?:on|for)))?|moved\s+from|changed\s+from|rescheduled\s+from|instead\s+of|بدلاً?\s*من|من\s+تاريخ)\s*$/i;

const TIME_DURATION_FOLLOW_RE = /^\s*(?:days?|hrs?|hours?|weeks?|wks?|months?|minutes?|mins?|%|marks?|points?|pts?|chapters?|ch\.?|sections?|questions?|pages?|times?)\b/i;

function normalizeDateTimeText(text: string): string {
  return normalizeDigits(text || '')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u00a0/g, ' ');
}

function detectMeridiem(str: string): 'am' | 'pm' | undefined {
  if (!str) return undefined;
  const s = str.toLowerCase();
  if (/(?:p\.?\s*m\.?|مساءً?|ظهراً?|الظهر|عصراً?|العصر|ليلاً?)/.test(s) || /(?:^|[\d\s])م(?=$|[\s,.)!؛،-])/.test(s)) {
    return 'pm';
  }
  if (/(?:a\.?\s*m\.?|صباحاً?|صباح|فجراً?)/.test(s) || /(?:^|[\d\s])ص(?=$|[\s,.)!؛،-])/.test(s)) {
    return 'am';
  }
  return undefined;
}

function inferRangeStartMarker(startStr: string, endStr: string): 'am' | 'pm' | undefined {
  if (detectMeridiem(startStr)) return undefined;
  const endMarker = detectMeridiem(endStr);
  if (!endMarker) return undefined;
  if (endMarker === 'am') return 'am';

  const startHourMatch = startStr.match(/(\d{1,2})/);
  const endHourMatch = endStr.match(/(\d{1,2})/);
  if (!startHourMatch || !endHourMatch) return 'pm';

  const sHour = parseInt(startHourMatch[1], 10);
  const eHour = parseInt(endHourMatch[1], 10);
  if (sHour >= 13) return undefined;
  if (sHour === 12) return 'pm'; // 12:00 - 1:30 pm starts at noon
  if (eHour === 12 || sHour > eHour) return 'am'; // 11:00 - 12:30 pm or 10:00 - 1:00 pm
  return 'pm';
}

function isOldOrNegatedTimeContext(str: string, index: number): boolean {
  const before = str.slice(Math.max(0, index - 42), index).toLowerCase();
  return /(?:moved\s+from|changed\s+from|rescheduled\s+from|shifted\s+from|postponed\s+from|instead\s+of|rather\s+than|not\s+(?:at\s+)?|ليس\s*(?:في|الساعة)\s*|بدلاً?\s*من\s*)\s*$/i.test(before);
}

/**
 * Parses a single time component (e.g. "12:30 pm", "10.30 a.m.", "13:30", "11:00 am", "10 صباحاً", "2 ظهراً").
 */
function parseSingleTimeString(
  str: string,
  fallbackMarker?: 'am' | 'pm'
): { hour: number; minute: number } | null {
  if (!str) return null;
  const clean = normalizeDateTimeText(str).trim().replace(/\b([ap])\.\s*m\.?/gi, '$1m');

  // Arabic 12-hour with explicit marker (صباحاً / مساءً / ظهراً / عصراً / ص / م)
  const arMatch = clean.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(صباحاً|صباحا|صباح|فجراً|فجرا|مساءً|مساء|ظهراً|ظهرا|الظهر|عصراً|عصرا|العصر|ليلاً|ليلا|ص|م)$/);
  if (arMatch) {
    let hour = parseInt(arMatch[1], 10);
    const minute = arMatch[2] ? parseInt(arMatch[2], 10) : 0;
    const isPm = /(?:مساء|ظهر|عصر|ليل|^م$)/.test(arMatch[3]);
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
    return null;
  }

  // English 12/24-hour with optional AM/PM and ":" or "." separator
  const engMatch = clean.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i);
  if (engMatch) {
    let hour = parseInt(engMatch[1], 10);
    const minute = engMatch[2] ? parseInt(engMatch[2], 10) : 0;
    const marker = (engMatch[3]?.toLowerCase() as 'am' | 'pm' | undefined) || fallbackMarker;

    if (hour > 23 || minute > 59) return null;
    if (hour >= 13) return { hour, minute };

    if (marker === 'pm' && hour < 12) hour += 12;
    else if (marker === 'am' && hour === 12) hour = 0;

    return { hour, minute };
  }

  return null;
}

/**
 * Parses time expressions from a text snippet, prioritizing explicit reschedules, ranges, and cued times.
 */
export function parseTime(text: string): { hour: number; minute: number; hasTime: boolean; matchStr: string } {
  const norm = normalizeDateTimeText(text);
  const TIME_TOKEN = '(?:\\d{1,2}(?:[:.]\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?|صباحاً|صباحا|مساءً|مساء|ظهراً|ظهرا|عصراً|عصرا|ص|م)|\\d{1,2}(?:[:.]\\d{2})?)';

  // 0. Explicit time change / reschedule target (must run before rangeFromTo so "moved from 10am to 2pm" picks 2pm!)
  const rescheduleTimeRe = new RegExp(
    `(?:(?:moved|rescheduled|postponed|shifted|changed|updated)\\s+(?:the\\s+)?(?:time|timing|exam|quiz|test|class|session)?\\s*(?:from\\s+${TIME_TOKEN}\\s+)?(?:to|until|till)|(?:new|updated)\\s+(?:time|timing)\\s*[:\\-])\\s*(?:at\\s+)?(\\d{1,2}(?:[:.]\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)|\\d{1,2}[:.]\\d{2})`,
    'i'
  );
  const reschedMatch = norm.match(rescheduleTimeRe);
  if (reschedMatch) {
    const parsed = parseSingleTimeString(reschedMatch[1]);
    if (parsed) {
      return { hour: parsed.hour, minute: parsed.minute, hasTime: true, matchStr: reschedMatch[0] };
    }
  }

  const arReschedMatch = norm.match(/(?:تعديل|تغيير|نقل|تأجيل)\s*(?:وقت|موعد|الساعة)?(?:\s+\S+){0,5}?\s*إلى\s*(?:الساعة\s*)?(\d{1,2}(?:[:.]\d{2})?\s*(?:صباحاً|صباحا|مساءً|مساء|ظهراً|ظهرا|عصراً|عصرا|ص|م)?)/);
  if (arReschedMatch) {
    const parsed = parseSingleTimeString(arReschedMatch[1]);
    if (parsed) {
      return { hour: parsed.hour, minute: parsed.minute, hasTime: true, matchStr: arReschedMatch[0] };
    }
  }

  // 1. "from/between X to/until/- Y" range (skip when preceded by moved/changed)
  const rangeFromToRegex = /\b(?:from|between)\s+(\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}(?:[:.]\d{2})?)\s*(?:to|until|-|and)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}(?:[:.]\d{2})?)\b/gi;
  for (const fromToMatch of norm.matchAll(rangeFromToRegex)) {
    const idx = fromToMatch.index ?? 0;
    if (isOldOrNegatedTimeContext(norm, idx) || /(?:moved|changed|rescheduled|shifted|postponed)\s*$/i.test(norm.slice(Math.max(0, idx - 25), idx))) {
      continue;
    }
    const startParsed = parseSingleTimeString(fromToMatch[1], inferRangeStartMarker(fromToMatch[1], fromToMatch[2]));
    if (startParsed) {
      return { hour: startParsed.hour, minute: startParsed.minute, hasTime: true, matchStr: fromToMatch[0] };
    }
  }

  // 2. Hyphenated time range: "11:00 - 12:30 pm", "2 - 3:30 pm", "10.30 - 11.45 am"
  const hyphenRangeRegex = /\b(\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*-\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}:\d{2})\b/gi;
  for (const hyphenMatch of norm.matchAll(hyphenRangeRegex)) {
    if (isOldOrNegatedTimeContext(norm, hyphenMatch.index ?? 0)) continue;
    // Skip bare numbers with no colon and no am/pm on BOTH sides (e.g. "10 - 12" in chapters/marks)
    if (!/[:.]|a\.?m|p\.?m/i.test(hyphenMatch[1]) && !/[:.]|a\.?m|p\.?m/i.test(hyphenMatch[2])) continue;
    const startParsed = parseSingleTimeString(hyphenMatch[1], inferRangeStartMarker(hyphenMatch[1], hyphenMatch[2]));
    if (startParsed) {
      return { hour: startParsed.hour, minute: startParsed.minute, hasTime: true, matchStr: hyphenMatch[0] };
    }
  }

  // 3. Arabic time range: "من 1 إلى 2 مساءً" or "من 11 إلى 12:30 مساءً"
  const arRangeRegex = /من\s*(?:الساعة\s*)?(\d{1,2}(?:[:.]\d{2})?\s*(?:صباحاً|صباحا|مساءً|مساء|ظهراً|ظهرا|عصراً|عصرا|ص|م)?)\s*(?:إلى|الي|حتى|-)\s*(?:الساعة\s*)?(\d{1,2}(?:[:.]\d{2})?\s*(?:صباحاً|صباحا|مساءً|مساء|ظهراً|ظهرا|عصراً|عصرا|ص|م)?)/g;
  for (const arRangeMatch of norm.matchAll(arRangeRegex)) {
    if (!detectMeridiem(arRangeMatch[1]) && !detectMeridiem(arRangeMatch[2]) && !/[:.]/.test(arRangeMatch[1])) continue;
    const startParsed = parseSingleTimeString(arRangeMatch[1], inferRangeStartMarker(arRangeMatch[1], arRangeMatch[2]));
    if (startParsed) {
      return { hour: startParsed.hour, minute: startParsed.minute, hasTime: true, matchStr: arRangeMatch[0] };
    }
  }

  // 4. Explicit labeled time / prepositions ("Time: 2:30 pm", "at 10:00", "due at 23:59")
  const labeledTimeRe = /\b(?:time|timing|starts?(?:\s+at)?|begins?(?:\s+at)?|ends?\s+at|due\s+(?:time|at)|at|by)\b\s*[:\-]?\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}(?:[:.]\d{2})?)\b/gi;
  for (const prepMatch of norm.matchAll(labeledTimeRe)) {
    const idx = prepMatch.index ?? 0;
    if (isOldOrNegatedTimeContext(norm, idx)) continue;
    const rawTime = prepMatch[1];
    const hasSepOrMeridiem = /[:.]|a\.?m|p\.?m/i.test(rawTime);
    const after = norm.slice(idx + prepMatch[0].length, idx + prepMatch[0].length + 20);
    if (!hasSepOrMeridiem && TIME_DURATION_FOLLOW_RE.test(after)) continue;
    // Bare "by 2" without ":", ".", or am/pm is ambiguous (e.g. "divided by 2"); only trust bare digit after "at" or "time:"
    if (!hasSepOrMeridiem && /^\s*by\b/i.test(prepMatch[0])) continue;
    const parsed = parseSingleTimeString(rawTime);
    if (parsed) {
      return { hour: parsed.hour, minute: parsed.minute, hasTime: true, matchStr: prepMatch[0] };
    }
  }

  const arPrepMatch = norm.match(/(?:الساعة|الوقت)\s*[:\-]?\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:صباحاً|صباحا|مساءً|مساء|ظهراً|ظهرا|عصراً|عصرا|ص|م)?)/);
  if (arPrepMatch) {
    const parsed = parseSingleTimeString(arPrepMatch[1]);
    if (parsed) {
      return { hour: parsed.hour, minute: parsed.minute, hasTime: true, matchStr: arPrepMatch[0] };
    }
  }

  // 5. AM/PM anywhere (supports 10:30 am, 10.30 a.m., 2 pm), skipping negated/old times
  const ampmRegex = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/gi;
  const validAmPmMatches = Array.from(norm.matchAll(ampmRegex)).filter(m => !isOldOrNegatedTimeContext(norm, m.index ?? 0));
  if (validAmPmMatches.length > 0) {
    let chosenMatch = validAmPmMatches[0];
    if (validAmPmMatches.length > 1 && chosenMatch.index === 0) {
      chosenMatch = validAmPmMatches[1];
    }
    const hourRaw = parseInt(chosenMatch[1], 10);
    const minute = chosenMatch[2] ? parseInt(chosenMatch[2], 10) : 0;
    if (hourRaw <= 23 && minute <= 59) {
      let hour = hourRaw;
      const isPm = /^p/i.test(chosenMatch[3]);
      if (hour < 13) {
        if (isPm && hour < 12) hour += 12;
        else if (!isPm && hour === 12) hour = 0;
      }
      return { hour, minute, hasTime: true, matchStr: chosenMatch[0] };
    }
  }

  // 6. Arabic time anywhere (supports ظهراً / عصراً / ص / م)
  const arRegex = /(\d{1,2})(?:[:.](\d{2}))?\s*(صباحاً|صباحا|صباح|فجراً|فجرا|مساءً|مساء|ظهراً|ظهرا|الظهر|عصراً|عصرا|العصر|ليلاً|ليلا|ص|م)(?=$|[\s,.)!؛،\-])/g;
  for (const arMatch of norm.matchAll(arRegex)) {
    if (isOldOrNegatedTimeContext(norm, arMatch.index ?? 0)) continue;
    const parsed = parseSingleTimeString(arMatch[0]);
    if (parsed) {
      return { hour: parsed.hour, minute: parsed.minute, hasTime: true, matchStr: arMatch[0] };
    }
  }

  if (/\bmidnight\b|منتصف\s*الليل/i.test(norm)) {
    return { hour: 23, minute: 59, hasTime: true, matchStr: 'midnight' };
  }
  if (/\bnoon\b|منتصف\s*النهار/i.test(norm)) {
    return { hour: 12, minute: 0, hasTime: true, matchStr: 'noon' };
  }

  // 7. Strict 24-hour HH:MM (guarding against section/room codes like A10:006)
  for (const time24Match of norm.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)) {
    const idx = time24Match.index ?? 0;
    if (isOldOrNegatedTimeContext(norm, idx)) continue;
    return {
      hour: parseInt(time24Match[1], 10),
      minute: parseInt(time24Match[2], 10),
      hasTime: true,
      matchStr: time24Match[0]
    };
  }

  return { hour: 23, minute: 59, hasTime: false, matchStr: '' };
}

/**
 * Picks the year for a date that did not state one. An announcement posted in late December
 * that mentions "Jan 5" means next January, not the January that already passed.
 */
function resolveImpliedYear(month: number, day: number, baseDate: Date): number {
  const baseYear = baseDate.getFullYear();
  const candidate = new Date(baseYear, month, day, 23, 59, 59, 999);
  const daysBehind = (baseDate.getTime() - candidate.getTime()) / (24 * 3600 * 1000);
  return daysBehind > 90 ? baseYear + 1 : baseYear;
}

function rollDayIntoMonth(day: number, baseDate: Date, hour: number, minute: number): Date {
  let month = baseDate.getMonth();
  let year = baseDate.getFullYear();
  if (day < baseDate.getDate() - 5) {
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }
  return new Date(year, month, day, hour, minute, 0, 0);
}

function pickBestDateCandidate(
  clean: string,
  candidates: DateCandidate[],
  baseDate: Date
): DateCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const todayStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate()).getTime();
  let best = candidates[candidates.length - 1];
  let bestScore = -Infinity;

  for (const c of candidates) {
    const beforeClause = clean.slice(Math.max(0, c.index - 55), c.index);
    let score = 0;
    if (DATE_SCHEDULE_CUE_RE.test(beforeClause)) score += 4;
    if (DATE_PAST_TOPIC_CUE_RE.test(beforeClause)) score -= 4;
    if (c.date.getTime() >= todayStart) score += 2;
    if (score >= bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Parses date expressions relative to a base date.
 */
export function parseDateString(text: string, baseDate: Date): DateMatchResult | null {
  const clean = normalizeDateTimeText(text).trim();
  const baseYear = baseDate.getFullYear();
  const timeInfo = parseTime(clean);

  // Pattern 1: Month Name Day [Year]
  const monthDayRegex = /(?:^|[\s,:((\-])(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)[.,]?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi;
  const mdCandidates: DateCandidate[] = [];
  for (const m of clean.matchAll(monthDayRegex)) {
    const month = MONTHS_MAP[m[1].toLowerCase().replace(/[.,]/g, '')];
    const day = parseInt(m[2], 10);
    const year = m[3] ? parseInt(m[3], 10) : (month !== undefined ? resolveImpliedYear(month, day, baseDate) : baseYear);
    if (month !== undefined && day >= 1 && day <= 31) {
      mdCandidates.push({
        date: new Date(year, month, day, timeInfo.hour, timeInfo.minute, 0, 0),
        matchedText: m[0].trim(),
        index: m.index ?? 0
      });
    }
  }
  const bestMd = pickBestDateCandidate(clean, mdCandidates, baseDate);
  if (bestMd) return { date: bestMd.date, hasSpecificTime: timeInfo.hasTime, matchedText: bestMd.matchedText };

  // Pattern 2: Day Month [Year]
  const dayMonthRegex = /\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+(?:of\s+)?|[-/])(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)[.,]?(?:(?:\s*,?\s*|[-/])(\d{4})\b|(?=$|[\s,.)!\-؛،]))/gi;
  const dmCandidates: DateCandidate[] = [];
  for (const m of clean.matchAll(dayMonthRegex)) {
    const day = parseInt(m[1], 10);
    const month = MONTHS_MAP[m[2].toLowerCase().replace(/[.,]/g, '')];
    const year = m[3] ? parseInt(m[3], 10) : (month !== undefined ? resolveImpliedYear(month, day, baseDate) : baseYear);
    if (month !== undefined && day >= 1 && day <= 31) {
      dmCandidates.push({
        date: new Date(year, month, day, timeInfo.hour, timeInfo.minute, 0, 0),
        matchedText: m[0].trim(),
        index: m.index ?? 0
      });
    }
  }
  const bestDm = pickBestDateCandidate(clean, dmCandidates, baseDate);
  if (bestDm) return { date: bestDm.date, hasSpecificTime: timeInfo.hasTime, matchedText: bestDm.matchedText };

  // Pattern 3: Numeric DD/MM/YYYY, MM/DD/YYYY, or YYYY-MM-DD
  const numericDateRegex = /\b(\d{1,4})(?:\.|(?:\s*[\/\-]\s*))(\d{1,2})(?:\.|(?:\s*[\/\-]\s*))(\d{1,4})\b/g;
  const numCandidates: DateCandidate[] = [];
  for (const m of clean.matchAll(numericDateRegex)) {
    const p1 = parseInt(m[1], 10);
    const p2 = parseInt(m[2], 10);
    const p3 = parseInt(m[3], 10);
    let day = p1;
    let month = p2 - 1;
    let year = p3 < 100 ? p3 + 2000 : p3;
    if (m[1].length === 4) {
      year = p1;
      month = p2 - 1;
      day = p3;
    } else if (m[3].length !== 2 && m[3].length !== 4) {
      year = NaN;
    } else if (p2 > 12 && p1 >= 1 && p1 <= 12) {
      month = p1 - 1;
      day = p2;
    }
    if (!isNaN(year) && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      numCandidates.push({
        date: new Date(year, month, day, timeInfo.hour, timeInfo.minute, 0, 0),
        matchedText: m[0],
        index: m.index ?? 0
      });
    }
  }
  const bestNum = pickBestDateCandidate(clean, numCandidates, baseDate);
  if (bestNum) return { date: bestNum.date, hasSpecificTime: timeInfo.hasTime, matchedText: bestNum.matchedText };

  // Pattern 3b: Day/Month without year (e.g. "on 18/11")
  const shortNumericDateRegex = /\b(\d{1,2})\s*[\/\-]\s*(\d{1,2})\b(?!\s*(?:\/|\-|%|marks?|pts?|points?|grades?|scores?|درج|علام))/gi;
  const shortCandidates: DateCandidate[] = [];
  for (const m of clean.matchAll(shortNumericDateRegex)) {
    const p1 = parseInt(m[1], 10);
    const p2 = parseInt(m[2], 10);
    const idx = m.index ?? 0;
    const before = clean.slice(Math.max(0, idx - 24), idx);
    const hasScorePrefix = /(?:score|grade|mark|total|out\s*of|worth|درجة|علامة)\s*[:=]?\s*$/i.test(before);
    const hasDatePrefix = /(?:on|by|due|date|held|scheduled|until|before|from|at|في|يوم|بتاريخ|حتى)\s*[:=]?\s*$/i.test(before);
    let day = p1;
    let month = p2 - 1;
    if (p2 > 12 && p1 >= 1 && p1 <= 12) {
      month = p1 - 1;
      day = p2;
    }
    if (!hasScorePrefix && (p1 > 12 || p2 > 12 || hasDatePrefix) && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const year = resolveImpliedYear(month, day, baseDate);
      shortCandidates.push({
        date: new Date(year, month, day, timeInfo.hour, timeInfo.minute, 0, 0),
        matchedText: m[0],
        index: idx
      });
    }
  }
  const bestShort = pickBestDateCandidate(clean, shortCandidates, baseDate);
  if (bestShort) return { date: bestShort.date, hasSpecificTime: timeInfo.hasTime, matchedText: bestShort.matchedText };

  // Pattern 5: Relative "tomorrow" / "غداً" / "بكرة"
  if (/\b(tomorrow)\b|(?:غداً|غدا|بكرة)/i.test(clean)) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 1);
    d.setHours(timeInfo.hour, timeInfo.minute, 0, 0);
    return { date: d, hasSpecificTime: timeInfo.hasTime, matchedText: 'tomorrow' };
  }

  // Pattern 6: Day name + day number
  const dnnMatch = clean.match(/\b(?:on\s+)?(?:next\s+week\s+on\s+)?(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)\s+(?:the\s*)?(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (dnnMatch) {
    const day = parseInt(dnnMatch[2], 10);
    if (day >= 1 && day <= 31) {
      return { date: rollDayIntoMonth(day, baseDate, timeInfo.hour, timeInfo.minute), hasSpecificTime: timeInfo.hasTime, matchedText: dnnMatch[0] };
    }
  }
  const arDnnMatch = clean.match(/(?:يوم\s*)?(الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|السبت)\s+(?:الموافق\s+)?(\d{1,2})\b/i);
  if (arDnnMatch) {
    const day = parseInt(arDnnMatch[2], 10);
    if (day >= 1 && day <= 31) {
      return { date: rollDayIntoMonth(day, baseDate, timeInfo.hour, timeInfo.minute), hasSpecificTime: timeInfo.hasTime, matchedText: arDnnMatch[0] };
    }
  }

  // Pattern 6b: Weekdays further out
  const EN_DAY = '(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)';
  const AR_DAY = '(الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|السبت)';
  const AR_NEXT = '(?:القادم|القادمة|المقبل|المقبلة)';
  const AR_WEEK = '(?:الأسبوع|الاسبوع)';
  const furtherOut: Array<{ re: RegExp; mode: 'afterNext' | 'nextWeek' | 'weekFrom' }> = [
    { re: new RegExp(`\\b(?:the\\s+)?${EN_DAY}\\s+after\\s+next\\b`, 'i'), mode: 'afterNext' },
    { re: new RegExp(`\\ba\\s+week\\s+(?:from|on)\\s+(?:this\\s+)?${EN_DAY}\\b`, 'i'), mode: 'weekFrom' },
    { re: new RegExp(`\\bnext\\s+week(?:'s)?\\s+(?:on\\s+)?${EN_DAY}\\b`, 'i'), mode: 'nextWeek' },
    { re: new RegExp(`\\b${EN_DAY}\\s+(?:of\\s+)?next\\s+week\\b`, 'i'), mode: 'nextWeek' },
    { re: new RegExp(`(?:يوم\\s*)?${AR_DAY}\\s*(?:${AR_NEXT}\\s*)?(?:الذي\\s*)?بعد\\s*${AR_NEXT}`), mode: 'afterNext' },
    { re: new RegExp(`${AR_WEEK}\\s*${AR_NEXT}\\s*(?:في\\s*)?(?:يوم\\s*)?${AR_DAY}`), mode: 'nextWeek' },
    { re: new RegExp(`(?:يوم\\s*)?${AR_DAY}\\s*(?:من\\s*|في\\s*)?${AR_WEEK}\\s*${AR_NEXT}`), mode: 'nextWeek' }
  ];
  for (const { re, mode } of furtherOut) {
    const m = clean.match(re);
    if (!m) continue;
    const targetDayIndex = DAY_OF_WEEK_MAP[m[1].toLowerCase()] ?? DAY_OF_WEEK_MAP[m[1]];
    if (targetDayIndex === undefined) continue;
    const d = new Date(baseDate);
    if (mode === 'weekFrom') {
      let diff = targetDayIndex - baseDate.getDay();
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff + 7);
    } else {
      d.setDate(d.getDate() - d.getDay() + 7 + targetDayIndex + (mode === 'afterNext' ? 7 : 0));
    }
    d.setHours(timeInfo.hour, timeInfo.minute, 0, 0);
    return { date: d, hasSpecificTime: timeInfo.hasTime, matchedText: m[0] };
  }

  // Pattern 7: Day of the week without day number
  const engMatches = Array.from(clean.matchAll(/\b(next|this|on)?\s*(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)\b/gi));
  const arMatches = Array.from(clean.matchAll(/(?:يوم\s*)?(الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|السبت)(?:\s*(القادم|القادمة|المقبل|المقبلة))?/g));
  if (engMatches.length > 0 || arMatches.length > 0) {
    let dayName = '';
    let isNext = false;
    let matchStr = '';
    if (engMatches.length > 0) {
      let chosen = engMatches[engMatches.length - 1];
      let bestScore = -Infinity;
      for (const m of engMatches) {
        const before = clean.slice(Math.max(0, (m.index ?? 0) - 55), m.index ?? 0);
        let s = m[1] ? 2 : 0;
        if (DATE_SCHEDULE_CUE_RE.test(before)) s += 4;
        if (DATE_PAST_TOPIC_CUE_RE.test(before)) s -= 4;
        if (/\btoday\s+is\s*$/i.test(before)) s -= 4;
        if (s >= bestScore) {
          bestScore = s;
          chosen = m;
        }
      }
      matchStr = chosen[0];
      dayName = chosen[2].toLowerCase();
      isNext = (chosen[1] || '').toLowerCase() === 'next';
    } else {
      let chosen = arMatches[arMatches.length - 1];
      let bestScore = -Infinity;
      for (const m of arMatches) {
        const before = clean.slice(Math.max(0, (m.index ?? 0) - 55), m.index ?? 0);
        let s = m[2] ? 2 : 0;
        if (DATE_SCHEDULE_CUE_RE.test(before)) s += 4;
        if (DATE_PAST_TOPIC_CUE_RE.test(before)) s -= 4;
        if (s >= bestScore) {
          bestScore = s;
          chosen = m;
        }
      }
      matchStr = chosen[0];
      dayName = chosen[1];
      isNext = Boolean(chosen[2]);
    }
    const targetDayIndex = DAY_OF_WEEK_MAP[dayName];
    if (targetDayIndex !== undefined) {
      let diff = targetDayIndex - baseDate.getDay();
      if (isNext || diff <= 0) diff += 7;
      const d = new Date(baseDate);
      d.setDate(d.getDate() + diff);
      d.setHours(timeInfo.hour, timeInfo.minute, 0, 0);
      return { date: d, hasSpecificTime: timeInfo.hasTime, matchedText: matchStr };
    }
  }

  // Pattern 7b: Preposition-gated ordinal date
  const ordMatch = clean.match(/\b(?:(?:on|by|due(?:\s+on)?|before|until|for)\s+(?:the\s+)?|the\s+)(\d{1,2})(?:st|nd|rd|th)\b(?!\s*(?:quiz(?:zes)?|exams?|midterms?|finals?|tests?|assignments?|homeworks?|hw|labs?|projects?|reports?|chapters?|ch\.?|units?|modules?|sections?|lectures?|weeks?|topics?|slides?|pages?|parts?|attempts?|editions?|places?|floors?|percent|%))/i);
  if (ordMatch) {
    const day = parseInt(ordMatch[1], 10);
    if (day >= 1 && day <= 31) {
      return { date: rollDayIntoMonth(day, baseDate, timeInfo.hour, timeInfo.minute), hasSpecificTime: timeInfo.hasTime, matchedText: ordMatch[0] };
    }
  }

  // Pattern 8: Relative "today" / "اليوم"
  if (/\b(today)\b|اليوم/i.test(clean) && !/\b(?:posted|announced|uploaded|sent|published|as\s+of)\s+today\b/i.test(clean)) {
    const d = new Date(baseDate);
    d.setHours(timeInfo.hour, timeInfo.minute, 0, 0);
    return { date: d, hasSpecificTime: timeInfo.hasTime, matchedText: 'today' };
  }

  return null;
}
