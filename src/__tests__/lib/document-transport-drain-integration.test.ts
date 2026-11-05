import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const m=vi.hoisted(()=>({auth:vi.fn(),issue:vi.fn(),consume:vi.fn(),readProject:vi.fn(),editorRead:vi.fn(),load:vi.fn(),updates:vi.fn(),commit:vi.fn(),pool:vi.fn(),sockets:[] as unknown[],lateUpgrade:false,finishUpgrade:null as (()=>void)|null}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/server-auth',()=>({getSessionUser:m.auth}));
vi.mock('@/lib/collaboration/document-tickets',()=>({issueDocumentTicket:m.issue,consumeDocumentTicket:m.consume}));
vi.mock('@/lib/db-client',()=>({getPool:m.pool}));
vi.mock('@/lib/collaboration/document-project-bridge',()=>({readCollaborativeProject:m.readProject}));
vi.mock('@/lib/collaboration/document-access',()=>({withDocumentEditorRead:m.editorRead,DocumentAccessError:class extends Error{}}));
vi.mock('@/lib/collaboration/document-assets',()=>({DocumentAssetError:class extends Error{}}));
vi.mock('@/lib/collaboration/document-store',()=>({loadDocumentInTransaction:m.load,readDocumentUpdatesAfterInTransaction:m.updates,
  commitDocumentUpdate:m.commit,DocumentUpdateRejectedError:class extends Error{}}));
vi.mock('ws',async()=>{
  const {EventEmitter:Emitter}=await import('node:events');
  class Socket extends Emitter {
    static OPEN=1;readyState=1;bufferedAmount=0;frames:Buffer[]=[];closed:Array<[number,string]>=[];
    send(frame:Buffer):void{this.frames.push(frame);}
    close(code:number,reason:string):void{this.closed.push([code,reason]);this.readyState=2;}
    finishClose():void{this.readyState=3;this.emit('close');}
    terminate():void{this.finishClose();}
  }
  class Server {
    handleUpgrade(_request:unknown,_socket:unknown,_head:unknown,callback:(socket:Socket)=>void):void{
      const input=_socket as {readable:boolean;writable:boolean};
      // Match ws.completeUpgrade: an already-closed socket gives no callback.
      if(!input.readable||!input.writable)return;
      const finish=():void=>{const socket=new Socket();m.sockets.push(socket);callback(socket);};
      if(m.lateUpgrade)m.finishUpgrade=finish;else finish();
    }
    close(callback:()=>void):void{callback();}
  }
  return {default:Socket,WebSocketServer:Server};
});
import {createDocumentGateway,type DocumentGateway} from '@/lib/collaboration/document-gateway';
import {getDocumentExecutionScope,getDocumentExecutionStats} from '@/lib/collaboration/document-execution-scope';
import {beginDocumentTransportTransition as beginTransition,finishDocumentTransportTransition,documentTransportCanStart,type DocumentTransportTransition} from '@/lib/collaboration/document-transport-gate';
import {POST} from '@/app/api/collaboration/document-ticket/route';
import {GET as readProject} from '@/app/api/collaboration/document-project/route';

interface FakeSocket extends EventEmitter {frames:Buffer[];closed:Array<[number,string]>;finishClose():void;terminate():void}
function deferred<T>():{promise:Promise<T>;resolve:(value:T)=>void}{
  let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};
}
const identity={userId:'editor-a',projectId:'project-a',ownerId:'owner-a',grantGeneration:'7'};
const gateways:DocumentGateway[]=[],cleanup:Array<()=>void>=[],docs:Y.Doc[]=[];
const transitions:DocumentTransportTransition[]=[],started:Array<Promise<unknown>>=[];
function beginDocumentTransportTransition(target:'ws'|'http'):DocumentTransportTransition{
  const transition=beginTransition(target);transitions.push(transition);return transition;
}
function track<T>(promise:Promise<T>):Promise<T>{started.push(promise);void promise.catch(()=>undefined);return promise;}
function upgrade():{request:IncomingMessage;socket:Duplex;end:ReturnType<typeof vi.fn>}{
  const end=vi.fn();return {request:{url:'/api/collaboration/document',headers:{origin:'http://localhost:5000',host:'localhost:5000',
    'sec-websocket-protocol':`wujie-document-v1, wujie-document-ticket.${'a'.repeat(43)}`}} as unknown as IncomingMessage,
    socket:Object.assign(new EventEmitter(),{destroyed:false,readable:true,writable:true,end}) as unknown as Duplex,end};
}
function request(body:BodyInit=JSON.stringify({projectId:'project-a'}),signal?:AbortSignal):NextRequest{
  return new NextRequest('http://localhost:5000/api/collaboration/document-ticket',{method:'POST',body,duplex:'half',
    ...(signal?{signal}:{}),
    headers:{origin:'http://localhost:5000','content-type':'application/json','x-wujie-expected-actor-id':'editor-a','x-wujie-document-transport':'http'}} as RequestInit & {signal?:AbortSignal;duplex:'half'});
}
async function makeGateway():Promise<DocumentGateway>{
  const gateway=createDocumentGateway({reconcileIntervalMs:60_000});gateways.push(gateway);await gateway.ready;return gateway;
}
async function open():Promise<FakeSocket>{
  const gateway=await makeGateway(),input=upgrade(),before=m.sockets.length;
  await track(gateway.handleDocumentUpgrade(input.request,input.socket,Buffer.alloc(0)));
  expect(m.sockets.length).toBe(before+1);const socket=m.sockets[before] as FakeSocket;expect(socket).toBeDefined();return socket;
}
function observeDrain(promise:Promise<void>):{outcome:'pending'|'passed'|'failed'}{
  const status:{outcome:'pending'|'passed'|'failed'}={outcome:'pending'};
  void promise.then(()=>{status.outcome='passed';},()=>{status.outcome='failed';});return status;
}
async function expectPending(status:{outcome:'pending'|'passed'|'failed'}):Promise<void>{
  // Give the inspector a bounded observation window; rejection is never pending.
  await new Promise<void>(resolve=>setTimeout(resolve,25));expect(status.outcome).toBe('pending');
}
beforeEach(()=>{
  expect(getDocumentExecutionStats().activeScopes).toBe(0);vi.resetAllMocks();m.sockets.length=0;
  m.lateUpgrade=false;m.finishUpgrade=null;
  vi.stubEnv('WUJIE_YJS_ENABLED','true');vi.stubEnv('WUJIE_YJS_HTTP_ENABLED','false');vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT','http://localhost:5000');
  const notification=Object.assign(new EventEmitter(),{query:vi.fn().mockResolvedValue({rows:[]}),release:vi.fn()});
  m.pool.mockReturnValue({connect:async()=>notification});m.auth.mockResolvedValue({id:'editor-a'});m.issue.mockResolvedValue('a'.repeat(43));m.consume.mockResolvedValue(identity);
  m.editorRead.mockImplementation(async(_actor:unknown,_project:unknown,_grant:unknown,work:(client:unknown)=>Promise<void>)=>work({}));
  m.load.mockImplementation(async()=>{const doc=new Y.Doc();docs.push(doc);return {doc,sequence:1};});m.updates.mockResolvedValue([]);
  m.commit.mockResolvedValue({sequence:2,update:new Uint8Array([0,0])});
  m.readProject.mockResolvedValue({projectId:'project-a',ownerId:'owner-a',sequence:1,projection:{placements:{}},readOnly:false});
});
afterEach(async()=>{
  for(const finish of cleanup.splice(0))finish();
  for(const socket of m.sockets as FakeSocket[])socket.terminate();
  while(gateways.length)await gateways.pop()!.close();
  await Promise.allSettled(started.splice(0));
  await vi.waitFor(()=>expect(getDocumentExecutionStats().activeScopes).toBe(0));
  await Promise.all(transitions.splice(0).map(transition=>transition.drained));
  const state=(globalThis as typeof globalThis & {[key:symbol]:unknown})[Symbol.for('wujie.documentTransportGate.v1')] as
    {participants:Set<unknown>;transition?:{pending:number;ready:boolean;timer?:unknown}}|undefined;
  expect(state?.participants.size??0).toBe(0);
  await vi.waitFor(()=>expect(state?.transition?.timer).toBeUndefined());
  for(const doc of docs.splice(0))doc.destroy();
  // Isolated fixture globals only; never a production reset or a live process.
  delete (globalThis as typeof globalThis & {[key:symbol]:unknown})[Symbol.for('wujie.documentTransportGate.v1')];
  vi.unstubAllEnvs();vi.restoreAllMocks();
});

describe('actual gateway, route, gate and execution ownership under controlled sockets/SQL',()=>{
  it('reaches the original snapshot, commit ACK, ticket and project paths when no transition occurs',async()=>{
    const socket=await open();await vi.waitFor(()=>expect(socket.frames.length).toBe(1));
    socket.emit('message',Buffer.from([2,0,0]),true);await vi.waitFor(()=>expect(socket.frames.some(frame=>frame[0]===0x12)).toBe(true));
    expect(m.commit).toHaveBeenCalledOnce();
    const input=request();input.headers.set('x-wujie-document-transport','ws');expect((await track(POST(input))).status).toBe(200);
    const directory=await track(readProject(new NextRequest('http://localhost:5000/api/collaboration/document-project?projectId=project-a')));
    expect(await directory.json()).toMatchObject({success:true,documentTransport:'ws'});
    await vi.waitFor(()=>expect(getDocumentExecutionStats().activeScopes).toBe(0));
  });
  it('does not start ticket issuance when draining begins during authentication without a flag change',async()=>{
    const authenticated=deferred<{id:string}>();cleanup.push(()=>authenticated.resolve({id:'editor-a'}));m.auth.mockReturnValueOnce(authenticated.promise);
    const input=request();input.headers.set('x-wujie-document-transport','ws');const pending=track(POST(input));
    await vi.waitFor(()=>expect(m.auth).toHaveBeenCalledOnce());const transition=beginDocumentTransportTransition('http');
    await expectPending(observeDrain(transition.drained));
    authenticated.resolve({id:'editor-a'});const result=await pending;
    expect(result.status).toBe(503);expect(await result.json()).toEqual({success:false,code:'DOCUMENT_TRANSPORT_DRAINING'});
    expect(m.issue).not.toHaveBeenCalled();await transition.drained;
  });
  it('does not return an issued ticket when the gate closes while issuance is in flight',async()=>{
    const issued=deferred<string>();cleanup.push(()=>issued.resolve('a'.repeat(43)));m.issue.mockReturnValueOnce(issued.promise);
    const input=request();input.headers.set('x-wujie-document-transport','ws');const pending=track(POST(input));
    await vi.waitFor(()=>expect(m.issue).toHaveBeenCalledOnce());const transition=beginDocumentTransportTransition('http');
    await expectPending(observeDrain(transition.drained));
    issued.resolve('a'.repeat(43));const result=await pending;
    expect(result.status).toBe(503);expect(await result.json()).toEqual({success:false,code:'DOCUMENT_TRANSPORT_DRAINING'});
    expect(m.issue).toHaveBeenCalledOnce();await transition.drained;
  });
  it('does not publish a writable directory from an old epoch after its authorized read settles',async()=>{
    const directory=deferred<{projectId:string;ownerId:string;sequence:number;projection:{placements:Record<string,never>};readOnly:boolean}>();
    const value={projectId:'project-a',ownerId:'owner-a',sequence:1,projection:{placements:{}},readOnly:false};cleanup.push(()=>directory.resolve(value));m.readProject.mockReturnValueOnce(directory.promise);
    const pending=track(readProject(new NextRequest('http://localhost:5000/api/collaboration/document-project?projectId=project-a')));
    await vi.waitFor(()=>expect(m.readProject).toHaveBeenCalledOnce());const transition=beginDocumentTransportTransition('http');
    await expectPending(observeDrain(transition.drained));
    directory.resolve(value);const result=await pending;
    expect(result.status).toBe(503);expect(await result.json()).toEqual({success:false,code:'DOCUMENT_TRANSPORT_DRAINING'});await transition.drained;
  });
  it('actively closes a quiet socket and waits for actual close before opening HTTP',async()=>{
    const socket=await open();await vi.waitFor(()=>expect(socket.frames.length).toBe(1));
    const transition=beginDocumentTransportTransition('http'),drain=observeDrain(transition.drained);
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED','true');
    await vi.waitFor(()=>expect(socket.closed).toContainEqual([1012,'document transport changed']));
    await expectPending(drain);expect(documentTransportCanStart('http')).toBe(false);
    expect(()=>finishDocumentTransportTransition(transition)).toThrow();
    socket.finishClose();await transition.drained;vi.stubEnv('WUJIE_YJS_HTTP_ENABLED','true');finishDocumentTransportTransition(transition);
    expect(documentTransportCanStart('http')).toBe(true);
  });
  it('waits for both registered gateways, including the last quiet socket',async()=>{
    const first=await open(),second=await open();expect(second).not.toBe(first);expect(m.sockets).toHaveLength(2);await vi.waitFor(()=>expect(second.frames.length).toBe(1));
    const transition=beginDocumentTransportTransition('http'),drain=observeDrain(transition.drained);
    await vi.waitFor(()=>{
      expect(first.closed).toEqual([[1012,'document transport changed']]);
      expect(second.closed).toEqual([[1012,'document transport changed']]);
    });
    first.finishClose();await expectPending(drain);
    second.finishClose();await transition.drained;expect(drain.outcome).toBe('passed');
  });
  it('accounts for an upgrade before ticket consumption settles and never upgrades its old epoch',async()=>{
    const consumed=deferred<typeof identity>();cleanup.push(()=>consumed.resolve(identity));m.consume.mockReturnValueOnce(consumed.promise);
    const gateway=await makeGateway(),input=upgrade(),opening=track(gateway.handleDocumentUpgrade(input.request,input.socket,Buffer.alloc(0)));
    await vi.waitFor(()=>expect(m.consume).toHaveBeenCalledOnce());
    const transition=beginDocumentTransportTransition('http'),drain=observeDrain(transition.drained);
    await expectPending(drain);expect(getDocumentExecutionStats().activeScopes).toBeGreaterThan(0);
    consumed.resolve(identity);await opening;await transition.drained;
    expect(input.end).toHaveBeenCalled();expect(m.sockets.length).toBe(0);
  });
  it('registers a queued write before its predecessor settles and drops it after the gate closes',async()=>{
    const initial=deferred<{doc:Y.Doc;sequence:number}>(),doc=new Y.Doc();docs.push(doc);cleanup.push(()=>initial.resolve({doc,sequence:1}));
    m.load.mockReturnValueOnce(initial.promise);const socket=await open();await vi.waitFor(()=>expect(m.load).toHaveBeenCalledOnce());
    expect(getDocumentExecutionStats().activeScopes).toBe(1);
    socket.emit('message',Buffer.from([2,0,0]),true);
    expect(getDocumentExecutionStats().activeScopes).toBe(2);
    const transition=beginDocumentTransportTransition('http'),drain=observeDrain(transition.drained);
    await vi.waitFor(()=>expect(socket.closed.length).toBe(1));socket.finishClose();await expectPending(drain);
    initial.resolve({doc,sequence:1});await transition.drained;
    expect(m.commit).not.toHaveBeenCalled();expect(socket.frames.some(frame=>frame[0]===0x12)).toBe(false);
  });
  it('keeps a late upgrade callback and its rejected socket in the original handshake lifecycle',async()=>{
    m.lateUpgrade=true;const gateway=await makeGateway(),input=upgrade();
    const opening=track(gateway.handleDocumentUpgrade(input.request,input.socket,Buffer.alloc(0)));
    await vi.waitFor(()=>expect(m.finishUpgrade).toBeTypeOf('function'));
    cleanup.push(()=>{m.finishUpgrade?.();});
    const transition=beginDocumentTransportTransition('http'),drain=observeDrain(transition.drained);
    await expectPending(drain);expect(getDocumentExecutionStats().activeScopes).toBe(1);
    const finish=m.finishUpgrade!;m.finishUpgrade=null;finish();
    const socket=m.sockets[0] as FakeSocket;expect(socket.closed).toEqual([[1012,'document transport changed']]);
    await expectPending(drain);expect(m.load).not.toHaveBeenCalled();
    socket.finishClose();await opening;await transition.drained;
    expect(getDocumentExecutionStats().activeScopes).toBe(0);expect(socket.frames).toHaveLength(0);
  });
  it('finishes a handshake whose raw socket closed before ticket consumption returned, without a second close',async()=>{
    const consumed=deferred<typeof identity>();cleanup.push(()=>consumed.resolve(identity));m.consume.mockReturnValueOnce(consumed.promise);
    const gateway=await makeGateway(),input=upgrade();let openingDone=false;
    const opening=track(gateway.handleDocumentUpgrade(input.request,input.socket,Buffer.alloc(0))).then(()=>{openingDone=true;});
    // Backup for the deliberately failing pre-fix run only; never counted as normal cleanup.
    cleanup.push(()=>{if(!openingDone)input.socket.emit('close');});
    await vi.waitFor(()=>expect(m.consume).toHaveBeenCalledOnce());
    Object.assign(input.socket,{destroyed:true,readable:false,writable:false});input.socket.emit('close');
    consumed.resolve(identity);await vi.waitFor(()=>expect(openingDone).toBe(true),{timeout:200});await opening;
    expect(getDocumentExecutionStats().activeScopes).toBe(0);expect(m.sockets).toHaveLength(0);
    const transition=beginDocumentTransportTransition('http');await transition.drained;
  });
  it('keeps an owned COMMIT and delayed discarded-client end in the drain after sockets close',async()=>{
    const socket=await open();await vi.waitFor(()=>expect(socket.frames.length).toBe(1));
    const committed=deferred<{rows:unknown[]}>();cleanup.push(()=>committed.resolve({rows:[]}));
    const raw=Object.assign(new EventEmitter(),{_ended:false,_ending:false,_queryable:true,query:vi.fn(),release:vi.fn()});
    const pool={ending:false,_clients:[raw],connect:vi.fn((callback:(error:Error|null,client:PoolClient)=>void)=>callback(null,raw as unknown as PoolClient))};
    raw.query.mockImplementation((sql:string,...parameters:unknown[])=>{
      const callback=parameters.at(-1) as (error:Error|null,result?:unknown)=>void;
      const result=sql==='COMMIT'?committed.promise:Promise.resolve({rows:[]});void result.then(value=>callback(null,value));
    });
    raw.release.mockImplementation(()=>{raw._ending=true;pool._clients.length=0;});
    const finishEnd=():void=>{if(!raw._ended){raw._ended=true;raw.emit('end');}};cleanup.push(finishEnd);
    m.pool.mockImplementation(()=>{
      const resolver=(globalThis as typeof globalThis & {[key:symbol]:unknown})[Symbol.for('wujie.documentRequestPoolScope.v1')];
      if(typeof resolver!=='function'||!getDocumentExecutionScope())throw Error('missing actual execution ownership');
      return (resolver as (input:Pool)=>Pool)(pool as unknown as Pool);
    });
    m.commit.mockImplementationOnce(async()=>{
      const client=await (m.pool() as Pool).connect();
      try{await client.query('BEGIN');await client.query('COMMIT');return {sequence:2,update:new Uint8Array([0,0])};}
      finally{client.release(true);}
    });
    socket.emit('message',Buffer.from([2,0,0]),true);await vi.waitFor(()=>expect(raw.query.mock.calls.some(([sql])=>sql==='COMMIT')).toBe(true));
    const transition=beginDocumentTransportTransition('http'),drain=observeDrain(transition.drained);
    await vi.waitFor(()=>expect(socket.closed.length).toBe(1));socket.finishClose();
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED','true');const beforeAuth=m.auth.mock.calls.length;
    const rejected=await POST(request());expect(rejected.status).toBe(503);expect(await rejected.json()).toEqual({success:false,code:'DOCUMENT_TRANSPORT_DRAINING'});
    expect(m.auth).toHaveBeenCalledTimes(beforeAuth);await expectPending(drain);
    committed.resolve({rows:[]});await vi.waitFor(()=>expect(raw.release).toHaveBeenCalledOnce());
    expect(getDocumentExecutionStats().ownedClients).toBe(1);await expectPending(drain);expect(()=>finishDocumentTransportTransition(transition)).toThrow();
    expect(socket.frames.some(frame=>frame[0]===0x12)).toBe(false);
    finishEnd();await transition.drained;finishDocumentTransportTransition(transition);expect(documentTransportCanStart('http')).toBe(true);
    expect(raw.query.mock.calls.filter(([sql])=>sql==='COMMIT')).toHaveLength(1);
    expect(socket.frames.some(frame=>frame[0]===0x12)).toBe(false);
  });
  it('retains an early HTTP response root until its original unused-body cancellation finishes',async()=>{
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED','true');m.auth.mockResolvedValueOnce(null);
    const input=request(new ReadableStream<Uint8Array>()),cancelled=deferred<void>();cleanup.push(()=>cancelled.resolve());
    const cancel=vi.spyOn(input.body!,'cancel').mockReturnValue(cancelled.promise);
    expect((await POST(input)).status).toBe(401);expect(cancel).toHaveBeenCalledOnce();
    const transition=beginDocumentTransportTransition('ws'),drain=observeDrain(transition.drained);
    vi.stubEnv('WUJIE_YJS_HTTP_ENABLED','false');await expectPending(drain);expect(getDocumentExecutionStats().activeScopes).toBe(1);
    cancelled.resolve();await transition.drained;vi.stubEnv('WUJIE_YJS_HTTP_ENABLED','false');finishDocumentTransportTransition(transition);
    expect(documentTransportCanStart('ws')).toBe(true);expect(m.issue).not.toHaveBeenCalled();
  });
});
