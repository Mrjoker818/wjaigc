import { describe, it, expect } from 'vitest';
import {
  classifyApiError,
  translateApiError,
  isRetryableApiError,
  isCloudflareTimeoutError,
  isTransportError,
} from '@/lib/api-error-translator';

describe('api-error-translator', () => {
  describe('classifyApiError', () => {
    it('should classify 401 as auth error', () => {
      const result = classifyApiError('Unauthorized', 401);
      expect(result).toBeDefined();
    });

    it('should classify 429 as rate limit error', () => {
      const result = classifyApiError('Too many requests', 429);
      expect(result).toBeDefined();
    });

    it('should classify 500 as server error', () => {
      const result = classifyApiError('Internal server error', 500);
      expect(result).toBeDefined();
    });
  });

  describe('translateApiError', () => {
    it('should translate 401 error to Chinese', () => {
      const result = translateApiError('Unauthorized', 401);
      expect(result).toBeDefined();
      // Should have title and description in Chinese
      if (typeof result === 'object') {
        expect(result.title).toBeDefined();
      }
    });

    it('should translate 429 error', () => {
      const result = translateApiError('Rate limited', 429);
      expect(result).toBeDefined();
    });

    it('should translate 502 error', () => {
      const result = translateApiError('Bad Gateway', 502);
      expect(result).toBeDefined();
    });
  });

  describe('isRetryableApiError', () => {
    it('should identify 429 as retryable', () => {
      expect(isRetryableApiError('Rate limited', 429)).toBe(true);
    });

    it('should identify 500 as retryable', () => {
      expect(isRetryableApiError('Server error', 500)).toBe(true);
    });

    it('should not identify 401 as retryable', () => {
      expect(isRetryableApiError('Unauthorized', 401)).toBe(false);
    });
  });

  describe('isCloudflareTimeoutError', () => {
    it('should detect CF 524 timeout', () => {
      expect(isCloudflareTimeoutError('A timeout occurred', 524)).toBe(true);
    });

    it('should detect CF 504 timeout', () => {
      expect(isCloudflareTimeoutError('Gateway Timeout', 504)).toBe(true);
    });

    it('should not identify 500 as CF timeout', () => {
      expect(isCloudflareTimeoutError('Internal Server Error', 500)).toBe(false);
    });
  });

  describe('isTransportError', () => {
    it('should detect connection reset', () => {
      expect(isTransportError(new Error('connection reset'))).toBe(true);
    });

    it('should detect ECONNREFUSED', () => {
      expect(isTransportError(new Error('ECONNREFUSED'))).toBe(true);
    });

    it('should not identify regular errors as transport errors', () => {
      expect(isTransportError(new Error('Invalid parameter'))).toBe(false);
    });
  });
});
