import { describe, it, expect } from 'vitest';
import { parseCourseDetails } from '../src/core/courseHelper';
import { extractAssessmentNumber } from '../src/core/syllabusWeights';
import { coreTitle } from '../src/utils/streamParser';
import { areTasksDuplicates, deduplicateTaskList, mergeDuplicatePair } from '../src/utils/taskMerge';
import { buildMarksSummary } from '../src/utils/marks';
import { DeadlineTask } from '../src/types';

function makeTask(overrides: Partial<DeadlineTask> = {}): DeadlineTask {
  return {
    id: 'task_1',
    courseCode: '1430116',
    courseName: 'Physics 1 Lab',
    title: 'Quiz 2',
    description: '',
    sourceSnippet: 'Dr announced',
    dueDate: '2026-09-29T08:00:00.000Z',
    hasSpecificTime: true,
    type: 'quiz',
    priority: 'high',
    status: 'pending',
    confidence: 1.0,
    extractedBy: 'local',
    createdAt: '2026-09-22T08:00:00.000Z',
    updatedAt: '2026-09-22T08:00:00.000Z',
    ...overrides
  };
}

describe('Assessment Deduplication & Ordinal Normalization Suite', () => {
  describe('Blackboard External Course ID Parsing (parseCourseDetails)', () => {
    it('extracts clean code and course name from external Blackboard strings', () => {
      const raw = '1430116_10708_FALL2026-2027 Physics 1 Lab - 11L - مختبر الفيزياء 1';
      const parsed = parseCourseDetails(raw);
      expect(parsed.code).toBe('1430116');
      expect(parsed.name).toBe('Physics 1 Lab');
    });

    it('handles alphanumeric course prefixes e.g. CS101_01_FALL2026', () => {
      const raw = 'CS101_01_FALL2026-2027 Introduction to Computer Science';
      const parsed = parseCourseDetails(raw);
      expect(parsed.code).toBe('CS101');
      expect(parsed.name).toBe('Introduction to Computer Science');
    });

    it('handles numeric course prefix with term code', () => {
      const raw = '0401201_10200_FALL2026 Computer Programming - 02';
      const parsed = parseCourseDetails(raw);
      expect(parsed.code).toBe('0401201');
      expect(parsed.name).toBe('Computer Programming');
    });
  });

  describe('Assessment Sequence Number Extraction (extractAssessmentNumber)', () => {
    it('extracts ordinal numbers across English variants', () => {
      expect(extractAssessmentNumber('Quiz 2')).toBe(2);
      expect(extractAssessmentNumber('2nd Quiz')).toBe(2);
      expect(extractAssessmentNumber('2nd Quiz (Vector & Free Fall)')).toBe(2);
      expect(extractAssessmentNumber('Second Quiz')).toBe(2);
      expect(extractAssessmentNumber('2nd quiz')).toBe(2);
      expect(extractAssessmentNumber('Quiz II')).toBe(2);
      expect(extractAssessmentNumber('Quiz #2')).toBe(2);
      expect(extractAssessmentNumber('Quiz - 02')).toBe(2);
      expect(extractAssessmentNumber('HW 1')).toBe(1);
      expect(extractAssessmentNumber('1st Homework')).toBe(1);
      expect(extractAssessmentNumber('Midterm 1')).toBe(1);
      expect(extractAssessmentNumber('1st Midterm Exam')).toBe(1);
    });

    it('extracts ordinal numbers across Arabic variants', () => {
      expect(extractAssessmentNumber('كويز 2')).toBe(2);
      expect(extractAssessmentNumber('الكويز الثاني')).toBe(2);
      expect(extractAssessmentNumber('كويز ثاني')).toBe(2);
      expect(extractAssessmentNumber('الاختبار الأول')).toBe(1);
      expect(extractAssessmentNumber('الواجب الثالث')).toBe(3);
      expect(extractAssessmentNumber('كويز ٢')).toBe(2);
    });

    it('does not confuse secondary topic numbers with assessment numbers', () => {
      expect(extractAssessmentNumber("Newton's 2nd Law Student's Lab. Report")).toBeNull();
      expect(extractAssessmentNumber('Lab Report: Free Fall Experiment')).toBeNull();
      expect(extractAssessmentNumber('Midterm Exam')).toBeNull();
    });

    it('prefers the assessment number outside parenthetical topic details', () => {
      expect(extractAssessmentNumber("Lab 3 (Newton's 2nd Law)")).toBe(3);
      expect(extractAssessmentNumber('Quiz 1 (Chapter 2 & 3 Review)')).toBe(1);
    });
  });

  describe('Core Title Normalization (coreTitle)', () => {
    it('normalizes "Quiz 2" and "2nd Quiz (Vector & Free Fall)" to identical core titles', () => {
      expect(coreTitle('Quiz 2')).toBe('quiz2');
      expect(coreTitle('2nd Quiz (Vector & Free Fall)')).toBe('quiz2');
      expect(coreTitle('Second Quiz')).toBe('quiz2');
      expect(coreTitle('2nd quiz')).toBe('quiz2');
      expect(coreTitle('Quiz II')).toBe('quiz2');
      expect(coreTitle('الكويز الثاني')).toBe('quiz2');
    });

    it('normalizes lab report titles with and without student/experiment filler', () => {
      expect(coreTitle('Free Fall Exp. - Lab Report')).toBe('freefall');
      expect(coreTitle("Free Fall Exp. Student's Lab Report")).toBe('freefall');
      expect(coreTitle('Free Fall Exp. - Lab Report')).toBe(coreTitle("Free Fall Exp. Student's Lab Report"));
    });
  });

  describe('Task Deduplication (areTasksDuplicates & deduplicateTaskList)', () => {
    const baseTask = makeTask({
      id: 'ann_task_1',
      title: 'Quiz 2',
      description: 'Announcement about Quiz 2 next week',
      dueDate: '2026-09-29T08:00:00.000Z'
    });

    const gradebookTask = makeTask({
      id: 'gbcol__85276_1__1924969_1',
      title: '2nd Quiz (Vector & Free Fall)',
      dueDate: '2026-09-30T19:59:00.000Z',
      status: 'completed',
      submissionStatus: 'graded',
      score: 6.5,
      maxScore: 10,
      scoreDisplay: '6.5 / 10',
      gradeSourceId: 'col__1924969_1',
      weight: 10,
      weightDisplay: '10% of Grade'
    });

    it('identifies Quiz 2 and 2nd Quiz (Vector & Free Fall) as duplicates', () => {
      expect(areTasksDuplicates(baseTask, gradebookTask)).toBe(true);
      expect(areTasksDuplicates(gradebookTask, baseTask)).toBe(true);
    });

    it('deduplicates task list into a single merged task preserving marks and informative title', () => {
      const mergedList = deduplicateTaskList([baseTask, gradebookTask]);
      expect(mergedList).toHaveLength(1);
      const merged = mergedList[0];
      expect(merged.title).toBe('2nd Quiz (Vector & Free Fall)');
      expect(merged.submissionStatus).toBe('graded');
      expect(merged.score).toBe(6.5);
      expect(merged.maxScore).toBe(10);
      expect(merged.status).toBe('completed');
      expect(merged.gradeSourceId).toBe('col__1924969_1');
    });

    it('merges correctly regardless of array ordering', () => {
      const mergedList = deduplicateTaskList([gradebookTask, baseTask]);
      expect(mergedList).toHaveLength(1);
      const merged = mergedList[0];
      expect(merged.title).toBe('2nd Quiz (Vector & Free Fall)');
      expect(merged.score).toBe(6.5);
      expect(merged.submissionStatus).toBe('graded');
    });

    it('never merges Quiz 1 and Quiz 2 in the same course', () => {
      const quiz1 = makeTask({
        id: 'quiz_1',
        title: 'Quiz 1',
        dueDate: '2026-09-15T08:00:00.000Z'
      });
      const quiz2 = makeTask({
        id: 'quiz_2',
        title: 'Quiz 2',
        dueDate: '2026-09-29T08:00:00.000Z'
      });
      expect(areTasksDuplicates(quiz1, quiz2)).toBe(false);
      expect(deduplicateTaskList([quiz1, quiz2])).toHaveLength(2);
    });

    it('never merges tasks across different courses even with the same title', () => {
      const physQuiz2 = makeTask({
        id: 'phy_quiz_2',
        courseName: 'Physics 1',
        courseCode: '1430115',
        title: 'Quiz 2'
      });
      expect(areTasksDuplicates(baseTask, physQuiz2)).toBe(false);
      expect(deduplicateTaskList([baseTask, physQuiz2])).toHaveLength(2);
    });

    it('never merges practice quizzes with real graded quizzes', () => {
      const practiceQuiz = makeTask({
        id: 'practice_q2',
        title: 'Practice Quiz 2',
        dueDate: '2026-09-29T08:00:00.000Z'
      });
      expect(areTasksDuplicates(baseTask, practiceQuiz)).toBe(false);
      expect(deduplicateTaskList([baseTask, practiceQuiz])).toHaveLength(2);
    });

    it('preserves student manual edits (Rule 3)', () => {
      const studentEdited = makeTask({
        ...baseTask,
        title: 'My Custom Quiz 2 Name',
        room: 'Lab Room M11-102',
        userEdited: true,
        extractedBy: 'manual'
      });
      const merged = mergeDuplicatePair(studentEdited, gradebookTask);
      expect(merged.title).toBe('My Custom Quiz 2 Name');
      expect(merged.room).toBe('Lab Room M11-102');
      expect(merged.userEdited).toBe(true);
      expect(merged.submissionStatus).toBe('graded');
      expect(merged.score).toBe(6.5);
    });
  });

  describe('Defense-in-depth Grades Card Deduplication (buildMarksSummary)', () => {
    it('produces exactly 1 mark row when duplicate tasks exist in tasks input', () => {
      const taskAnn = makeTask({
        id: 'ann_task_1',
        title: 'Quiz 2',
        dueDate: '2026-09-29T08:00:00.000Z',
        status: 'completed',
        submissionStatus: 'graded',
        score: 6.5,
        maxScore: 10,
        gradeSourceId: 'col__1924969_1',
        weight: 10
      });

      const taskGb = makeTask({
        id: 'gbcol__85276_1__1924969_1',
        title: '2nd Quiz (Vector & Free Fall)',
        dueDate: '2026-09-30T19:59:00.000Z',
        status: 'completed',
        submissionStatus: 'graded',
        score: 6.5,
        maxScore: 10,
        gradeSourceId: 'col__1924969_1',
        weight: 10
      });

      const taskLabReport = makeTask({
        id: 'gbcol_report',
        title: 'Free Fall Exp. - Lab Report',
        dueDate: '2026-09-20T19:59:00.000Z',
        type: 'assignment',
        status: 'completed',
        submissionStatus: 'graded',
        score: 10,
        maxScore: 10,
        gradeSourceId: 'col_report_1',
        weight: 3.33
      });

      const summary = buildMarksSummary([taskAnn, taskGb, taskLabReport]);
      expect(summary.courses).toHaveLength(1);
      const physicsLab = summary.courses[0];
      expect(physicsLab.courseName).toBe('Physics 1 Lab');

      // Must have exactly 2 marks (Quiz 2 and Lab Report), not 3!
      expect(physicsLab.marks).toHaveLength(2);
      expect(summary.gradedCount).toBe(2);

      const quizMark = physicsLab.marks.find(m => m.title.includes('Quiz'));
      expect(quizMark).toBeDefined();
      expect(quizMark?.title).toBe('2nd Quiz (Vector & Free Fall)');
      expect(quizMark?.score).toBe(6.5);
      expect(quizMark?.maxScore).toBe(10);
      expect(quizMark?.percent).toBe(65);

      // Graded weight must only count Quiz 2 once (10 + 3.33 = 13.3)
      expect(physicsLab.gradedWeight).toBe(13.3);
    });
  });
});
