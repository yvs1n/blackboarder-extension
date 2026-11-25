import { Announcement, DeadlineTask, TaskType, TaskPriority } from '../types';
import { resolveTaskWeight } from '../core/syllabusWeights';
import { resolveTaskTimeWithSchedule, resolveTaskRoom, extractRoomFromText } from '../core/courseSchedule';
import {
  sanitizeDoctorAnnouncementText,
  isBareTypeTitle,
  isExamReviewTitle,
  hasExamReviewContent,
  hasMakeupExamAction,
  isExamReviewSession,
  toEnglishDeadlineTitle
} from '../core/courseHelper';
import { parseDateString, parseTime } from './localDateTime';
import { isTopicCoverageOnlyLine } from '../core/announcementReconcile';

const ORDINAL_NUM_MAP: Record<string, string> = {
  '1st': '1', first: '1',
  '2nd': '2', second: '2',
  '3rd': '3', third: '3',
  '4th': '4', fourth: '4'
};

// Keyword patterns for task type identification (supporting English and Arabic)
const TASK_TYPE_PATTERNS: Array<{ type: TaskType; regex: RegExp; priority: TaskPriority }> = [
  {
    type: 'quiz',
    regex: /(?:\b((?:(?:1st|first|2nd|second|3rd|third|4th|fourth)\s+)?(?:pop\s*)?quiz(?:\s*#?\s*\d+)?)\b|(?:كويز(?:\s*(?:\d+|أول|ثاني|ثالث|رابع|الأول|الثاني|الثالث|الرابع))?|اختبار\s*قصير(?:\s*\d+)?))/i,
    priority: 'high'
  },
  {
    type: 'exam',
    regex: /(?:\b((?:(?:1st|first|2nd|second|3rd|third)\s+)?(?:midterm(?:\s*exam(?:ination)?)?|final\s*exam(?:ination)?|major\s*exam(?:ination)?|make-?up\s*exam(?:ination)?|preliminary\s*exam(?:ination)?|practical\s*exam(?:ination)?|theoretical\s*exam(?:ination)?|lab(?:oratory)?\s*final\s*exam(?:ination)?|exam(?:ination)?(?:\s*#?\s*\d+)?))\b|(?:امتحان(?:\s*(?:نصفي|نهائي|تعويضي|عملي|نظري|أول|ثاني|ثالث|الأول|الثاني|الثالث|\d+))?|اختبار(?:\s*(?:نصفي|نهائي|تعويضي))?))/i,
    priority: 'high'
  },
  {
    type: 'assignment',
    regex: /(?:\b((?:assignment|homework|hw|problem\s*set|worksheet)(?:\s*#?\s*\d+)?)\b|(?:واجب(?:\s*\d+)?|تمرين(?:\s*\d+)?|ورقة\s*عمل(?:\s*\d+)?))/i,
    priority: 'medium'
  },
  {
    type: 'project',
    regex: /(?:\b(project(?:\s*(?:phase|milestone|submission|report|#?\s*\d+))?|term\s*paper|research\s*paper|capstone)\b|(?:مشروع(?:\s*(?:التخرج|\d+))?|(?:ال)?بحث(?:\s*(?:العلمي|الأكاديمي|الجماعي))+))/i,
    priority: 'high'
  },
  {
    type: 'lab',
    regex: /(?:\b(lab(?:oratory)?(?:\s*(?:report|exam|quiz|test|submission|practical|#?\s*\d+))?)\b|(?:مختبر(?:\s*\d+)?|تقرير\s*مختبر))/i,
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
 * Extracts a concise task title from the surrounding text snippet.
 */
function extractTaskTitle(sentence: string, taskType: TaskType): string {
  const clean = sentence.replace(/\s+/g, ' ').trim();

  // Ordinal + assessment noun ("2nd quiz", "second midterm", "1st assignment")
  const ordMatch = clean.match(/\b(1st|first|2nd|second|3rd|third|4th|fourth)\s+(quiz|midterm(?:\s+exam)?|exam|assignment|hw|homework|lab(?:\s+report)?|project)\b/i);
  if (ordMatch) {
    const num = ORDINAL_NUM_MAP[ordMatch[1].toLowerCase()];
    const noun = ordMatch[2].replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());
    if (num) return toEnglishDeadlineTitle(`${noun} ${num}`, taskType);
  }

  // English title label like "Quiz 2", "Assignment-1", "Lab Report 2", "Makeup Exam", "Final Examination"
  const specificMatch = clean.match(/\b((?:Lab(?:oratory)?\s+Final\s+Exam(?:ination)?|Final\s+Exam(?:ination)?|Midterm\s+Exam(?:ination)?|Make-?up\s+Exam(?:ination)?|Practical\s+Exam(?:ination)?|Theoretical\s+Exam(?:ination)?|Lab\s+Report|Lab\s+Exam(?:ination)?|Pop\s+Quiz|Research\s+Paper|Term\s+Paper|Quiz|Assignment|HW|Homework|Exam(?:ination)?|Midterm|Project|Lab)(?:[\s-]+(?:#?\d+|Part\s*\d+|Phase\s*\d+|Proposal|Final|[A-Z]\b))?)/i);
  if (specificMatch && specificMatch[1].length > 2) {
    const normalized = specificMatch[1]
      .replace(/\bExamination\b/gi, 'Exam')
      .replace(/\bLaboratory\s+Final\s+Exam\b/gi, 'Final Exam')
      .replace(/[-–]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return toEnglishDeadlineTitle(normalized, taskType);
  }

  // Arabic title label like "كويز 1", "الواجب الأول", "امتحان نصفي", "امتحان تعويضي", "البحث العلمي"
  const arTitleMatch = clean.match(/(?:(?:ال)?بحث(?:\s*(?:العلمي|الأكاديمي|الجماعي))+|(?:كويز|واجب|امتحان|مشروع|اختبار)(?:\s*(?:الأول|الثاني|الثالث|الرابع|النهائي|النصفي|تعويضي|\d+))?)/i);
  if (arTitleMatch && arTitleMatch[0].length > 2) {
    return toEnglishDeadlineTitle(arTitleMatch[0].trim(), taskType);
  }

  return taskType.charAt(0).toUpperCase() + taskType.slice(1);
}

function computeLocalConfidence(params: {
  hasSpecificTime: boolean;
  hasExplicitRoom: boolean;
  hasSpecificTitle: boolean;
  text: string;
}): number {
  let score = 0.84;
  if (params.hasSpecificTime) score += 0.05;
  if (params.hasExplicitRoom) score += 0.03;
  if (params.hasSpecificTitle) score += 0.03;
  if (/(?:\broom|\bhall|\blocation|\bvenue|\bheld\s+in|قاعة|مختبر)/i.test(params.text) && !params.hasExplicitRoom) {
    score -= 0.14;
  }
  if (/(?:\btime|\btiming|\bat\s+\d|الساعة|الوقت)/i.test(params.text) && !params.hasSpecificTime) {
    score -= 0.12;
  }
  if (/\b(?:either|or\s+(?:maybe|tentatively)|tentative|postponed|rescheduled|to\s+be\s+confirmed|tbd)\b/i.test(params.text)) {
    score -= 0.12;
  }
  return Math.max(0.4, Math.min(0.96, Number(score.toFixed(2))));
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
  const isGradeTitle = /(?:^|[^\p{L}\p{N}])(?:درجات|درجة|علامات|علامة|نتائج|النتائج|العلامات|الدرجات|grades?|marks?|scores?|results?|solutions?|answer\s*keys?|feedback)(?:$|[^\p{L}\p{N}])/iu.test(announcement.title) &&
    !/\b(?:out\s+of\s+\d+|\d+(?:\.\d+)?\s*(?:marks?|pts?|points?)|\(\s*\d+(?:\.\d+)?\s*(?:marks?|pts?|points?)\s*\)|total\s+marks?|marks?\s+distribution)\b/iu.test(announcement.title);
  const isGradeAnnouncement = (
    isGradeTitle ||
    /(?:grades?|marks?|scores?)\s+(?:are\s+)?(?:posted|uploaded|available|published|announced|released)|(?:تم\s+نشر|تم\s+رصد|تم\s+تنزيل|معلنة|مرفوعة)\s+(?:الدرجات|العلامات|النتائج|درجة|علامة)/iu.test(cleanContent)
  );

  const hasFutureDeadlineAction = /(?:submit\s+by|due\s+on|due\s+date|submission\s+deadline|makeup\s+exam|make-up\s+exam|تسليم\s+في|آخر\s+موعد|امتحان\s+تعويضي|اختبار\s+تعويضي)/iu.test(cleanContent);
  const hasUpcomingAssessmentSchedule = hasFutureDeadlineAction ||
    /\b(?:will\s+be\s+(?:held|conducted|given|administered|taken|on)|scheduled\s+(?:for|on)|takes?\s+place\s+on|covers?\s+(?:the\s+following\s+)?topics?)\b/iu.test(`${announcement.title}\n${cleanContent}`);

  if (isGradeAnnouncement && !hasUpcomingAssessmentSchedule) {
    return [];
  }

  // 2b. Filter out announcements dedicated to post-exam paper reviews, viewing sessions, or Akkindi sheet checks
  if (isExamReviewSession(announcement.title, cleanContent) && !hasFutureDeadlineAction) {
    return [];
  }

  const text = `${announcement.title}\n${cleanContent}`;

  // Break text into sentences or lines (split on every line break as well as punctuation)
  const sentences = text
    .split(/\r?\n+|(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 4);

  const tasks: DeadlineTask[] = [];
  const detectedKeys = new Set<string>();

  // Remember the latest concrete assessment mentioned in heading or earlier lines
  // (e.g. "Quiz 2 covers the following topics:\n- Ch 1\n- Ch 2\nDate: 18/11")
  let contextType: TaskType | null = null;
  let contextPriority: TaskPriority = 'medium';
  let contextTitle = '';
  for (const pattern of TASK_TYPE_PATTERNS) {
    if (pattern.type !== 'meeting' && pattern.type !== 'other' && pattern.regex.test(announcement.title || '')) {
      contextType = pattern.type;
      contextPriority = pattern.priority;
      contextTitle = extractTaskTitle(announcement.title || '', pattern.type);
      break;
    }
  }

  let inCoverageList = false;
  const COVERAGE_HEADER_RE = /\b(?:coverage|will\s+cover\s+(?:all\s+)?(?:the\s+)?(?:following|laboratory\s+)?(?:experiments?|topics?|chapters?|labs?)|experiments?\s+listed\s+below|topics?\s+listed\s+below|covered\s+experiments?)\b|المواضيع\s+المطلوبة|التجارب\s+المطلوبة/i;
  const EXPLICIT_SCHEDULE_CUE_RE = /\b(?:due\s+(?:on|by|date)|submit\s+by|submission\s+deadline|will\s+be\s+held\s+on|scheduled\s+(?:for|on))\b|آخر\s+موعد|تسليم\s+في/i;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    if (COVERAGE_HEADER_RE.test(sentence) && !EXPLICIT_SCHEDULE_CUE_RE.test(sentence)) {
      inCoverageList = true;
      continue;
    }
    if (inCoverageList) {
      if (EXPLICIT_SCHEDULE_CUE_RE.test(sentence)) {
        inCoverageList = false;
      } else if (/^(?:\d+[\.\)]\s+|[-•*]\s+|(?:experiment|lab|chapter|topic)\s*\d+)/i.test(sentence)) {
        continue;
      }
    }
    // Skip sentences that announce post-exam paper reviews, viewing sessions, or Akkindi sheet checks,
    // or pure topic coverage date mentions ("covers lectures from Oct 5") without a schedule cue
    if (
      (hasExamReviewContent(sentence) && !hasMakeupExamAction(sentence) && !/(?:submit\s+by|due\s+on|due\s+date|submission\s+deadline|تسليم\s+في|آخر\s+موعد)/iu.test(sentence)) ||
      isTopicCoverageOnlyLine(sentence)
    ) {
      continue;
    }
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
    if (sentenceType && sentenceType !== 'meeting' && sentenceType !== 'other') {
      const candidateTitle = extractTaskTitle(sentence, sentenceType);
      contextType = sentenceType;
      contextPriority = basePriority;
      if (!isBareTypeTitle(candidateTitle) || !contextTitle) {
        contextTitle = candidateTitle;
      }
    }

    // If no explicit task keyword, check announcement title or earlier lines in the body
    if (!matchedType) {
      for (const pattern of TASK_TYPE_PATTERNS) {
        if (pattern.regex.test(announcement.title)) {
          matchedType = pattern.type;
          basePriority = pattern.priority;
          break;
        }
      }
    }
    if (!matchedType && contextType) {
      matchedType = contextType;
      basePriority = contextPriority;
    }

    // If still no keyword or general deadline trigger, continue
    if (!matchedType && !/\b(?:due|deadline|submission)\b|تسليم|موعد/i.test(sentence)) {
      continue;
    }

    let effectiveType: TaskType = matchedType || 'other';

    // Availability/start-date-only lines without a real due/assessment word are not due deadlines
    if (
      /\b(?:start\s*date|opens?\s+on|available\s+(?:from|starting)|unlocks?\s+on)\b/i.test(sentence) &&
      !/\b(?:due|deadline|submit|held|conducted|will\s+be\s+on|closes?\s+on|ends?\s+on|until)\b/i.test(sentence) &&
      !/\b(?:quiz|exam|midterm|final|test)\b.*\b\d{1,2}:\d{2}\b/i.test(sentence)
    ) {
      continue;
    }

    // Attempt date extraction from this sentence
    const dateMatch = parseDateString(sentence, baseDate);
    if (!dateMatch) {
      continue;
    }

    // Build bounded multi-line block around this sentence so separate "Date:", "Time:", "Room:" lines pair together
    const blockLines = [sentence];
    for (let j = i + 1; j < Math.min(sentences.length, i + 4); j++) {
      const nextLine = sentences[j];
      const nextDate = parseDateString(nextLine, baseDate);
      if (nextDate && nextDate.date.toDateString() !== dateMatch.date.toDateString()) break;
      const nextType = TASK_TYPE_PATTERNS.find(p => p.type !== 'other' && p.type !== 'meeting' && p.regex.test(nextLine));
      if (nextType) {
        const nextTitle = extractTaskTitle(nextLine, nextType.type);
        const curTitle = extractTaskTitle(sentence, effectiveType);
        if (!isBareTypeTitle(nextTitle) && nextTitle.toLowerCase() !== curTitle.toLowerCase()) break;
      }
      blockLines.push(nextLine);
    }
    const blockText = blockLines.join('\n');

    if (!dateMatch.hasSpecificTime && blockLines.length > 1) {
      const blockTime = parseTime(blockText);
      if (blockTime.hasTime) {
        dateMatch.date.setHours(blockTime.hour, blockTime.minute, 0, 0);
        dateMatch.hasSpecificTime = true;
      }
    }

    // Naming. A sentence that only has a date ("Date: Thursday 22 October", "Start date is
    // Sept 4") borrows a specific name from earlier context or the announcement heading. Office
    // hours, class meetings, presentation schedules and unnamed "other" dates are skipped.
    let title = extractTaskTitle(sentence, effectiveType);
    if (effectiveType === 'meeting') {
      continue;
    }
    if (isBareTypeTitle(title) && (sentenceType !== effectiveType || effectiveType === 'other')) {
      const fromContext = contextTitle || extractTaskTitle(announcement.title || '', effectiveType);
      if (isExamReviewTitle(fromContext)) continue;
      if (isBareTypeTitle(fromContext) && effectiveType !== 'quiz' && effectiveType !== 'exam') continue;
      title = fromContext;
      const contextHeadingType = TASK_TYPE_PATTERNS.find(p => p.type !== 'other' && p.regex.test(fromContext));
      if (contextHeadingType) effectiveType = contextHeadingType.type;
    }
    title = toEnglishDeadlineTitle(title, effectiveType);
    // Dates that are not graded work ("other") are left out; the AI tier may still name them.
    if (effectiveType === 'other') continue;

    // Avoid duplicates for the same course + type + item number + date
    const titleNumMatch = title.match(/\b(\d+)\b/);
    const dateKey = `${announcement.courseCode}_${effectiveType}_${titleNumMatch ? `${titleNumMatch[1]}_` : ''}${dateMatch.date.toDateString()}`;
    if (detectedKeys.has(dateKey)) {
      continue;
    }
    detectedKeys.add(dateKey);

    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Time adjustment: if teacher gave a specific time, preserve it.
    // If no specific time was stated, resolve to the exact class time from the student's schedule.
    const scheduleResult = resolveTaskTimeWithSchedule({
      dueDate: dateMatch.date,
      courseNameOrCode: announcement.courseName || announcement.courseCode,
      hasSpecificTime: dateMatch.hasSpecificTime,
      announcementText: blockText || cleanContent || sentence,
      title
    });
    const finalDate = scheduleResult.dueDate;
    const hasSpecificTime = scheduleResult.hasSpecificTime;
    const timeSource: DeadlineTask['timeSource'] = dateMatch.hasSpecificTime
      ? 'explicit'
      : scheduleResult.appliedSchedule ? 'schedule' : 'default';

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

    const explicitBlockRoom = extractRoomFromText(blockText);
    const roomAnnouncementText = explicitBlockRoom
      ? blockText
      : `${announcement.title || ''}\n${cleanContent || sentence}`.trim();
    const roomInfo = resolveTaskRoom({
      courseNameOrCode: announcement.courseName || announcement.courseCode,
      announcementText: roomAnnouncementText,
      title,
      type: effectiveType
    });

    const confidence = computeLocalConfidence({
      hasSpecificTime: dateMatch.hasSpecificTime,
      hasExplicitRoom: Boolean(explicitBlockRoom || extractRoomFromText(roomAnnouncementText)),
      hasSpecificTitle: !isBareTypeTitle(title),
      text: `${announcement.title || ''}\n${blockText}`
    });

    tasks.push({
      id: taskId,
      announcementId: announcement.id,
      ...(announcement.postedAt ? { announcementPostedAt: announcement.postedAt } : {}),
      courseCode: announcement.courseCode,
      courseName: announcement.courseName,
      title,
      description: doctorAnnouncementText,
      dueDate: finalDate.toISOString(),
      hasSpecificTime,
      timeSource,
      type: effectiveType,
      priority,
      status: 'pending',
      sourceSnippet: doctorAnnouncementText,
      confidence,
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
