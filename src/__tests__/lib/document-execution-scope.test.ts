import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { runDocumentExecution, getDocumentExecutionScope, reserveDocumentExecutionActor, getDocumentExecutionStats, documentExecutionHttpFailure } from '@/lib/collaboration/document-execution-scope';
import * as canvasDocument from '@/lib/collaboration/canvas-document';
import { projectDocumentPlacementsOntoImages } from '@/lib/collaboration/canvas-document-image-bridge';
import { readProjectSnapshot } from '@/lib/asset-core/project-readers';
import { buildCanonicalAnnotationSourceVersionId } from '@/features/annotations/annotation-source-version';
import type { Project } from '@/lib/user-types';
import { loadDocumentCommonJs } from '../fixtures/document-commonjs';

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(cause:unknown)=>void;const promise=new Promise<T>((ok,fail)=>{resolve=ok;reject=fail});return {promise,resolve,reject};}
class FakeClient extends EventEmitter {
  calls:string[]=[];releases:boolean[]=[];automaticEnd=true;throwRelease=false;_queryable=true;_ending=false;_ended=false;
  handler:(sql:string)=>Promise<unknown>=async()=>({rows:[],rowCount:0});
  query(sql:string|{text:string},...args:unknown[]):void {const text=typeof sql==='string'?sql:sql.text;this.calls.push(text);const cb=args[args.length-1] as (error:Error|null,value?:unknown)=>void;
    void this.handler(text).then(value=>cb(null,value),cause=>cb(cause instanceof Error?cause:new Error('driver error')));}
  release(discard?:boolean):void {this.releases.push(!!discard);if(this.throwRelease)throw Error('private');if(discard&&this.automaticEnd)queueMicrotask(()=>this.emit('end'));}
}
class FakePool {
  readonly client=new FakeClient();readonly _clients=[this.client];ending=false;connects=0;pending?:ReturnType<typeof deferred<FakeClient>>;
  on():this{return this;}
  connect(cb:(cause:Error|null,client?:FakeClient)=>void):void{this.connects++;if(this.pending)void this.pending.promise.then(client=>cb(null,client),cause=>cb(cause));else queueMicrotask(()=>cb(null,this.client));}
  query():never {throw Error('raw pool.query must not run');}
}
class PromiseClient extends EventEmitter {
  releases:boolean[]=[];calls:string[]=[];_queryable=true;_ending=false;_ended=false;
  async query(text:string):Promise<{rows:number[]}>{this.calls.push(text);return {rows:[1]};}
  release(discard?:boolean):void{this.releases.push(!!discard);if(discard)queueMicrotask(()=>this.emit('end'));}
}
class PromisePool {readonly client=new PromiseClient();readonly _clients=[this.client];ending=false;connect():Promise<PromiseClient>{return Promise.resolve(this.client);}}
const resolvePool=(raw:FakePool):Pool=>{const resolve=(globalThis as unknown as Record<symbol,unknown>)[Symbol.for('wujie.documentRequestPoolScope.v1')] as (pool:Pool)=>Pool;return resolve(raw as unknown as Pool);};
const tick=async():Promise<void>=>{for(let i=0;i<8;i++)await Promise.resolve();};
function loadSyntheticDbClient(raw: FakePool): typeof import('@/lib/db-client') {
  class SyntheticPool {
    constructor() { return raw; }
  }
  return loadDocumentCommonJs(new URL('../../lib/db-client.ts', import.meta.url), {
    pg: { Pool: SyntheticPool },
  });
}
function loadSyntheticTicketService(raw: FakePool): typeof import('@/lib/collaboration/document-tickets') {
  return loadDocumentCommonJs(new URL('../../lib/collaboration/document-tickets.ts', import.meta.url), {
    'server-only': {},
    './document-exchange-maintenance': {},
    '@/lib/db-client': { getPool: () => resolvePool(raw) },
    './document-access': {
      assertDocumentEditor: async (actor: string) => ({ ownerId: actor }),
      assertDocumentProjectEnabled: async () => {},
      DocumentAccessError: class extends Error {},
      DocumentFeatureDisabledError: class extends Error {},
      DocumentProjectNotEnabledError: class extends Error {},
    },
  });
}
function loadSyntheticProjectBridge(raw: FakePool, doc = canvasDocument.createCanvasDocument()): typeof import('@/lib/collaboration/document-project-bridge') {
  return loadDocumentCommonJs(new URL('../../lib/collaboration/document-project-bridge.ts', import.meta.url), {
    'server-only': {},
    '@/lib/db-client': { getPool: () => resolvePool(raw) },
    '@/lib/collaboration/document-access': {
      assertDocumentEditor: async () => ({ ownerId: 'owner-a' }),
      DocumentProjectNotEnabledError: class extends Error {},
    },
    '@/lib/collaboration/document-store': { loadDocumentInTransaction: async () => ({ doc, sequence: 1 }) },
    '@/lib/collaboration/canvas-document': canvasDocument,
    '@/lib/collaboration/canvas-document-image-bridge': { projectDocumentPlacementsOntoImages },
    '@/features/annotations/annotation-bundle': {},
    '@/features/annotations/annotation-source-version': { buildCanonicalAnnotationSourceVersionId },
    '@/lib/asset-core/storage': {},
    '@/lib/asset-core/canvas-project-sync': { readAssetV3Projects: async (_ownerId: string, projects: Project[]) => projects },
    '@/lib/asset-core/legacy-migration': {},
    '@/lib/asset-core/project-readers': { readProjectSnapshot },
    '@/lib/collaboration/document-enable-media': {},
    '@/lib/collaboration/document-assets': {},
  });
}
const receipt={operationId:'12345678-1234-4234-8234-123456789abc',sessionFingerprint:'a'.repeat(64),updateDigest:'b'.repeat(64),documentSequence:3};
const sessionToken='t'.repeat(43),descriptor={sessionToken,sessionFingerprint:createHash('sha256').update(sessionToken).digest('hex'),actorId:'a',projectId:'p',ownerId:'o',grantGeneration:'1',expiresAt:'2030-01-01T00:00:00.000Z',retainUntil:'2030-02-01T00:00:00.000Z'};

afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.restoreAllMocks();});
describe('document request execution scope',()=>{
  it('executes a root task and admits its authenticated actor',async()=>{
    const result=await runDocumentExecution({},async scope=>{scope.admitActor('synthetic-actor');return 7;});
    expect(result).toBe(7);
  });
  it('returns the original pool outside scope and shares one scope across a duplicate module and nested calls',async()=>{
    const raw=new FakePool();expect(resolvePool(raw)).toBe(raw);vi.resetModules();const second=await import('@/lib/collaboration/document-execution-scope');
    await runDocumentExecution({},async scope=>{expect(getDocumentExecutionScope()).toBe(scope);expect(second.getDocumentExecutionScope()).toBe(scope);expect(resolvePool(raw)===(raw as unknown as Pool)).toBe(false);
      await second.runDocumentExecution({timeoutMs:1},async nested=>{expect(nested).toBe(scope);reserveDocumentExecutionActor('actor-a')();});expect(scope.remainingMs()).toBeGreaterThan(1);});
    expect(getDocumentExecutionScope()).toBeNull();expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('shares the same ALS and resolver with an independently evaluated CommonJS copy',async()=>{
    const copy = loadDocumentCommonJs<typeof import('@/lib/collaboration/document-execution-scope')>(
      new URL('../../lib/collaboration/document-execution-scope.ts', import.meta.url),
    );
    await runDocumentExecution({},async scope=>{expect(copy.getDocumentExecutionScope()).toBe(scope);await copy.runDocumentExecution({},async nested=>expect(nested).toBe(scope));});
  });
  it('uses owned connects for pool.query with Promise, config and callbacks',async()=>{
    const raw=new FakePool();await runDocumentExecution({},async()=>{const pool=resolvePool(raw);
      await pool.query('SELECT 1');await new Promise<void>((resolve,reject)=>pool.query('SELECT $1',[1],cause=>cause?reject(cause):resolve()));
      await new Promise<void>((resolve,reject)=>pool.query({text:'SELECT 2',values:[]},cause=>cause?reject(cause):resolve()));
    });expect(raw.connects).toBe(3);expect(raw.client.calls).toEqual(['SELECT 1','SELECT $1','SELECT 2']);expect(raw.client.releases).toEqual([false,false,false]);
  });
  it('preserves only the lock-timeout SQLSTATE in Promise and callback queries',async()=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Object.assign(Error('private SQL credential'),{code:'55P03'});};
    await runDocumentExecution({},async()=>{const pool=resolvePool(raw);const caught=await pool.query('SELECT 1').catch(cause=>cause);
      expect(caught).toMatchObject({code:'55P03',message:'DOCUMENT_DATABASE_BUSY'});expect(String(caught)).not.toContain('private');
      await new Promise<void>((resolve,reject)=>pool.query('SELECT 1',cause=>{try{expect(cause).toMatchObject({code:'55P03',message:'DOCUMENT_DATABASE_BUSY'});resolve();}catch(error){reject(error);}}));});
  });
  it('preserves serialization conflict SQLSTATE without leaking driver text',async()=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Object.assign(Error('private SQL credential'),{code:'40001'});};
    await runDocumentExecution({},async()=>{const caught=await resolvePool(raw).query('SELECT 1').catch(cause=>cause);expect(caught).toMatchObject({code:'40001',message:'DOCUMENT_DATABASE_SERIALIZATION_CONFLICT'});expect(String(caught)).not.toContain('private');});
  });
  it('preserves the actual project reader retry after a synthetic 40001',async()=>{
    const raw=new FakePool();let conflicts=0;raw.client.handler=async sql=>{
      if(sql.includes('SELECT enabled FROM')){if(conflicts++===0)throw Object.assign(Error('private SQL'),{code:'40001'});return {rows:[{enabled:true}],rowCount:1};}
      if(sql.includes('SELECT data_value'))return {rows:[{data_value:[{id:'project-a',userId:'owner-a',name:'fixture',createdAt:1,updatedAt:1,canvasImages:[]}]}],rowCount:1};
      if(sql.includes('SELECT project_id FROM wujie_project_document_settings'))return {rows:[],rowCount:0};return {rows:[],rowCount:1};
    };
    const reader=loadSyntheticProjectBridge(raw);const result=await runDocumentExecution({},()=>reader.readCollaborativeProject('owner-a','project-a'));
    expect(result.projectId).toBe('project-a');expect(conflicts).toBe(2);expect(raw.client.calls.filter(sql=>sql==='BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ')).toHaveLength(2);
  });
  it('keeps the inherited name in the media directory while both workspace reads use the current document name', async () => {
    const raw = new FakePool(), doc = canvasDocument.createCanvasDocument();
    const transform = { x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1 };
    const media = { ...transform, id: 'image-a', name: '旧图层', placementId: 'p1', assetVersionId: 'version-a',
      url: '/api/serve-upload/a.png', originalWidth: 80, originalHeight: 60, createdAt: 1 };
    const project = { id: 'project-a', userId: 'owner-a', name: 'fixture', createdAt: 1, updatedAt: 1, canvasImages: [media] };
    raw.client.handler = async sql => {
      if (sql.includes('SELECT enabled FROM')) return { rowCount: 1, rows: [{ enabled: true }] };
      if (sql.includes('SELECT data_value')) return { rowCount: 1, rows: [{ data_value: [project] }] };
      if (sql.includes('SELECT project_id FROM')) return { rowCount: 1, rows: [{ project_id: 'project-a' }] };
      return { rowCount: 1, rows: [] };
    };
    const reader = loadSyntheticProjectBridge(raw, doc);
    try {
      canvasDocument.applyCanvasImagePatch(doc, { placementId: 'p1', assetVersionId: 'version-a', ...transform }, 'fixture');
      for (const [name, visible] of [[undefined, '旧图层'], ['当前图层', '当前图层'], [null, '旧图层']] as const) {
        if (name !== undefined) canvasDocument.applyCanvasImagePatch(doc, { placementId: 'p1', name }, 'fixture');
        const detail = await runDocumentExecution({}, () => reader.readCollaborativeProject('owner-a', 'project-a'));
        const [listed] = await runDocumentExecution({}, () => reader.readOwnerProjectsWithDocuments('owner-a', [project as Project]));
        expect(detail.canvasImages[0].name).toBe('旧图层');
        expect(detail.workspace.canvasImages[0].name).toBe(visible);
        expect(listed.canvasImages[0].name).toBe(visible);
      }
    } finally { doc.destroy(); }
  });
  it('observes an end emitted synchronously after the checkout callback and before its promise continuation',async()=>{
    const raw=new FakePool(),client=raw.client as FakeClient&{_ended:boolean};client._ended=false;
    raw.connect=cb=>{raw.connects++;cb(null,client);client._ended=true;client.emit('end');};client.release=function(discard?:boolean):void{this.releases.push(!!discard);};
    try {await runDocumentExecution({},async()=>{const acquired=await resolvePool(raw).connect();acquired.release(true);});await tick();expect(client.releases).toEqual([true]);expect(getDocumentExecutionStats().activeScopes).toBe(0);}
    finally {if(getDocumentExecutionStats().activeScopes)client.emit('end');await tick();}
  });
  it('drains after COMMIT callback and end both precede discard without a second end event',async()=>{
    const raw=new FakePool(),client=raw.client as FakeClient&{_ended:boolean};client._ended=false;
    client.query=function(sql:string|{text:string},...args:unknown[]):void{this.calls.push(typeof sql==='string'?sql:sql.text);const cb=args[args.length-1] as (error:Error|null)=>void;queueMicrotask(()=>{cb(Error('connection terminated'));this._ended=true;this.emit('end');});};
    client.release=function(discard?:boolean):void{this.releases.push(!!discard);};
    try{const result=await runDocumentExecution({},async()=>{const acquired=await resolvePool(raw).connect();try{await acquired.query('COMMIT');}finally{acquired.release(true);}}).catch(cause=>cause);
      expect(documentExecutionHttpFailure(result)?.code).toBe('DOCUMENT_EXCHANGE_UNCERTAIN');expect(client.releases).toEqual([true]);await tick();expect(getDocumentExecutionStats().activeScopes).toBe(0);
    }finally{if(getDocumentExecutionStats().activeScopes)client.emit('end');await tick();}
  });
  it('retains a normal-release client that the pool removes until its delayed end',async()=>{
    const raw=new FakePool(),client=raw.client as FakeClient&{_queryable:boolean;_ending:boolean};client._queryable=false;client._ending=false;
    client.release=function(discard?:boolean):void{this.releases.push(!!discard);this._ending=true;};
    await runDocumentExecution({},async()=>{const acquired=await resolvePool(raw).connect();await acquired.query('SELECT 1');acquired.release();});
    expect(client.releases).toEqual([false]);expect(getDocumentExecutionStats()).toMatchObject({activeScopes:1,ownedClients:1});client.emit('end');await tick();expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it.each(['pool-ending','not-queryable','client-ending','max-uses','expired'] as const)('waits for end when normal release causes pool removal: %s',async reason=>{
    const raw=new FakePool(),client=raw.client as FakeClient&{_poolUseCount:number},options={maxUses:10},expired=new Set<FakeClient>();client._poolUseCount=reason==='max-uses'?9:0;
    if(reason==='pool-ending')raw.ending=true;if(reason==='not-queryable')client._queryable=false;if(reason==='client-ending')client._ending=true;if(reason==='expired')expired.add(client);
    client.release=function(discard?:boolean):void{this.releases.push(!!discard);this._poolUseCount++;if(discard||raw.ending||!this._queryable||this._ending||this._poolUseCount>=options.maxUses||expired.has(this)){raw._clients.splice(0,1);this._ending=true;}};
    await runDocumentExecution({},async()=>{const acquired=await resolvePool(raw).connect();acquired.release();});expect(client.releases).toEqual([false]);expect(getDocumentExecutionStats()).toMatchObject({activeScopes:1,ownedClients:1});
    client.emit('end');await tick();expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('returns a healthy normal-release client without waiting for an end event',async()=>{
    const raw=new FakePool();raw.client.automaticEnd=false;await runDocumentExecution({},async()=>{const client=await resolvePool(raw).connect();client.release();});
    expect(raw.client.releases).toEqual([false]);expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it.each(['Connection terminated','ECONNRESET','ETIMEDOUT','timeout','connection is closed'])('retains a fixed transient hint for %s without private text',async hint=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Error(`private SQL account ${hint} secret`);};
    await runDocumentExecution({},async()=>{const caught=await resolvePool(raw).query('SELECT 1').catch(cause=>cause);expect(['Connection terminated','timeout']).toContain(caught.message);expect(caught.message).not.toContain('private');expect(caught.message).not.toContain('secret');});
  });
  it.each([{code:'ECONNRESET',message:'Connection terminated'},{code:'ETIMEDOUT',message:'timeout'}])('maps a code-only transient to a fixed callback hint: $code',async fixture=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Object.assign(Error('private SQL credential'),{code:fixture.code});};
    await runDocumentExecution({},async()=>{await new Promise<void>((resolve,reject)=>resolvePool(raw).query('SELECT 1',cause=>{try{expect(cause?.message).toBe(fixture.message);expect(String(cause)).not.toContain('private');resolve();}catch(error){reject(error);}}));});
  });
  it('never supplies a transient retry hint for an unknown COMMIT',async()=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Object.assign(Error('timeout private'),{code:'55P03'});};
    const caught=await runDocumentExecution({},async()=>{const client=await resolvePool(raw).connect();try{await client.query('COMMIT');}finally{client.release();}}).catch(cause=>cause);
    expect(documentExecutionHttpFailure(caught)?.code).toBe('DOCUMENT_EXCHANGE_UNCERTAIN');expect(String(caught)).not.toContain('timeout');expect((caught as {code?:string}).code).not.toBe('55P03');expect(raw.client.calls).toEqual(['COMMIT']);
  });
  it('lets the actual execSql retry twice inside the same budget with a synthetic pool',async()=>{
    vi.useFakeTimers();vi.stubEnv('DATABASE_URL','postgresql://synthetic.invalid/scope-test');vi.stubEnv('PGDATABASE_URL','');vi.spyOn(console,'warn').mockImplementation(()=>{});
    const raw=new FakePool();let calls=0;raw.client.handler=async()=>{calls++;if(calls<3)throw Error('ETIMEDOUT private credential');return {rows:[{ok:true}],rowCount:1};};
    const symbol=Symbol.for('wujie.databasePoolRegistry.v1'),global=globalThis as unknown as Record<symbol,unknown>,previous=global[symbol];delete global[symbol];
    try{const db=loadSyntheticDbClient(raw);const running=runDocumentExecution({timeoutMs:10_000},()=>db.execSql('SELECT 1'));await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(1000);await vi.advanceTimersByTimeAsync(2000);
      expect((await running).rows).toEqual([{ok:true}]);expect(calls).toBe(3);expect(raw.connects).toBe(3);
    }finally{if(previous===undefined)delete global[symbol];else global[symbol]=previous;}
  });
  it('does not retry an unknown COMMIT through the actual execSql classifier',async()=>{
    vi.stubEnv('DATABASE_URL','postgresql://synthetic.invalid/scope-test');vi.stubEnv('PGDATABASE_URL','');vi.spyOn(console,'warn').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
    const raw=new FakePool();raw.client.handler=async()=>{throw Error('timeout private credential');};const symbol=Symbol.for('wujie.databasePoolRegistry.v1'),global=globalThis as unknown as Record<symbol,unknown>,previous=global[symbol];delete global[symbol];
    try{const db=loadSyntheticDbClient(raw);const caught=await runDocumentExecution({},()=>db.execSql('COMMIT')).catch(cause=>cause);expect(documentExecutionHttpFailure(caught)?.code).toBe('DOCUMENT_EXCHANGE_UNCERTAIN');expect(raw.client.calls).toEqual(['COMMIT']);expect(raw.connects).toBe(1);}
    finally{if(previous===undefined)delete global[symbol];else global[symbol]=previous;}
  });
  it('prevents the actual execSql from dispatching another retry after the original budget',async()=>{
    vi.useFakeTimers();vi.stubEnv('DATABASE_URL','postgresql://synthetic.invalid/scope-test');vi.stubEnv('PGDATABASE_URL','');vi.spyOn(console,'warn').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
    const raw=new FakePool();raw.client.handler=async()=>{throw Error('ETIMEDOUT private');};const symbol=Symbol.for('wujie.databasePoolRegistry.v1'),global=globalThis as unknown as Record<symbol,unknown>,previous=global[symbol];delete global[symbol];
    try{const db=loadSyntheticDbClient(raw),running=runDocumentExecution({timeoutMs:1500},()=>db.execSql('SELECT 1')),outcome=running.then(()=> 'ok',cause=>documentExecutionHttpFailure(cause)?.code);
      await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(1000);expect(raw.client.calls).toHaveLength(2);await vi.advanceTimersByTimeAsync(500);expect(await outcome).toBe('DOCUMENT_EXCHANGE_REQUEST_TIMEOUT');
      expect(getDocumentExecutionStats().activeScopes).toBe(1);await vi.advanceTimersByTimeAsync(1500);await tick();expect(raw.client.calls).toHaveLength(2);expect(raw.connects).toBe(2);expect(getDocumentExecutionStats().activeScopes).toBe(0);
    }finally{if(previous===undefined)delete global[symbol];else global[symbol]=previous;}
  });
  it.each([-3_600_000,3_600_000])('does not change the running budget when wall clock shifts by %i',async offset=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));const hold=deferred<void>();let before=0,after=0,remaining:()=>number=()=>0;
    const run=runDocumentExecution({timeoutMs:1000},async scope=>{before=scope.remainingMs();vi.setSystemTime(Date.now()+offset);after=scope.remainingMs();scope.assertActive();remaining=()=>scope.remainingMs();await hold.promise;});const outcome=run.then(()=>null,cause=>cause);
    await tick();try{expect(after).toBe(before);await vi.advanceTimersByTimeAsync(999);expect(remaining()).toBe(1);expect(getDocumentExecutionStats().activeScopes).toBe(1);}finally{hold.resolve();await outcome;}
  });
  it('supports a Promise-only pool and client through both outward call styles',async()=>{
    const raw=new PromisePool(),resolver=(globalThis as unknown as Record<symbol,unknown>)[Symbol.for('wujie.documentRequestPoolScope.v1')] as (pool:Pool)=>Pool;
    await runDocumentExecution({},async()=>{const pool=resolver(raw as unknown as Pool);expect((await pool.query('SELECT 1')).rows).toEqual([1]);
      await new Promise<void>((resolve,reject)=>pool.query('SELECT 2',cause=>cause?reject(cause):resolve()));});
    expect(raw.client.calls).toEqual(['SELECT 1','SELECT 2']);expect(raw.client.releases).toEqual([false,false]);
  });
  it('supports callback connect and returns its owned idempotent release',async()=>{
    const raw=new FakePool();await runDocumentExecution({},async()=>{await new Promise<void>((resolve,reject)=>resolvePool(raw).connect((cause,client,done)=>{
      if(cause||!client||!done){reject(cause??Error('missing'));return;}client.query('SELECT 1',queryError=>{if(queryError){reject(queryError);return;}done();done();resolve();});}));});
    expect(raw.client.releases).toEqual([false]);
  });
  it('does not expose raw pool internals or another untracked connection method',async()=>{
    const raw=new FakePool();await runDocumentExecution({},async()=>{const pool=resolvePool(raw);
      expect(()=>Reflect.get(pool,'_acquireClient')).toThrow('DOCUMENT_EXECUTION_UNSUPPORTED');expect(()=>Reflect.get(pool,'end')).toThrow('DOCUMENT_EXECUTION_UNSUPPORTED');
      const client=await pool.connect();expect(()=>Reflect.get(client,'connection')).toThrow('DOCUMENT_EXECUTION_UNSUPPORTED');client.release();});
    expect(raw.connects).toBe(1);
  });
  it('retains a timed-out non-cooperative task and observed body until both settle',async()=>{
    vi.useFakeTimers();const work=deferred<void>(),body=deferred<void>();let observed:Promise<void>|undefined,signal:AbortSignal|undefined;
    const result=runDocumentExecution({timeoutMs:10},async scope=>{reserveDocumentExecutionActor('actor-a')();signal=scope.signal;observed=scope.observe(body.promise);await work.promise;});
    const outcome=result.then(()=> 'ok',cause=>documentExecutionHttpFailure(cause)?.code);await tick();expect(observed).toBe(body.promise);
    await vi.advanceTimersByTimeAsync(10);expect(await outcome).toBe('DOCUMENT_EXCHANGE_REQUEST_TIMEOUT');expect(signal?.aborted).toBe(true);expect(getDocumentExecutionStats()).toMatchObject({activeScopes:1,drainingScopes:1,activeObserved:1,actorAdmissions:1});
    work.resolve();await tick();expect(getDocumentExecutionStats().activeScopes).toBe(1);body.resolve();await tick();expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('observes a reader cancellation started by the abort signal until that cleanup settles',async()=>{
    vi.useFakeTimers();const work=deferred<void>(),cancel=deferred<void>();let registered=false;
    const run=runDocumentExecution({timeoutMs:10},async scope=>{scope.signal.addEventListener('abort',()=>{try{expect(()=>scope.observe(cancel.promise)).toThrow();scope.observeCleanup(cancel.promise);registered=true;}catch{/* The assertion records a rejected cleanup registration. */}},{once:true});await work.promise;});
    const outcome=run.then(()=> 'ok',cause=>documentExecutionHttpFailure(cause)?.code);await tick();await vi.advanceTimersByTimeAsync(10);expect(await outcome).toBe('DOCUMENT_EXCHANGE_REQUEST_TIMEOUT');if(!registered){work.resolve();cancel.resolve();await tick();}expect(registered).toBe(true);
    work.resolve();await tick();expect(getDocumentExecutionStats()).toMatchObject({activeScopes:1,activeObserved:1});cancel.resolve();await tick();expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('holds a late acquire and destroys only its owned client until end',async()=>{
    vi.useFakeTimers();const raw=new FakePool();raw.pending=deferred<FakeClient>();raw.client.automaticEnd=false;
    const result=runDocumentExecution({timeoutMs:10},async()=>{await resolvePool(raw).connect();});const outcome=result.then(()=> 'ok',cause=>documentExecutionHttpFailure(cause)?.code);await tick();
    await vi.advanceTimersByTimeAsync(10);expect(await outcome).toBe('DOCUMENT_EXCHANGE_REQUEST_TIMEOUT');expect(getDocumentExecutionStats()).toMatchObject({activeScopes:1,activeAcquires:1});
    raw.pending.resolve(raw.client);await tick();expect(raw.client.releases).toEqual([true]);expect(getDocumentExecutionStats()).toMatchObject({activeScopes:1,activeAcquires:0,ownedClients:1});
    raw.client.emit('end');await tick();expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('keeps a late failing acquire accounted until the callback actually settles',async()=>{
    vi.useFakeTimers();const raw=new FakePool();raw.pending=deferred<FakeClient>();
    const run=runDocumentExecution({timeoutMs:10},async()=>{await resolvePool(raw).connect();});const result=run.then(()=> 'ok',cause=>documentExecutionHttpFailure(cause)?.code);
    await tick();await vi.advanceTimersByTimeAsync(10);expect(await result).toBe('DOCUMENT_EXCHANGE_REQUEST_TIMEOUT');expect(getDocumentExecutionStats().activeAcquires).toBe(1);
    raw.pending.reject(Error('private failure'));await tick();expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('never returns a destroyed client twice when timeout and finally compete',async()=>{
    vi.useFakeTimers();const raw=new FakePool(),pending=deferred<unknown>();raw.client.automaticEnd=false;raw.client.handler=()=>pending.promise;
    const run=runDocumentExecution({timeoutMs:10},async()=>{const client=await resolvePool(raw).connect();try{await client.query('SELECT 1');}finally{client.release();client.release();}});
    const result=run.then(()=> 'ok',cause=>documentExecutionHttpFailure(cause)?.code);await tick();await vi.advanceTimersByTimeAsync(10);expect(await result).toBe('DOCUMENT_EXCHANGE_REQUEST_TIMEOUT');
    expect(raw.client.releases).toEqual([true]);pending.resolve({rows:[]});await tick();expect(getDocumentExecutionStats().activeScopes).toBe(1);raw.client.emit('end');await tick();expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('returns callback once for an abort with a late result',async()=>{
    vi.useFakeTimers();const raw=new FakePool();raw.pending=deferred<FakeClient>();const cb=vi.fn();
    const run=runDocumentExecution({timeoutMs:10},async()=>{await new Promise<void>(resolve=>{resolvePool(raw).connect(cause=>{cb(cause?.message);resolve();});});});
    const result=run.then(()=> 'ok',cause=>documentExecutionHttpFailure(cause)?.code);await tick();await vi.advanceTimersByTimeAsync(10);expect(await result).toBe('DOCUMENT_EXCHANGE_REQUEST_TIMEOUT');await tick();
    expect(cb).toHaveBeenCalledTimes(1);raw.pending.resolve(raw.client);await tick();expect(cb).toHaveBeenCalledTimes(1);expect(raw.client.releases).toEqual([true]);expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('holds a hung query after client destruction until the underlying query settles',async()=>{
    vi.useFakeTimers();const raw=new FakePool(),query=deferred<unknown>();raw.client.handler=()=>query.promise;
    const result=runDocumentExecution({timeoutMs:10},async()=>{const client=await resolvePool(raw).connect();try{await client.query('SELECT 1');}finally{client.release();}});
    const outcome=result.then(()=> 'ok',cause=>documentExecutionHttpFailure(cause)?.code);await tick();await vi.advanceTimersByTimeAsync(10);expect(await outcome).toBe('DOCUMENT_EXCHANGE_REQUEST_TIMEOUT');await tick();
    expect(raw.client.releases).toEqual([true]);expect(getDocumentExecutionStats()).toMatchObject({activeScopes:1,activeQueries:1});query.resolve({rows:[],rowCount:0});await tick();expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('returns unknown after dispatched COMMIT times out, even when the driver succeeds later',async()=>{
    vi.useFakeTimers();const raw=new FakePool(),commit=deferred<unknown>();raw.client.handler=sql=>sql==='COMMIT'?commit.promise:Promise.resolve({rows:[],rowCount:0});
    const result=runDocumentExecution({timeoutMs:10},async()=>{const client=await resolvePool(raw).connect();try{await client.query('COMMIT');}finally{client.release();}});
    const outcome=result.then(()=> 'ok',cause=>documentExecutionHttpFailure(cause)?.code);await tick();await vi.advanceTimersByTimeAsync(10);expect(await outcome).toBe('DOCUMENT_EXCHANGE_UNCERTAIN');
    expect(getDocumentExecutionStats().activeQueries).toBe(1);commit.resolve({rows:[],rowCount:0});await tick();expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it.each([{sql:'/* transaction */ COMMIT',code:'DOCUMENT_EXCHANGE_UNCERTAIN'},{sql:"SELECT 'COMMIT'",code:'DOCUMENT_EXCHANGE_REQUEST_TIMEOUT'}])('classifies timed out SQL by the dispatched command: $sql',async({sql,code})=>{
    vi.useFakeTimers();const raw=new FakePool(),pending=deferred<unknown>();raw.client.handler=()=>pending.promise;
    const run=runDocumentExecution({timeoutMs:10},async()=>{const client=await resolvePool(raw).connect();try{await client.query(sql);}finally{client.release();}});
    const outcome=run.then(()=> 'ok',cause=>documentExecutionHttpFailure(cause)?.code);await tick();await vi.advanceTimersByTimeAsync(10);try{expect(await outcome).toBe(code);}finally{pending.resolve({rows:[]});await tick();}expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('forbids any new SQL after an abort and preserves unknown COMMIT',async()=>{
    const raw=new FakePool(),pending=deferred<unknown>(),abort=new AbortController();raw.client.handler=()=>pending.promise;let client:PoolClient|undefined;
    const run=runDocumentExecution({signal:abort.signal},async()=>{const acquired=await resolvePool(raw).connect();client=acquired;try{await acquired.query('COMMIT');}finally{acquired.release();}});
    const result=run.then(()=> 'ok',cause=>documentExecutionHttpFailure(cause)?.code);await tick();abort.abort();expect(await result).toBe('DOCUMENT_EXCHANGE_UNCERTAIN');
    await expect((client as PoolClient|undefined)!.query('SELECT 1')).rejects.toMatchObject({code:'UNCERTAIN'});expect(raw.client.calls).toEqual(['COMMIT']);pending.resolve({rows:[]});await tick();expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('permits the caller to confirm an exact recovery within the existing budget',async()=>{
    const raw=new FakePool();let commits=0;raw.client.handler=async sql=>{if(sql==='COMMIT'&&commits++===0)throw Error('synthetic failure');return {rows:[{found:true}],rowCount:1};};
    const result=await runDocumentExecution({},async scope=>{const client=await resolvePool(raw).connect();scope.bindCommit(client,{kind:'update',expected:receipt});try{await client.query('COMMIT');}catch{const lookup=await client.query('SELECT 1');expect(lookup.rows).toHaveLength(1);scope.confirmCommitRecovery(client,receipt);}finally{client.release();}return 'confirmed';});
    expect(result).toBe('confirmed');
  });
  it('rejects confirmation while COMMIT is in flight and leaves untracked mock clients as no-ops',async()=>{
    const raw=new FakePool(),commit=deferred<unknown>();raw.client.handler=()=>commit.promise;
    await runDocumentExecution({},async scope=>{scope.bindCommit(raw.client as unknown as PoolClient,{kind:'update',expected:receipt});scope.confirmCommitRecovery(raw.client as unknown as PoolClient,receipt);const client=await resolvePool(raw).connect();scope.bindCommit(client,{kind:'update',expected:receipt});
      const pending=client.query('COMMIT');expect(()=>scope.confirmCommitRecovery(client,receipt)).toThrow('DOCUMENT_EXECUTION_UNCERTAIN');commit.resolve({rows:[]});await pending;client.release();});
  });
  it.each(['operationId','sessionFingerprint','updateDigest','documentSequence'] as const)('refuses mismatched recovered update %s and does not clear unknown',async field=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Error('commit failed');};
    const result=await runDocumentExecution({},async scope=>{const client=await resolvePool(raw).connect();scope.bindCommit(client,{kind:'update',expected:receipt});
      try{await client.query('COMMIT');}catch{const wrong={...receipt,[field]:field==='documentSequence'?4:field==='operationId'?'87654321-1234-4234-8234-123456789abc':'c'.repeat(64)};
        expect(()=>scope.confirmCommitRecovery(client,wrong)).toThrow('DOCUMENT_EXECUTION_UNCERTAIN');scope.confirmCommitRecovery(raw.client as unknown as PoolClient,receipt);return 'unverified';}finally{client.release();}}).catch(cause=>cause);
    expect(documentExecutionHttpFailure(result)?.code).toBe('DOCUMENT_EXCHANGE_UNCERTAIN');
  });
  it('accepts the original non-UUID operation id contract and rejects invalid ids',async()=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Error('commit failed');};const original={...receipt,operationId:'LegacyOperation_ID-0123456789'};
    const result=await runDocumentExecution({},async scope=>{const client=await resolvePool(raw).connect();
      expect(()=>scope.bindCommit(client,{kind:'update',expected:{...receipt,operationId:'short'}})).toThrow();expect(()=>scope.bindCommit(client,{kind:'update',expected:{...receipt,operationId:'bad-symbol-@-123456'}})).toThrow();
      scope.bindCommit(client,{kind:'update',expected:original});try{await client.query('COMMIT');}catch{scope.confirmCommitRecovery(client,original);return 'confirmed';}finally{client.release();}});expect(result).toBe('confirmed');
  });
  it('accepts only a matching authorized recovered session with nondecreasing expiry',async()=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Error('commit failed');};
    const result=await runDocumentExecution({},async scope=>{const client=await resolvePool(raw).connect();scope.bindCommit(client,{kind:'session',expected:descriptor});
      try{await client.query('COMMIT');}catch{expect(()=>scope.confirmCommitRecovery(client,{...descriptor,ownerId:'other'})).toThrow();expect(()=>scope.confirmCommitRecovery(client,{...descriptor,expiresAt:'2029-01-01T00:00:00.000Z'})).toThrow();
        scope.confirmCommitRecovery(client,{...descriptor,expiresAt:'2030-01-02T00:00:00.000Z'});return 'confirmed';}finally{client.release();}});expect(result).toBe('confirmed');
  });
  it.each(['actorId','projectId','ownerId','grantGeneration','sessionToken','sessionFingerprint','retainUntil'] as const)('retains unknown for changed recovered session %s',async field=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Error('commit failed');};
    const result=await runDocumentExecution({},async scope=>{const client=await resolvePool(raw).connect();scope.bindCommit(client,{kind:'session',expected:descriptor});
      try{await client.query('COMMIT');}catch{const changed={...descriptor,[field]:field==='grantGeneration'?'2':field==='retainUntil'?'2030-03-01T00:00:00.000Z':field==='sessionToken'?'z'.repeat(43):field==='sessionFingerprint'?'f'.repeat(64):'other'};
        expect(()=>scope.confirmCommitRecovery(client,changed)).toThrow();return 'unverified';}finally{client.release();}}).catch(cause=>cause);expect(documentExecutionHttpFailure(result)?.code).toBe('DOCUMENT_EXCHANGE_UNCERTAIN');
  });
  it('keeps a frozen binding despite later mutation of the caller object',async()=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Error('commit failed');};const mutable={...receipt};
    const result=await runDocumentExecution({},async scope=>{const client=await resolvePool(raw).connect();scope.bindCommit(client,{kind:'update',expected:mutable});mutable.updateDigest='c'.repeat(64);
      try{await client.query('COMMIT');}catch{expect(()=>scope.confirmCommitRecovery(client,mutable)).toThrow();scope.confirmCommitRecovery(client,receipt);return 'confirmed';}finally{client.release();}});expect(result).toBe('confirmed');
  });
  it('rejects a tracked client belonging to another concurrent root',async()=>{
    const raw=new FakePool(),ready=deferred<PoolClient>(),done=deferred<void>();
    const first=runDocumentExecution({},async()=>{const client=await resolvePool(raw).connect();ready.resolve(client);await done.promise;client.release();});
    const foreign=await ready.promise;await runDocumentExecution({},async scope=>{expect(()=>scope.bindCommit(foreign,{kind:'update',expected:receipt})).toThrow();expect(()=>scope.confirmCommitRecovery(foreign,receipt)).toThrow();});done.resolve();await first;
  });
  it('cannot add a cleanup observer after root work has finished',async()=>{
    let saved:Parameters<Parameters<typeof runDocumentExecution>[1]>[0]|undefined;await runDocumentExecution({},async scope=>{saved=scope;});
    expect(()=>saved!.observeCleanup(Promise.resolve())).toThrow('DOCUMENT_EXECUTION_UNAVAILABLE');
  });
  it('rejects unknown and extra failure payload fields',async()=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Error('commit failed');};
    const result=await runDocumentExecution({},async scope=>{const client=await resolvePool(raw).connect();try{await client.query('COMMIT');}catch{
      expect(()=>scope.allowFailureResponse(403,{success:false,code:'FAKE'})).toThrow();expect(()=>scope.allowFailureResponse(403,{success:false,code:'DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN',extra:true})).toThrow();expect(()=>scope.allowFailureResponse(200,{success:false,code:'DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN'})).toThrow();return new Response(null,{status:403});}finally{client.release();}}).catch(cause=>cause);
    expect(documentExecutionHttpFailure(result)?.code).toBe('DOCUMENT_EXCHANGE_UNCERTAIN');
  });
  it('preserves an unrelated legacy failure response when there is no uncertain commit',async()=>{
    const result=await runDocumentExecution({},async scope=>{scope.allowFailureResponse(403,{success:false,code:'EXISTING_LEGACY_ERROR'});return new Response(null,{status:403});});expect(result.status).toBe(403);
  });
  it('never returns success while an unawaited COMMIT is still in flight',async()=>{
    const raw=new FakePool(),commit=deferred<unknown>();raw.client.handler=()=>commit.promise;
    const outcome=await runDocumentExecution({},async()=>{const client=await resolvePool(raw).connect();void client.query('COMMIT').catch(()=>undefined);return new Response(null,{status:200});}).catch(cause=>cause);
    expect(documentExecutionHttpFailure(outcome)?.code).toBe('DOCUMENT_EXCHANGE_UNCERTAIN');expect(getDocumentExecutionStats().activeQueries).toBe(1);commit.resolve({rows:[]});await tick();expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('keeps an unconfirmed COMMIT error uncertain and maps no raw driver details',async()=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Error('secret SQL');};
    const caught=await runDocumentExecution({},async()=>{const client=await resolvePool(raw).connect();try{await client.query('COMMIT');}finally{client.release();}}).catch(cause=>cause);
    expect(documentExecutionHttpFailure(caught)).toEqual({status:503,code:'DOCUMENT_EXCHANGE_UNCERTAIN'});expect(String(caught)).not.toContain('secret');
  });
  it('permits an explicitly approved 403 response while preserving an uncertain commit',async()=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Error('private');};
    const result=await runDocumentExecution({},async scope=>{const client=await resolvePool(raw).connect();try{await client.query('COMMIT');}catch{scope.allowFailureResponse(403,{success:false,code:'DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN'});return new Response(null,{status:403});}finally{client.release();}});
    expect(result?.status).toBe(403);
  });
  it.each([{status:500,code:'DOCUMENT_INTERNAL_ERROR'},{status:503,code:'DOCUMENT_EXCHANGE_UNAVAILABLE'}])('does not disguise an unknown COMMIT as $code',async failure=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Error('commit timeout');};let issued=0;
    const result=await runDocumentExecution({},async scope=>{const client=await resolvePool(raw).connect();try{issued++;await client.query('COMMIT');}catch{scope.allowFailureResponse(failure.status,{success:false,code:failure.code});return new Response(null,{status:failure.status});}finally{client.release();}}).catch(cause=>cause);
    expect(documentExecutionHttpFailure(result)).toEqual({status:503,code:'DOCUMENT_EXCHANGE_UNCERTAIN'});expect(issued).toBe(1);expect(raw.client.calls).toEqual(['COMMIT']);
  });
  it.each(['issue','consume'] as const)('keeps actual ticket %s COMMIT unknown despite ordinary route classification',async action=>{
    const raw=new FakePool();let inserts=0,deletes=0;raw.client.handler=async sql=>{
      if(sql==='COMMIT')throw Error('timeout private');if(sql.includes('INSERT INTO wujie_document_tickets'))inserts++;
      if(sql.includes('DELETE FROM wujie_document_tickets')&&sql.includes('consumed_at IS NULL'))deletes++;
      if(sql.includes('SELECT COUNT(*)'))return {rows:[{count:0}],rowCount:1};
      if(sql.includes('SELECT user_id, project_id'))return {rows:[{user_id:'owner-a',project_id:'project-a',owner_id:'owner-a',grant_generation:'0'}],rowCount:1};
      return {rows:[],rowCount:1};
    };
    const service=loadSyntheticTicketService(raw),failure=action==='issue'?{status:500,code:'DOCUMENT_INTERNAL_ERROR'}:{status:503,code:'DOCUMENT_EXCHANGE_UNAVAILABLE'};
    const result=await runDocumentExecution({},async scope=>{try{if(action==='issue')await service.issueDocumentTicket('owner-a','project-a');else await service.consumeDocumentTicket('t'.repeat(43));return new Response(null,{status:200});}
      catch{scope.allowFailureResponse(failure.status,{success:false,code:failure.code});return new Response(null,{status:failure.status});}}).catch(cause=>cause);
    expect(documentExecutionHttpFailure(result)).toEqual({status:503,code:'DOCUMENT_EXCHANGE_UNCERTAIN'});expect(raw.client.calls.filter(sql=>sql==='COMMIT')).toHaveLength(1);expect(inserts).toBe(action==='issue'?1:0);expect(deletes).toBe(action==='consume'?1:0);
  });
  it('preserves an explicitly authorized 503 UNCERTAIN failure response',async()=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Error('commit timeout');};
    const result=await runDocumentExecution({},async scope=>{const client=await resolvePool(raw).connect();try{await client.query('COMMIT');}catch{scope.allowFailureResponse(503,{success:false,code:'DOCUMENT_EXCHANGE_UNCERTAIN'});return new Response(null,{status:503});}finally{client.release();}});expect(result?.status).toBe(503);
  });
  it('does not permit failure approval or acknowledge a receipt after the scope deadline',async()=>{
    vi.useFakeTimers();const raw=new FakePool(),gate=deferred<void>();raw.client.handler=async()=>{throw Error('commit error');};let attempted=false;
    const run=runDocumentExecution({timeoutMs:10},async scope=>{const client=await resolvePool(raw).connect();scope.bindCommit(client,{kind:'update',expected:receipt});try{await client.query('COMMIT');}catch{await gate.promise;expect(()=>scope.allowFailureResponse(403,{success:false,code:'DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN'})).toThrow();expect(()=>scope.confirmCommitRecovery(client,receipt)).toThrow();attempted=true;return new Response(null,{status:403});}finally{client.release();}});
    const result=run.then(()=> 'ok',cause=>documentExecutionHttpFailure(cause)?.code);await tick();await vi.advanceTimersByTimeAsync(10);expect(await result).toBe('DOCUMENT_EXCHANGE_UNCERTAIN');gate.resolve();await tick();expect(attempted).toBe(true);expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('never permits a success response merely because failure response was allowed',async()=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Error('private');};
    const result=await runDocumentExecution({},async scope=>{const client=await resolvePool(raw).connect();try{await client.query('COMMIT');}catch{scope.allowFailureResponse(403,{success:false,code:'DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN'});return new Response(null,{status:200});}finally{client.release();}}).catch(cause=>cause);
    expect(documentExecutionHttpFailure(result)).toEqual({status:503,code:'DOCUMENT_EXCHANGE_UNCERTAIN'});
  });
  it('maps fixed exchange errors and leaves unrelated errors to the caller',async()=>{
    vi.useFakeTimers();const gate=deferred<void>(),run=runDocumentExecution({timeoutMs:10},async()=>gate.promise),outcome=run.catch(cause=>cause);await tick();await vi.advanceTimersByTimeAsync(10);
    expect(documentExecutionHttpFailure(await outcome)).toEqual({status:408,code:'DOCUMENT_EXCHANGE_REQUEST_TIMEOUT'});expect(documentExecutionHttpFailure(Error('unrelated'))).toBeNull();gate.resolve();await tick();
  });
  it('rejects submittable query before dispatch',async()=>{
    const raw=new FakePool();const result=await runDocumentExecution({},async()=>{const client=await resolvePool(raw).connect();try{return await (client.query as unknown as (value:unknown)=>Promise<unknown>)({text:'SELECT 1',submit(){}});}finally{client.release();}}).catch(cause=>cause);
    expect(documentExecutionHttpFailure(result)?.code).toBe('DOCUMENT_EXCHANGE_INVALID');expect(raw.client.calls).toHaveLength(0);
  });
  it('limits the same actor to two, retains admission until work drains, and caps roots at eight',async()=>{
    const gates=Array.from({length:8},()=>deferred<void>());
    const tasks=gates.map((gate,index)=>runDocumentExecution({},async scope=>{scope.admitActor(index<2?'shared':`actor-${index}`);await gate.promise;}));await tick();
    expect(getDocumentExecutionStats().activeScopes).toBe(8);await expect(runDocumentExecution({},async()=>{})).rejects.toMatchObject({code:'BUSY'});
    gates[7].resolve();await tasks[7];await expect(runDocumentExecution({},async scope=>scope.admitActor('shared'))).rejects.toMatchObject({code:'BUSY'});
    for(const gate of gates.slice(0,7))gate.resolve();await Promise.all(tasks);expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('keeps all eight slots when timed-out noncooperative work remains pending',async()=>{
    vi.useFakeTimers();const gates=Array.from({length:8},()=>deferred<void>()),runs=gates.map(gate=>runDocumentExecution({timeoutMs:10},async()=>gate.promise));
    const outcomes=runs.map(run=>run.then(()=> 'ok',cause=>documentExecutionHttpFailure(cause)?.code));await tick();await vi.advanceTimersByTimeAsync(10);
    expect(await Promise.all(outcomes)).toEqual(Array(8).fill('DOCUMENT_EXCHANGE_REQUEST_TIMEOUT'));expect(getDocumentExecutionStats()).toMatchObject({activeScopes:8,drainingScopes:8});
    await expect(runDocumentExecution({},async()=>{})).rejects.toMatchObject({code:'BUSY'});for(const gate of gates)gate.resolve();await tick();expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('observes callback exceptions without leaving a detached rejection',async()=>{
    const raw=new FakePool();await runDocumentExecution({},async()=>{await new Promise<void>(resolve=>resolvePool(raw).query('SELECT 1',()=>{resolve();throw Error('synthetic callback error');}));});
    expect(getDocumentExecutionStats().activeScopes).toBe(0);expect(raw.client.releases).toEqual([false]);
  });
  it('does not expose private driver text through callback errors',async()=>{
    const raw=new FakePool();raw.client.handler=async()=>{throw Error('secret credential and SQL');};
    await runDocumentExecution({},async()=>{await new Promise<void>(resolve=>resolvePool(raw).query('SELECT 1',cause=>{expect(cause?.message).toBe('DOCUMENT_EXECUTION_UNAVAILABLE');resolve();}));});
  });
  it('retains the slot if release throws even after synchronous end',async()=>{
    const raw=new FakePool();raw.client.release=function(discard?:boolean):void{this.releases.push(!!discard);this.emit('end');throw Error('private release error');};
    const run=runDocumentExecution({},async()=>{const client=await resolvePool(raw).connect();client.release(true);});
    await expect(run).rejects.toMatchObject({code:'UNAVAILABLE'});expect(getDocumentExecutionStats()).toMatchObject({activeScopes:1,drainingScopes:1,ownedClients:1});
  });
});
