import { describe, it, expect, beforeEach } from 'vitest';
import { parseCourseDetails, resolveCourseInfo } from '../src/core/courseHelper';
import { setActiveUserCourses } from '../src/core/userCourses';
import { SAMPLE_COURSES } from './fixtures/sampleCourses';

describe('Course Details Extraction', () => {
  beforeEach(() => {
    setActiveUserCourses(SAMPLE_COURSES);
  });

  it('extracts course name and code from UOS hyphenated format', () => {
    const raw = '0401201-01 Computer Programming (Spring 2026) - Announcements';
    const result = parseCourseDetails(raw);
    expect(result.code).toBe('0401201');
    expect(result.name).toBe('Computer Programming');
  });

  it('extracts from bracketed course code format', () => {
    const raw = '[0402202] Data Structures & Algorithms';
    const result = parseCourseDetails(raw);
    expect(result.code).toBe('0402202');
    expect(result.name).toBe('Data Structures & Algorithms');
  });

  it('extracts from standard letter-code format', () => {
    const raw = 'CS101: Introduction to Computer Science - Fall 2025';
    const result = parseCourseDetails(raw);
    expect(result.code).toBe('CS101');
    expect(result.name).toBe('Introduction to Computer Science');
  });

  it('extracts from Arabic course titles', () => {
    const raw = '0401100 - تفاضل وتكامل 1';
    const result = parseCourseDetails(raw);
    expect(result.code).toBe('0401100');
    expect(result.name).toBe('تفاضل وتكامل 1');
  });

  it('provides sensible defaults for empty or general strings', () => {
    const result = parseCourseDetails('');
    expect(result.code).toBe('UOS');
    expect(result.name).toBe('General Course');
  });

  it('resolves raw Ultra stream tasks to official courses with resolveCourseInfo', () => {
    const rawPhysicsLab = {
      courseName: "Measuring Density, Student's Lab. ReportDue date: 9/11/26, 11:59 PM (UTC+4)",
      courseCode: 'UOS',
      title: 'Measuring Density - Lab Report'
    };
    const res1 = resolveCourseInfo(rawPhysicsLab);
    expect(res1.courseName).toBe('Physics 1 Lab');
    expect(res1.courseCode).toBe('1430116');

    // "Topic of a paragraph" was a built-in rule for one English course; it now needs to be one of
    // the student's own aliases (without it, the Blackboard nav label stays a general course)
    const rawEnglish = {
      courseName: 'Topic of a paragraph',
      courseCode: 'UOS',
      title: 'Topic of a paragraph'
    };
    expect(resolveCourseInfo(rawEnglish).courseName).toBe('General Course');
    setActiveUserCourses(SAMPLE_COURSES.map(c => c.id === 'eap' ? { ...c, aliases: [...c.aliases, 'topic of a paragraph'] } : c));
    const res2 = resolveCourseInfo(rawEnglish);
    expect(res2.courseName).toBe('English for Academic Purposes');
    expect(res2.courseCode).toBe('0202112');
  });

  it('preserves user custom course names and resolves generic codes', () => {
    const custom = {
      courseName: 'Calculus I for Engineering',
      courseCode: '1440133',
      title: 'Assignment 2'
    };
    const res = resolveCourseInfo(custom);
    expect(res.courseName).toBe('Calculus I for Engineering');
    expect(res.courseCode).toBe('1440133');
  });

  it('never returns UOS as courseCode or courseName for generic courses', () => {
    const generic = {
      courseName: 'uos',
      courseCode: 'UOS',
      title: 'General Update'
    };
    const res = resolveCourseInfo(generic);
    expect(res.courseName).toBe('General Course');
    expect(res.courseCode).toBe('');
  });

  it('resolves course from description or snippet when title is a generic assessment', () => {
    const quizTask = {
      courseName: 'General Course',
      courseCode: '',
      title: 'Quiz 2',
      description: 'Dear students, Quiz 2 covering Calculus 1 chapter 3 will be held on Thursday in room A12-110.'
    };
    const res = resolveCourseInfo(quizTask);
    expect(res.courseName).toBe('Calculus I for Engineering');
    expect(res.courseCode).toBe('1440133');
  });
});

import { parseDirectStreamCard } from '../src/utils/streamParser';
import { isValidTask } from '../src/core/courseHelper';

describe('Ghost Task Prevention & Stream Parser Resilience', () => {
  it('ignores submission receipts and attempt confirmation cards', () => {
    const receiptCard = `
      Calculus I for Engineering - 02
      You submitted Assignment 1 on 10/4/26, 11:30 PM. Confirmation number: #987654.
      Due Date: 10/4/26, 11:59 PM (UTC+4)
    `;
    const result = parseDirectStreamCard(receiptCard);
    expect(result).toBeNull();
  });

  it('ignores empty stream reminder cards with no course and generic title', () => {
    const ghostCard = `
      Due: Assignment
      Due Date: 10/12/26, 11:59 PM (UTC+4)
    `;
    const result = parseDirectStreamCard(ghostCard);
    expect(result).toBeNull();
  });

  it('successfully extracts valid direct deadline cards with real courses', () => {
    const validCard = `
      Calculus I for Engineering - 02 - حسبان 1 للمهندسين
      Due: Assignment-1-Graded
      Due Date: 10/18/26, 11:59 PM (UTC+4)
    `;
    const result = parseDirectStreamCard(validCard);
    expect(result).not.toBeNull();
    expect(result?.title).toBe('Assignment-1-Graded');
    expect(result?.courseName).toBe('Calculus I for Engineering');
    expect(result?.courseCode).not.toBe('UOS');
  });

  it('isValidTask filters out empty or ghost tasks', () => {
    // Ghost tasks:
    expect(isValidTask({ id: '1', title: '', courseName: '', dueDate: '' } as any)).toBe(false);
    expect(isValidTask({ id: '2', title: 'Assignment', courseName: 'General Course', courseCode: 'UOS', dueDate: '' } as any)).toBe(false);
    expect(isValidTask({ id: '3', title: 'Due in 2 days', courseName: 'General Course', courseCode: '', dueDate: '' } as any)).toBe(false);
    expect(isValidTask({ id: '4', title: 'Untitled', courseName: 'uos', courseCode: 'UOS', dueDate: '' } as any)).toBe(false);

    // Valid tasks:
    expect(isValidTask({ id: '5', title: 'Quiz 2', courseName: 'Calculus I for Engineering', courseCode: '1440133', dueDate: '' } as any)).toBe(true);
    expect(isValidTask({ id: '6', title: 'Lab 1 Report', courseName: 'General Course', courseCode: '', dueDate: '' } as any)).toBe(true);

    // Bogus grade fraction cards:
    expect(isValidTask({ id: '7', title: 'Lab', courseName: 'Physics 1 Lab', courseCode: '1430116', description: '.25 / 10' } as any)).toBe(false);
    expect(isValidTask({ id: '8', title: 'Lab', courseName: 'Physics 1 Lab', courseCode: '1430116', sourceSnippet: '8.5 / 10' } as any)).toBe(false);

    // Bogus grade announcement titles without future actions:
    expect(isValidTask({ id: '9', title: 'درجة الكويز الأول', courseName: 'Physics 1', courseCode: '1430115', description: 'تم رصد الدرجات' } as any)).toBe(false);
    expect(isValidTask({ id: '10', title: 'Grade Posted: Midterm', courseName: 'Calculus I', courseCode: '1440133' } as any)).toBe(false);
    expect(isValidTask({ id: '11', title: 'Score Posted', courseName: 'General Course', courseCode: '' } as any)).toBe(false);

    // Legitimate tasks with future actions or normal titles:
    expect(isValidTask({ id: '12', title: 'كويز تعويضي', courseName: 'Physics 1', courseCode: '1430115', description: 'موعد الامتحان التعويضي يوم الأحد' } as any)).toBe(true);
    expect(isValidTask({ id: '13', title: 'تسليم المشروع النهائي', courseName: 'Computer Programming', courseCode: '0401201' } as any)).toBe(true);
  });

  it('matchesSelectedCourseFilter matches tasks by name, code, or regex pattern', async () => {
    const { matchesSelectedCourseFilter } = await import('../src/core/courseHelper');

    const taskCalc = {
      courseName: 'Calculus I for Engineering',
      courseCode: '1440133',
      title: 'Quiz 2'
    };

    const taskPhys = {
      courseName: 'Physics 1',
      courseCode: '1430115',
      title: 'Midterm Exam'
    };

    const taskLab = {
      courseName: 'Physics 1 Lab',
      courseCode: '1430116',
      title: 'Lab Report 3'
    };

    // When filter is null / empty, all tasks match
    expect(matchesSelectedCourseFilter(taskCalc, null)).toBe(true);
    expect(matchesSelectedCourseFilter(taskCalc, '')).toBe(true);

    // Filter by exact name
    expect(matchesSelectedCourseFilter(taskCalc, 'Calculus I for Engineering')).toBe(true);
    expect(matchesSelectedCourseFilter(taskPhys, 'Calculus I for Engineering')).toBe(false);

    // Filter by code
    expect(matchesSelectedCourseFilter(taskCalc, '1440133')).toBe(true);
    expect(matchesSelectedCourseFilter(taskPhys, '1440133')).toBe(false);

    // Filter distinguishes Physics 1 vs Physics 1 Lab
    expect(matchesSelectedCourseFilter(taskLab, 'Physics 1 Lab')).toBe(true);
    expect(matchesSelectedCourseFilter(taskPhys, 'Physics 1 Lab')).toBe(false);
  });

  it('detects Blackboard navigation noise and prevents UI tabs from becoming courses', async () => {
    const { isBlackboardSystemNoise, parseCourseDetails } = await import('../src/core/courseHelper');

    // UI navigation tabs that should never be courses
    expect(isBlackboardSystemNoise('Content')).toBe(true);
    expect(isBlackboardSystemNoise('Calendar')).toBe(true);
    expect(isBlackboardSystemNoise('Discussions')).toBe(true);
    expect(isBlackboardSystemNoise('Gradebook')).toBe(true);
    expect(isBlackboardSystemNoise('Messages')).toBe(true);
    expect(isBlackboardSystemNoise('Analytics')).toBe(true);
    expect(isBlackboardSystemNoise('Groups')).toBe(true);
    expect(isBlackboardSystemNoise('Announcements')).toBe(true);
    expect(isBlackboardSystemNoise('Roster')).toBe(true);
    expect(isBlackboardSystemNoise('Attendance')).toBe(true);
    expect(isBlackboardSystemNoise('Tools')).toBe(true);
    expect(isBlackboardSystemNoise('Activity Stream')).toBe(true);
    expect(isBlackboardSystemNoise('المحتوى')).toBe(true);
    expect(isBlackboardSystemNoise('التقويم')).toBe(true);
    expect(isBlackboardSystemNoise('المناقشات')).toBe(true);
    expect(isBlackboardSystemNoise('سجل الدرجات')).toBe(true);

    // Legitimate course names that are NOT noise
    expect(isBlackboardSystemNoise('Calculus I for Engineering')).toBe(false);
    expect(isBlackboardSystemNoise('Physics 1')).toBe(false);
    expect(isBlackboardSystemNoise('Physics 1 Lab')).toBe(false);
    expect(isBlackboardSystemNoise('Computer Programming')).toBe(false);
    expect(isBlackboardSystemNoise('Introduction to Computer Eng.')).toBe(false);

    // parseCourseDetails rejects isolated navigation tab labels
    expect(parseCourseDetails('Content').name).toBe('General Course');
    expect(parseCourseDetails('Calendar').name).toBe('General Course');
    expect(parseCourseDetails('Discussions').name).toBe('General Course');
    expect(parseCourseDetails('Gradebook').name).toBe('General Course');
  });

  describe('isValidTask Gradebook Item Exemptions & Preservation', () => {
    const baseGradebookTask = {
      id: 'gbcol_0401201_1923809_1',
      courseName: 'Computer Programming',
      courseCode: '0401201',
      dueDate: '',
      hasSpecificTime: false,
      extractedBy: 'local',
      status: 'completed',
      submissionStatus: 'graded',
      score: 10,
      maxScore: 10,
      sourceSnippet: 'gradebook',
      gradeSourceId: 'gb:_1923809_1'
    };

    it('accepts gradebook tasks with empty dueDate when sourceSnippet is gradebook', () => {
      expect(isValidTask({ ...baseGradebookTask, title: 'In-Class Quiz 1', dueDate: '' } as any)).toBe(true);
    });

    it('accepts gradebook tasks with "Graded Item" fallback title', () => {
      expect(isValidTask({ ...baseGradebookTask, title: 'Graded Item' } as any)).toBe(true);
      expect(isValidTask({ ...baseGradebookTask, title: 'graded' } as any)).toBe(true);
    });

    it('accepts gradebook tasks with "Grade", "Score", or "Marks" in the title', () => {
      expect(isValidTask({ ...baseGradebookTask, title: 'Quiz 1 Grade' } as any)).toBe(true);
      expect(isValidTask({ ...baseGradebookTask, title: 'Midterm Exam Score' } as any)).toBe(true);
      expect(isValidTask({ ...baseGradebookTask, title: 'Lab 2 Marks' } as any)).toBe(true);
      expect(isValidTask({ ...baseGradebookTask, title: 'Assignment 1 (Graded)' } as any)).toBe(true);
    });

    it('accepts Arabic gradebook assessment titles without future action text', () => {
      expect(isValidTask({ ...baseGradebookTask, title: 'درجة المشاركة' } as any)).toBe(true);
      expect(isValidTask({ ...baseGradebookTask, title: 'درجات الكويز الأول' } as any)).toBe(true);
      expect(isValidTask({ ...baseGradebookTask, title: 'علامات المختبر' } as any)).toBe(true);
      expect(isValidTask({ ...baseGradebookTask, title: 'نتيجة الاختبار' } as any)).toBe(true);
    });

    it('accepts non-deadline gradebook items such as "Participation"', () => {
      expect(isValidTask({ ...baseGradebookTask, title: 'Participation', type: 'other' } as any)).toBe(true);
      expect(isValidTask({ ...baseGradebookTask, title: 'Attendance & Participation', type: 'other' } as any)).toBe(true);
    });

    it('accepts tasks having gradeSourceId or submissionStatus graded even with empty dueDate', () => {
      const taskWithSourceId = {
        id: 'task_custom_1',
        title: 'Practical Exam',
        courseName: 'Physics 1 Lab',
        courseCode: '1430116',
        dueDate: '',
        gradeSourceId: 'gb:_999_1',
        submissionStatus: 'graded'
      };
      expect(isValidTask(taskWithSourceId as any)).toBe(true);
    });

    it('still drops pure announcement grade notifications and ghost stream items', () => {
      // Pure announcement saying "Grade Posted" without gradebook source
      expect(isValidTask({
        id: 'ann_1',
        title: 'Grade Posted: Midterm',
        courseName: 'Calculus I for Engineering',
        courseCode: '1440133',
        description: 'Grades have been uploaded to Blackboard.'
      } as any)).toBe(false);

      // Arabic announcement without gradebook source and no deadline
      expect(isValidTask({
        id: 'ann_2',
        title: 'درجة الكويز الأول',
        courseName: 'Physics 1',
        courseCode: '1430115',
        description: 'تم رصد درجات الكويز الأول'
      } as any)).toBe(false);

      // Fraction-only stream cards
      expect(isValidTask({
        id: 'ann_3',
        title: 'Lab Report',
        courseName: 'Physics 1 Lab',
        courseCode: '1430116',
        description: '9 / 10'
      } as any)).toBe(false);
    });

    it('findLegacyNamelessTaskIds does not flag gradebook tasks with bare type titles', async () => {
      const { findLegacyNamelessTaskIds } = await import('../src/core/courseHelper');
      const tasks = [
        { id: 'gb_quiz', title: 'Quiz', sourceSnippet: 'gradebook', submissionStatus: 'graded' },
        { id: 'gb_assignment', title: 'Assignment', gradeSourceId: 'gb:_col1', submissionStatus: 'graded' },
        { id: 'ann_quiz', title: 'Quiz', description: 'Quiz on Sunday', sourceSnippet: 'announcement' }
      ];
      const flagged = findLegacyNamelessTaskIds(tasks as any);
      expect(flagged).toContain('ann_quiz');
      expect(flagged).not.toContain('gb_quiz');
      expect(flagged).not.toContain('gb_assignment');
    });
  });
});
