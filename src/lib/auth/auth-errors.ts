export type AuthErrorCode =
  | 'AUTH_CONFIGURATION_UNAVAILABLE'
  | 'AUTH_PERSISTENCE_UNAVAILABLE'
  | 'AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS'
  | 'AUTH_CREDENTIAL_FORMAT_INVALID'
  | 'AUTH_CREDENTIAL_MIGRATION_DEFERRED';

function toSafeAuthErrorMessage(message: string): string {
  if (/\b(?:password|secret|hash|token|api[ _-]?key)\b|[a-z][a-z0-9+.-]*:\/\//i.test(message)) {
    return 'Authentication service request failed.';
  }

  return message;
}

export class AuthServiceError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly httpStatus: 409 | 503,
    public readonly retryable: boolean,
  ) {
    super(toSafeAuthErrorMessage(message));
    this.name = 'AuthServiceError';
  }
}
