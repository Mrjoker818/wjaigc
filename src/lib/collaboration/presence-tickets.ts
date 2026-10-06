import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { getPool } from '@/lib/db-client';

import { assertPresenceMember, PresenceMemberError } from './presence-members';
import { withPresenceConnection } from './presence-connection';

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
  isAbandoned: () => boolean = () => false,
  signal?: AbortSignal,
): Promise<{ userId: string; projectId: string } | null> {
  if (!TICKET_PATTERN.test(rawTicket)) return null;
  const tokenHash = hashTicket(rawTicket);
  const result = await withPresenceConnection(signal, async client => {
    try {
    await client.query('BEGIN');
    await client.query(
      'SELECT token_hash FROM wujie_presence_tickets WHERE token_hash = $1 FOR UPDATE',
      [tokenHash],
    );
    const consumed = await client.query<{ user_id: string; project_id: string }>(
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
    return consumed;
    } catch (error) {
      // Aborting already retires this checkout, including its transaction.
      if (!signal?.aborted) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });
  const row = result.rows[0];
  // Abandonment only denies the upgrade; it never bypasses live authorization.
  if (!row || isAbandoned()) return null;
  try {
    await assertPresenceMember(row.user_id, row.project_id, signal);
  } catch (error) {
    if (error instanceof PresenceMemberError) return null;
    throw error;
  }
  return { userId: row.user_id, projectId: row.project_id };
}

export async function pruneExpiredPresenceTickets(batchSize = 500, signal?: AbortSignal): Promise<number> {
  const limit = Number.isFinite(batchSize) ? Math.max(1, Math.min(500, Math.floor(batchSize))) : 500;
  const text = `WITH expired AS MATERIALIZED (
       SELECT token_hash FROM wujie_presence_tickets
        WHERE expires_at < clock_timestamp() - interval '5 minutes'
        ORDER BY expires_at, token_hash
        LIMIT $1
     )
     DELETE FROM wujie_presence_tickets ticket
      USING expired
      WHERE ticket.token_hash = expired.token_hash`;
  const result = signal
    ? await withPresenceConnection(signal, client => client.query(text, [limit]))
    : await getPool().query(text, [limit]);
  return result.rowCount ?? 0;
}
