import { describe, expect, it } from 'vitest';
import {
  formatPaymentTimestamp,
  normalizePaymentTimestamp,
} from '@/lib/payment-order-time';

describe('payment order timestamp normalization', () => {
  it.each([
    [1_784_002_800_000, 1_784_002_800_000],
    ['1784002800000', 1_784_002_800_000],
    [1_784_002_800, 1_784_002_800_000],
    ['1784002800', 1_784_002_800_000],
    ['2026-07-15T10:20:00.000Z', 1_784_110_800_000],
  ])('normalizes %p to a millisecond epoch', (input, expected) => {
    expect(normalizePaymentTimestamp(input)).toBe(expected);
  });

  it.each([undefined, null, '', 'not-a-date', 0, -1])(
    'does not render an invalid payment timestamp for %p',
    (input) => {
      expect(normalizePaymentTimestamp(input)).toBeNull();
      expect(formatPaymentTimestamp(input)).toBe('时间未知');
    },
  );
});
