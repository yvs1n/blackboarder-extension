/**
 * Lets only one scan run in a Blackboard tab at a time, without losing a button press.
 *
 * Quiet scans (page load, stream scrolling) run often. If the student presses Scan while one
 * is running, the running scan becomes a visible one, so the popup gets its progress and a
 * final status instead of waiting forever. A full re-scan asked for during a quick scan runs
 * right after it.
 */

export interface ScanRun {
  /** Show progress and a final status to the student. Can turn true while the scan runs. */
  interactive: boolean;
  fullRescan: boolean;
  /** Set once a final (done or error) status was written for this run. */
  reported: boolean;
}

export interface ScanGateHooks {
  /** Does the scan. Read `run.interactive` each time it matters, since it can change. */
  scan: (run: ScanRun) => Promise<void>;
  /** A quiet scan just became visible: show that it is running. */
  onBecameInteractive?: (run: ScanRun) => Promise<void> | void;
  /** A visible scan ended without writing a final status: write one. */
  onUnreported?: (run: ScanRun) => Promise<void> | void;
}

export class ScanGate {
  private active: { run: ScanRun; done: Promise<void> } | null = null;

  constructor(private hooks: ScanGateHooks) {}

  get running(): boolean {
    return this.active !== null;
  }

  async run(interactive: boolean = false, fullRescan: boolean = false): Promise<void> {
    const current = this.active;
    if (current) {
      if (!interactive) return current.done;
      if (fullRescan && !current.run.fullRescan) {
        await current.done.catch(() => {});
        return this.run(true, true);
      }
      if (!current.run.interactive) {
        current.run.interactive = true;
        await this.hooks.onBecameInteractive?.(current.run);
      }
      return current.done;
    }

    const run: ScanRun = { interactive, fullRescan, reported: false };
    const done = (async () => {
      try {
        await this.hooks.scan(run);
      } finally {
        this.active = null;
        if (run.interactive && !run.reported) {
          await this.hooks.onUnreported?.(run);
        }
      }
    })();
    this.active = { run, done };
    return done;
  }
}
