import { TaskType } from '../types';
import { getActiveSyllabi } from './userCourses';

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

/**
 * Exact syllabus grade distributions extracted from the course PDFs in docs/syllabus/
 */
export const DEFAULT_SYLLABUS_DATABASE: CourseSyllabus[] = [
  // 1. Calculus 1 for Engineering (calc_1.pdf - Page 10)
  {
    courseId: 'calc1',
    courseName: 'Calculus 1 for Engineering',
    courseCodePattern: /(?:calculus|calc\b|حسبان|1440131|0401101|0401201)/i,
    sourcePdf: 'calc_1.pdf',
    totalWeight: 100,
    components: [
      {
        id: 'calc1_final',
        name: 'Final Exam',
        type: 'exam',
        totalWeight: 40,
        unitWeight: 40,
        note: 'On paper (40%)',
        matcher: /(?:final\s*exam|final|امتحان\s*نهائي|نهائي)/i
      },
      {
        id: 'calc1_midterm',
        name: 'Midterm Exam',
        type: 'exam',
        totalWeight: 30,
        unitWeight: 30,
        note: 'On paper (30%)',
        matcher: /(?:midterm\s*exam|midterm|امتحان\s*نصفي|نصفي|منتصف)/i
      },
      {
        id: 'calc1_quizzes',
        name: 'Quizzes',
        type: 'quiz',
        totalWeight: 20,
        count: 2,
        unitWeight: 10,
        note: 'On paper, best 2 of 3 quizzes (10% each, 20% total)',
        matcher: /(?:quiz|كويز|امتحان\s*قصير)/i
      },
      {
        id: 'calc1_assignments',
        name: 'Homeworks',
        type: 'assignment',
        totalWeight: 10,
        count: 3,
        unitWeight: 3.33,
        note: 'Online, best 3 of 4 homeworks (~3.33% each, 10% total)',
        matcher: /(?:assignment|hw|homework|واجب|connect)/i
      }
    ]
  },

  // 2. English for Academic Purposes (eap.pdf - Page 5)
  {
    courseId: 'eap',
    courseName: 'English for Academic Purposes',
    courseCodePattern: /(?:english|eap\b|academic\s*english|إنجليز|انجليز|0202112|0202111)/i,
    sourcePdf: 'eap.pdf',
    totalWeight: 100,
    components: [
      {
        id: 'eap_final',
        name: 'Final Exam',
        type: 'exam',
        totalWeight: 40,
        unitWeight: 40,
        note: 'Week 16 (40%)',
        matcher: /(?:final\s*exam|final|نهائي)/i
      },
      {
        id: 'eap_midterm',
        name: 'Midterm Exam',
        type: 'exam',
        totalWeight: 20,
        unitWeight: 20,
        note: 'Week 8 (20%)',
        matcher: /(?:midterm\s*exam|midterm|نصفي|منتصف)/i
      },
      {
        id: 'eap_quizzes',
        name: 'Quizzes',
        type: 'quiz',
        totalWeight: 20,
        count: 2,
        unitWeight: 10,
        note: '2 Quizzes: Quiz 1 in Wk 4, Quiz 2 in Wk 7 (10% each, 20% total)',
        matcher: /(?:quiz|كويز)/i
      },
      {
        id: 'eap_essay',
        name: 'Cause-Effect Essay',
        type: 'assignment',
        totalWeight: 10,
        unitWeight: 10,
        note: 'Week 12 Writing Assignment (10%)',
        matcher: /(?:essay|cause.*effect|writing\s*assignment|مقال)/i
      },
      {
        id: 'eap_employability',
        name: 'Employability Skills',
        type: 'assignment',
        totalWeight: 10,
        count: 5,
        unitWeight: 2,
        note: '5 Employability Tasks across Weeks 2-13 (2% each, 10% total)',
        matcher: /(?:employability|skill|task|مهام|مهارات)/i
      }
    ]
  },

  // 3. Intro to Computer Engineering (introtocompeng.pdf - Page 4)
  {
    courseId: 'compeng',
    courseName: 'Intro to Computer Engineering',
    courseCodePattern: /(?:intro.*comp|comp(?:uter)?\s*eng|هندسة.*حاسوب|حاسوب|0402101|0402102)/i,
    sourcePdf: 'introtocompeng.pdf',
    totalWeight: 100,
    components: [
      {
        id: 'compeng_final',
        name: 'Final Exam',
        type: 'exam',
        totalWeight: 45,
        unitWeight: 45,
        note: 'TBA (45%)',
        matcher: /(?:final\s*exam|final|امتحان\s*نهائي|نهائي)/i
      },
      {
        id: 'compeng_midterm',
        name: 'Midterm Exam',
        type: 'exam',
        totalWeight: 30,
        unitWeight: 30,
        note: 'TBA (30%)',
        matcher: /(?:midterm\s*exam|midterm|امتحان\s*نصفي|نصفي|منتصف)/i
      },
      {
        id: 'compeng_quizzes',
        name: 'Quizzes',
        type: 'quiz',
        totalWeight: 25,
        count: 3,
        unitWeight: 8.33,
        note: 'Best 3 of 4 quizzes (average taken, ~8.33% each, 25% total, no HWs)',
        matcher: /(?:quiz|كويز|امتحان\s*قصير)/i
      }
    ]
  },

  // 4. Islamic Culture (islamicculture.pdf - Page 8)
  {
    courseId: 'islamic',
    courseName: 'Islamic Culture',
    courseCodePattern: /(?:islamic|إسلام|اسلام|0104100|0104101)/i,
    sourcePdf: 'islamicculture.pdf',
    totalWeight: 100,
    components: [
      {
        id: 'islamic_final',
        name: 'Final Exam',
        type: 'exam',
        totalWeight: 50,
        unitWeight: 50,
        note: 'امتحان نهائي (50%)',
        matcher: /(?:final\s*exam|final|امتحان\s*نهائي|نهائي)/i
      },
      {
        id: 'islamic_midterm',
        name: 'Midterm Exam',
        type: 'exam',
        totalWeight: 25,
        unitWeight: 25,
        note: 'امتحان المنتصف (25%)',
        matcher: /(?:midterm\s*exam|midterm|امتحان\s*نصفي|نصفي|منتصف)/i
      },
      {
        id: 'islamic_coursework',
        name: 'Coursework & Research',
        type: 'project',
        totalWeight: 25,
        unitWeight: 15,
        note: 'واجبات، تقارير، مشروعات، امتحانات قصيرة (25% total)',
        matcher: /(?:بحث|مشروع|تقرير|واجب|عرض|project|research|assignment|report|quiz|كويز)/i
      }
    ]
  },

  // 5. Physics 1 Lab (phy1lab.pdf - Page 5)
  {
    courseId: 'phy1lab',
    courseName: 'Physics 1 Lab',
    // Must match before Physics 1
    courseCodePattern: /(?:phys(?:ics)?.*lab|lab.*phys(?:ics)?|مختبر.*فيزياء|1430116|1430117|0401116)/i,
    sourcePdf: 'phy1lab.pdf',
    totalWeight: 100,
    components: [
      {
        id: 'phy1lab_final',
        name: 'Final Examination',
        type: 'exam',
        totalWeight: 40,
        unitWeight: 40,
        note: 'Practical Final Exam during last week (40%)',
        matcher: /(?:final\s*exam|final|امتحان\s*نهائي|نهائي|عملي)/i
      },
      {
        id: 'phy1lab_quizzes',
        name: 'Lab Quizzes',
        type: 'quiz',
        totalWeight: 30,
        count: 3,
        unitWeight: 10,
        note: '4 scheduled, top 3 counted (10% each, 30% total)',
        matcher: /(?:quiz|كويز)/i
      },
      {
        id: 'phy1lab_reports',
        name: 'Experiments & Lab Reports',
        type: 'lab',
        totalWeight: 30,
        count: 9,
        unitWeight: 3.33,
        note: '9 Weekly lab reports (approx 3.33% each, 30% total)',
        matcher: /(?:report|experiment|تقرير|تجربة|مختبر)/i
      }
    ]
  },

  // 6. Physics 1 (100 marks total: Final 45, Midterm 25, Quizzes 20 avg, Assignments 10)
  {
    courseId: 'phy1',
    courseName: 'Physics 1',
    courseCodePattern: /(?:physics\s*1(?!\s*lab)|general\s*physics\s*1|فيزياء\s*1(?!\s*عملي)|فيزياء\s*عامة\s*1|1430115|1430\s*115)/i,
    sourcePdf: 'phy1.pdf',
    totalWeight: 100,
    components: [
      {
        id: 'phy1_final',
        name: 'Final Exam',
        type: 'exam',
        totalWeight: 45,
        unitWeight: 45,
        note: 'Final Examination (45 marks)',
        matcher: /(?:final\s*exam|final|امتحان\s*نهائي|نهائي)/i
      },
      {
        id: 'phy1_midterm',
        name: 'Midterm Exam',
        type: 'exam',
        totalWeight: 25,
        unitWeight: 25,
        note: 'Midterm Exam (25 marks)',
        matcher: /(?:midterm\s*exam|midterm|امتحان\s*نصفي|نصفي|منتصف)/i
      },
      {
        id: 'phy1_quizzes',
        name: 'Quizzes',
        type: 'quiz',
        totalWeight: 20,
        unitWeight: 20,
        note: 'Quizzes throughout semester (average = 20 marks)',
        matcher: /(?:quiz|كويز|امتحان\s*قصير)/i
      },
      {
        id: 'phy1_assignments',
        name: 'Assignments',
        type: 'assignment',
        totalWeight: 10,
        unitWeight: 10,
        note: 'Assignments / Homework (10 marks total)',
        matcher: /(?:assignment|hw|homework|واجب)/i
      }
    ]
  }
];

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
 * Finds matching syllabus from database by course name/code.
 */
export function findCourseSyllabus(courseName: string = '', courseCode: string = ''): CourseSyllabus | null {
  const combined = `${courseName} ${courseCode}`.trim();
  if (!combined) return null;

  const syllabi = getActiveSyllabi();

  // Physics 1 Lab must match before Physics 1
  if (/(?:lab|مختبر|عملي)/i.test(combined) && /(?:physics|فيزياء)/i.test(combined)) {
    const lab = syllabi.find(s => s.courseId === 'phy1lab' || /lab/i.test(s.courseName));
    if (lab) return lab;
  }

  for (const s of syllabi) {
    if (s.courseCodePattern.test(combined)) {
      return s;
    }
  }

  return null;
}

/**
 * Resolves the syllabus weight for a given task based on course and title.
 * Supports passing a task object OR (course, title, type, notes) parameters.
 */
/**
 * Extracts assessment sequence number from title or context (e.g. "Quiz 2" -> 2, "HW 1" -> 1).
 */
export function extractAssessmentNumber(title: string, context?: string): number | null {
  const combined = `${title || ''} ${context || ''}`;

  // 1. Explicit numbering like "Quiz 2", "Quiz #2", "Quiz (2)", "Quiz [2]", "Quiz - 2", "HW2", "Assignment 2", "Lab 2"
  const m = combined.match(/(?:quiz|test|exam|assignment|hw|homework|lab|report|activity|task)[^0-9a-z\n]*#?\s*\(?\s*(\d+)\s*\)?/i);
  if (m) {
    const num = parseInt(m[1], 10);
    if (!isNaN(num) && num > 0) return num;
  }

  // 2. Roman numerals: "Quiz I", "Quiz II", "Quiz (II)", "Quiz III", "Quiz IV", "Quiz V"
  const romanMatch = combined.match(/(?:quiz|test|exam|assignment|hw|homework|lab|report|activity|task)[^0-9a-z\n]*\(?\s*(I|II|III|IV|V)\b\s*\)?/i);
  if (romanMatch) {
    const map: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
    const roman = romanMatch[1].toUpperCase();
    if (map[roman]) return map[roman];
  }

  // 3. Ordinal words: "First Quiz", "Second Quiz", "1st Quiz", "2nd Quiz"
  const ordMatch = combined.match(/\b(1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth)\s+(?:quiz|test|exam|assignment|hw|homework|lab|report|activity|task)/i);
  if (ordMatch) {
    const ord = ordMatch[1].toLowerCase();
    const map: Record<string, number> = {
      '1st': 1, 'first': 1,
      '2nd': 2, 'second': 2,
      '3rd': 3, 'third': 3,
      '4th': 4, 'fourth': 4,
      '5th': 5, 'fifth': 5
    };
    if (map[ord]) return map[ord];
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
