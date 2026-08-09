export type TaskErrorSource =
  | 'client'
  | 'wujie'
  | 'provider'
  | 'database'
  | 'storage'
  | 'network';

export interface UnifiedTaskError {
  code: string;
  message: string;
  source: TaskErrorSource;
  retryable: boolean;
  requestId: string;
  providerStatus?: number;
}

export type TaskErrorInput = Pick<UnifiedTaskError, 'code' | 'message'>
  & Partial<Omit<UnifiedTaskError, 'code' | 'message'>>;

export interface TaskErrorDefaults {
  code: string;
  message: string;
  source: TaskErrorSource;
  retryable: boolean;
  requestId?: string;
  providerStatus?: number;
}

export function createTaskRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return `req_${cryptoApi.randomUUID().replaceAll('-', '').slice(0, 16)}`;
  }

  const entropy = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `req_${entropy.slice(0, 16)}`;
}

export function isUnifiedTaskError(value: unknown): value is UnifiedTaskError {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UnifiedTaskError>;
  return typeof candidate.code === 'string'
    && typeof candidate.message === 'string'
    && typeof candidate.source === 'string'
    && typeof candidate.retryable === 'boolean'
    && typeof candidate.requestId === 'string';
}

/**
 * Converts internal failures into a client-safe task error. The caller owns the
 * user-facing message; raw provider/database bodies stay in server-side logs.
 */
export function normalizeTaskError(
  error: unknown,
  defaults: TaskErrorDefaults,
): UnifiedTaskError {
  if (isUnifiedTaskError(error)) return error;
  const legacyCandidate = error && typeof error === 'object'
    ? error as Partial<TaskErrorInput>
    : undefined;
  const legacy = typeof legacyCandidate?.code === 'string'
    ? legacyCandidate
    : undefined;

  return {
    code: typeof legacy?.code === 'string' ? legacy.code : defaults.code,
    message: typeof legacy?.message === 'string' ? legacy.message : defaults.message,
    source: legacy?.source || defaults.source,
    retryable: legacy?.retryable ?? defaults.retryable,
    requestId: legacy?.requestId || defaults.requestId || createTaskRequestId(),
    ...((legacy?.providerStatus ?? defaults.providerStatus) !== undefined
      ? { providerStatus: legacy?.providerStatus ?? defaults.providerStatus }
      : {}),
  };
}

export function inferTaskErrorSource(error: unknown): TaskErrorSource {
  const message = error instanceof Error
    ? error.message.toLowerCase()
    : String(error || '').toLowerCase();

  if (
    message.includes('postgres')
    || message.includes('database')
    || message.includes('sql')
  ) {
    return 'database';
  }
  if (
    message.includes('s3')
    || message.includes('storage')
    || message.includes('upload')
  ) {
    return 'storage';
  }
  if (
    message.includes('fetch')
    || message.includes('network')
    || message.includes('connect')
    || message.includes('socket')
  ) {
    return 'network';
  }
  return 'wujie';
}
