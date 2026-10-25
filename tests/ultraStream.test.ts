import { describe, it, expect } from 'vitest';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';
import { Announcement } from '../src/types';

describe('Blackboard Ultra Stream Direct & Announcement Extraction', () => {
  it('extracts "Wednesday 16th" announcement date accurately', () => {
    const ann: Announcement = {
      id: 'ann-ultra-1',
      courseCode: '0401201',
      courseName: 'Calculus I for Engineering',
      title: 'Quiz 1',
      postedAt: '2026-09-07T12:00:00.000Z',
      contentText: 'Dear students,\nQuiz 1 is going to take place next week on Wednesday 16th or Thursday 17th depending on your section schedule.',
      sourceUrl: 'https://blackboard.sharjah.ac.ae/ultra/stream',
      scannedAt: '2026-09-07T14:00:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks.length).toBeGreaterThanOrEqual(1);

    const quizTask = tasks[0];
    expect(quizTask.type).toBe('quiz');
    expect(quizTask.title).toContain('Quiz 1');

    const dueDate = new Date(quizTask.dueDate);
    expect(dueDate.getFullYear()).toBe(2026);
    expect(dueDate.getMonth()).toBe(8); // September (0-indexed)
    expect(dueDate.getDate()).toBe(16);
  });

  it('parses all 4 direct due date cards from the user screenshot', async () => {
    const { parseDirectStreamCard } = await import('../src/utils/streamParser');

    // Item 1
    const card1 = `Calculus I for Engineering - 02 - حسبان 1 للمهندسين
Due: Assignment-1-Graded
Due Date: 9/18/26, 11:59 PM (UTC+4)`;
    const task1 = parseDirectStreamCard(card1);
    expect(task1).not.toBeNull();
    expect(task1?.title).toBe('Assignment-1-Graded');
    expect(task1?.courseName).toBe('Calculus I for Engineering');
    // "(UTC+4)" is honoured, so the instant is the same in any browser time zone
    expect(task1!.dueDate).toBe('2026-09-18T19:59:00.000Z');

    // Item 2
    const card2 = `Physics 1 - ALL - 1 - الفيزياء-1
Due: HW1_Phys.1_Fall26-27 (chap. 1 & Chap. 2)
Due Date: 9/20/26, 11:59 PM (UTC+4)`;
    const task2 = parseDirectStreamCard(card2);
    expect(task2).not.toBeNull();
    expect(task2?.title).toBe('HW1_Phys.1_Fall26-27 (chap. 1 & Chap. 2)');
    expect(task2?.courseName).toBe('Physics 1');
    expect(task2!.dueDate).toBe('2026-09-20T19:59:00.000Z');

    // Item 3
    const card3 = `Islamic Culture - 13A - الثقافة الإسلامية
Due: البحث العلمي (واجب جماعي) 15 درجة
Due Date: 10/15/26, 11:59 PM (UTC+4)`;
    const task3 = parseDirectStreamCard(card3);
    expect(task3).not.toBeNull();
    expect(task3?.title).toBe('البحث العلمي (واجب جماعي) 15 درجة');
    expect(task3?.courseName).toBe('Islamic Culture');
    expect(task3!.dueDate).toBe('2026-10-15T19:59:00.000Z');

    // Item 4
    const card4 = `Islamic Culture - 13A - الثقافة الإسلامية
Due: واجب (10 درجات)
Due Date: 10/25/26, 5:59 AM (UTC+4)`;
    const task4 = parseDirectStreamCard(card4);
    expect(task4).not.toBeNull();
    expect(task4?.title).toBe('واجب (10 درجات)');
    expect(task4!.dueDate).toBe('2026-10-25T01:59:00.000Z');
  });

  it('parses submission confirmations and grade receipts accurately', async () => {
    const { parseSubmissionOrGradeCard } = await import('../src/utils/streamParser');

    // Case 1: Graded card with fractional score
    const gradedCard1 = `Physics 1 - ALL - 1 - الفيزياء-1
Grade posted: HW1_Phys.1_Fall26-27
9.5 / 10`;
    const res1 = parseSubmissionOrGradeCard(gradedCard1);
    expect(res1).not.toBeNull();
    expect(res1?.submissionStatus).toBe('graded');
    expect(res1?.score).toBe(9.5);
    expect(res1?.maxScore).toBe(10);
    expect(res1?.scoreDisplay).toBe('9.5 / 10 (95%)');
    expect(res1?.courseName).toBe('Physics 1');

    // Case 2: Graded card with decimal and percentage
    const gradedCard2 = `Calculus I for Engineering - 02
New grade available: Quiz 1
85%`;
    const res2 = parseSubmissionOrGradeCard(gradedCard2);
    expect(res2).not.toBeNull();
    expect(res2?.submissionStatus).toBe('graded');
    expect(res2?.score).toBe(85);
    expect(res2?.maxScore).toBe(100);
    expect(res2?.scoreDisplay).toBe('85%');

    // Case 3: Submission receipt confirmation
    const submittedCard = `Islamic Culture - 13A - الثقافة الإسلامية
You submitted: واجب (10 درجات)
Submitted on 10/12/26, 8:30 PM
Confirmation Number: #SUB-892147-OK`;
    const res3 = parseSubmissionOrGradeCard(submittedCard);
    expect(res3).not.toBeNull();
    expect(res3?.submissionStatus).toBe('submitted');
    expect(res3?.submissionReceipt).toBe('#SUB-892147-OK');
    expect(res3?.courseName).toBe('Islamic Culture');

    // Case 4: Non-submission card returns null
    const normalCard = `Just a normal notification card without grade or submission words.`;
    const res4 = parseSubmissionOrGradeCard(normalCard);
    expect(res4).toBeNull();
  });
});
