import 'server-only';
import { getDocumentExecutionScope } from './document-execution-scope';
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { lockAssetGraphWriteGate } from '@/lib/asset-core/storage';
import { assertDocumentEditor, assertDocumentProjectEnabled } from './document-access';
import { consumeDocumentTicket } from './document-tickets';
import { authorizeDocumentExchangeSessionInTransaction, DocumentExchangeError } from './document-exchange-access';
import type { DocumentExchangeSessionDescriptor } from './document-exchange-session-protocol';

export interface DocumentExchangeSessionIdentity { actorId: string; authSessionHash: string; projectId: string }
export interface StartDocumentExchangeSessionInput extends DocumentExchangeSessionIdentity { ticket: string }
export interface RenewDocumentExchangeSessionInput extends DocumentExchangeSessionIdentity { sessionToken: string }

interface SessionRow {
  session_hash: string; actor_id: string; owner_id: string; project_id: string; grant_generation: string;
  auth_session_hash: string; expires_at: Date | string; retain_until: Date | string; active?: boolean;
}
interface SessionLookup extends DocumentExchangeSessionIdentity { sessionHash: string }
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 256 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
function identity(raw: DocumentExchangeSessionIdentity): DocumentExchangeSessionIdentity {
  if (!raw || !id(raw.actorId) || !id(raw.projectId) || typeof raw.authSessionHash !== 'string'
    || !/^[0-9a-f]{64}$/u.test(raw.authSessionHash)) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_INVALID');
  return { actorId: raw.actorId, projectId: raw.projectId, authSessionHash: raw.authSessionHash };
}
function opaque(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value); }
function generation(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9]\d{0,18})$/u.test(value) && BigInt(value) <= BigInt('9223372036854775807');
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function failed(error: unknown): DocumentExchangeError {
  if (error instanceof DocumentExchangeError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'DOCUMENT_FORBIDDEN' || code === 'DOCUMENT_PROJECT_NOT_ENABLED' || code === 'DOCUMENT_DISABLED') {
    return new DocumentExchangeError('DOCUMENT_EXCHANGE_FORBIDDEN', error);
  }
  return new DocumentExchangeError(code === '55P03' ? 'DOCUMENT_EXCHANGE_BUSY' : 'DOCUMENT_EXCHANGE_UNAVAILABLE', error);
}
function iso(value: Date | string): string {
  const date = new Date(value instanceof Date ? value.getTime() : value);
  if (!Number.isFinite(date.getTime())) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_UNAVAILABLE');
  return date.toISOString();
}
function descriptor(input: SessionLookup, token: string, row: SessionRow): DocumentExchangeSessionDescriptor {
  if (!row || row.session_hash !== input.sessionHash || row.actor_id !== input.actorId || row.project_id !== input.projectId
    || row.auth_session_hash !== input.authSessionHash || !id(row.owner_id) || !generation(row.grant_generation)) {
    throw new DocumentExchangeError('DOCUMENT_EXCHANGE_UNAVAILABLE');
  }
  const expiresAt = iso(row.expires_at), retainUntil = iso(row.retain_until);
  if (Date.parse(expiresAt) > Date.parse(retainUntil)) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_UNAVAILABLE');
  return { sessionToken: token, sessionFingerprint: input.sessionHash, actorId: input.actorId,
    projectId: input.projectId, ownerId: row.owner_id, grantGeneration: row.grant_generation, expiresAt, retainUntil };
}
async function begin(client: PoolClient): Promise<void> {
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await client.query("SET LOCAL lock_timeout = '1000ms'");
  await client.query("SET LOCAL statement_timeout = '5000ms'");
}
async function acquire(): Promise<PoolClient> {
  try { return await getPool().connect(); } catch (error) { throw failed(error); }
}
async function capacity(client: PoolClient, input: DocumentExchangeSessionIdentity, excludeHash = ''): Promise<void> {
  const count = (await client.query<{ actor_count: number; project_count: number }>(`SELECT
    (COUNT(*) FILTER (WHERE actor_id=$2))::int AS actor_count, COUNT(*)::int AS project_count
    FROM wujie_document_exchange_sessions WHERE project_id=$1 AND revoked_at IS NULL
      AND expires_at > clock_timestamp() AND session_hash<>$3`, [input.projectId, input.actorId, excludeHash])).rows[0];
  if (!count || !Number.isSafeInteger(count.actor_count) || count.actor_count < 0
    || !Number.isSafeInteger(count.project_count) || count.project_count < 0) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_UNAVAILABLE');
  if (count.actor_count >= 4 || count.project_count >= 20) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_SESSION_LIMIT');
}

async function recover(input: SessionLookup, token: string, expected: DocumentExchangeSessionDescriptor): Promise<DocumentExchangeSessionDescriptor | null> {
  const client = await acquire();
  let discard = false;
  try {
    await begin(client);
    const existing = await client.query(`SELECT session_hash FROM wujie_document_exchange_sessions
      WHERE session_hash=$1 AND actor_id=$2 AND project_id=$3 AND auth_session_hash=$4`,
    [input.sessionHash, input.actorId, input.projectId, input.authSessionHash]);
    if (!existing.rowCount) { await client.query('COMMIT'); return null; }
    await authorizeDocumentExchangeSessionInTransaction(client, input, 'retained');
    const row = (await client.query<SessionRow>(`SELECT *, grant_generation::text AS grant_generation,
      (revoked_at IS NULL AND expires_at > clock_timestamp()) AS active
      FROM wujie_document_exchange_sessions WHERE session_hash=$1`, [input.sessionHash])).rows[0];
    if (!row || row.active !== true) { await client.query('COMMIT'); return null; }
    const current = descriptor(input, token, row);
    if (current.ownerId !== expected.ownerId || current.grantGeneration !== expected.grantGeneration
      || current.retainUntil !== expected.retainUntil || Date.parse(current.expiresAt) < Date.parse(expected.expiresAt)) {
      await client.query('COMMIT'); return null;
    }
    await client.query('COMMIT'); return current;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw failed(error);
  } finally { client.release(discard); }
}

async function owned(input: SessionLookup, token: string,
  work: (client: PoolClient) => Promise<DocumentExchangeSessionDescriptor>): Promise<DocumentExchangeSessionDescriptor> {
  const client = await acquire();
  let committing = false, released = false, discard = false;
  let expected: DocumentExchangeSessionDescriptor | undefined;
  try {
    await begin(client); expected = await work(client);
    getDocumentExecutionScope()?.bindCommit(client, { kind: 'session', expected });
    committing = true; await client.query('COMMIT'); return expected;
  } catch (error) {
    if (committing && expected) {
      client.release(true); released = true;
      try {
        const result = await recover(input, token, expected);
        if (result) {
          getDocumentExecutionScope()?.confirmCommitRecovery(client, result);
          return result;
        }
      } catch (recoveryError) {
        const resolved = failed(recoveryError);
        throw new DocumentExchangeError(resolved.code === 'DOCUMENT_EXCHANGE_FORBIDDEN'
          ? 'DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN' : 'DOCUMENT_EXCHANGE_UNCERTAIN', recoveryError);
      }
      throw new DocumentExchangeError('DOCUMENT_EXCHANGE_UNCERTAIN', error);
    }
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw failed(error);
  } finally { if (!released) client.release(discard); }
}

/** Caller supplies identity only after verifying the actual cookie. Ticket identity is read here. */
export async function startDocumentExchangeSession(raw: StartDocumentExchangeSessionInput): Promise<DocumentExchangeSessionDescriptor> {
  const input = identity(raw);
  if (!opaque(raw.ticket)) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_INVALID');
  const ticket = raw.ticket;
  let bound: Awaited<ReturnType<typeof consumeDocumentTicket>>;
  try { bound = await consumeDocumentTicket(ticket); } catch (error) { throw failed(error); }
  if (!bound) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_TICKET_INVALID');
  if (bound.userId !== input.actorId || bound.projectId !== input.projectId) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_FORBIDDEN');
  if (!id(bound.ownerId) || !generation(bound.grantGeneration)
    || (bound.ownerId === input.actorId) !== (bound.grantGeneration === '0')) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_UNAVAILABLE');
  const ownerId = bound.ownerId, grantGeneration = bound.grantGeneration;
  const token = randomBytes(32).toString('base64url');
  const lookup = { ...input, sessionHash: hash(token) };
  return owned(lookup, token, async client => {
    await lockAssetGraphWriteGate(client, 'shared');
    const project = await client.query('SELECT 1 FROM wujie_projects WHERE id=$1 FOR UPDATE', [input.projectId]);
    if (project.rowCount !== 1) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_FORBIDDEN');
    const current = await assertDocumentEditor(input.actorId, input.projectId, client, grantGeneration);
    if (current.ownerId !== ownerId) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_FORBIDDEN');
    await assertDocumentProjectEnabled(client, ownerId, input.projectId);
    const document = await client.query<{ owner_id: string }>(`SELECT owner_id FROM wujie_project_canvas_documents
      WHERE project_id=$1 AND owner_id=$2 FOR SHARE`, [input.projectId, ownerId]);
    if (document.rows[0]?.owner_id !== ownerId) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_FORBIDDEN');
    await capacity(client, input);
    const row = (await client.query<SessionRow>(`WITH sampled AS MATERIALIZED (SELECT clock_timestamp() AS now)
      INSERT INTO wujie_document_exchange_sessions
        (session_hash,actor_id,auth_session_hash,project_id,owner_id,grant_generation,created_at,expires_at,retain_until)
      SELECT $1,$2,$3,$4,$5,$6,sampled.now,sampled.now+interval '600 seconds',sampled.now+interval '604800 seconds'
      FROM sampled RETURNING *, grant_generation::text AS grant_generation`,
    [lookup.sessionHash, input.actorId, input.authSessionHash, input.projectId, ownerId, grantGeneration])).rows[0];
    return descriptor(lookup, token, row);
  });
}

export async function renewDocumentExchangeSession(raw: RenewDocumentExchangeSessionInput): Promise<DocumentExchangeSessionDescriptor> {
  const input = identity(raw);
  if (!opaque(raw.sessionToken)) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_INVALID');
  const token = raw.sessionToken, lookup = { ...input, sessionHash: hash(token) };
  return owned(lookup, token, async client => {
    const bound = await authorizeDocumentExchangeSessionInTransaction(client, lookup, 'retained');
    await capacity(client, input, lookup.sessionHash);
    const row = (await client.query<SessionRow>(`UPDATE wujie_document_exchange_sessions
      SET expires_at=LEAST(clock_timestamp()+interval '600 seconds',retain_until)
      WHERE session_hash=$1 AND revoked_at IS NULL AND retain_until > clock_timestamp()
      RETURNING *, grant_generation::text AS grant_generation`, [lookup.sessionHash])).rows[0];
    if (!row) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_EXPIRED');
    const result = descriptor(lookup, token, row);
    if (result.ownerId !== bound.owner_id || result.grantGeneration !== bound.grant_generation) {
      throw new DocumentExchangeError('DOCUMENT_EXCHANGE_FORBIDDEN');
    }
    return result;
  });
}
