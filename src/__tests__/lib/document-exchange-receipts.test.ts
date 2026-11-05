import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const mocks = vi.hoisted(() => ({ getPool: vi.fn(), assertDocumentEditor: vi.fn(),
  assertDocumentProjectEnabled: vi.fn(), commitDocumentUpdateInTransaction: vi.fn(), loadDocumentInTransaction: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-client', () => ({ getPool: mocks.getPool }));
vi.mock('@/lib/collaboration/document-access', () => ({
  assertDocumentEditor: mocks.assertDocumentEditor,
  assertDocumentProjectEnabled: mocks.assertDocumentProjectEnabled,
}));
vi.mock('@/lib/collaboration/document-store', () => ({
  commitDocumentUpdateInTransaction: mocks.commitDocumentUpdateInTransaction,
  loadDocumentInTransaction: mocks.loadDocumentInTransaction,
  DocumentUpdateRejectedError: class DocumentUpdateRejectedError extends Error {},
}));
vi.mock('@/lib/collaboration/document-assets', () => ({
  DocumentAssetError: class DocumentAssetError extends Error {},
}));
import { executeDocumentExchangeUpdate, readDocumentExchangeReceipt, type DocumentExchangeUpdateInput } from '@/lib/collaboration/document-exchange-receipts';

const token = 's'.repeat(43);
const sessionHash = createHash('sha256').update(token).digest('hex');
const cookieHash = 'c'.repeat(64);
function bytes(): Uint8Array {
  const doc = new Y.Doc();
  try { doc.getMap('annotations').set('p-one', 'note'); return Y.encodeStateAsUpdate(doc); }
  finally { doc.destroy(); }
}
function input(): DocumentExchangeUpdateInput {
  return { actorId: 'actor-a', projectId: 'project-a', authSessionHash: cookieHash,
    sessionToken: token, operationId: 'operation_00000001', bytes: bytes() };
}
function digest(update: Uint8Array): string {
  return createHash('sha256').update('wujie-document-update-v1\0').update(update).digest('hex');
}
interface Stored { update_digest: string; document_sequence: string }
interface FixtureOptions {
  stored?: Stored;
  session?: Record<string, unknown> | null;
  commitFailure?: boolean;
  rollbackFailure?: boolean;
  commitGate?: Promise<void>;
  finalSessionActive?: boolean;
  shortExpired?: boolean;
  beforeQuery?: (sql: string) => void;
}
function client(options: FixtureOptions = {}) {
  let stored = options.stored;
  const commands: string[] = [];
  const binding = { actor_id: 'actor-a', project_id: 'project-a', owner_id: 'owner-a',
    grant_generation: '7', auth_session_hash: cookieHash, session_hash: sessionHash, active: true,
    ...(options.session ?? {}) };
  const query = vi.fn(async (sql: string, args?: unknown[]) => {
    commands.push(sql); options.beforeQuery?.(sql);
    const active = binding.active === true && (!options.shortExpired || sql.includes('retain_until > clock_timestamp()'));
    if (/^SELECT \(revoked_at/u.test(sql)) return { rows: [{ active: active && options.finalSessionActive !== false }], rowCount: 1 };
    if (sql === 'COMMIT' && options.commitGate) await options.commitGate;
    if (sql === 'COMMIT' && options.commitFailure) throw new Error('lost COMMIT response');
    if (sql === 'ROLLBACK' && options.rollbackFailure) throw new Error('rollback transport failure');
    if (/FROM wujie_document_exchange_sessions/u.test(sql)) {
      return { rows: options.session === null ? [] : [{ ...binding, active }], rowCount: options.session === null ? 0 : 1 };
    }
    if (/SELECT [\s\S]*FROM wujie_document_update_receipts/u.test(sql)) return { rows: stored ? [stored] : [], rowCount: stored ? 1 : 0 };
    if (/INSERT INTO wujie_document_update_receipts/u.test(sql)) {
      // A test double records the proposed atomic write; it does not model PostgreSQL COMMIT.
      stored = { update_digest: String(args?.[6]), document_sequence: String(args?.[7]) };
    }
    if (/FROM wujie_project_canvas_documents/u.test(sql)) return { rows: [{ owner_id: 'owner-a' }], rowCount: 1 };
    return { rows: [{}], rowCount: 1 };
  });
  return { query, release: vi.fn(), commands };
}
function connect(...clients: ReturnType<typeof client>[]) {
  const result = vi.fn(); clients.forEach(value => result.mockResolvedValueOnce(value));
  mocks.getPool.mockReturnValue({ connect: result }); return result;
}
function expectedReceipt(request: DocumentExchangeUpdateInput, sequence = 21) {
  return { operationId: request.operationId, sessionFingerprint: sessionHash,
    updateDigest: digest(request.bytes), documentSequence: sequence };
}

describe('isolated exact document operation receipts (controlled SQL, no PostgreSQL)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.assertDocumentEditor.mockResolvedValue({ ownerId: 'owner-a' });
    mocks.assertDocumentProjectEnabled.mockResolvedValue(undefined);
    mocks.commitDocumentUpdateInTransaction.mockResolvedValue({ sequence: 21, update: new Uint8Array([0, 0]) });
    mocks.loadDocumentInTransaction.mockImplementation(async () => ({ doc: new Y.Doc(), sequence: 20 }));
  });
  it('uses the existing canonical write and persists the receipt in that same transaction before acknowledging', async () => {
    const request = input(), db = client(); connect(db);
    const actual = await executeDocumentExchangeUpdate(request);
    expect(actual).toEqual(expectedReceipt(request));
    expect(mocks.commitDocumentUpdateInTransaction).toHaveBeenCalledWith(db, {
      actorId: 'actor-a', projectId: 'project-a', expectedGrantGeneration: '7', bytes: request.bytes,
    });
    expect(mocks.assertDocumentEditor).toHaveBeenCalledWith('actor-a', 'project-a', db, '7');
    expect(mocks.assertDocumentProjectEnabled).toHaveBeenCalledWith(db, 'owner-a', 'project-a');
    const insert = db.commands.findIndex(sql => sql.includes('INSERT INTO wujie_document_update_receipts'));
    expect(insert).toBeGreaterThan(0); expect(db.commands.indexOf('COMMIT')).toBeGreaterThan(insert);
    expect(db.release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('returns a durable matching receipt without reapplying or using the current document tip', async () => {
    const request = input(); const db = client({ stored: { update_digest: digest(request.bytes), document_sequence: '9' } }); connect(db);
    expect(await executeDocumentExchangeUpdate(request)).toEqual(expectedReceipt(request, 9));
    expect(mocks.commitDocumentUpdateInTransaction).not.toHaveBeenCalled();
  });
  it('keeps the result pending until COMMIT actually settles, including a replayed receipt', async () => {
    const request = input();
    for (const replay of [false, true]) {
      let finish: () => void = () => {};
      const commitGate = new Promise<void>(resolve => { finish = resolve; });
      const db = client({ commitGate, ...(replay ? { stored: { update_digest: digest(request.bytes), document_sequence: '21' } } : {}) });
      connect(db);
      let completed = false;
      const pending = executeDocumentExchangeUpdate(request).then(result => { completed = true; return result; });
      try {
        await vi.waitFor(() => expect(db.commands).toContain('COMMIT'));
        expect(completed).toBe(false);
        finish(); expect(await pending).toEqual(expectedReceipt(request));
      } finally { finish(); await pending.catch(() => undefined); }
    }
  });
  it('refuses an operation ID reused with different bytes', async () => {
    const request = input(); connect(client({ stored: { update_digest: 'b'.repeat(64), document_sequence: '9' } }));
    await expect(executeDocumentExchangeUpdate(request)).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_CONFLICT' });
    expect(mocks.commitDocumentUpdateInTransaction).not.toHaveBeenCalled();
  });
  it.each([{ actor_id: 'actor-b' }, { project_id: 'project-b' }, { auth_session_hash: 'd'.repeat(64) }, { active: false }, null])
    ('does not write or reveal a receipt outside the immutable session binding %j', async session => {
      const request = input(); connect(client({ session, stored: { update_digest: digest(request.bytes), document_sequence: '9' } }));
      await expect(executeDocumentExchangeUpdate(request)).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_FORBIDDEN' });
      expect(mocks.commitDocumentUpdateInTransaction).not.toHaveBeenCalled();
    });
  it('refuses an old authorization generation even if a durable receipt exists', async () => {
    const request = input(), db = client({ stored: { update_digest: digest(request.bytes), document_sequence: '9' } }); connect(db);
    mocks.assertDocumentEditor.mockRejectedValueOnce({ code: 'DOCUMENT_FORBIDDEN' });
    await expect(executeDocumentExchangeUpdate(request)).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_FORBIDDEN' });
    expect(mocks.assertDocumentEditor).toHaveBeenCalledWith('actor-a', 'project-a', db, '7');
    expect(db.commands.some(sql => /FROM wujie_document_update_receipts/u.test(sql))).toBe(false);
  });
  it('resolves a lost COMMIT response only from a fresh authorized durable receipt', async () => {
    const request = input(), original = client({ commitFailure: true });
    const recovery = client({ stored: { update_digest: digest(request.bytes), document_sequence: '21' } }); connect(original, recovery);
    expect(await executeDocumentExchangeUpdate(request)).toEqual(expectedReceipt(request));
    expect(original.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.commitDocumentUpdateInTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.assertDocumentEditor).toHaveBeenCalledWith('actor-a', 'project-a', recovery, '7');
  });
  it('keeps a missing receipt after uncertain COMMIT unknown and never sends the write again', async () => {
    const request = input(); connect(client({ commitFailure: true }), client());
    await expect(executeDocumentExchangeUpdate(request)).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_UNCERTAIN' });
    expect(mocks.commitDocumentUpdateInTransaction).toHaveBeenCalledTimes(1);
  });
  it('reveals no recovered receipt after access is revoked during a lost COMMIT response', async () => {
    const request = input(); connect(client({ commitFailure: true }), client({ stored: { update_digest: digest(request.bytes), document_sequence: '21' } }));
    mocks.assertDocumentEditor.mockResolvedValueOnce({ ownerId: 'owner-a' }).mockRejectedValueOnce({ code: 'DOCUMENT_FORBIDDEN' });
    await expect(executeDocumentExchangeUpdate(request)).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN' });
    expect(mocks.commitDocumentUpdateInTransaction).toHaveBeenCalledTimes(1);
  });
  it('takes the existing shared asset graph gate before a project lock, including receipt lookup', async () => {
    const request = input();
    for (const readOnly of [false, true]) {
      const db = client(); connect(db);
      if (readOnly) await readDocumentExchangeReceipt(request); else await executeDocumentExchangeUpdate(request);
      const gate = db.commands.findIndex(sql => sql.includes('pg_advisory_xact_lock_shared'));
      const project = db.commands.findIndex(sql => sql.includes('FROM wujie_projects'));
      expect(gate).toBeGreaterThanOrEqual(0); expect(project).toBeGreaterThan(gate);
    }
  });
  it('rechecks expiry at the defined admission point after dependent locks, before reading or writing a receipt', async () => {
    const request = input(), db = client({ finalSessionActive: false, stored: { update_digest: digest(request.bytes), document_sequence: '21' } }); connect(db);
    await expect(executeDocumentExchangeUpdate(request)).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_FORBIDDEN' });
    expect(db.commands.some(sql => sql.includes('FROM wujie_document_update_receipts'))).toBe(false);
    expect(mocks.commitDocumentUpdateInTransaction).not.toHaveBeenCalled();
  });
  it('refuses raw media mutations before calling the canonical update, while leaving media commands separate', async () => {
    const request = input(), db = client(); connect(db);
    const doc = new Y.Doc();
    try { doc.getMap('assetVersions').set('p-one', 'version-one'); request.bytes = Y.encodeStateAsUpdate(doc); }
    finally { doc.destroy(); }
    await expect(executeDocumentExchangeUpdate(request)).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_REJECTED' });
    expect(mocks.commitDocumentUpdateInTransaction).not.toHaveBeenCalled();
    expect(db.commands).not.toContain('COMMIT');
  });
  it('keeps a causally incomplete update retryable without a write or a receipt', async () => {
    const request = input(), db = client(); connect(db);
    const edit = new Y.Doc({ gc: false });
    try {
      edit.getMap('annotations').set('prefix', 'metadata');
      const vector = Y.encodeStateVector(edit); edit.getMap('annotations').set('second', 'metadata');
      request.bytes = Y.encodeStateAsUpdate(edit, vector);
    } finally { edit.destroy(); }
    await expect(executeDocumentExchangeUpdate(request)).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_DEPENDENCY_PENDING' });
    expect(mocks.commitDocumentUpdateInTransaction).not.toHaveBeenCalled();
    expect(db.commands.some(sql => sql.includes('INSERT INTO wujie_document_update_receipts'))).toBe(false);
  });
  it('does not guess an operation result from an empty lookup', async () => {
    const request = input(); connect(client());
    expect(await readDocumentExchangeReceipt(request)).toBeNull();
    expect(mocks.commitDocumentUpdateInTransaction).not.toHaveBeenCalled();
  });
  it('permits only the original retained receipt lookup after short expiry, while new writes remain forbidden', async () => {
    const request = input(), options = { shortExpired: true, stored: { update_digest: digest(request.bytes), document_sequence: '9' } };
    connect(client(options), client(options));
    await expect(executeDocumentExchangeUpdate(request)).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_FORBIDDEN' });
    expect(await readDocumentExchangeReceipt(request)).toEqual(expectedReceipt(request, 9));
    expect(mocks.commitDocumentUpdateInTransaction).not.toHaveBeenCalled();
  });
  it('classifies a proven canonical validation rejection separately from uncertain COMMIT', async () => {
    const { DocumentUpdateRejectedError } = await import('@/lib/collaboration/document-store');
    const request = input(), db = client(); connect(db);
    mocks.commitDocumentUpdateInTransaction.mockRejectedValueOnce(new DocumentUpdateRejectedError(new Error('private validation reason')));
    await expect(executeDocumentExchangeUpdate(request)).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_REJECTED', message: 'DOCUMENT_EXCHANGE_REJECTED' });
    expect(db.commands).toContain('ROLLBACK'); expect(db.commands).not.toContain('COMMIT');
    expect(db.commands.some(sql => sql.includes('INSERT INTO wujie_document_update_receipts'))).toBe(false);
  });
  it('destroys a connection whose rollback failed without leaking the underlying error', async () => {
    const request = input(), db = client({ rollbackFailure: true }); connect(db);
    mocks.commitDocumentUpdateInTransaction.mockRejectedValueOnce(new Error('postgres://private-credential'));
    await expect(executeDocumentExchangeUpdate(request)).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_UNAVAILABLE', message: 'DOCUMENT_EXCHANGE_UNAVAILABLE' });
    expect(db.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('rolls back the canonical update when its receipt cannot be inserted and does not acknowledge it', async () => {
    const request = input(), db = client({ beforeQuery: sql => {
      if (sql.includes('INSERT INTO wujie_document_update_receipts')) throw new Error('disk or receipt failure');
    } }); connect(db);
    await expect(executeDocumentExchangeUpdate(request)).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_UNAVAILABLE' });
    expect(mocks.commitDocumentUpdateInTransaction).toHaveBeenCalledTimes(1);
    expect(db.commands).toContain('ROLLBACK'); expect(db.commands).not.toContain('COMMIT');
  });
  it('refuses corrupt stored result numbers rather than acknowledging the wrong sequence', async () => {
    const request = input(); connect(client({ stored: { update_digest: digest(request.bytes), document_sequence: '9007199254740993' } }));
    await expect(executeDocumentExchangeUpdate(request)).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_UNAVAILABLE' });
    expect(mocks.commitDocumentUpdateInTransaction).not.toHaveBeenCalled();
  });
  it('freezes submitted bytes before acquiring an asynchronous database connection', async () => {
    const request = input(), originalBytes = Uint8Array.from(request.bytes), db = client();
    let admit: (value: ReturnType<typeof client>) => void = () => {};
    const pendingClient = new Promise<ReturnType<typeof client>>(resolve => { admit = resolve; });
    mocks.getPool.mockReturnValue({ connect: () => pendingClient });
    const pending = executeDocumentExchangeUpdate(request); request.bytes.fill(255); admit(db);
    const receipt = await pending;
    expect(receipt.updateDigest).toBe(digest(originalBytes));
    expect(mocks.commitDocumentUpdateInTransaction.mock.calls[0][1].bytes).toEqual(originalBytes);
  });
  it('rejects unsafe identities and oversized or malformed updates before any database acquisition', async () => {
    const request = input();
    for (const changed of [{ operationId: '../escape' }, { authSessionHash: 'raw-cookie' },
      { bytes: new Uint8Array(1_048_577) }, { bytes: new Uint8Array([255]) }]) {
      await expect(executeDocumentExchangeUpdate({ ...request, ...changed })).rejects.toMatchObject({ code: 'DOCUMENT_EXCHANGE_INVALID' });
    }
    expect(mocks.getPool).not.toHaveBeenCalled();
  });
});
