import type { DeadlineTask } from '../types';

export interface ProgressSyllabus {
  courseName: string;
  courseCodePattern: RegExp;
  totalWeight?: number;
}

export interface CourseProgress {
  courseName: string;
  totalWeight: number;
  /** Weight of tasks marked done */
  completedWeight: number;
  /** Weight of tasks still to do */
  pendingWeight: number;
  /** Weight not covered by any task yet */
  upcomingWeight: number;
  /** completedWeight as a share of the course, 0-100 */
  percentDone: number;
}

export interface SyllabusProgress {
  courses: CourseProgress[];
  /** Done weight across all courses as a share of all course weight, 0-100 */
  overallPercent: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** How much of each course's syllabus weight is done, still pending, or not announced yet. */
export function buildSyllabusProgress(tasks: DeadlineTask[], syllabi: ProgressSyllabus[]): SyllabusProgress {
  let done = 0;
  let total = 0;
  const courses = syllabi.map(s => {
    const totalWeight = s.totalWeight || 100;
    let completed = 0;
    let pending = 0;
    for (const t of tasks || []) {
      if (!t) continue;
      const hit = s.courseCodePattern.test(t.courseName || '') || s.courseCodePattern.test(t.courseCode || '') || s.courseCodePattern.test(t.title || '');
      if (!hit) continue;
      const w = Number(t.weight) || 0;
      if (t.status === 'completed') completed += w;
      else pending += w;
    }
    completed = round1(Math.min(completed, totalWeight));
    pending = round1(Math.min(pending, totalWeight - completed));
    done += completed;
    total += totalWeight;
    return {
      courseName: s.courseName,
      totalWeight,
      completedWeight: completed,
      pendingWeight: pending,
      upcomingWeight: round1(Math.max(0, totalWeight - completed - pending)),
      percentDone: Math.round((completed / totalWeight) * 100)
    };
  });
  return { courses, overallPercent: total > 0 ? Math.round((done / total) * 100) : 0 };
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** The Syllabus Progress list, shared by the popup and the phone app (same classes in both stylesheets). */
export function syllabusProgressHtml(p: SyllabusProgress, colorFor: (courseName: string) => string): string {
  if (!p.courses.length) return '<div class="marks-empty">No courses configured yet.</div>';
  return p.courses.map(c => {
    const pendingPct = Math.round((c.pendingWeight / c.totalWeight) * 100);
    return `<div class="marks-course">
      <div class="marks-course-head"><span class="marks-dot" style="background:${esc(colorFor(c.courseName))}"></span><span class="marks-course-name">${esc(c.courseName)}</span><span class="marks-course-total">${c.percentDone}% done</span></div>
      <div class="syl-bar" role="img" aria-label="${c.completedWeight}% done, ${c.pendingWeight}% pending, ${c.upcomingWeight}% not announced yet"><span class="syl-done" style="width:${c.percentDone}%"></span><span class="syl-pending" style="width:${Math.min(100 - c.percentDone, pendingPct)}%"></span></div>
      <div class="syl-legend"><span>Done ${c.completedWeight}%</span><span>Pending ${c.pendingWeight}%</span><span>Not announced ${c.upcomingWeight}%</span></div>
    </div>`;
  }).join('');
}
