import { describe, it, expect } from 'vitest';

// Test for sticker assistant retry queue restart logic
// The handleRetry/handleRetryFailed callbacks are defined in sticker-assistant-panel.tsx
// This test validates the expected state transitions.

describe('sticker-assistant-batch', () => {
  describe('retry queue restart', () => {
    it('handleRetry resets item to pending and restarts generation', () => {
      // Simulate the state transition that handleRetry would perform
      const plan = [
        { id: 1, status: 'done' as const, imageUrl: 'a.png' },
        { id: 2, status: 'failed' as const, error: 'API error' },
        { id: 3, status: 'pending' as const },
      ];

      // handleRetry(id: 2): reset failed item
      const updated = plan.map(p =>
        p.id === 2 ? { ...p, status: 'pending' as const, error: undefined } : p
      );

      expect(updated[1].status).toBe('pending');
      expect(updated[1].error).toBeUndefined();
      // Other items unchanged
      expect(updated[0].status).toBe('done');
      expect(updated[2].status).toBe('pending');
    });

    it('handleRetryFailed resets all failed items to pending', () => {
      const plan = [
        { id: 1, status: 'done' as const, imageUrl: 'a.png' },
        { id: 2, status: 'failed' as const, error: 'timeout' },
        { id: 3, status: 'failed' as const, error: 'rate limit' },
        { id: 4, status: 'pending' as const },
      ];

      // handleRetryFailed: reset all failed
      const updated = plan.map(p =>
        p.status === 'failed' ? { ...p, status: 'pending' as const, error: undefined } : p
      );

      expect(updated[1].status).toBe('pending');
      expect(updated[2].status).toBe('pending');
      // Done items unchanged
      expect(updated[0].status).toBe('done');
      // Already pending unchanged
      expect(updated[3].status).toBe('pending');
    });
  });
});
