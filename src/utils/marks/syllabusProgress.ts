import type { DeadlineTask, UiLanguage } from '../../types';
import { round1, esc } from '../ui/uiCommon';

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

/** How much of each course's syllabus weight is done, still pending, or not announced yet. */
export function buildSyllabusProgress(tasks: DeadlineTask[], syllabi: ProgressSyllabus[]): SyllabusProgress {
  let done = 0;
  let total = 0;
  const courses = syllabi.map(s => {
    const totalWeight = s.totalWeight || 100;
    let completed = 0;
    let pending = 0;
    for (const t of tasks || []) {
      if (!t || t.ignoreMark || t.visibility === 'hidden') continue;
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

/** The Syllabus Progress list, shared by the popup and the phone app (same classes in both stylesheets). */
export function syllabusProgressHtml(
  p: SyllabusProgress,
  colorFor: (courseName: string) => string,
  lang: UiLanguage = 'en'
): string {
  const isAr = lang === 'ar';
  if (!p.courses.length) {
    return `<div class="marks-empty">${isAr ? 'لا توجد مساقات مهيأة بعد.' : 'No courses configured yet.'}</div>`;
  }
  return p.courses.map(c => {
    const pendingPct = Math.round((c.pendingWeight / c.totalWeight) * 100);
    const doneLabel = isAr ? `${c.percentDone}% مكتمل` : `${c.percentDone}% done`;
    const aria = isAr
      ? `${c.completedWeight}% مكتمل، ${c.pendingWeight}% متبقي، ${c.upcomingWeight}% غير معلن`
      : `${c.completedWeight}% done, ${c.pendingWeight}% pending, ${c.upcomingWeight}% not announced yet`;
    return `<div class="marks-course">
      <div class="marks-course-head"><span class="marks-dot" style="background:${esc(colorFor(c.courseName))}"></span><span class="marks-course-name">${esc(c.courseName)}</span><span class="marks-course-total">${doneLabel}</span></div>
      <div class="syl-bar" role="img" aria-label="${aria}"><span class="syl-done" style="width:${c.percentDone}%"></span><span class="syl-pending" style="width:${Math.min(100 - c.percentDone, pendingPct)}%"></span></div>
      <div class="syl-legend"><span>${isAr ? 'مكتمل' : 'Done'} ${c.completedWeight}%</span><span>${isAr ? 'قيد الانتظار' : 'Pending'} ${c.pendingWeight}%</span><span>${isAr ? 'غير معلن' : 'Not announced'} ${c.upcomingWeight}%</span></div>
    </div>`;
  }).join('');
}
