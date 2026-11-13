// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStateMachine, createArmedAction, type ArmedActionState } from '../src/core/stateMachine';
import {
  dayDrawerMachine,
  openDayDrawerShell,
  closeDayDrawerShell,
  openModalEl,
  closeModalEl,
  closeTopOverlay,
  registerOverlayCloseHandler,
  initOverlayKeyboardHandler,
  getOpenOverlayIds,
  isOverlayOpen,
  resetOverlayController,
} from '../src/popup/modules/overlayController';
import {
  scanUiMachine,
  isScanUiActive,
  scanActiveTab,
  stopActiveScan,
  resetScanBannerState,
} from '../src/popup/modules/scanBanner';
import { setScanStatus } from '../src/utils/storage';

vi.mock('../src/utils/storage', async () => {
  const actual = await vi.importActual<typeof import('../src/utils/storage')>('../src/utils/storage');
  return {
    ...actual,
    getScanStatus: vi.fn(async () => null),
    setScanStatus: vi.fn(async () => undefined),
  };
});

describe('Explicit State Machine Primitives', () => {
  it('enforces transition table and notifies subscribers only on valid edges', () => {
    const transitions: string[] = [];
    const m = createStateMachine<'idle' | 'loading' | 'done', 'FETCH' | 'RESOLVE' | 'RESET'>({
      initial: 'idle',
      transitions: {
        idle: { FETCH: 'loading' },
        loading: { RESOLVE: 'done', RESET: 'idle' },
        done: { RESET: 'idle' },
      },
      onTransition: (next, prev, event) => transitions.push(`${prev}->${next}(${event})`),
    });

    const subCalls: string[] = [];
    const unsub = m.subscribe((next, prev) => subCalls.push(`${prev}->${next}`));

    expect(m.state()).toBe('idle');
    expect(m.can('FETCH')).toBe(true);
    expect(m.can('RESOLVE')).toBe(false);
    expect(m.send('RESOLVE')).toBe(false);
    expect(m.state()).toBe('idle');
    expect(transitions).toEqual([]);

    expect(m.send('FETCH')).toBe(true);
    expect(m.matches('loading')).toBe(true);
    expect(m.send('RESOLVE')).toBe(true);
    expect(m.state()).toBe('done');
    expect(transitions).toEqual(['idle->loading(FETCH)', 'loading->done(RESOLVE)']);
    expect(subCalls).toEqual(['idle->loading', 'loading->done']);

    unsub();
    expect(m.send('RESET')).toBe(true);
    expect(subCalls).toEqual(['idle->loading', 'loading->done']);
  });
});

describe('createArmedAction Two-Step Confirmation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms, auto-disarms on timeout, and runs once when confirmed before expiry', async () => {
    const states: ArmedActionState[] = [];
    let label = 'Delete';
    const onExecute = vi.fn(async () => {
      await Promise.resolve();
    });

    const action = createArmedAction({
      timeoutMs: 5000,
      idleLabel: 'Delete',
      armedLabel: 'Confirm?',
      runningLabel: 'Deleting...',
      onStateChange: (s, nextLabel) => {
        states.push(s);
        label = nextLabel;
      },
      onExecute,
    });

    await action.trigger();
    expect(action.state()).toBe('armed');
    expect(label).toBe('Confirm?');

    vi.advanceTimersByTime(5000);
    expect(action.state()).toBe('idle');
    expect(label).toBe('Delete');
    expect(onExecute).not.toHaveBeenCalled();

    await action.trigger();
    expect(action.state()).toBe('armed');

    let resolveExec!: () => void;
    onExecute.mockImplementationOnce(
      () => new Promise<void>(r => {
        resolveExec = r;
      })
    );

    const runPromise = action.trigger();
    expect(action.state()).toBe('running');
    expect(label).toBe('Deleting...');

    // Double-click while running must be ignored
    await action.trigger();
    expect(onExecute).toHaveBeenCalledTimes(1);

    resolveExec();
    await runPromise;
    expect(action.state()).toBe('idle');
    expect(label).toBe('Delete');
    expect(states).toEqual(['armed', 'idle', 'armed', 'running', 'idle']);
  });

  it('returns to idle in finally even if onExecute throws', async () => {
    const action = createArmedAction({
      idleLabel: 'Delete',
      armedLabel: 'Confirm?',
      onStateChange: () => {},
      onExecute: async () => {
        throw new Error('network boom');
      },
    });

    await action.trigger();
    await expect(action.trigger()).rejects.toThrow('network boom');
    expect(action.state()).toBe('idle');
  });
});

describe('Popup Overlay Stack & Day Drawer Timer Race Protection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetOverlayController();
    document.body.innerHTML = `
      <button id="opener-btn">Open Day</button>
      <div id="day-expanded-backdrop" class="hidden"></div>
      <div id="day-expanded-drawer" class="hidden"></div>
      <div id="modal-reading-sheet" class="modal-backdrop hidden" style="display: none;">
        <button id="sheet-room-btn">Room</button>
      </div>
      <div id="modal-room-picker" class="modal-backdrop hidden" style="display: none;">
        <input id="room-input" />
      </div>
    `;
  });

  afterEach(() => {
    resetOverlayController();
    vi.useRealTimers();
  });

  it('prevents the 220ms close timer from hiding a rapidly reopened Day Drawer', () => {
    const drawer = document.getElementById('day-expanded-drawer')!;
    const backdrop = document.getElementById('day-expanded-backdrop')!;

    openDayDrawerShell();
    expect(dayDrawerMachine.state()).toBe('open');
    expect(drawer.classList.contains('hidden')).toBe(false);

    closeDayDrawerShell();
    expect(dayDrawerMachine.state()).toBe('closed');
    expect(drawer.classList.contains('hidden')).toBe(false);

    // Reopen 100ms later (before the 220ms hide timeout fires)
    vi.advanceTimersByTime(100);
    openDayDrawerShell();
    expect(dayDrawerMachine.state()).toBe('open');

    // Advance well past 220ms — stale close timer must not hide the reopened drawer
    vi.advanceTimersByTime(300);
    expect(drawer.classList.contains('hidden')).toBe(false);
    expect(backdrop.classList.contains('hidden')).toBe(false);
    expect(isOverlayOpen('day-expanded-drawer')).toBe(true);
  });

  it('dismisses nested overlays in strict LIFO order on Escape and restores focus', () => {
    initOverlayKeyboardHandler();
    const openerBtn = document.getElementById('opener-btn')!;
    const sheet = document.getElementById('modal-reading-sheet')!;
    const roomBtn = document.getElementById('sheet-room-btn')!;
    const roomPicker = document.getElementById('modal-room-picker')!;
    const roomInput = document.getElementById('room-input')!;

    const closedOrder: string[] = [];
    registerOverlayCloseHandler('day-expanded-drawer', () => {
      closedOrder.push('drawer');
      closeDayDrawerShell();
    });
    registerOverlayCloseHandler('modal-reading-sheet', () => {
      closedOrder.push('sheet');
      closeModalEl('modal-reading-sheet', sheet);
    });
    registerOverlayCloseHandler('modal-room-picker', () => {
      closedOrder.push('room-picker');
      closeModalEl('modal-room-picker', roomPicker);
    });

    openerBtn.focus();
    openDayDrawerShell();
    openModalEl('modal-reading-sheet', sheet);
    roomBtn.focus();
    openModalEl('modal-room-picker', roomPicker);
    roomInput.focus();

    expect(getOpenOverlayIds()).toEqual(['day-expanded-drawer', 'modal-reading-sheet', 'modal-room-picker']);

    // 1st Escape closes ONLY Room Picker and restores focus to the Reading Sheet button
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closedOrder).toEqual(['room-picker']);
    expect(roomPicker.style.display).toBe('none');
    expect(sheet.style.display).toBe('flex');
    expect(document.activeElement).toBe(roomBtn);

    // 2nd Escape closes ONLY Reading Sheet
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closedOrder).toEqual(['room-picker', 'sheet']);
    expect(sheet.style.display).toBe('none');
    expect(dayDrawerMachine.state()).toBe('open');

    // 3rd Escape closes Day Drawer and restores focus to opener
    expect(closeTopOverlay()).toBe(true);
    expect(closedOrder).toEqual(['room-picker', 'sheet', 'drawer']);
    expect(document.activeElement).toBe(openerBtn);
    expect(closeTopOverlay()).toBe(false);
  });
});

describe('Scan Banner State Machine & Orphaned Timer Protection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <button id="btn-scan-tab">Scan</button>
      <div id="header-scan-banner" class="header-scan-banner">
        <span class="hsb-spinner"></span>
        <svg id="hsb-icon"></svg>
        <span id="hsb-text"></span>
        <button id="hsb-close"></button>
      </div>
    `;
    resetScanBannerState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetScanBannerState();
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('prevents an orphaned failure reset timer from clobbering a restarted scan', async () => {
    const refreshBg = vi.fn(async () => {});
    const btnScanTab = document.getElementById('btn-scan-tab') as HTMLButtonElement;

    // 1st scan fails immediately (no chrome.runtime.sendMessage), scheduling a 3500ms reset
    delete (globalThis as { chrome?: unknown }).chrome;
    await scanActiveTab(false, refreshBg);
    expect(scanUiMachine.state()).toBe('failed');
    expect(btnScanTab.disabled).toBe(false);
    expect(isScanUiActive()).toBe(false);

    // User retries at 2000ms with a live runtime responder that stays pending
    vi.advanceTimersByTime(2000);
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        lastError: null,
        sendMessage: vi.fn(() => {
          // Deliberately keep scan in flight
        }),
      },
      tabs: {
        query: vi.fn(async () => []),
      },
    };

    const secondScanPromise = scanActiveTab(false, refreshBg);
    expect(scanUiMachine.state()).toBe('scanning');
    expect(isScanUiActive()).toBe(true);
    expect(btnScanTab.disabled).toBe(true);

    // Advance 2000ms more (past the 1st scan's 3500ms mark): 2nd scan must stay active!
    vi.advanceTimersByTime(2000);
    await secondScanPromise;
    expect(scanUiMachine.state()).toBe('scanning');
    expect(isScanUiActive()).toBe(true);
    expect(btnScanTab.disabled).toBe(true);

    // Cancelling resets cleanly to idle and notifies status store
    stopActiveScan();
    expect(scanUiMachine.state()).toBe('idle');
    expect(isScanUiActive()).toBe(false);
    expect(btnScanTab.disabled).toBe(false);
    expect(setScanStatus).toHaveBeenCalledWith({
      state: 'done',
      message: 'Scan cancelled.',
      newCount: 0,
    });
  });
});
