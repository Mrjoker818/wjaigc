import 'server-only';

import type { PoolClient } from 'pg';

import { getPool } from '@/lib/db-client';
import {
  assertPresenceMember,
  assertPresenceMemberForLease,
  legacyPresenceProjectPredicate,
  PresenceMemberError,
} from './presence-members';
import { pruneExpiredPresenceTickets } from './presence-tickets';
import { PresenceConnectionCleanupError, withPresenceConnection } from './presence-connection';
import { createPresenceListenerOwner } from './presence-listener';

const CHANGE_CHANNEL = 'wujie_presence_changed';
type PresenceChangeCallback = () => void | Promise<void>;
const subscriptions = new Map<string, Set<PresenceChangeCallback>>();

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

const listenerOwner = createPresenceListenerOwner(announceChange);

export async function subscribePresence(
  projectId: string,
  onChange: PresenceChangeCallback,
  reconcileIntervalMs = 15_000,
  signal?: AbortSignal,
): Promise<() => Promise<void>> {
  signal?.throwIfAborted();
  const callbacks = subscriptions.get(projectId) ?? new Set<PresenceChangeCallback>();
  callbacks.add(onChange);
  subscriptions.set(projectId, callbacks);
  const reconcileTimer = setInterval(() => invokeSubscriber(onChange), Math.max(50, reconcileIntervalMs));
  reconcileTimer.unref?.();
  const token = listenerOwner.retain(signal);
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    signal?.removeEventListener('abort', onAbort);
    clearInterval(reconcileTimer);
    callbacks.delete(onChange);
    if (callbacks.size === 0) subscriptions.delete(projectId);
    closing = token.close();
    void closing.catch(() => undefined);
    return closing;
  };
  const onAbort = (): void => { void close().catch(() => undefined); };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try { await token.ready; signal?.throwIfAborted(); return close; }
  catch (error) {
    try { await close(); }
    catch (cleanupError) {
      if (cleanupError === error) throw error;
      throw new AggregateError([error, cleanupError], 'Presence subscription initialization and cleanup failed');
    }
    throw error;
  }
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
  maxConnectionsPerUserProject?: number;
}

export class PresenceConnectionLimitError extends Error {
  constructor() {
    super('Too many active project presence connections');
    this.name = 'PresenceConnectionLimitError';
  }
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

export async function readPresenceSnapshot(projectId: string, signal?: AbortSignal): Promise<PresenceSnapshot> {
  interface SnapshotRow {
    sequence: string;
    participants: PresenceSnapshot['participants'];
  }
  const text = `SELECT COALESCE((
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
              ${legacyPresenceProjectPredicate('project')}
              AND (
                actor.id = project.owner_id OR EXISTS (
                  SELECT 1 FROM wujie_project_presence_members member
                   WHERE member.project_id = project.id AND member.owner_id = project.owner_id
                     AND member.member_user_id = actor.id AND member.status = 'active'
                )
              )
            GROUP BY actor.id, actor.name
         ) person
     ), '[]'::json) AS participants`;
  // Initial join still owns its committed lease until this snapshot returns.
  // Keep the ordinary pool query API for callers without a cancellation owner.
  const result = signal
    ? await withPresenceConnection(signal, client => client.query<SnapshotRow>(text, [projectId]))
    : await getPool().query<SnapshotRow>(text, [projectId]);
  return {
    projectId,
    sequence: Number(result.rows[0]?.sequence ?? 0),
    participants: result.rows[0]?.participants ?? [],
  };
}

async function compensateCommittedJoin(connectionId: string, cause: unknown): Promise<void> {
  // The failed join may already be cancelled. Its committed lease needs a
  // fresh cancellation owner, including retirement of the actual checkout.
  // This bounds compensation SQL, not native acquisition or total shutdown.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(
    new Error(`Presence committed lease compensation deadline exceeded (${connectionId})`),
  ), 5_000);
  deadline.unref();
  try { await leavePresence(connectionId, controller.signal); }
  catch (compensationError) {
    throw new PresenceConnectionCleanupError(new AggregateError([cause, compensationError],
      `Presence committed lease compensation failed (${connectionId})`));
  } finally { clearTimeout(deadline); }
}

export async function joinPresence(input: PresenceJoinInput, signal?: AbortSignal): Promise<PresenceSnapshot> {
  const maxConnections = Number.isFinite(input.maxConnectionsPerUserProject)
    ? Math.max(1, Math.floor(input.maxConnectionsPerUserProject!)) : 10;
  let commitAttempted = false;
  try {
    await withPresenceConnection(signal, async client => {
      try {
        await client.query('BEGIN');
        await assertPresenceMemberForLease(client, input.userId, input.projectId);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
          input.projectId, input.userId,
        ]);
        const active = await client.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM wujie_presence_leases
            WHERE project_id = $1 AND user_id = $2 AND expires_at > clock_timestamp()`,
          [input.projectId, input.userId],
        );
        if (active.rows[0].count >= maxConnections) throw new PresenceConnectionLimitError();
        await client.query(
          `WITH sampled AS MATERIALIZED (SELECT clock_timestamp() AS joined_at)
           INSERT INTO wujie_presence_leases
             (connection_id, project_id, user_id, instance_id, created_at, last_seen_at, expires_at)
           SELECT $1, $2, $3, $4, joined_at, joined_at, joined_at + interval '45 seconds'
             FROM sampled`,
          [input.connectionId, input.projectId, input.userId, input.instanceId],
        );
        await bumpSequence(client, input.projectId);
        // Once COMMIT is sent, a lost acknowledgement does not prove rollback.
        // Keep ownership until join returns, even when its result is unknown.
        commitAttempted = true;
        await client.query('COMMIT');
      } catch (error) {
        // Cancellation owns and retires this exact checkout and its transaction.
        if (!signal?.aborted) await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  } catch (error) {
    // The gateway has not received the join result yet. Compensate the exact
    // possibly committed lease; a rolled-back COMMIT makes this a no-op.
    // Failures before COMMIT (including duplicate ids) do not own a prior lease.
    if (commitAttempted) await compensateCommittedJoin(input.connectionId, error);
    throw error;
  }
  try {
    return await readPresenceSnapshot(input.projectId, signal);
  } catch (error) {
    await compensateCommittedJoin(input.connectionId, error);
    throw error;
  }
}

export async function leavePresence(connectionId: string, signal?: AbortSignal): Promise<void> {
  await withPresenceConnection(signal, async client => {
    try {
      await client.query('BEGIN');
      const deleted = await client.query<{ project_id: string }>(
        'DELETE FROM wujie_presence_leases WHERE connection_id = $1 RETURNING project_id',
        [connectionId],
      );
      if (deleted.rows[0]) await bumpSequence(client, deleted.rows[0].project_id);
      await client.query('COMMIT');
    } catch (error) {
      if (!signal?.aborted) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });
}

export async function renewPresence(connectionId: string, signal?: AbortSignal): Promise<boolean> {
  const text = 'SELECT project_id, user_id FROM wujie_presence_leases WHERE connection_id = $1';
  const current = signal
    ? await withPresenceConnection(signal, client => client.query<{ project_id: string; user_id: string }>(text, [connectionId]))
    : await getPool().query<{ project_id: string; user_id: string }>(text, [connectionId]);
  const lease = current.rows[0];
  if (!lease) return false;
  try {
    await assertPresenceMember(lease.user_id, lease.project_id, signal);
  } catch (error) {
    if (!(error instanceof PresenceMemberError)) throw error;
    await leavePresence(connectionId, signal);
    return false;
  }

  return await withPresenceConnection(signal, async client => {
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
    await client.query('COMMIT');
    return Boolean(renewed.rows[0]);
  } catch (error) {
    if (!signal?.aborted) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  });
}

export async function expirePresenceLeases(batchSize = 500, signal?: AbortSignal): Promise<number> {
  const limit = Number.isFinite(batchSize) ? Math.max(1, Math.min(500, Math.floor(batchSize))) : 500;
  return await withPresenceConnection(signal, async client => {
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
    if (!signal?.aborted) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  });
}

export function startPresenceMaintenance(intervalMs = 15_000): () => Promise<void> {
  let pending: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let closing: Promise<void> | undefined;
  let stopping = false;
  let cleanupFailure: PresenceConnectionCleanupError | undefined;
  const timer = setInterval(() => {
    if (stopping || pending || cleanupFailure) return;
    const selected = new AbortController();
    controller = selected;
    pending = (async () => {
      await expirePresenceLeases(500, selected.signal);
      selected.signal.throwIfAborted();
      await pruneExpiredPresenceTickets(500, selected.signal);
    })().catch((error: unknown): void => {
      if (error instanceof PresenceConnectionCleanupError) {
        cleanupFailure = error;
        clearInterval(timer);
        throw error;
      }
      // Running cycles retry ordinary failures. Once stop owns this cycle,
      // preserve its actual rejection rather than falsely reporting success.
      if (stopping) throw error;
    }).finally(() => {
      if (controller === selected) {
        controller = null;
        pending = null;
      }
    });
    void pending.catch(() => undefined);
  }, Number.isFinite(intervalMs) ? Math.max(50, intervalMs) : 15_000);
  timer.unref?.();
  return (): Promise<void> => {
    if (closing) return closing;
    stopping = true;
    clearInterval(timer);
    const owned = pending;
    controller?.abort();
    closing = Promise.resolve(owned).then((): void => { if (cleanupFailure) throw cleanupFailure; });
    void closing.catch(() => undefined);
    return closing;
  };
}
