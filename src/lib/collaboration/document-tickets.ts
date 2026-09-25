import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { getPool } from '@/lib/db-client';

import { assertDocumentEditor, DocumentAccessError } from './document-access';

const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_OUTSTANDING_TICKETS = 4;

export class DocumentTicketLimitError extends Error {
  readonly code = 'DOCUMENT_TICKET_LIMIT';

  constructor() {
    super('文档连接票据请求过于频繁');
    this.name = 'DocumentTicketLimitError';
  }
}

export interface DocumentTicketIdentity {
  userId: string;
  projectId: string;
  ownerId: string;
  grantGeneration: string;
}

interface TicketRow {
  user_id: string;
  project_id: string;
  owner_id: string;
  grant_generation: string;
}

function hashTicket(rawTicket: string): string {
  return createHash('sha256').update(rawTicket).digest('hex');
}

export async function issueDocumentTicket(userId: string, projectId: string): Promise<string> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `wujie-document-ticket:${JSON.stringify([userId, projectId])}`,
    ]);
    await client.query(
      `DELETE FROM wujie_document_tickets
        WHERE user_id = $1 AND project_id = $2 AND expires_at <= clock_timestamp()`,
      [userId, projectId],
    );
    const { ownerId } = await assertDocumentEditor(userId, projectId, client);
    const active = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM wujie_document_tickets
        WHERE user_id = $1 AND project_id = $2
          AND consumed_at IS NULL AND expires_at > clock_timestamp()`,
      [userId, projectId],
    );
    if ((active.rows[0]?.count ?? 0) >= MAX_OUTSTANDING_TICKETS) {
      throw new DocumentTicketLimitError();
    }
    let grantGeneration = '0';
    if (userId !== ownerId) {
      const editor = await client.query<{ grant_generation: string }>(
        `SELECT grant_generation FROM wujie_project_document_editors
          WHERE project_id = $1 AND owner_id = $2
            AND member_user_id = $3 AND status = 'active'
          FOR SHARE`,
        [projectId, ownerId, userId],
      );
      if (!editor.rows[0]) throw new DocumentAccessError();
      grantGeneration = editor.rows[0].grant_generation;
    }
    const rawTicket = randomBytes(32).toString('base64url');
    await client.query(
      `WITH sampled AS MATERIALIZED (SELECT clock_timestamp() AS issued_at)
       INSERT INTO wujie_document_tickets
         (token_hash, user_id, project_id, owner_id,
          grant_generation, created_at, expires_at)
       SELECT $1, $2, $3, $4, $5, sampled.issued_at,
              sampled.issued_at + interval '30 seconds'
         FROM sampled`,
      [hashTicket(rawTicket), userId, projectId, ownerId, grantGeneration],
    );
    await client.query('COMMIT');
    return rawTicket;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function consumeDocumentTicket(rawTicket: string): Promise<DocumentTicketIdentity | null> {
  if (!TICKET_PATTERN.test(rawTicket)) return null;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const ticket = await client.query<TicketRow>(
      `SELECT user_id, project_id, owner_id, grant_generation
         FROM wujie_document_tickets
        WHERE token_hash = $1 AND consumed_at IS NULL
        FOR UPDATE`,
      [hashTicket(rawTicket)],
    );
    const row = ticket.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return null;
    }
    let currentOwnerId: string;
    try {
      ({ ownerId: currentOwnerId } = await assertDocumentEditor(row.user_id, row.project_id, client));
    } catch (error) {
      if (!(error instanceof DocumentAccessError)) throw error;
      await client.query('COMMIT');
      return null;
    }
    if (currentOwnerId !== row.owner_id) {
      await client.query('COMMIT');
      return null;
    }
    if (row.user_id === row.owner_id) {
      if (row.grant_generation !== '0') {
        await client.query('COMMIT');
        return null;
      }
    } else {
      const editor = await client.query<{ grant_generation: string }>(
        `SELECT grant_generation FROM wujie_project_document_editors
          WHERE project_id = $1 AND owner_id = $2
            AND member_user_id = $3 AND status = 'active'
          FOR SHARE`,
        [row.project_id, row.owner_id, row.user_id],
      );
      if (editor.rows[0]?.grant_generation !== row.grant_generation) {
        await client.query('COMMIT');
        return null;
      }
    }
    const consumed = await client.query(
      `DELETE FROM wujie_document_tickets
        WHERE token_hash = $1 AND consumed_at IS NULL
          AND expires_at > clock_timestamp()`,
      [hashTicket(rawTicket)],
    );
    await client.query('COMMIT');
    if (consumed.rowCount !== 1) return null;
    return {
      userId: row.user_id, projectId: row.project_id,
      ownerId: row.owner_id, grantGeneration: row.grant_generation,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function pruneExpiredDocumentTickets(batchSize = 500): Promise<number> {
  const limit = Number.isFinite(batchSize) ? Math.max(1, Math.min(500, Math.floor(batchSize))) : 500;
  const result = await getPool().query(
    `WITH expired AS MATERIALIZED (
       SELECT token_hash FROM wujie_document_tickets
        WHERE expires_at < clock_timestamp() - interval '5 minutes'
        ORDER BY expires_at, token_hash
        LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     DELETE FROM wujie_document_tickets ticket
      USING expired WHERE ticket.token_hash = expired.token_hash`,
    [limit],
  );
  return result.rowCount ?? 0;
}

export function startDocumentTicketMaintenance(intervalMs = 15_000): () => Promise<void> {
  let pending: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (pending) return;
    pending = pruneExpiredDocumentTickets().then(() => undefined).catch(() => {
      // The next cycle retries after a transient database failure.
    }).finally(() => { pending = null; });
  }, Number.isFinite(intervalMs) ? Math.max(50, intervalMs) : 15_000);
  timer.unref?.();
  return async (): Promise<void> => {
    clearInterval(timer);
    await pending;
  };
}
