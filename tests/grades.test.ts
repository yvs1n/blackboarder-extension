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

  it('renders dual GPA and degree progress when cumulative history exists', () => {
    const cumulative = {
      termGpa: 3.00,
      termGradedCredits: 3,
      termTotalCredits: 6,
      cgpa: 3.45,
      totalGradedCredits: 48,
      totalCompletedCredits: 48,
      targetCredits: 130,
      degreeProgressPercent: 37,
      archivedSemestersCount: 2
    };

    const dualHtml = gradesHtml(gpa, marks, () => '#000', { name: 'UOS', scale: [] as any }, cumulative);
    expect(dualHtml).toContain('Term SGPA');
    expect(dualHtml).toContain('Cumulative CGPA');
    expect(dualHtml).toContain('3.45');
    expect(dualHtml).toContain('37%');
    expect(gradesBadgeText(gpa, marks, cumulative)).toBe('CGPA 3.45 · Term 3.00 · 2 marks · 1 awaiting');
  });

  it('renders target grade requirements and exam score targets', () => {
    const upcomingTasks = [
      task({ title: 'Final Exam', courseName: 'Physics 1', weight: 50, maxScore: 100, status: 'pending' })
    ] as any;
    const htmlWithTargets = gradesHtml(gpa, marks, () => '#000', { name: 'UOS', scale: [] as any }, null, {
      tasks: upcomingTasks
    });
    expect(htmlWithTargets).toContain('Target Grade');
    expect(htmlWithTargets).toContain('target-chip');
    expect(htmlWithTargets).toContain('Final Exam');
  });

  it('renders 3 distinct sections: Dual-Column GPA Overview, Current Term Grades, and Target Grade Breakdown', () => {
    const upcomingTasks = [
      task({ title: 'Final Exam', courseName: 'Physics 1', weight: 50, maxScore: 100, status: 'pending' })
    ] as any;
    const fullHtml = gradesHtml(gpa, marks, () => '#000', { name: 'UOS', scale: [] as any }, null, {
      tasks: upcomingTasks,
      targetTermGpa: 3.91
    });

    // Section 1: Dual-Column GPA Overview
    expect(fullHtml).toContain('marks-gpa-overview');
    expect(fullHtml).toContain('Current Standing');
    expect(fullHtml).toContain('Academic Goal');
    expect(fullHtml).toContain('Planned SGPA');

    // Nearest attainable discrete rounding explanation (e.g. 3.91 -> 3.97)
    expect(fullHtml).toContain('Nearest attainable combination');
    expect(fullHtml).toContain('discrete scale points');

    // Section 2: Current Term Grades
    expect(fullHtml).toContain('id="marks-card-current-grades"');
    expect(fullHtml).toContain('Current Term Grades');

    // Section 3: Target Grade Breakdown
    expect(fullHtml).toContain('id="marks-card-target-breakdown"');
    expect(fullHtml).toContain('Target Grade Breakdown');
    expect(fullHtml).toContain('target-course-card');
    expect(fullHtml).toContain('trajectory-bar-track');
    expect(fullHtml).toContain('target-task-item');
    expect(fullHtml).not.toMatch(/\u2014/);
  });

  it('renders course marks cards with left accent borders and footer status bars', () => {
    const htmlWithColors = gradesHtml(gpa, marks, name => name.includes('Physics') ? '#2196f3' : '#4caf50');
    expect(htmlWithColors).toContain('border-left: 3px solid #2196f3');
    expect(htmlWithColors).toContain('marks-course-meta');
    expect(htmlWithColors).toContain('marks-course-footer');
    expect(htmlWithColors).toContain('Graded');
  });

  it('supports Cumulative CGPA Scholarship target mode and reverse-calculates required Term SGPA', () => {
    const cumulativeHistory = {
      termGpa: 3.00,
      termGradedCredits: 3,
      termTotalCredits: 6,
      cgpa: 3.30,
      totalGradedCredits: 33, // 30 prior credits + 3 current graded credits
      totalCompletedCredits: 33,
      targetCredits: 130,
      degreeProgressPercent: 25,
      archivedSemestersCount: 2
    };

    const upcomingTasks = [
      task({ title: 'Final Exam', courseName: 'Physics 1', weight: 50, maxScore: 100, status: 'pending' })
    ] as any;

    const scholarshipHtml = gradesHtml(gpa, marks, () => '#000', { name: 'UOS', scale: [] as any }, cumulativeHistory, {
      tasks: upcomingTasks,
      targetCgpa: 3.40,
      targetGpaMode: 'cgpa'
    });

    expect(scholarshipHtml).toContain('Target Cumulative CGPA (Scholarship)');
    expect(scholarshipHtml).toContain('Scholarship Target:');
    expect(scholarshipHtml).toContain('Requires');
    expect(scholarshipHtml).toContain('Term SGPA');
    expect(scholarshipHtml).toContain('gpa-predictor-guide');
    expect(scholarshipHtml).toContain('How the GPA &amp; Scholarship Predictor Works');
    expect(scholarshipHtml).not.toMatch(/\u2014/);
  });

  it('flags unattainable scholarship CGPA targets and displays highest achievable cumulative GPA', () => {
    const cumulativeHistory = {
      termGpa: 2.00,
      termGradedCredits: 3,
      termTotalCredits: 6,
      cgpa: 2.50,
      totalGradedCredits: 63, // 60 prior credits at 2.50 CGPA, term is 6 credits
      totalCompletedCredits: 63,
      targetCredits: 130,
      degreeProgressPercent: 50,
      archivedSemestersCount: 4
    };

    const impossibleHtml = gradesHtml(gpa, marks, () => '#000', { name: 'UOS', scale: [] as any }, cumulativeHistory, {
      targetCgpa: 3.80,
      targetGpaMode: 'cgpa'
    });

    expect(impossibleHtml).toContain('is unattainable this semester');
    expect(impossibleHtml).toContain('Highest achievable Cumulative CGPA after this semester');
    expect(impossibleHtml).toContain('btn-set-max-cgpa');
    expect(impossibleHtml).not.toMatch(/\u2014/);
  });
});
