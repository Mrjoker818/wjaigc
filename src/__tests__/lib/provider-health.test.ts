import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordProviderSuccess,
  recordProviderFailure,
  isProviderCoolingDown,
  getProviderHealth,
  orderProvidersByHealth,
  __resetProviderHealthForTest,
} from '@/lib/provider-health';

describe('provider health tracking', () => {
  beforeEach(() => {
    __resetProviderHealthForTest();
  });

  it('treats unknown providers as healthy', () => {
    expect(isProviderCoolingDown('p1')).toBe(false);
    expect(getProviderHealth('p1').healthy).toBe(true);
  });

  it('puts a provider into cooldown after a failure and recovers after the window', () => {
    const t0 = 1_000_000;
    recordProviderFailure('p1', t0);
    expect(isProviderCoolingDown('p1', t0 + 1_000)).toBe(true);
    // 基础冷却 30s，过期后恢复
    expect(isProviderCoolingDown('p1', t0 + 31_000)).toBe(false);
  });

  it('extends cooldown exponentially on consecutive failures', () => {
    const t0 = 1_000_000;
    recordProviderFailure('p1', t0); // 30s
    recordProviderFailure('p1', t0); // 60s
    expect(getProviderHealth('p1', t0).consecutiveFailures).toBe(2);
    expect(isProviderCoolingDown('p1', t0 + 45_000)).toBe(true);
  });

  it('success clears failures and cooldown immediately', () => {
    const t0 = 1_000_000;
    recordProviderFailure('p1', t0);
    recordProviderSuccess('p1', t0 + 500);
    expect(isProviderCoolingDown('p1', t0 + 500)).toBe(false);
    expect(getProviderHealth('p1', t0 + 500).consecutiveFailures).toBe(0);
  });

  it('orders cooling-down providers to the back while keeping priority order otherwise', () => {
    const t0 = 1_000_000;
    recordProviderFailure('a', t0); // a is cooling down
    const ordered = orderProvidersByHealth(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      t0 + 1_000,
    );
    expect(ordered.map(p => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('keeps original order when all providers are healthy', () => {
    const ordered = orderProvidersByHealth([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(ordered.map(p => p.id)).toEqual(['a', 'b', 'c']);
  });
});
