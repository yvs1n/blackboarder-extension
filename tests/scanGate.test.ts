import { describe, it, expect } from 'vitest';
import { ScanGate, ScanRun } from '../src/content/scanGate';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

describe('ScanGate', () => {
  it('turns a running quiet scan into a visible one when Scan is pressed', async () => {
    const gate = deferred();
    const finals: string[] = [];
    const runs: ScanRun[] = [];
    const scanGate = new ScanGate({
      scan: async run => {
        runs.push(run);
        await gate.promise;
        if (run.interactive) { run.reported = true; finals.push('done'); }
      },
      onBecameInteractive: () => { finals.push('running'); }
    });

    const quiet = scanGate.run(false);
    expect(scanGate.running).toBe(true);
    const pressed = scanGate.run(true);
    gate.resolve();
    await Promise.all([quiet, pressed]);

    expect(runs).toHaveLength(1);
    expect(finals).toEqual(['running', 'done']);
    expect(scanGate.running).toBe(false);
  });

  it('writes a final status when a visible scan ends without one', async () => {
    const unreported: ScanRun[] = [];
    const scanGate = new ScanGate({
      scan: async () => {},
      onUnreported: run => { unreported.push(run); }
    });
    await scanGate.run(true);
    expect(unreported).toHaveLength(1);
    await scanGate.run(false);
    expect(unreported).toHaveLength(1);
  });

  it('still writes a final status when the visible scan throws', async () => {
    let unreported = 0;
    const scanGate = new ScanGate({
      scan: async () => { throw new Error('boom'); },
      onUnreported: () => { unreported++; }
    });
    await expect(scanGate.run(true)).rejects.toThrow('boom');
    expect(unreported).toBe(1);
    expect(scanGate.running).toBe(false);
  });

  it('runs a full re-scan after a quick scan instead of dropping it', async () => {
    const gate = deferred();
    const runs: ScanRun[] = [];
    const scanGate = new ScanGate({
      scan: async run => {
        runs.push({ ...run });
        if (runs.length === 1) await gate.promise;
      }
    });
    const quick = scanGate.run(false);
    const full = scanGate.run(true, true);
    gate.resolve();
    await Promise.all([quick, full]);
    expect(runs.map(r => [r.interactive, r.fullRescan])).toEqual([[false, false], [true, true]]);
  });

  it('lets a second quiet request share the running scan', async () => {
    const gate = deferred();
    let count = 0;
    const scanGate = new ScanGate({ scan: async () => { count++; await gate.promise; } });
    const a = scanGate.run(false);
    const b = scanGate.run(false);
    gate.resolve();
    await Promise.all([a, b]);
    expect(count).toBe(1);
  });
});
