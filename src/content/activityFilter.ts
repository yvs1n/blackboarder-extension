/**
 * Filter bar and background preloader on Blackboard's Activity page: show only real courses and
 * item types, preload notifications and enrolled courses in the background on initial open so the
 * student does not have to scroll down manually, and dismiss the preloader once ready.
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
import { isBlackboardSystemNoise } from '../core/courseHelper';
import { getActiveUserCourses } from '../core/userCourses';
import { isOrientationOrSandboxCourse } from '../scan/blackboardApi';
import { getUserCourses } from '../utils/storage';
import { getBlackboardMemberships } from './courseColorPainter';

type GetJson = (path: string) => Promise<any>;

const STORAGE_KEY = 'bbs_activity_filter';
const BAR_ID = 'bbs-activity-filter';
export const PRELOADER_ID = 'bbs-activity-preloader';
const HIDDEN_CLASS = 'bbs-af-hidden';
const ITEM_SELECTOR = 'li.stream-item-container';
const COURSE_LINK = 'a[href*="/courses/_"], a[href*="courseId=_"], a[href*="course_id=_"]';
const NON_COURSE_KEY = '__non_course__';

const PRELOAD_TARGET_BATCHES = 3;
const PRELOAD_TARGET_ITEMS = 60;
const PRELOAD_BOOT_MAX_MS = 5500;
const PRELOAD_MAX_MS = 3200;
const PRELOAD_TICK_MS = 220;

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
  const clean = (blackboardName || '')
    .replace(/^(?:\d{4}\s*\d{3}|[A-Za-z]{2,6}\s*[-_]?\s*\d{3,5}[A-Za-z]?)(?:_[A-Za-z0-9_-]+)?\s*[-–:]\s+(?=[A-Za-z\u0600-\u06FF])/i, '')
    .trim();
  return clean.split(/\s*-\s+|\s+-\s*/)[0].trim();
}

/** One chip per course name, so a course's lecture and "ALL" shells share a chip. */
export function courseKeyFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();
}

/**
 * True for non-academic Blackboard entries such as "Student Hands-On Orientation", sandbox shells,
 * system navigation labels, and institution-wide "University" notices so they never appear as course chips.
 */
export function isExcludedActivityCourse(name: string, code: string = ''): boolean {
  const trimmed = (name || '').trim();
  if (!trimmed) return true;
  const key = courseKeyFor(trimmed);
  if (!key || key === 'university' || key === NON_COURSE_KEY) return true;
  if (isOrientationOrSandboxCourse(trimmed, code)) return true;
  if (isBlackboardSystemNoise(trimmed)) return true;
  return false;
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
  const nameByCourseId = new Map<string, { name: string; code: string; hex: string | null }>();
  let membershipsReady = false;
  let coursesReady = false;
  let frame: number | null = null;
  // Asking Blackboard for more: a few tries per list length, since it ignores a nudge while still loading
  let askedCount = -1;
  let askTries = 0;
  let askTimer: ReturnType<typeof setTimeout> | null = null;
  let allLoaded = false;

  // Unified preloader state covering both Blackboard's stream boot and our background batch preload
  let onActivityRoute = false;
  let routeEnteredAt = 0;
  let preloadedStream: Element | null = null;
  let preloading = false;
  let preloadStartedAt = 0;
  let preloadInitialCount = -1;
  let preloadLastCount = 0;
  let preloadBatches = 0;
  let preloadIdleTicks = 0;
  let preloadTimer: ReturnType<typeof setTimeout> | null = null;

  const upsertCourseChip = (rawName: string, code: string = '', fallbackHex: string | null = null) => {
    if (isExcludedActivityCourse(rawName, code)) return;
    const label = activityCourseLabel(rawName);
    if (!label || isExcludedActivityCourse(label, code)) return;
    const key = courseKeyFor(label);
    const hex = findConfiguredCourseHex(rawName, code) || findConfiguredCourseHex(label, code) || fallbackHex || null;
    const existing = chips.get(key);
    if (!existing || existing.placeholder || (!existing.hex && hex)) {
      chips.set(key, { key, label, hex });
    }
  };

  /** Seeds chips from the student's active courses and Blackboard memberships right away, before scrolling. */
  const syncCourseChipsFromSources = () => {
    for (const [k, c] of chips) {
      if (isExcludedActivityCourse(c.label) || isExcludedActivityCourse(k)) {
        chips.delete(k);
      }
    }
    const activeCourses = getActiveUserCourses();
    for (const c of activeCourses) {
      upsertCourseChip(c.courseName || '', c.courseCode || '', c.colorHex || null);
    }
    for (const m of nameByCourseId.values()) {
      if (isExcludedActivityCourse(m.name, m.code)) continue;
      const configuredHex = findConfiguredCourseHex(m.name, m.code);
      // When active courses exist, include every membership that matches an active course; when no
      // courses are set up yet, include all non-excluded Blackboard memberships.
      if (configuredHex || activeCourses.length === 0) {
        upsertCourseChip(m.name, m.code, configuredHex || m.hex);
      }
    }
  };

  if (getActiveUserCourses().length > 0) {
    coursesReady = true;
    syncCourseChipsFromSources();
  } else {
    getUserCourses()
      .catch(() => [])
      .finally(() => {
        coursesReady = true;
        syncCourseChipsFromSources();
        schedule();
      });
  }

  getBlackboardMemberships(getJson)
    .then(list => {
      for (const m of list) {
        nameByCourseId.set(m.courseId, { name: m.name, code: m.code, hex: m.hex });
      }
      membershipsReady = true;
      syncCourseChipsFromSources();
      schedule();
    })
    .catch(() => {
      membershipsReady = true;
      schedule();
    });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes['bbs_user_courses']) {
        setTimeout(() => {
          syncCourseChipsFromSources();
          schedule();
        }, 0);
      }
    });
  } catch {
    // Extension context may be gone after an update
  }

  const describe = (li: HTMLElement): ItemInfo => {
    const link = li.querySelector(COURSE_LINK);
    const courseId = link ? courseIdFromHref(link.getAttribute('href') || '') : null;
    let courseKey = NON_COURSE_KEY;
    if (courseId) {
      const member = nameByCourseId.get(courseId);
      const rawName = member?.name || li.querySelector('a[analytics-id="stream.entry.course"]')?.textContent?.trim() || link?.textContent?.trim() || '';
      const code = member?.code || '';
      const label = activityCourseLabel(rawName);
      if (label && !isExcludedActivityCourse(rawName, code) && !isExcludedActivityCourse(label, code)) {
        courseKey = courseKeyFor(label);
        upsertCourseChip(rawName, code, member?.hex || null);
      }
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

  const removePreloader = (stream?: Element | null) => {
    if (preloadTimer) {
      clearTimeout(preloadTimer);
      preloadTimer = null;
    }
    preloading = false;
    if (stream) {
      const scroller = streamScroller(stream);
      if (scroller && scroller.scrollTop > 0) {
        scroller.scrollTop = 0;
      }
    }
    const el = document.getElementById(PRELOADER_ID);
    if (el) el.remove();
  };

  const updatePreloaderUi = (itemCount: number, streamReady: boolean) => {
    if (!preloading || !isActivityPage()) {
      removePreloader();
      return;
    }
    let overlay = document.getElementById(PRELOADER_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = PRELOADER_ID;
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      overlay.setAttribute('aria-label', 'Loading Blackboard Activity stream');
      overlay.innerHTML = `
        <div class="bbs-af-preloader-card">
          <div class="bbs-af-preloader-header">
            <span class="bbs-af-preloader-brand">BLACKBOARDER · ACTIVITY STREAM</span>
            <button type="button" class="bbs-af-preloader-skip" id="bbs-af-preloader-skip-btn">Skip</button>
          </div>
          <div class="bbs-af-preloader-body">
            <div class="bbs-af-preloader-title">Loading Courses &amp; Notifications</div>
            <div class="bbs-af-preloader-sub">Preloading stream notifications in the background so all courses and filters are ready immediately.</div>
            <div class="bbs-af-preloader-track">
              <div class="bbs-af-preloader-fill" id="bbs-af-preloader-fill"></div>
            </div>
            <div class="bbs-af-preloader-meta" id="bbs-af-preloader-meta">Preparing courses...</div>
          </div>
        </div>
      `;
      (document.body || document.documentElement).appendChild(overlay);
    }

    if (overlay.dataset.bbsManaged !== '1') {
      overlay.dataset.bbsManaged = '1';
      overlay.querySelector('#bbs-af-preloader-skip-btn')?.addEventListener('click', () => {
        if (document.documentElement) {
          document.documentElement.dataset.bbsPreloaderSkipped = '1';
        }
        const stream = document.querySelector('.activity-stream');
        removePreloader(stream);
        schedule();
      });
    }

    const courseCount = [...chips.values()].filter(c => !c.placeholder).length;
    const bootRatio = Math.min(0.32, ((Date.now() - routeEnteredAt) / PRELOAD_BOOT_MAX_MS) * 0.32);
    const postMountElapsed = streamReady && preloadStartedAt > 0 ? Math.min(0.60, ((Date.now() - preloadStartedAt) / PRELOAD_MAX_MS) * 0.60) : 0;
    const batchRatio = Math.min(
      0.95,
      (membershipsReady ? 0.22 : 0.08) +
        (coursesReady ? 0.14 : 0.05) +
        (streamReady ? 0.14 : bootRatio) +
        Math.min(0.45, (preloadBatches / PRELOAD_TARGET_BATCHES) * 0.45)
    );
    const pct = Math.round(Math.max(16, Math.max(bootRatio + postMountElapsed, batchRatio) * 100));

    const fill = overlay.querySelector<HTMLElement>('#bbs-af-preloader-fill');
    if (fill) fill.style.width = `${pct}%`;

    const meta = overlay.querySelector<HTMLElement>('#bbs-af-preloader-meta');
    if (meta) {
      const coursePart = courseCount > 0 ? `${courseCount} course${courseCount === 1 ? '' : 's'}` : 'Loading courses';
      const itemPart = itemCount > 0
        ? `${itemCount} notification${itemCount === 1 ? '' : 's'} loaded`
        : streamReady
          ? 'Fetching stream items...'
          : 'Connecting to Blackboard stream...';
      meta.textContent = `${coursePart} · ${itemPart}`;
    }
  };

  /**
   * Covers both Blackboard's initial stream boot (when stream is still null) and background
   * notification batch preloading so only one unified Blackboarder preloader is shown.
   */
  const stepBackgroundPreload = (stream: Element | null) => {
    if (!preloading || !isActivityPage()) {
      removePreloader(stream);
      return;
    }

    if (!stream) {
      updatePreloaderUi(0, false);
      if (Date.now() - routeEnteredAt >= PRELOAD_BOOT_MAX_MS) {
        removePreloader();
        return;
      }
      if (!preloadTimer) {
        preloadTimer = setTimeout(() => {
          preloadTimer = null;
          stepBackgroundPreload(document.querySelector('.activity-stream'));
          schedule();
        }, PRELOAD_TICK_MS);
      }
      return;
    }

    const items = document.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
    const count = items.length;
    if (preloadInitialCount < 0 && count > 0) {
      preloadInitialCount = count;
      preloadLastCount = count;
    } else if (count > preloadLastCount) {
      preloadBatches++;
      preloadLastCount = count;
      preloadIdleTicks = 0;
    } else if (count > 0) {
      preloadIdleTicks++;
    }

    updatePreloaderUi(count, true);

    const elapsed = Date.now() - preloadStartedAt;
    const button = document.querySelector<HTMLButtonElement>('button.load-more-items');
    const noMoreToLoad = count > 0 && ((!button && preloadIdleTicks >= 2) || (Boolean(button?.disabled) && preloadIdleTicks >= 3));
    const reachedTarget = preloadBatches >= PRELOAD_TARGET_BATCHES || count >= PRELOAD_TARGET_ITEMS;

    if ((membershipsReady && coursesReady && (reachedTarget || noMoreToLoad)) || elapsed >= PRELOAD_MAX_MS) {
      if (noMoreToLoad) allLoaded = true;
      removePreloader(stream);
      schedule();
      return;
    }

    // Trigger Blackboard to load the next batch in the background
    if (button && !button.disabled) {
      button.click();
    } else {
      const scroller = streamScroller(stream);
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
        (scroller === document.scrollingElement ? window : scroller).dispatchEvent(new Event('scroll'));
      }
    }

    if (!preloadTimer) {
      preloadTimer = setTimeout(() => {
        preloadTimer = null;
        stepBackgroundPreload(document.querySelector('.activity-stream'));
        schedule();
      }, PRELOAD_TICK_MS);
    }
  };

  const renderBar = (bar: HTMLElement, shown: number, total: number) => {
    const sig = JSON.stringify([filter, [...chips.values()].map(c => `${c.key}:${c.label}:${c.hex || ''}`), shown, total, allLoaded]);
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
    const sorted = [...chips.values()]
      .filter(c => !isExcludedActivityCourse(c.label) && !isExcludedActivityCourse(c.key))
      .sort((a, b) => a.label.localeCompare(b.label));
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
      removePreloader();
      onActivityRoute = false;
      routeEnteredAt = 0;
      preloadedStream = null;
      if (document.documentElement) {
        delete document.documentElement.dataset.bbsPreloaderSkipped;
      }
      document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(el => el.classList.remove(HIDDEN_CLASS));
      return;
    }

    if (document.querySelector('input[type="password"]') || /(?:^|\/)login(?:\/|$)/i.test(location.pathname)) {
      removePreloader();
      return;
    }

    syncCourseChipsFromSources();

    const skipped = document.documentElement?.dataset.bbsPreloaderSkipped === '1';
    if (!onActivityRoute) {
      onActivityRoute = true;
      routeEnteredAt = Date.now();
      preloading = !skipped;
      preloadInitialCount = -1;
      preloadLastCount = 0;
      preloadBatches = 0;
      preloadIdleTicks = 0;
    }

    const stream = document.querySelector('.activity-stream');
    if (!stream || !loaded) {
      if (preloading && !skipped) {
        stepBackgroundPreload(null);
      }
      return;
    }

    if (preloadedStream !== stream) {
      preloadedStream = stream;
      preloading = !skipped;
      preloadStartedAt = Date.now();
      preloadInitialCount = -1;
      preloadLastCount = 0;
      preloadBatches = 0;
      preloadIdleTicks = 0;
    }

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
      if (!chips.has(key) && !isExcludedActivityCourse(key)) {
        chips.set(key, { key, label: key, hex: null, placeholder: true });
      }
    }
    renderBar(target, shown, items.length);
    if (preloading) {
      stepBackgroundPreload(stream);
    } else {
      askForMore(stream, items.length, shown);
    }
  };

  /**
   * With most items hidden the list can be too short to scroll, and Blackboard only loads more when
   * its list scrolls near the end. While a filter is on and either few matches are visible or the
   * end is on screen, ask for more with Blackboard's own (screen reader) "load more items" button,
   * or a scroll nudge if it is missing.
   */
  const askForMore = (stream: Element, count: number, shown: number) => {
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
    if (fromEnd > 400 && shown >= 12) return;
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
    // Ignore changes made by the bar or preloader itself
    if (muts.every(m => (m.target as Element).closest?.(`#${BAR_ID}, #${PRELOADER_ID}`))) return;
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });

  schedule();
}
