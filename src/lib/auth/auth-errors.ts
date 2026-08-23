export type AuthErrorCode =
  | 'AUTH_CONFIGURATION_UNAVAILABLE'
  | 'AUTH_PERSISTENCE_UNAVAILABLE'
  | 'AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS'
  | 'AUTH_CREDENTIAL_FORMAT_INVALID'
  | 'AUTH_CREDENTIAL_MIGRATION_DEFERRED';

const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  AUTH_CONFIGURATION_UNAVAILABLE: 'Authentication configuration is unavailable.',
  AUTH_PERSISTENCE_UNAVAILABLE: 'Authentication persistence is unavailable.',
  AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS: 'Authentication credential rotation is unavailable.',
  AUTH_CREDENTIAL_FORMAT_INVALID: 'Authentication credential format is invalid.',
  AUTH_CREDENTIAL_MIGRATION_DEFERRED: 'Authentication credential migration is deferred.',
};

export class AuthServiceError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    _message: string,
    public readonly httpStatus: 409 | 503,
    public readonly retryable: boolean,
  ) {
    super(AUTH_ERROR_MESSAGES[code]);
    this.name = 'AuthServiceError';
  }
}
