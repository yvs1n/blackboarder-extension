import { PERMANENT_COURSE_LEGEND } from './courseColors';
import { getActiveCourseLegend, getActiveUserCourses, compileCoursePattern } from './userCourses';

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
  return /^(?:\d{4}\s*\d{3}(?:\s+\d{1,3}[A-Z]?)?|\d{7}|[A-Z]{2,5}\s*[-]?\s*\d{3,4}[A-Z]?)$/i.test(clean);
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

  // Recognize known Physics 1 Lab assignments/reports
  if (/measuring\s*density|free\s*fall|lab\.?\s*report|student's\s*lab/i.test(clean)) {
    return { code: '1430116', name: 'Physics 1 Lab' };
  }

  // Remove semester/term tags like "(Spring 2026)", "Fall 2025", "- Fall 2025/2026"
  clean = clean
    .replace(/\((?:Spring|Fall|Summer|Winter|Term|Semester)[^)]*\)/gi, '')
    .replace(/(?:[-–|]\s*)?(?:Spring|Fall|Summer|Winter|Term|Semester)\s*\d{2,4}(?:\/\d{2,4})?\b/gi, '')
    .trim();

  // Match Course Code: 7-digit UOS code (e.g. 0401201) or Letter+Digits (e.g. CS101, MATH201)
  let code = 'UOS';
  const codeMatch = clean.match(/\b([0-9]{7}|[A-Z]{2,4}\s*[0-9]{3,4})\b/i);
  if (codeMatch) {
    code = codeMatch[1].replace(/\s+/g, '');
  }

  // If string contains multiple segments like "Calculus I for Engineering - 02 - حسبان 1 للمهندسين"
  // or "0401201 - Computer Programming"
  const parts = clean.split(/\s*[-–|]\s*/).map(p => p.trim()).filter(Boolean);
  let name = '';

  for (const part of parts) {
    // Check if this part is just a section number (e.g. "02", "13A", "ALL", "1") or just the code
    const isSectionOrCode = /^(?:\d{1,7}[A-Z]?|ALL|SEC\b.*)$/i.test(part) || part === code;
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

  // System navigation tabs (Content, Calendar, Discussions, Gradebook, etc.) are never courses
  if (code === 'UOS' && isBlackboardSystemNoise(name)) {
    return { code: 'UOS', name: 'General Course' };
  }

  return { code, name };
}

/**
 * Strips Blackboard system noise (posted timestamps like "1:21 PM\n" or "14 minutes ago\n",
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

  // Known course header banners appearing at top of stream cards
  const knownCoursePatterns = [
    /^\s*(?:Introduction\s+to\s+Computer\s+Eng(?:\.|ineering)?|مقدمة\s+في\s+هندسة\s+الحاسوب)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*(?:مقدمة\s+في\s+هندسة\s+الحاسوب|Introduction\s+to\s+Computer\s+Eng(?:\.|ineering)?)?\s*[-–—:]*\s*/i,
    /^\s*(?:Calculus\s+I\s+(?:for\s+Engineering)?|حسبان\s*1(?:\s*للمهندسين)?)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*(?:حسبان\s*1(?:\s*للمهندسين)?|Calculus\s+I\s+(?:for\s+Engineering)?)?\s*[-–—:]*\s*/i,
    /^\s*(?:Physics\s*1\s*Lab|مختبر\s*فيزياء\s*1|فيزياء\s*1\s*عملي)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*/i,
    /^\s*(?:Physics\s*1|General\s*Physics\s*1|فيزياء\s*1|فيزياء\s*عامة\s*1)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*/i,
    /^\s*(?:English\s+for\s+Academic\s+Purposes|EAP|إنجليزي|انجليزي)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*/i,
    /^\s*(?:Islamic\s+Culture|ثقافة\s*إسلامية|ثقافة\s*اسلامية)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*/i
  ];

  // Specific course name or code passed from context
  const dynamicCoursePatterns: RegExp[] = [];
  if (courseName && courseName !== 'General Course' && courseName.trim().length > 3) {
    const escaped = courseName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    dynamicCoursePatterns.push(new RegExp(`^\\s*${escaped}\\s*[-–—:]*\\s*(?:\\b\\d{1,2}[A-Z]?\\b)?\\s*[-–—:]*`, 'i'));
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
 * Solves raw Ultra stream card strings (e.g. "Measuring Density...", "Topic of a paragraph...")
 * by resolving to official course titles ("Physics 1 Lab", "English for Academic Purposes")
 * while preserving custom edits made by the user.
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

  // Fix messy Ultra stream direct assignments
  if (/measuring\s*density/i.test(courseName) || /measuring\s*density/i.test(title)) {
    courseName = 'Physics 1 Lab';
    courseCode = '1430116';
  } else if (/free\s*fall/i.test(courseName) || /free\s*fall/i.test(title)) {
    courseName = 'Physics 1 Lab';
    courseCode = '1430116';
  } else if (/vectors?\s*exp/i.test(courseName) || /vectors?\s*exp/i.test(title)) {
    courseName = 'Physics 1 Lab';
    courseCode = '1430116';
  } else if (/lab\.?\s*report/i.test(courseName) || /student's\s*lab/i.test(courseName)) {
    courseName = 'Physics 1 Lab';
    courseCode = '1430116';
  } else if (/topic\s*of\s*a\s*paragraph/i.test(courseName) || /topic\s*of\s*a\s*paragraph/i.test(title)) {
    courseName = 'English for Academic Purposes';
    courseCode = '0202112';
  } else {
    // Strip trailing stream card metadata
    courseName = courseName
      .replace(/(?:Report)?Due\s*date:.*$/gi, '')
      .replace(/New\s*Group\s*\d+/gi, '')
      .replace(/\(UTC[+-]?\d+\)/gi, '')
      .replace(/^[:\-–—|\s]+|[:\-–—|\s]+$/g, '')
      .trim();
  }

  const isGeneric = !courseName || 
                    courseName.toLowerCase() === 'uos' || 
                    courseName.toLowerCase() === 'course' || 
                    courseName.toLowerCase() === 'general course' ||
                    courseName === courseCode;

  if (isGeneric) {
    const combined = `${courseCode} ${courseName} ${title} ${task.description || ''} ${task.sourceSnippet || ''} ${task.notes || ''}`;
    const userCourses = getActiveUserCourses();
    let matched = false;

    // First check Physics 1 Lab specifically if lab is mentioned
    if (/(?:phys(?:ics)?.*lab|lab.*phys(?:ics)?|مختبر.*فيزياء|1430116)/i.test(combined)) {
      const labCourse = userCourses.find(c => c.id === 'phy1lab' || /lab/i.test(c.courseName));
      if (labCourse) {
        courseName = labCourse.courseName;
        courseCode = labCourse.courseCode;
        matched = true;
      }
    }

    if (!matched) {
      for (const uc of userCourses) {
        if (uc.id === 'phy1' && /(?:lab|مختبر|عملي)/i.test(combined)) {
          continue;
        }
        const pat = compileCoursePattern(uc);
        if (pat.test(combined)) {
          courseName = uc.courseName;
          courseCode = uc.courseCode;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      if (/(?:intro.*comp|comp(?:uter)?\s*eng|هندسة.*حاسوب|حاسوب|1502101|0402101)/i.test(combined)) {
        courseName = 'Introduction to Computer Eng.';
        courseCode = '1502101';
      } else if (/(?:calculus|calc\b|حسبان|1440133|1440131|0401101)/i.test(combined)) {
        courseName = 'Calculus I for Engineering';
        courseCode = '1440133';
      } else if (/(?:english|eap\b|academic\s*purposes|academic\s*english|إنجليزي|انجليزي|0202112)/i.test(combined)) {
        courseName = 'English for Academic Purposes';
        courseCode = '0202112';
      } else if (/(?:phys(?:ics)?.*lab|lab.*phys(?:ics)?|مختبر.*فيزياء|1430116)/i.test(combined)) {
        courseName = 'Physics 1 Lab';
        courseCode = '1430116';
      } else if (/(?:physics\s*1(?!\s*lab)|general\s*physics\s*1|فيزياء\s*1|1430115)/i.test(combined)) {
        courseName = 'Physics 1';
        courseCode = '1430115';
      } else if (/(?:islamic|إسلام|اسلام|ثقافة|0104100)/i.test(combined)) {
        courseName = 'Islamic Culture';
        courseCode = '0104100';
      }
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
export function isValidTask(task: {
  title?: string;
  courseName?: string;
  courseCode?: string;
  description?: string;
  sourceSnippet?: string;
  userEdited?: boolean;
  extractedBy?: string;
  type?: string;
}): boolean {
  if (!task || !task.title || !task.title.trim()) return false;
  // User-created or user-edited tasks are ALWAYS valid and must never be pruned
  if (task.userEdited || task.extractedBy === 'manual') return true;

  const titleLower = task.title.trim().toLowerCase();
  const desc = (task.description || '').trim();
  const snippet = (task.sourceSnippet || '').trim();

  // 1. Explicitly drop stream submission receipts or confirmation cards
  if (/(?:you\s+submitted|submission\s+(?:receipt|confirmed)|attempt\s+submitted|تم\s+التسليم|تم\s+إرسال|confirmation\s*number)/i.test(titleLower)) {
    return false;
  }

  // 2. Drop grade notifications and score postings
  if (/(?:grade\s+posted|score\s+posted|graded|new\s+grade|grades\s+available|grades\s+released|تم\s+نشر\s+الدرجة|تم\s+رصد\s+الدرجة|درجة\s+جديدة|تم\s+تقييم)/i.test(titleLower)) {
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
  if (isGradeReportTitle) {
    const combinedContext = `${titleLower} ${desc} ${snippet}`;
    const hasFutureAction = /(?:submit\s+by|due\s+on|due\s+date|submission\s+deadline|makeup\s+exam|make-up\s+exam|تسليم\s+في|آخر\s+موعد|امتحان\s+تعويضي|اختبار\s+تعويضي)/iu.test(combinedContext);
    if (!hasFutureAction) {
      return false;
    }
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
  if (!isDueDateItem && (/^(?:meeting|other|event|task|deadline)$/i.test(titleLower) || task.type === 'other' || task.type === 'meeting')) {
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
}>): string[] {
  return tasks
    .filter(t => t && !t.userEdited && t.extractedBy !== 'manual' && isBareTypeTitle(t.title || ''))
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
  const legendItem = activeLegend.find(c => c.name === filter || c.code === filter) ||
                     PERMANENT_COURSE_LEGEND.find(c => c.name === filter || c.code === filter);
  if (legendItem) {
    const combined = `${task.courseName || ''} ${task.courseCode || ''} ${courseName || ''} ${courseCode || ''} ${task.title || ''}`;
    if (legendItem.pattern.test(combined)) {
      return true;
    }
  }
  return false;
}

