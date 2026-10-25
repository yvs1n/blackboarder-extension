/**
 * Filter bar on Blackboard's Activity page: show only some courses and some kinds of item.
 * Blackboard keeps drawing its own list; items that do not match are only hidden, and items
 * loaded later by scrolling are filtered as they arrive.
 */
import {
  ACTIVITY_CATEGORIES,
  type ActivityCategory,
  type ActivityFilterState,
  EMPTY_ACTIVITY_FILTER,
  activityItemMatches,
  classifyActivityItem,
  sanitizeActivityFilter
} from '../core/activityCategories';
import { courseIdFromHref } from '../core/blackboardColors';
import { findConfiguredCourseHex } from '../core/courseColors';
import { getBlackboardMemberships } from './courseColorPainter';

type GetJson = (path: string) => Promise<any>;

const STORAGE_KEY = 'bbs_activity_filter';
const BAR_ID = 'bbs-activity-filter';
const HIDDEN_CLASS = 'bbs-af-hidden';
const ITEM_SELECTOR = 'li.stream-item-container';
const COURSE_LINK = 'a[href*="/courses/_"], a[href*="courseId=_"], a[href*="course_id=_"]';
const UNIVERSITY_KEY = 'university';

interface ItemInfo {
  courseKey: string;
  category: ActivityCategory;
}

interface CourseChip {
  key: string;
  label: string;
  hex: string | null;
  /** A saved choice whose course has not appeared on the page yet */
  placeholder?: boolean;
}

export function isActivityPage(path = location.pathname): boolean {
  return /^\/ultra\/stream\/?$/.test(path);
}

/**
 * The course name without Blackboard's section and Arabic parts: "Physics 1- ALL - الفيزياء-1" and
 * "Physics 1- 02 - ..." are both "Physics 1". Only a dash next to a space splits, so
 * "Student Hands-On Orientation" stays whole.
 */
export function activityCourseLabel(blackboardName: string): string {
  return (blackboardName || '').split(/\s*-\s+|\s+-\s*/)[0].trim();
}

/** One chip per course name, so a course's lecture and "ALL" shells share a chip. */
export function courseKeyFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();
}

/** The element Blackboard scrolls the Activity list in (it loads more when this scrolls near the end). */
function streamScroller(stream: Element): HTMLElement | null {
  for (let el = stream.parentElement; el; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === 'auto' || oy === 'scroll') return el;
  }
  return document.scrollingElement as HTMLElement | null;
}

function iconTag(li: Element): string {
  for (const el of li.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    if (tag.startsWith('bb-ui-icon')) return tag;
  }
  return '';
}

export function startActivityFilter(getJson: GetJson): void {
  let filter: ActivityFilterState = { ...EMPTY_ACTIVITY_FILTER };
  let loaded = false;
  const chips = new Map<string, CourseChip>();
  const nameByCourseId = new Map<string, { name: string; code: string }>();
  let frame: number | null = null;
  // Asking Blackboard for more: a few tries per list length, since it ignores a nudge while still loading
  let askedCount = -1;
  let askTries = 0;
  let askTimer: ReturnType<typeof setTimeout> | null = null;
  let allLoaded = false;

  getBlackboardMemberships(getJson).then(list => {
    for (const m of list) nameByCourseId.set(m.courseId, { name: m.name, code: m.code });
    schedule();
  });

  const describe = (li: HTMLElement): ItemInfo => {
    const link = li.querySelector(COURSE_LINK);
    const courseId = link ? courseIdFromHref(link.getAttribute('href') || '') : null;
    let courseKey = UNIVERSITY_KEY;
    if (courseId) {
      const member = nameByCourseId.get(courseId);
      const rawName = member?.name || li.querySelector('a[analytics-id="stream.entry.course"]')?.textContent?.trim() || link?.textContent?.trim() || '';
      const label = activityCourseLabel(rawName);
      if (label) {
        courseKey = courseKeyFor(label);
        if (!chips.has(courseKey) || chips.get(courseKey)?.placeholder) {
          chips.set(courseKey, { key: courseKey, label, hex: findConfiguredCourseHex(rawName, member?.code || '') });
        }
      }
    }
    if (courseKey === UNIVERSITY_KEY && !chips.has(UNIVERSITY_KEY)) {
      chips.set(UNIVERSITY_KEY, { key: UNIVERSITY_KEY, label: 'University', hex: null });
    }
    const title = li.querySelector('a.js-title-link')?.textContent?.trim() || '';
    const text = li.querySelector('.content, .summary')?.textContent?.trim() || '';
    return { courseKey, category: classifyActivityItem({ icon: iconTag(li), title, text }) };
  };

  const save = () => {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: filter });
    } catch {
      // Extension context may be gone after an update
    }
  };

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter(v => v !== value) : [...list, value];

  const chipButton = (label: string, pressed: boolean, onClick: () => void, hex?: string | null): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bbs-af-chip';
    b.setAttribute('aria-pressed', String(pressed));
    if (hex) {
      const sw = document.createElement('span');
      sw.className = 'bbs-af-swatch';
      sw.style.backgroundColor = hex;
      b.appendChild(sw);
    }
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', onClick);
    return b;
  };

  const renderBar = (bar: HTMLElement, shown: number, total: number) => {
    const sig = JSON.stringify([filter, [...chips.values()].map(c => c.label), shown, total, allLoaded]);
    if (bar.dataset.sig === sig) return;
    bar.dataset.sig = sig;
    bar.textContent = '';

    const row = (title: string) => {
      const r = document.createElement('div');
      r.className = 'bbs-af-row';
      r.setAttribute('role', 'group');
      r.setAttribute('aria-label', title);
      const t = document.createElement('span');
      t.className = 'bbs-af-row-title';
      t.textContent = title;
      r.appendChild(t);
      bar.appendChild(r);
      return r;
    };

    const update = (next: ActivityFilterState) => {
      filter = next;
      save();
      schedule();
    };

    const courseRow = row('Course');
    courseRow.appendChild(chipButton('All', filter.courses.length === 0, () => update({ ...filter, courses: [] })));
    const sorted = [...chips.values()].sort((a, b) =>
      a.key === UNIVERSITY_KEY ? 1 : b.key === UNIVERSITY_KEY ? -1 : a.label.localeCompare(b.label)
    );
    for (const c of sorted) {
      courseRow.appendChild(
        chipButton(c.label, filter.courses.includes(c.key), () => update({ ...filter, courses: toggle(filter.courses, c.key) }), c.hex)
      );
    }

    const typeRow = row('Type');
    typeRow.appendChild(chipButton('All', filter.types.length === 0, () => update({ ...filter, types: [] })));
    for (const t of ACTIVITY_CATEGORIES) {
      typeRow.appendChild(
        chipButton(t.label, filter.types.includes(t.id), () =>
          update({ ...filter, types: toggle(filter.types, t.id) as ActivityCategory[] })
        )
      );
    }

    const status = document.createElement('div');
    status.className = 'bbs-af-status';
    status.setAttribute('aria-live', 'polite');
    const filtering = filter.courses.length > 0 || filter.types.length > 0;
    status.textContent = total === 0
      ? ''
      : !filtering
      ? `${total} items loaded`
      : shown === 0
        ? `No matches in the ${total} items ${allLoaded ? 'on Blackboard' : 'loaded so far'}.`
        : `Showing ${shown} of ${total} items ${allLoaded ? 'on Blackboard' : 'loaded so far'}.`;
    bar.appendChild(status);
  };

  const apply = () => {
    frame = null;
    const bar = document.getElementById(BAR_ID);
    if (!isActivityPage()) {
      bar?.remove();
      document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(el => el.classList.remove(HIDDEN_CLASS));
      return;
    }
    const stream = document.querySelector('.activity-stream');
    if (!stream || !loaded) return;

    let target = bar;
    if (!target || target.nextElementSibling !== stream) {
      target?.remove();
      target = document.createElement('div');
      target.id = BAR_ID;
      target.setAttribute('role', 'region');
      target.setAttribute('aria-label', 'Blackboarder activity filter');
      stream.parentElement?.insertBefore(target, stream);
    }

    const items = document.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
    let shown = 0;
    items.forEach(li => {
      const info = describe(li);
      const match = activityItemMatches(filter, info.courseKey, info.category);
      li.classList.toggle(HIDDEN_CLASS, !match);
      li.dataset.bbsAfType = info.category;
      if (match) shown++;
    });
    // A chosen course that is no longer on the page still counts, so its chip stays
    for (const key of filter.courses) {
      if (!chips.has(key)) chips.set(key, { key, label: key, hex: null, placeholder: true });
    }
    renderBar(target, shown, items.length);
    askForMore(stream, items.length);
  };

  /**
   * With most items hidden the list can be too short to scroll, and Blackboard only loads more when
   * its list scrolls near the end. While a filter is on and the end is on screen, ask for more with
   * Blackboard's own (screen reader) "load more items" button, or a scroll nudge if it is missing.
   * The button is disabled while loading and once everything is loaded, so a few tries tell them apart.
   */
  const askForMore = (stream: Element, count: number) => {
    const filtering = filter.courses.length > 0 || filter.types.length > 0;
    if (!filtering || askTimer) return;
    if (count !== askedCount) {
      askedCount = count;
      askTries = 0;
      allLoaded = false;
    }
    if (askTries >= 4) return;
    const scroller = streamScroller(stream);
    if (!scroller) return;
    const fromEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (fromEnd > 400) return;
    askTries++;
    askTimer = setTimeout(() => {
      const button = document.querySelector<HTMLButtonElement>('button.load-more-items');
      if (button && !button.disabled) button.click();
      else if (!button) (scroller === document.scrollingElement ? window : scroller).dispatchEvent(new Event('scroll'));
      // Look again once Blackboard has had time to add items (or to finish an earlier load)
      askTimer = setTimeout(() => {
        askTimer = null;
        const now = document.querySelector<HTMLButtonElement>('button.load-more-items');
        if (askTries >= 4 && now?.disabled) allLoaded = true;
        schedule();
      }, 1500);
    }, askTries === 1 ? 300 : 0);
  };

  function schedule(): void {
    if (frame === null) frame = requestAnimationFrame(apply);
  }

  try {
    chrome.storage.local.get(STORAGE_KEY, res => {
      filter = sanitizeActivityFilter(res?.[STORAGE_KEY]);
      loaded = true;
      schedule();
    });
  } catch {
    loaded = true;
  }

  new MutationObserver(muts => {
    // Ignore changes made by the bar itself
    if (muts.every(m => (m.target as Element).closest?.(`#${BAR_ID}`))) return;
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });

  schedule();
}
