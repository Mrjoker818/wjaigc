import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import type { Pool, PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as execution from '@/lib/collaboration/document-execution-scope';

type Scope=execution.DocumentExecutionScope;
type Run=<T>(work:(scope:Scope)=>Promise<T>|T)=>Promise<T>;
// The pre-implementation control exercises the existing actual HTTP context.
const run:Run=(execution as unknown as {runDocumentWebSocketExecution?:Run}).runDocumentWebSocketExecution
  ?? (work=>execution.runDocumentExecution({},work));
// Before the new entry exists, exercise the real existing nested-root behavior.
const independent:Run=(execution as unknown as {runIndependentDocumentWebSocketExecution?:Run}).runIndependentDocumentWebSocketExecution ?? run;
function deferred<T>():{promise:Promise<T>;resolve:(value:T)=>void;reject:(reason:unknown)=>void}{
  let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};
}
async function tick():Promise<void>{for(let i=0;i<20;i++)await Promise.resolve();}
function poolProxy(pool:unknown):Pool{
  const resolver=(globalThis as unknown as Record<symbol,unknown>)[Symbol.for('wujie.documentRequestPoolScope.v1')] as (pool:Pool)=>Pool;
  return resolver(pool as Pool);
}
class Client extends EventEmitter {
  _ended=false;_ending=false;_queryable=true;readonly calls:string[]=[];releases:boolean[]=[];
  queryHandler:(sql:string)=>Promise<unknown>=async()=>({rows:[]});
  query(sql:string,callback:(error:Error|null,result?:unknown)=>void):void{this.calls.push(sql);void this.queryHandler(sql).then(value=>callback(null,value),cause=>callback(cause as Error));}
  release(discard?:boolean):void{this.releases.push(Boolean(discard));if(discard)this._ending=true;}
  end():void{this._ended=true;this.emit('end');}
}
class FakePool {
  readonly client=new Client();readonly _clients=[this.client];ending=false;
  connect(callback:(error:Error|null,client?:Client)=>void):void{callback(null,this.client);}
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

describe('WebSocket execution uses the shared owned-resource context',()=>{
  it('does not start an HTTP deadline and remains alive after 20 seconds',async()=>{
    vi.useFakeTimers();const gate=deferred<void>();let settled=false;
    const task=run(async scope=>{await gate.promise;scope.assertActive();return 7;});void task.then(()=>{settled=true;},()=>{settled=true;});
    try{await tick();await vi.advanceTimersByTimeAsync(21_000);expect(settled).toBe(false);expect(execution.getDocumentExecutionStats().activeScopes).toBe(1);}
    finally{gate.resolve();}
    await expect(task).resolves.toBe(7);expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('keeps eight HTTP slots independent of WS roots and WS actor admissions',async()=>{
    const gate=deferred<void>();const jobs=Array.from({length:9},()=>run(async scope=>{scope.admitActor('fixture');await gate.promise;}));
    const http=Array.from({length:8},()=>execution.runDocumentExecution({},async()=>{await gate.promise;}));
    const captured=[...jobs,...http].map(task=>task.catch(cause=>cause));
    try{await tick();expect(execution.getDocumentExecutionStats().activeScopes).toBe(17);expect(execution.getDocumentExecutionStats().actorAdmissions).toBe(0);
      await expect(execution.runDocumentExecution({},()=>undefined)).rejects.toMatchObject({code:'BUSY'});
    }finally{gate.resolve();await Promise.all(captured);}
    expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('holds the returned value through pending observations and preserves per-scope ordering',async()=>{
    const gate=deferred<void>();let settled=false;
    const first=run(scope=>{scope.observe(gate.promise);return 'first';});void first.then(()=>{settled=true;},()=>{settled=true;});
    try{await tick();expect(settled).toBe(false);expect(execution.getDocumentExecutionStats()).toMatchObject({activeScopes:1,activeObserved:1});}
    finally{gate.resolve();}
    await expect(first).resolves.toBe('first');expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('waits for a late checkout and its discarded client end',async()=>{
    const raw=new FakePool(),acquire=deferred<void>();raw.connect=callback=>{void acquire.promise.then(()=>callback(null,raw.client));};let settled=false;
    const task=run(()=>{void poolProxy(raw).connect().catch(()=>undefined);return 'done';});void task.then(()=>{settled=true;},()=>{settled=true;});
    try{await tick();expect(settled).toBe(false);expect(execution.getDocumentExecutionStats().activeAcquires).toBe(1);
      acquire.resolve();await tick();expect(raw.client.releases).toEqual([true]);expect(settled).toBe(false);expect(execution.getDocumentExecutionStats().ownedClients).toBe(1);
    }finally{acquire.resolve();await tick();raw.client.end();}
    await expect(task).resolves.toBe('done');expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('does not settle until a removed normal-release client emits end',async()=>{
    const raw=new FakePool();raw.client._queryable=false;let settled=false;
    const task=run(async()=>{const client=await poolProxy(raw).connect();client.release();return 'done';});void task.then(()=>{settled=true;},()=>{settled=true;});
    try{await tick();expect(raw.client.releases).toEqual([false]);expect(settled).toBe(false);expect(execution.getDocumentExecutionStats().ownedClients).toBe(1);}
    finally{raw.client.end();}
    await expect(task).resolves.toBe('done');expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('never turns an unknown COMMIT into a successful result while waiting for end',async()=>{
    const raw=new FakePool(),commit=deferred<unknown>();raw.client.queryHandler=()=>commit.promise;let settled=false;
    const task=run(async()=>{const client:PoolClient=await poolProxy(raw).connect();try{await client.query('COMMIT');return 'ack';}finally{client.release(true);}});
    const result=task.then(value=>({value}),cause=>({cause}));void result.then(()=>{settled=true;});
    try{await tick();commit.reject(Error('synthetic commit result lost'));await tick();expect(settled).toBe(false);expect(raw.client.calls).toEqual(['COMMIT']);}
    finally{raw.client.end();}
    expect(await result).toMatchObject({cause:{code:'UNCERTAIN'}});expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('holds a detached original query and its owned client until both finish',async()=>{
    const raw=new FakePool(),query=deferred<unknown>();raw.client.queryHandler=()=>query.promise;let settled=false;
    const task=run(async()=>{const client=await poolProxy(raw).connect();void client.query('SELECT 1').catch(()=>undefined);return 'done';});
    void task.then(()=>{settled=true;},()=>{settled=true;});
    try{await tick();expect(settled).toBe(false);expect(execution.getDocumentExecutionStats()).toMatchObject({activeScopes:1,activeQueries:1,ownedClients:1});
      raw.client.end();await tick();expect(settled).toBe(false);query.resolve({rows:[]});}
    finally{query.resolve({rows:[]});raw.client.end();}
    await expect(task).resolves.toBe('done');expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('shares ALS and the sole pool resolver with a separately evaluated CommonJS copy',async()=>{
    const require=createRequire('J:/无界本地版/projects/_upstream-wjaigc-restore/package.json');
    const ts=require('typescript') as typeof import('typescript');
    const file='C:/Users/Administrator/.codex/visualizations/2026/09/19/01a0b95f-913f-7473-97ed-1362f0253b04/stage7-resume-20261101/work/src/lib/collaboration/document-execution-scope.ts';
    const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const box:{exports:Record<string,unknown>}={exports:{}};
    const loader=runInThisContext(`(function(exports,require,module){${compiled}\n})`) as (exports:Record<string,unknown>,require:NodeRequire,module:typeof box)=>void;
    loader(box.exports,require,box);
    const copy=box.exports as unknown as {getDocumentExecutionScope:typeof execution.getDocumentExecutionScope;runDocumentWebSocketExecution:Run};
    const raw=new FakePool();
    await copy.runDocumentWebSocketExecution(async scope=>{expect(execution.getDocumentExecutionScope()).toBe(scope);expect(copy.getDocumentExecutionScope()).toBe(scope);expect(poolProxy(raw)===(raw as unknown as Pool)).toBe(false);});
    await run(async scope=>{expect(copy.getDocumentExecutionScope()).toBe(scope);});
    expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('fails closed if an old registry was installed before the new module',async()=>{
    expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
    const global=globalThis as unknown as Record<symbol,unknown>,old=Symbol.for('wujie.documentExecutionRegistry.v1'),current=Symbol.for('wujie.documentExecutionRegistry.v2'),resolver=Symbol.for('wujie.documentRequestPoolScope.v1');
    const saved=[global[old],global[current],global[resolver]];
    try{global[old]={resolver:()=>undefined};delete global[current];delete global[resolver];vi.resetModules();
      await expect(import('@/lib/collaboration/document-execution-scope')).rejects.toThrow('DOCUMENT_EXECUTION_REGISTRY_CONFLICT');
    }finally{global[old]=saved[0];global[current]=saved[1];global[resolver]=saved[2];vi.resetModules();}
  });
  it('makes the original legacy initialization reject a newer registry',()=>{
    const global=globalThis as unknown as Record<symbol,unknown>;
    const legacy=global[Symbol.for('wujie.documentExecutionRegistry.v1')] as {resolver:unknown};
    const actual=global[Symbol.for('wujie.documentRequestPoolScope.v1')];
    // This is the original v1 module's resolver-conflict check, before it can run work.
    expect(()=>{if(actual!==undefined&&actual!==legacy.resolver)throw Error('DOCUMENT_EXECUTION_RESOLVER_CONFLICT');}).toThrow('DOCUMENT_EXECUTION_RESOLVER_CONFLICT');
  });
  it('rejects nested roots rather than deadlocking or bypassing HTTP admission',async()=>{
    await run(async()=>{
      await expect(run(()=>undefined)).rejects.toMatchObject({code:'UNSUPPORTED'});
      await expect(execution.runDocumentExecution({},()=>undefined)).rejects.toMatchObject({code:'UNSUPPORTED'});
    });
    await execution.runDocumentExecution({},async()=>{await expect(run(()=>undefined)).rejects.toMatchObject({code:'UNSUPPORTED'});});
  });
  it('synchronously registers an independent child and restores the parent context',async()=>{
    const hold=deferred<void>();let child:Promise<string>|undefined;
    try{await run(async parent=>{
      child=independent(async scope=>{expect(scope).not.toBe(parent);expect(execution.getDocumentExecutionScope()).toBe(scope);await hold.promise;return 'child';});
      void child.catch(()=>undefined);
      expect(execution.getDocumentExecutionStats().activeScopes).toBe(2);
      expect(execution.getDocumentExecutionScope()).toBe(parent);
      hold.resolve();await expect(child).resolves.toBe('child');expect(execution.getDocumentExecutionScope()).toBe(parent);
    });}finally{hold.resolve();await child?.catch(()=>undefined);}
    expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it.each(['client-query','client-release','pool-connect','pool-query'] as const)('rejects borrowing a live parent proxy in another root: %s',async kind=>{
    const raw=new FakePool(),ready=deferred<{pool:Pool;client:PoolClient}>(),hold=deferred<void>();
    const parent=run(async()=>{const pool=poolProxy(raw),client=await pool.connect();try{ready.resolve({pool,client});await hold.promise;}finally{client.release();}});
    try{const {pool,client}=await ready.promise;
      await expect(run(async()=>{
        if(kind==='client-query')await client.query('SELECT foreign');
        if(kind==='client-release')client.release();
        if(kind==='pool-connect'){const borrowed=await pool.connect();borrowed.release();}
        if(kind==='pool-query')await pool.query('SELECT foreign');
      })).rejects.toMatchObject({code:'UNAVAILABLE'});
      expect(raw.client.calls).toEqual([]);expect(raw.client.releases).toEqual([]);
    }finally{hold.resolve();await parent;raw.client.end();}
    expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('rejects unowned access without allowing an early release',async()=>{
    const raw=new FakePool(),ready=deferred<{pool:Pool;client:PoolClient}>(),hold=deferred<void>();
    const parent=run(async()=>{const pool=poolProxy(raw),client=await pool.connect();try{ready.resolve({pool,client});await hold.promise;}finally{client.release();}});
    try{const {pool,client}=await ready.promise;
      await expect(client.query('SELECT foreign')).rejects.toMatchObject({code:'UNAVAILABLE'});
      await expect(pool.connect()).rejects.toMatchObject({code:'UNAVAILABLE'});
      expect(()=>client.release()).toThrow();expect(raw.client.calls).toEqual([]);expect(raw.client.releases).toEqual([]);
    }finally{hold.resolve();await parent;raw.client.end();}
    expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it.each(['client-query','client-release','pool-connect','pool-query'] as const)('rejects an independent child using its actual parent proxy: %s',async kind=>{
    const raw=new FakePool();
    await run(async()=>{const pool=poolProxy(raw),client=await pool.connect();
      try{await expect(independent(async()=>{
        if(kind==='client-query')await client.query('SELECT foreign');
        if(kind==='client-release')client.release();
        if(kind==='pool-connect'){const borrowed=await pool.connect();borrowed.release();}
        if(kind==='pool-query')await pool.query('SELECT foreign');
      })).rejects.toMatchObject({code:'UNAVAILABLE'});
      expect(raw.client.calls).toEqual([]);expect(raw.client.releases).toEqual([]);
      }finally{client.release();}
    });
    expect(raw.client.releases).toEqual([false]);expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it.each(['on','once','addListener','removeListener','off'] as const)('keeps event method %s chainable through the owner proxy',async method=>{
    const raw=new FakePool(),listener=vi.fn();
    await run(async()=>{const client=await poolProxy(raw).connect();const events=client as unknown as EventEmitter;
      try{
        if(method==='removeListener'||method==='off')events.on('fixture',listener);
        const chained=events[method]('fixture',listener);
        expect(chained===(client as unknown as EventEmitter)).toBe(true);
        raw.client.emit('fixture');raw.client.emit('fixture');
        expect(listener).toHaveBeenCalledTimes(method==='once'?1:method==='removeListener'||method==='off'?0:2);
        await (chained as unknown as PoolClient).query('SELECT owned');
      }finally{client.release();}
    });
    expect(raw.client.calls).toEqual(['SELECT owned']);expect(raw.client.releases).toEqual([false]);
  });
  it.each(['on','once','addListener','removeListener','off'] as const)('rejects foreign event method %s without changing listeners',async method=>{
    const raw=new FakePool(),listener=vi.fn();
    await run(async()=>{const client=await poolProxy(raw).connect();const events=client as unknown as EventEmitter;
      try{events.on('fixture',listener);const before=raw.client.listenerCount('fixture');
        await expect(independent(()=>events[method]('fixture',listener))).rejects.toMatchObject({code:'UNAVAILABLE'});
        expect(raw.client.listenerCount('fixture')).toBe(before);raw.client.emit('fixture');expect(listener).toHaveBeenCalledOnce();
      }finally{events.removeListener('fixture',listener);client.release();}
    });
    expect(raw.client.releases).toEqual([false]);
  });
  it('rejects event listener changes without an owning execution root',async()=>{
    const raw=new FakePool(),ready=deferred<PoolClient>(),hold=deferred<void>(),listener=vi.fn();
    const parent=run(async()=>{const client=await poolProxy(raw).connect();try{ready.resolve(client);await hold.promise;}finally{client.release();}});
    try{const client=await ready.promise;expect(()=>(client as unknown as EventEmitter).on('fixture',listener)).toThrow('DOCUMENT_EXECUTION_UNAVAILABLE');expect(raw.client.listenerCount('fixture')).toBe(0);}
    finally{hold.resolve();await parent;}
  });
  it.each(['on','once','addListener'] as const)('supplies the protected client as listener this for %s',async method=>{
    const raw=new FakePool();let observed:unknown;let argument:unknown;
    await run(async()=>{const client=await poolProxy(raw).connect();const events=client as unknown as EventEmitter;
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- Verify the listener never receives the raw client.
      function listener(this:PoolClient,value:unknown):void{observed=this;argument=value;}
      try{events[method]('fixture',listener);raw.client.emit('fixture','value');
        expect(observed===client).toBe(true);expect(argument).toBe('value');events.removeListener('fixture',listener);
      }finally{client.release();}
    });expect(raw.client.releases).toEqual([false]);
  });
  it('blocks query and release from a listener invoked in a foreign root',async()=>{
    const raw=new FakePool(),queryDone=deferred<Error|null>();let releaseError:unknown;
    await run(async()=>{const client=await poolProxy(raw).connect(),events=client as unknown as EventEmitter;
      function listener(this:PoolClient):void{
        this.query('SELECT foreign',cause=>queryDone.resolve(cause));
        try{this.release();}catch(cause){releaseError=cause;}
      }
      try{events.on('fixture',listener);
        await independent(async()=>{raw.client.emit('fixture');expect(await queryDone.promise).toMatchObject({code:'UNAVAILABLE'});expect(releaseError).toMatchObject({code:'UNAVAILABLE'});});
        expect(raw.client.calls).toEqual([]);expect(raw.client.releases).toEqual([]);events.removeListener('fixture',listener);
      }finally{client.release();}
    });expect(raw.client.releases).toEqual([false]);
  });
  it('removes an untriggered once listener using its original function',async()=>{
    const raw=new FakePool(),listener=vi.fn();
    await run(async()=>{const client=await poolProxy(raw).connect(),events=client as unknown as EventEmitter;
      try{events.once('fixture',listener);events.removeListener('fixture',listener);raw.client.emit('fixture');expect(listener).not.toHaveBeenCalled();}
      finally{client.release();}
    });
  });
  it('preserves most-recent duplicate removal across on and once registrations',async()=>{
    const raw=new FakePool(),listener=vi.fn();
    await run(async()=>{const client=await poolProxy(raw).connect(),events=client as unknown as EventEmitter;
      try{events.on('fixture',listener);events.once('fixture',listener);events.on('fixture',listener);events.off('fixture',listener);
        raw.client.emit('fixture');expect(listener).toHaveBeenCalledTimes(2);raw.client.emit('fixture');expect(listener).toHaveBeenCalledTimes(3);
        events.removeListener('fixture',listener);raw.client.emit('fixture');expect(listener).toHaveBeenCalledTimes(3);
      }finally{client.release();}
    });
  });
  it('lets the owner finish and release in finally after its own deadline',async()=>{
    const raw=new FakePool(),query=deferred<unknown>(),started=deferred<void>();raw.client.queryHandler=()=>{started.resolve();return query.promise;};
    const task=execution.runDocumentExecution({timeoutMs:50},async()=>{const client=await poolProxy(raw).connect();try{await client.query('SELECT slow');}finally{client.release();}});
    const result=task.catch(cause=>cause);await started.promise;
    try{expect(await result).toMatchObject({code:'TIMEOUT'});expect(raw.client.releases).toEqual([true]);query.resolve({rows:[]});raw.client.end();}
    finally{query.resolve({rows:[]});raw.client.end();}
    await vi.waitFor(()=>expect(execution.getDocumentExecutionStats().activeScopes).toBe(0));
  });
  it('independently returns each root’s owned client without releasing the other',async()=>{
    const parentPool=new FakePool(),childPool=new FakePool();
    await run(async parent=>{
      const parentClient=await poolProxy(parentPool).connect();
      try{await independent(async child=>{
        expect(child).not.toBe(parent);const childClient=await poolProxy(childPool).connect();
        try{await childClient.query('SELECT child');}finally{childClient.release();}
      });
      expect(childPool.client.calls).toEqual(['SELECT child']);expect(childPool.client.releases).toEqual([false]);expect(parentPool.client.releases).toEqual([]);
      await parentClient.query('SELECT parent');
      }finally{parentClient.release();}
    });
    expect(parentPool.client.calls).toEqual(['SELECT parent']);expect(parentPool.client.releases).toEqual([false]);expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('lets a parent finish while an independently queued child still waits',async()=>{
    const hold=deferred<void>();let child:Promise<string>|undefined;
    try{await run(()=>{child=independent(async()=>{await hold.promise;return 'done';});return 'parent';});
      expect(execution.getDocumentExecutionStats().activeScopes).toBe(1);hold.resolve();await expect(child).resolves.toBe('done');
    }finally{hold.resolve();await child?.catch(()=>undefined);}
    expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('keeps the parent HTTP slot while its independent WS child is active',async()=>{
    const hold=deferred<void>(),childHold=deferred<void>(),started=deferred<void>();let child:Promise<string>|undefined;
    const parent=execution.runDocumentExecution({},async scope=>{
      child=independent(async()=>{await childHold.promise;return 'child';});void child.catch(()=>undefined);
      expect(execution.getDocumentExecutionScope()).toBe(scope);started.resolve();await hold.promise;
    });
    const others=Array.from({length:7},()=>execution.runDocumentExecution({},()=>hold.promise));
    const settled=[parent,...others].map(task=>task.catch(cause=>cause));
    try{await started.promise;await tick();expect(execution.getDocumentExecutionStats().activeScopes).toBe(9);
      await expect(execution.runDocumentExecution({},()=>undefined)).rejects.toMatchObject({code:'BUSY'});
      childHold.resolve();await expect(child).resolves.toBe('child');expect(execution.getDocumentExecutionStats().activeScopes).toBe(8);
      await expect(execution.runDocumentExecution({},()=>undefined)).rejects.toMatchObject({code:'BUSY'});
    }finally{childHold.resolve();hold.resolve();await child?.catch(()=>undefined);await Promise.all(settled);}
    expect(execution.getDocumentExecutionStats().activeScopes).toBe(0);
  });
});
