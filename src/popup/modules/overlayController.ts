/**
 * Explicit LIFO overlay stack and animation state controller for popup modals and
 * the calendar day drawer.
 *
 * Replaces ad-hoc `style.display` / `.hidden` toggles, multiple competing Escape
 * listeners (which previously closed nested modals together), and untracked
 * Day Drawer hide timers.
 */

import { createStateMachine } from '../../core/stateMachine';
import { dom } from './state';

export type PopupOverlayId =
  | 'day-expanded-drawer'
  | 'modal-edit-task'
  | 'modal-reading-sheet'
  | 'modal-room-picker'
  | 'modal-ai-extract'
  | 'modal-quick-links'
  | 'modal-course-editor'
  | 'modal-course-import'
  | 'modal-regen-key-confirm'
  | 'modal-walkthrough';

interface StackEntry {
  id: PopupOverlayId;
  returnFocusTo: HTMLElement | null;
}

const MODAL_DISMISS_ORDER: PopupOverlayId[] = [
  'modal-room-picker',
  'modal-edit-task',
  'modal-reading-sheet',
  'modal-course-import',
  'modal-course-editor',
  'modal-quick-links',
  'modal-ai-extract',
  'modal-regen-key-confirm',
  'modal-walkthrough',
  'day-expanded-drawer'
];

const overlayStack: StackEntry[] = [];
const closeHandlers = new Map<PopupOverlayId, () => void>();
let dayDrawerCloseTimer: ReturnType<typeof setTimeout> | null = null;
let keyboardBound = false;

export const dayDrawerMachine = createStateMachine<'closed' | 'open', 'OPEN' | 'CLOSE'>({
  initial: 'closed',
  transitions: {
    closed: { OPEN: 'open' },
    open: { CLOSE: 'closed', OPEN: 'open' }
  }
});

function clearDayDrawerTimer() {
  if (dayDrawerCloseTimer !== null) {
    clearTimeout(dayDrawerCloseTimer);
    dayDrawerCloseTimer = null;
  }
}

function pushStack(id: PopupOverlayId) {
  const existingIdx = overlayStack.findIndex(e => e.id === id);
  const previousFocus =
    existingIdx >= 0
      ? overlayStack[existingIdx].returnFocusTo
      : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  if (existingIdx >= 0) overlayStack.splice(existingIdx, 1);
  overlayStack.push({ id, returnFocusTo: previousFocus });
}

function popStack(id: PopupOverlayId, overlayEl?: HTMLElement | null) {
  const idx = overlayStack.findIndex(e => e.id === id);
  if (idx < 0) return;
  const [entry] = overlayStack.splice(idx, 1);
  const wasTop = idx === overlayStack.length;
  if (!wasTop || !entry.returnFocusTo || !document.contains(entry.returnFocusTo)) return;
  const active = document.activeElement;
  const focusWasInside = !overlayEl || !active || active === document.body || overlayEl.contains(active);
  if (focusWasInside) {
    try {
      entry.returnFocusTo.focus({ preventScroll: true });
    } catch {
      entry.returnFocusTo.focus();
    }
  }
}

function defaultCloseDomOverlay(id: PopupOverlayId) {
  if (id === 'day-expanded-drawer') {
    closeDayDrawerShell();
    return;
  }
  const el = document.getElementById(id);
  if (el) closeModalEl(id, el);
}

/** Register the module-owned closer for an overlay so Escape runs full cleanup (drafts, temp state). */
export function registerOverlayCloseHandler(id: PopupOverlayId, handler: () => void) {
  closeHandlers.set(id, handler);
}

export function isOverlayOpen(id: PopupOverlayId): boolean {
  if (id === 'day-expanded-drawer') {
    return dayDrawerMachine.matches('open');
  }
  if (overlayStack.some(e => e.id === id)) return true;
  const el = document.getElementById(id);
  if (!el) return false;
  return !el.classList.contains('hidden') && el.style.display !== 'none';
}

export function hasOpenOverlay(): boolean {
  return overlayStack.length > 0 || dayDrawerMachine.matches('open');
}

export function getOpenOverlayIds(): PopupOverlayId[] {
  return overlayStack.map(e => e.id);
}

export function openModalEl(id: PopupOverlayId, modalEl: HTMLElement | null | undefined) {
  if (!modalEl) return;
  pushStack(id);
  modalEl.style.display = 'flex';
  modalEl.classList.remove('hidden');
}

export function closeModalEl(id: PopupOverlayId, modalEl: HTMLElement | null | undefined) {
  if (!modalEl) return;
  modalEl.style.display = 'none';
  modalEl.classList.add('hidden');
  popStack(id, modalEl);
}

/** Opens the calendar Day Expanded Drawer, cancelling any pending hide animation timer. */
export function openDayDrawerShell() {
  const dayExpandedDrawer = dom.dayExpandedDrawer();
  const dayExpandedBackdrop = dom.dayExpandedBackdrop();
  if (!dayExpandedDrawer || !dayExpandedBackdrop) return;

  clearDayDrawerTimer();
  dayDrawerMachine.send('OPEN');
  pushStack('day-expanded-drawer');

  dayExpandedBackdrop.classList.remove('hidden');
  dayExpandedDrawer.classList.remove('hidden');
  requestAnimationFrame(() => {
    if (!dayDrawerMachine.matches('open')) return;
    dayExpandedBackdrop.classList.add('open');
    dayExpandedDrawer.classList.add('open');
  });
}

/** Closes the calendar Day Expanded Drawer with guarded transition completion after 220ms. */
export function closeDayDrawerShell() {
  const dayExpandedDrawer = dom.dayExpandedDrawer();
  const dayExpandedBackdrop = dom.dayExpandedBackdrop();
  if (!dayExpandedDrawer || !dayExpandedBackdrop) return;

  const changed = dayDrawerMachine.send('CLOSE');
  dayExpandedBackdrop.classList.remove('open');
  dayExpandedDrawer.classList.remove('open');
  popStack('day-expanded-drawer', dayExpandedDrawer);

  if (!changed && dayExpandedDrawer.classList.contains('hidden')) return;
  clearDayDrawerTimer();
  dayDrawerCloseTimer = setTimeout(() => {
    dayDrawerCloseTimer = null;
    if (!dayDrawerMachine.matches('closed')) return;
    dayExpandedBackdrop.classList.add('hidden');
    dayExpandedDrawer.classList.add('hidden');
  }, 220);
}

/** Dismisses only the topmost open overlay in strict LIFO order. Returns true if one closed. */
export function closeTopOverlay(): boolean {
  let targetId: PopupOverlayId | undefined;
  while (overlayStack.length > 0) {
    const candidate = overlayStack[overlayStack.length - 1].id;
    const el = document.getElementById(candidate);
    const visible =
      candidate === 'day-expanded-drawer'
        ? dayDrawerMachine.matches('open') || (!!el && !el.classList.contains('hidden'))
        : !!el && el.style.display !== 'none' && !el.classList.contains('hidden');
    if (visible) {
      targetId = candidate;
      break;
    }
    overlayStack.pop();
  }

  if (!targetId) {
    targetId = MODAL_DISMISS_ORDER.find(id => {
      const el = document.getElementById(id);
      if (!el) return false;
      if (id === 'day-expanded-drawer') {
        return dayDrawerMachine.matches('open') || (dayDrawerCloseTimer === null && !el.classList.contains('hidden'));
      }
      return !el.classList.contains('hidden') && el.style.display !== 'none';
    });
  }

  if (!targetId) return false;
  const handler = closeHandlers.get(targetId);
  if (handler) handler();
  else defaultCloseDomOverlay(targetId);
  return true;
}

function onGlobalKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  if (closeTopOverlay()) {
    e.preventDefault();
  }
}

export function initOverlayKeyboardHandler() {
  if (keyboardBound) return;
  keyboardBound = true;
  window.addEventListener('keydown', onGlobalKeyDown);
}

/** Resets in-memory overlay stack and timers (for isolated unit tests). */
export function resetOverlayController() {
  clearDayDrawerTimer();
  overlayStack.length = 0;
  closeHandlers.clear();
  dayDrawerMachine.reset();
  if (keyboardBound) {
    window.removeEventListener('keydown', onGlobalKeyDown);
    keyboardBound = false;
  }
}
