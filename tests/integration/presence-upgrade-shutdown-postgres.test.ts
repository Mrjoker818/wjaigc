import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { get, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { Client, type Pool, type PoolClient } from 'pg';
import WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';

import { runPostgresCleanup, type QueryFn } from '../helpers/postgres-test-database';
import type { PresenceGateway } from '../../src/lib/collaboration/presence-gateway';

vi.mock('server-only', () => ({}));
const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;
type Stage = 'ticket' | 'membership';
type Outcome = 'release' | 'terminate' | 'deadline';
interface BlockedUpgradeContext {
  query:QueryFn;
  waitingPid:number;
  lockerPid:number;
  schemaName:string;
  databaseUrl:string;
}
interface VerificationFaults {
  secondMembership?: boolean;
  afterEnvironment?: () => Promise<void>;
  afterLock?: () => Promise<void>;
  afterCleanup?: () => Promise<void>;
  afterBlocked?: (context:BlockedUpgradeContext) => Promise<void>;
  retainLockForRecovery?: boolean;
  beforeRecoveryConnect?: () => Promise<void>;
  beforeRecoveryQuery?: () => Promise<void>;
  afterRecoveryEnd?: () => Promise<void>;
  afterRecoveryConnect?: (client:Client) => Promise<void>;
  afterOwnedRecovery?: () => Promise<void>;
  unresolvedCleanupOwners?: number;
}

function nestedErrors(error: unknown): unknown[] {
  const children=error instanceof AggregateError ? error.errors as unknown[] : [];
  const cause=error instanceof Error && error.cause !== undefined ? [error.cause] : [];
  return [error,...children.flatMap(nestedErrors),...cause.flatMap(nestedErrors)];
}

async function observeWithin<T>(pending: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_done,reject) => {
      timer=setTimeout(()=>reject(new Error(`Test observation exceeded: ${label}`)),milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function setupDatabase(query: QueryFn): Promise<void> {
  for (const file of [
    'migrations/20260809_wj_core_users.sql', 'migrations/20260810_wj_stable_s2_assets.sql',
    'migrations/20260924_project_presence.sql', 'migrations/20260924_project_presence_tickets.sql',
    'migrations/20260924_project_presence_ttl_leases.sql',
  ]) await query(await readFile(file, 'utf8'));
  await query(`INSERT INTO wujie_users (id,name,password_hash,status,created_at,updated_at)
    VALUES ('owner','Owner','test','active',1,1), ('member','Member','test','active',1,1)`);
  await query("INSERT INTO wujie_projects (id,owner_id,name) VALUES ('project','owner','Project')");
  await query(`INSERT INTO wujie_project_presence_members (project_id,owner_id,member_user_id)
    VALUES ('project','owner','member')`);
}

async function blockedBackend(query: QueryFn, lockerPid: number, stage: Stage): Promise<number> {
  const deadline = Date.now()+3_000;
  while (Date.now()<deadline) {
    const result = await query<{ pid: number }>(`SELECT pid FROM pg_stat_activity
      WHERE datname=current_database() AND state='active' AND wait_event_type='Lock'
        AND $1::int=ANY(pg_blocking_pids(pid)) AND query LIKE $2`,
    [lockerPid, stage === 'ticket' ? '%FROM wujie_presence_tickets%FOR UPDATE%' : '%FROM wujie_projects p%']);
    if (result.rows.length === 1) return result.rows[0].pid;
    await new Promise<void>(done => setTimeout(done, 10));
  }
  throw new Error('Controlled production authorization SQL did not reach the held lock');
}

async function rejectedAfterClose(server: Server): Promise<number> {
  const address=server.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback address');
  return new Promise<number>((done,reject) => {
    const request=get({hostname:'127.0.0.1',port:address.port,path:'/api/collaboration/presence',
      headers:{Connection:'Upgrade',Upgrade:'websocket'}},response=>{
      response.resume();
      done(response.statusCode ?? 0);
    });
    request.once('upgrade',(_response,socket)=>{socket.destroy(); reject(new Error('Unexpected 101 after shutdown'));});
    request.once('error',reject);
    request.setTimeout(1_000,()=>request.destroy(new Error('Shutdown admission response timed out')));
  });
}

async function verifyPendingUpgrade(stage: Stage, outcome: Outcome, faults: VerificationFaults = {}): Promise<void> {
  requireOfflineBridgeTestDatabaseUrl(process.env);
  const { withIsolatedPostgres }=await import('../helpers/postgres-test-database');
  await withIsolatedPostgres(`presence-upgrade-${stage}-${outcome}`,async ({databaseUrl,schemaName,query})=>{
    let locker: Client | undefined;
    let gateway: PresenceGateway | undefined;
    let server: Server | undefined;
    let client: WebSocket | undefined;
    let rawSocket: Duplex | undefined;
    const pending: Promise<void>[]=[];
    let closePending: Promise<void> | undefined;
    let lockActive=false;
    let operationFailed=false;
    let operationError: unknown;
    const unhandledFaults: Error[]=[];
    const observeFault=(error:Error): void => {unhandledFaults.push(error);};
    const ownedBackendPids=new Set<number>();
    let poolInstance: Pool | undefined;
    let businessDatabaseUrl=databaseUrl;
    let sampledBackendPid: number | undefined;
    let sampledSession: Client | undefined;
    let recovering: Promise<void> | undefined;
    let cleanupDeadline: number | undefined;
    const observationBudget=():number=>{
      cleanupDeadline ??= performance.now()+8_000;
      return Math.max(1,Math.min(2_000,cleanupDeadline-performance.now()));
    };
    const terminateOwnedBackends=():Promise<void>=>{
      if (outcome !== 'deadline' || ownedBackendPids.size === 0) return Promise.resolve();
      recovering ??= (async ():Promise<void>=>{
      // Never terminate an arbitrary backend or the shared test/lock helper.
      // PID reuse is guarded by this case's unique schema/application identity.
      const recovery=new Client({connectionString:businessDatabaseUrl,
        connectionTimeoutMillis:2_000,query_timeout:2_000});
      const errors: unknown[]=[];
      recovery.on('error',observeFault);
      let recoveryEnded=false;
      const removeRecoveryObserver=():void=>{recovery.off('error',observeFault);};
      recovery.once('end',removeRecoveryObserver);
      try {
        await observeWithin((async ():Promise<void>=>{
          await faults.beforeRecoveryConnect?.();
          await recovery.connect();
          await faults.afterRecoveryConnect?.(recovery);
          await faults.beforeRecoveryQuery?.();
          await recovery.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname=current_database() AND application_name=$1
            AND pid=ANY($2::int[]) AND pid<>pg_backend_pid()`,
          [schemaName,[...ownedBackendPids]]);
        })(),observationBudget(),'independent backend recovery');
      } catch (error) { errors.push(error); }
      try {
        await observeWithin(recovery.end(),observationBudget(),'end independent recovery connection');
        recoveryEnded=true;
        await observeWithin(Promise.resolve().then(()=>faults.afterRecoveryEnd?.()),
          observationBudget(),'recovery end fault boundary');
      } catch (error) { errors.push(error); }
      finally {
        // The stream belongs to this exact recovery Client, never a shared pool.
        // Keep its error owner until a real end if ending was not observed.
        recovery.connection.stream.destroy();
        if (recoveryEnded) {
          removeRecoveryObserver();
          recovery.off('end',removeRecoveryObserver);
        }
      }
      // An independent recovery connection can fail. Always reclaim the exact
      // sampled business session as well, so outer closePool need not wait for
      // a still-borrowed query. Real PID matching precedes the shutdown probe.
      if (sampledSession) {
        try {
          const ending=sampledSession.end();
          sampledSession.connection.stream.destroy();
          await observeWithin(ending,observationBudget(),'end owned test business session');
        } catch (error) { errors.push(error); }
      }
      try {
        await observeWithin(Promise.resolve().then(()=>faults.afterOwnedRecovery?.()),
          observationBudget(),'observe recovered resource identities');
      } catch (error) { errors.push(error); }
      if (errors.length > 0) throw new AggregateError(errors,'Owned test backend recovery failed');
      })();
      return recovering;
    };
    const settleObserved=async <T>(operation:Promise<T>,label:string):Promise<T>=>{
      if (outcome !== 'deadline') return operation;
      try { return await observeWithin(operation,observationBudget(),label); }
      catch (error) {
        const errors: unknown[]=[error];
        try { await terminateOwnedBackends(); } catch (recoveryError) {errors.push(recoveryError);}
        try { await observeWithin(operation,observationBudget(),`${label} after owned recovery`); }
        catch (settlementError) {errors.push(settlementError);}
        throw new AggregateError(errors,`Deadline test cleanup required recovery: ${label}`);
      }
    };
    // Observation only; uncaughtExceptionMonitor does not intercept or suppress
    // Node/Vitest's error handling, and the explicit assertion names the fault.
    try {
      vi.stubEnv('WUJIE_PRESENCE_ENABLED','true');
      vi.stubEnv('WUJIE_ASSET_GRAPH_MODE','asset-v3');
      vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT','');
      if (outcome === 'deadline') {
        const controlledUrl=new URL(databaseUrl);
        controlledUrl.searchParams.set('application_name',schemaName);
        controlledUrl.searchParams.set('options',`${controlledUrl.searchParams.get('options') ?? ''} -cstatement_timeout=0 -clock_timeout=0 -cidle_in_transaction_session_timeout=0`);
        businessDatabaseUrl=controlledUrl.toString();
        process.env.DATABASE_URL=businessDatabaseUrl;
        process.env.PGDATABASE_URL=businessDatabaseUrl;
      }
      await faults.afterEnvironment?.();
      process.on('uncaughtExceptionMonitor',observeFault);
      await setupDatabase(query);
      const { issuePresenceTicket }=await import('../../src/lib/collaboration/presence-tickets');
      const ticket=await issuePresenceTicket('member','project');
      const ticketHash=createHash('sha256').update(ticket).digest('hex');
      const { createPresenceGateway }=await import('../../src/lib/collaboration/presence-gateway');
      const { createPresenceHttpServer }=await import('../../scripts/presence-server');
      const { getPool }=await import('../../src/lib/db-client');
      poolInstance=getPool();
      if (outcome === 'deadline') {
        const session=await poolInstance.connect();
        try {
          if (!(session instanceof Client)) throw new Error('Expected native owned PostgreSQL Client');
          sampledSession=session;
          const settings=await session.query<{
            pid:number; application_name:string; statement_timeout:string;
            lock_timeout:string; idle_in_transaction_session_timeout:string;
          }>(`SELECT pg_backend_pid() AS pid,
            current_setting('application_name') AS application_name,
            current_setting('statement_timeout') AS statement_timeout,
            current_setting('lock_timeout') AS lock_timeout,
            current_setting('idle_in_transaction_session_timeout') AS idle_in_transaction_session_timeout`);
          const row=settings.rows[0];
          sampledBackendPid=row.pid;
          ownedBackendPids.add(row.pid);
          expect(row).toEqual({pid:row.pid,application_name:schemaName,
            statement_timeout:'0',lock_timeout:'0',idle_in_transaction_session_timeout:'0'});
        } finally { session.release(); }
      }
      locker=new Client({connectionString:databaseUrl,connectionTimeoutMillis:2_000});
      await locker.connect();
      await locker.query('BEGIN');
      lockActive=true;
      await faults.afterLock?.();
      const lockerPid=(await locker.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      if (stage === 'ticket') {
        await locker.query('SELECT token_hash FROM wujie_presence_tickets WHERE token_hash=$1 FOR UPDATE',[ticketHash]);
      } else if (!faults.secondMembership) {
        await locker.query('LOCK TABLE wujie_project_presence_members IN ACCESS EXCLUSIVE MODE');
      }
      if (faults.secondMembership) {
        const members = await import('../../src/lib/collaboration/presence-members');
        const original = members.assertPresenceMember;
        let checks = 0;
        vi.spyOn(members, 'assertPresenceMember').mockImplementation(async (...args: Parameters<typeof original>): Promise<void> => {
          checks += 1;
          // First real authorization must complete. Only the gateway's second
          // live check acquires the independent lock before dispatching real SQL.
          if (checks === 2) await locker!.query('LOCK TABLE wujie_project_presence_members IN ACCESS EXCLUSIVE MODE');
          await original(...args);
        });
      }
      gateway=createPresenceGateway({instanceId:'pending-upgrade'});
      const selected=gateway;
      server=createPresenceHttpServer({
        onRequest:(_request,response)=>response.end('controlled-http'),
        onPresenceUpgrade:(request,socket,head)=>{
          rawSocket ??= socket;
          const operation=selected.handlePresenceUpgrade(request,socket,head);
          pending.push(operation);
          void operation.catch(()=>socket.destroy());
        },
      });
      server.listen(0,'127.0.0.1');
      await once(server,'listening');
      const address=server.address();
      if (!address || typeof address === 'string') throw new Error('Expected loopback address');
      const origin=`http://127.0.0.1:${address.port}`;
      client=new WebSocket(`${origin.replace('http:','ws:')}/api/collaboration/presence`,
        ['wujie-presence-v1',`wujie-ticket.${ticket}`],{origin,handshakeTimeout:4_000});
      client.on('error',()=>{});
      let upgraded=false;
      client.on('upgrade',()=>{upgraded=true;});
      const clientClosed=new Promise<void>(done=>client!.once('close',()=>done()));
      const waitingPid=await blockedBackend(query,lockerPid,stage);
      if (outcome === 'deadline') {
        ownedBackendPids.add(waitingPid);
        expect(waitingPid).toBe(sampledBackendPid);
      }
      expect(rawSocket).toBeDefined();
      await faults.afterBlocked?.({query,waitingPid,lockerPid,schemaName,databaseUrl});
      // Signal-bound authorization uses an owned Client, not Pool.query.
      // Observe its real SQL after the blocked query without replacing dispatch.
      const memberQueries=vi.spyOn(Client.prototype,'query');
      let closeSettled=false;
      const shutdownStartedAt=performance.now();
      closePending=gateway.close();
      void closePending.then(()=>{closeSettled=true;},()=>{closeSettled=true;});
      expect(gateway.close()).toBe(closePending);
      // Re-observe the real database lock after close; this is not an injected
      // promise or a sleep guessed to be long enough for authorization.
      if (outcome !== 'deadline') {
        expect(await blockedBackend(query,lockerPid,stage)).toBe(waitingPid);
        expect({closeSettled,socketDestroyed:rawSocket?.destroyed}).toEqual({closeSettled:false,socketDestroyed:true});
      } else {
        expect(rawSocket?.destroyed).toBe(true);
      }
      await clientClosed;
      expect(await rejectedAfterClose(server)).toBe(503);
      if (outcome === 'deadline') {
        // Six seconds is this test's observation budget from the first close,
        // not an HTTP lifecycle/SLA. A race observes; it does not cancel SQL.
        let observationTimer: ReturnType<typeof setTimeout> | undefined;
        let finishedWithoutUnlock: boolean;
        try {
          finishedWithoutUnlock = await Promise.race([
            closePending.then(() => true),
            new Promise<false>(done => {
              observationTimer = setTimeout(() => done(false),
                Math.max(0, 6_000-(performance.now()-shutdownStartedAt)));
            }),
          ]);
        } finally {
          if (observationTimer) clearTimeout(observationTimer);
        }
        const heldLock = await query<{ held: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM pg_locks
             WHERE pid=$1 AND relation=to_regclass($2) AND mode=$3 AND granted) AS held`,
          [lockerPid, stage === 'ticket' ? 'wujie_presence_tickets' : 'wujie_project_presence_members',
            stage === 'ticket' ? 'RowShareLock' : 'AccessExclusiveLock'],
        );
        expect(heldLock.rows[0].held).toBe(true);
        const remainingWaiters = await query<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_stat_activity
             WHERE datname=current_database() AND pid=$1
               AND state='active' AND wait_event_type='Lock'
               AND $2::int=ANY(pg_blocking_pids(pid))`,
          [waitingPid, lockerPid],
        );
        expect({finishedWithoutUnlock,blockedAuthorizationQueries:remainingWaiters.rows[0].count},
          'Shutdown must settle and cancel its SQL while the independent lock remains held')
          .toEqual({finishedWithoutUnlock:true,blockedAuthorizationQueries:0});
        const leakedTransactions=await query<{ count:number }>(
          `SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname=current_database() AND application_name=$1
              AND (state<>'idle' OR xact_start IS NOT NULL)`,[schemaName],
        );
        expect(leakedTransactions.rows[0].count).toBe(0);
        const leakedLocks=await query<{ count:number }>(
          `SELECT count(*)::int AS count FROM pg_locks locks
            JOIN pg_stat_activity backend ON backend.pid=locks.pid
            WHERE backend.datname=current_database() AND backend.application_name=$1
              AND locks.locktype IN ('relation','transactionid')`,[schemaName],
        );
        expect(leakedLocks.rows[0].count).toBe(0);
        expect(poolInstance.waitingCount).toBe(0);
      } else if (outcome === 'terminate') {
        const terminated=await query<{terminated:boolean}>('SELECT pg_terminate_backend($1) AS terminated',[waitingPid]);
        expect(terminated.rows[0].terminated).toBe(true);
      } else {
        await locker.query('ROLLBACK');
        lockActive=false;
      }
      await settleObserved(closePending,'body shutdown');
      expect(await settleObserved(Promise.allSettled(pending),'body upgrades')).toEqual(pending.map(()=>({status:'fulfilled',value:undefined})));
      expect(upgraded).toBe(false);
      if (stage === 'ticket') {
        expect(memberQueries.mock.calls.filter(([statement]) =>
          typeof statement === 'string' && statement.includes('FROM wujie_projects p'),
        )).toEqual([]);
      }
      const leaseCount=await query<{count:number}>('SELECT count(*)::int AS count FROM wujie_presence_leases');
      expect(leaseCount.rows[0].count).toBe(0);
      expect(poolInstance.totalCount-poolInstance.idleCount).toBe(0);
      expect(unhandledFaults).toEqual([]);
    } catch (error) {
      operationFailed=true;
      operationError=error;
      throw error;
    } finally {
      await runPostgresCleanup([
        {name:'release-held-lock',run:async ():Promise<void>=>{
          if (!faults.retainLockForRecovery && lockActive && locker) await settleObserved(locker.query('ROLLBACK'),'release held lock');
        }},
        {name:'end-lock-holder',run:()=>!faults.retainLockForRecovery && locker ? settleObserved(locker.end(),'end lock holder') : undefined},
        {name:'stop-test-clients',run:():void=>{client?.terminate(); rawSocket?.destroy();}},
        ...Array.from({length:Math.min(3,Math.max(0,faults.unresolvedCleanupOwners ?? 0))},(_,index)=>({
          name:`controlled-unresolved-cleanup-owner-${index}`,
          run:async ():Promise<void>=>{
            await settleObserved(new Promise<void>(()=>{}),`controlled unresolved cleanup owner ${index}`);
          },
        })),
        {name:'settle-observed-upgrades',run:async ():Promise<void>=>{await settleObserved(Promise.allSettled(pending),'cleanup upgrades');}},
        {name:'await-started-shutdown',run:async ():Promise<void>=>{if(closePending) await settleObserved(closePending,'cleanup started shutdown');}},
        {name:'close-gateway',run:async ():Promise<void>=>{if(gateway) await settleObserved(gateway.close(),'cleanup gateway');}},
        {name:'close-test-http',run:async ():Promise<void>=>{
          if (!server) return;
          server.closeAllConnections();
          await settleObserved(new Promise<void>((done,reject)=>server!.close(error=>{
            if (error && (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING')) reject(error);
            else done();
          })),'cleanup HTTP');
        }},
        {name:'end-retained-lock-holder',run:async ():Promise<void>=>{
          // Safety net even against the pre-fix repeated recovery implementation.
          if (faults.retainLockForRecovery) await locker?.end();
        }},
        {name:'restore-test-observers',run:():void=>{
          vi.restoreAllMocks();
          vi.unstubAllEnvs(); process.off('uncaughtExceptionMonitor',observeFault);
        }},
        {name:'injected-cleanup-fault',run:async ():Promise<void>=>{await faults.afterCleanup?.();}},
      ]).catch((cleanupError:unknown):never=>{
        if (!operationFailed) throw cleanupError;
        const cleanupErrors=cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError];
        throw new AggregateError([operationError,...cleanupErrors],'Presence verification body and cleanup failed');
      });
    }
  });
}

// Dropping pre-101 SQL ownership or leaving its raw socket open must fail with
// real PostgreSQL locks and TCP, not merely a mock close() call count.
describe('presence upgrade shutdown owns real pending authorization',()=>{
  postgresIt('owns saturated-pool authorizations until native timeout without closing other leases', async () => {
    requireOfflineBridgeTestDatabaseUrl(process.env);
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('presence-saturated-pool-close', async ({ query }) => {
      interface Identity { pid: number; backend_start: string; datname: string; usename: string }
      const identityOf = async (session: PoolClient): Promise<Identity> => {
        const result = await session.query<Identity>(
          'SELECT pid,backend_start::text,datname,usename FROM pg_catalog.pg_stat_activity WHERE pid=pg_backend_pid()',
        );
        if (!result.rows[0]) throw new Error('Held native identity missing');
        return result.rows[0];
      };
      const holders: (PoolClient & Client)[] = [];
      const identities: Identity[] = [];
      const borrowed = new Set<PoolClient>();
      const acquired: PoolClient[] = [];
      const clients: WebSocket[] = [];
      const rawSockets: Duplex[] = [];
      const pending: Promise<void>[] = [];
      const abortWatches: { signal: AbortSignal; onAbort: () => void; pending: Promise<void> }[] = [];
      let pool: Pool | undefined;
      let gateway: PresenceGateway | undefined;
      let server: Server | undefined;
      let closePending: Promise<void> | undefined;
      let closeSettled = false;
      let upgrades = 0;
      let bodyFailed = false;
      let bodyError: unknown;
      const onAcquire = (client: PoolClient): void => { borrowed.add(client); acquired.push(client); };
      const onRelease = (_error: Error | boolean | undefined, client: PoolClient): void => { borrowed.delete(client); };
      const releaseBorrowed = (): Promise<void> => runPostgresCleanup([...borrowed].map((client, index) => ({
        name: `return-saturated-native-lease-${index}`, run: (): void => { client.release(); },
      })));
      try {
        vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
        vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'asset-v3');
        vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
        await setupDatabase(query);
        const tickets = await import('../../src/lib/collaboration/presence-tickets');
        const issued = [await tickets.issuePresenceTicket('member', 'project'), await tickets.issuePresenceTicket('member', 'project')];
        const nativeConsume = tickets.consumePresenceTicket;
        vi.spyOn(tickets, 'consumePresenceTicket').mockImplementation(async (...args: Parameters<typeof nativeConsume>): ReturnType<typeof nativeConsume> => {
          const signal = args[2];
          if (signal) {
            let done: () => void = (): void => {};
            const aborted = new Promise<void>(resolve => { done = resolve; });
            const onAbort = (): void => { done(); };
            signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted) done();
            abortWatches.push({ signal, onAbort, pending: aborted });
          }
          // Observer only: ticket SQL and the native Pool acquisition remain real.
          return nativeConsume(...args);
        });
        const { getPool } = await import('../../src/lib/db-client');
        pool = getPool();
        pool.on('release', onRelease);
        for (let index = 0; index < 5; index++) {
          const session = await pool.connect();
          if (!(session instanceof Client)) { session.release(true); throw new Error('Native pg saturated lease required'); }
          holders.push(session);
          borrowed.add(session);
          identities.push(await identityOf(session));
          const settings = await session.query<{ statement: string; lock: string }>(
            "SELECT current_setting('statement_timeout') AS statement,current_setting('lock_timeout') AS lock",
          );
          expect(settings.rows[0]).toEqual({ statement: '0', lock: '0' });
        }
        pool.on('acquire', onAcquire);
        const { createPresenceGateway } = await import('../../src/lib/collaboration/presence-gateway');
        const { createPresenceHttpServer } = await import('../../scripts/presence-server');
        gateway = createPresenceGateway({ instanceId: 'saturated-pool-close' });
        const selected = gateway;
        server = createPresenceHttpServer({
          onRequest: (_request, response): void => { response.end('controlled-http'); },
          onPresenceUpgrade: (request, socket, head): void => {
            rawSockets.push(socket);
            const operation = selected.handlePresenceUpgrade(request, socket, head);
            pending.push(operation);
            void operation.catch(() => socket.destroy());
          },
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Loopback listener required');
        const origin = `http://127.0.0.1:${address.port}`;
        const clientClosures: Promise<void>[] = [];
        for (const ticket of issued) {
          const client = new WebSocket(`${origin.replace('http:', 'ws:')}/api/collaboration/presence`,
            ['wujie-presence-v1', `wujie-ticket.${ticket}`], { origin, handshakeTimeout: 15_000 });
          clients.push(client);
          client.on('error', (): void => {});
          client.on('upgrade', (): void => { upgrades += 1; });
          clientClosures.push(new Promise<void>(resolve => client.once('close', () => resolve())));
        }
        const queuedDeadline = performance.now() + 2_000;
        while (pool.waitingCount !== 2 && performance.now() < queuedDeadline) {
          await new Promise<void>(resolve => setTimeout(resolve, 10));
        }
        expect(pool.waitingCount).toBe(2);
        expect(rawSockets).toHaveLength(2);
        expect(abortWatches).toHaveLength(2);
        expect(pool.totalCount).toBe(5);
        expect(pool.idleCount).toBe(0);
        closePending = gateway.close();
        void closePending.then(() => { closeSettled = true; }, () => { closeSettled = true; });
        expect(gateway.close() === closePending).toBe(true);
        await observeWithin(Promise.all(clientClosures), 2_000, 'raw handshake closure');
        expect(rawSockets.every(socket => socket.closed)).toBe(true);
        expect(await rejectedAfterClose(server)).toBe(503);
        expect((await query<{ value: number }>('SELECT 1 AS value')).rows[0].value).toBe(1);
        expect(closeSettled).toBe(false);
        // Observe the actual gateway cancellation; do not manufacture abort or
        // equate it to removal from pg-pool's unchanged ten-second native queue.
        await observeWithin(Promise.all(abortWatches.map(watch => watch.pending)), 7_000, 'gateway upgrade cancellation');
        expect(abortWatches.every(watch => watch.signal.aborted)).toBe(true);
        expect(pool.waitingCount).toBe(2);
        expect(closeSettled).toBe(false);
        expect(acquired).toHaveLength(0);
        await observeWithin(closePending, 12_000, 'gateway waits for native acquisition timeout');
        expect(await Promise.allSettled(pending)).toEqual(pending.map(() => ({ status: 'fulfilled', value: undefined })));
        expect(pool.waitingCount).toBe(0);
        expect(acquired).toHaveLength(0);
        expect(upgrades).toBe(0);
        expect(pool.totalCount).toBe(5);
        expect(pool.idleCount).toBe(0);
        expect(pool.ending).toBe(false);
        for (let index = 0; index < holders.length; index++) {
          expect(holders[index].connection.stream.closed).toBe(false);
          expect(await identityOf(holders[index])).toEqual(identities[index]);
          expect((await holders[index].query<{ value: number }>('SELECT 42 AS value')).rows[0].value).toBe(42);
        }
        const state = await query<{ unconsumed: number; leases: number }>(
          `SELECT (SELECT count(*)::int FROM wujie_presence_tickets WHERE consumed_at IS NULL) AS unconsumed,
            (SELECT count(*)::int FROM wujie_presence_leases) AS leases`,
        );
        expect(state.rows[0]).toEqual({ unconsumed: 2, leases: 0 });
      } catch (error) { bodyFailed = true; bodyError = error; throw error; }
      finally {
        await runPostgresCleanup([
          { name: 'restore-saturated-call-through', run: (): void => { vi.restoreAllMocks(); } },
          { name: 'stop-saturated-handshakes', run: (): void => { clients.forEach(client => client.terminate()); rawSockets.forEach(socket => socket.destroy()); } },
          { name: 'return-saturated-held-leases', run: releaseBorrowed },
          { name: 'settle-saturated-upgrades', run: async (): Promise<void> => { await observeWithin(Promise.allSettled(pending), 12_000, 'cleanup queued upgrades'); } },
          { name: 'return-saturated-late-leases', run: releaseBorrowed },
          { name: 'settle-saturated-gateway', run: async (): Promise<void> => { if (gateway) await observeWithin(gateway.close(), 12_000, 'cleanup saturated gateway'); } },
          { name: 'close-saturated-http', run: async (): Promise<void> => {
            if (!server) return;
            server.closeAllConnections();
            await observeWithin(new Promise<void>((resolve, reject) => server!.close(error => {
              if (error && (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING')) reject(error);
              else resolve();
            })), 2_000, 'cleanup saturated HTTP');
          } },
          { name: 'restore-saturated-observers', run: (): void => {
            pool?.off('acquire', onAcquire);
            pool?.off('release', onRelease);
            abortWatches.forEach(watch => watch.signal.removeEventListener('abort', watch.onAbort));
            vi.unstubAllEnvs();
          } },
        ]).catch((cleanupError: unknown): never => {
          if (!bodyFailed) throw cleanupError;
          throw new AggregateError([bodyError, cleanupError], 'Saturated upgrade body and cleanup failed');
        });
      }
    });
  }, 30_000);

  postgresIt.each(['ticket','membership'] as const)('waits for %s SQL and closes the pre-upgrade socket on normal release',async stage=>{
    await verifyPendingUpgrade(stage,'release');
  },15_000);
  postgresIt.each(['ticket','membership'] as const)('waits for %s SQL and closes the pre-upgrade socket when the backend terminates',async stage=>{
    await verifyPendingUpgrade(stage,'terminate');
  },15_000);
  postgresIt.each(['ticket','membership'] as const)('bounds shutdown while the %s SQL lock remains held',async stage=>{
    await verifyPendingUpgrade(stage,'deadline');
  },20_000);
  postgresIt('bounds shutdown while only the second membership authorization remains locked', async () => {
    await verifyPendingUpgrade('membership', 'deadline', { secondMembership: true });
  }, 20_000);
  postgresIt.each(['connect','query'] as const)('preserves %s recovery failure alongside end failure and restores isolation',async phase=>{
    const names=['DATABASE_URL','PGDATABASE_URL','WUJIE_PRESENCE_ENABLED','WUJIE_ASSET_GRAPH_MODE','COZE_PROJECT_DOMAIN_DEFAULT'] as const;
    const before=names.map(name=>process.env[name]);
    const listeners=process.listenerCount('uncaughtExceptionMonitor');
    const bodyFailure=new Error('controlled body failure with held SQL');
    const recoveryFailure=new Error(`controlled recovery ${phase} failure`);
    const endFailure=new Error('controlled recovery end boundary failure');
    let cleanupStartedAt=0;
    let observed: unknown;
    try {
      await verifyPendingUpgrade('ticket','deadline',{
        retainLockForRecovery:true,
        afterBlocked:async ():Promise<void>=>{cleanupStartedAt=performance.now(); throw bodyFailure;},
        ...(phase === 'connect'
          ? {beforeRecoveryConnect:async ():Promise<void>=>{throw recoveryFailure;}}
          : {beforeRecoveryQuery:async ():Promise<void>=>{throw recoveryFailure;}}),
        afterRecoveryEnd:async ():Promise<void>=>{throw endFailure;},
      });
    } catch (error) { observed=error; }
    expect(nestedErrors(observed)).toContain(bodyFailure);
    expect(nestedErrors(observed)).toContain(recoveryFailure);
    expect(nestedErrors(observed)).toContain(endFailure);
    expect(performance.now()-cleanupStartedAt).toBeLessThan(6_000);
    expect(names.map(name=>process.env[name])).toEqual(before);
    expect(process.listenerCount('uncaughtExceptionMonitor')).toBe(listeners);
  },35_000);
  postgresIt('recovers the exact held backend once, preserves other connections and bounds multiple unresolved cleanup owners',async ()=>{
    const bodyFailure=new Error('controlled body failure for cleanup budget');
    const names=['DATABASE_URL','PGDATABASE_URL','WUJIE_PRESENCE_ENABLED','WUJIE_ASSET_GRAPH_MODE','COZE_PROJECT_DOMAIN_DEFAULT'] as const;
    const before=names.map(name=>process.env[name]);
    const listeners=process.listenerCount('uncaughtExceptionMonitor');
    const recoveryPids:number[]=[];
    let blockedContext:BlockedUpgradeContext | undefined;
    let unrelated:Client | undefined;
    let sameTagUncaptured:Client | undefined;
    let startedAt=0;
    let observed:unknown;
    let verifiedRecovery=false;
    try {
      try {
        await verifyPendingUpgrade('ticket','deadline',{
          retainLockForRecovery:true,unresolvedCleanupOwners:3,
          afterBlocked:async (context:BlockedUpgradeContext):Promise<void>=>{
            blockedContext=context;
            unrelated=new Client({connectionString:context.databaseUrl,connectionTimeoutMillis:2_000});
            const sameTagUrl=new URL(context.databaseUrl);
            sameTagUrl.searchParams.set('application_name',context.schemaName);
            sameTagUncaptured=new Client({connectionString:sameTagUrl.toString(),connectionTimeoutMillis:2_000});
            await unrelated.connect();
            await sameTagUncaptured.connect();
            startedAt=performance.now();
            throw bodyFailure;
          },
          afterRecoveryConnect:async (recovery:Client):Promise<void>=>{
            recoveryPids.push((await recovery.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0].pid);
          },
          afterOwnedRecovery:async ():Promise<void>=>{
            if (!blockedContext || !unrelated || !sameTagUncaptured) throw new Error('Missing actual recovery identities');
            const remaining=await blockedContext.query<{count:number}>(
              'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid=$1',
              [blockedContext.waitingPid],
            );
            expect(remaining.rows[0].count).toBe(0);
            const lockerAlive=await blockedContext.query<{held:boolean}>(
              `SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND relation=to_regclass('wujie_presence_tickets')
                AND mode='RowShareLock' AND granted) AS held`,[blockedContext.lockerPid],
            );
            expect(lockerAlive.rows[0].held).toBe(true);
            expect((await unrelated.query<{alive:number}>('SELECT 1 AS alive')).rows[0].alive).toBe(1);
            expect((await sameTagUncaptured.query<{alive:number}>('SELECT 1 AS alive')).rows[0].alive).toBe(1);
            // This query also proves the isolation helper connection survived.
            verifiedRecovery=true;
          },
        });
      } catch (error) {observed=error;}
      expect(nestedErrors(observed)).toContain(bodyFailure);
      expect(verifiedRecovery).toBe(true);
      expect(recoveryPids).toHaveLength(1);
      expect(performance.now()-startedAt).toBeLessThan(11_000);
      expect(names.map(name=>process.env[name])).toEqual(before);
      expect(process.listenerCount('uncaughtExceptionMonitor')).toBe(listeners);
    } finally {
      await unrelated?.end();
      await sameTagUncaptured?.end();
    }
  },35_000);
  postgresIt('restores environment when setup fails before any resource exists',async ()=>{
    const names=['WUJIE_PRESENCE_ENABLED','WUJIE_ASSET_GRAPH_MODE','COZE_PROJECT_DOMAIN_DEFAULT'] as const;
    const before=names.map(name=>process.env[name]);
    const listeners=process.listenerCount('uncaughtExceptionMonitor');
    const failure=new Error('controlled-setup-failure');
    try {
      await expect(verifyPendingUpgrade('ticket','release',{
        afterEnvironment:async ():Promise<void>=>{throw failure;},
      })).rejects.toBe(failure);
      expect(names.map(name=>process.env[name])).toEqual(before);
      expect(process.listenerCount('uncaughtExceptionMonitor')).toBe(listeners);
    } finally { vi.unstubAllEnvs(); }
  },15_000);
  postgresIt('preserves the body error alongside cleanup failure and restores observers',async ()=>{
    const failure=new Error('controlled-body-failure');
    const cleanupFailure=new Error('controlled-cleanup-failure');
    const listeners=process.listenerCount('uncaughtExceptionMonitor');
    let observed: unknown;
    try {
      await verifyPendingUpgrade('ticket','release',{
        afterLock:async ():Promise<void>=>{throw failure;},
        afterCleanup:async ():Promise<void>=>{throw cleanupFailure;},
      });
    } catch (error) { observed=error; }
    expect(observed).toBeInstanceOf(AggregateError);
    if (!(observed instanceof AggregateError)) throw new Error('Expected combined failure');
    expect(observed.errors).toContain(failure);
    expect(observed.errors.some((error:unknown)=>error instanceof Error && error.cause === cleanupFailure)).toBe(true);
    expect(process.listenerCount('uncaughtExceptionMonitor')).toBe(listeners);
  },15_000);
});
