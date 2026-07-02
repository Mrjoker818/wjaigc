import { describe, it, expect } from 'vitest';
import { calculateActualPixelsFromRatio } from '@/lib/calculate-pixels';

describe('calculate-pixels', () => {
  describe('calculateActualPixelsFromRatio', () => {
    it('should return a string in WIDTHxHEIGHT format for valid inputs', () => {
      const result = calculateActualPixelsFromRatio('1:1', 'standard');
      expect(result).toBeTruthy();
      expect(result).toMatch(/^\d+x\d+$/);
    });

    it('should return square dimensions for 1:1 ratio', () => {
      const result = calculateActualPixelsFromRatio('1:1', 'standard');
      expect(result).toBeTruthy();
      if (result) {
        const [w, h] = result.split('x').map(Number);
        expect(w).toBe(h);
      }
    });

    it('should return landscape dimensions for 16:9 ratio', () => {
      const result = calculateActualPixelsFromRatio('16:9', 'standard');
      expect(result).toBeTruthy();
      if (result) {
        const [w, h] = result.split('x').map(Number);
        expect(w).toBeGreaterThan(h);
        // Aspect ratio should be approximately 16:9
        const ratio = w / h;
        expect(ratio).toBeCloseTo(16 / 9, 0);
      }
    });

    it('should return portrait dimensions for 9:16 ratio', () => {
      const result = calculateActualPixelsFromRatio('9:16', 'standard');
      expect(result).toBeTruthy();
      if (result) {
        const [w, h] = result.split('x').map(Number);
        expect(h).toBeGreaterThan(w);
      }
    });

    it('should return null for missing required params', () => {
      expect(calculateActualPixelsFromRatio('', 'standard')).toBeNull();
      expect(calculateActualPixelsFromRatio('1:1', '')).toBeNull();
      expect(calculateActualPixelsFromRatio('', '')).toBeNull();
    });

    it('should return aligned dimensions (multiples of 8)', () => {
      const result = calculateActualPixelsFromRatio('4:3', 'standard');
      expect(result).toBeTruthy();
      if (result) {
        const [w, h] = result.split('x').map(Number);
        expect(w % 8).toBe(0);
        expect(h % 8).toBe(0);
      }
    });
  });
});
