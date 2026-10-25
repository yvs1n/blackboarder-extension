/**
 * Blackboard Ultra's own course colours.
 *
 * Every course membership has a `courseCardColorIndex` (from /learn/api/v1/users/me/memberships).
 * Ultra turns it into a class `course-color-N`, N = index % 10 + 1, and uses that class on Activity
 * stream items, calendar events and the course page. The colours below are what Ultra draws for
 * N = 1..10 (read from the live site on 2026-10-25).
 */
export const BLACKBOARD_COURSE_PALETTE = [
  '#c473d4',
  '#2fd9fc',
  '#ffe12b',
  '#ff6417',
  '#89f3db',
  '#fe5b91',
  '#85f472',
  '#22c7cc',
  '#ca22ad',
  '#157afb'
];

/** The `course-color-N` slot (1..10) for a membership's colour index, or null. */
export function blackboardColorSlot(index: unknown): number | null {
  const n = typeof index === 'number' ? index : typeof index === 'string' && /^\d+$/.test(index) ? Number(index) : NaN;
  if (!Number.isInteger(n) || n < 0) return null;
  return (n % BLACKBOARD_COURSE_PALETTE.length) + 1;
}

/** Blackboard's colour for a membership's colour index, or null. */
export function blackboardCourseHex(index: unknown): string | null {
  const slot = blackboardColorSlot(index);
  return slot ? BLACKBOARD_COURSE_PALETTE[slot - 1] : null;
}

/** The slot from an element's class list ("element-details course-color-10" gives 10). */
export function colorSlotFromClass(className: string): number | null {
  const m = String(className || '').match(/(?:^|\s)course-color-(\d{1,2})(?:\s|$)/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= BLACKBOARD_COURSE_PALETTE.length ? n : null;
}

/** A Blackboard course id ("_86929_1") from a link. */
export function courseIdFromHref(href: string): string | null {
  const m = String(href || '').match(/(?:\/courses\/|[?&]course_?[iI]d=)(_\d+_\d+)/);
  return m ? m[1] : null;
}

export interface BlackboardMembership {
  courseId: string;     // internal id, "_86929_1"
  name: string;         // "Calculus I for Engineering- 02 - ..."
  code: string;         // 7-digit catalogue code from the external id, or ''
  slot: number | null;  // course-color-N
  hex: string | null;   // Blackboard's colour
}

/** Reads the memberships API response into the fields the colour features use. */
export function parseMemberships(json: any): BlackboardMembership[] {
  const out: BlackboardMembership[] = [];
  const results = Array.isArray(json?.results) ? json.results : [];
  for (const m of results) {
    const courseId = typeof m?.courseId === 'string' ? m.courseId : typeof m?.course?.id === 'string' ? m.course.id : '';
    if (!/^_\d+_\d+$/.test(courseId)) continue;
    const name = typeof m?.course?.name === 'string' ? m.course.name.trim() : '';
    const external = typeof m?.course?.courseId === 'string' ? m.course.courseId : '';
    const code = (external.match(/^(\d{7})(?:_|$)/) || [])[1] || '';
    out.push({
      courseId,
      name,
      code,
      slot: blackboardColorSlot(m?.courseCardColorIndex),
      hex: blackboardCourseHex(m?.courseCardColorIndex)
    });
  }
  return out;
}

/**
 * Which colour each `course-color-N` slot should be painted. A slot is only listed when every
 * course that uses it resolves to the same colour, so two courses that share a Blackboard colour
 * are never painted with the wrong one when the page gives no other clue (calendar events).
 */
export function slotColorMap(memberships: BlackboardMembership[], hexFor: (m: BlackboardMembership) => string | null): Map<number, string> {
  const seen = new Map<number, string | null>();
  for (const m of memberships) {
    if (!m.slot) continue;
    const hex = hexFor(m);
    if (!seen.has(m.slot)) seen.set(m.slot, hex);
    else if (seen.get(m.slot) !== hex) seen.set(m.slot, null);
  }
  const out = new Map<number, string>();
  for (const [slot, hex] of seen) if (hex) out.set(slot, hex);
  return out;
}

/** True for a clearly coloured (not grey, not transparent) computed colour such as "rgb(21, 122, 251)". */
export function isVividColor(value: string): boolean {
  const m = String(value || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
  if (!m) return false;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  if (a < 0.5) return false;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return Math.max(r, g, b) - Math.min(r, g, b) >= 60;
}
