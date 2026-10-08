import { describe, expect, it } from 'vitest';
import { finalizeStage4SelectionDiagnostic } from '../../../tests/helpers/stage-4-selection-diagnostics';

describe('Stage 4 selection diagnostic failure isolation', () => {
  it('collects before disposing the browser handle', async () => {
    const order: string[] = [];
    const failures = await finalizeStage4SelectionDiagnostic({
      collect: async (): Promise<void> => { order.push('collect'); },
      dispose: async (): Promise<void> => { order.push('dispose'); },
    });
    expect(order).toEqual(['collect', 'dispose']);
    expect(failures).toEqual([]);
  });

  it.each(['collect', 'dispose'] as const)('preserves the original click failure when %s fails', async phase => {
    const originalFailure = new Error('original action rejected');
    let disposed = false;
    const runOriginalAction = async (): Promise<void> => {
      try { throw originalFailure; }
      finally {
        await finalizeStage4SelectionDiagnostic({
          collect: async (): Promise<void> => { if (phase === 'collect') throw new Error('diagnostic failed'); },
          dispose: async (): Promise<void> => { disposed = true; if (phase === 'dispose') throw new Error('cleanup failed'); },
        });
      }
    };
    await expect(runOriginalAction()).rejects.toBe(originalFailure);
    expect(disposed).toBe(true);
  });

  it('allows the original post-click assertion to run when collection fails', async () => {
    const order: string[] = [];
    const runOriginalAction = async (): Promise<void> => {
      try { order.push('click'); }
      finally {
        await finalizeStage4SelectionDiagnostic({
          collect: async (): Promise<void> => { throw new Error('attachment failed'); },
          dispose: async (): Promise<void> => { order.push('dispose'); },
        });
      }
      order.push('original assertion');
    };
    await expect(runOriginalAction()).resolves.toBeUndefined();
    expect(order).toEqual(['click', 'dispose', 'original assertion']);
  });

  it('returns only fixed failure phases, not diagnostic exception content', async () => {
    const failures = await finalizeStage4SelectionDiagnostic({
      collect: async (): Promise<void> => { throw new Error('never log raw diagnostic data'); },
      dispose: async (): Promise<void> => { throw new Error('never log raw cleanup data'); },
    });
    expect(failures).toEqual(['collect', 'dispose']);
  });
});
