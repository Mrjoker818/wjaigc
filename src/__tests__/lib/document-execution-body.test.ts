import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const boundary=vi.hoisted(()=>({scope:null as unknown,observe:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/db-client',()=>({getPool:()=>{throw Error('unexpected database');}}));
vi.mock('@/lib/collaboration/document-execution-scope',()=>({getDocumentExecutionScope:()=>boundary.scope}));
import { readDocumentExchangeJson } from '@/lib/collaboration/document-exchange-request';
let owner:AbortController,requestOwner:AbortController;
let cancel:ReturnType<typeof vi.fn>,read:Promise<unknown>|undefined,finishCancel:(()=>void)|undefined;
const observed:Array<{settled:boolean}>=[];
function request():NextRequest {
  const stream=new ReadableStream<Uint8Array>({cancel});
  return new NextRequest('http://localhost:5000/api/collaboration/document-exchange-session',
    {method:'POST',headers:{'content-type':'application/json'},body:stream,signal:requestOwner.signal,duplex:'half'} as RequestInit & { signal: AbortSignal; duplex: 'half' });
}
beforeEach(()=>{
  vi.useFakeTimers();vi.clearAllMocks();owner=new AbortController();requestOwner=new AbortController();cancel=vi.fn();read=undefined;finishCancel=undefined;observed.length=0;
  boundary.observe.mockImplementation((promise:Promise<unknown>)=>{const state={settled:false};observed.push(state);void promise.then(()=>{state.settled=true;},()=>{state.settled=true;});return promise;});
  boundary.scope={signal:owner.signal,assertActive:()=>{if(owner.signal.aborted)throw Error('controlled scope ended');},observe:boundary.observe,observeCleanup:boundary.observe};
});
afterEach(async()=>{
  finishCancel?.();requestOwner.abort();owner.abort();await vi.advanceTimersByTimeAsync(5_001);await read?.catch(()=>undefined);
  boundary.scope=null;vi.useRealTimers();vi.restoreAllMocks();
});
describe('document body execution lifecycle',()=>{
  it('accounts for a read already started when scope abort crosses the registration boundary',async()=>{
    const input=request(); let finishRead!:(value:ReadableStreamReadResult<Uint8Array>)=>void;
    const reading=new Promise<ReadableStreamReadResult<Uint8Array>>(resolve=>{finishRead=resolve;});
    const cancelling=new Promise<void>(resolve=>{finishCancel=()=>{finishRead({done:true,value:undefined});resolve();};});
    vi.spyOn(input.body!,'getReader').mockReturnValue({
      read:()=>{owner.abort();return reading;},cancel:()=>cancelling,releaseLock:()=>{},
    } as unknown as ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>);
    const scope=boundary.scope as {observe:(promise:Promise<unknown>)=>Promise<unknown>};
    scope.observe=(promise:Promise<unknown>):Promise<unknown>=>{
      if(owner.signal.aborted)throw Error('controlled expiry after read started');return boundary.observe(promise);
    };
    read=readDocumentExchangeJson(input).catch((error:unknown)=>error);await vi.advanceTimersByTimeAsync(1);
    expect(boundary.observe.mock.calls.some(([promise])=>promise===reading)).toBe(true);
    expect(await read).toMatchObject({code:'DOCUMENT_EXCHANGE_REQUEST_CANCELLED'});
  });
  it('stops a held body when only the execution scope aborts',async()=>{
    let outcome:unknown;
    read=readDocumentExchangeJson(request()).catch((error:unknown)=>{outcome=error;});
    owner.abort();await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toMatchObject({code:'DOCUMENT_EXCHANGE_REQUEST_CANCELLED'});expect(cancel).toHaveBeenCalledOnce();
  });
  it('observes the original read and unfinished cancellation after the local body timeout',async()=>{
    cancel.mockImplementation(()=>new Promise<void>(resolve=>{finishCancel=resolve;}));
    read=readDocumentExchangeJson(request()).catch((error:unknown)=>error);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await read).toMatchObject({code:'DOCUMENT_EXCHANGE_REQUEST_TIMEOUT'});
    expect(boundary.observe).toHaveBeenCalled();expect(observed.some(state=>!state.settled)).toBe(true);
    finishCancel?.();await Promise.all(boundary.observe.mock.calls.map(([promise])=>promise as Promise<unknown>));expect(observed.every(state=>state.settled)).toBe(true);
  });
  it('still cancels and observes an original request abort without requiring the scope signal',async()=>{
    let outcome:unknown;
    read=readDocumentExchangeJson(request()).catch((error:unknown)=>{outcome=error;});
    requestOwner.abort();await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toMatchObject({code:'DOCUMENT_EXCHANGE_REQUEST_CANCELLED'});expect(boundary.observe).toHaveBeenCalled();
  });
});
