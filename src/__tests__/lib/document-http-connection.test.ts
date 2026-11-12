// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
// @ts-expect-error The existing jsdom dependency has no installed declarations.
import {JSDOM} from 'jsdom';
import * as Y from 'yjs';
import {createBrowserPendingUpdateStore,createCanvasDocumentSession} from '@/lib/collaboration/document-client';
import {applyCanvasImagePatch,createCanvasDocument} from '@/lib/collaboration/canvas-document';
import {createDocumentHttpBrowserStorage} from '@/lib/collaboration/document-http-browser-storage';
import {openDocumentHttpConnection} from '@/lib/collaboration/document-http-connection';
import { documentBrowserCrypto } from '../fixtures/document-browser-crypto';

const token='t'.repeat(43),ticket='k'.repeat(43),hash=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
const descriptor={sessionToken:token,sessionFingerprint:hash(token),actorId:'actor-a',ownerId:'owner-a',projectId:'project-a',grantGeneration:'1',expiresAt:'2030-01-01T00:00:00.000Z',retainUntil:'2030-02-01T00:00:00.000Z'};
const digest=(bytes:Uint8Array)=>createHash('sha256').update('wujie-document-update-v1\0').update(bytes).digest('hex');
const frame=(seq:number,bytes:Uint8Array):Uint8Array<ArrayBuffer>=>{const result=new Uint8Array(9+bytes.length);result[0]=0x11;new DataView(result.buffer).setBigUint64(1,BigInt(seq));result.set(bytes,9);return result};
function locks(){const held=new Map<string,symbol>();const request=vi.fn((name:string,_options:LockOptions,callback:(lock:Lock|null)=>Promise<void>)=>{if(held.has(name))return Promise.resolve().then(()=>callback(null));const id=Symbol(name);held.set(name,id);return Promise.resolve().then(()=>callback({name,mode:'exclusive'} as Lock)).finally(()=>{if(held.get(name)===id)held.delete(name)});});return {held,request};}
const active:Array<()=>Promise<void>>=[];let platform:ReturnType<typeof locks>;
beforeEach(()=>{const dom=new JSDOM('',{url:'https://fixture.invalid/'});vi.stubGlobal('localStorage',dom.window.localStorage);vi.stubGlobal('sessionStorage',dom.window.sessionStorage);vi.stubGlobal('crypto',documentBrowserCrypto);vi.stubGlobal('WebSocket',{OPEN:1});platform=locks();vi.stubGlobal('navigator',{locks:platform});vi.stubGlobal('isSecureContext',true);});
afterEach(async()=>{while(active.length)await active.pop()?.();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
function setup(){
  const server=createCanvasDocument();applyCanvasImagePatch(server,{placementId:'p1',assetVersionId:'v1',x:1,y:2,width:80,height:60,rotation:0,zIndex:0},'seed');
  const calls:Array<{url:string;init:RequestInit}>=[];let receiptMode:'confirmed'|'null'='confirmed';let current=true;const owner=new AbortController();
  const fetcher=vi.fn(async (url:string,init:RequestInit):Promise<Response>=>{
    calls.push({url,init});if(url==='/api/collaboration/document-ticket')return Response.json({success:true,ticket});
    if(url==='/api/collaboration/document-exchange-session')return Response.json({success:true,session:descriptor});
    if(url==='/api/collaboration/document-exchange-receipt'){const body=JSON.parse(String(init.body));return Response.json({success:true,receipt:receiptMode==='null'?null:{operationId:body.operationId,sessionFingerprint:descriptor.sessionFingerprint,updateDigest:body.updateDigest,documentSequence:2}});}
    if(url==='/api/collaboration/document-exchange'){
      const bytes=new Uint8Array(init.body as ArrayBuffer);if(bytes[0]===1)return new Response(frame(1,Y.encodeStateAsUpdate(server,bytes.subarray(1))),{headers:{'content-type':'application/octet-stream','x-wujie-document-session-fingerprint':descriptor.sessionFingerprint}});
      Y.applyUpdate(server,bytes.subarray(1));return Response.json({success:true,receipt:{operationId:new Headers(init.headers).get('x-wujie-document-operation-id'),sessionFingerprint:descriptor.sessionFingerprint,updateDigest:digest(bytes.subarray(1)),documentSequence:2}});
    } throw Error('FORBIDDEN_SYNTHETIC_REQUEST');
  });
  const createPendingStore=()=>createBrowserPendingUpdateStore('project-a','actor-a');
  const createSession=vi.fn((socket:WebSocket,store:ReturnType<typeof createPendingStore>)=>createCanvasDocumentSession(socket,undefined,store));
  const onRecovery=vi.fn();const opts={actorId:'actor-a',projectId:'project-a',ownerId:'owner-a',signal:owner.signal,assertCurrent(){if(!current)throw Error('stale');},createPendingStore,createSession,onRecovery,fetch:fetcher};
  async function open(){const result=await openDocumentHttpConnection(opts);active.push(()=>result.close());return result;}
  async function seed(kind:'descriptor'|'pending'|'missing-journal'|'orphan'){
    const raw=createPendingStore(),storage=createDocumentHttpBrowserStorage({actorId:'actor-a',projectId:'project-a',pendingStore:raw,assertLease:()=>{}});await storage.saveDescriptor(descriptor);
    if(kind==='descriptor')return;
    const value=new Uint8Array([2,0,0]),id=raw.append(value),journal=storage.journalFor(descriptor);
    if(kind!=='missing-journal')journal.put(id,{operationId:'12345678-1234-4234-8234-123456789abc',sessionFingerprint:descriptor.sessionFingerprint,updateDigest:digest(value.subarray(1)),actorId:'actor-a',projectId:'project-a',ownerId:'owner-a',grantGeneration:'1'});
    if(kind==='orphan')raw.remove(id);return id;
  }
  active.push(async()=>{server.destroy()});return {opts,open,seed,calls,fetcher,server,owner,createSession,onRecovery,createPendingStore,setReceipt:(value:'confirmed'|'null')=>{receiptMode=value},stale:()=>{current=false}};
}

describe('real HTTP connection manager with controlled platform and fetch',()=>{
  it('opens an empty scope with one HTTP ticket, start and real session, then releases on close',async()=>{
    const f=setup();const connection=await f.open();expect(connection.session.status).toBe('saved');expect(f.createSession).toHaveBeenCalledTimes(1);
    const ticketCall=f.calls.find(c=>c.url.endsWith('document-ticket'))!;expect(new Headers(ticketCall.init.headers).get('x-wujie-document-transport')).toBe('http');expect(new Headers(ticketCall.init.headers).get('x-wujie-expected-actor-id')).toBe('actor-a');
    expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(1);expect(f.calls.filter(c=>c.url.endsWith('document-exchange-session'))).toHaveLength(1);
    const p=connection.close(),q=connection.close();expect(p).toBe(q);expect(connection.session.status).toBe('unavailable');await p;expect(platform.held.size).toBe(0);
  });
  it('renews the original descriptor without a ticket and never silently changes its identity',async()=>{
    const f=setup();await f.seed('descriptor');const result=await f.open();expect(result.session.status).toBe('saved');
    expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(0);const call=f.calls.find(c=>c.url.endsWith('document-exchange-session'))!;
    expect(JSON.parse(String(call.init.body))).toEqual({action:'renew',projectId:'project-a',sessionToken:token});
  });
  it('accepts reordered but identical descriptor fields on both start and renew',async()=>{
    const f=setup(),original=f.fetcher.getMockImplementation()!;
    const reordered={retainUntil:descriptor.retainUntil,expiresAt:descriptor.expiresAt,grantGeneration:descriptor.grantGeneration,
      projectId:descriptor.projectId,ownerId:descriptor.ownerId,actorId:descriptor.actorId,
      sessionFingerprint:descriptor.sessionFingerprint,sessionToken:descriptor.sessionToken};
    expect(Object.keys(reordered)).not.toEqual(Object.keys(descriptor));
    f.fetcher.mockImplementation(async(url,init)=>{if(url.endsWith('document-exchange-session')){f.calls.push({url,init});return Response.json({success:true,session:reordered});}return original(url,init)});
    const first=await f.open();expect(first.session.status).toBe('saved');await first.close();
    const second=await f.open();expect(second.session.status).toBe('saved');
    expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(1);
    expect(f.calls.filter(c=>c.url.endsWith('document-exchange-session')).map(c=>JSON.parse(String(c.init.body)).action)).toEqual(['start','renew']);
    expect(f.calls.filter(c=>c.url.endsWith('document-exchange'))).toHaveLength(2);
  });
  it.each([{status:410,code:'DOCUMENT_EXCHANGE_EXPIRED'},{status:403,code:'DOCUMENT_EXCHANGE_FORBIDDEN'}])('replaces an empty unusable descriptor only after a newly authorized start: $code',async failure=>{
    const f=setup();await f.seed('descriptor');const original=f.fetcher.getMockImplementation()!,nextToken='n'.repeat(43),next={...descriptor,sessionToken:nextToken,sessionFingerprint:hash(nextToken),grantGeneration:'2'};
    f.fetcher.mockImplementation(async(url,init)=>{
      if(url.endsWith('document-exchange-session')){f.calls.push({url,init});return JSON.parse(String(init.body)).action==='renew'?Response.json({success:false,code:failure.code},{status:failure.status}):Response.json({success:true,session:next});}
      if(url.endsWith('document-exchange')){f.calls.push({url,init});const bytes=new Uint8Array(init.body as ArrayBuffer);return new Response(frame(1,Y.encodeStateAsUpdate(f.server,bytes.subarray(1))),{headers:{'content-type':'application/octet-stream','x-wujie-document-session-fingerprint':next.sessionFingerprint}});}
      return original(url,init);
    });
    const connection=await f.open();expect(connection.session.status).toBe('saved');expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(1);
    expect(f.calls.filter(c=>c.url.endsWith('document-exchange-session')).map(c=>JSON.parse(String(c.init.body)).action)).toEqual(['renew','start']);
    expect(JSON.parse(window.localStorage.getItem('wujie-canvas-document-http-session-v1:actor-a:project-a')!).sessionFingerprint).toBe(next.sessionFingerprint);
  });
  it.each(['pending','orphan'] as const)('never requests a new ticket for unusable descriptor with %s',async kind=>{
    const f=setup();await f.seed(kind);const key='wujie-canvas-document-http-session-v1:actor-a:project-a',before=window.localStorage.getItem(key);
    f.fetcher.mockImplementationOnce(async(url,init)=>{f.calls.push({url,init});return Response.json({success:false,code:'DOCUMENT_EXCHANGE_FORBIDDEN'},{status:403})});
    await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});expect(window.localStorage.getItem(key)).toBe(before);expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(0);expect(f.createSession).not.toHaveBeenCalled();
  });
  it.each([{status:401,code:'AUTHENTICATION_REQUIRED'},{status:403,code:'DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN'},{status:409,code:'ACTOR_SCOPE_CHANGED'}])('does not rotate on $code',async failure=>{
    const f=setup();await f.seed('descriptor');const before=window.localStorage.getItem('wujie-canvas-document-http-session-v1:actor-a:project-a');
    f.fetcher.mockImplementationOnce(async(url,init)=>{f.calls.push({url,init});return Response.json({success:false,code:failure.code},{status:failure.status})});
    await expect(f.open()).rejects.toMatchObject({code:'ACCESS_DENIED'});expect(window.localStorage.getItem('wujie-canvas-document-http-session-v1:actor-a:project-a')).toBe(before);expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(0);
  });
  it.each(['{"success":false,"code":"DOCUMENT_EXCHANGE_FORBIDDEN","extra":true}','{"success":false,"success":false,"code":"DOCUMENT_EXCHANGE_FORBIDDEN"}'])('does not rotate on non-contract renew error',async body=>{
    const f=setup();await f.seed('descriptor');const before=window.localStorage.getItem('wujie-canvas-document-http-session-v1:actor-a:project-a');
    f.fetcher.mockImplementationOnce(async()=>new Response(body,{status:403,headers:{'content-type':'application/json'}}));
    await expect(f.open()).rejects.toMatchObject({code:'ACCESS_DENIED'});expect(window.localStorage.getItem('wujie-canvas-document-http-session-v1:actor-a:project-a')).toBe(before);expect(f.createSession).not.toHaveBeenCalled();expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it('preserves old descriptor when fresh ticket authorization is denied',async()=>{
    const f=setup();await f.seed('descriptor');const key='wujie-canvas-document-http-session-v1:actor-a:project-a',before=window.localStorage.getItem(key);
    f.fetcher.mockImplementationOnce(async()=>Response.json({success:false,code:'DOCUMENT_EXCHANGE_FORBIDDEN'},{status:403}));
    f.fetcher.mockImplementationOnce(async(url,init)=>{f.calls.push({url,init});return Response.json({success:false,code:'DOCUMENT_FORBIDDEN'},{status:403})});
    await expect(f.open()).rejects.toMatchObject({code:'ACCESS_DENIED'});expect(window.localStorage.getItem(key)).toBe(before);expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(1);expect(f.createSession).not.toHaveBeenCalled();
  });
  it('stops rotation if pending appears while a fresh ticket is in flight',async()=>{
    const f=setup();await f.seed('descriptor');const key='wujie-canvas-document-http-session-v1:actor-a:project-a',before=window.localStorage.getItem(key),original=f.fetcher.getMockImplementation()!;let finish!:(response:Response)=>void;
    f.fetcher.mockImplementation((url,init)=>{if(url.endsWith('document-exchange-session')){f.calls.push({url,init});return Promise.resolve(Response.json({success:false,code:'DOCUMENT_EXCHANGE_FORBIDDEN'},{status:403}));}if(url.endsWith('document-ticket')){f.calls.push({url,init});return new Promise<Response>(resolve=>{finish=resolve})}return original(url,init)});
    const opening=f.open(),result=opening.then(()=> 'opened',e=>String(e.code));await vi.waitFor(()=>expect(finish).toBeDefined());f.createPendingStore().append(new Uint8Array([2,0,0]));finish(Response.json({success:true,ticket}));
    expect(await result).toBe('RECOVERY_REQUIRED');expect(f.createPendingStore().load()).toHaveLength(1);expect(window.localStorage.getItem(key)).toBe(before);expect(f.calls.filter(c=>c.url.endsWith('document-exchange-session'))).toHaveLength(1);expect(f.createSession).not.toHaveBeenCalled();
  });
  it('stops rotation if pending appears while replacement start is in flight',async()=>{
    const f=setup();await f.seed('descriptor');const key='wujie-canvas-document-http-session-v1:actor-a:project-a',before=window.localStorage.getItem(key),original=f.fetcher.getMockImplementation()!;let finish!:(response:Response)=>void;
    f.fetcher.mockImplementation((url,init)=>{if(url.endsWith('document-exchange-session')){f.calls.push({url,init});return JSON.parse(String(init.body)).action==='renew'?Promise.resolve(Response.json({success:false,code:'DOCUMENT_EXCHANGE_FORBIDDEN'},{status:403})):new Promise<Response>(resolve=>{finish=resolve})}return original(url,init)});
    const opening=f.open(),result=opening.then(()=> 'opened',e=>String(e.code));await vi.waitFor(()=>expect(finish).toBeDefined());f.createPendingStore().append(new Uint8Array([2,0,0]));finish(Response.json({success:true,session:descriptor}));
    expect(await result).toBe('RECOVERY_REQUIRED');expect(f.createPendingStore().load()).toHaveLength(1);expect(window.localStorage.getItem(key)).toBe(before);expect(window.localStorage.getItem('wujie-canvas-document-http-start-unknown-v1:actor-a:project-a')).not.toBeNull();expect(f.createSession).not.toHaveBeenCalled();
  });
  it('rechecks empty storage immediately before replacement start fetch',async()=>{
    const f=setup();await f.seed('descriptor');const key='wujie-canvas-document-http-session-v1:actor-a:project-a',before=window.localStorage.getItem(key),original=f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async(url,init)=>{if(url.endsWith('document-exchange-session')){f.calls.push({url,init});return Response.json({success:false,code:'DOCUMENT_EXCHANGE_FORBIDDEN'},{status:403});}return original(url,init)});
    const proto=Object.getPrototypeOf(window.localStorage) as Storage,realSet=proto.setItem;let inserted=false;
    vi.spyOn(proto,'setItem').mockImplementation(function(this:Storage,k,v){realSet.call(this,k,v);if(k.startsWith('wujie-canvas-document-http-start-unknown-v1:'))queueMicrotask(()=>{inserted=true;f.createPendingStore().append(new Uint8Array([2,0,0]))});});
    await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});expect(inserted).toBe(true);expect(f.createPendingStore().load()).toHaveLength(1);expect(window.localStorage.getItem(key)).toBe(before);expect(f.calls.filter(c=>c.url.endsWith('document-exchange-session'))).toHaveLength(1);expect(f.createSession).not.toHaveBeenCalled();
  });
  it('does not rotate an unusable descriptor when an older unknown start marker exists',async()=>{
    const f=setup();await f.seed('descriptor');const key='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a',marker=JSON.stringify({version:2,attempts:[Date.now()]});window.localStorage.setItem(key,marker);
    f.fetcher.mockImplementationOnce(async(url,init)=>{f.calls.push({url,init});return Response.json({success:false,code:'DOCUMENT_EXCHANGE_FORBIDDEN'},{status:403})});
    await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});expect(window.localStorage.getItem(key)).toBe(marker);expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(0);
  });
  it('retains old identity and unknown marker if a replacement start response is lost',async()=>{
    const f=setup();await f.seed('descriptor');const key='wujie-canvas-document-http-session-v1:actor-a:project-a',marker='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a',before=window.localStorage.getItem(key),original=f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async(url,init)=>{if(url.endsWith('document-exchange-session')){f.calls.push({url,init});return JSON.parse(String(init.body)).action==='renew'?Response.json({success:false,code:'DOCUMENT_EXCHANGE_FORBIDDEN'},{status:403}):new Response(null,{status:503});}return original(url,init)});
    await expect(f.open()).rejects.toMatchObject({code:'UNAVAILABLE'});const unknown=window.localStorage.getItem(marker);expect(unknown).not.toBeNull();expect(window.localStorage.getItem(key)).toBe(before);
    const beforeAgain=f.calls.length;await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});expect(f.calls.slice(beforeAgain).filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(0);expect(window.localStorage.getItem(marker)).toBe(unknown);expect(window.localStorage.getItem(key)).toBe(before);
  });
  it('retains unknown replacement marker when the original cookie can renew again',async()=>{
    const f=setup();await f.seed('descriptor');const key='wujie-canvas-document-http-session-v1:actor-a:project-a',marker='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a',before=window.localStorage.getItem(key),original=f.fetcher.getMockImplementation()!;let oldCookie=false;
    f.fetcher.mockImplementation(async(url,init)=>{if(url.endsWith('document-exchange-session')){f.calls.push({url,init});const action=JSON.parse(String(init.body)).action;
      if(action==='start')return new Response(null,{status:503});return oldCookie?Response.json({success:true,session:descriptor}):Response.json({success:false,code:'DOCUMENT_EXCHANGE_FORBIDDEN'},{status:403});}return original(url,init)});
    await expect(f.open()).rejects.toMatchObject({code:'UNAVAILABLE'});const unknown=window.localStorage.getItem(marker);expect(unknown).not.toBeNull();oldCookie=true;const calls=f.calls.length;
    await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});expect(window.localStorage.getItem(marker)).toBe(unknown);expect(window.localStorage.getItem(key)).toBe(before);
    expect(f.calls.slice(calls).filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(0);expect(f.createSession).not.toHaveBeenCalled();
  });
  it('clears a known replacement marker only after its new descriptor was durably installed',async()=>{
    const f=setup();await f.seed('descriptor');const original=f.fetcher.getMockImplementation()!,nextToken='n'.repeat(43),next={...descriptor,sessionToken:nextToken,sessionFingerprint:hash(nextToken),grantGeneration:'2'},marker='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a';
    let firstRenew=true;f.fetcher.mockImplementation(async(url,init)=>{if(url.endsWith('document-exchange-session')){f.calls.push({url,init});if(JSON.parse(String(init.body)).action==='renew'&&firstRenew){firstRenew=false;return Response.json({success:false,code:'DOCUMENT_EXCHANGE_FORBIDDEN'},{status:403});}return Response.json({success:true,session:next});}
      if(url.endsWith('document-exchange')){f.calls.push({url,init});const bytes=new Uint8Array(init.body as ArrayBuffer);return new Response(frame(1,Y.encodeStateAsUpdate(f.server,bytes.subarray(1))),{headers:{'content-type':'application/octet-stream','x-wujie-document-session-fingerprint':next.sessionFingerprint}});}return original(url,init)});
    const proto=Object.getPrototypeOf(window.localStorage) as Storage,realRemove=proto.removeItem;const fault=vi.spyOn(proto,'removeItem').mockImplementation(function(this:Storage,key){if(key===marker)throw Error('controlled crash before clear');realRemove.call(this,key)});
    await expect(f.open()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(JSON.parse(window.localStorage.getItem(marker)!).target).toBe(next.sessionFingerprint);
    expect(JSON.parse(window.localStorage.getItem('wujie-canvas-document-http-session-v1:actor-a:project-a')!).sessionFingerprint).toBe(next.sessionFingerprint);fault.mockRestore();
    const connection=await f.open();expect(connection.session.status).toBe('saved');expect(window.localStorage.getItem(marker)).toBeNull();expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(1);
  });
  it.each(['actorId','ownerId','projectId'] as const)('does not replace descriptor when freshly authorized start changes %s',async field=>{
    const f=setup();await f.seed('descriptor');const key='wujie-canvas-document-http-session-v1:actor-a:project-a',before=window.localStorage.getItem(key),original=f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async(url,init)=>{if(url.endsWith('document-exchange-session')){f.calls.push({url,init});return JSON.parse(String(init.body)).action==='renew'?Response.json({success:false,code:'DOCUMENT_EXCHANGE_FORBIDDEN'},{status:403}):Response.json({success:true,session:{...descriptor,[field]:'different'}});}return original(url,init)});
    await expect(f.open()).rejects.toMatchObject({code:'ACCESS_DENIED'});expect(window.localStorage.getItem(key)).toBe(before);expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(1);expect(f.createSession).not.toHaveBeenCalled();
  });
  it('recovers matching pending only through explicit retry on a newly created real session',async()=>{
    const f=setup();await f.seed('pending');const result=await f.open();expect(result.session.status).toBe('recovery');
    expect(f.calls.filter(c=>c.url.endsWith('document-exchange') && new Uint8Array(c.init.body as ArrayBuffer)[0]===2)).toHaveLength(0);
    result.session.retryRecovered();await vi.waitFor(()=>expect(result.session.status).toBe('saved'));expect(f.createPendingStore().load()).toHaveLength(0);
  });
  it('preserves and exports missing-journal pending without creating a session',async()=>{
    const f=setup();await f.seed('missing-journal');await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});
    expect(f.createSession).not.toHaveBeenCalled();expect(f.onRecovery).toHaveBeenCalledTimes(1);expect(f.createPendingStore().load()).toHaveLength(1);expect(platform.held.size).toBe(0);
  });
  it.each(['confirmed','null'] as const)('only creates the session when orphan receipt is %s',async mode=>{
    const f=setup(),id=await f.seed('orphan');f.setReceipt(mode);
    if(mode==='confirmed'){const connection=await f.open();expect(connection.session.status).toBe('saved');expect(f.createSession).toHaveBeenCalledTimes(1);expect(window.localStorage.getItem('wujie-canvas-document-http-journal-v1:actor-a:project-a:'+id)).toBeNull();}
    else{await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});expect(f.createSession).not.toHaveBeenCalled();expect(window.localStorage.getItem('wujie-canvas-document-http-journal-v1:actor-a:project-a:'+id)).not.toBeNull();}
  });
  it('aborts an in-flight ticket and releases its lease without minting or creating a session',async()=>{
    const f=setup();let ticketSignal:AbortSignal|undefined;f.fetcher.mockImplementationOnce(async(_url,init)=>{ticketSignal=init.signal!;return new Promise<Response>(()=>{})});
    const opening=f.open();const observed=opening.then(()=> 'opened',e=>String(e.code));await vi.waitFor(()=>expect(ticketSignal).toBeDefined());f.owner.abort();
    expect(await observed).toBe('CANCELLED');expect(ticketSignal!.aborted).toBe(true);expect(f.createSession).not.toHaveBeenCalled();await vi.waitFor(()=>expect(platform.held.size).toBe(0));
  });
  it('does not mint when pending exists without any descriptor',async()=>{
    const f=setup();f.createPendingStore().append(new Uint8Array([2,0,0]));await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});
    expect(f.calls).toHaveLength(0);expect(f.createSession).not.toHaveBeenCalled();expect(f.onRecovery).toHaveBeenCalledTimes(1);expect(f.createPendingStore().load()).toHaveLength(1);
  });
  it('does not lose pending if the recovery observer throws',async()=>{
    const f=setup();await f.seed('missing-journal');f.onRecovery.mockImplementation(()=>{throw Error('private observer error')});
    await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED',message:'RECOVERY_REQUIRED'});expect(f.createPendingStore().load()).toHaveLength(1);
  });
  it.each(['token','owner','generation','expiry'] as const)('rejects a renewed descriptor that changes %s without updating local storage',async mode=>{
    const f=setup();await f.seed('descriptor');const key='wujie-canvas-document-http-session-v1:actor-a:project-a',before=window.localStorage.getItem(key);
    const altered=mode==='token'?{sessionToken:'u'.repeat(43),sessionFingerprint:hash('u'.repeat(43))}:mode==='owner'?{ownerId:'other'}:mode==='generation'?{grantGeneration:'2'}:{expiresAt:'2029-01-01T00:00:00.000Z'};
    f.fetcher.mockImplementationOnce(async()=>Response.json({success:true,session:{...descriptor,...altered}}));
    await expect(f.open()).rejects.toMatchObject({code:mode==='expiry'?'UNAVAILABLE':'ACCESS_DENIED'});expect(window.localStorage.getItem(key)).toBe(before);expect(f.createSession).not.toHaveBeenCalled();expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(0);
  });
  it.each(['actor','project','fingerprint','retainUntil'] as const)('rejects a renewed descriptor that changes fixed %s',async mode=>{
    const f=setup();await f.seed('descriptor');const key='wujie-canvas-document-http-session-v1:actor-a:project-a',before=window.localStorage.getItem(key);
    const altered=mode==='actor'?{actorId:'other-actor'}:mode==='project'?{projectId:'other-project'}:mode==='fingerprint'?{sessionFingerprint:hash('different')}:{retainUntil:'2030-03-01T00:00:00.000Z'};
    f.fetcher.mockImplementationOnce(async(url,init)=>{f.calls.push({url,init});return Response.json({success:true,session:{...descriptor,...altered}})});
    await expect(f.open()).rejects.toMatchObject({code:'ACCESS_DENIED'});expect(window.localStorage.getItem(key)).toBe(before);expect(f.createSession).not.toHaveBeenCalled();
    expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(0);expect(f.calls.filter(c=>c.url.endsWith('document-exchange'))).toHaveLength(0);
  });
  it('fails cancelled after generation changes while renew is in flight, without a stale recovery callback',async()=>{
    const f=setup();await f.seed('descriptor');let done!:(response:Response)=>void;f.fetcher.mockImplementationOnce(()=>new Promise<Response>(resolve=>{done=resolve}));
    const opening=f.open();const result=opening.then(()=> 'opened',e=>String(e.code));await vi.waitFor(()=>expect(done).toBeDefined());f.stale();done(Response.json({success:true,session:descriptor}));
    expect(await result).toBe('CANCELLED');expect(f.createSession).not.toHaveBeenCalled();expect(f.onRecovery).not.toHaveBeenCalled();expect(platform.held.size).toBe(0);
  });
  it('reports unavailable for failed initial sync and releases the lease',async()=>{
    const f=setup(),original=f.fetcher.getMockImplementation()!;f.fetcher.mockImplementation(async(url,init)=>url.endsWith('document-exchange')?new Response(null,{status:503}):original(url,init));
    await expect(f.open()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.createSession).toHaveBeenCalledTimes(1);expect(platform.held.size).toBe(0);
  });
  it('rejects extra ticket response fields and does not issue a session request',async()=>{
    const f=setup();f.fetcher.mockImplementationOnce(async()=>Response.json({success:true,ticket,extra:true}));
    await expect(f.open()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.createSession).not.toHaveBeenCalled();expect(platform.held.size).toBe(0);
  });
  it('classifies only the exact ticket mode-change conflict for directory reinspection',async()=>{
    const f=setup();f.fetcher.mockImplementationOnce(async(url,init)=>{f.calls.push({url,init});return Response.json({success:false,code:'DOCUMENT_TRANSPORT_CHANGED'},{status:409})});
    await expect(f.open()).rejects.toMatchObject({code:'TRANSPORT_CHANGED'});expect(f.calls).toHaveLength(1);expect(f.createSession).not.toHaveBeenCalled();expect(platform.held.size).toBe(0);
    expect(window.localStorage.getItem('wujie-canvas-document-http-start-unknown-v1:actor-a:project-a')).toBeNull();
  });
  it.each([{success:false,code:'ACTOR_SCOPE_CHANGED'},{success:false,code:'DOCUMENT_TRANSPORT_CHANGED',extra:true},{success:true,code:'DOCUMENT_TRANSPORT_CHANGED'}])('does not treat another ticket conflict as mode change: %j',async body=>{
    const f=setup();f.fetcher.mockImplementationOnce(async()=>Response.json(body,{status:409}));
    await expect(f.open()).rejects.toMatchObject({code:'ACCESS_DENIED'});expect(f.createSession).not.toHaveBeenCalled();expect(platform.held.size).toBe(0);
  });
  it('accepts reversed fixed conflict fields while rejecting duplicate keys',async()=>{
    const response=(body:string)=>new Response(body,{status:409,headers:{'content-type':'application/json'}});
    const first=setup();first.fetcher.mockImplementationOnce(async()=>response('{"code":"DOCUMENT_TRANSPORT_CHANGED","success":false}'));
    await expect(first.open()).rejects.toMatchObject({code:'TRANSPORT_CHANGED'});
    const second=setup();second.fetcher.mockImplementationOnce(async()=>response('{"success":false,"success":false,"code":"DOCUMENT_TRANSPORT_CHANGED"}'));
    await expect(second.open()).rejects.toMatchObject({code:'ACCESS_DENIED'});expect(second.createSession).not.toHaveBeenCalled();
  });
  it('bounds and cancels a hanging ticket conflict body before classifying it',async()=>{
    vi.useFakeTimers();const f=setup(),cancel=vi.fn(),started=vi.fn();
    f.fetcher.mockImplementationOnce(async()=>new Response(new ReadableStream<Uint8Array>({pull(){started()},cancel}),{status:409,headers:{'content-type':'application/json'}}));
    const opening=f.open(),result=opening.then(()=> 'opened',e=>String(e.code));for(let i=0;i<20 && !started.mock.calls.length;i++)await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveBeenCalled();await vi.advanceTimersByTimeAsync(10_000);expect(await result).toBe('UNAVAILABLE');expect(cancel).toHaveBeenCalled();expect(f.createSession).not.toHaveBeenCalled();
  });
  it('bounds an already-started response stream and cancels it after ten seconds',async()=>{
    vi.useFakeTimers();const f=setup(),cancel=vi.fn(),started=vi.fn();
    f.fetcher.mockImplementationOnce(async()=>new Response(new ReadableStream<Uint8Array>({pull(){started()},cancel}),{headers:{'content-type':'application/json'}}));
    const opening=f.open(),outcome=opening.then(()=> 'opened',e=>String(e.code));
    for(let i=0;i<10 && !started.mock.calls.length;i++)await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveBeenCalled();await vi.advanceTimersByTimeAsync(10_000);expect(await outcome).toBe('UNAVAILABLE');
    expect(cancel).toHaveBeenCalled();expect(f.createSession).not.toHaveBeenCalled();expect(platform.held.size).toBe(0);
  });
  it('survives a local edit interleaved with a successful descriptor renewal',async()=>{
    vi.useFakeTimers();const f=setup();const connection=await f.open(),original=f.fetcher.getMockImplementation()!;
    const newer={...descriptor,expiresAt:'2030-01-02T00:00:00.000Z'};
    f.fetcher.mockImplementation(async(url,init)=>{if(url.endsWith('document-exchange-session') && JSON.parse(String(init.body)).action==='renew'){f.calls.push({url,init});return Response.json({success:true,session:newer});}return original(url,init)});
    const proto=Object.getPrototypeOf(window.localStorage) as Storage, realSet=proto.setItem;let changed=false;
    vi.spyOn(proto,'setItem').mockImplementation(function(this:Storage,key,value){realSet.call(this,key,value);if(key.startsWith('wujie-canvas-document-http-session-v1:') && !changed){changed=true;queueMicrotask(()=>connection.session.applyLocalChange({placementId:'p1',x:99}));}});
    await vi.advanceTimersByTimeAsync(240_000);for(let i=0;i<10;i++)await vi.advanceTimersByTimeAsync(0);
    expect(changed).toBe(true);expect(connection.session.images.p1.x).toBe(99);expect(connection.session.status).toBe('saved');expect(f.createPendingStore().load()).toHaveLength(0);
  },10000);
  it('does not issue another ticket or start when the start response is lost',async()=>{
    vi.useFakeTimers();const f=setup(),original=f.fetcher.getMockImplementation()!;let startSignal:AbortSignal|undefined;
    f.fetcher.mockImplementation((url,init)=>{if(url.endsWith('document-exchange-session')){f.calls.push({url,init});startSignal=init.signal!;return new Promise<Response>(()=>{});}return original(url,init)});
    const opening=f.open(),outcome=opening.then(()=> 'opened',e=>String(e.code));for(let i=0;i<20 && !startSignal;i++)await vi.advanceTimersByTimeAsync(0);
    expect(startSignal).toBeDefined();await vi.advanceTimersByTimeAsync(10_000);expect(await outcome).toBe('UNAVAILABLE');expect(startSignal!.aborted).toBe(true);
    expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(1);expect(f.calls.filter(c=>c.url.endsWith('document-exchange-session'))).toHaveLength(1);expect(f.createSession).not.toHaveBeenCalled();expect(platform.held.size).toBe(0);
  });
  it('stops the real session and retains the original descriptor on periodic renewal failure',async()=>{
    vi.useFakeTimers();const f=setup();const connection=await f.open(),original=f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async(url,init)=>{if(url.endsWith('document-exchange-session') && JSON.parse(String(init.body)).action==='renew'){f.calls.push({url,init});return new Response(null,{status:503});}return original(url,init)});
    await vi.advanceTimersByTimeAsync(240_000);expect(connection.session.status).toBe('unavailable');expect(f.onRecovery).toHaveBeenCalledTimes(1);
    expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(1);expect(f.calls.filter(c=>c.url.endsWith('document-exchange-session'))).toHaveLength(2);
    expect(window.localStorage.getItem('wujie-canvas-document-http-session-v1:actor-a:project-a')).toContain(token);await vi.advanceTimersByTimeAsync(240_000);
    expect(f.calls.filter(c=>c.url.endsWith('document-exchange-session'))).toHaveLength(2);
  },10000);
  it('disconnects the session when the native lease is lost',async()=>{
    let rejectNative!:(error:Error)=>void;
    platform.request.mockImplementation((name,_options,callback)=>{void callback({name,mode:'exclusive'} as Lock);return new Promise<void>((_,reject)=>{rejectNative=reject});});
    const f=setup();const connection=await f.open();expect(connection.session.status).toBe('saved');rejectNative(Error('native lost'));
    await vi.waitFor(()=>expect(connection.session.status).toBe('unavailable'));expect(f.createSession).toHaveBeenCalledTimes(1);
  });
  it('keeps an orphan in recovery when its authorized receipt query is unavailable',async()=>{
    const f=setup(),id=await f.seed('orphan'),original=f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async(url,init)=>{if(url.endsWith('document-exchange-receipt')){f.calls.push({url,init});return new Response(null,{status:503});}return original(url,init)});
    await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});expect(f.createSession).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('wujie-canvas-document-http-journal-v1:actor-a:project-a:'+id)).not.toBeNull();expect(f.onRecovery).toHaveBeenCalledTimes(1);
  });
  it('retains and exports an in-flight pending frame if periodic renewal fails',async()=>{
    vi.useFakeTimers();const f=setup(),connection=await f.open();await vi.advanceTimersByTimeAsync(239_999);
    const original=f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation((url,init)=>{
      if(url.endsWith('document-exchange-session') && JSON.parse(String(init.body)).action==='renew'){f.calls.push({url,init});return Promise.resolve(new Response(null,{status:503}));}
      if(url.endsWith('document-exchange') && new Uint8Array(init.body as ArrayBuffer)[0]===2){f.calls.push({url,init});return new Promise<Response>(()=>{});}
      return original(url,init);
    });
    connection.session.applyLocalChange({placementId:'p1',x:140});for(let i=0;i<10 && !f.calls.some(c=>c.url.endsWith('document-exchange') && new Uint8Array(c.init.body as ArrayBuffer)[0]===2);i++)await vi.advanceTimersByTimeAsync(0);
    expect(f.createPendingStore().load()).toHaveLength(1);await vi.advanceTimersByTimeAsync(1);
    expect(connection.session.status).toBe('unavailable');expect(f.createPendingStore().load()).toHaveLength(1);
    expect(f.onRecovery).toHaveBeenCalledTimes(1);expect(f.onRecovery.mock.calls[0][0].pendingFrames).toHaveLength(1);
  },10000);
  it('cancels a ticket response whose declared body exceeds 4 KiB',async()=>{
    const f=setup(),cancel=vi.fn();let signal:AbortSignal|undefined;
    f.fetcher.mockImplementationOnce(async(_url,init)=>{signal=init.signal!;return new Response(new ReadableStream<Uint8Array>({cancel}),{headers:{'content-type':'application/json','content-length':'4097'}})});
    await expect(f.open()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(cancel).toHaveBeenCalled();expect(signal!.aborted).toBe(true);expect(f.createSession).not.toHaveBeenCalled();
  });
  it('rejects a competing lease before any HTTP request',async()=>{
    const first=setup(),connection=await first.open(),second=setup();
    await expect(second.open()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(second.calls).toHaveLength(0);expect(second.createSession).not.toHaveBeenCalled();
    expect(connection.session.status).toBe('saved');
  });
  it('limits starts across managers to three in a rolling ten minutes',async()=>{
    vi.useFakeTimers();vi.setSystemTime(2_000_000);const f=setup(),original=f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async(url,init)=>{if(url.endsWith('document-exchange-session')){f.calls.push({url,init});return new Response(null,{status:503});}return original(url,init)});
    for(const time of [2_000_000,2_240_000,2_540_000]){vi.setSystemTime(time);await expect(f.open()).rejects.toMatchObject({code:'UNAVAILABLE'});}
    const key='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a';expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({version:3,attempts:[2_000_000,2_240_000,2_540_000],target:null});
    await expect(f.open()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(3);expect(f.calls.filter(c=>c.url.endsWith('document-exchange-session'))).toHaveLength(3);expect(f.createSession).not.toHaveBeenCalled();
    vi.setSystemTime(2_600_000);f.fetcher.mockImplementation(original);const connection=await f.open();expect(connection.session.status).toBe('saved');expect(window.localStorage.getItem(key)).toBeNull();expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(4);
  });
  it('persists the unknown-start marker before sending and clears it after a confirmed descriptor',async()=>{
    const f=setup(),original=f.fetcher.getMockImplementation()!,key='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a';let observed='';
    f.fetcher.mockImplementation(async(url,init)=>{if(url.endsWith('document-exchange-session') && JSON.parse(String(init.body)).action==='start')observed=window.localStorage.getItem(key)??'';return original(url,init)});
    const connection=await f.open();expect(JSON.parse(observed)).toEqual({version:3,attempts:[expect.any(Number)],target:null});expect(observed).not.toContain(token);expect(observed).not.toContain(ticket);expect(window.localStorage.getItem(key)).toBeNull();await connection.close();
    const next=await f.open();expect(next.session.status).toBe('saved');expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(1);
  });
  it('ignores a late successful start after abort and retains the unconfirmed marker',async()=>{
    const f=setup(),original=f.fetcher.getMockImplementation()!;let finish!:(response:Response)=>void;
    f.fetcher.mockImplementation((url,init)=>url.endsWith('document-exchange-session')?new Promise<Response>(resolve=>{finish=resolve}):original(url,init));
    const opening=f.open(),outcome=opening.then(()=> 'opened',e=>String(e.code));await vi.waitFor(()=>expect(finish).toBeDefined());f.owner.abort();
    expect(await outcome).toBe('CANCELLED');finish(Response.json({success:true,session:descriptor}));await new Promise(resolve=>setTimeout(resolve,20));
    expect(window.localStorage.getItem('wujie-canvas-document-http-session-v1:actor-a:project-a')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('wujie-canvas-document-http-start-unknown-v1:actor-a:project-a')!)).toEqual({version:3,attempts:[expect.any(Number)],target:null});expect(f.createSession).not.toHaveBeenCalled();
  });
  it('allows one later empty-scope manager to recover after an unknown start within budget',async()=>{
    vi.useFakeTimers();const f=setup(),original=f.fetcher.getMockImplementation()!;let first=true,startSignal:AbortSignal|undefined;
    f.fetcher.mockImplementation((url,init)=>{if(url.endsWith('document-exchange-session') && first){first=false;f.calls.push({url,init});startSignal=init.signal!;return new Promise<Response>(()=>{});}return original(url,init)});
    const opening=f.open(),outcome=opening.then(()=> 'opened',e=>String(e.code));for(let i=0;i<20 && !startSignal;i++)await vi.advanceTimersByTimeAsync(0);
    expect(startSignal).toBeDefined();await vi.advanceTimersByTimeAsync(10_000);expect(await outcome).toBe('UNAVAILABLE');
    const second=f.open();const observed=second.then(value=>({value}),cause=>({cause}));await vi.advanceTimersByTimeAsync(0);const result=await observed;if('cause' in result)throw result.cause;const connection=result.value;
    expect(connection.session.status).toBe('saved');expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(2);
    expect(f.calls.filter(c=>c.url.endsWith('document-exchange-session'))).toHaveLength(2);
    expect(window.localStorage.getItem('wujie-canvas-document-http-start-unknown-v1:actor-a:project-a')).toBeNull();
  });
  it.each(['1','{}','{"version":2,"attempts":[]}','{"version":2,"attempts":[1],"token":"x"}','{"version":2,"attempts":[2,1]}','{"version":2,"attempts":[1,2,3,4]}','{"version":2,"attempts":[1.1]}','{"version":2,"version":2,"attempts":[1]}','{"version":2,"attempts":[9007199254740991]}'])('retains malformed or old marker %s without requests',async marker=>{
    const f=setup(),key='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a';window.localStorage.setItem(key,marker);
    await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});expect(window.localStorage.getItem(key)).toBe(marker);expect(f.fetcher).not.toHaveBeenCalled();expect(f.createSession).not.toHaveBeenCalled();
  });
  it.each(['{"version":3,"attempts":[1],"target":"bad"}','{"version":3,"attempts":[1],"target":null,"extra":true}',JSON.stringify({version:3,attempts:[1,2,3,4],target:null}),'{"version":3,"attempts":[1],"target":null,"target":null}',' '.repeat(257)])('retains malformed v3 marker without requests',async marker=>{
    const f=setup(),key='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a';window.localStorage.setItem(key,marker);
    await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});expect(window.localStorage.getItem(key)).toBe(marker);expect(f.fetcher).not.toHaveBeenCalled();
  });
  it.each(['pending','orphan'] as const)('never starts a new identity with a %s and a valid marker',async kind=>{
    const f=setup(),id=await f.seed(kind),key='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a';
    window.localStorage.removeItem('wujie-canvas-document-http-session-v1:actor-a:project-a');const marker=JSON.stringify({version:2,attempts:[Date.now()-700_000]});window.localStorage.setItem(key,marker);
    await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});expect(f.fetcher).not.toHaveBeenCalled();expect(window.localStorage.getItem(key)).toBe(marker);expect(window.localStorage.getItem('wujie-canvas-document-http-journal-v1:actor-a:project-a:'+id)).not.toBeNull();expect(f.createSession).not.toHaveBeenCalled();
  });
  it('rejects a changed marker during ticket acquisition before start',async()=>{
    const f=setup(),key='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a';let finish!:(response:Response)=>void;
    f.fetcher.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve}));const opening=f.open();const result=opening.then(()=> 'opened',e=>String(e.code));await vi.waitFor(()=>expect(finish).toBeDefined());
    const marker=JSON.stringify({version:2,attempts:[Date.now()]});window.localStorage.setItem(key,marker);finish(Response.json({success:true,ticket}));expect(await result).toBe('RECOVERY_REQUIRED');expect(window.localStorage.getItem(key)).toBe(marker);expect(f.fetcher).toHaveBeenCalledTimes(1);expect(f.createSession).not.toHaveBeenCalled();
  });
  it('rejects pending created during ticket acquisition before start',async()=>{
    const f=setup();let finish!:(response:Response)=>void;f.fetcher.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve}));
    const opening=f.open(),result=opening.then(()=> 'opened',e=>String(e.code));await vi.waitFor(()=>expect(finish).toBeDefined());f.createPendingStore().append(new Uint8Array([2,0,0]));finish(Response.json({success:true,ticket}));
    expect(await result).toBe('RECOVERY_REQUIRED');expect(f.fetcher).toHaveBeenCalledTimes(1);expect(f.createPendingStore().load()).toHaveLength(1);expect(f.createSession).not.toHaveBeenCalled();
  });
  it('rejects a clock rollback without discarding the budget',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1_000_000);const f=setup(),key='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a',marker=JSON.stringify({version:2,attempts:[1_000_001]});window.localStorage.setItem(key,marker);
    await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});expect(window.localStorage.getItem(key)).toBe(marker);expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('does not start if the marker write fails',async()=>{
    const f=setup(),proto=Object.getPrototypeOf(window.localStorage) as Storage,realSet=proto.setItem;
    vi.spyOn(proto,'setItem').mockImplementation(function(this:Storage,key,value){if(key.startsWith('wujie-canvas-document-http-start-unknown-v1:'))throw Error('quota');realSet.call(this,key,value)});
    await expect(f.open()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(1);expect(f.calls.filter(c=>c.url.endsWith('document-exchange-session'))).toHaveLength(0);expect(f.createSession).not.toHaveBeenCalled();
  });
  it('does not start if marker readback differs from the written value',async()=>{
    const f=setup(),proto=Object.getPrototypeOf(window.localStorage) as Storage,realSet=proto.setItem;
    vi.spyOn(proto,'setItem').mockImplementation(function(this:Storage,key,value){realSet.call(this,key,key.startsWith('wujie-canvas-document-http-start-unknown-v1:')?'1':value)});
    await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});expect(f.calls.filter(c=>c.url.endsWith('document-exchange-session'))).toHaveLength(0);expect(window.localStorage.getItem('wujie-canvas-document-http-start-unknown-v1:actor-a:project-a')).toBe('1');expect(f.createSession).not.toHaveBeenCalled();
  });
  it('does not renew a descriptor with an old marker',async()=>{
    const f=setup();await f.seed('descriptor');const key='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a';window.localStorage.setItem(key,'1');
    await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});expect(f.fetcher).not.toHaveBeenCalled();expect(window.localStorage.getItem(key)).toBe('1');expect(f.createSession).not.toHaveBeenCalled();
  });
  it.each(['v2','unknown','wrong-target'] as const)('retains %s marker even when the existing descriptor renews',async kind=>{
    const f=setup();await f.seed('descriptor');const key='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a';
    const value=kind==='v2'?{version:2,attempts:[Date.now()]}:{version:3,attempts:[Date.now()],target:kind==='unknown'?null:hash('other')};const marker=JSON.stringify(value);window.localStorage.setItem(key,marker);
    await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});expect(window.localStorage.getItem(key)).toBe(marker);expect(f.createSession).not.toHaveBeenCalled();expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(0);
  });
  it('keeps the v2 start budget only for an empty descriptorless scope',async()=>{
    const f=setup(),key='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a';window.localStorage.setItem(key,JSON.stringify({version:2,attempts:[Date.now()]}));
    const connection=await f.open();expect(connection.session.status).toBe('saved');expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(1);expect(window.localStorage.getItem(key)).toBeNull();
  });
  it('retains a known target if its descriptor is absent',async()=>{
    const f=setup(),key='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a',marker=JSON.stringify({version:3,attempts:[Date.now()],target:descriptor.sessionFingerprint});window.localStorage.setItem(key,marker);
    await expect(f.open()).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});expect(window.localStorage.getItem(key)).toBe(marker);expect(f.fetcher).not.toHaveBeenCalled();expect(f.createSession).not.toHaveBeenCalled();
  });
  it('renews a saved descriptor and clears a valid marker left by a crash without minting',async()=>{
    const f=setup();await f.seed('descriptor');const key='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a';window.localStorage.setItem(key,JSON.stringify({version:3,attempts:[Date.now()],target:descriptor.sessionFingerprint}));
    const connection=await f.open();expect(connection.session.status).toBe('saved');expect(window.localStorage.getItem(key)).toBeNull();expect(f.calls.filter(c=>c.url.endsWith('document-ticket'))).toHaveLength(0);expect(JSON.parse(String(f.calls.find(c=>c.url.endsWith('document-exchange-session'))!.init.body)).action).toBe('renew');
  });
  it('performs a periodic renewal of the original token while keeping the active session',async()=>{
    vi.useFakeTimers();const f=setup();const connection=await f.open();await vi.advanceTimersByTimeAsync(240_000);
    const renewals=f.calls.filter(c=>c.url.endsWith('document-exchange-session') && JSON.parse(String(c.init.body)).action==='renew');
    expect(renewals).toHaveLength(1);expect(JSON.parse(String(renewals[0].init.body)).sessionToken).toBe(token);expect(connection.session.status).toBe('saved');
  },10000);
});
