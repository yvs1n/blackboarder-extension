/**
 * The "check before saving" list for imported courses, shared by the popup and the phone app
 * (same class names in both stylesheets). The student can untick a course, fix its code, name and
 * credit hours, and choose which of their courses it goes into.
 */
import type { UserCourseConfig } from '../types';
import { matchExistingCourse, type CourseDraft, type CourseImportPick } from './courseDocument';

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const SHORT_DAY: Record<string, string> = {
  Sunday: 'Sun', Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat'
};

/** One line per thing found, for the review card. */
export function describeCourseDraft(draft: CourseDraft): { meets: string[]; weights: string; total: number } {
  const meets = draft.scheduleSlots.map(s => {
    const days = s.days.map(d => SHORT_DAY[d] || d).join(', ');
    const room = s.room && s.room !== 'TBA' ? `, ${s.room}` : '';
    return `${days} ${s.startTime} to ${s.endTime}${room}`;
  });
  const total = Math.round(draft.syllabus.reduce((sum, c) => sum + c.totalWeight, 0) * 100) / 100;
  const weights = draft.syllabus.map(c => {
    const count = c.count ? (c.outOf ? ` (best ${c.count} of ${c.outOf})` : ` (${c.count})`) : '';
    return `${c.name} ${c.totalWeight}%${count}`;
  }).join(' · ');
  return { meets, weights, total };
}

export function courseImportReviewHtml(
  drafts: CourseDraft[],
  existing: UserCourseConfig[],
  classes: { input: string; select: string } = { input: 'form-input', select: 'form-select' }
): string {
  return drafts.map((draft, i) => {
    const match = matchExistingCourse(draft, existing);
    const { meets, weights, total } = describeCourseDraft(draft);
    const options = [`<option value="new"${match ? '' : ' selected'}>A new course</option>`]
      .concat(existing.map(c => `<option value="${esc(c.id)}"${match?.id === c.id ? ' selected' : ''}>${esc(c.courseName)}${c.courseCode ? ` (${esc(c.courseCode)})` : ''}</option>`))
      .join('');
    const found: string[] = [];
    found.push(meets.length
      ? `<li><strong>Class times:</strong> ${meets.map(esc).join('; ')}</li>`
      : '<li class="is-missing">No class times found. You can add them in the course editor after saving.</li>');
    found.push(draft.syllabus.length
      ? `<li><strong>Weights:</strong> ${esc(weights)}${Math.abs(total - 100) > 0.5 ? ` <span class="ci-warn">(adds up to ${total}%, check them)</span>` : ''}</li>`
      : '<li class="is-missing">No mark breakdown found.</li>');
    if (draft.instructor) found.push(`<li><strong>Instructor:</strong> ${esc(draft.instructor)}</li>`);
    if (match && (draft.scheduleSlots.length || draft.syllabus.length)) {
      found.push(`<li class="ci-note">Replaces the ${[draft.scheduleSlots.length ? 'class times' : '', draft.syllabus.length ? 'weights' : ''].filter(Boolean).join(' and ')} saved for ${esc(match.courseName)}. Its name and colour stay.</li>`);
    }
    return `<div class="ci-card" data-index="${i}">
      <label class="ci-keep-row"><input type="checkbox" class="ci-keep" checked> <span>${esc(draft.courseName || draft.courseCode || 'Course')}</span></label>
      <div class="ci-grid">
        <label class="ci-field"><span>Code</span><input type="text" class="${esc(classes.input)} ci-code" maxlength="20" value="${esc(draft.courseCode)}"></label>
        <label class="ci-field"><span>Credit hours</span><input type="number" class="${esc(classes.input)} ci-credits" min="0" max="6" step="0.5" value="${draft.creditHours ?? ''}"></label>
        <label class="ci-field ci-field-wide"><span>Name</span><input type="text" class="${esc(classes.input)} ci-name" maxlength="90" value="${esc(draft.courseName)}"></label>
        <label class="ci-field ci-field-wide"><span>Save into</span><select class="${esc(classes.select)} ci-target">${options}</select></label>
      </div>
      <ul class="ci-found">${found.join('')}</ul>
    </div>`;
  }).join('');
}

/** What the student kept, with their corrections. */
export function readCourseImportReview(root: ParentNode, drafts: CourseDraft[]): CourseImportPick[] {
  const picks: CourseImportPick[] = [];
  root.querySelectorAll<HTMLElement>('.ci-card').forEach(card => {
    const draft = drafts[Number(card.dataset.index)];
    if (!draft || !(card.querySelector('.ci-keep') as HTMLInputElement | null)?.checked) return;
    const value = (sel: string) => ((card.querySelector(sel) as HTMLInputElement | HTMLSelectElement | null)?.value || '').trim();
    const credits = parseFloat(value('.ci-credits'));
    picks.push({
      draft: {
        ...draft,
        courseCode: value('.ci-code').slice(0, 20),
        courseName: value('.ci-name').slice(0, 90),
        creditHours: credits > 0 && credits <= 6 ? credits : undefined
      },
      targetId: value('.ci-target') || 'new'
    });
  });
  return picks;
}
