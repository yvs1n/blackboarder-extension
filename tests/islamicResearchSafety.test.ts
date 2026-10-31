import { describe, it, expect } from 'vitest';
import { gradebookToUpdates, applySubmissionUpdates, dropImpossibleMarks } from '../src/utils/gradebook';
import { findTaskForUpdate, parseSubmissionOrGradeCard } from '../src/utils/streamParser';
import { mergeCloudTasks, deduplicateTaskList, sanitizeTaskListMarks } from '../src/utils/taskMerge';
import { parseCourseDetails } from '../src/core/courseHelper';
import { buildMarksSummary } from '../src/utils/marks';
import { gradesHtml } from '../src/utils/grades';
import { buildGpaSummary, UOS_GRADE_SCALE } from '../src/utils/gpa';
import { DeadlineTask, TaskSubmissionUpdate } from '../src/types';
import { setActiveUserCourses } from '../src/core/userCourses';
import { SAMPLE_COURSES } from './fixtures/sampleCourses';

function makeTask(partial: Partial<DeadlineTask>): DeadlineTask {
  return {
    id: 'test-task-' + Math.random().toString(36).slice(2, 8),
    courseCode: '0104100',
    courseName: 'Islamic Culture',
    title: 'Test',
    description: '',
    dueDate: '2026-10-22T19:59:00.000Z',
    hasSpecificTime: true,
    type: 'project',
    priority: 'medium',
    status: 'pending',
    sourceSnippet: '',
    confidence: 1,
    extractedBy: 'local',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial
  };
}

describe('Islamic Culture Research and Submitted Items Safety', () => {
  it('normalizes Arabic course names to the student\'s course names and codes in parseCourseDetails', () => {
    setActiveUserCourses(SAMPLE_COURSES);
    expect(parseCourseDetails('الثقافة الإسلامية')).toEqual({
      name: 'Islamic Culture',
      code: '0104100'
    });
    expect(parseCourseDetails('حسبان 1 للمهندسين')).toEqual({
      name: 'Calculus I for Engineering',
      code: '1440133'
    });
    expect(parseCourseDetails('مقدمة في هندسة الحاسوب')).toEqual({
      name: 'Introduction to Computer Eng.',
      code: '1502101'
    });
    expect(parseCourseDetails('مختبر الفيزياء 1')).toEqual({
      name: 'Physics 1 Lab',
      code: '1430116'
    });
    expect(parseCourseDetails('الفيزياء 1')).toEqual({
      name: 'Physics 1',
      code: '1430115'
    });
    expect(parseCourseDetails('اللغة الإنجليزية لأغراض أكاديمية')).toEqual({
      name: 'English for Academic Purposes',
      code: '0202112'
    });
  });

  it('prevents generic or cross-course updates from matching research task', () => {
    const researchTask = makeTask({
      id: 'gbcol__87186_1__1916866_1',
      courseCode: '0104100',
      courseName: 'Islamic Culture',
      title: 'البحث العلمي (واجب جماعي) 15 درجة',
      dueDate: '2026-10-22T19:59:00.000Z',
      type: 'project',
      status: 'completed',
      weight: 15
    });

    // 1. Calculus Quiz 1 (6/10) must never match Islamic Research
    const calcQuiz1: TaskSubmissionUpdate = {
      courseName: 'Calculus I for Engineering',
      courseCode: '1440133',
      title: 'Quiz 1',
      submissionStatus: 'graded',
      score: 6,
      maxScore: 10,
      sourceId: 'gb:_1922117_1'
    };
    expect(findTaskForUpdate([researchTask], calcQuiz1)).toBeUndefined();

    // 2. Generic update "واجب" without course must never match
    const genericWajib: TaskSubmissionUpdate = {
      title: 'واجب',
      submissionStatus: 'graded',
      score: 6,
      maxScore: 10
    };
    expect(findTaskForUpdate([researchTask], genericWajib)).toBeUndefined();

    // 3. Generic update "Assignment" without course must never match
    const genericAssignment: TaskSubmissionUpdate = {
      title: 'Assignment',
      submissionStatus: 'graded',
      score: 6,
      maxScore: 10
    };
    expect(findTaskForUpdate([researchTask], genericAssignment)).toBeUndefined();

    // 4. Update with 10 maxScore must not loosely match task with explicit 15 marks
    const looseMismatchPoints: TaskSubmissionUpdate = {
      courseName: 'Islamic Culture',
      courseCode: '0104100',
      title: 'البحث العلمي',
      submissionStatus: 'graded',
      score: 6,
      maxScore: 10
    };
    expect(findTaskForUpdate([researchTask], looseMismatchPoints)).toBeUndefined();
  });

  it('clears spurious marks when official gradebook column status is submitted (NEEDS_GRADING)', () => {
    const task = makeTask({
      id: 'gbcol__87186_1__1916866_1',
      courseCode: '0104100',
      courseName: 'Islamic Culture',
      title: 'البحث العلمي (واجب جماعي) 15 درجة',
      dueDate: '2026-10-22T19:59:00.000Z',
      type: 'project',
      status: 'completed',
      weight: 15,
      submissionStatus: 'graded',
      score: 6,
      maxScore: 10,
      scoreDisplay: '6 / 10 (60%)',
      gradeSourceId: 'gb:_1922117_1'
    });

    const officialUpdate: TaskSubmissionUpdate = {
      courseName: 'Islamic Culture',
      courseCode: '0104100',
      title: 'البحث العلمي (واجب جماعي) 15 درجة',
      sourceId: 'gb:_1916866_1',
      submissionStatus: 'submitted'
    };

    const changed = applySubmissionUpdates([task], [officialUpdate]);
    expect(changed).toBe(1);

    expect(task.submissionStatus).toBe('submitted');
    expect(task.status).toBe('completed');
    expect(task.score).toBeUndefined();
    expect(task.maxScore).toBeUndefined();
    expect(task.scoreDisplay).toBeUndefined();
    expect(task.gradeSourceId).toBe('gb:_1916866_1');

    // dropImpossibleMarks also cleans up any orphan scores on submitted tasks
    expect(dropImpossibleMarks([task])).toBe(0);
  });

  it('accurately renders Islamic Culture in Grades card with research as Submitted worth 15%', () => {
    const colEntry = {
      results: [
        {
          id: '_1916865_1',
          columnName: 'واجب (10 درجات)',
          possible: 10,
          calculationType: 'NON_CALCULATED',
          scoreProviderHandle: 'resource/x-bb-assignment',
          visible: true,
          gradesReleased: true,
          dueDate: '2026-10-25T19:59:00.000Z'
        },
        {
          id: '_1916866_1',
          columnName: 'البحث العلمي (واجب جماعي) 15 درجة',
          possible: 15,
          calculationType: 'NON_CALCULATED',
          scoreProviderHandle: 'resource/x-bb-assignment',
          visible: true,
          gradesReleased: true,
          dueDate: '2026-10-22T19:59:00.000Z'
        },
        {
          id: '_1928185_1',
          columnName: 'MIDTERM EXAM',
          possible: 25,
          calculationType: 'NON_CALCULATED',
          scoreProviderHandle: 'resource/x-bb-numeric',
          visible: true,
          gradesReleased: true
        }
      ]
    };

    const gradeEntry = {
      results: [
        {
          columnId: '_1916865_1',
          status: 'NEEDS_GRADING',
          pointsPossible: 10,
          displayGrade: null
        },
        {
          columnId: '_1916866_1',
          status: 'NEEDS_GRADING',
          pointsPossible: 15,
          displayGrade: null
        },
        {
          columnId: '_1928185_1',
          status: 'GRADED',
          pointsPossible: 25,
          effectiveScore: 20,
          displayGrade: { score: 20, text: '20' },
          gradedDate: '2026-10-14T08:00:00.000Z'
        }
      ]
    };

    const updates = gradebookToUpdates(colEntry.results, gradeEntry.results, {
      courseName: 'Islamic Culture',
      courseCode: '0104100'
    });

    const tasks: DeadlineTask[] = [
      makeTask({
        id: 'gbcol__87186_1__1916866_1',
        courseCode: '0104100',
        courseName: 'Islamic Culture',
        title: 'البحث العلمي (واجب جماعي) 15 درجة',
        dueDate: '2026-10-22T19:59:00.000Z',
        type: 'project',
        status: 'completed',
        weight: 15,
        submissionStatus: 'graded',
        score: 6,
        maxScore: 10,
        scoreDisplay: '6 / 10 (60%)',
        gradeSourceId: 'gb:_1922117_1'
      }),
      makeTask({
        id: 'gbcol__87186_1__1916865_1',
        courseCode: '0104100',
        courseName: 'Islamic Culture',
        title: 'واجب (10 درجات)',
        dueDate: '2026-10-31T01:59:00.000Z',
        type: 'assignment',
        status: 'completed',
        weight: 10,
        submissionStatus: 'submitted',
        sourceSnippet: 'gradebook',
        gradeSourceId: 'gb:_1916865_1'
      }),
      makeTask({
        id: 'gbcol__87186_1__1928185_1',
        courseCode: '0104100',
        courseName: 'Islamic Culture',
        title: 'MIDTERM EXAM',
        dueDate: '2026-10-14T02:41:14.209Z',
        type: 'exam',
        status: 'completed',
        weight: 25,
        submissionStatus: 'graded',
        score: 20,
        maxScore: 25,
        scoreDisplay: '20 / 25 (80%)',
        gradeSourceId: 'gb:_1928185_1'
      })
    ];

    applySubmissionUpdates(tasks, updates);

    // 1. Verify tasks
    const research = tasks.find(t => t.id === 'gbcol__87186_1__1916866_1')!;
    expect(research.submissionStatus).toBe('submitted');
    expect(research.score).toBeUndefined();
    expect(research.maxScore).toBeUndefined();
    expect(research.scoreDisplay).toBeUndefined();

    const واجب = tasks.find(t => t.id === 'gbcol__87186_1__1916865_1')!;
    expect(واجب.submissionStatus).toBe('submitted');
    expect(واجب.score).toBeUndefined();

    const midterm = tasks.find(t => t.id === 'gbcol__87186_1__1928185_1')!;
    expect(midterm.submissionStatus).toBe('graded');
    expect(midterm.score).toBe(20);
    expect(midterm.maxScore).toBe(25);

    // 2. Verify Grades Summary & HTML
    const marksSummary = buildMarksSummary(tasks);
    expect(marksSummary.gradedCount).toBe(1);
    expect(marksSummary.submittedCount).toBe(2);

    const gpaSummary = buildGpaSummary(tasks, [], UOS_GRADE_SCALE);
    const html = gradesHtml(gpaSummary, marksSummary, () => '#489160');

    // Research and Homework must both show as Submitted with their weights
    expect(html).toContain('البحث العلمي (واجب جماعي) 15 درجة');
    expect(html).toContain('worth 15%');
    expect(html).toContain('واجب (10 درجات)');
    expect(html).toContain('worth 10%');
    expect(html).toContain('MIDTERM EXAM');
    expect(html).toContain('20 / 25');
    expect(html).toContain('80%');

    // No spurious 6 / 10 or 60% on research!
    expect(html).not.toContain('6 / 10');
    expect(html).not.toContain('60%');
    expect(html).not.toContain('9 of 15%');
  });

  it('never resurrects cleared scores during mergeCloudTasks when submissionStatus is submitted', () => {
    const staleLocal = makeTask({
      id: 'gbcol__87186_1__1916865_1',
      courseCode: '0104100',
      courseName: 'Islamic Culture',
      title: 'واجب (10 درجات)',
      dueDate: '2026-10-25T19:59:00.000Z',
      type: 'assignment',
      status: 'completed',
      weight: 10,
      submissionStatus: 'graded',
      score: 10,
      maxScore: 10,
      scoreDisplay: '10 / 10 (100%)',
      updatedAt: '2026-10-28T10:00:00.000Z'
    });

    const newerCloud = makeTask({
      id: 'gbcol__87186_1__1916865_1',
      courseCode: '0104100',
      courseName: 'Islamic Culture',
      title: 'واجب (10 درجات)',
      dueDate: '2026-10-25T19:59:00.000Z',
      type: 'assignment',
      status: 'completed',
      weight: 10,
      submissionStatus: 'submitted',
      updatedAt: '2026-10-28T12:00:00.000Z'
    });

    const { tasks } = mergeCloudTasks([staleLocal], [newerCloud]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].submissionStatus).toBe('submitted');
    expect(tasks[0].score).toBeUndefined();
    expect(tasks[0].maxScore).toBeUndefined();
    expect(tasks[0].scoreDisplay).toBeUndefined();
  });

  it('never extracts a fabricated score from a submission receipt card with points in the title', () => {
    const cardText = 'Islamic Culture\nSubmitted: واجب (10 درجات)\nSubmission receipt: 9812345';
    const parsed = parseSubmissionOrGradeCard(cardText);
    expect(parsed).not.toBeNull();
    expect(parsed!.submissionStatus).toBe('submitted');
    expect(parsed!.score).toBeUndefined();
    expect(parsed!.maxScore).toBeUndefined();
    expect(parsed!.scoreDisplay).toBeUndefined();
  });

  it('sanitizes and deduplicates extension announcement and gradebook column for research even before a scan', () => {
    const corruptedTasks: DeadlineTask[] = [
      makeTask({
        id: '_595359_1',
        courseCode: '0104100',
        courseName: 'Islamic Culture',
        title: 'تمديد فترة تسليم البحث العلمي ومحاولات التسليم',
        dueDate: '2026-10-22T19:59:00.000Z',
        type: 'assignment',
        status: 'completed',
        weight: 10,
        submissionStatus: 'graded',
        score: 6,
        maxScore: 10,
        scoreDisplay: '6 / 10 (60%)',
        gradeSourceId: 'gb:_1922117_1'
      }),
      makeTask({
        id: 'gbcol__87186_1__1916866_1',
        courseCode: '0104100',
        courseName: 'Islamic Culture',
        title: 'البحث العلمي (واجب جماعي) 15 درجة',
        dueDate: '2026-10-22T19:59:00.000Z',
        type: 'project',
        status: 'completed',
        weight: 15,
        submissionStatus: 'graded',
        score: 6,
        maxScore: 10,
        scoreDisplay: '6 / 10 (60%)',
        gradeSourceId: 'gb:_1922117_1'
      }),
      makeTask({
        id: 'gbcol__87186_1__1928185_1',
        courseCode: '0104100',
        courseName: 'Islamic Culture',
        title: 'MIDTERM EXAM',
        dueDate: '2026-10-14T02:41:14.209Z',
        type: 'exam',
        status: 'completed',
        weight: 25,
        submissionStatus: 'graded',
        score: 20,
        maxScore: 25,
        scoreDisplay: '20 / 25 (80%)',
        gradeSourceId: 'gb:_1928185_1'
      })
    ];

    const sanitized = deduplicateTaskList(sanitizeTaskListMarks(corruptedTasks));
    expect(sanitized).toHaveLength(2);

    const research = sanitized.find(t => t.id === 'gbcol__87186_1__1916866_1')!;
    expect(research).toBeDefined();
    expect(research.title).toBe('البحث العلمي (واجب جماعي) 15 درجة');
    expect(research.type).toBe('project');
    expect(research.weight).toBe(15);
    expect(research.submissionStatus).toBe('submitted');
    expect(research.score).toBeUndefined();
    expect(research.maxScore).toBeUndefined();
    expect(research.scoreDisplay).toBeUndefined();

    const marksSummary = buildMarksSummary(corruptedTasks);
    const islamicMarks = marksSummary.courses.find(c => c.courseName === 'Islamic Culture')!;
    expect(islamicMarks.gradedWeight).toBe(25);
    expect(islamicMarks.earnedWeight).toBe(20);
  });
});
