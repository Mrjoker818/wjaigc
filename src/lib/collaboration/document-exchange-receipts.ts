import 'server-only';

import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import * as Y from 'yjs';
import { getPool } from '@/lib/db-client';
import { commitDocumentUpdateInTransaction, DocumentUpdateRejectedError, loadDocumentInTransaction } from './document-store';
import { DocumentAssetError } from './document-assets';
import { assertDocumentExchangeMetadataUpdate, DocumentExchangeDependencyPendingError } from './document-exchange-metadata';
import { getDocumentExecutionScope } from './document-execution-scope';
import { authorizeDocumentExchangeSessionInTransaction, DocumentExchangeError,
  type StoredDocumentExchangeSession as StoredSession } from './document-exchange-access';
export { authorizeDocumentExchangeSessionInTransaction, DocumentExchangeError } from './document-exchange-access';

export interface DocumentExchangeUpdateInput {
  actorId: string;
  authSessionHash: string;
  projectId: string;
  sessionToken: string;
  operationId: string;
  bytes: Uint8Array;
}
export interface DocumentExchangeReceipt {
  operationId: string;
  sessionFingerprint: string;
  updateDigest: string;
  documentSequence: number;
}
export interface DocumentExchangeReceiptQuery extends Omit<DocumentExchangeUpdateInput, 'bytes'> {
  updateDigest: string;
}

interface FrozenUpdate extends DocumentExchangeUpdateInput {
  sessionHash: string;
  updateDigest: string;
}
type FrozenReceiptQuery = Pick<FrozenUpdate,
  'actorId' | 'authSessionHash' | 'projectId' | 'operationId' | 'sessionHash' | 'updateDigest'>;
interface StoredReceipt { update_digest: string; document_sequence: string }
const safeId = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 256 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);

function normalizeReceiptQuery(input: DocumentExchangeReceiptQuery): FrozenReceiptQuery {
  if (!input || !safeId(input.actorId) || !safeId(input.projectId)
    || typeof input.authSessionHash !== 'string' || !/^[0-9a-f]{64}$/u.test(input.authSessionHash)
    || typeof input.sessionToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(input.sessionToken)
    || typeof input.operationId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/u.test(input.operationId)
    || typeof input.updateDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(input.updateDigest)) {
    throw new DocumentExchangeError('DOCUMENT_EXCHANGE_INVALID');
  }
  return { actorId: input.actorId, authSessionHash: input.authSessionHash, projectId: input.projectId,
    operationId: input.operationId, updateDigest: input.updateDigest,
    sessionHash: createHash('sha256').update(input.sessionToken).digest('hex') };
}

function normalize(input: DocumentExchangeUpdateInput): FrozenUpdate {
  if (!input || !safeId(input.actorId) || !safeId(input.projectId)
    || typeof input.authSessionHash !== 'string' || !/^[0-9a-f]{64}$/u.test(input.authSessionHash)
    || typeof input.sessionToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(input.sessionToken)
    || typeof input.operationId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/u.test(input.operationId)
    || !(input.bytes instanceof Uint8Array) || input.bytes.length < 2 || input.bytes.length > 1_048_576) {
    throw new DocumentExchangeError('DOCUMENT_EXCHANGE_INVALID');
  }
  const bytes = Uint8Array.from(input.bytes);
  try { Y.decodeUpdate(bytes); } catch { throw new DocumentExchangeError('DOCUMENT_EXCHANGE_INVALID'); }
  return { actorId: input.actorId, projectId: input.projectId, authSessionHash: input.authSessionHash,
    sessionToken: input.sessionToken, operationId: input.operationId, bytes,
    sessionHash: createHash('sha256').update(input.sessionToken).digest('hex'),
    updateDigest: createHash('sha256').update('wujie-document-update-v1\0').update(bytes).digest('hex') };
}

function classified(error: unknown): DocumentExchangeError {
  if (error instanceof DocumentExchangeError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'DOCUMENT_FORBIDDEN' || code === 'DOCUMENT_PROJECT_NOT_ENABLED' || code === 'DOCUMENT_DISABLED') {
    return new DocumentExchangeError('DOCUMENT_EXCHANGE_FORBIDDEN', error);
  }
  if (error instanceof DocumentUpdateRejectedError || error instanceof DocumentAssetError) {
    return new DocumentExchangeError('DOCUMENT_EXCHANGE_REJECTED', error);
  }
  if (code === '55P03') return new DocumentExchangeError('DOCUMENT_EXCHANGE_BUSY', error);
  return new DocumentExchangeError('DOCUMENT_EXCHANGE_UNAVAILABLE', error);
}

async function connect(): Promise<PoolClient> {
  try { return await getPool().connect(); }
  catch (error) { throw classified(error); }
}

function receipt(input: FrozenReceiptQuery, sequence: string | number): DocumentExchangeReceipt {
  if ((typeof sequence === 'string' && !/^(?:0|[1-9]\d*)$/u.test(sequence))
    || !Number.isSafeInteger(Number(sequence)) || Number(sequence) < 0) {
    throw new DocumentExchangeError('DOCUMENT_EXCHANGE_UNAVAILABLE');
  }
  return { operationId: input.operationId, sessionFingerprint: input.sessionHash,
    updateDigest: input.updateDigest, documentSequence: Number(sequence) };
}

async function persisted(client: PoolClient, input: FrozenReceiptQuery, scope: StoredSession): Promise<DocumentExchangeReceipt | null> {
  const row = (await client.query<StoredReceipt>(`SELECT update_digest, document_sequence
    FROM wujie_document_update_receipts
    WHERE session_hash=$1 AND operation_id=$2 AND actor_id=$3 AND project_id=$4
      AND owner_id=$5 AND grant_generation=$6`,
  [input.sessionHash, input.operationId, input.actorId, input.projectId, scope.owner_id, scope.grant_generation])).rows[0];
  if (!row) return null;
  if (row.update_digest !== input.updateDigest) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_CONFLICT');
  return receipt(input, row.document_sequence);
}

async function begin(client: PoolClient): Promise<void> {
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await client.query("SET LOCAL lock_timeout = '1000ms'");
  await client.query("SET LOCAL statement_timeout = '5000ms'");
}

async function readOwned(input: FrozenReceiptQuery): Promise<DocumentExchangeReceipt | null> {
  const client = await connect();
  let discard = false;
  try {
    await begin(client);
    const scope = await authorizeDocumentExchangeSessionInTransaction(client, input, 'retained', 'read');
    const result = await persisted(client, input, scope);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw classified(error);
  } finally { client.release(discard); }
}

/** The canonical update and its exact receipt share one owned transaction. */
export async function executeDocumentExchangeUpdate(raw: DocumentExchangeUpdateInput): Promise<DocumentExchangeReceipt> {
  const input = normalize(raw);
  const client = await connect();
  let committing = false;
  let released = false;
  let discard = false;
  try {
    await begin(client);
    const scope = await authorizeDocumentExchangeSessionInTransaction(client, input);
    let result = await persisted(client, input, scope);
    if (!result) {
      const loaded = await loadDocumentInTransaction(client, input.projectId);
      try {
        try { assertDocumentExchangeMetadataUpdate(loaded.doc, input.bytes); }
        catch (error) {
          if (error instanceof DocumentExchangeDependencyPendingError) {
            throw new DocumentExchangeError('DOCUMENT_EXCHANGE_DEPENDENCY_PENDING', error);
          }
          throw new DocumentExchangeError('DOCUMENT_EXCHANGE_REJECTED', error);
        }
      } finally { loaded.doc.destroy(); }
      const canonical = await commitDocumentUpdateInTransaction(client, {
        actorId: input.actorId, projectId: input.projectId, expectedGrantGeneration: scope.grant_generation, bytes: input.bytes,
      });
      result = receipt(input, canonical.sequence);
      await client.query(`INSERT INTO wujie_document_update_receipts
        (session_hash, operation_id, actor_id, project_id, owner_id, grant_generation, update_digest, document_sequence)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [input.sessionHash, input.operationId, input.actorId, input.projectId, scope.owner_id,
        scope.grant_generation, input.updateDigest, String(result.documentSequence)]);
    }
    getDocumentExecutionScope()?.bindCommit(client, { kind: 'update', expected: result });
    committing = true;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (committing) {
      client.release(true); released = true;
      try {
        const confirmed = await readOwned(input);
        if (confirmed) {
          getDocumentExecutionScope()?.confirmCommitRecovery(client, confirmed);
          return confirmed;
        }
      } catch (recoveryError) {
        const resolved = classified(recoveryError);
        if (resolved.code === 'DOCUMENT_EXCHANGE_FORBIDDEN') {
          throw new DocumentExchangeError('DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN', recoveryError);
        }
        if (resolved.code === 'DOCUMENT_EXCHANGE_CONFLICT') throw resolved;
        throw new DocumentExchangeError('DOCUMENT_EXCHANGE_UNCERTAIN', recoveryError);
      }
      throw new DocumentExchangeError('DOCUMENT_EXCHANGE_UNCERTAIN', error);
    }
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw classified(error);
  } finally { if (!released) client.release(discard); }
}

/** Exact authorized lookup, never a current-document-tip or state-vector guess. */
export async function readDocumentExchangeReceipt(raw: DocumentExchangeUpdateInput): Promise<DocumentExchangeReceipt | null> {
  return readOwned(normalize(raw));
}

/** Recovery of an orphan journal: exact lookup only, never reconstruction or replay. */
export async function readDocumentExchangeReceiptByDigest(raw: DocumentExchangeReceiptQuery): Promise<DocumentExchangeReceipt | null> {
  return readOwned(normalizeReceiptQuery(raw));
}
