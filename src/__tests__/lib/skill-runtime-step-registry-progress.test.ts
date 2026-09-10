import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { multiPlatformExportProgressPercent } from '@/lib/skill-runtime/step-registry';

describe('multi-platform export progress projection', () => {
  it('converts completed items to the 0-100 Agent progress contract', () => {
    expect(multiPlatformExportProgressPercent(1, 12)).toBeCloseTo(100 / 12);
    expect(multiPlatformExportProgressPercent(6, 12)).toBe(50);
    expect(multiPlatformExportProgressPercent(12, 12)).toBe(100);
    expect(multiPlatformExportProgressPercent(0, 0)).toBe(0);
  });
});
