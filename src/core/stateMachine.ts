/**
 * Lightweight, zero-dependency finite state machine primitives shared across the
 * Chrome extension and the phone web app (`BBCore`).
 *
 * Turning implicit boolean/DOM/timer state into an explicit transition table makes
 * impossible states unrepresentable and prevents timer-race and stuck-UI bugs.
 */

export type TransitionTable<S extends string, E extends string> = {
  readonly [K in S]: Partial<Record<E, S>>;
};

export interface StateMachine<S extends string, E extends string> {
  /** Current state. */
  state(): S;
  /** Attempt a transition; returns true if the state changed (or stayed on an explicit self-edge). */
  send(event: E): boolean;
  /** Whether `event` is permitted from the current state. */
  can(event: E): boolean;
  /** True when the current state is one of `states`. */
  matches(...states: readonly S[]): boolean;
  /** Subscribe to state transitions; returns an unsubscribe function. */
  subscribe(listener: (next: S, prev: S, event: E) => void): () => void;
  /** Force-reset to the initial state (clearing no external side effects). */
  reset(): void;
}

export function createStateMachine<S extends string, E extends string>(config: {
  initial: S;
  transitions: TransitionTable<S, E>;
  onTransition?: (next: S, prev: S, event: E) => void;
}): StateMachine<S, E> {
  let current: S = config.initial;
  const listeners = new Set<(next: S, prev: S, event: E) => void>();

  return {
    state: () => current,
    can: (event: E) => Object.prototype.hasOwnProperty.call(config.transitions[current] || {}, event),
    matches: (...states: readonly S[]) => states.includes(current),
    send(event: E): boolean {
      const next = config.transitions[current]?.[event];
      if (!next) return false;
      const prev = current;
      current = next;
      config.onTransition?.(next, prev, event);
      listeners.forEach(fn => fn(next, prev, event));
      return true;
    },
    subscribe(listener: (next: S, prev: S, event: E) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      current = config.initial;
    }
  };
}

export type ArmedActionState = 'idle' | 'armed' | 'running';

export interface ArmedAction {
  state(): ArmedActionState;
  trigger(): Promise<void>;
  disarm(): void;
  destroy(): void;
}

/**
 * Two-step confirmation state machine (`idle -> armed -> running -> idle`) with a
 * self-clearing arming window so destructive buttons never get stuck or double-fire.
 */
export function createArmedAction(options: {
  timeoutMs?: number;
  idleLabel: string;
  armedLabel: string;
  runningLabel?: string;
  onStateChange: (state: ArmedActionState, label: string) => void;
  onExecute: () => Promise<void> | void;
}): ArmedAction {
  const timeoutMs = options.timeoutMs ?? 6000;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const labelFor = (s: ArmedActionState): string => {
    if (s === 'armed') return options.armedLabel;
    if (s === 'running') return options.runningLabel ?? options.idleLabel;
    return options.idleLabel;
  };

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const machine = createStateMachine<ArmedActionState, 'ARM' | 'TIMEOUT' | 'DISARM' | 'CONFIRM' | 'DONE'>({
    initial: 'idle',
    transitions: {
      idle: { ARM: 'armed' },
      armed: { CONFIRM: 'running', TIMEOUT: 'idle', DISARM: 'idle' },
      running: { DONE: 'idle' }
    },
    onTransition(next) {
      options.onStateChange(next, labelFor(next));
    }
  });

  return {
    state: () => machine.state(),
    disarm() {
      clearTimer();
      machine.send('DISARM');
    },
    destroy() {
      clearTimer();
      machine.reset();
    },
    async trigger() {
      const s = machine.state();
      if (s === 'running') return;
      if (s === 'idle') {
        if (machine.send('ARM')) {
          clearTimer();
          timer = setTimeout(() => {
            timer = null;
            machine.send('TIMEOUT');
          }, timeoutMs);
        }
        return;
      }
      if (s === 'armed') {
        clearTimer();
        if (!machine.send('CONFIRM')) return;
        try {
          await options.onExecute();
        } finally {
          machine.send('DONE');
        }
      }
    }
  };
}
