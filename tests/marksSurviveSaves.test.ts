import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { mergeCloudTasks } from '../src/utils/taskMerge';
import { gradebookToUpdates, applySubmissionUpdates, GradebookColumn, GradebookGrade } from '../src/utils/gradebook';
import type { DeadlineTask } from '../src/types';

const NOW = new Date('2026-10-23T12:00:00Z').getTime();
const t = (o: Partial<DeadlineTask>) => ({ type: 'quiz', status: 'pending', extractedBy: 'local', createdAt: '', ...o } as DeadlineTask);

describe('a scan\'s marks survive the popup saving an older copy', () => {
  it('per task, the newer copy wins when the popup saves', () => {
    const stalePopup = [t({ id: 'a1', title: 'Assignment 1', courseName: 'Calculus I for Engineering', dueDate: '2026-09-28T19:00:00Z', updatedAt: '2026-10-23T10:00:00Z' })];
    const storedByScan = [t({ id: 'a1', title: 'Assignment 1', courseName: 'Calculus I for Engineering', dueDate: '2026-09-28T19:00:00Z', updatedAt: '2026-10-23T10:05:00Z', submissionStatus: 'graded', score: 15, maxScore: 15, status: 'completed' })];
    const { tasks } = mergeCloudTasks(stalePopup, storedByScan, {});
    expect(tasks[0].score).toBe(15);
    expect(tasks[0].submissionStatus).toBe('graded');
  });

  it('popup and scan saves go through the merging save', () => {
    const popup = fs.readFileSync('src/popup/popup.ts', 'utf8');
    expect(popup.match(/saveTasksMergingLatest\(/g)!.length).toBeGreaterThanOrEqual(2);
    expect(popup).toContain('resolved.weight !== undefined && resolved.weight !== task.weight)');
    expect(fs.readFileSync('src/content/scraper.ts', 'utf8')).toContain('await saveTasksMergingLatest(finalTasks);');
  });
});

describe('the owner\'s real gradebook item names reach their deadlines (scores made up)', () => {
  const col = (id: string, name: string, possible = 10): GradebookColumn =>
    ({ id, effectiveColumnName: name, possible, calculationType: 'NON_CALCULATED', visible: true, gradesReleased: true });
  const g = (columnId: string, score: number | null, status = 'GRADED'): GradebookGrade =>
    ({ columnId, status, pointsPossible: 10, displayGrade: score === null ? null : { score } });

  const tasks = [
    t({ id: 'calc-a1', title: 'Assignment 1', courseName: 'Calculus I for Engineering', courseCode: '1440133', extractedBy: 'manual', userEdited: true, dueDate: '2026-09-28T19:00:00Z', updatedAt: 'x' }),
    t({ id: 'calc-a2', title: 'Assignment 2', courseName: 'Calculus I for Engineering', dueDate: '2026-10-08T19:00:00Z', updatedAt: 'x' }),
    t({ id: 'cpe-q1', title: 'Quiz 1', courseName: 'Introduction to Computer Eng.', dueDate: '2026-09-10T07:00:00Z', updatedAt: 'x' }),
    t({ id: 'lab-q2', title: 'Quiz 2', courseName: 'Physics 1 Lab', dueDate: '2026-09-30T10:00:00Z', updatedAt: 'x' }),
    t({ id: 'phy-hw2', title: 'HW2_Phys.1_Cgaps 3 & 4_Fall 2026-2027', courseName: 'Physics 1', dueDate: '2026-10-11T19:59:00Z', updatedAt: 'x' }),
    t({ id: 'isl-mid', title: 'Midterm', courseName: 'Islamic Culture', courseCode: '0104100', dueDate: '2026-10-10T04:30:00Z', updatedAt: 'x' }),
    t({ id: 'eap-mid', title: 'Midterm', courseName: 'English for Academic Purposes', courseCode: 'UOS', extractedBy: 'manual', userEdited: true, dueDate: '2026-10-25T06:00:00Z', updatedAt: 'x' })
  ];
  // Course names as the scan derives them from Blackboard ("Calculus I for Engineering- 02 - ...")
  const updates = [
    ...gradebookToUpdates([col('_c1', 'Assignment-1-Graded', 15), col('_c2', 'Assignment 2')], [g('_c1', 14), g('_c2', 9)], { courseName: 'Calculus I for Engineering', courseCode: 'UOS' }),
    ...gradebookToUpdates([col('_p1', 'Quiz1', 25)], [g('_p1', 20)], { courseName: 'Introduction to Computer Eng.', courseCode: 'UOS' }),
    ...gradebookToUpdates([col('_l1', '2nd Quiz (Vector & Free Fall)')], [g('_l1', 7)], { courseName: 'Physics 1 Lab', courseCode: 'UOS' }),
    ...gradebookToUpdates([col('_h2', 'HW2_Phys.1_Cgaps 3 &amp; 4_Fall 2026-2027', 20)], [g('_h2', 18)], { courseName: 'Physics 1', courseCode: 'UOS' }),
    ...gradebookToUpdates([col('_i1', 'MIDTERM EXAM', 25)], [g('_i1', 21)], { courseName: 'Islamic Culture', courseCode: 'UOS' }),
    ...gradebookToUpdates([col('_e1', 'EAP Midterm Exam', 20)], [g('_e1', 19)], { courseName: 'English for Academic Purposes', courseCode: 'UOS' })
  ];

  it('every mark lands on its own task, and the practice midterm stays off the real one', () => {
    applySubmissionUpdates(tasks, updates, NOW);
    const score = (id: string) => tasks.find(x => x.id === id)!.score;
    expect(score('calc-a1')).toBe(14);
    expect(score('calc-a2')).toBe(9);
    expect(score('cpe-q1')).toBe(20);
    expect(score('lab-q2')).toBe(7);
    expect(score('phy-hw2')).toBe(18);
    expect(score('isl-mid')).toBe(21);
    expect(score('eap-mid')).toBeUndefined();
  });
});
