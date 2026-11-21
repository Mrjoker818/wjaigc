/** Validation errors retain a field name, never the user's stored values. */
export class SimpleChatSnapshotValidationError extends Error {
  constructor(readonly field: string) {
    super(`Invalid simple chat snapshot: ${field}`);
    this.name = 'SimpleChatSnapshotValidationError';
  }
}

export function diagnoseSimpleChatSyncReadError(error: unknown): {
  kind: 'stored-snapshot-invalid' | 'storage-schema' | 'storage-error' | 'unexpected';
  field?: string;
  sqlState?: string;
} {
  if (error instanceof SimpleChatSnapshotValidationError) {
    return {
      kind: 'stored-snapshot-invalid',
      ...(/^[A-Za-z][A-Za-z0-9_.\[\]-]{0,127}$/.test(error.field) ? { field: error.field } : {}),
    };
  }
  if (error && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
    return {
      kind: error.code === '42P01' || error.code === '42703' ? 'storage-schema' : 'storage-error',
      sqlState: error.code,
    };
  }
  return { kind: 'unexpected' };
}
