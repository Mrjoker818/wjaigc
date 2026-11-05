import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary=vi.hoisted(()=>({scope:null as unknown,trace:[] as string[],auth:vi.fn(),run:vi.fn(),actor:vi.fn(),map:vi.fn(),start:vi.fn(),renew:vi.fn(),write:vi.fn(),snapshot:vi.fn(),receipt:vi.fn(),project:vi.fn(),ticket:vi.fn(),owner:vi.fn(),allowFailure:vi.fn(),assert:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/db-client',()=>({getPool:()=>{throw Error('unexpected database');}}));
vi.mock('@/lib/server-auth',()=>({getSessionUser:boundary.auth,WUJIE_SESSION_COOKIE:'wujie_session'}));
vi.mock('@/lib/collaboration/document-execution-scope',()=>({runDocumentExecution:boundary.run,reserveDocumentExecutionActor:boundary.actor,
  getDocumentExecutionScope:()=>boundary.scope,documentExecutionHttpFailure:boundary.map}));
vi.mock('@/lib/collaboration/document-project-bridge',()=>({readCollaborativeProject:boundary.project,enableCollaborativeProject:vi.fn()}));
vi.mock('@/lib/collaboration/document-owner-status',()=>({readDocumentOwnerStatus:boundary.owner}));
vi.mock('@/lib/collaboration/document-tickets',()=>({issueDocumentTicket:boundary.ticket}));
vi.mock('@/lib/collaboration/document-exchange-sessions',()=>({startDocumentExchangeSession:boundary.start,renewDocumentExchangeSession:boundary.renew}));
vi.mock('@/lib/collaboration/document-exchange-snapshot',()=>({readDocumentExchangeSnapshot:boundary.snapshot}));
vi.mock('@/lib/collaboration/document-exchange-receipts',()=>({executeDocumentExchangeUpdate:boundary.write,readDocumentExchangeReceipt:boundary.receipt,readDocumentExchangeReceiptByDigest:boundary.receipt}));
import {GET as project} from '@/app/api/collaboration/document-project/route';
import {GET as owner} from '@/app/api/collaboration/document-enable/route';
import {POST as ticket} from '@/app/api/collaboration/document-ticket/route';
import {POST as session} from '@/app/api/collaboration/document-exchange-session/route';
import {POST as exchange} from '@/app/api/collaboration/document-exchange/route';
import {POST as receipt} from '@/app/api/collaboration/document-exchange-receipt/route';
const token='a'.repeat(43),operation='11111111-1111-4111-8111-111111111111';
function request(kind:string,actor='actor-a'):NextRequest{
  const path=kind==='owner'?'document-enable':kind==='project'?'document-project':kind==='ticket'?'document-ticket':kind==='session'?'document-exchange-session':kind==='receipt'?'document-exchange-receipt':'document-exchange';
  const headers=new Headers({origin:'https://fixture.invalid',cookie:'wujie_session=synthetic-cookie','x-wujie-expected-actor-id':actor});
  if(kind==='owner'||kind==='project')return new NextRequest('https://fixture.invalid/api/collaboration/'+path+'?projectId=project-a',{headers});
  headers.set('content-type',kind==='exchange'?'application/octet-stream':'application/json');
  headers.set('x-wujie-document-transport','http');
  if(kind==='exchange'){headers.set('x-wujie-project-id','project-a');headers.set('x-wujie-document-session',token);}
  const body=kind==='exchange'?new Uint8Array([1,0]):JSON.stringify(kind==='session'?{action:'start',projectId:'project-a',ticket:token}:kind==='receipt'?{projectId:'project-a',sessionToken:token,operationId:operation,updateDigest:'b'.repeat(64)}:{projectId:'project-a'});
  return new NextRequest('https://fixture.invalid/api/collaboration/'+path,{method:'POST',headers,body});
}
beforeEach(()=>{
  vi.clearAllMocks();boundary.trace.length=0;vi.stubEnv('WUJIE_YJS_ENABLED','true');vi.stubEnv('WUJIE_YJS_HTTP_ENABLED','true');vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT','https://fixture.invalid');
  boundary.auth.mockImplementation(async()=>{boundary.trace.push('auth');return {id:'actor-a'};});
  boundary.run.mockImplementation(async(_options:unknown,work:(scope:unknown)=>Promise<unknown>)=>{
    boundary.trace.push('scope'); boundary.scope={signal:new AbortController().signal,assertActive:boundary.assert,
      observe:<T>(promise:Promise<T>):Promise<T>=>promise,observeCleanup:<T>(promise:Promise<T>):Promise<T>=>promise,allowFailureResponse:boundary.allowFailure};
    try{return await work(boundary.scope);}finally{boundary.scope=null;}
  });
  boundary.actor.mockImplementation(()=>{boundary.trace.push('actor');return ()=>{};});
  boundary.map.mockImplementation((error:unknown)=>error instanceof Error&&error.message==='controlled-budget'?{status:408,code:'DOCUMENT_EXCHANGE_REQUEST_TIMEOUT'}:null);
  boundary.ticket.mockResolvedValue(token);boundary.start.mockResolvedValue({sessionToken:token});boundary.receipt.mockResolvedValue(null);
  boundary.snapshot.mockResolvedValue({sessionFingerprint:'b'.repeat(64),sequence:1,update:new Uint8Array([0,0])});
  boundary.project.mockResolvedValue({projectId:'project-a',ownerId:'owner-a',sequence:1,projection:{placements:{}},canvasImages:[],readOnly:false});
  boundary.owner.mockResolvedValue({projectId:'project-a',enabled:true,featureEnabled:true,currentRevision:0});
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe.each([['project',project],['owner',owner],['ticket',ticket],['session',session],['exchange',exchange],['receipt',receipt]] as const)('%s execution entry',(kind,handle)=>{
  it('enters one scope before authentication and promotes only the authenticated actor',async()=>{
    const response=await handle(request(kind));expect(response.status).toBe(200);
    expect(boundary.trace[0]).toBe('scope');expect(boundary.run).toHaveBeenCalledOnce();expect(boundary.actor).toHaveBeenCalledWith('actor-a');
    expect(boundary.trace.indexOf('auth')).toBeLessThan(boundary.trace.indexOf('actor'));
  });
  it('does not authenticate or start service work after scope admission or budget fails',async()=>{
    boundary.run.mockRejectedValue(Error('controlled-budget'));
    const response=await handle(request(kind));expect(response.status).toBe(408);expect(await response.json()).toEqual({success:false,code:'DOCUMENT_EXCHANGE_REQUEST_TIMEOUT'});
    expect(boundary.auth).not.toHaveBeenCalled();expect(boundary.start).not.toHaveBeenCalled();expect(boundary.ticket).not.toHaveBeenCalled();
  });
  it('keeps an expected-actor conflict inside the scope without assigning actor quota',async()=>{
    const response=await handle(request(kind,'actor-b'));expect(response.status).toBe(409);
    expect(boundary.trace[0]).toBe('scope');expect(boundary.actor).not.toHaveBeenCalled();
  });
});
