import { Announcement, DeadlineTask, TaskType, TaskPriority } from '../types';
import { resolveTaskWeight } from '../core/syllabusWeights';
import { resolveTaskTimeWithSchedule, resolveTaskRoom } from '../core/courseSchedule';
import { sanitizeDoctorAnnouncementText, isBareTypeTitle } from '../core/courseHelper';

interface DateMatchResult {
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

// Keyword patterns for task type identification (supporting English and Arabic)
const TASK_TYPE_PATTERNS: Array<{ type: TaskType; regex: RegExp; priority: TaskPriority }> = [
  {
    type: 'quiz',
    regex: /(?:\b(quiz(?:\s*\d+)?|pop\s*quiz)\b|(?:كويز(?:\s*\d+)?|اختبار\s*قصير(?:\s*\d+)?))/i,
    priority: 'high'
  },
  {
    type: 'exam',
    regex: /(?:\b(midterm(?:\s*exam)?|final\s*exam|major\s*exam|exam(?:\s*\d+)?)\b|(?:امتحان(?:\s*(?:نصفي|نهائي|\d+))?|اختبار(?:\s*(?:نصفي|نهائي))?))/i,
    priority: 'high'
  },
  {
    type: 'assignment',
    regex: /(?:\b(assignment(?:\s*\d+)?|homework(?:\s*\d+)?|hw(?:\s*\d+)?|problem\s*set(?:\s*\d+)?)\b|(?:واجب(?:\s*\d+)?|تمرين(?:\s*\d+)?))/i,
    priority: 'medium'
  },
  {
    type: 'project',
    regex: /(?:\b(project(?:\s*(?:phase|milestone|submission|report|\d+))?|term\s*paper|capstone)\b|(?:مشروع(?:\s*(?:التخرج|\d+))?))/i,
    priority: 'high'
  },
  {
    type: 'lab',
    regex: /(?:\b(lab(?:\s*(?:report|exam|submission|\d+))?)\b|(?:مختبر(?:\s*\d+)?|تقرير\s*مختبر))/i,
    priority: 'medium'
  },
  {
    type: 'meeting',
    regex: /(?:\b(presentations?|class\s*meeting|office\s*hours|review\s*session)\b|(?:مناقشة|عروض|عرض\s*تقديمي))/i,
    priority: 'low'
  },
  {
    type: 'other',
    regex: /(?:\b(due(?:\s*date)?|deadline|submission|last\s*day)\b|(?:تسليم|موعد\s*نهائي|موعد))/i,
    priority: 'medium'
  }
];

/**
 * Parses a single time component (e.g. "12:30 pm", "13:30", "11:00 am", "10 صباحاً").
 */
function parseSingleTimeString(
  str: string,
  fallbackMarker?: 'am' | 'pm'
): { hour: number; minute: number } | null {
  if (!str) return null;
  const clean = str.trim();

  // Arabic 12-hour: requires Arabic indicator (صباحاً / مساءً)
  const arMatch = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(صباحاً|صباحا|مساءً|مساء)$/);
  if (arMatch) {
    let hour = parseInt(arMatch[1], 10);
    const minute = arMatch[2] ? parseInt(arMatch[2], 10) : 0;
    const isPm = /مساء/.test(arMatch[3]);
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  // English 12-hour with optional AM/PM: e.g. "12:30 pm", "13:30 pm", "11:00", "2 pm"
  const engMatch = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (engMatch) {
    let hour = parseInt(engMatch[1], 10);
    const minute = engMatch[2] ? parseInt(engMatch[2], 10) : 0;
    const marker = (engMatch[3]?.toLowerCase() as 'am' | 'pm' | undefined) || fallbackMarker;

    if (hour > 23 || minute > 59) return null;

    // If hour >= 13, it's already 24-hour regardless of PM tag (e.g. 13:30 pm)
    if (hour >= 13) {
      return { hour, minute };
    }

    if (marker === 'pm' && hour < 12) {
      hour += 12;
    } else if (marker === 'am' && hour === 12) {
      hour = 0;
    }

    return { hour, minute };
  }

  return null;
}

/**
 * Parses time expressions from text snippet.
 * Prioritizes assessment time ranges (e.g. "from 12:30 pm to 13:30 pm"),
 * preposition times ("at 12:30 pm"), and avoids picking up post timestamps.
 * Returns { hour, minute, hasTime: boolean, matchStr: string }
 */
function parseTime(text: string): { hour: number; minute: number; hasTime: boolean; matchStr: string } {
  // Priority 1: Explicit Time Ranges (e.g. "from 12:30 pm to 13:30 pm", "from 12:30 to 13:30", "11:00 am - 12:15 pm")
  const rangeFromToRegex = /\b(?:from|between)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}(?::\d{2})?)\s*(?:to|until|-|and)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}(?::\d{2})?)\b/i;
  const fromToMatch = text.match(rangeFromToRegex);
  if (fromToMatch) {
    const startStr = fromToMatch[1];
    const endStr = fromToMatch[2];
    const endIsPm = /pm/i.test(endStr);
    const endIsAm = /am/i.test(endStr);
    const fallbackMarker = !/am|pm/i.test(startStr) ? (endIsPm ? 'pm' : endIsAm ? 'am' : undefined) : undefined;

    const startParsed = parseSingleTimeString(startStr, fallbackMarker);
    if (startParsed) {
      return {
        hour: startParsed.hour,
        minute: startParsed.minute,
        hasTime: true,
        matchStr: fromToMatch[0]
      };
    }
  }

  // Hyphen / dash range (e.g. "12:30 pm - 1:30 pm", "12:30 - 13:30", "11:00 AM - 12:15 PM")
  const hyphenRangeRegex = /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})\b/i;
  const hyphenMatch = text.match(hyphenRangeRegex);
  if (hyphenMatch) {
    const startStr = hyphenMatch[1];
    const endStr = hyphenMatch[2];
    const endIsPm = /pm/i.test(endStr);
    const endIsAm = /am/i.test(endStr);
    const fallbackMarker = !/am|pm/i.test(startStr) ? (endIsPm ? 'pm' : endIsAm ? 'am' : undefined) : undefined;

    const startParsed = parseSingleTimeString(startStr, fallbackMarker);
    if (startParsed) {
      return {
        hour: startParsed.hour,
        minute: startParsed.minute,
        hasTime: true,
        matchStr: hyphenMatch[0]
      };
    }
  }

  // Arabic range (e.g. "من الساعة 12:30 إلى 13:30", "من 12:30 إلى 1:30 مساءً")
  const arRangeRegex = /من\s*(?:الساعة\s*)?(\d{1,2}(?::\d{2})?\s*(?:صباحاً|صباحا|مساءً|مساء)|\d{1,2}(?::\d{2})?)\s*(?:إلى|الي|-)\s*(?:الساعة\s*)?(\d{1,2}(?::\d{2})?\s*(?:صباحاً|صباحا|مساءً|مساء)|\d{1,2}(?::\d{2})?)/;
  const arRangeMatch = text.match(arRangeRegex);
  if (arRangeMatch) {
    const startParsed = parseSingleTimeString(arRangeMatch[1]);
    if (startParsed) {
      return {
        hour: startParsed.hour,
        minute: startParsed.minute,
        hasTime: true,
        matchStr: arRangeMatch[0]
      };
    }
  }

  // Priority 2: Preposition / Contextual time (e.g. "at 12:30 pm", "by 11:59 pm", "الساعة 10:00")
  const prepTimeRegex = /\b(?:at|by|starts?\s+at|ends?\s+at|due\s+at)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}(?::\d{2})?)\b/i;
  const prepMatch = text.match(prepTimeRegex);
  if (prepMatch) {
    const parsed = parseSingleTimeString(prepMatch[1]);
    if (parsed) {
      return {
        hour: parsed.hour,
        minute: parsed.minute,
        hasTime: true,
        matchStr: prepMatch[0]
      };
    }
  }

  const arPrepRegex = /الساعة\s*(\d{1,2}(?::\d{2})?\s*(?:صباحاً|صباحا|مساءً|مساء)|\d{1,2}(?::\d{2})?)/;
  const arPrepMatch = text.match(arPrepRegex);
  if (arPrepMatch) {
    const parsed = parseSingleTimeString(arPrepMatch[1]);
    if (parsed) {
      return {
        hour: parsed.hour,
        minute: parsed.minute,
        hasTime: true,
        matchStr: arPrepMatch[0]
      };
    }
  }

  // Priority 3: English 12-hour AM/PM e.g. "11:59 pm", "2:00 PM", "5 pm", "10am"
  // If multiple exist, avoid matching a leading timestamp if another appears later
  const ampmRegex = /(\b\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi;
  const allAmPmMatches = Array.from(text.matchAll(ampmRegex));
  if (allAmPmMatches.length > 0) {
    // If the first match is at index 0 and another match exists, prefer the later one
    let chosenMatch = allAmPmMatches[0];
    if (allAmPmMatches.length > 1 && chosenMatch.index === 0) {
      chosenMatch = allAmPmMatches[1];
    }

    let hour = parseInt(chosenMatch[1], 10);
    const minute = chosenMatch[2] ? parseInt(chosenMatch[2], 10) : 0;
    const isPm = /pm/i.test(chosenMatch[3]);
    const isAm = /am/i.test(chosenMatch[3]);

    if (hour >= 13) {
      // Already 24-hour
    } else if (isPm && hour < 12) {
      hour += 12;
    } else if (isAm && hour === 12) {
      hour = 0;
    }

    return { hour, minute, hasTime: true, matchStr: chosenMatch[0] };
  }

  // Priority 4: Arabic 12-hour e.g. "11:59 مساءً", "10 صباحاً"
  const arabicTimeRegex = /(\d{1,2})(?::(\d{2}))?\s*(صباحاً|صباحا|مساءً|مساء)/;
  const arMatch = text.match(arabicTimeRegex);
  if (arMatch) {
    let hour = parseInt(arMatch[1], 10);
    const minute = arMatch[2] ? parseInt(arMatch[2], 10) : 0;
    const isPm = /مساء/i.test(arMatch[3]);
    const isAm = /صباح/i.test(arMatch[3]);

    if (isPm && hour < 12) hour += 12;
    if (isAm && hour === 12) hour = 0;

    return { hour, minute, hasTime: true, matchStr: arMatch[0] };
  }

  // Priority 5: Midnight / Noon keywords
  if (/\bmidnight\b|منتصف\s*الليل/i.test(text)) {
    return { hour: 23, minute: 59, hasTime: true, matchStr: 'midnight' };
  }
  if (/\bnoon\b|الظهر/i.test(text)) {
    return { hour: 12, minute: 0, hasTime: true, matchStr: 'noon' };
  }

  // Priority 6: Standard 24-hour time e.g. "23:59", "14:30"
  const time24Regex = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
  const time24Match = text.match(time24Regex);
  if (time24Match) {
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

/**
 * Parses date expressions relative to a base date.
 */
function parseDateString(text: string, baseDate: Date): DateMatchResult | null {
  const clean = text.trim();
  const baseYear = baseDate.getFullYear();
  const timeInfo = parseTime(clean);

  // Pattern 1: Month Name Day [Year] e.g. "October 15", "Oct 15th", "Oct 15, 2026"
  const monthDayRegex = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i;
  const mdMatch = clean.match(monthDayRegex);
  if (mdMatch) {
    const monthKey = mdMatch[1].toLowerCase().replace('.', '');
    const month = MONTHS_MAP[monthKey];
    const day = parseInt(mdMatch[2], 10);
    const year = mdMatch[3] ? parseInt(mdMatch[3], 10) : (month !== undefined ? resolveImpliedYear(month, day, baseDate) : baseYear);

    if (month !== undefined && day >= 1 && day <= 31) {
      const d = new Date(year, month, day, timeInfo.hour, timeInfo.minute, 0, 0);
      return { date: d, hasSpecificTime: timeInfo.hasTime, matchedText: mdMatch[0] };
    }
  }

  // Pattern 2: Day Month [Year] e.g. "15th of October", "15 Oct 2026", "15 أكتوبر"
  const dayMonthRegex = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)\.?\s*(?:,?\s*(\d{4}))?\b/i;
  const dmMatch = clean.match(dayMonthRegex);
  if (dmMatch) {
    const day = parseInt(dmMatch[1], 10);
    const monthKey = dmMatch[2].toLowerCase().replace('.', '');
    const month = MONTHS_MAP[monthKey];
    const year = dmMatch[3] ? parseInt(dmMatch[3], 10) : (month !== undefined ? resolveImpliedYear(month, day, baseDate) : baseYear);

    if (month !== undefined && day >= 1 && day <= 31) {
      const d = new Date(year, month, day, timeInfo.hour, timeInfo.minute, 0, 0);
      return { date: d, hasSpecificTime: timeInfo.hasTime, matchedText: dmMatch[0] };
    }
  }

  // Pattern 3: Numeric DD/MM/YYYY or DD-MM-YYYY (or YYYY-MM-DD)
  const numericDateRegex = /\b(\d{1,4})[\/\.-](\d{1,2})[\/\.-](\d{1,4})\b/;
  const numMatch = clean.match(numericDateRegex);
  if (numMatch) {
    const p1 = parseInt(numMatch[1], 10);
    const p2 = parseInt(numMatch[2], 10);
    const p3 = parseInt(numMatch[3], 10);

    let day = p1;
    let month = p2 - 1;
    let year = p3 < 100 ? p3 + 2000 : p3;

    // ISO format (YYYY-MM-DD) must be recognised before two-digit years are expanded
    if (numMatch[1].length === 4) {
      year = p1;
      month = p2 - 1;
      day = p3;
    } else if (numMatch[3].length !== 2 && numMatch[3].length !== 4) {
      // Not a date (e.g. "1.2.345")
      year = NaN;
    }

    if (!isNaN(year) && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const d = new Date(year, month, day, timeInfo.hour, timeInfo.minute, 0, 0);
      return { date: d, hasSpecificTime: timeInfo.hasTime, matchedText: numMatch[0] };
    }
  }

  // Pattern 4: Relative "today" / "اليوم"
  if (/\b(today)\b|اليوم/i.test(clean)) {
    const d = new Date(baseDate);
    d.setHours(timeInfo.hour, timeInfo.minute, 0, 0);
    return { date: d, hasSpecificTime: timeInfo.hasTime, matchedText: 'today' };
  }

  // Pattern 5: Relative "tomorrow" / "غداً" / "بكرة"
  if (/\b(tomorrow)\b|(?:غداً|غدا|بكرة)/i.test(clean)) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 1);
    d.setHours(timeInfo.hour, timeInfo.minute, 0, 0);
    return { date: d, hasSpecificTime: timeInfo.hasTime, matchedText: 'tomorrow' };
  }

  // Pattern 6: Day name + day number e.g. "Thursday 24", "Thursday 24th", "on Thursday 24", "يوم الخميس 24"
  const dayNameNumberRegex = /\b(?:on\s+)?(?:(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)\s+)(?:the\s*)?(\d{1,2})(?:st|nd|rd|th)?\b/i;
  const dnnMatch = clean.match(dayNameNumberRegex);
  if (dnnMatch) {
    const day = parseInt(dnnMatch[2], 10);
    if (day >= 1 && day <= 31) {
      let month = baseDate.getMonth();
      let year = baseDate.getFullYear();
      if (day < baseDate.getDate() - 5) {
        month++;
        if (month > 11) {
          month = 0;
          year++;
        }
      }
      const d = new Date(year, month, day, timeInfo.hour, timeInfo.minute, 0, 0);
      return { date: d, hasSpecificTime: timeInfo.hasTime, matchedText: dnnMatch[0] };
    }
  }

  // Arabic Day name + day number e.g. "الخميس 24", "يوم الخميس 24"
  const arDayNameNumberRegex = /(?:يوم\s*)?(الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|السبت)\s+(?:الموافق\s+)?(\d{1,2})\b/i;
  const arDnnMatch = clean.match(arDayNameNumberRegex);
  if (arDnnMatch) {
    const day = parseInt(arDnnMatch[2], 10);
    if (day >= 1 && day <= 31) {
      let month = baseDate.getMonth();
      let year = baseDate.getFullYear();
      if (day < baseDate.getDate() - 5) {
        month++;
        if (month > 11) {
          month = 0;
          year++;
        }
      }
      const d = new Date(year, month, day, timeInfo.hour, timeInfo.minute, 0, 0);
      return { date: d, hasSpecificTime: timeInfo.hasTime, matchedText: arDnnMatch[0] };
    }
  }

  // Pattern 6b: Day with ordinal e.g. "Wednesday 16th", "on the 16th", "16th"
  const ordinalDayRegex = /\b(?:(?:on\s+)?(?:next\s+week\s+on\s+)?(?:(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)\s*)?(?:the\s*)?(\d{1,2})(?:st|nd|rd|th))\b/i;
  const ordMatch = clean.match(ordinalDayRegex);
  if (ordMatch) {
    const day = parseInt(ordMatch[2], 10);
    if (day >= 1 && day <= 31) {
      let month = baseDate.getMonth();
      let year = baseDate.getFullYear();
      if (day < baseDate.getDate() - 5) {
        month++;
        if (month > 11) {
          month = 0;
          year++;
        }
      }
      const d = new Date(year, month, day, timeInfo.hour, timeInfo.minute, 0, 0);
      return { date: d, hasSpecificTime: timeInfo.hasTime, matchedText: ordMatch[0] };
    }
  }

  // Pattern 6b: a weekday further out: "the Sunday after next", "a week from Sunday",
  // "Sunday next week", "الأحد بعد القادم", "الأسبوع القادم يوم الأحد"
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
      // A week after the coming one
      let diff = targetDayIndex - baseDate.getDay();
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff + 7);
    } else {
      // Weeks start on Sunday at the university. "Next week" is the following week, the same
      // one "next Sunday" means below, and "after next" is the week after that
      d.setDate(d.getDate() - d.getDay() + 7 + targetDayIndex + (mode === 'afterNext' ? 7 : 0));
    }
    d.setHours(timeInfo.hour, timeInfo.minute, 0, 0);
    return { date: d, hasSpecificTime: timeInfo.hasTime, matchedText: m[0] };
  }

  // Pattern 7: Day of the week without day number e.g. "next Tuesday", "this Thursday", "يوم الثلاثاء القادم"
  const engDayRegex = /\b(next|this|on)?\s*(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)\b/i;
  const arDayRegex = /(?:يوم\s*)?(الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|السبت)(?:\s*(القادم|القادمة|المقبل|المقبلة))?/i;

  const engMatch = clean.match(engDayRegex);
  const arMatch = clean.match(arDayRegex);

  if (engMatch || arMatch) {
    let dayName = '';
    let isNext = false;
    let matchStr = '';

    if (engMatch) {
      matchStr = engMatch[0];
      dayName = engMatch[2].toLowerCase();
      isNext = (engMatch[1] || '').toLowerCase() === 'next';
    } else if (arMatch) {
      matchStr = arMatch[0];
      dayName = arMatch[1];
      isNext = Boolean(arMatch[2]);
    }

    const targetDayIndex = DAY_OF_WEEK_MAP[dayName];
    if (targetDayIndex !== undefined) {
      const currentDayIndex = baseDate.getDay();
      let diff = targetDayIndex - currentDayIndex;

      if (isNext) {
        if (diff <= 0) diff += 7;
        else diff += 7;
      } else {
        if (diff <= 0) diff += 7;
      }

      const d = new Date(baseDate);
      d.setDate(d.getDate() + diff);
      d.setHours(timeInfo.hour, timeInfo.minute, 0, 0);
      return { date: d, hasSpecificTime: timeInfo.hasTime, matchedText: matchStr };
    }
  }

  return null;
}

/**
 * Extracts a concise task title from the surrounding text snippet.
 */
function extractTaskTitle(sentence: string, taskType: TaskType): string {
  // Clean whitespace
  const clean = sentence.replace(/\s+/g, ' ').trim();

  // English title label like "Quiz 2", "Assignment 3", "Project Proposal"
  const specificMatch = clean.match(/\b((?:Final\s+Exam|Quiz|Assignment|HW|Homework|Exam|Midterm|Project|Lab)\s*(?:#?\d+|[A-Z]\b|Part\s*\d+|Phase\s*\d+|Proposal|Final)?)/i);
  if (specificMatch && specificMatch[1].length > 2) {
    return specificMatch[1].trim();
  }

  // Arabic title label like "كويز 1", "الواجب الأول", "امتحان نصفي"
  const arTitleMatch = clean.match(/(?:(?:كويز|واجب|امتحان|مشروع|اختبار)(?:\s*(?:الأول|الثاني|الثالث|الرابع|النهائي|النصفي|\d+))?)/i);
  if (arTitleMatch && arTitleMatch[0].length > 2) {
    return arTitleMatch[0].trim();
  }

  // Capitalize fallback
  const fallback = taskType.charAt(0).toUpperCase() + taskType.slice(1);
  return fallback;
}

/**
 * Analyzes an announcement and returns extracted deadline tasks.
 */
export function extractDeadlinesLocally(announcement: Announcement): DeadlineTask[] {
  const baseDate = announcement.postedAt ? new Date(announcement.postedAt) : new Date();

  // Clean doctor announcement text
  const cleanContent = sanitizeDoctorAnnouncementText(
    announcement.contentText || '',
    announcement.courseName,
    announcement.courseCode,
    announcement.title
  );

  const cleanTrimmed = cleanContent.trim();

  // 1. Filter out Announcements whose content is purely a grade/score fraction (e.g. ".25 / 10", "8.5 / 10")
  if (/^["']?\s*\.?\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*["']?$/.test(cleanTrimmed)) {
    return [];
  }

  // 2. Filter out announcements whose primary subject is reporting past grades or marks
  // (unless they explicitly announce an upcoming future assessment or makeup deadline)
  const isGradeAnnouncement = (
    /(?:^|[^\p{L}\p{N}])(?:درجات|درجة|علامات|علامة|نتائج|النتائج|العلامات|الدرجات|grades?|marks?|scores?|results?|solutions?|answer\s*keys?|feedback)(?:$|[^\p{L}\p{N}])/iu.test(announcement.title) ||
    /(?:grades?|marks?|scores?)\s+(?:are\s+)?(?:posted|uploaded|available|published|announced|released)|(?:تم\s+نشر|تم\s+رصد|تم\s+تنزيل|معلنة|مرفوعة)\s+(?:الدرجات|العلامات|النتائج|درجة|علامة)/iu.test(cleanContent)
  );

  const hasFutureDeadlineAction = /(?:submit\s+by|due\s+on|due\s+date|submission\s+deadline|makeup\s+exam|make-up\s+exam|تسليم\s+في|آخر\s+موعد|امتحان\s+تعويضي|اختبار\s+تعويضي)/iu.test(cleanContent);

  if (isGradeAnnouncement && !hasFutureDeadlineAction) {
    return [];
  }

  const text = `${announcement.title}\n${cleanContent}`;

  // Break text into sentences or lines
  const sentences = text
    .split(/(?<=[.!?\n\r])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 5);

  const tasks: DeadlineTask[] = [];
  const detectedKeys = new Set<string>();

  for (const sentence of sentences) {
    // Check if the sentence has any academic/deadline intent
    let matchedType: TaskType | null = null;
    let basePriority: TaskPriority = 'medium';

    for (const pattern of TASK_TYPE_PATTERNS) {
      if (pattern.regex.test(sentence)) {
        matchedType = pattern.type;
        basePriority = pattern.priority;
        break;
      }
    }

    // Presentation dates are not deadlines, unless the same sentence also names real graded work
    if (/\bpresentations?\b|عرض\s*تقديمي|عروض/i.test(sentence) && !/\b(?:quiz(?:zes)?|exams?|midterms?|finals?|tests?|assignments?|homework|hw|labs?|reports?|essays?)\b|كويز|امتحان|واجب/i.test(sentence)) {
      continue;
    }

    const sentenceType = matchedType;

    // If no explicit task keyword, check if announcement title had one
    if (!matchedType) {
      for (const pattern of TASK_TYPE_PATTERNS) {
        if (pattern.regex.test(announcement.title)) {
          matchedType = pattern.type;
          basePriority = pattern.priority;
          break;
        }
      }
    }

    // If still no keyword or general deadline trigger, continue
    if (!matchedType && !/\b(?:due|deadline|submission)\b|تسليم|موعد/i.test(sentence)) {
      continue;
    }

    let effectiveType: TaskType = matchedType || 'other';

    // Attempt date extraction from this sentence
    const dateMatch = parseDateString(sentence, baseDate);
    if (!dateMatch) {
      continue;
    }

    // Avoid duplicates for the same course + date + type
    const dateKey = `${announcement.courseCode}_${effectiveType}_${dateMatch.date.toDateString()}`;
    if (detectedKeys.has(dateKey)) {
      continue;
    }
    detectedKeys.add(dateKey);

    // Naming. A sentence that only has a date ("Date: Thursday 22 October", "Start date is
    // Sept 4") borrows a specific name from the announcement heading, or is skipped. Office
    // hours, class meetings, presentation schedules and unnamed "other" dates are skipped:
    // they used to become tasks called "Meeting" or "Other".
    let title = extractTaskTitle(sentence, effectiveType);
    if (effectiveType === 'meeting') {
      continue;
    }
    if (isBareTypeTitle(title) && (sentenceType !== effectiveType || effectiveType === 'other')) {
      const fromHeading = extractTaskTitle(announcement.title || '', effectiveType);
      if (isBareTypeTitle(fromHeading)) continue;
      title = fromHeading;
      const headingType = TASK_TYPE_PATTERNS.find(p => p.type !== 'other' && p.regex.test(fromHeading));
      if (headingType) effectiveType = headingType.type;
    }
    // Dates that are not graded work ("other") are left out; the AI tier may still name them.
    if (effectiveType === 'other') continue;
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Time adjustment: if teacher gave a specific time, preserve it.
    // If no specific time was stated, resolve to the exact class time from the student's schedule.
    const scheduleResult = resolveTaskTimeWithSchedule({
      dueDate: dateMatch.date,
      courseNameOrCode: announcement.courseName || announcement.courseCode,
      hasSpecificTime: dateMatch.hasSpecificTime,
      announcementText: cleanContent || sentence,
      title
    });
    const finalDate = scheduleResult.dueDate;
    const hasSpecificTime = scheduleResult.hasSpecificTime;

    // Doctor's announcement quote: prioritize complete clean doctor announcement text
    const doctorAnnouncementText = cleanContent || sentence.trim();

    // Urgency priority calculation
    const now = Date.now();
    const diffMs = finalDate.getTime() - now;
    let priority: TaskPriority = basePriority;
    if (diffMs > 0 && diffMs < 48 * 3600 * 1000) {
      priority = 'high';
    }

    const weightInfo = resolveTaskWeight({
      title,
      courseName: announcement.courseName,
      courseCode: announcement.courseCode,
      type: effectiveType,
      description: doctorAnnouncementText,
      sourceSnippet: doctorAnnouncementText
    });

    const roomInfo = resolveTaskRoom({
      courseNameOrCode: announcement.courseName || announcement.courseCode,
      announcementText: cleanContent || sentence,
      title,
      type: effectiveType
    });

    tasks.push({
      id: taskId,
      announcementId: announcement.id,
      courseCode: announcement.courseCode,
      courseName: announcement.courseName,
      title,
      description: doctorAnnouncementText,
      dueDate: finalDate.toISOString(),
      hasSpecificTime,
      type: effectiveType,
      priority,
      status: 'pending',
      sourceSnippet: doctorAnnouncementText,
      confidence: 0.85,
      extractedBy: 'local',
      weight: weightInfo.weight,
      weightDisplay: weightInfo.weightDisplay,
      syllabusNote: weightInfo.syllabusNote,
      room: roomInfo.room || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  return tasks;
}
