import { describe, expect, it } from 'vitest';
import { diagnoseSimpleChatSyncReadError, SimpleChatSnapshotValidationError } from '@/lib/simple-chat-sync-read-error';

describe('simple-chat read error diagnostics', () => {
  it('keeps only a validation field, never snapshot content', () => {
    expect(diagnoseSimpleChatSyncReadError(new SimpleChatSnapshotValidationError('knowledgeItems')))
      .toEqual({ kind: 'stored-snapshot-invalid', field: 'knowledgeItems' });
  });

  it.each(['42P01', '42703'])('classifies missing schema %s without exposing a database error', code => {
    const result = diagnoseSimpleChatSyncReadError(Object.assign(new Error('private connection details'), {
      code, query: 'private query', detail: 'private row', table: 'private table',
    }));
    expect(result).toEqual({ kind: 'storage-schema', sqlState: code });
  });

  it('does not log arbitrary errors, credentials or property names', () => {
    const value = { code: 'postgresql://private:secret@host/db', message: 'private content', field: 'secret' };
    expect(diagnoseSimpleChatSyncReadError(value)).toEqual({ kind: 'unexpected' });
    expect(diagnoseSimpleChatSyncReadError(new SimpleChatSnapshotValidationError('secret / credential')))
      .toEqual({ kind: 'stored-snapshot-invalid' });
  });
});
