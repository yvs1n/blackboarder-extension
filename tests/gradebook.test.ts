import { describe, it, expect } from 'vitest';
import { gradebookToUpdates, gradebookColumnsToTasks, applySubmissionUpdates, GradebookColumn, GradebookGrade } from '../src/utils/gradebook';
import { parseUltraStreamEntries } from '../src/utils/streamParser';
import type { DeadlineTask } from '../src/types';

// Trimmed from Ultra's /learn/api/v1/courses/_87240_1/gradebook/columns and .../grades (English, Oct 2026)
const columns: GradebookColumn[] = [
  { id: '_1902479_1', columnName: 'Attendance', effectiveColumnName: 'Attendance', scoreProviderHandle: 'resource/x-bb-attendance', visible: true, gradesReleased: true, calculationType: 'NON_CALCULATED', possible: 100 },
  { id: '_1919643_1', columnName: 'Topic of a paragraph', effectiveColumnName: 'Topic of a paragraph', scoreProviderHandle: 'resource/x-bb-assessment', visible: true, gradesReleased: true, calculationType: 'NON_CALCULATED', possible: 2 },
  { id: '_1923809_1', columnName: 'Quiz 1', effectiveColumnName: 'Quiz 1', scoreProviderHandle: 'resource/x-bb-assessment', visible: true, gradesReleased: true, calculationType: 'NON_CALCULATED', possible: 5 },
  { id: '_1928045_1', columnName: 'EAP Midterm Exam', effectiveColumnName: 'EAP Midterm Exam', scoreProviderHandle: 'resource/x-bb-assessment', visible: true, gradesReleased: true, calculationType: 'NON_CALCULATED', possible: 20 },
  { id: '_1928745_1', columnName: 'Quiz 2', effectiveColumnName: 'Quiz 2', scoreProviderHandle: 'resource/x-bb-assessment', visible: true, gradesReleased: true, calculationType: 'NON_CALCULATED', possible: 5 }
];
const grades: GradebookGrade[] = [
  { columnId: '_1902479_1', status: 'GRADED', pointsPossible: 100, displayGrade: { score: 84.61538 }, effectiveScore: 84.61538 },
  { columnId: '_1928745_1', status: 'GRADED', pointsPossible: 5, displayGrade: { score: 5 }, effectiveScore: 5 },
  { columnId: '_1923809_1', status: 'GRADED', pointsPossible: 5, displayGrade: { score: 4.5 }, effectiveScore: 4.5 },
  { columnId: '_1928045_1', status: 'GRADED', pointsPossible: 20, displayGrade: { score: 20 }, effectiveScore: 20 },
  { columnId: '_1919643_1', status: 'NEEDS_GRADING', pointsPossible: 2 }
];
const english = { courseName: 'English for Academic Purposes', courseCode: '0202 112' };

function task(id: string, title: string, courseName: string, courseCode = ''): DeadlineTask {
  return { id, title, courseName, courseCode, type: 'quiz', status: 'pending', dueDate: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' } as DeadlineTask;
}

describe('reading marks from the Blackboard gradebook', () => {
  it('turns released grades into marks and skips attendance', () => {
    const ups = gradebookToUpdates(columns, grades, english);
    const graded = ups.filter(u => u.submissionStatus === 'graded');
    expect(graded.map(u => u.title).sort()).toEqual(['EAP Midterm Exam', 'Quiz 1', 'Quiz 2']);
    expect(graded.find(u => u.title === 'Quiz 1')?.scoreDisplay).toBe('4.5 / 5 (90%)');
    expect(ups.find(u => u.title === 'Topic of a paragraph')?.submissionStatus).toBe('submitted');
  });

  it('skips hidden, unreleased and calculated (total) columns', () => {
    const cols: GradebookColumn[] = [
      { id: 'a', columnName: 'Hidden', visible: false, possible: 5 },
      { id: 'b', columnName: 'Not released', gradesReleased: false, possible: 5 },
      { id: 'c', columnName: 'Total', calculationType: 'TOTAL', possible: 100 }
    ];
    const gs = ['a', 'b', 'c'].map(columnId => ({ columnId, status: 'GRADED', displayGrade: { score: 1 } }));
    expect(gradebookToUpdates(cols, gs, english)).toEqual([]);
  });

  it('puts each mark on the right course\'s task', () => {
    const tasks = [
      task('eap-q1', 'Quiz 1', 'English for Academic Purposes'),
      task('eap-mid', 'Midterm', 'English for Academic Purposes', 'UOS'),
      task('calc-q1', 'Quiz 1', 'Calculus I for Engineering'),
      task('calc-mid', 'Midterm', 'Calculus I for Engineering')
    ];
    const changed = applySubmissionUpdates(tasks, gradebookToUpdates(columns, grades, english));
    expect(changed).toBe(2);
    expect(tasks.find(t => t.id === 'eap-q1')?.scoreDisplay).toBe('4.5 / 5 (90%)');
    expect(tasks.find(t => t.id === 'eap-mid')?.scoreDisplay).toBe('20 / 20 (100%)');
    expect(tasks.find(t => t.id === 'calc-q1')?.score).toBeUndefined();
    expect(tasks.find(t => t.id === 'calc-mid')?.score).toBeUndefined();
  });

  it('leaves a task alone when its mark has not changed, so scans do not cause needless syncs', () => {
    const tasks = [task('eap-q1', 'Quiz 1', 'English for Academic Purposes')];
    const ups = gradebookToUpdates(columns, grades, english);
    applySubmissionUpdates(tasks, ups);
    const stamp = tasks[0].updatedAt;
    expect(applySubmissionUpdates(tasks, ups)).toBe(0);
    expect(tasks[0].updatedAt).toBe(stamp);
  });
});

describe('gradebook names that differ from task titles', () => {
  const lab = { courseName: 'Physics 1 Lab', courseCode: '1430 116' };
  const col = (id: string, name: string, possible: number): GradebookColumn => ({ id, columnName: name, possible, calculationType: 'NON_CALCULATED' });
  const graded = (id: string, score: number, possible: number): GradebookGrade => ({ columnId: id, status: 'GRADED', pointsPossible: possible, displayGrade: { score } });

  it('decodes "&amp;" so the Physics homework matches its task', () => {
    const ups = gradebookToUpdates([col('a', 'HW2_Phys.1_Cgaps 3 &amp; 4_Fall 2026-2027', 20)], [graded('a', 19.9, 20)], { courseName: 'Physics 1', courseCode: '1430 115' });
    expect(ups[0].title).toBe('HW2_Phys.1_Cgaps 3 & 4_Fall 2026-2027');
    const tasks = [task('hw2', 'HW2_Phys.1_Cgaps 3 & 4_Fall 2026-2027', 'Physics 1')];
    expect(applySubmissionUpdates(tasks, ups)).toBe(1);
    expect(tasks[0].score).toBe(19.9);
    expect(tasks[0].maxScore).toBe(20);
  });

  it('matches lab reports and "2nd Quiz" by their identifying words within the same course', () => {
    const tasks = [
      task('ff', 'Free Fall Exp. - Lab Report', 'Physics 1 Lab', '1430 116'),
      task('md', 'Measuring Density - Lab Report', 'Physics 1 Lab', '1430 116'),
      task('q2', 'Quiz 2', 'Physics 1 Lab'),
      task('calc-q2', 'Quiz 2', 'Calculus I for Engineering')
    ];
    const ups = gradebookToUpdates(
      [col('a', "Free Fall Exp. Student's Lab Report", 10), col('b', "Measuring Density, Student's Lab. Report", 10), col('c', '2nd Quiz (Vector &amp; Free Fall)', 10)],
      [graded('a', 10, 10), graded('b', 0, 10), graded('c', 6.5, 10)],
      lab
    );
    expect(applySubmissionUpdates(tasks, ups)).toBe(3);
    expect(tasks.find(t => t.id === 'ff')?.score).toBe(10);
    expect(tasks.find(t => t.id === 'md')?.score).toBe(0);
    expect(tasks.find(t => t.id === 'q2')?.score).toBe(6.5);
    expect(tasks.find(t => t.id === 'calc-q2')?.score).toBeUndefined();
  });

  it('keeps an already-graded displayGrade score even when a later attempt puts status in NEEDS_GRADING', () => {
    const cols: GradebookColumn[] = [
      { id: '_100_1', columnName: "Projectile Motion student's Lab. Report", possible: 10, calculationType: 'NON_CALCULATED', visible: true, gradesReleased: true }
    ];
    const gs: GradebookGrade[] = [
      { columnId: '_100_1', status: 'NEEDS_GRADING', pointsPossible: 10, displayGrade: { score: 9 }, effectiveScore: 9 }
    ];
    const ups = gradebookToUpdates(cols, gs, lab);
    expect(ups).toHaveLength(1);
    expect(ups[0].submissionStatus).toBe('graded');
    expect(ups[0].score).toBe(9);
  });

  it('extracts direct deadlines from linked gradebook columns and ignores manual instructor columns', () => {
    const cols: GradebookColumn[] = [
      {
        id: '_201_1',
        columnName: 'Work-Kinetic Energy Theorem Lab. Report',
        possible: 10,
        calculationType: 'NON_CALCULATED',
        visible: true,
        userCreatedColumn: false,
        contentId: '_9001_1',
        dueDate: '2026-10-31T19:59:00.000Z'
      },
      {
        id: '_202_1',
        columnName: 'Manual Instructor Quiz Column',
        possible: 10,
        calculationType: 'NON_CALCULATED',
        visible: true,
        userCreatedColumn: true,
        dueDate: '2026-10-15T08:12:34.327Z'
      }
    ];
    const tasks = gradebookColumnsToTasks(cols, { courseName: 'Physics 1 Lab', courseCode: '1430 116', courseId: '_85276_1' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Work-Kinetic Energy Theorem Lab. Report');
    expect(tasks[0].dueDate).toBe('2026-10-31T19:59:00.000Z');
    expect(tasks[0].courseCode).toBe('1430 116');
  });

  it('parses Ultra stream HTTP JSON entries into direct tasks, announcements, and grade updates', () => {
    const courses = new Map([
      ['_85276_1', { name: 'Physics 1 Lab', code: '1430 116' }],
      ['_87186_1', { name: 'Islamic Culture', code: '0104 100' }],
      ['_84448_1', { name: 'Student Hands-On Orientation', code: '' }]
    ]);
    const payload = {
      sv_streamEntries: [
        {
          providerId: 'bb-nautilus',
          se_courseId: '_85276_1',
          itemSpecificData: {
            title: 'Work-Kinetic Energy Theorem Lab. Report',
            notificationDetails: {
              dueDate: '2026-10-31T19:59:00.000Z',
              eventType: 'AS:DUE'
            }
          }
        },
        {
          providerId: 'bb-announcement',
          se_courseId: '_87186_1',
          se_id: '_555_1',
          itemSpecificData: {
            title: 'Quiz 2 Date',
            notificationDetails: {
              announcementTitle: 'Quiz 2 Date',
              announcementBody: '<p>Quiz 2 will be held on November 5.</p>',
              startDate: '2026-10-25T10:00:00.000Z'
            }
          }
        },
        {
          providerId: 'bb_mygrades',
          se_courseId: '_85276_1',
          se_rhs: 'gradable_item_id=_1903728_1',
          itemSpecificData: {
            title: 'Vectors Exp. Lab Report',
            gradeDetails: {
              displayGradeScore: 8.5,
              pointsPossible: 10,
              calculationType: 'NON_CALCULATED',
              lastGradedDate: '2026-10-20T12:00:00.000Z'
            }
          }
        },
        {
          providerId: 'bb_mygrades',
          se_courseId: '_84448_1',
          itemSpecificData: {
            title: 'Blackboard Orientation Knowledge Check',
            gradeDetails: {
              displayGradeScore: 100,
              pointsPossible: 100,
              calculationType: 'NON_CALCULATED'
            }
          }
        }
      ]
    };
    const res = parseUltraStreamEntries(payload, courses, 'https://elearning.sharjah.ac.ae');
    expect(res.directTasks).toHaveLength(1);
    expect(res.directTasks[0].title).toBe('Work-Kinetic Energy Theorem Lab. Report');
    expect(res.announcements).toHaveLength(1);
    expect(res.announcements[0].title).toBe('Quiz 2 Date');
    expect(res.submissionUpdates).toHaveLength(1);
    expect(res.submissionUpdates[0].title).toBe('Vectors Exp. Lab Report');
    expect(res.submissionUpdates[0].score).toBe(8.5);
  });
});
