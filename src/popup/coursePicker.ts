import type { UserCourseConfig } from '../types';

/** The courses that fit what has been typed, best first: name starts with it, then a word does, then it appears anywhere (name, code or keyword). */
export function filterCourses(courses: UserCourseConfig[], query: string): UserCourseConfig[] {
  const q = query.trim().toLowerCase();
  if (!q) return courses.slice();
  const digits = q.replace(/\s+/g, '');
  const scored: { c: UserCourseConfig; rank: number; i: number }[] = [];
  courses.forEach((c, i) => {
    const name = (c.courseName || '').toLowerCase();
    const code = (c.courseCode || '').toLowerCase().replace(/\s+/g, '');
    const aliases = (c.aliases || []).map(a => a.toLowerCase());
    let rank = -1;
    if (name.startsWith(q)) rank = 0;
    else if (name.split(/[^a-z0-9؀-ۿ]+/).some(w => w.startsWith(q))) rank = 1;
    else if (code && code.startsWith(digits)) rank = 1;
    else if (name.includes(q) || (code && code.includes(digits)) || aliases.some(a => a.includes(q))) rank = 2;
    if (rank >= 0) scored.push({ c, rank, i });
  });
  return scored.sort((a, b) => a.rank - b.rank || a.i - b.i).map(s => s.c);
}

/** The course whose name (or code) is exactly what the field holds, if any. */
export function findPickedCourse(courses: UserCourseConfig[], value: string): UserCourseConfig | undefined {
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  return courses.find(c => (c.courseName || '').trim().toLowerCase() === v) ||
    courses.find(c => (c.courseCode || '').replace(/\s+/g, '').toLowerCase() === v.replace(/\s+/g, ''));
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

/**
 * Turns a text field into a course picker: a list of the extension's courses opens under it,
 * narrows as you type, and arrow keys / Enter / a click pick one. Typing a course that is not in
 * the list is still allowed.
 */
export function attachCoursePicker(input: HTMLInputElement, getCourses: () => UserCourseConfig[], onPick?: () => void): void {
  if (input.dataset.coursePicker) return;
  input.dataset.coursePicker = '1';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  const wrap = document.createElement('div');
  wrap.className = 'course-picker';
  input.parentElement!.insertBefore(wrap, input);
  wrap.appendChild(input);
  const list = document.createElement('ul');
  list.className = 'course-picker-list';
  list.id = `${input.id}-options`;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.appendChild(list);
  input.setAttribute('aria-controls', list.id);

  let shown: UserCourseConfig[] = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const highlight = (i: number) => {
    active = i;
    list.querySelectorAll('li').forEach((li, j) => li.classList.toggle('active', j === i));
    const li = list.children[i] as HTMLElement | undefined;
    if (li) {
      input.setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    }
  };

  const pick = (c: UserCourseConfig) => {
    input.value = c.courseName;
    close();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    close();
    onPick?.();
  };

  const open = () => {
    shown = filterCourses(getCourses(), input.value);
    // Nothing to suggest, or the field already holds exactly the one match
    if (!shown.length || (shown.length === 1 && shown[0].courseName.toLowerCase() === input.value.trim().toLowerCase())) {
      close();
      return;
    }
    list.innerHTML = shown.map((c, i) => `
      <li role="option" id="${list.id}-${i}" data-i="${i}">
        <span class="course-picker-dot" style="background:${esc(c.colorHex || '#888')}"></span>
        <span class="course-picker-name">${esc(c.courseName)}</span>
        ${c.courseCode ? `<span class="course-picker-code">${esc(c.courseCode)}</span>` : ''}
      </li>`).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(input.value.trim() ? 0 : -1);
  };

  input.addEventListener('focus', open);
  input.addEventListener('input', () => { if (document.activeElement === input) open(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', e => {
    if (list.hidden) {
      if (e.key === 'ArrowDown') { open(); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') { highlight(Math.min(shown.length - 1, active + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { highlight(Math.max(0, active - 1)); e.preventDefault(); }
    else if (e.key === 'Enter' && active >= 0) { pick(shown[active]); e.preventDefault(); }
    else if (e.key === 'Escape') { close(); e.preventDefault(); e.stopPropagation(); }
  });
  // mousedown so the pick happens before the field loses focus
  list.addEventListener('mousedown', e => {
    const li = (e.target as HTMLElement).closest('li');
    if (!li) return;
    e.preventDefault();
    pick(shown[Number(li.dataset.i)]);
  });
}
