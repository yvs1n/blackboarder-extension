/**
 * Paints Blackboard's course colours (Activity stream bars, calendar events) with the colour the
 * student set for each course in Blackboarder, so a course looks the same everywhere and keeps its
 * colour when new announcements arrive. Courses the student has not set up keep Blackboard's colour.
 */
import {
  type BlackboardMembership,
  colorSlotFromClass,
  courseIdFromHref,
  isVividColor,
  parseMemberships,
  slotColorMap
} from '../core/blackboardColors';
import { findConfiguredCourseHex } from '../core/courseColors';
import { parseCourseDetails } from '../core/courseHelper';

type GetJson = (path: string) => Promise<any>;

const COLOR_PROPS = [
  'border-left-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'background-color',
  'color',
  'outline-color'
] as const;

const COURSE_LINK = 'a[href*="/courses/_"], a[href*="courseId=_"], a[href*="course_id=_"]';

let membershipsPromise: Promise<BlackboardMembership[]> | null = null;

/** The student's Blackboard courses with their colour slots; read once per page. */
export function getBlackboardMemberships(getJson: GetJson): Promise<BlackboardMembership[]> {
  if (!membershipsPromise) {
    membershipsPromise = getJson('/learn/api/v1/users/me/memberships?expand=course&limit=200')
      .then(json => parseMemberships(json))
      .catch(() => {
        membershipsPromise = null;
        return [];
      });
  }
  return membershipsPromise;
}

/** Courses for auto-registration, each with Blackboard's colour. */
export async function discoveredCoursesWithColors(getJson: GetJson): Promise<{ courseName: string; courseCode: string; colorHex?: string }[]> {
  const out: { courseName: string; courseCode: string; colorHex?: string }[] = [];
  for (const m of await getBlackboardMemberships(getJson)) {
    if (!m.code) continue;
    const { name } = parseCourseDetails(m.name);
    if (!name || name === 'General Course') continue;
    out.push({ courseName: name, courseCode: m.code, colorHex: m.hex || undefined });
  }
  return out;
}

function hexForMembership(m: BlackboardMembership): string | null {
  return findConfiguredCourseHex(m.name, m.code);
}

/**
 * The part of the page that belongs to this one coloured item: the element itself, its list item,
 * or its parent when that parent holds no other course item (so a link of a neighbouring course is
 * never taken).
 */
function itemScopes(el: Element): Element[] {
  const scopes: Element[] = [el];
  const item = el.closest('li, article, [role="listitem"], .stream-item');
  if (item && item !== el) scopes.push(item);
  const parent = el.parentElement;
  if (!item && parent && parent.querySelectorAll('[class*="course-color-"]').length === 1) scopes.push(parent);
  return scopes;
}

function courseIdForElement(el: Element): string | null {
  for (const scope of itemScopes(el)) {
    const link = scope.querySelector(COURSE_LINK);
    const id = link ? courseIdFromHref(link.getAttribute('href') || '') : null;
    if (id) return id;
  }
  const own = el.closest(COURSE_LINK);
  const ownId = own ? courseIdFromHref(own.getAttribute('href') || '') : null;
  if (ownId) return ownId;
  if (el.closest('section.course')) return courseIdFromHref(location.pathname);
  return null;
}

function courseNameNear(el: Element): string {
  for (const scope of itemScopes(el)) {
    const link = scope.querySelector('a[analytics-id="stream.entry.course"]') || scope.querySelector(COURSE_LINK);
    if (link?.textContent?.trim()) return link.textContent.trim();
  }
  return '';
}

function clearPaint(el: HTMLElement): void {
  const props = (el.dataset.bbsCcProps || '').split(',').filter(Boolean);
  for (const p of props) el.style.removeProperty(p);
  el.style.removeProperty('--bbs-cc');
  delete el.dataset.bbsCcProps;
  delete el.dataset.bbsCcBefore;
  delete el.dataset.bbsCcAfter;
}

/** Which colour properties of a computed style carry the course colour. */
function vividProps(cs: CSSStyleDeclaration): string[] {
  const props: string[] = [];
  for (const p of COLOR_PROPS) {
    if (p.startsWith('border-')) {
      const side = p.replace('-color', '');
      if (cs.getPropertyValue(`${side}-width`) === '0px' || cs.getPropertyValue(`${side}-style`) === 'none') continue;
    }
    if (isVividColor(cs.getPropertyValue(p))) props.push(p);
  }
  return props;
}

/** Short tokens for pseudo-element parts; content.css paints them from --bbs-cc. */
function pseudoTokens(el: Element, which: '::before' | '::after'): string {
  const cs = getComputedStyle(el, which);
  if (!cs.content || cs.content === 'none') return '';
  const tokens: string[] = [];
  for (const p of vividProps(cs)) {
    if (p === 'background-color') tokens.push('bg');
    else if (p === 'color') tokens.push('fg');
    else if (p.startsWith('border-')) tokens.push('border');
  }
  return [...new Set(tokens)].join(' ');
}

function paintElement(el: HTMLElement, hex: string | null, key: string): void {
  if (el.dataset.bbsCc === key) return;
  clearPaint(el);
  el.dataset.bbsCc = key;
  if (!hex) return;
  const props = vividProps(getComputedStyle(el));
  // Calendar week dots are drawn grey until hovered; they still belong to the course
  if (el.classList.contains('event-dot') && !props.includes('background-color')) props.push('background-color');
  for (const p of props) el.style.setProperty(p, hex, 'important');
  if (props.length) el.dataset.bbsCcProps = props.join(',');
  // Some pages draw the course bar with ::before (Grades tiles)
  const before = pseudoTokens(el, '::before');
  const after = pseudoTokens(el, '::after');
  if (before || after) el.style.setProperty('--bbs-cc', hex);
  if (before) el.dataset.bbsCcBefore = before;
  if (after) el.dataset.bbsCcAfter = after;
}

const COURSE_STYLE_ID = 'bbs-course-color-rules';

/** Inside a course: the banner tint and the selected course tab's underline take the course colour. */
export function courseChromeCss(hex: string | null): string {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return '';
  return [
    `[class*="emptyCourseBanner"] { background-color: ${hex}b3 !important; }`,
    `.bb-ui-navigation-list-horizontal li > a[aria-current="page"][class] { border-bottom-color: ${hex} !important; }`
  ].join('\n');
}

function setCourseChrome(css: string): void {
  let el = document.getElementById(COURSE_STYLE_ID);
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = COURSE_STYLE_ID;
    (document.head || document.documentElement).appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

/** Starts painting; repaints when Blackboard adds or changes items and when course colours change. */
export function startCourseColorPainter(getJson: GetJson): void {
  let memberships: BlackboardMembership[] = [];
  let byId = new Map<string, BlackboardMembership>();
  let bySlot = new Map<number, string>();
  let frame: number | null = null;

  const rebuild = () => {
    byId = new Map(memberships.map(m => [m.courseId, m]));
    bySlot = slotColorMap(memberships, hexForMembership);
  };

  const paintAll = () => {
    frame = null;
    const pageCourseId = /\/ultra\/courses\//.test(location.pathname) ? courseIdFromHref(location.pathname) : null;
    const pageCourse = pageCourseId ? byId.get(pageCourseId) : undefined;
    setCourseChrome(courseChromeCss(pageCourse ? hexForMembership(pageCourse) : null));
    document.querySelectorAll<HTMLElement>('[class*="course-color-"]').forEach(el => {
      const slot = colorSlotFromClass(typeof el.className === 'string' ? el.className : '');
      if (!slot) return;
      const courseId = courseIdForElement(el);
      const m = courseId ? byId.get(courseId) : undefined;
      let hex: string | null = null;
      if (m) hex = hexForMembership(m);
      else if (courseId) hex = findConfiguredCourseHex(courseNameNear(el));
      else hex = bySlot.get(slot) || null;
      paintElement(el, hex, `${slot}|${courseId || ''}|${hex || ''}`);
    });
  };

  const schedule = () => {
    if (frame === null) frame = requestAnimationFrame(paintAll);
  };

  getBlackboardMemberships(getJson).then(list => {
    memberships = list;
    rebuild();
    schedule();
  });

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes['bbs_user_courses']) {
        // The scraper's own listener updates the active course list first
        setTimeout(() => {
          rebuild();
          schedule();
        }, 0);
      }
    });
  } catch {
    // Extension context may be gone after an update
  }

  schedule();
}
