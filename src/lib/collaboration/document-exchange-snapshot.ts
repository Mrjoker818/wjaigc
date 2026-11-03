import 'server-only';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import * as Y from 'yjs';
import { getPool } from '@/lib/db-client';
import { authorizeDocumentExchangeSessionInTransaction, DocumentExchangeError } from './document-exchange-access';
import { loadDocumentInTransaction } from './document-store';

export interface DocumentExchangeSnapshotInput {
  actorId: string; authSessionHash: string; projectId: string; sessionToken: string;
  stateVector: Uint8Array; afterSequence?: number;
}
export interface DocumentExchangeSnapshot {
  sessionFingerprint: string; sequence: number; update: Uint8Array;
}
const safeId = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 256 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);

/** Read only the authorized canonical document; never use client metadata as authority. */
export async function readDocumentExchangeSnapshot(raw: DocumentExchangeSnapshotInput): Promise<DocumentExchangeSnapshot> {
  if (!raw || !safeId(raw.actorId) || !safeId(raw.projectId) || !/^[0-9a-f]{64}$/u.test(raw.authSessionHash)
    || !/^[A-Za-z0-9_-]{43}$/u.test(raw.sessionToken) || !(raw.stateVector instanceof Uint8Array)
    || raw.stateVector.length < 1 || raw.stateVector.length > 1_048_576
    || (raw.afterSequence !== undefined && (!Number.isSafeInteger(raw.afterSequence) || raw.afterSequence < 0))) {
    throw new DocumentExchangeError('DOCUMENT_EXCHANGE_INVALID');
  }
  const stateVector = Uint8Array.from(raw.stateVector);
  const afterSequence = raw.afterSequence;
  try { Y.decodeStateVector(stateVector); } catch { throw new DocumentExchangeError('DOCUMENT_EXCHANGE_INVALID'); }
  const input = { actorId: raw.actorId, projectId: raw.projectId, authSessionHash: raw.authSessionHash,
    sessionHash: createHash('sha256').update(raw.sessionToken).digest('hex') };
  let client: PoolClient;
  try { client = await getPool().connect(); }
  catch { throw new DocumentExchangeError('DOCUMENT_EXCHANGE_UNAVAILABLE'); }
  let discard = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL lock_timeout = '1000ms'");
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const scope = await authorizeDocumentExchangeSessionInTransaction(client, input, 'active', 'read');
    const row = (await client.query<{ sequence: string }>(`SELECT sequence::text FROM wujie_project_canvas_documents
      WHERE project_id=$1 AND owner_id=$2`, [input.projectId, scope.owner_id])).rows[0];
    if (!row || !/^(?:0|[1-9]\d*)$/u.test(row.sequence) || !Number.isSafeInteger(Number(row.sequence))) {
      throw new DocumentExchangeError('DOCUMENT_EXCHANGE_UNAVAILABLE');
    }
    const sequence = Number(row.sequence);
    if (afterSequence !== undefined && afterSequence > sequence) {
      throw new DocumentExchangeError('DOCUMENT_EXCHANGE_CONFLICT');
    }
    // A sequence is only a cursor, never proof that the caller applied a snapshot.
    // Always include the canonical Yjs diff (and its deletion set).
    const loaded = await loadDocumentInTransaction(client, input.projectId);
    let update: Uint8Array;
    try {
      if (loaded.sequence !== sequence) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_UNAVAILABLE');
      update = Y.encodeStateAsUpdate(loaded.doc, stateVector);
      if (update.length + 9 > 5 * 1024 * 1024) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_TOO_LARGE');
    } finally { loaded.doc.destroy(); }
    await client.query('COMMIT');
    return { sessionFingerprint: input.sessionHash, sequence, update };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    if (error instanceof DocumentExchangeError) throw error;
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'DOCUMENT_FORBIDDEN' || code === 'DOCUMENT_PROJECT_NOT_ENABLED' || code === 'DOCUMENT_DISABLED') {
      throw new DocumentExchangeError('DOCUMENT_EXCHANGE_FORBIDDEN');
    }
    throw new DocumentExchangeError(code === '55P03' ? 'DOCUMENT_EXCHANGE_BUSY' : 'DOCUMENT_EXCHANGE_UNAVAILABLE');
  } finally { client.release(discard); }
}
