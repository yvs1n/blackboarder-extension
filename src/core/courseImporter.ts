import type { UserCourseConfig, CustomScheduleSlot, CustomSyllabusComponent, Weekday, TaskType } from '../types';

const FALLBACK_PALETTE = [
  '#2563eb', // Blue
  '#7c3aed', // Purple
  '#059669', // Emerald
  '#d97706', // Amber
  '#db2777', // Pink
  '#0891b2', // Cyan
  '#4f46e5', // Indigo
  '#0d9488'  // Teal
];

function sanitizeString(val: any): string {
  return typeof val === 'string' ? val.trim() : '';
}

function normalizeKey(str: string): string {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Converts a 12-hour or 24-hour time string (e.g. "1:45 pm", "11:00 AM", "14:00") into 24-hour "HH:MM".
 */
export function convertTo24Hour(timeStr: string): string {
  if (!timeStr) return '00:00';
  const clean = timeStr.trim();

  // Check 12-hour format with AM/PM
  const match12 = clean.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const period = match12[3]?.toLowerCase();

    if (period === 'pm' && hours < 12) {
      hours += 12;
    } else if (period === 'am' && hours === 12) {
      hours = 0;
    }

    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  // Already 24h format "HH:MM"
  const match24 = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hh = String(parseInt(match24[1], 10)).padStart(2, '0');
    const mm = String(parseInt(match24[2], 10)).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  return '00:00';
}

/**
 * Parses day abbreviations or full day strings into Weekday[].
 * Supports Banner single-letter codes: U=Sun, M=Mon, T=Tue, W=Wed, R=Thu, F=Fri, S=Sat.
 * Supports strings like "TR", "MW", "MWF", "Tue / Thu", "Monday, Wednesday", etc.
 */
export function parseDaysString(daysStr: string): Weekday[] {
  if (!daysStr) return [];
  const text = daysStr.trim();
  const days: Weekday[] = [];

  // 1. Check Banner letter codes if 1 to 5 contiguous letters like "MW", "TR", "MWF", "W", "R"
  if (/^[UMTWRFS]+$/i.test(text)) {
    const map: Record<string, Weekday> = {
      U: 'Sunday',
      M: 'Monday',
      T: 'Tuesday',
      W: 'Wednesday',
      R: 'Thursday',
      F: 'Friday',
      S: 'Saturday'
    };
    for (const char of text.toUpperCase()) {
      const d = map[char];
      if (d && !days.includes(d)) {
        days.push(d);
      }
    }
    if (days.length > 0) return days;
  }

  // 2. Check full words or abbreviations separated by spaces, slashes, or commas
  const tokens = text.toLowerCase().split(/[\s,/\-]+/).filter(Boolean);
  const wordMap: Record<string, Weekday> = {
    sun: 'Sunday',
    sunday: 'Sunday',
    mon: 'Monday',
    monday: 'Monday',
    tue: 'Tuesday',
    tues: 'Tuesday',
    tuesday: 'Tuesday',
    wed: 'Wednesday',
    wednesday: 'Wednesday',
    thu: 'Thursday',
    thur: 'Thursday',
    thurs: 'Thursday',
    thursday: 'Thursday',
    fri: 'Friday',
    friday: 'Friday',
    sat: 'Saturday',
    saturday: 'Saturday'
  };

  for (const token of tokens) {
    const d = wordMap[token];
    if (d && !days.includes(d)) {
      days.push(d);
    }
  }

  return days;
}

/**
 * 1. Validates and sanitizes imported JSON course arrays.
 */
export function parseCoursesFromJson(jsonStr: string): UserCourseConfig[] {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err: any) {
    throw new Error(`Invalid JSON format: ${err.message}`);
  }

  const rawList: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.courses)
    ? parsed.courses
    : null;

  if (!rawList || rawList.length === 0) {
    throw new Error('No valid courses array found in JSON.');
  }

  const sanitized: UserCourseConfig[] = [];

  rawList.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;

    const courseName = sanitizeString(item.courseName) || `Course ${index + 1}`;
    const courseCode = sanitizeString(item.courseCode) || `C${index + 1}`;
    const id = sanitizeString(item.id) || normalizeKey(courseCode) || `course_${index + 1}`;
    const colorHex = /^#[0-9a-f]{3,8}$/i.test(item.colorHex)
      ? item.colorHex
      : FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];

    const aliases: string[] = Array.isArray(item.aliases)
      ? item.aliases.map((a: any) => sanitizeString(a)).filter(Boolean)
      : [];

    const scheduleSlots: CustomScheduleSlot[] = [];
    if (Array.isArray(item.scheduleSlots)) {
      item.scheduleSlots.forEach((slot: any) => {
        if (!slot || typeof slot !== 'object') return;
        const days = Array.isArray(slot.days)
          ? (slot.days.filter((d: string) =>
              ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].includes(d)
            ) as Weekday[])
          : parseDaysString(sanitizeString(slot.days));

        const startTime = convertTo24Hour(sanitizeString(slot.startTime) || '00:00');
        const endTime = convertTo24Hour(sanitizeString(slot.endTime) || '00:00');
        const room = sanitizeString(slot.room) || 'TBA';
        const location = sanitizeString(slot.location) || room;
        const instructor = sanitizeString(slot.instructor);

        scheduleSlots.push({
          days,
          startTime,
          endTime,
          room,
          location,
          instructor: instructor || undefined
        });
      });
    }

    const syllabus: CustomSyllabusComponent[] = [];
    if (Array.isArray(item.syllabus)) {
      item.syllabus.forEach((comp: any, compIdx: number) => {
        if (!comp || typeof comp !== 'object') return;
        const compName = sanitizeString(comp.name) || `Component ${compIdx + 1}`;
        const compId = sanitizeString(comp.id) || `${id}_comp_${compIdx + 1}`;
        const type: TaskType = ['quiz', 'assignment', 'exam', 'project', 'lab', 'meeting', 'other'].includes(comp.type)
          ? comp.type
          : 'other';

        const totalWeight = typeof comp.totalWeight === 'number' && !isNaN(comp.totalWeight) ? comp.totalWeight : 0;
        const count = typeof comp.count === 'number' && comp.count > 0 ? comp.count : undefined;
        const unitWeight = typeof comp.unitWeight === 'number' && !isNaN(comp.unitWeight)
          ? comp.unitWeight
          : count ? Number((totalWeight / count).toFixed(2)) : totalWeight;

        const note = sanitizeString(comp.note);
        const keywords = Array.isArray(comp.keywords)
          ? comp.keywords.map((k: any) => sanitizeString(k)).filter(Boolean)
          : [];

        syllabus.push({
          id: compId,
          name: compName,
          type,
          totalWeight,
          count,
          unitWeight,
          note: note || undefined,
          keywords: keywords.length > 0 ? keywords : undefined
        });
      });
    }

    sanitized.push({
      id,
      courseCode,
      courseName,
      crn: sanitizeString(item.crn) || undefined,
      colorHex,
      aliases,
      scheduleSlots,
      syllabus
    });
  });

  if (sanitized.length === 0) {
    throw new Error('No valid course entries could be parsed from JSON.');
  }

  return sanitized;
}

/**
 * 2. Parses copy-pasted UOS Banner SSB schedule text (block, tabular, or detail).
 */
export function parseBannerScheduleText(rawText: string): Partial<UserCourseConfig>[] {
  if (!rawText || !rawText.trim()) return [];

  const courses: Partial<UserCourseConfig>[] = [];
  const text = rawText.trim();

  // Strategy A: Multi-line block structure (Student Registration SSB card view)
  // Example:
  // Calculus I for Engineering - 1440133 - 02
  // CRN: 10806
  // Status: **Registered**
  // Instructors: Randa Al-Teraifi (Primary)
  // Class 12:30 pm - 1:45 pm | Tue Thu | UOS Men's Campus, A12, 110 | Type: Class
  const blockDelimiters = /(?:^|\n)(?=[^\n]+?\s*[-–—]\s*(?:[0-9]{4}\s*[0-9]{3}|[0-9]{7})\b)/g;
  const blocks = text.split(blockDelimiters).map(b => b.trim()).filter(Boolean);

  if (blocks.length > 1 || (blocks.length === 1 && /[-–—]\s*(?:[0-9]{4}\s*[0-9]{3}|[0-9]{7})/i.test(blocks[0]))) {
    for (const block of blocks) {
      const headerLine = block.split('\n')[0] || '';
      const headerMatch = headerLine.match(/^(.+?)\s*[-–—]\s*([0-9]{4}\s*[0-9]{3}(?:\s*[0-9]{1,2}[A-Z]?)?|[0-9]{7})/i);

      if (headerMatch) {
        const courseName = headerMatch[1].trim();
        const courseCode = headerMatch[2].trim();

        // CRN
        const crnMatch = block.match(/\bCRN:?\s*(\d{5})\b/i);
        const crn = crnMatch ? crnMatch[1] : undefined;

        // Instructor
        const instMatch = block.match(/(?:Instructors?|Instructor|Faculty):?\s*([^\n\r(]+)/i);
        const instructor = instMatch ? instMatch[1].trim() : undefined;

        // Time and Days
        // e.g. "12:30 pm - 1:45 pm | Tue Thu | UOS Men's Campus, A12, 110"
        const timeMatch = block.match(/(\d{1,2}:\d{2}\s*(?:am|pm)?)\s*[-–—]\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i);
        const startTime = timeMatch ? convertTo24Hour(timeMatch[1]) : '00:00';
        const endTime = timeMatch ? convertTo24Hour(timeMatch[2]) : '00:00';

        // Days: check pipe-delimited segments or label
        let days: Weekday[] = [];
        const pipeSegments = block.split('|').map(s => s.trim());
        for (const seg of pipeSegments) {
          const parsed = parseDaysString(seg);
          if (parsed.length > 0) {
            days = parsed;
            break;
          }
        }
        if (days.length === 0) {
          const daysMatch = block.match(/(?:Days?|Meeting Days?):?\s*([A-Za-z\s,/\-]+)/i);
          if (daysMatch) days = parseDaysString(daysMatch[1]);
        }

        // Room & Location
        let room = 'TBA';
        let location = '';
        const bldRoomMatch = block.match(/\b([A-Za-z]\d{1,2})\s*[,–—/-]\s*(TH\d{2,4}|Lab\s*\d+|\d{2,4}[A-Za-z]?)\b/i);
        if (bldRoomMatch) {
          room = `${bldRoomMatch[1].toUpperCase()}-${bldRoomMatch[2]}`;
        } else {
          const roomMatch = block.match(/\b([A-Za-z]\d{1,2}\s*[-–—/]\s*(?:TH\d{2,4}|Lab\s*\d+|\d{2,4}[A-Za-z]?))\b/i) ||
                            block.match(/(?:Central\s*Lab(?:orator(?:y|ies))?(?:\s*\(?men\)?)?\s*[-–—:]*\s*\d{2,4}[A-Za-z]?)/i);
          if (roomMatch) {
            room = roomMatch[0].replace(/\s*[-–—/]\s*/, '-').trim();
          }
        }

        const locMatch = block.match(/\|\s*([^|\n]+(?:Campus|Building|Lab|Hall)[^|\n]+)\s*\|/i);
        if (locMatch) {
          location = locMatch[1].trim();
        }

        const scheduleSlots: CustomScheduleSlot[] = [];
        if (days.length > 0 || room !== 'TBA' || startTime !== '00:00') {
          scheduleSlots.push({
            days,
            startTime,
            endTime,
            room,
            location: location || room,
            instructor
          });
        }

        courses.push({
          courseName,
          courseCode,
          crn,
          scheduleSlots
        });
      }
    }

    if (courses.length > 0) return courses;
  }

  // Strategy B: Table Row paste
  // e.g. "12056 1502 101 01 Introduction to Computer Eng. 3.00 TR 11:00 AM - 12:15 PM A8-103 Arain, Bilal"
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Check for row with CRN (5 digits), course code (digits), days, time
    const rowMatch = line.match(/^(\d{5})?\s*([0-9]{4}\s*[0-9]{3}(?:\s*[0-9]{1,2}[A-Za-z]?)?|[0-9]{7})\s+(.+?)\s+(?:[0-9.]+\s+)?([UMTWRFS]{1,5}|[A-Za-z\s,/\-]+)\s+(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)\s*[-–—]\s*(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)\s+([A-Za-z0-9\s\-]+?)(?:\s+([A-Za-z,\s]+))?$/i);

    if (rowMatch) {
      const crn = rowMatch[1] || undefined;
      const courseCode = rowMatch[2].trim();
      const courseName = rowMatch[3].trim();
      const days = parseDaysString(rowMatch[4]);
      const startTime = convertTo24Hour(rowMatch[5]);
      const endTime = convertTo24Hour(rowMatch[6]);
      const room = rowMatch[7].trim();
      const instructor = rowMatch[8] ? rowMatch[8].trim() : undefined;

      courses.push({
        courseName,
        courseCode,
        crn,
        scheduleSlots: [
          {
            days,
            startTime,
            endTime,
            room,
            location: room,
            instructor
          }
        ]
      });
    } else {
      // Freeform single-line check
      const codeMatch = line.match(/\b([0-9]{4}\s*[0-9]{3}(?:\s*[0-9]{1,2}[A-Za-z]?)?|[0-9]{7})\b/);
      const timeMatch = line.match(/(\d{1,2}:\d{2}\s*(?:am|pm)?)\s*[-–—]\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i);

      if (codeMatch && timeMatch) {
        const courseCode = codeMatch[1].trim();
        const startTime = convertTo24Hour(timeMatch[1]);
        const endTime = convertTo24Hour(timeMatch[2]);
        const days = parseDaysString(line);

        let room = 'TBA';
        const roomMatch = line.match(/\b([A-Za-z]\d{1,2}\s*[-–—/]\s*(?:TH\d{2,4}|Lab\s*\d+|\d{2,4}[A-Za-z]?))\b/i) ||
                          line.match(/\bCentral\s*Lab[^\n,]+/i);
        if (roomMatch) room = roomMatch[0].trim();

        // Extract title before or after code
        let courseName = line.split(codeMatch[0])[0].replace(/[-–—:|]+/g, '').trim();
        if (!courseName || courseName.length < 3) {
          courseName = line.split(codeMatch[0])[1]?.split(/[-–—|0-9]/)[0].trim() || `Course ${courseCode}`;
        }

        courses.push({
          courseName,
          courseCode,
          scheduleSlots: [
            {
              days,
              startTime,
              endTime,
              room,
              location: room
            }
          ]
        });
      }
    }
  }

  return courses;
}

/**
 * 3. Extracts mark allocation lines from pasted syllabus text.
 * e.g.
 * "Midterm Exam: 30%"
 * "Quizzes (4): 20%"
 * "Final: 40%"
 * "Lab Reports (6): 30%"
 */
export function parseSyllabusWeightsText(rawText: string): CustomSyllabusComponent[] {
  if (!rawText || !rawText.trim()) return [];

  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const components: CustomSyllabusComponent[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    // Look for percentage or marks: e.g. "30%", "20 %", "30 marks", "25 pts", "40 points"
    const pctMatch = line.match(/(\d+(?:\.\d+)?)\s*%/i) ||
                     line.match(/(\d+(?:\.\d+)?)\s*(?:marks?|points?|pts?)\b/i) ||
                     line.match(/[-–—:\s]+(\d+(?:\.\d+)?)\s*$/);

    if (!pctMatch) continue;

    const totalWeight = parseFloat(pctMatch[1]);
    if (isNaN(totalWeight) || totalWeight <= 0 || totalWeight > 100) continue;

    // Component name is the text preceding the score
    let namePart = line.slice(0, pctMatch.index).replace(/[-–—:]+$/, '').trim();
    if (!namePart || namePart.length < 2) {
      // If score is at the beginning e.g. "30% - Midterm Exam"
      namePart = line.slice((pctMatch.index || 0) + pctMatch[0].length).replace(/^[-–—:]+/, '').trim();
    }
    if (!namePart) namePart = `Assessment ${idx + 1}`;

    // Extract count if present (e.g. "(4)", "4 quizzes", "best 2 of 3", "6 reports")
    let count: number | undefined;
    const countMatch = line.match(/\((\d+)\)/) ||
                       line.match(/\b(\d+)\s*(?:quizzes|exams|reports|homeworks|assignments|tests|activities|labs)\b/i) ||
                       line.match(/best\s+(\d+)\s+of\s+(\d+)/i);

    if (countMatch) {
      count = parseInt(countMatch[1], 10);
    }

    components.push(makeSyllabusComponent(namePart, totalWeight, count, idx, line));
  }

  return components;
}

/** The task type a syllabus part's name suggests (English and Arabic). */
export function guessComponentType(name: string): TaskType {
  const lower = String(name || '').toLowerCase();
  if (/quiz|كويز|امتحان\s*قصير/i.test(lower)) return 'quiz';
  if (/exam|midterm|final|test\b|نصفي|نهائي|امتحان/i.test(lower)) return 'exam';
  if (/lab|مختبر|تقرير\s*مختبر/i.test(lower)) return 'lab';
  if (/project|term\s*project|مشروع/i.test(lower)) return 'project';
  if (/attendance|participation|conduct|مشاركة|حضور/i.test(lower)) return 'other';
  return 'assignment';
}

/** One syllabus part with its type, weight per item and matching keywords. */
export function makeSyllabusComponent(
  name: string,
  totalWeight: number,
  count: number | undefined,
  idx: number,
  note?: string,
  outOf?: number
): CustomSyllabusComponent {
  const type = guessComponentType(name);
  const unitWeight = count && count > 0 ? Number((totalWeight / count).toFixed(2)) : totalWeight;
  const keywords: string[] = [name.toLowerCase()];
  if (type === 'quiz') keywords.push('quiz', 'كويز');
  if (type === 'exam') {
    if (/midterm/i.test(name)) keywords.push('midterm', 'نصفي');
    if (/final/i.test(name)) keywords.push('final', 'نهائي');
  }
  if (type === 'lab') keywords.push('lab', 'report', 'مختبر');
  if (type === 'project') keywords.push('project', 'مشروع');
  return {
    id: `comp_${idx + 1}_${type}`,
    name,
    type,
    totalWeight,
    count,
    ...(outOf && count && outOf > count ? { outOf } : {}),
    unitWeight,
    note: note || undefined,
    keywords: Array.from(new Set(keywords))
  };
}

/**
 * 4. Merges imported schedule slots or syllabus weights into existing courses
 * matching by normalized courseCode or courseName without wiping out existing fields.
 */
export function mergeImportedCourses(
  existing: UserCourseConfig[],
  incoming: Partial<UserCourseConfig>[]
): UserCourseConfig[] {
  const result: UserCourseConfig[] = existing.map(c => ({
    ...c,
    aliases: [...c.aliases],
    scheduleSlots: c.scheduleSlots.map(s => ({ ...s, days: [...s.days] })),
    syllabus: c.syllabus.map(comp => ({ ...comp, keywords: comp.keywords ? [...comp.keywords] : undefined }))
  }));

  for (const item of incoming) {
    if (!item) continue;
    const itemCode = normalizeKey(item.courseCode || '');
    const itemName = normalizeKey(item.courseName || '');

    // Find match by code or name
    let matchIdx = -1;
    if (itemCode) {
      matchIdx = result.findIndex(c => normalizeKey(c.courseCode) === itemCode);
    }
    if (matchIdx === -1 && itemName) {
      matchIdx = result.findIndex(c => {
        const cName = normalizeKey(c.courseName);
        return cName === itemName || cName.includes(itemName) || itemName.includes(cName);
      });
    }

    if (matchIdx !== -1) {
      // Merge into existing course
      const target = result[matchIdx];

      if (item.courseName && target.courseName.startsWith('Course ')) {
        target.courseName = item.courseName;
      }
      if (item.crn && !target.crn) {
        target.crn = item.crn;
      }

      // Add alias if course code or name changed
      if (item.courseName && !target.aliases.includes(item.courseName.toLowerCase())) {
        target.aliases.push(item.courseName.toLowerCase());
      }

      // Merge schedule slots if incoming has slots
      if (Array.isArray(item.scheduleSlots) && item.scheduleSlots.length > 0) {
        target.scheduleSlots = item.scheduleSlots;
      }

      // Merge syllabus components if incoming has syllabus
      if (Array.isArray(item.syllabus) && item.syllabus.length > 0) {
        target.syllabus = item.syllabus;
      }
    } else {
      // New course to add
      const newCode = item.courseCode?.trim() || `C${result.length + 1}`;
      const newName = item.courseName?.trim() || `Course ${newCode}`;
      const newId = item.id || normalizeKey(newCode) || `course_${Date.now()}_${result.length}`;
      const colorHex = item.colorHex || FALLBACK_PALETTE[result.length % FALLBACK_PALETTE.length];

      result.push({
        id: newId,
        courseCode: newCode,
        courseName: newName,
        crn: item.crn,
        colorHex,
        aliases: item.aliases || [newName.toLowerCase(), newCode.toLowerCase()],
        scheduleSlots: item.scheduleSlots || [],
        syllabus: item.syllabus || []
      });
    }
  }

  return result;
}
