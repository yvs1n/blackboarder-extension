import { getActiveCourseLegend, getActiveUserCourses, findActiveCourseInText } from './userCourses';

/**
 * Utility to extract clean course names and course codes from Blackboard text.
 */
export interface CourseInfo {
  code: string;
  name: string;
}

/**
 * Blackboard navigation and system interface blacklist.
 * These terms represent Ultra/Classic UI tabs, buttons, and navigation sections,
 * and must NEVER be treated as courses.
 */
export const BLACKBOARD_NAV_BLACKLIST: ReadonlySet<string> = new Set([
  'content',
  'course content',
  'content collection',
  'calendar',
  'course calendar',
  'institution calendar',
  'discussions',
  'discussion board',
  'discussion',
  'gradebook',
  'grades',
  'my grades',
  'course grades',
  'messages',
  'course messages',
  'analytics',
  'course analytics',
  'groups',
  'course groups',
  'announcements',
  'course announcements',
  'roster',
  'class roster',
  'attendance',
  'tools',
  'course tools',
  'books & tools',
  'books and tools',
  'books & course tools',
  'progress tracking',
  'course description',
  'batch edit',
  'activity',
  'activity stream',
  'stream',
  'organizations',
  'my organizations',
  'institution page',
  'profile',
  'assist',
  'admin',
  'courses',
  'course',
  'ultra',
  'blackboard',
  'blackboard learn',
  'blackboard ultra',
  'general course',
  'uos',
  'university of sharjah',
  'outline',
  'details & actions',
  'details and actions',
  'course outline',
  'achievements',
  'join session',
  'course room',
  'room',
  'roster view everyone in your',
  'attendance view your attendance',
  'books & tools view & institution tools',
  'books and tools view and institution tools',
  'topic of a paragraph',
  // Arabic equivalents
  'المحتوى',
  'محتوى المساق',
  'التقويم',
  'تقويم المساق',
  'المناقشات',
  'لوحة المناقشات',
  'المناقشة',
  'سجل الدرجات',
  'الدرجات',
  'درجاتي',
  'الرسائل',
  'رسائل المساق',
  'التحليلات',
  'المجموعات',
  'الإعلانات',
  'الاعلانات',
  'الحضور',
  'الأدوات',
  'الادوات',
  'قائمة الطلاب',
  'سجل الطلاب',
  'نشاط',
  'موجز النشاط',
  'المؤسسة',
  'صفحة المؤسسة',
  'الملف الشخصي',
  'المقررات الدراسية',
  'المساقات',
  'جامعة الشارقة',
  'الإنجازات',
  'الانجازات',
  'انضمام إلى الجلسة',
  'غرفة المقرر'
]);

/**
 * Checks if a string represents Blackboard navigation noise, Details & Actions buttons, or assignment titles.
 */
export function isBlackboardSystemNoise(nameOrCode?: string): boolean {
  if (!nameOrCode) return true;
  const s = nameOrCode.trim().toLowerCase().replace(/[:\-–|]+/g, ' ').replace(/\s+/g, ' ');
  if (!s || s.length < 2) return true;
  if (BLACKBOARD_NAV_BLACKLIST.has(s)) return true;
  if (/^(?:roster\b|attendance\b|books\s*(?:&|and)\s*tools|details\s*(?:&|and)\s*actions|join\s+session|achievements\b|course\s+room\b)/i.test(s)) {
    return true;
  }
  if (/view\s+everyone\s+in\s+your|view\s+your\s+attendance|institution\s+tools|due\s*date:|new\s*group\s*\d+|student'?s\s*lab\.?\s*report/i.test(s)) {
    return true;
  }
  const alphaOnly = s.replace(/[^a-z0-9\u0600-\u06FF]/g, '');
  for (const item of BLACKBOARD_NAV_BLACKLIST) {
    const itemAlpha = item.replace(/[^a-z0-9\u0600-\u06FF]/g, '');
    if (alphaOnly === itemAlpha) return true;
  }
  return false;
}

/**
 * Verifies whether a course code looks like a legitimate academic course code
 * (e.g. "1502101", "1440 133", "CS101", "MATH 201") rather than a copied label.
 */
export function hasValidAcademicCourseCode(code?: string): boolean {
  if (!code) return false;
  const clean = code.trim();
  if (!clean || clean.toUpperCase() === 'UOS') return false;
  if (isBlackboardSystemNoise(clean)) return false;
  return /^(?:\d{4}\s*\d{3}(?:\s+\d{1,3}[A-Z]?)?|\d{6,9}|[A-Z]{2,6}\s*[-_]?\s*\d{3,5}[A-Z]?)$/i.test(clean);
}

export function parseCourseDetails(rawText: string): CourseInfo {
  if (!rawText || !rawText.trim()) {
    return { code: 'UOS', name: 'General Course' };
  }

  // Remove common Blackboard UI noise and direct stream due-date metadata
  let clean = rawText
    .replace(/blackboard\s*(?:learn|ultra)?/gi, '')
    .replace(/announcements?/gi, '')
    .replace(/courses?/gi, '')
    .replace(/stream/gi, '')
    .replace(/university of sharjah/gi, '')
    .replace(/^(?:Due\s*(?:in|date)?|تسليم|تاريخ\s*الاستحقاق)[:\s-]*/gi, '')
    .replace(/(?:Report)?Due\s*date:.*$/gi, '') // Strip trailing stream card metadata
    .replace(/New\s*Group\s*\d+/gi, '')
    .replace(/\(UTC[+-]?\d+\)/gi, '')
    .trim();

  const originalText = clean;

  // Match Blackboard external course prefix:
  // e.g. "1430116_10708_FALL2026-2027 Physics 1 Lab..." or "CS101_01_FALL2026 Introduction..."
  let code = 'UOS';
  const bbPrefix = clean.match(/^(\d{7}|[A-Za-z]{2,4}\s*\d{3,4})[_\s]+[A-Za-z0-9_\-]*\s+/i);
  if (bbPrefix) {
    code = bbPrefix[1].replace(/\s+/g, '').toUpperCase();
    clean = clean.slice(bbPrefix[0].length).trim();
  }

  // Remove semester/term tags like "(Spring 2026)", "Fall 2025", "- Fall 2025/2026", "FALL2026-2027"
  clean = clean
    .replace(/\((?:Spring|Fall|Summer|Winter|Term|Semester)[^)]*\)/gi, '')
    .replace(/(?:[-–|]\s*)?(?:Spring|Fall|Summer|Winter|Term|Semester)\s*\d{2,4}(?:[-/]\d{2,4})?\b/gi, '')
    .replace(/\b(?:FALL|SPRING|SUMMER|WINTER)\d{2,4}(?:[-/]\d{2,4})?\b/gi, '')
    .trim();

  // Match Course Code if not already set: 7-digit UOS code (e.g. 0401201) or Letter+Digits (e.g. CS101, MATH201)
  if (code === 'UOS') {
    const codeMatch = clean.match(/(?:^|[^0-9A-Za-z])([0-9]{7}|[A-Z]{2,4}\s*[0-9]{3,4})(?:[^0-9A-Za-z]|$)/i);
    if (codeMatch) {
      code = codeMatch[1].replace(/\s+/g, '').toUpperCase();
    }
  }

  // If string contains multiple segments like "Calculus I for Engineering - 02 - حسبان 1 للمهندسين"
  // or "0401201 - Computer Programming"
  const parts = clean.split(/\s*[-–|]\s*/).map(p => p.trim()).filter(Boolean);
  let name = '';

  for (const part of parts) {
    // Check if this part is just a section number (e.g. "02", "13A", "ALL", "1") or just the code
    const isSectionOrCode = /^(?:\d{1,7}[A-Z]?|ALL|SEC\b.*)$/i.test(part) || part.toUpperCase() === code;
    if (!isSectionOrCode && part.length >= 3) {
      name = part;
      break;
    }
  }

  // Fallback to general cleaning if no clear part was found
  if (!name) {
    name = clean;
  }

  // Thorough cleaning of the selected name
  name = name
    .replace(new RegExp(`\\b${code}\\b`, 'i'), '')
    .replace(/^[-_.]?\d{1,3}[A-Z]?\s+/g, '') // leading section numbers like "01 " or "-01 "
    .replace(/[-_.]\d{1,3}[A-Z]?\b/g, '')
    .replace(/[\[\]]/g, ' ')
    .replace(/^[:\-–|\s]+|[:\-–|\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // If clean name became empty (e.g. input was just "0401201-01"), provide a readable fallback
  if (!name || name.length < 2) {
    name = code !== 'UOS' ? `Course ${code}` : 'General Course';
  }

  // Without a code, the student's own course the text names (its name or one of its aliases, Arabic
  // names and assignment titles included) gives the course; the original text is checked too
  if (code === 'UOS' || !code) {
    const known = findActiveCourseInText(name) || findActiveCourseInText(originalText);
    if (known && (known.courseName || known.courseCode)) {
      return { code: (known.courseCode || '').replace(/\s+/g, '').toUpperCase() || 'UOS', name: known.courseName || name };
    }
  }

  // System navigation tabs (Content, Calendar, Discussions, Gradebook, etc.) are never courses
  if (code === 'UOS' && isBlackboardSystemNoise(name)) {
    return { code: 'UOS', name: 'General Course' };
  }

  return { code, name };
}

/** The student's course names and plain aliases (no regex syntax), longest first, for header stripping. */
function activeCourseHeaderNames(): string[] {
  const names = new Set<string>();
  for (const c of getActiveUserCourses()) {
    if (c && typeof c.courseName === 'string' && c.courseName.trim().length > 3) names.add(c.courseName.trim());
    for (const alias of Array.isArray(c?.aliases) ? c.aliases : []) {
      if (typeof alias !== 'string') continue;
      const a = alias.trim();
      if (a.length >= 3 && /[A-Za-z؀-ۿ]/.test(a) && !/[\\.*+?^${}()|[\]]/.test(a)) names.add(a);
    }
  }
  return Array.from(names).sort((x, y) => y.length - x.length);
}

/**
 * Patterns for a course header at the start of a stream card: "<name> - 02 - <Arabic name>" (the
 * Arabic title after the section, up to the line end or the first Latin letter), then the shorter
 * "<name> - 02 -".
 */
function courseHeaderPatterns(names: string[]): RegExp[] {
  const list = names.filter(Boolean).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  if (!list.length) return [];
  const alt = `(?:${list.join('|')})`;
  return [
    new RegExp(`^\\s*${alt}\\s*[-–—:]+\\s*\\d{1,2}[A-Z]?\\s*[-–—:]+[ \\t]*(?:[\\u0600-\\u06FF][\\u0600-\\u06FF\\d \\t]*)?[-–—:]*\\s*`, 'i'),
    new RegExp(`^\\s*${alt}\\s*[-–—:]*\\s*(?:\\b\\d{1,2}[A-Z]?\\b)?\\s*[-–—:]*\\s*`, 'i')
  ];
}

/**
 * Strips Blackboard system noise (posted timestamps
 like "1:21 PM\n" or "14 minutes ago\n",
 * course header banner lines, and section numbers) from the very beginning of a raw DOM scrape,
 * leaving the professor's actual announcement text 100% intact and complete.
 * Never trims mid-sentence words, dates, or titles.
 */
export function sanitizeDoctorAnnouncementText(
  rawText: string,
  courseName?: string,
  courseCode?: string,
  title?: string
): string {
  if (!rawText || !rawText.trim()) return '';

  let text = rawText.trim();

  // Strict stream post timestamp prefixes (e.g. "1:21 PM", "14 minutes ago", "Today at 1:21 PM")
  // NOTE: Never include standalone days or months here, so doctor's date prose is never sliced!
  const timestampPrefixPatterns = [
    // "1:21 PM", "11:59 AM", "13:21", "01:21 PM"
    /^\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\b\s*/i,
    // "14 minutes ago", "2 hours ago", "yesterday", "just now"
    /^\s*(?:\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?)\s+ago|just now)\b\s*/i,
    // "Today at 1:21 PM", "Yesterday at 10:00 AM", "Today 1:21 PM"
    /^\s*(?:Today|Yesterday)(?:\s+at)?\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)?\b\s*/i,
    // Arabic relative/posted timestamps: "منذ 14 دقيقة", "اليوم الساعة 1:21 مساءً", "أمس"
    /^\s*(?:منذ\s+\d+\s+(?:دقائق|دقيقة|ساعات|ساعة|أيام|يوم)|اليوم|أمس)(?:\s+الساعة)?\s*(?:\d{1,2}:\d{2}\s*(?:صباحاً|صباحا|مساءً|مساء)?)?\s*/
  ];

  // Course header banners at the top of stream cards ("<name> - 02 - <Arabic name>"), from the
  // student's own course names and plain aliases
  const knownCoursePatterns = courseHeaderPatterns(activeCourseHeaderNames());

  // Specific course name or code passed from context
  const dynamicCoursePatterns: RegExp[] = [];
  if (courseName && courseName !== 'General Course' && courseName.trim().length > 3) {
    dynamicCoursePatterns.push(...courseHeaderPatterns([courseName.trim()]));
  }
  if (courseCode && courseCode !== 'UOS' && courseCode.trim().length > 2) {
    const escapedCode = courseCode.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    dynamicCoursePatterns.push(new RegExp(`^\\s*${escapedCode}\\s*[-–—:]*`, 'i'));
  }

  // Iterate up to 4 passes to clean layered prefixes (e.g. [timestamp] [course name] [section] [arabic name])
  let changed = true;
  let passes = 0;
  while (changed && passes < 4) {
    changed = false;
    passes++;

    // 1. Strip leading timestamps
    for (const pat of timestampPrefixPatterns) {
      if (pat.test(text)) {
        const next = text.replace(pat, '').trim();
        if (next.length >= 5) {
          text = next;
          changed = true;
        }
      }
    }

    // 2. Strip dynamic course name/code
    for (const pat of dynamicCoursePatterns) {
      if (pat.test(text)) {
        const next = text.replace(pat, '').trim();
        if (next.length >= 5) {
          text = next;
          changed = true;
        }
      }
    }

    // 3. Strip known course headers
    for (const pat of knownCoursePatterns) {
      if (pat.test(text)) {
        const next = text.replace(pat, '').trim();
        if (next.length >= 5) {
          text = next;
          changed = true;
        }
      }
    }

    // 4. Strip stray section number leftovers like "- 01 - " or "01 - "
    const sectionMatch = text.match(/^[-–—:]*\s*\b(?:\d{1,2}[A-Z]?|ALL)\b\s*[-–—:]*\s*/i);
    if (sectionMatch && sectionMatch[0]) {
      const next = text.slice(sectionMatch[0].length).trim();
      if (next.length >= 5) {
        text = next;
        changed = true;
      }
    }
  }

  // Only strip title if it appears as an isolated header line followed by a newline, never if part of sentence!
  if (title && title.trim().length > 6) {
    const escapedTitle = title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const titleLinePat = new RegExp(`^\\s*${escapedTitle}\\s*\\r?\\n`, 'i');
    if (titleLinePat.test(text)) {
      const remainder = text.replace(titleLinePat, '').trim();
      if (remainder.length >= 5) {
        text = remainder;
      }
    }
  }

  // Final cleanup of leading punctuation
  text = text.replace(/^[:\-–—|,\s]+/, '').trim();

  // If cleaning somehow emptied the text or left it under 5 chars, return rawText to avoid losing content!
  return text.length >= 5 ? text : rawText.trim();
}

/**
 * Standardizes and normalizes course name and course code from task fields and text patterns.
 * Solves raw Ultra stream card strings (an assignment title in place of the course) by resolving
 * them to the student's own course names through their names and aliases, while preserving
 * custom edits made by the user.
 */
export function resolveCourseInfo(task: {
  courseName?: string;
  courseCode?: string;
  title?: string;
  description?: string;
  sourceSnippet?: string;
  notes?: string;
}): { courseName: string; courseCode: string } {
  let courseName = (task.courseName || '').trim();
  let courseCode = (task.courseCode || '').trim();
  const title = (task.title || '').trim();

  // Strip trailing stream card metadata
  courseName = courseName
    .replace(/(?:Report)?Due\s*date:.*$/gi, '')
    .replace(/New\s*Group\s*\d+/gi, '')
    .replace(/\(UTC[+-]?\d+\)/gi, '')
    .replace(/^[:\-–—|\s]+|[:\-–—|\s]+$/g, '')
    .trim();

  const userCourses = getActiveUserCourses();
  const isOwnCourse = (name: string) => {
    const lower = name.toLowerCase();
    return userCourses.some(c => (c.courseName || '').trim().toLowerCase() === lower);
  };

  const isGeneric = !courseName || 
                    courseName.toLowerCase() === 'uos' || 
                    courseName.toLowerCase() === 'course' || 
                    courseName.toLowerCase() === 'general course' ||
                    courseName === courseCode ||
                    isBlackboardSystemNoise(courseName);

  if (isGeneric) {
    // No usable course name: the student's course the code, title or text names
    const combined = `${courseCode} ${courseName} ${title} ${task.description || ''} ${task.sourceSnippet || ''} ${task.notes || ''}`;
    const match = findActiveCourseInText(combined);
    if (match) {
      courseName = match.courseName;
      courseCode = match.courseCode;
    } else if (courseName && isBlackboardSystemNoise(courseName)) {
      // A Blackboard navigation label is never a course
      courseName = '';
    }
  } else if (!isOwnCourse(courseName)) {
    // A raw Ultra stream string in place of the course ("Measuring Density - Lab Report") or a short
    // form of a course name: the student's course it names, from their names and aliases
    const match = findActiveCourseInText(courseName);
    if (match && match.courseName) {
      courseName = match.courseName;
      courseCode = match.courseCode || courseCode;
    }
  }

  // Clean UOS strings: Never return 'UOS' as a course code or course name!
  const finalName = (!courseName || courseName.toLowerCase() === 'uos') ? 'General Course' : courseName;
  const finalCode = (courseCode && courseCode.toUpperCase() !== 'UOS' && courseCode !== finalName) ? courseCode : '';

  return { courseName: finalName, courseCode: finalCode };
}

/**
 * Filters out empty or ghost tasks that lack a valid title or are meaningless artifacts
 * from stream submission receipts, grade notifications, score postings, or generic reminder text.
 */
/** True for presentation schedules ("Academic Article Presentations - Groups 9 & 10", "عرض تقديمي"). */
export function isPresentationTitle(title: string): boolean {
  return /\bpresentations?\b|عرض\s*تقديمي|عروض|مناقشة/i.test(title || '');
}

/**
 * Student notes are written only by the student. A task they never made or edited carries none
 * (older scans copied the AI's summary of the announcement into them), so any such notes are dropped.
 */
export function stripAutoNotes<T extends { notes?: string; userEdited?: boolean; extractedBy?: string }>(task: T): T {
  if (!task || !task.notes || task.userEdited || task.extractedBy === 'manual') return task;
  const { notes: _autoNotes, ...rest } = task;
  return rest as T;
}

/**
 * Detects whether a title indicates a post-exam review, paper viewing, Akkindi check, or grade dispute.
 */
export function isExamReviewTitle(title: string): boolean {
  if (!title) return false;
  const t = title.trim();
  // English patterns: e.g. "Exam sheet review", "Midterm paper viewing", "Quiz review", "Paper viewing", "Akkindi sheet"
  const enMatch = (
    /(?:\b(?:exam|quiz|test|midterm|final|paper|sheet|script)s?\s*(?:sheet\s*)?(?:reviews?|viewing|inspection|check)\b)/i.test(t) ||
    /(?:\b(?:review|viewing|inspection|checking)\s+(?:of\s+)?(?:the\s+)?(?:exam|quiz|test|midterm|final|paper|sheet|script)s?\b)/i.test(t) ||
    /(?:\b(?:paper|exam\s*sheet|quiz\s*sheet)\s*viewing\b)/i.test(t) ||
    /\bakkindi\b/i.test(t)
  );
  if (enMatch) return true;

  // Arabic patterns (Rule 2: never \b with Arabic characters)
  const arMatch = (
    /(?:^|[^\p{L}\p{N}])(?:مراجعة|الاطلاع\s*على|معاينة|رؤية|تظلمات?|الاعتراض\s*على)\s*(?:أوراق|ورقة|دفاتر|دفتر|درجات|درجة|علامات|علامة|نتائج)?\s*(?:(?:ال)?(?:امتحان|اختبار)\s*)?(?:ال)?(?:امتحان|اختبار|منتصف|ميدتيرم|كويز|فصل|إجابة|اجابة|بابل\s*شيت|فاينل)(?:$|[^\p{L}\p{N}])/iu.test(t) ||
    /(?:^|[^\p{L}\p{N}])(?:أوراق|ورقة|دفاتر|دفتر)\s*(?:الامتحان|الاختبار|المنتصف|الكويز|الإجابة)\s*(?:مراجعة|اطلاع|معاينة)(?:$|[^\p{L}\p{N}])/iu.test(t)
  );
  return arMatch;
}

/**
 * Detects whether text describes a post-exam review/viewing session, Akkindi sheet check,
 * self-grading against posted answers, or grade disputes.
 */
export function hasExamReviewContent(text: string): boolean {
  if (!text) return false;
  // English indicators
  const enMatch = (
    /\b(?:review|view|inspect|check|see)\s+(?:your\s+|the\s+)?(?:exam|quiz|test|midterm|final)\s*(?:sheet|paper|script)?s?\b/i.test(text) ||
    /\b(?:exam|quiz|test|midterm|final)\s+(?:sheet|paper|script)\s*reviews?\b/i.test(text) ||
    /\b(?:paper|exam\s*sheet|quiz\s*sheet|midterm\s*sheet)\s*viewing\b/i.test(text) ||
    /\bakkindi\s*(?:sheet|answer|key)?\b/i.test(text) ||
    /\bgrade\s+yourself\s+using\s+(?:the\s+)?correct\s+answers\b/i.test(text) ||
    /\bif\s+you\s+(?:still\s+)?believe\s+(?:that\s+)?your\s+grade\s+should\s+be\s+higher\b/i.test(text) ||
    /\bno\s+review\s+outside\s+this\s+time\b/i.test(text) ||
    /\bpost[\s-]*exam\s*(?:review|viewing|inspection)\b/i.test(text)
  );
  if (enMatch) return true;

  // Arabic indicators (no \b for Arabic)
  const arMatch = (
    /(?:مراجعة|الاطلاع\s*على|معاينة|رؤية)\s*(?:أوراق|ورقة|دفاتر|دفتر)?\s*(?:(?:ال)?(?:امتحان|اختبار)\s*)?(?:ال)?(?:امتحان|اختبار|منتصف|ميدتيرم|كويز|إجابة|اجابة|بابل\s*شيت)/iu.test(text) ||
    /لمن\s*(?:يرغب|يريد)\s*(?:في\s*)?(?:مراجعة|الاطلاع\s*على)\s*(?:ورقته|أوراقه|درجته|علامته|الامتحان|الاختبار)/iu.test(text) ||
    /نموذج\s*(?:الإجابة|الحل)\s*(?:لمراجعة|والاطلاع|لتصحيح)/iu.test(text) ||
    /(?:الاعتراض\s*على\s*(?:الدرجة|العلامة)|تظلمات?\s*(?:الامتحان|الاختبار|الدرجة))/iu.test(text)
  );
  return arMatch;
}

/**
 * Detects whether text mentions a genuine make-up exam to be taken.
 */
export function hasMakeupExamAction(text: string): boolean {
  if (!text) return false;
  return /(?:makeup\s+exam|make-up\s+exam|(?:ال)?امتحان\s+(?:ال)?تعويضي|(?:ال)?اختبار\s+(?:ال)?تعويضي|(?:ال)?امتحان\s+(?:ال)?بديل|إعادة\s+(?:امتحان|اختبار)\s+(?:ال)?منتصف)/iu.test(text);
}

/**
 * True when an announcement is dedicated to an exam review/viewing session without future assessments.
 */
export function isExamReviewSession(title: string, content: string = ''): boolean {
  const combined = `${title || ''}\n${content || ''}`.trim();
  if (!combined) return false;
  if (hasMakeupExamAction(combined)) return false;
  return isExamReviewTitle(title) || hasExamReviewContent(combined);
}

/**
 * True if a task was generated from a post-exam review/viewing session, Akkindi sheet check,
 * or grade dispute rather than a legitimate assessment.
 */
export function isExamReviewTask(task: {
  title?: string;
  type?: string;
  description?: string;
  sourceSnippet?: string;
}): boolean {
  if (!task) return false;
  const title = (task.title || '').trim();
  const desc = (task.description || '').trim();
  const snippet = (task.sourceSnippet || '').trim();
  const type = (task.type || '').toLowerCase();

  // 1. Title itself is explicitly an exam review/viewing title
  if (isExamReviewTitle(title)) {
    return true;
  }

  // 2. Task is an exam, quiz, other, or has a bare type title ("exam", "quiz", etc.),
  // and its description or snippet contains exam review / Akkindi content
  const isCandidate = type === 'exam' || type === 'quiz' || type === 'other' || isBareTypeTitle(title);
  if (isCandidate) {
    const textToCheck = `${snippet} ${desc}`.trim();
    if (hasExamReviewContent(textToCheck)) {
      if (hasMakeupExamAction(textToCheck) || hasMakeupExamAction(title)) {
        return false;
      }
      return true;
    }
  }

  return false;
}

export function isValidTask(task: {
  id?: string;
  title?: string;
  courseName?: string;
  courseCode?: string;
  description?: string;
  sourceSnippet?: string;
  userEdited?: boolean;
  extractedBy?: string;
  type?: string;
  submissionStatus?: string;
  gradeSourceId?: string;
  dueDate?: string;
}): boolean {
  if (!task || !task.title || !task.title.trim()) return false;
  // User-created or user-edited tasks are ALWAYS valid and must never be pruned
  if (task.userEdited || task.extractedBy === 'manual') return true;

  const isGradebookTask = Boolean(
    task.sourceSnippet === 'gradebook' ||
    task.gradeSourceId ||
    task.submissionStatus === 'graded' ||
    (typeof task.id === 'string' && task.id.startsWith('gbcol_'))
  );

  // Presentation schedules (who presents when) are not deadlines, however they were read
  if (isPresentationTitle(task.title)) return false;

  const titleLower = task.title.trim().toLowerCase();
  const desc = (task.description || '').trim();
  const snippet = (task.sourceSnippet || '').trim();

  // 1. Explicitly drop stream submission receipts or confirmation cards
  if (/(?:you\s+submitted|submission\s+(?:receipt|confirmed)|attempt\s+submitted|تم\s+التسليم|تم\s+إرسال|confirmation\s*number)/i.test(titleLower)) {
    return false;
  }

  // 2. Drop grade notifications and score postings
  if (!isGradebookTask && /(?:grade\s+posted|score\s+posted|graded|new\s+grade|grades\s+available|grades\s+released|تم\s+نشر\s+الدرجة|تم\s+رصد\s+الدرجة|درجة\s+جديدة|تم\s+تقييم)/i.test(titleLower)) {
    return false;
  }

  // 3. Drop tasks whose description or snippet is purely a grade fraction (e.g. ".25 / 10", "8.5 / 10")
  const isFractionOnly = (text: string) => /^["']?\s*\.?\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*["']?$/.test(text);
  if (isFractionOnly(desc) || isFractionOnly(snippet)) {
    return false;
  }

  // 3b. Drop tasks made from a stream card's posting time alone (e.g. "*Oct 18, 2026 2:20 PM",
  // "23 hours 3:00 PM"): older scans read the timestamp as the announcement and its due date.
  const isTimestampOnly = (text: string) => text !== '' &&
    /^[*\s]*(?:(?:\d+\s+(?:seconds?|minutes?|mins?|hours?|days?)|an?\s+(?:minute|hour|day)|yesterday|today|[A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4}|\d{1,2}\s+[A-Za-z]{3,9},?\s*\d{4})\s*)?(?:\d{1,2}:\d{2}\s*(?:AM|PM)?)?\s*$/i.test(text);
  if (isTimestampOnly(desc) && (snippet === '' || isTimestampOnly(snippet))) {
    return false;
  }

  // 4. Drop announcements reporting grades/marks without future deadlines
  // e.g. "درجة الكويز الأول", "درجات الاختبار", "Results of Midterm"
  const isGradeReportTitle = /(?:^|[^\p{L}\p{N}])(?:درجات|درجة|علامات|علامة|نتائج|النتائج|العلامات|الدرجات|grades?|marks?|scores?|results?|feedback)(?:$|[^\p{L}\p{N}])/iu.test(titleLower);
  if (!isGradebookTask && isGradeReportTitle) {
    const combinedContext = `${titleLower} ${desc} ${snippet}`;
    const hasFutureAction = /(?:submit\s+by|due\s+on|due\s+date|submission\s+deadline|makeup\s+exam|make-up\s+exam|تسليم\s+في|آخر\s+موعد|امتحان\s+تعويضي|اختبار\s+تعويضي)/iu.test(combinedContext);
    if (!hasFutureAction) {
      return false;
    }
  }

  // 4b. Drop tasks originating from post-exam review sessions, paper viewing, or grade disputes
  // (e.g. "review your exam sheet", "Akkindi sheet", "paper viewing", "مراجعة أوراق الامتحان")
  // where the exam is already over, unless there is an explicit makeup exam or submission deadline.
  if (isExamReviewTask(task)) {
    return false;
  }

  // 5. Generic placeholders
  const isGenericTitle = /^(?:assignment|untitled|due(?:\s+in.*)?|reminder|activity|announcement)$/i.test(titleLower);
  const isGenericCourse = !task.courseName || task.courseName === 'General Course' || task.courseName.toLowerCase() === 'uos';
  const isGenericCode = !task.courseCode || task.courseCode === 'UOS';
  if (isGenericTitle && isGenericCourse && isGenericCode) {
    return false;
  }

  // 5b. Scanned extras that are not graded work: tasks called only "Meeting" or "Other", and
  // any task read from an announcement as type "other" or "meeting" (office hours, paper
  // reviews, presentation schedules, start dates). Blackboard due-date items ("Due date: ...") stay.
  const isDueDateItem = /^due\s*date/i.test(snippet || desc);
  if (!isGradebookTask && !isDueDateItem && (/^(?:meeting|other|event|task|deadline)$/i.test(titleLower) || task.type === 'other' || task.type === 'meeting')) {
    return false;
  }
  return true;
}

/**
 * Ids of scanned tasks from before 1.1.x's naming fix whose title is only a type word
 * ("Exam", "Assignment", "Lab", "quiz") and that came from announcement text rather than a
 * Blackboard due-date item. The popup removes these once (see LEGACY_NAMELESS_CLEANUP_KEY).
 */
export function findLegacyNamelessTaskIds(tasks: Array<{
  id: string;
  title?: string;
  description?: string;
  sourceSnippet?: string;
  userEdited?: boolean;
  extractedBy?: string;
  gradeSourceId?: string;
  submissionStatus?: string;
}>): string[] {
  return tasks
    .filter(t => t && !t.userEdited && t.extractedBy !== 'manual' && isBareTypeTitle(t.title || ''))
    .filter(t => t.sourceSnippet !== 'gradebook' && !t.gradeSourceId && t.submissionStatus !== 'graded' && !(typeof t.id === 'string' && t.id.startsWith('gbcol_')))
    .filter(t => !/^due\s*date/i.test((t.sourceSnippet || t.description || '').trim()))
    .map(t => t.id);
}

/** True for titles that are only a task type word, such as "Exam", "Meeting" or "Other". */
export function isBareTypeTitle(title: string): boolean {
  return /^(?:assignment|homework|hw|exam|quiz|test|lab|meeting|other|project|presentation|task|event|deadline)$/i.test(title.trim());
}

/**
 * Checks if a task matches the selected course filter (handles code, name, or regex pattern).
 */
export function matchesSelectedCourseFilter(task: {
  courseName?: string;
  courseCode?: string;
  title?: string;
}, filter: string | null): boolean {
  if (!filter) return true;
  const { courseName, courseCode } = resolveCourseInfo(task);
  if (
    task.courseName === filter ||
    task.courseCode === filter ||
    courseName === filter ||
    courseCode === filter
  ) {
    return true;
  }
  const activeLegend = getActiveCourseLegend();
  const legendItem = activeLegend.find(c => c.name === filter || c.code === filter);
  if (legendItem) {
    const combined = `${task.courseName || ''} ${task.courseCode || ''} ${courseName || ''} ${courseCode || ''} ${task.title || ''}`;
    if (legendItem.pattern.test(combined)) {
      return true;
    }
  }
  return false;
}

