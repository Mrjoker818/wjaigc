import 'server-only';

import type { PoolClient } from 'pg';

import { getPool } from '@/lib/db-client';
import { assertPresenceMember, assertPresenceMemberForLease, PresenceMemberError } from './presence-members';
import { pruneExpiredPresenceTickets } from './presence-tickets';

const CHANGE_CHANNEL = 'wujie_presence_changed';
type PresenceChangeCallback = () => void | Promise<void>;
const subscriptions = new Map<string, Set<PresenceChangeCallback>>();
let listener: {
  client: PoolClient;
  close: () => void;
} | null = null;
let connecting: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function invokeSubscriber(callback: PresenceChangeCallback): void {
  try {
    const result = callback();
    if (result) void result.catch(() => undefined);
  } catch {
    // One subscriber must not break notification or reconciliation.
  }
}

function announceChange(projectId: string): void {
  for (const callback of subscriptions.get(projectId) ?? []) invokeSubscriber(callback);
}

function scheduleListenerReconnect(): void {
  if (subscriptions.size === 0 || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void ensureListener();
  }, 1_000);
  retryTimer.unref?.();
}

async function ensureListener(): Promise<void> {
  if (listener || subscriptions.size === 0) return;
  if (connecting) return connecting;
  connecting = (async () => {
    let client: PoolClient;
    try {
      client = await getPool().connect();
    } catch {
      scheduleListenerReconnect();
      return;
    }
    let closed = false;
    const onNotification = (message: { channel: string; payload?: string }): void => {
      if (message.channel === CHANGE_CHANNEL && message.payload) announceChange(message.payload);
    };
    const close = (): void => {
      if (closed) return;
      closed = true;
      client.removeListener('notification', onNotification);
      client.removeListener('error', onDisconnect);
      client.removeListener('end', onDisconnect);
      if (listener?.client === client) listener = null;
      client.release(true);
    };
    const onDisconnect = (): void => {
      close();
      scheduleListenerReconnect();
    };
    client.on('notification', onNotification);
    client.once('error', onDisconnect);
    client.once('end', onDisconnect);
    try {
      await client.query(`LISTEN ${CHANGE_CHANNEL}`);
      if (subscriptions.size === 0) close();
      else listener = { client, close };
    } catch {
      close();
      scheduleListenerReconnect();
    }
  })().finally(() => { connecting = null; });
  return connecting;
}

export async function subscribePresence(
  projectId: string,
  onChange: PresenceChangeCallback,
  reconcileIntervalMs = 15_000,
): Promise<() => Promise<void>> {
  const callbacks = subscriptions.get(projectId) ?? new Set<PresenceChangeCallback>();
  callbacks.add(onChange);
  subscriptions.set(projectId, callbacks);
  const reconcileTimer = setInterval(() => invokeSubscriber(onChange), Math.max(50, reconcileIntervalMs));
  reconcileTimer.unref?.();
  await ensureListener();
  return async () => {
    clearInterval(reconcileTimer);
    callbacks.delete(onChange);
    if (callbacks.size === 0) subscriptions.delete(projectId);
    if (subscriptions.size === 0) {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      listener?.close();
    }
  };
}

export interface PresenceSnapshot {
  projectId: string;
  sequence: number;
  participants: Array<{
    userId: string;
    displayName: string;
    lastSeenAt: string;
  }>;
}

export interface PresenceJoinInput {
  connectionId: string;
  userId: string;
  projectId: string;
  instanceId: string;
}

async function bumpSequence(client: PoolClient, projectId: string): Promise<void> {
  await client.query(
    `INSERT INTO wujie_presence_project_sequences (project_id, sequence)
     VALUES ($1, 1)
     ON CONFLICT (project_id) DO UPDATE
       SET sequence = wujie_presence_project_sequences.sequence + 1`,
    [projectId],
  );
  await client.query('SELECT pg_notify($1, $2)', [CHANGE_CHANNEL, projectId]);
}

export async function readPresenceSnapshot(projectId: string): Promise<PresenceSnapshot> {
  const result = await getPool().query<{
    sequence: string;
    participants: PresenceSnapshot['participants'];
  }>(
    `SELECT COALESCE((
       SELECT sequence FROM wujie_presence_project_sequences WHERE project_id = $1
     ), 0)::text AS sequence,
     COALESCE((
       SELECT json_agg(person ORDER BY person."displayName", person."userId")
         FROM (
           SELECT actor.id AS "userId", actor.name AS "displayName",
                  MAX(lease.last_seen_at) AS "lastSeenAt"
             FROM wujie_presence_leases lease
             JOIN wujie_projects project ON project.id = lease.project_id
             JOIN wujie_users actor ON actor.id = lease.user_id
             JOIN wujie_users owner_user ON owner_user.id = project.owner_id
            WHERE lease.project_id = $1 AND lease.expires_at > clock_timestamp()
              AND project.status = 'active' AND actor.status = 'active'
              AND owner_user.status = 'active'
              AND (
                actor.id = project.owner_id OR EXISTS (
                  SELECT 1 FROM wujie_project_presence_members member
                   WHERE member.project_id = project.id AND member.owner_id = project.owner_id
                     AND member.member_user_id = actor.id AND member.status = 'active'
                )
              )
            GROUP BY actor.id, actor.name
         ) person
     ), '[]'::json) AS participants`,
    [projectId],
  );
  return {
    projectId,
    sequence: Number(result.rows[0]?.sequence ?? 0),
    participants: result.rows[0]?.participants ?? [],
  };
}

export async function joinPresence(input: PresenceJoinInput): Promise<PresenceSnapshot> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await assertPresenceMemberForLease(client, input.userId, input.projectId);
    await client.query(
      `WITH sampled AS MATERIALIZED (SELECT clock_timestamp() AS joined_at)
       INSERT INTO wujie_presence_leases
         (connection_id, project_id, user_id, instance_id, created_at, last_seen_at, expires_at)
       SELECT $1, $2, $3, $4, joined_at, joined_at, joined_at + interval '45 seconds'
         FROM sampled`,
      [input.connectionId, input.projectId, input.userId, input.instanceId],
    );
    await bumpSequence(client, input.projectId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return readPresenceSnapshot(input.projectId);
}

export async function leavePresence(connectionId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const deleted = await client.query<{ project_id: string }>(
      'DELETE FROM wujie_presence_leases WHERE connection_id = $1 RETURNING project_id',
      [connectionId],
    );
    if (deleted.rows[0]) await bumpSequence(client, deleted.rows[0].project_id);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function renewPresence(connectionId: string): Promise<boolean> {
  const current = await getPool().query<{ project_id: string; user_id: string }>(
    'SELECT project_id, user_id FROM wujie_presence_leases WHERE connection_id = $1',
    [connectionId],
  );
  const lease = current.rows[0];
  if (!lease) return false;
  try {
    await assertPresenceMember(lease.user_id, lease.project_id);
  } catch (error) {
    if (!(error instanceof PresenceMemberError)) throw error;
    await leavePresence(connectionId);
    return false;
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const renewed = await client.query<{ project_id: string }>(
      `WITH sampled AS MATERIALIZED (SELECT clock_timestamp() AS renewed_at)
       UPDATE wujie_presence_leases
          SET last_seen_at = sampled.renewed_at,
              expires_at = sampled.renewed_at + interval '45 seconds'
         FROM sampled
        WHERE connection_id = $1 AND expires_at > sampled.renewed_at
        RETURNING project_id`,
      [connectionId],
    );
    if (renewed.rows[0]) await bumpSequence(client, renewed.rows[0].project_id);
    await client.query('COMMIT');
    return Boolean(renewed.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function expirePresenceLeases(batchSize = 500): Promise<number> {
  const limit = Number.isFinite(batchSize) ? Math.max(1, Math.min(500, Math.floor(batchSize))) : 500;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const expired = await client.query<{ project_id: string }>(
      `WITH stale AS MATERIALIZED (
         SELECT connection_id FROM wujie_presence_leases
          WHERE expires_at <= clock_timestamp()
          ORDER BY expires_at, connection_id
          LIMIT $1 FOR UPDATE SKIP LOCKED
       )
       DELETE FROM wujie_presence_leases lease
        USING stale
        WHERE lease.connection_id = stale.connection_id
        RETURNING lease.project_id`,
      [limit],
    );
    for (const projectId of new Set(expired.rows.map(row => row.project_id))) {
      await bumpSequence(client, projectId);
    }
    await client.query('COMMIT');
    return expired.rowCount ?? 0;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function startPresenceMaintenance(intervalMs = 15_000): () => Promise<void> {
  let pending: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (pending) return;
    pending = (async () => {
      try {
        await expirePresenceLeases();
        await pruneExpiredPresenceTickets();
      } finally {
        pending = null;
      }
    })().catch(() => {
      // A later cycle retries after a transient database failure.
    });
  }, Number.isFinite(intervalMs) ? Math.max(50, intervalMs) : 15_000);
  timer.unref?.();
  return async () => {
    clearInterval(timer);
    await pending;
  };
}
