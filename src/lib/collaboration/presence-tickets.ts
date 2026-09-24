import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { getPool } from '@/lib/db-client';

import { assertPresenceMember, PresenceMemberError } from './presence-members';

const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

function hashTicket(rawTicket: string): string {
  return createHash('sha256').update(rawTicket).digest('hex');
}

export async function issuePresenceTicket(userId: string, projectId: string): Promise<string> {
  await assertPresenceMember(userId, projectId);
  const rawTicket = randomBytes(32).toString('base64url');
  await getPool().query(
    `INSERT INTO wujie_presence_tickets
       (token_hash, user_id, project_id, expires_at)
     VALUES ($1, $2, $3, now() + interval '30 seconds')`,
    [hashTicket(rawTicket), userId, projectId],
  );
  return rawTicket;
}

export async function consumePresenceTicket(
  rawTicket: string,
): Promise<{ userId: string; projectId: string } | null> {
  if (!TICKET_PATTERN.test(rawTicket)) return null;
  const tokenHash = hashTicket(rawTicket);
  const client = await getPool().connect();
  let result: { rows: Array<{ user_id: string; project_id: string }> };
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT token_hash FROM wujie_presence_tickets WHERE token_hash = $1 FOR UPDATE',
      [tokenHash],
    );
    result = await client.query<{ user_id: string; project_id: string }>(
      `WITH sampled AS MATERIALIZED (SELECT clock_timestamp() AS consumed_at_value)
       UPDATE wujie_presence_tickets
          SET consumed_at = sampled.consumed_at_value
         FROM sampled
        WHERE token_hash = $1
          AND consumed_at IS NULL
          AND expires_at > sampled.consumed_at_value
        RETURNING user_id, project_id`,
      [tokenHash],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const row = result.rows[0];
  if (!row) return null;
  try {
    await assertPresenceMember(row.user_id, row.project_id);
  } catch (error) {
    if (error instanceof PresenceMemberError) return null;
    throw error;
  }
  return { userId: row.user_id, projectId: row.project_id };
}

export async function pruneExpiredPresenceTickets(batchSize = 500): Promise<number> {
  const limit = Number.isFinite(batchSize) ? Math.max(1, Math.min(500, Math.floor(batchSize))) : 500;
  const result = await getPool().query(
    `WITH expired AS MATERIALIZED (
       SELECT token_hash FROM wujie_presence_tickets
        WHERE expires_at < clock_timestamp() - interval '5 minutes'
        ORDER BY expires_at, token_hash
        LIMIT $1
     )
     DELETE FROM wujie_presence_tickets ticket
      USING expired
      WHERE ticket.token_hash = expired.token_hash`,
    [limit],
  );
  return result.rowCount ?? 0;
}
