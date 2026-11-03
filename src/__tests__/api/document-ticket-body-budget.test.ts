import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const boundary=vi.hoisted(()=>({auth:vi.fn(),issue:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/db-client',()=>({getPool:()=>{throw Error('unexpected database');}}));
vi.mock('@/lib/server-auth',()=>({getSessionUser:boundary.auth}));
vi.mock('@/lib/collaboration/document-tickets',()=>({issueDocumentTicket:boundary.issue}));
import {POST} from '@/app/api/collaboration/document-ticket/route';
import {getDocumentExecutionStats} from '@/lib/collaboration/document-execution-scope';
let source:ReadableStreamDefaultController<Uint8Array>|undefined,owner:AbortController,pending:Promise<Response>|undefined;
const finishHeld:Array<()=>void>=[];
function heldRequest():NextRequest {
  const body=new ReadableStream<Uint8Array>({start(controller){source=controller;}});
  return new NextRequest('http://localhost:5000/api/collaboration/document-ticket',{method:'POST',
    headers:{origin:'http://localhost:5000','content-type':'application/json','x-wujie-expected-actor-id':'actor-a','x-wujie-document-transport':'http'},
    body,signal:owner.signal,duplex:'half'} as RequestInit & { signal: AbortSignal; duplex: 'half' });
}
beforeEach(()=>{
  expect(getDocumentExecutionStats().activeScopes).toBe(0);vi.useFakeTimers();vi.resetAllMocks();source=undefined;pending=undefined;owner=new AbortController();finishHeld.length=0;
  vi.stubEnv('WUJIE_YJS_ENABLED','true');vi.stubEnv('WUJIE_YJS_HTTP_ENABLED','true');vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT','http://localhost:5000');
  boundary.auth.mockResolvedValue({id:'actor-a'});boundary.issue.mockResolvedValue('t'.repeat(43));
});
afterEach(async()=>{
  for(const finish of finishHeld)finish();
  try{source?.close();}catch{/* A correctly cancelled stream is already closed. */}
  owner.abort();await vi.advanceTimersByTimeAsync(20_001);await pending?.catch(()=>undefined);await Promise.resolve();
  vi.useRealTimers();vi.unstubAllEnvs();vi.restoreAllMocks();
});
describe('ticket body shares execution and original bounded JSON protections',()=>{
  it('returns an early authentication failure while retaining unfinished unused-body cleanup',async()=>{
    boundary.auth.mockResolvedValue(null);
    const input=heldRequest();const cancelling=new Promise<void>(resolve=>{finishHeld.push(resolve);});
    const cancel=vi.spyOn(input.body!,'cancel').mockReturnValue(cancelling);
    pending=POST(input);const result=await pending;
    expect(result.status).toBe(401);expect(cancel).toHaveBeenCalledOnce();
    expect(boundary.issue).not.toHaveBeenCalled();
    expect(getDocumentExecutionStats()).toMatchObject({activeScopes:1,activeObserved:1});
    finishHeld[0]();await vi.advanceTimersByTimeAsync(1);
    expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('starts unused-body cancellation during held authentication and waits for both original operations',async()=>{
    let finishAuth!:(value:null)=>void;
    boundary.auth.mockReturnValue(new Promise<null>(resolve=>{finishAuth=resolve;finishHeld.push(()=>resolve(null));}));
    const input=heldRequest();const cancelling=new Promise<void>(resolve=>{finishHeld.push(resolve);});
    const cancel=vi.spyOn(input.body!,'cancel').mockReturnValue(cancelling);
    pending=POST(input);await vi.advanceTimersByTimeAsync(1);owner.abort();
    expect((await pending).status).toBe(400);expect(cancel).toHaveBeenCalledOnce();
    expect(getDocumentExecutionStats()).toMatchObject({activeScopes:1,activeObserved:1});
    finishAuth(null);await vi.advanceTimersByTimeAsync(1);
    expect(getDocumentExecutionStats()).toMatchObject({activeScopes:1,activeObserved:1});
    finishHeld[1]();await vi.advanceTimersByTimeAsync(1);
    expect(getDocumentExecutionStats().activeScopes).toBe(0);expect(boundary.issue).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('ends a held body at the five-second read budget without issuing a ticket',async()=>{
    let response:Response|undefined;pending=POST(heldRequest()).then(value=>{response=value;return value;});
    await vi.advanceTimersByTimeAsync(5_001);
    expect(response?.status).toBe(408);expect(await response?.json()).toEqual({success:false,code:'DOCUMENT_EXCHANGE_REQUEST_TIMEOUT'});
    expect(boundary.issue).not.toHaveBeenCalled();expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
  it('cancels the held body and prevents a late ticket when the request owner aborts',async()=>{
    pending=POST(heldRequest());await vi.advanceTimersByTimeAsync(1);owner.abort();await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(400);expect(boundary.issue).not.toHaveBeenCalled();
    expect(getDocumentExecutionStats().activeScopes).toBe(0);
  });
});
