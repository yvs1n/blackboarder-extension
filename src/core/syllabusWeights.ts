import { TaskType } from '../types';
import { getActiveSyllabi, pickCourseMatch } from './userCourses';

export interface SyllabusComponent {
  id: string;
  name: string;
  type: TaskType;
  totalWeight: number; // e.g. 20 for 20%
  count?: number; // e.g. 4 for 4 quizzes
  outOf?: number; // items held when only the best `count` count ("best 2 of 3")
  unitWeight?: number; // e.g. 5 for 5% each
  note?: string; // e.g. "Weeks 4, 6, 9, 11 (5% each)"
  matcher: RegExp;
}

export interface CourseSyllabus {
  courseId: string;
  courseName: string;
  courseCodePattern: RegExp;
  sourcePdf: string;
  totalWeight: number; // 100
  creditHours?: number;
  components: SyllabusComponent[];
}

export interface ResolvedWeight {
  weight?: number;
  weightDisplay?: string;
  syllabusNote?: string;
  componentName?: string;
}

/**
 * Extracts direct numeric point/grade values mentioned in task title or snippet.
 * Examples: "البحث العلمي (واجب جماعي) 15 درجة" -> 15
 *           "Assignment 1 (10%)" -> 10
 *           "Quiz 2 - 5 marks" -> 5
 */
export function extractExplicitPoints(text: string): number | null {
  if (!text) return null;

  // Arabic: "15 درجة" or "10 درجات" or "5 علامات"
  const arabicMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:درجة|درجات|علامة|علامات)/);
  if (arabicMatch) {
    const val = parseFloat(arabicMatch[1]);
    if (val > 0 && val <= 100) return val;
  }

  // English percentage: "15%" or "15 percent"
  // "%" is not a word character, so a trailing \b never matched "(10%)" or "10% of"
  const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent\b)/i);
  if (percentMatch) {
    const val = parseFloat(percentMatch[1]);
    if (val > 0 && val <= 100) return val;
  }

  // English marks / points: "15 marks" or "10 points" or "5 pts"
  const marksMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:marks?|points?|pts?)\b/i);
  if (marksMatch) {
    const val = parseFloat(marksMatch[1]);
    if (val > 0 && val <= 100) return val;
  }

  return null;
}

/**
 * A weight stated in announcement text. Unlike a title, a body mentions many numbers
 * ("your final exam will be out of 75%"), so a percentage only counts when the wording ties
 * it to the item: "worth 15%", "15% of the grade", "counts for 15%", "carries 15 marks".
 */
export function extractStatedWeight(text: string): number | null {
  if (!text) return null;
  const num = '(\\d+(?:\\.\\d+)?)';
  const unit = '\\s*(?:%|percent\\b|marks?\\b|points?\\b)';
  const patterns = [
    new RegExp(`(?:worth|weigh(?:s|ted|ing)?|carr(?:y|ies|ying)|counts?\\s+(?:for|as)|accounts?\\s+for|constitutes?|contributes?)\\s+(?:of\\s+|for\\s+|about\\s+|up\\s+to\\s+)?${num}${unit}`, 'i'),
    new RegExp(`${num}\\s*%\\s+of\\s+(?:the|your)\\s+(?:total\\s+|overall\\s+|final\\s+|course\\s+)?(?:grade|mark|score)`, 'i'),
    new RegExp(`(?:weight|weightage)\\s*(?:is|of|:)?\\s*${num}\\s*%`, 'i')
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const val = parseFloat(m[1]);
      if (val > 0 && val <= 100) return val;
    }
  }
  return null;
}

/**
 * Finds the syllabus of the student's course by course name/code.
 */
export function findCourseSyllabus(courseName: string = '', courseCode: string = ''): CourseSyllabus | null {
  const combined = `${courseName} ${courseCode}`.trim();
  if (!combined) return null;

  // Only the student's own courses carry a syllabus; a lab course wins text that mentions a lab
  return pickCourseMatch(getActiveSyllabi(), combined, s => s.courseCodePattern, s => s.courseName);
}

/**
 * Resolves the syllabus weight for a given task based on course and title.
 * Supports passing a task object OR (course, title, type, notes) parameters.
 */
/**
 * Extracts assessment sequence number from title or context (e.g. "Quiz 2" -> 2, "2nd Quiz" -> 2, "HW 1" -> 1).
 * Normalizes English, Arabic, Roman numerals, and word ordinals while ignoring secondary topic numbers.
 */
export function extractAssessmentNumber(title: string, context?: string): number | null {
  if (!title && !context) return null;

  // Strip weight and percentage mentions so "Midterm worth 25%" or "Quiz (10%)" is not treated as number 25 or 10
  const combined = `${title || ''} ${context || ''}`
    .replace(/\bworth\s*\d+(?:\.\d+)?%?/gi, ' ')
    .replace(/(?:بنسبة|وزن)?\s*\d+(?:\.\d+)?%/gi, ' ')
    .replace(/\(\s*\d+(?:\.\d+)?\s*%\s*\)/gi, ' ')
    .trim();

  // 1. Explicit numbering attached to keyword: "Quiz 2", "Quiz #2", "Quiz (1)", "Quiz [2]", "Quiz - 2", "HW2", "Assignment 2", "Lab 2", "كويز 2"
  const m = combined.match(/(?:quiz|test|exam|midterm|assignment|hw|homework|lab|report|activity|task|كويز|اختبار|امتحان|واجب|تقرير|مشروع)[^0-9a-z\u0600-\u06ff\n]*#?\s*\(?\s*(\d+|[١-٩]|١٠)(?:[^0-9a-z\u0600-\u06ff]|$)\s*\)?/i);
  if (m) {
    const raw = m[1];
    const arDigits: Record<string, number> = { '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9, '١٠': 10 };
    const num = arDigits[raw] || parseInt(raw, 10);
    if (!isNaN(num) && num > 0) return num;
  }

  // 2. Roman numerals attached to keyword: "Quiz I", "Quiz II", "Quiz (II)", "Quiz III", "Quiz IV", "Quiz V", "Quiz VI", etc.
  const romanMatch = combined.match(/(?:quiz|test|exam|midterm|assignment|hw|homework|lab|report|activity|task)[^0-9a-z\u0600-\u06ff\n]*\(?\s*(I|II|III|IV|V|VI|VII|VIII|IX|X)\b\s*\)?/i);
  if (romanMatch) {
    const map: Record<string, number> = {
      I: 1, II: 2, III: 3, IV: 4, V: 5,
      VI: 6, VII: 7, VIII: 8, IX: 9, X: 10
    };
    const roman = romanMatch[1].toUpperCase();
    if (map[roman]) return map[roman];
  }

  // 3. Ordinal words before assessment: "First Quiz", "Second Quiz", "1st Quiz", "2nd Quiz", "3rd quiz", "2nd Quiz (Vector & Free Fall)"
  const ordMatch = combined.match(/\b(1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:online\s+|pop\s+|announced\s+|makeup\s+|take[- ]home\s+)?(?:quiz|test|exam|midterm|assignment|hw|homework|lab|report|activity|task)/i);
  if (ordMatch) {
    const ord = ordMatch[1].toLowerCase();
    const map: Record<string, number> = {
      '1st': 1, 'first': 1,
      '2nd': 2, 'second': 2,
      '3rd': 3, 'third': 3,
      '4th': 4, 'fourth': 4,
      '5th': 5, 'fifth': 5,
      '6th': 6, 'sixth': 6,
      '7th': 7, 'seventh': 7,
      '8th': 8, 'eighth': 8,
      '9th': 9, 'ninth': 9,
      '10th': 10, 'tenth': 10
    };
    if (map[ord]) return map[ord];
  }

  // 4. Arabic ordinals before or after: "الكويز الثاني", "الاختبار الأول", "الواجب الثالث", "ثاني كويز"
  const arOrdMap: Record<string, number> = {
    'الاول': 1, 'الأول': 1, 'أول': 1, 'اول': 1,
    'الثاني': 2, 'الثانى': 2, 'ثاني': 2, 'ثانى': 2,
    'الثالث': 3, 'ثالث': 3,
    'الرابع': 4, 'رابع': 4,
    'الخامس': 5, 'خامس': 5,
    'السادس': 6, 'سادس': 6,
    'السابع': 7, 'سابع': 7,
    'الثامن': 8, 'ثامن': 8,
    'التاسع': 9, 'تاسع': 9,
    'العاشر': 10, 'عاشر': 10
  };

  const arMatchAfter = combined.match(/(?:الكويز|الاختبار|الامتحان|الواجب|التقرير|المشروع|كويز|اختبار|امتحان|واجب|تقرير|مشروع)\s+(الاول|الأول|الثاني|الثانى|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|اول|أول|ثاني|ثانى|ثالث|رابع|خامس)/i);
  if (arMatchAfter && arOrdMap[arMatchAfter[1]]) {
    return arOrdMap[arMatchAfter[1]];
  }

  const arMatchBefore = combined.match(/(الاول|الأول|الثاني|الثانى|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|اول|أول|ثاني|ثانى|ثالث|رابع|خامس)\s+(?:كويز|اختبار|امتحان|واجب|تقرير|مشروع)/i);
  if (arMatchBefore && arOrdMap[arMatchBefore[1]]) {
    return arOrdMap[arMatchBefore[1]];
  }

  return null;
}

export function resolveTaskWeight(
  taskOrCourse: {
    title?: string;
    courseName?: string;
    courseCode?: string;
    type?: TaskType;
    description?: string;
    sourceSnippet?: string;
  } | string,
  titleOrFallback?: string,
  taskType?: TaskType,
  notesOrSnippet?: string,
  seriesIndex?: number
): ResolvedWeight {
  let task: {
    title?: string;
    courseName?: string;
    courseCode?: string;
    type?: TaskType;
    description?: string;
    sourceSnippet?: string;
  };
  let fallbackCourseName = '';

  if (typeof taskOrCourse === 'string') {
    task = {
      courseName: taskOrCourse,
      title: titleOrFallback || '',
      type: taskType,
      description: notesOrSnippet || '',
      sourceSnippet: notesOrSnippet || ''
    };
    fallbackCourseName = taskOrCourse;
  } else {
    task = taskOrCourse || {};
    fallbackCourseName = titleOrFallback || '';
  }

  const title = task.title || '';
  const desc = task.description || '';
  const snippet = task.sourceSnippet || '';
  const cName = task.courseName || fallbackCourseName;
  const cCode = task.courseCode || '';

  // 1. Check for explicit marks/percentages directly written in title or snippet
  const explicitInTitle = extractExplicitPoints(title);
  // In the body only a clearly stated weight counts ("out of 75%" is not this item's weight)
  const explicitInSnippet = extractStatedWeight(snippet || desc);
  const explicitPoints = explicitInTitle !== null ? explicitInTitle : explicitInSnippet;

  // 2. Identify Course Syllabus
  const syllabus = findCourseSyllabus(cName, cCode) || findCourseSyllabus(title);

  if (!syllabus) {
    if (explicitPoints !== null) {
      return {
        weight: explicitPoints,
        weightDisplay: `${explicitPoints}% of Grade`,
        syllabusNote: `Directly specified as ${explicitPoints} marks in assignment`,
        componentName: 'Assignment'
      };
    }
    return {};
  }

  // 3. Match Assessment Component within the syllabus
  let matchedComp: SyllabusComponent | null = null;
  const searchString = `${title} ${desc} ${snippet}`.trim();

  // The title says what the item is; the body often mentions other parts of the course
  // ("those who miss the midterm will have their final exam out of 75%"), so try the title first
  for (const comp of syllabus.components) {
    if (comp.matcher.test(title)) {
      matchedComp = comp;
      break;
    }
  }
  if (!matchedComp) {
    for (const comp of syllabus.components) {
      if (comp.matcher.test(searchString)) {
        matchedComp = comp;
        break;
      }
    }
  }

  // Fallback match by TaskType if no title regex matched
  if (!matchedComp && task.type) {
    matchedComp = syllabus.components.find(c => c.type === task.type) || null;
  }

  // If explicit points were stated and match or refine the component
  if (explicitPoints !== null) {
    const compName = matchedComp ? matchedComp.name : 'Assessment';
    return {
      weight: explicitPoints,
      weightDisplay: `${explicitPoints}% of Grade`,
      syllabusNote: matchedComp?.note ? `${syllabus.courseName}: ${matchedComp.note}` : `${syllabus.courseName} (${explicitPoints} marks)`,
      componentName: compName
    };
  }

  if (matchedComp) {
    const weightVal = matchedComp.unitWeight !== undefined ? matchedComp.unitWeight : matchedComp.totalWeight;
    let display = `${weightVal}% of Grade`;

    if (matchedComp.name.toLowerCase().includes('midterm')) {
      display = `${weightVal}% (Midterm Exam)`;
    } else if (matchedComp.name.toLowerCase().includes('final')) {
      display = `${weightVal}% (Final Exam)`;
    } else if (matchedComp.count && matchedComp.count > 1) {
      const explicitNum = extractAssessmentNumber(title, searchString);
      const itemIndex = explicitNum || (seriesIndex && seriesIndex > 0 ? seriesIndex : 1);
      const totalCount = Math.max(matchedComp.count, itemIndex);
      display = `${weightVal}% (${matchedComp.name} ${itemIndex} of ${totalCount})`;
    } else {
      display = `${weightVal}% (${matchedComp.name})`;
    }

    return {
      weight: weightVal,
      weightDisplay: display,
      syllabusNote: `${syllabus.courseName}: ${matchedComp.note || `${matchedComp.name} (${matchedComp.totalWeight}% total)`}`,
      componentName: matchedComp.name
    };
  }

  return {};
}

/**
 * Returns all configured syllabi for display in the UI reference guide.
 */
export function getAllSyllabi(): CourseSyllabus[] {
  return getActiveSyllabi();
}
