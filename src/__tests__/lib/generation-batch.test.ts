import { describe, expect, it } from 'vitest';
import {
  buildGenerationBatch,
  canTransitionGenerationStatus,
  isTerminalGenerationStatus,
} from '@/lib/generation-batch';

describe('generation batch slots', () => {
  it('creates one stable slot per requested output', () => {
    const batch = buildGenerationBatch('batch-a', 3);

    expect(batch.slots).toEqual([
      { slotId: 'batch-a:0', index: 0, status: 'created' },
      { slotId: 'batch-a:1', index: 1, status: 'created' },
      { slotId: 'batch-a:2', index: 2, status: 'created' },
    ]);
  });

  it('treats completed, failed, cancelled, and timeout as terminal', () => {
    expect(isTerminalGenerationStatus('completed')).toBe(true);
    expect(isTerminalGenerationStatus('failed')).toBe(true);
    expect(isTerminalGenerationStatus('cancelled')).toBe(true);
    expect(isTerminalGenerationStatus('timeout')).toBe(true);
    expect(isTerminalGenerationStatus('processing')).toBe(false);
  });

  it('rejects terminal-state rewrites', () => {
    expect(canTransitionGenerationStatus('processing', 'completed')).toBe(true);
    expect(canTransitionGenerationStatus('completed', 'processing')).toBe(false);
    expect(canTransitionGenerationStatus('failed', 'completed')).toBe(false);
  });
});
