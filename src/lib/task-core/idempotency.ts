export interface IdempotencyIdentity {
  userId: string;
  idempotencyKey: string;
  requestDigest: string;
}

export interface IdempotencyConflictDetails extends IdempotencyIdentity {
  existingDigest: string;
}

const MAX_USER_ID_LENGTH = 256;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_REQUEST_DIGEST_LENGTH = 256;

export const LEGACY_UNKNOWN_REQUEST_DIGEST = 'legacy-unknown';

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';
  readonly status = 409;
  readonly statusCode = 409;

  constructor(readonly details: IdempotencyConflictDetails) {
    super('The idempotency key is already bound to a different request');
    this.name = 'IdempotencyConflictError';
  }
}

export function validateIdempotencyIdentity(
  identity: IdempotencyIdentity,
): IdempotencyIdentity {
  return {
    userId: validatePart('userId', identity.userId, MAX_USER_ID_LENGTH),
    idempotencyKey: validatePart(
      'idempotencyKey',
      identity.idempotencyKey,
      MAX_IDEMPOTENCY_KEY_LENGTH,
    ),
    requestDigest: validatePart(
      'requestDigest',
      identity.requestDigest,
      MAX_REQUEST_DIGEST_LENGTH,
    ),
  };
}

function validatePart(name: string, value: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${name} must not be empty`);
  }
  if (normalized.length > maxLength) {
    throw new RangeError(`${name} must not exceed ${maxLength} characters`);
  }
  return normalized;
}
