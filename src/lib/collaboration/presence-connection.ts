import 'server-only';

import type { Duplex } from 'node:stream';

import { Client, DatabaseError, type PoolClient, type PoolOptions, type QueryResult } from 'pg';

import { getPool } from '@/lib/db-client';

interface BackendIdentity {
  pid: number;
  backend_start: string;
  datname: string;
  usename: string;
}

interface BackendCancelKey {
  processID: number;
  secretKey: number;
}

interface NativeCancelConnection {
  connect: (port: number | string, host?: string) => void;
  requestSsl: () => void;
  cancel: (pid: number, key: number) => void;
}

function hasBackendCancelKey(client: PoolClient): client is PoolClient & Client & BackendCancelKey {
  return client instanceof Client && 'processID' in client && typeof client.processID === 'number'
    && Number.isInteger(client.processID) && client.processID > 0
    && 'secretKey' in client && typeof client.secretKey === 'number' && Number.isInteger(client.secretKey);
}

function hasNativeCancelConnection(
  connection: Client['connection'],
): connection is Client['connection'] & NativeCancelConnection {
  return 'connect' in connection && typeof connection.connect === 'function'
    && 'requestSsl' in connection && typeof connection.requestSsl === 'function'
    && 'cancel' in connection && typeof connection.cancel === 'function';
}

async function cancelIdentityQuery(
  client: PoolClient, options: PoolOptions, query: Promise<QueryResult<BackendIdentity>>,
): Promise<void> {
  // Before SQL identity sampling returns, the authenticated driver's BackendKeyData
  // still targets this exact session. Never guess a backend identity from PID alone.
  if (!hasBackendCancelKey(client)) throw new Error('Presence backend cancellation key is unavailable');
  const control = new Client({ ...options, connectionString: options.connectionString, password: options.password });
  const connection = control.connection;
  if (!hasNativeCancelConnection(connection)) throw new Error('Native PostgreSQL cancellation is unavailable');
  const streams = new Map<Duplex, Promise<void>>();
  const watchStream = (): void => {
    const stream = connection.stream;
    if (!streams.has(stream)) streams.set(stream, stream.closed ? Promise.resolve()
      : new Promise<void>(resolve => stream.once('close', resolve)));
  };
  const destroyStreams = (): void => {
    watchStream();
    for (const stream of streams.keys()) stream.destroy();
  };
  watchStream();
  let sent = false;
  let resetError: Error | undefined;
  let resolveControl: () => void = (): void => {};
  let rejectControl: (error: unknown) => void = (): void => {};
  const controlClosed = new Promise<void>((resolve, reject) => { resolveControl = resolve; rejectControl = reject; });
  const onError = (error: Error): void => {
    // CancelRequest has no reply; a post-send reset still needs the original
    // query's acknowledgement. A reset before dispatch remains a hard failure.
    if (sent && 'code' in error && error.code === 'ECONNRESET') {
      resetError ??= error;
      resolveControl();
    } else rejectControl(error);
  };
  const sendCancel = (): void => {
    watchStream();
    try { connection.cancel(client.processID, client.secretKey); sent = true; }
    catch (error) { rejectControl(error); }
  };
  const onConnect = (): void => {
    try { if (control.ssl) connection.requestSsl(); else sendCancel(); }
    catch (error) { rejectControl(error); }
  };
  const onEnd = (): void => {
    if (sent) resolveControl();
    else rejectControl(new Error('Presence cancellation transport closed before sending'));
  };
  connection.on('error', onError);
  connection.once('connect', onConnect);
  connection.once('sslconnect', sendCancel);
  connection.once('end', onEnd);
  const deadline = setTimeout(() => {
    rejectControl(new Error('Presence cancellation transport deadline exceeded'));
    destroyStreams();
  }, 1_000);
  deadline.unref();
  try {
    try {
      if (control.host.startsWith('/')) connection.connect(`${control.host}/.s.PGSQL.${control.port}`);
      else connection.connect(control.port, control.host);
    } catch (error) { rejectControl(error); }
    await controlClosed;
  } finally {
    destroyStreams();
    try { await Promise.all(streams.values()); }
    finally {
      clearTimeout(deadline);
      connection.off('error', onError);
      connection.off('connect', onConnect);
      connection.off('sslconnect', sendCancel);
      connection.off('end', onEnd);
    }
  }
  // CancelRequest has no success reply. Own the original query until its real
  // response, and surface uncertain retirement instead of equating TCP EOF to it.
  let queryDeadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      query.then(() => undefined, (error: unknown): void => {
        if (!(error instanceof DatabaseError)) throw new Error('Presence identity query retirement was not acknowledged', { cause: error });
      }),
      new Promise<never>((_resolve, reject) => {
        queryDeadline = setTimeout(() => reject(new Error('Presence identity query retirement deadline exceeded')), 1_000);
        queryDeadline.unref();
      }),
    ]);
  } catch (error) {
    if (resetError) throw new AggregateError(
      [resetError, error], 'Presence cancellation reset without query acknowledgement',
    );
    throw error;
  } finally { if (queryDeadline) clearTimeout(queryDeadline); }
}

export class PresenceConnectionCleanupError extends Error {
  constructor(cause: unknown) {
    super('Presence authorization connection could not be retired', { cause });
    this.name = 'PresenceConnectionCleanupError';
  }
}

async function terminateBackend(identity: BackendIdentity, options: PoolOptions): Promise<void> {
  // Pool credentials may be non-enumerable; preserve the actual pool's config,
  // rather than re-reading environment variables after this checkout began.
  const control = new Client({ ...options, connectionString: options.connectionString,
    password: options.password, connectionTimeoutMillis: 1_000, query_timeout: 1_000 });
  const onError = (): void => undefined;
  control.on('error', onError);
  control.once('end', () => control.off('error', onError));
  const deadline = setTimeout(() => control.connection.stream.destroy(), 1_000);
  deadline.unref();
  let operationFailed = false;
  let operationError: unknown;
  try {
    await control.connect();
    const result = await control.query<{ terminated: boolean }>(
      `SELECT pg_terminate_backend(pid, 500) AS terminated FROM pg_stat_activity
        WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4
          AND pid<>pg_backend_pid()`,
      [identity.pid, identity.backend_start, identity.datname, identity.usename],
    );
    if (result.rows.some(row => !row.terminated)) throw new Error('Presence backend termination was not confirmed');
  } catch (error) {
    operationFailed = true;
    operationError = error;
    throw error;
  } finally {
    // Retire the concrete control connection too, including failed connect/query.
    // Observe this actual transport even if end() throws before retiring it.
    const stream = control.connection.stream;
    const closed = stream.closed ? Promise.resolve() : new Promise<void>(resolve => stream.once('close', resolve));
    try {
      const ending = control.end();
      stream.destroy();
      await ending;
    } catch (endError) {
      if (operationFailed) throw new AggregateError(
        [operationError, endError], 'Presence control operation and transport cleanup failed',
      );
      throw endError;
    } finally {
      stream.destroy();
      try { await closed; }
      finally { clearTimeout(deadline); }
    }
  }
}

// Cancellation owns one checkout, never the shared pool. Wait for the native
// end event when discarding it: removing it from Pool is not socket retirement.
export async function withPresenceConnection<T>(
  signal: AbortSignal | undefined,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  const pool = getPool();
  const client = await pool.connect();
  let released = false;
  let discard = false;
  let ended = false;
  let identity: BackendIdentity | undefined;
  let identityQuery: Promise<QueryResult<BackendIdentity>> | undefined;
  let cancellation: Promise<void> | undefined;
  let cancellationError: unknown;
  let cancellationFailed = false;
  let operationError: unknown;
  let operationFailed = false;
  let resolveEnd: () => void = () => undefined;
  const endPending = new Promise<void>(resolve => { resolveEnd = resolve; });
  const onEnd = (): void => { ended = true; resolveEnd(); };
  const onError = (): void => { discard = true; };
  const release = (destroy: boolean): void => {
    if (released) return;
    released = true;
    client.release(destroy);
  };
  const onAbort = (): void => {
    discard = true;
    cancellation ??= (async (): Promise<void> => {
      try {
        if (identity) await terminateBackend(identity, pool.options);
        else if (identityQuery) await cancelIdentityQuery(client, pool.options, identityQuery);
      } catch (error) { cancellationFailed = true; cancellationError = error; }
      finally { release(true); }
    })();
  };
  client.once('end', onEnd);
  client.on('error', onError);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    // An abort during pool acquisition must reclaim a late checkout, not run SQL.
    signal?.throwIfAborted();
    if (signal) {
      identityQuery = client.query<BackendIdentity>(
        `SELECT pid, backend_start::text AS backend_start, datname, usename
           FROM pg_stat_activity WHERE pid=pg_backend_pid()`,
      );
      identity = (await identityQuery).rows[0];
      if (!identity) throw new Error('Presence authorization backend identity is unavailable');
      signal.throwIfAborted();
    }
    return await operation(client);
  } catch (error) {
    operationFailed = true;
    operationError = error;
    discard = true;
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await cancellation;
    release(discard);
    if (discard && !ended) await endPending;
    client.off('error', onError);
    client.off('end', onEnd);
    if (cancellationFailed) {
      throw new PresenceConnectionCleanupError(operationFailed
        ? new AggregateError([operationError, cancellationError], 'Presence operation and cancellation cleanup failed')
        : cancellationError);
    }
  }
}
