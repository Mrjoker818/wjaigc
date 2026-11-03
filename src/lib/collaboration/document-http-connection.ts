'use client';

import { acquireDocumentBrowserLease, type DocumentBrowserLease } from './document-browser-lease';
import { createDocumentHttpBrowserStorage, type DocumentHttpBrowserStorage, type DocumentHttpPendingExport } from './document-http-browser-storage';
import { reconcileDocumentHttpOrphan } from './document-http-receipt-recovery';
import { createDocumentHttpTransport, type DocumentHttpOperationJournal, type DocumentHttpTransport } from './document-http-transport';
import type { CanvasDocumentSession, PendingDocumentUpdateStore } from './document-client';
import type { DocumentExchangeSessionDescriptor } from './document-exchange-session-protocol';

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
export type DocumentHttpConnectionErrorCode = 'RECOVERY_REQUIRED' | 'ACCESS_DENIED' | 'UNAVAILABLE' | 'CANCELLED' | 'TRANSPORT_CHANGED';
export class DocumentHttpConnectionError extends Error {
  constructor(readonly code: DocumentHttpConnectionErrorCode) { super(code); this.name='DocumentHttpConnectionError'; }
}
class RenewSessionUnusable extends Error {}
export interface DocumentHttpConnectionOptions {
  actorId: string;
  projectId: string;
  ownerId: string;
  signal: AbortSignal;
  assertCurrent(): void;
  createPendingStore(): PendingDocumentUpdateStore;
  createSession(socket: WebSocket, guardedPendingStore: PendingDocumentUpdateStore): CanvasDocumentSession;
  onRecovery(copy: DocumentHttpPendingExport): void;
  fetch?: Fetch;
}
export interface DocumentHttpConnection { session: CanvasDocumentSession; close(): Promise<void> }
const RENEW_INTERVAL=4*60*1000;
const REQUEST_TIMEOUT=10_000;
const RESPONSE_LIMIT=4096;
const START_WINDOW=10*60*1000, START_LIMIT=3;
const safe=(value:unknown):value is string=>typeof value==='string' && value.length>0 && value.length<=256 && value.trim()===value && !/[\u0000-\u001f\u007f]/u.test(value);
function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown> {
  return !!value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
}
function error(code:DocumentHttpConnectionErrorCode):DocumentHttpConnectionError { return new DocumentHttpConnectionError(code); }
function cancelBody(response:Response):void { try { if(response.body && !response.body.locked)void response.body.cancel().catch(()=>undefined); } catch { /* Best effort after abort. */ } }

export async function openDocumentHttpConnection(options:DocumentHttpConnectionOptions):Promise<DocumentHttpConnection> {
  if(!options || !safe(options.actorId) || !safe(options.projectId) || !safe(options.ownerId) || !options.signal ||
    typeof options.assertCurrent!=='function' || typeof options.createPendingStore!=='function' ||
    typeof options.createSession!=='function' || typeof options.onRecovery!=='function') throw error('UNAVAILABLE');
  const {actorId,projectId,ownerId,signal}=options;
  let startMarkerKey:string;
  try {startMarkerKey='wujie-canvas-document-http-start-unknown-v1:'+encodeURIComponent(actorId)+':'+encodeURIComponent(projectId);} catch {throw error('UNAVAILABLE');}
  const fetcher:Fetch=options.fetch ?? ((url,init)=>globalThis.fetch(url,init));
  const admission=new AbortController(), lifetime=new AbortController();
  let lease:DocumentBrowserLease|undefined, storage:DocumentHttpBrowserStorage|undefined;
  let session:CanvasDocumentSession|undefined, transport:DocumentHttpTransport|undefined;
  let renewalTimer:ReturnType<typeof setTimeout>|undefined;
  let closed=false, transportFailed=false, releasePromise:Promise<void>|undefined;
  let activeDescriptor:DocumentExchangeSessionDescriptor|undefined, renewingDescriptor:DocumentExchangeSessionDescriptor|undefined;
  const check=():void=>{
    if(closed || signal.aborted)throw error('CANCELLED');
    try { options.assertCurrent(); } catch { throw error('CANCELLED'); }
    if(!lease)throw error('UNAVAILABLE');
    try { lease.assertOwned(); } catch { throw error(signal.aborted?'CANCELLED':'UNAVAILABLE'); }
    if(closed || signal.aborted)throw error('CANCELLED');
  };
  const close=():Promise<void>=>{
    if(!closed){
      closed=true;if(renewalTimer!==undefined)clearTimeout(renewalTimer);lifetime.abort();
      signal.removeEventListener('abort',onAbort);
      lease?.signal.removeEventListener('abort',onLeaseLost);
      try {transport?.close();} catch { /* Continue releasing resources. */ }
      try {session?.disconnect();} catch { /* Continue releasing resources. */ }
      if(!lease)admission.abort();
    }
    if(lease && !releasePromise)releasePromise=lease.release();
    return releasePromise ?? Promise.resolve();
  };
  const onAbort=():void=>{void close();};
  const onLeaseLost=():void=>{void close();};
  signal.addEventListener('abort',onAbort,{once:true});
  if(signal.aborted)onAbort();
  const reportRecovery=():void=>{
    try {check();if(storage)options.onRecovery(storage.exportPending());} catch { /* Keep original local records and original error. */ }
  };
  const recovery=():never=>{reportRecovery();throw error('RECOVERY_REQUIRED');};
  const readStartMarker=():string|null=>{check();const value=window.localStorage.getItem(startMarkerKey);check();return value;};
  const markerValue=(raw:string|null):{version:2|3;attempts:number[];target:string|null}|null=>{
    if(raw===null)return null;
    let value:unknown;
    try {if(raw.length>256)return recovery();value=JSON.parse(raw) as unknown;}catch{return recovery();}
    if(!(exact(value,['version','attempts']) && value.version===2) && !(exact(value,['version','attempts','target']) && value.version===3 && (value.target===null || (typeof value.target==='string' && /^[a-f0-9]{64}$/u.test(value.target)))))return recovery();
    if(!Array.isArray(value.attempts) || value.attempts.length<1 || value.attempts.length>START_LIMIT || JSON.stringify(value)!==raw)return recovery();
    const times:unknown[]=value.attempts;
    if(times.some((time,index)=>typeof time!=='number' || !Number.isSafeInteger(time) || time<0 || (index>0 && time<(times[index-1] as number))))return recovery();
    return {version:value.version as 2|3,attempts:times as number[],target:value.version===3 ? value.target as string|null : null};
  };
  const remaining=(raw:string|null,now=Date.now()):number[]=>{
    const times=markerValue(raw)?.attempts??[];
    if(!Number.isSafeInteger(now) || now<0 || (times.length>0 && times[times.length-1]>now))return recovery();
    return times.filter(time=>now-time<START_WINDOW);
  };
  const markStart=(expected:string|null):string=>{
    check();if(readStartMarker()!==expected)return recovery();
    const now=Date.now(),times=remaining(expected,now);if(times.length>=START_LIMIT)throw error('UNAVAILABLE');
    const value=JSON.stringify({version:3,attempts:[...times,now],target:null});
    window.localStorage.setItem(startMarkerKey,value);check();if(readStartMarker()!==value)return recovery();return value;
  };
  const bindStartTarget=(expected:string,target:string):string=>{
    check();const parsed=markerValue(expected);
    if(!parsed || parsed.version!==3 || parsed.target!==null || !/^[a-f0-9]{64}$/u.test(target) || readStartMarker()!==expected)return recovery();
    const value=JSON.stringify({version:3,attempts:parsed.attempts,target});
    window.localStorage.setItem(startMarkerKey,value);check();if(readStartMarker()!==value)return recovery();return value;
  };
  const clearStartMarker=(expected:string):void=>{check();if(readStartMarker()!==expected)return recovery();window.localStorage.removeItem(startMarkerKey);check();if(readStartMarker()!==null)return recovery();};
  async function inspect():Promise<Awaited<ReturnType<DocumentHttpBrowserStorage['inspect']>>> {
    try {check();const result=await storage!.inspect();check();return result;}
    catch(cause){check();if(cause instanceof DocumentHttpConnectionError)throw cause;return recovery();}
  }
  async function readDescriptor():Promise<DocumentExchangeSessionDescriptor|null> {
    try {check();const result=await storage!.readDescriptor();check();return result;}
    catch(cause){check();if(cause instanceof DocumentHttpConnectionError)throw cause;return recovery();}
  }
  async function saveAndRead(value:DocumentExchangeSessionDescriptor):Promise<DocumentExchangeSessionDescriptor> {
    try {check();await storage!.saveDescriptor(value);check();const stored=await storage!.readDescriptor();check();
      const keys=['sessionToken','sessionFingerprint','actorId','ownerId','projectId','grantGeneration','expiresAt','retainUntil'] as const;
      if(!stored || keys.some(key=>stored[key]!==value[key]))throw error('UNAVAILABLE');return stored;}
    catch(cause){check();if(cause instanceof DocumentHttpConnectionError)throw cause;return recovery();}
  }
  async function jsonRequest(url:string,body:Record<string,unknown>,httpTicket=false,renewRequest=false,beforeSend?:()=>void):Promise<unknown> {
    check();const controller=new AbortController();let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    let stopped=false,timeout=false,rejectStop:(reason:Error)=>void=()=>{};
    const stopping=new Promise<never>((_,reject)=>{rejectStop=reject});void stopping.catch(()=>undefined);
    const stop=():void=>{if(stopped)return;stopped=true;controller.abort();rejectStop(error(timeout?'UNAVAILABLE':'CANCELLED'));if(reader){try{void reader.cancel().catch(()=>undefined)}catch{/* Ignore stream error. */}}else if(response)cancelBody(response);};
    const timer=setTimeout(()=>{timeout=true;stop()},REQUEST_TIMEOUT);
    lifetime.signal.addEventListener('abort',stop,{once:true});if(lifetime.signal.aborted)stop();
    try {
      const request=Promise.resolve().then(()=>{check();beforeSend?.();check();return fetcher(url,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,
        headers:{'content-type':'application/json','x-wujie-expected-actor-id':actorId,...(httpTicket?{'x-wujie-document-transport':'http'}:{})},body:JSON.stringify(body)});})
        .then(value=>{if(stopped || closed || signal.aborted)cancelBody(value);return value});
      response=await Promise.race([request,stopping]);check();
      const ticketConflict=httpTicket && response.status===409;
      const renewFailure=renewRequest && (response.status===403 || response.status===410);
      if(response.status!==200 && !ticketConflict && !renewFailure)throw error(response.status===401 || response.status===403 || response.status===410 || response.status===409?'ACCESS_DENIED':'UNAVAILABLE');
      if(response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')throw error('UNAVAILABLE');
      const declared=response.headers.get('content-length');
      if(declared!==null && (!/^\d+$/u.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared)>RESPONSE_LIMIT))throw error('UNAVAILABLE');
      if(!response.body)throw error('UNAVAILABLE');reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
      while(true){const part=await Promise.race([reader.read(),stopping]);check();if(part.done)break;size+=part.value.byteLength;if(size>RESPONSE_LIMIT)throw error('UNAVAILABLE');chunks.push(part.value);}
      const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
      let value:unknown,raw:string;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);value=JSON.parse(raw) as unknown;}catch{throw error('UNAVAILABLE');}
      if(ticketConflict){
        const fixed=/^\s*\{\s*(?:"success"\s*:\s*false\s*,\s*"code"\s*:\s*"DOCUMENT_TRANSPORT_CHANGED"|"code"\s*:\s*"DOCUMENT_TRANSPORT_CHANGED"\s*,\s*"success"\s*:\s*false)\s*\}\s*$/u;
        if(exact(value,['success','code']) && value.success===false && value.code==='DOCUMENT_TRANSPORT_CHANGED' && fixed.test(raw))throw error('TRANSPORT_CHANGED');throw error('ACCESS_DENIED');
      }
      if(renewFailure){
        const expected=response.status===403?'DOCUMENT_EXCHANGE_FORBIDDEN':'DOCUMENT_EXCHANGE_EXPIRED';
        const fixed=new RegExp(`^\\s*\\{\\s*(?:"success"\\s*:\\s*false\\s*,\\s*"code"\\s*:\\s*"${expected}"|"code"\\s*:\\s*"${expected}"\\s*,\\s*"success"\\s*:\\s*false)\\s*\\}\\s*$`,'u').test(raw);
        if(exact(value,['success','code']) && value.success===false && value.code===expected && fixed)throw new RenewSessionUnusable();
        throw error('ACCESS_DENIED');
      }
      return value;
    } catch(cause){
      if(signal.aborted)throw error('CANCELLED');
      if(cause instanceof DocumentHttpConnectionError || cause instanceof RenewSessionUnusable)throw cause;
      if(closed)throw error('CANCELLED');
      throw error('UNAVAILABLE');
    } finally {
      clearTimeout(timer);lifetime.signal.removeEventListener('abort',stop);controller.abort();
      if(reader){try{void reader.cancel().catch(()=>undefined);reader.releaseLock();}catch{/* Already closed. */}}else if(response)cancelBody(response);
    }
  }
  function sessionValue(payload:unknown):DocumentExchangeSessionDescriptor {
    if(!exact(payload,['success','session']) || payload.success!==true || !exact(payload.session,['sessionToken','sessionFingerprint','actorId','ownerId','projectId','grantGeneration','expiresAt','retainUntil']))throw error('UNAVAILABLE');
    const value=payload.session as unknown as DocumentExchangeSessionDescriptor;
    if(value.actorId!==actorId || value.projectId!==projectId || value.ownerId!==ownerId)throw error('ACCESS_DENIED');
    return value;
  }
  async function renew(previous:DocumentExchangeSessionDescriptor):Promise<DocumentExchangeSessionDescriptor> {
    const response=await jsonRequest('/api/collaboration/document-exchange-session',{action:'renew',projectId,sessionToken:previous.sessionToken},false,true);check();
    const next=sessionValue(response);
    for(const key of ['sessionToken','sessionFingerprint','actorId','projectId','ownerId','grantGeneration','retainUntil'] as const)if(next[key]!==previous[key])throw error('ACCESS_DENIED');
    if(typeof next.expiresAt!=='string' || !Number.isFinite(Date.parse(next.expiresAt)) || Date.parse(next.expiresAt)<Date.parse(previous.expiresAt))throw error('UNAVAILABLE');
    renewingDescriptor=next;
    const stored=await saveAndRead(next);check();return stored;
  }
  function rotationScopeNow(previous:DocumentExchangeSessionDescriptor,expectedMarker:string|null):void {
    try {check();if(readStartMarker()!==expectedMarker || storage!.guardedPendingStore.load().length!==0 || storage!.journalFor(previous).list().length!==0)return recovery();check();}
    catch(cause){check();if(cause instanceof DocumentHttpConnectionError)throw cause;return recovery();}
  }
  async function rotationScope(previous:DocumentExchangeSessionDescriptor,expectedMarker:string|null):Promise<void> {
    const current=await inspect();check();
    if(current.state!=='ready' || current.pendingCount!==0 || current.journalCount!==0)return recovery();
    const stored=await readDescriptor();check();
    const keys=['sessionToken','sessionFingerprint','actorId','ownerId','projectId','grantGeneration','expiresAt','retainUntil'] as const;
    if(!stored || keys.some(key=>stored[key]!==previous[key]) || readStartMarker()!==expectedMarker)return recovery();rotationScopeNow(previous,expectedMarker);
  }
  async function rotate(previous:DocumentExchangeSessionDescriptor,marker:string|null):Promise<DocumentExchangeSessionDescriptor> {
    if(marker!==null)return recovery();
    await rotationScope(previous,null);check();
    const response=await jsonRequest('/api/collaboration/document-ticket',{projectId},true,false,()=>rotationScopeNow(previous,null));check();
    if(!exact(response,['success','ticket']) || response.success!==true || typeof response.ticket!=='string' || !/^[A-Za-z0-9_-]{43}$/u.test(response.ticket))throw error('UNAVAILABLE');
    await rotationScope(previous,null);check();const writtenMarker=markStart(null);
    const payload=await jsonRequest('/api/collaboration/document-exchange-session',{action:'start',projectId,ticket:response.ticket},false,false,()=>rotationScopeNow(previous,writtenMarker));check();
    const candidate=sessionValue(payload);await rotationScope(previous,writtenMarker);check();const targetedMarker=bindStartTarget(writtenMarker,candidate.sessionFingerprint);
    await rotationScope(previous,targetedMarker);check();
    try {await storage!.rotateEmptyDescriptor(previous,candidate,targetedMarker);check();}
    catch(cause){check();if(cause instanceof DocumentHttpConnectionError)throw cause;return recovery();}
    const stored=await readDescriptor();check();const keys=['sessionToken','sessionFingerprint','actorId','ownerId','projectId','grantGeneration','expiresAt','retainUntil'] as const;
    if(!stored || keys.some(key=>stored[key]!==candidate[key]))return recovery();clearStartMarker(targetedMarker);return stored;
  }
  function scheduleRenewal():void {
    check();renewalTimer=setTimeout(()=>{
      renewalTimer=undefined;
      void (async()=>{
        try {check();const next=await renew(activeDescriptor!);check();activeDescriptor=next;renewingDescriptor=undefined;scheduleRenewal();}
        catch {reportRecovery();void close();}
      })();
    },RENEW_INTERVAL);
  }
  try {
    if(closed || signal.aborted)throw error('CANCELLED');
    try {options.assertCurrent();}catch{throw error('CANCELLED');}
    lease=await acquireDocumentBrowserLease({actorId,projectId,signal:admission.signal});check();
    lease.signal.addEventListener('abort',onLeaseLost,{once:true});check();
    const raw=options.createPendingStore();check();
    storage=createDocumentHttpBrowserStorage({actorId,projectId,pendingStore:raw,assertLease:check});check();
    let state=await inspect();check();let descriptor=await readDescriptor();check();const marker=readStartMarker();remaining(marker);
    if(!descriptor){
      if(state.state!=='empty')return recovery();
      const pendingMarker=markerValue(marker);if(pendingMarker?.version===3 && pendingMarker.target!==null)return recovery();
      if(remaining(marker).length>=START_LIMIT)throw error('UNAVAILABLE');
      const response=await jsonRequest('/api/collaboration/document-ticket',{projectId},true);check();
      if(!exact(response,['success','ticket']) || response.success!==true || typeof response.ticket!=='string' || !/^[A-Za-z0-9_-]{43}$/u.test(response.ticket))throw error('UNAVAILABLE');
      state=await inspect();check();if(state.state!=='empty')return recovery();
      const writtenMarker=markStart(marker);
      const start=await jsonRequest('/api/collaboration/document-exchange-session',{action:'start',projectId,ticket:response.ticket});check();
      const candidate=sessionValue(start),targetedMarker=bindStartTarget(writtenMarker,candidate.sessionFingerprint);descriptor=await saveAndRead(candidate);check();clearStartMarker(targetedMarker);
    } else {
      if(descriptor.ownerId!==ownerId)throw error('ACCESS_DENIED');
      try {descriptor=await renew(descriptor);check();renewingDescriptor=undefined;
        if(marker!==null){const parsed=markerValue(marker);if(!parsed || parsed.version!==3 || parsed.target!==descriptor.sessionFingerprint)return recovery();clearStartMarker(marker);}}
      catch(cause){check();if(!(cause instanceof RenewSessionUnusable))throw cause;descriptor=await rotate(descriptor,marker);check();}
    }
    activeDescriptor=descriptor;
    let journal=storage.journalFor(descriptor);const pendingIds=new Set(storage.guardedPendingStore.load().map(item=>item.id));
    for(const item of journal.list()){
      if(pendingIds.has(item.pendingId))continue;
      let result:Awaited<ReturnType<typeof reconcileDocumentHttpOrphan>>;
      try { result=await reconcileDocumentHttpOrphan({sessionDescriptor:descriptor,pendingId:item.pendingId,expectedRecord:item.record,journal,assertLease:check,signal:lifetime.signal,fetch:fetcher});check(); }
      catch { check();return recovery(); }
      if(result.state!=='confirmed')return recovery();
    }
    state=await inspect();check();
    if(state.state==='recovery' && state.reasons.some(reason=>reason!=='pending-unconfirmed'))return recovery();
    const delegate:DocumentHttpOperationJournal={
      get(id){check();try {journal=storage!.journalFor(activeDescriptor!);}catch(cause){if(!renewingDescriptor)throw cause;journal=storage!.journalFor(renewingDescriptor);}return journal.get(id);},
      put(id,record){check();try {journal=storage!.journalFor(activeDescriptor!);}catch(cause){if(!renewingDescriptor)throw cause;journal=storage!.journalFor(renewingDescriptor);}journal.put(id,record);},
      remove(id){check();try {journal=storage!.journalFor(activeDescriptor!);}catch(cause){if(!renewingDescriptor)throw cause;journal=storage!.journalFor(renewingDescriptor);}journal.remove(id);},
    };
    transport=createDocumentHttpTransport({sessionDescriptor:descriptor,pendingStore:storage.guardedPendingStore,operationJournal:delegate,fetch:fetcher});check();
    session=options.createSession(transport.socket,storage.guardedPendingStore);check();
    const socket=transport.socket, previousClose=socket.onclose;
    socket.onclose=event=>{if(closed)return;transportFailed=true;try{previousClose?.call(socket,event);}finally{reportRecovery();void close();}};
    await transport.start();check();scheduleRenewal();check();
    return {session,close};
  } catch(cause){
    let failure:DocumentHttpConnectionError;
    if(signal.aborted)failure=error('CANCELLED');
    else if(transportFailed) { try { options.assertCurrent();failure=error('UNAVAILABLE'); } catch { failure=error('CANCELLED'); } }
    else if(cause instanceof DocumentHttpConnectionError)failure=cause;
    else if(closed)failure=error('CANCELLED');
    else failure=error('UNAVAILABLE');
    if(failure.code!=='CANCELLED' && failure.code!=='RECOVERY_REQUIRED' && failure.code!=='TRANSPORT_CHANGED')reportRecovery();
    await close();throw failure;
  }
}
