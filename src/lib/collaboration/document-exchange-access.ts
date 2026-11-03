import 'server-only';
import type { PoolClient } from 'pg';
import { lockAssetGraphWriteGate } from '@/lib/asset-core/storage';
import { assertDocumentEditor, assertDocumentProjectEnabled } from './document-access';

type ExchangeErrorCode = 'DOCUMENT_EXCHANGE_INVALID' | 'DOCUMENT_EXCHANGE_FORBIDDEN'
  | 'DOCUMENT_EXCHANGE_CONFLICT' | 'DOCUMENT_EXCHANGE_REJECTED'
  | 'DOCUMENT_EXCHANGE_UNAVAILABLE' | 'DOCUMENT_EXCHANGE_UNCERTAIN' | 'DOCUMENT_EXCHANGE_BUSY'
  | 'DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN' | 'DOCUMENT_EXCHANGE_DEPENDENCY_PENDING'
  | 'DOCUMENT_EXCHANGE_SESSION_LIMIT' | 'DOCUMENT_EXCHANGE_TICKET_INVALID' | 'DOCUMENT_EXCHANGE_EXPIRED'
  | 'DOCUMENT_EXCHANGE_REQUEST_TIMEOUT' | 'DOCUMENT_EXCHANGE_REQUEST_CANCELLED' | 'DOCUMENT_EXCHANGE_TOO_LARGE';
export class DocumentExchangeError extends Error {
  constructor(readonly code: ExchangeErrorCode, cause?: unknown) { super(code, { cause }); }
}
export interface DocumentExchangeSessionLookup { actorId: string; projectId: string; authSessionHash: string; sessionHash: string }
export interface StoredDocumentExchangeSession {
  session_hash: string; actor_id: string; auth_session_hash: string; owner_id: string;
  project_id: string; grant_generation: string; active: boolean;
}

/** Shared transaction boundary. Callers authenticate the actual cookie before constructing input. */
export async function authorizeDocumentExchangeSessionInTransaction(
  client: PoolClient, input: DocumentExchangeSessionLookup, validity: 'active' | 'retained' = 'active',
  projectLock: 'read' | 'write' = 'write',
): Promise<StoredDocumentExchangeSession> {
  const clockColumn = validity === 'retained' ? 'retain_until' : 'expires_at';
  const readSession = async (locked: boolean): Promise<StoredDocumentExchangeSession> => {
    const result = await client.query<StoredDocumentExchangeSession>(`SELECT session_hash, actor_id, auth_session_hash,
      owner_id, project_id, grant_generation::text,
      (revoked_at IS NULL AND ${clockColumn} > clock_timestamp()) AS active
      FROM wujie_document_exchange_sessions
      WHERE session_hash=$1 AND actor_id=$2 AND project_id=$3 AND auth_session_hash=$4${locked ? ' FOR SHARE' : ''}`,
    [input.sessionHash, input.actorId, input.projectId, input.authSessionHash]);
    const row = result.rows[0];
    if (!row || row.session_hash !== input.sessionHash || row.actor_id !== input.actorId
      || row.project_id !== input.projectId || row.auth_session_hash !== input.authSessionHash || row.active !== true) {
      throw new DocumentExchangeError('DOCUMENT_EXCHANGE_FORBIDDEN');
    }
    if (typeof row.owner_id !== 'string' || !row.owner_id || row.owner_id.length > 256 || row.owner_id !== row.owner_id.trim()
      || /[\u0000-\u001f\u007f]/u.test(row.owner_id) || typeof row.grant_generation !== 'string'
      || !/^(?:0|[1-9]\d{0,18})$/u.test(row.grant_generation)
      || BigInt(row.grant_generation) > BigInt('9223372036854775807')) {
      throw new DocumentExchangeError('DOCUMENT_EXCHANGE_UNAVAILABLE');
    }
    return row;
  };
  const first = await readSession(false);
  await lockAssetGraphWriteGate(client, 'shared');
  // Callers own a 1s lock_timeout: ordinary concurrent edits may wait briefly.
  const project = await client.query(`SELECT 1 FROM wujie_projects WHERE id=$1 FOR ${projectLock === 'read' ? 'SHARE' : 'UPDATE'}`, [input.projectId]);
  if (project.rowCount !== 1) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_FORBIDDEN');
  const session = await readSession(true);
  if (first.owner_id !== session.owner_id || first.grant_generation !== session.grant_generation) {
    throw new DocumentExchangeError('DOCUMENT_EXCHANGE_FORBIDDEN');
  }
  const current = await assertDocumentEditor(input.actorId, input.projectId, client, session.grant_generation);
  if (current.ownerId !== session.owner_id) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_FORBIDDEN');
  await assertDocumentProjectEnabled(client, current.ownerId, input.projectId);
  const document = await client.query<{ owner_id: string }>(`SELECT owner_id FROM wujie_project_canvas_documents
    WHERE project_id=$1 AND owner_id=$2 FOR SHARE`, [input.projectId, session.owner_id]);
  if (document.rows[0]?.owner_id !== session.owner_id) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_FORBIDDEN');
  const admitted = await client.query<{ active: boolean }>(`SELECT (revoked_at IS NULL
    AND ${clockColumn} > clock_timestamp()) AS active FROM wujie_document_exchange_sessions
    WHERE session_hash=$1`, [input.sessionHash]);
  if (admitted.rows[0]?.active !== true) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_FORBIDDEN');
  return session;
}
