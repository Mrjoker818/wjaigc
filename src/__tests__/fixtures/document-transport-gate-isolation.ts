import { afterEach, expect, vi } from 'vitest';
import { getDocumentExecutionStats } from '@/lib/collaboration/document-execution-scope';

interface IsolatedGate {
  participants: Set<unknown>;
  transition?: { pending: number; ready: boolean; failed: boolean; timer?: unknown };
}
afterEach(async () => {
  const global = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const key = Symbol.for('wujie.documentTransportGate.v1');
  const state = global[key] as IsolatedGate | undefined;
  if (!state) return;
  // Each test owns a cold fixture. Never discard an active epoch to make it pass.
  await vi.waitFor(() => {
    expect(getDocumentExecutionStats().activeScopes, 'active execution during fixture reset').toBe(0);
    expect(state.participants.size, 'registered gateway during fixture reset').toBe(0);
    if (state.transition) {
      expect(state.transition.pending).toBe(0);
      expect(state.transition.failed).toBe(false);
      expect(state.transition.ready).toBe(true);
      expect(state.transition.timer).toBeUndefined();
    }
  });
  delete global[key];
});
