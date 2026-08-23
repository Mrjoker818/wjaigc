import { describe, expect, it } from 'vitest';

import { AuthServiceError } from '@/lib/auth/auth-errors';

describe('AuthServiceError', () => {
  it('does not expose arbitrary caller messages while preserving typed metadata', () => {
    const messages = [
      'a'.repeat(64),
      'host=db.internal;dbname=application;user=service',
    ];

    for (const message of messages) {
      const error = new AuthServiceError(
        'AUTH_PERSISTENCE_UNAVAILABLE',
        message,
        503,
        true,
      );

      expect(error.message).not.toContain(message);
      expect(error.code).toBe('AUTH_PERSISTENCE_UNAVAILABLE');
      expect(error.httpStatus).toBe(503);
      expect(error.retryable).toBe(true);
    }
  });
});
