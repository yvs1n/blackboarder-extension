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

describe('unannounced gradebook marks survive popup open, background refresh, and reopen simulation', () => {
  it('preserves unannounced marks with empty dueDate through complete popup lifecycle', async () => {
    const { isValidTask, findLegacyNamelessTaskIds } = await import('../src/core/courseHelper');
    const { purgeSyntheticGradebookTasks } = await import('../src/utils/gradebook');
    const { deduplicateTaskList, mergeCloudTasks } = await import('../src/utils/taskMerge');
    const { compareTasksByTime } = await import('../src/utils/calendar');
    const { sanitizeCloudTasks } = await import('../src/utils/cloudSanitize');
    const { resolveTaskTimeWithSchedule } = await import('../src/core/courseSchedule');

    // 1. Initial State: Scanned tasks saved in storage
    const scannedUnannouncedQuiz: DeadlineTask = {
      id: 'gbcol_1440133_q1grade',
      title: 'Quiz 1 Grade',
      courseName: 'Calculus I for Engineering',
      courseCode: '1440133',
      dueDate: '',
      hasSpecificTime: false,
      type: 'quiz',
      status: 'completed',
      submissionStatus: 'graded',
      score: 10,
      maxScore: 10,
      scoreDisplay: '10 / 10 (100%)',
      sourceSnippet: 'gradebook',
      gradeSourceId: 'gb:_1001_1',
      extractedBy: 'local',
      createdAt: '2026-10-29T08:00:00.000Z',
      updatedAt: '2026-10-29T08:00:00.000Z'
    } as DeadlineTask;

    const scannedParticipation: DeadlineTask = {
      id: 'gbcol_0401201_part',
      title: 'Participation',
      courseName: 'Computer Programming',
      courseCode: '0401201',
      dueDate: '',
      hasSpecificTime: false,
      type: 'other',
      status: 'completed',
      submissionStatus: 'graded',
      score: 10,
      maxScore: 10,
      scoreDisplay: '10 / 10',
      sourceSnippet: 'gradebook',
      gradeSourceId: 'gb:_1002_1',
      extractedBy: 'local',
      createdAt: '2026-10-29T08:00:00.000Z',
      updatedAt: '2026-10-29T08:00:00.000Z'
    } as DeadlineTask;

    const announcedAssignment: DeadlineTask = {
      id: 'ann_calc_a1',
      title: 'Assignment 1',
      courseName: 'Calculus I for Engineering',
      courseCode: '1440133',
      dueDate: '2026-10-31T23:59:00.000Z',
      hasSpecificTime: true,
      type: 'assignment',
      status: 'pending',
      extractedBy: 'local',
      createdAt: '2026-10-29T08:00:00.000Z',
      updatedAt: '2026-10-29T08:00:00.000Z'
    } as DeadlineTask;

    let storageTasks = [scannedUnannouncedQuiz, scannedParticipation, announcedAssignment];

    // --- POPUP OPEN SESSION 1 (initApp) ---
    // Step 1: isValidTask filtering on cache load
    const cachedValid = storageTasks.filter(isValidTask);
    expect(cachedValid).toHaveLength(3);
    expect(cachedValid.find(t => t.id === 'gbcol_1440133_q1grade')).toBeDefined();
    expect(cachedValid.find(t => t.id === 'gbcol_0401201_part')).toBeDefined();

    // Step 2: purgeSyntheticGradebookTasks
    const { cleaned: purgedCached, purgedIds } = purgeSyntheticGradebookTasks(cachedValid);
    expect(purgedIds).toHaveLength(0);
    expect(purgedCached).toHaveLength(3);

    // Step 3: deduplicateTaskList
    let currentTasks = deduplicateTaskList(purgedCached);
    expect(currentTasks).toHaveLength(3);

    // Step 4: compareTasksByTime sorting
    expect(() => currentTasks.sort(compareTasksByTime)).not.toThrow();
    expect(currentTasks).toHaveLength(3);

    // --- BACKGROUND REFRESH (refreshDataInBackground) ---
    // Step 5: getTasks() and validate
    const freshTasks = storageTasks.filter(isValidTask);
    expect(freshTasks).toHaveLength(3);

    // Step 6: resolveTaskTimeWithSchedule (must be guarded against empty due date)
    for (const task of freshTasks) {
      if (!task.hasSpecificTime && task.dueDate) {
        const schedRes = resolveTaskTimeWithSchedule({
          dueDate: new Date(task.dueDate),
          courseNameOrCode: task.courseName || task.courseCode,
          hasSpecificTime: false,
          title: task.title
        });
        if (schedRes.appliedSchedule) {
          task.dueDate = schedRes.dueDate.toISOString();
        }
      }
    }
    // Verify due date was NOT altered for empty due date tasks
    expect(freshTasks.find(t => t.id === 'gbcol_1440133_q1grade')?.dueDate).toBe('');
    expect(freshTasks.find(t => t.id === 'gbcol_0401201_part')?.dueDate).toBe('');

    // Step 7: legacy nameless cleanup
    const legacyIds = new Set(findLegacyNamelessTaskIds(freshTasks as any));
    expect(legacyIds.has('gbcol_1440133_q1grade')).toBe(false);
    expect(legacyIds.has('gbcol_0401201_part')).toBe(false);

    // Step 8: Cloud sync cycle (sanitize & merge)
    const sanitizedCloud = sanitizeCloudTasks(freshTasks);
    expect(sanitizedCloud).toHaveLength(3);
    const { tasks: mergedTasks } = mergeCloudTasks(freshTasks, sanitizedCloud);
    expect(mergedTasks).toHaveLength(3);

    // Simulated safe save back to storage
    storageTasks = [...mergedTasks];

    // --- POPUP REOPEN SESSION 2 ---
    // Repeat load flow from storage
    const reopenValid = storageTasks.filter(isValidTask);
    const { cleaned: reopenCleaned } = purgeSyntheticGradebookTasks(reopenValid);
    const reopenTasks = deduplicateTaskList(reopenCleaned);
    reopenTasks.sort(compareTasksByTime);

    // Final Assertion: unannounced marks exist and retain exact score and status
    expect(reopenTasks).toHaveLength(3);
    const quiz = reopenTasks.find(t => t.id === 'gbcol_1440133_q1grade')!;
    expect(quiz).toBeDefined();
    expect(quiz.score).toBe(10);
    expect(quiz.maxScore).toBe(10);
    expect(quiz.submissionStatus).toBe('graded');
    expect(quiz.status).toBe('completed');
    expect(quiz.dueDate).toBe('');

    const part = reopenTasks.find(t => t.id === 'gbcol_0401201_part')!;
    expect(part).toBeDefined();
    expect(part.score).toBe(10);
    expect(part.maxScore).toBe(10);
    expect(part.submissionStatus).toBe('graded');
    expect(part.status).toBe('completed');
  });

  it('verifies that popup.ts contains zero unmerged saveTasks calls in synthetic purge handlers', () => {
    const popupContent = fs.readFileSync('src/popup/popup.ts', 'utf8');
    // Lines around purgeSyntheticGradebookTasks must not use bare saveTasks
    const purgeMatches = popupContent.match(/purgeSyntheticGradebookTasks[\s\S]{1,150}saveTasks\(/g);
    expect(purgeMatches).toBeNull();
  });
});

