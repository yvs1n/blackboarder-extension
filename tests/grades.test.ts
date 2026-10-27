import { describe, it, expect } from 'vitest';
import { buildGpaSummary } from '../src/utils/gpa';
import { buildMarksSummary } from '../src/utils/marks';
import { gradesHtml, gradesBadgeText } from '../src/utils/grades';

const syllabi = [
  { courseName: 'Physics 1', courseCodePattern: /physics/i, totalWeight: 100, creditHours: 3, components: [] },
  { courseName: 'English', courseCodePattern: /english/i, totalWeight: 100, creditHours: 3, components: [] }
];
const task = (o: any) => ({ id: o.title, type: 'quiz', status: 'completed', dueDate: '2026-10-01', ...o });

describe('Grades card (GPA and marks together)', () => {
  const tasks = [
    task({ title: 'Quiz 1', courseName: 'Physics 1', weight: 10, submissionStatus: 'graded', score: 8, maxScore: 10 }),
    task({ title: 'Lab 1', courseName: 'Physics 1', weight: 10, submissionStatus: 'submitted' }),
    task({ title: 'Essay', courseName: 'Elective Art', weight: 10, submissionStatus: 'graded', score: 9, maxScore: 10 })
  ] as any;
  const gpa = buildGpaSummary(tasks, syllabi);
  const marks = buildMarksSummary(tasks, syllabi);
  const html = gradesHtml(gpa, marks, () => '#000');

  it('puts each mark under its course grade', () => {
    const physics = html.indexOf('Physics 1');
    const english = html.indexOf('>English<');
    expect(physics).toBeGreaterThan(-1);
    expect(html.indexOf('Quiz 1')).toBeGreaterThan(physics);
    expect(html.indexOf('Quiz 1')).toBeLessThan(english);
    expect(html).toContain('8 of 10 marks so far · B = 3.0 of 4.0 GPA points');
    expect(html).toContain('Submitted');
  });

  it('still lists marks for a course that is not set up', () => {
    expect(html).toContain('Elective Art');
    expect(html.indexOf('Essay')).toBeGreaterThan(html.indexOf('Elective Art'));
  });

  it('badge shows the GPA and the mark count', () => {
    expect(gradesBadgeText(gpa, marks)).toBe('GPA 3.00 · 2 marks · 1 awaiting');
    expect(html).not.toMatch(/\u2014/);
  });
});
