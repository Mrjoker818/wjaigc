import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { DocumentExchangeReceipt } from './document-exchange-receipts';
import type { DocumentExchangeSessionDescriptor } from './document-exchange-session-protocol';

export type DocumentExecutionCode='BUSY'|'TIMEOUT'|'CANCELLED'|'UNCERTAIN'|'UNSUPPORTED'|'UNAVAILABLE';
const ERROR_TAG=Symbol.for('wujie.documentExecutionError.v1');
export class DocumentExecutionError extends Error {
  readonly [ERROR_TAG]=true;
  constructor(readonly code:DocumentExecutionCode){super(`DOCUMENT_EXECUTION_${code}`);this.name='DocumentExecutionError';}
}
export interface DocumentExecutionScope {
  readonly signal:AbortSignal;
  admitActor(actorId:string):void;
  assertActive():void;
  remainingMs():number;
  observe<T>(originalPromise:Promise<T>):Promise<T>;
  observeCleanup<T>(originalPromise:Promise<T>):Promise<T>;
  bindCommit(client:PoolClient,binding:DocumentCommitBinding):void;
  /** Caller must first obtain the result through the existing authorized recovery path. */
  confirmCommitRecovery(client:PoolClient,result:DocumentExchangeReceipt|DocumentExchangeSessionDescriptor):void;
  allowFailureResponse(status:number,payload:unknown):void;
}
export type DocumentCommitBinding={kind:'update';expected:DocumentExchangeReceipt}|{kind:'session';expected:DocumentExchangeSessionDescriptor};
export interface DocumentExecutionOptions {signal?:AbortSignal;timeoutMs?:number}
export interface DocumentExecutionStats {activeScopes:number;drainingScopes:number;activeAcquires:number;activeQueries:number;activeObserved:number;ownedClients:number;actorAdmissions:number}
const LEGACY_REGISTRY=Symbol.for('wujie.documentExecutionRegistry.v1'),REGISTRY=Symbol.for('wujie.documentExecutionRegistry.v2'),RESOLVER=Symbol.for('wujie.documentRequestPoolScope.v1');
const MAX_SCOPES=8,MAX_ACTOR=2,MAX_TIMEOUT=20_000;
interface Registry {version:2;als:AsyncLocalStorage<Context>;scopes:Set<Context>;actors:Map<string,number>;owners:WeakMap<object,Context>;resolver:(pool:Pool)=>Pool;legacyMarker:{resolver:(pool:Pool)=>Pool;owner:Registry}}
const globalRegistry=globalThis as typeof globalThis & {[key:symbol]:unknown};
let registry=globalRegistry[REGISTRY] as Registry|undefined;
if(!registry){
  if(globalRegistry[LEGACY_REGISTRY]!==undefined||globalRegistry[RESOLVER]!==undefined)throw new Error('DOCUMENT_EXECUTION_REGISTRY_CONFLICT');
  const als=new AsyncLocalStorage<Context>();
  registry={version:2,als,scopes:new Set(),actors:new Map(),owners:new WeakMap(),resolver:(pool:Pool):Pool=>als.getStore()?.wrapPool(pool)??pool,legacyMarker:undefined as unknown as Registry['legacyMarker']};
  registry.legacyMarker={owner:registry,resolver:()=>{throw new Error('DOCUMENT_EXECUTION_REGISTRY_CONFLICT');}};
  globalRegistry[REGISTRY]=registry;globalRegistry[LEGACY_REGISTRY]=registry.legacyMarker;
}
const shared:Registry=registry;
if(shared.version!==2||globalRegistry[LEGACY_REGISTRY]!==shared.legacyMarker||shared.legacyMarker?.owner!==shared)throw new Error('DOCUMENT_EXECUTION_REGISTRY_CONFLICT');
if(globalRegistry[RESOLVER]!==undefined && globalRegistry[RESOLVER]!==shared.resolver)throw new Error('DOCUMENT_EXECUTION_RESOLVER_CONFLICT');
globalRegistry[RESOLVER]=shared.resolver;
const error=(code:DocumentExecutionCode):DocumentExecutionError=>new DocumentExecutionError(code);
class SafeDatabaseError extends Error {
  constructor(message:'DOCUMENT_DATABASE_BUSY'|'DOCUMENT_DATABASE_SERIALIZATION_CONFLICT'|'Connection terminated'|'timeout',readonly code?:'55P03'|'40001'){super(message);this.name='SafeDatabaseError';}
}
function safeDatabaseError(cause:unknown):Error{
  let code:unknown,message:unknown;try{if(cause&&typeof cause==='object'){code=(cause as {code?:unknown}).code;message=(cause as {message?:unknown}).message;}}catch{return error('UNAVAILABLE');}
  if(code==='55P03')return new SafeDatabaseError('DOCUMENT_DATABASE_BUSY','55P03');
  if(code==='40001')return new SafeDatabaseError('DOCUMENT_DATABASE_SERIALIZATION_CONFLICT','40001');
  if(code==='ETIMEDOUT'||(typeof message==='string'&&(message.includes('ETIMEDOUT')||message.includes('timeout'))))return new SafeDatabaseError('timeout');
  if(code==='ECONNRESET'||(typeof message==='string'&&(message.includes('Connection terminated')||message.includes('ECONNRESET')||message.includes('connection is closed'))))return new SafeDatabaseError('Connection terminated');
  return error('UNAVAILABLE');
}
function safeCallbackError(cause:unknown):Error{return cause instanceof DocumentExecutionError||cause instanceof SafeDatabaseError?cause:error('UNAVAILABLE');}
type QueryCallback=(error:Error|null,value?:unknown)=>void;
type PoolCallback=(error:Error|null,client?:PoolClient,release?:(discard?:boolean|Error)=>void)=>void;
interface Owned {raw:PoolClient;pool:Pool;proxy:PoolClient;outstanding:number;requested:boolean;discard:boolean;released:boolean;releaseReturned:boolean;failed:boolean;endSeen:boolean;errorSeen:boolean;inCommit:boolean;unknown:boolean;binding?:DocumentCommitBinding;onError:()=>void;onEnd:()=>void}
function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function validReceipt(value:unknown):value is DocumentExchangeReceipt{
  return exact(value,['operationId','sessionFingerprint','updateDigest','documentSequence'])&&typeof value.operationId==='string'&&/^[A-Za-z0-9_-]{16,128}$/u.test(value.operationId)&&typeof value.sessionFingerprint==='string'&&/^[a-f0-9]{64}$/u.test(value.sessionFingerprint)&&typeof value.updateDigest==='string'&&/^[a-f0-9]{64}$/u.test(value.updateDigest)&&typeof value.documentSequence==='number'&&Number.isSafeInteger(value.documentSequence)&&value.documentSequence>=0;
}
function validDescriptor(value:unknown):value is DocumentExchangeSessionDescriptor{
  if(!exact(value,['sessionToken','sessionFingerprint','actorId','ownerId','projectId','grantGeneration','expiresAt','retainUntil']))return false;
  const id=(v:unknown):boolean=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v&&!/[\u0000-\u001f\u007f]/u.test(v);
  if(typeof value.sessionToken!=='string'||!/^[A-Za-z0-9_-]{43}$/u.test(value.sessionToken)||typeof value.sessionFingerprint!=='string'||!/^[a-f0-9]{64}$/u.test(value.sessionFingerprint)||createHash('sha256').update(value.sessionToken).digest('hex')!==value.sessionFingerprint||!id(value.actorId)||!id(value.projectId)||!id(value.ownerId)||typeof value.grantGeneration!=='string'||!/^(?:0|[1-9]\d{0,18})$/u.test(value.grantGeneration)||BigInt(value.grantGeneration)>BigInt('9223372036854775807')||typeof value.expiresAt!=='string'||typeof value.retainUntil!=='string')return false;
  const expiry=Date.parse(value.expiresAt),retain=Date.parse(value.retainUntil);return Number.isFinite(expiry)&&Number.isFinite(retain)&&expiry<=retain;
}
function validSql(value:unknown):string {
  if(typeof value==='string')return value;
  if(!value||typeof value!=='object'||Array.isArray(value)||'submit' in value||typeof (value as {text?:unknown}).text!=='string')throw error('UNSUPPORTED');
  return (value as {text:string}).text;
}
function commitSql(value:string):boolean{
  let i=0,start=true;
  while(i<value.length){
    const ch=value[i],next=value[i+1];
    if(/\s/u.test(ch)){i++;continue;}
    if(ch==='-'&&next==='-'){const end=value.indexOf('\n',i+2);i=end<0?value.length:end+1;continue;}
    if(ch==='/'&&next==='*'){let depth=1;i+=2;while(i<value.length&&depth){if(value[i]==='/'&&value[i+1]==='*'){depth++;i+=2;}else if(value[i]==='*'&&value[i+1]==='/'){depth--;i+=2;}else i++;}if(depth)return true;continue;}
    if(ch===';'){start=true;i++;continue;}
    if(ch==='\''||ch==='"'){
      const quote=ch,escaped=quote==='\''&&i>0&&/[eE]/u.test(value[i-1])&&(i<2||!/\w/u.test(value[i-2]));i++;let closed=false;
      while(i<value.length){if(escaped&&value[i]==='\\'){i+=2;continue;}if(value[i]===quote){if(value[i+1]===quote){i+=2;continue;}i++;closed=true;break;}i++;}
      if(!closed)return true;start=false;continue;
    }
    if(ch==='$'){const tag=/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/u.exec(value.slice(i))?.[0];if(tag){const end=value.indexOf(tag,i+tag.length);if(end<0)return true;i=end+tag.length;start=false;continue;}}
    if(start){const word=/^[A-Za-z_]+/u.exec(value.slice(i))?.[0];if(word){if(/^(?:COMMIT|END|CALL|DO)$/iu.test(word))return true;i+=word.length;start=false;continue;}}
    start=false;i++;
  }
  return false;
}
/** Accepts genuine pg callbacks as well as Promise-only pool/client implementations. */
function invoke<T>(call:(done:(cause:unknown,value?:T)=>void)=>unknown):Promise<T>{
  return new Promise<T>((resolve,reject)=>{
    let settled=false;const done=(cause:unknown,value?:T):void=>{if(settled)return;settled=true;if(cause)reject(cause);else resolve(value as T);};
    try{const returned=call(done);if(returned&&typeof (returned as PromiseLike<T>).then==='function')Promise.resolve(returned as PromiseLike<T>).then(value=>done(null,value),cause=>done(cause));}catch(cause){done(cause);}
  });
}
function callbackResult<T>(promise:Promise<T>,callback:((cause:Error|null,value?:T)=>void)|undefined):Promise<T>|void{
  if(!callback)return promise;void promise.then(value=>callback(null,value),cause=>callback(safeCallbackError(cause))).catch(()=>undefined);
}

class Context implements DocumentExecutionScope {
  readonly deadline:number;readonly controller=new AbortController();readonly signal=this.controller.signal;
  readonly drained:Promise<void>;private resolveDrained!:()=>void;
  readonly owned=new Set<Owned>();readonly pools=new WeakMap<Pool,Pool>();
  private timer:ReturnType<typeof setTimeout>|undefined;private abortListener:(()=>void)|undefined;
  private readonly external:AbortSignal|undefined;
  readonly unknowns=new Set<Owned>();readonly clients=new WeakMap<object,Owned>();
  actor:string|undefined;ended=false;workDone=false;acquires=0;queries=0;observed=0;commitInFlight=0;committed=false;uncertain=false;failureAllowed:{status:number;code:string}|undefined;reason:DocumentExecutionCode='UNAVAILABLE';
  constructor(options:DocumentExecutionOptions,timeout:number|undefined,readonly kind:'http'|'ws'){
    this.drained=new Promise<void>(resolve=>{this.resolveDrained=resolve;});
    this.deadline=timeout===undefined?Infinity:performance.now()+timeout;this.external=options.signal;
    if(timeout!==undefined)this.timer=setTimeout(()=>this.stop('TIMEOUT'),timeout);
    if(this.external){this.abortListener=()=>this.stop('CANCELLED');this.external.addEventListener('abort',this.abortListener,{once:true});if(this.external.aborted)this.stop('CANCELLED');}
  }
  failure():DocumentExecutionError{return error(this.uncertain||this.commitInFlight>0||this.committed?'UNCERTAIN':this.reason);}
  assertOwner():void{if(shared.als.getStore()!==this)throw error('UNAVAILABLE');}
  assertActive():void {if(!this.ended&&performance.now()>=this.deadline)this.stop('TIMEOUT');if(this.ended)throw this.failure();}
  remainingMs():number{this.assertActive();return Math.max(0,this.deadline-performance.now());}
  observe<T>(originalPromise:Promise<T>):Promise<T>{
    this.assertActive();return this.track(originalPromise);
  }
  observeCleanup<T>(originalPromise:Promise<T>):Promise<T>{
    if(this.workDone||!shared.scopes.has(this))throw error('UNAVAILABLE');return this.track(originalPromise);
  }
  private track<T>(originalPromise:Promise<T>):Promise<T>{
    if(!originalPromise||typeof originalPromise.then!=='function')throw error('UNAVAILABLE');this.observed++;
    const finish=():void=>{this.observed--;this.drain();};void originalPromise.then(finish,finish);return originalPromise;
  }
  admitActor(actorId:string):void{
    this.assertActive();if(typeof actorId!=='string'||actorId.length<1||actorId.length>256||actorId.trim()!==actorId||/[\u0000-\u001f\u007f]/u.test(actorId))throw error('UNAVAILABLE');
    if(this.kind==='ws')return;
    if(this.actor!==undefined){if(this.actor!==actorId)throw error('UNAVAILABLE');return;}
    const count=shared.actors.get(actorId)??0;if(count>=MAX_ACTOR)throw error('BUSY');shared.actors.set(actorId,count+1);this.actor=actorId;
  }
  bindCommit(client:PoolClient,binding:DocumentCommitBinding):void{
    this.assertActive();if(!client||typeof client!=='object')throw error('UNAVAILABLE');const owner=shared.owners.get(client);if(owner&&owner!==this)throw error('UNAVAILABLE');
    const item=this.clients.get(client);if(!item)return;
    if(item.released||item.requested||item.failed||item.binding||item.inCommit||!exact(binding,['kind','expected']))throw error('UNAVAILABLE');
    if(binding.kind==='update'&&validReceipt(binding.expected))item.binding={kind:'update',expected:{...binding.expected}};
    else if(binding.kind==='session'&&validDescriptor(binding.expected))item.binding={kind:'session',expected:{...binding.expected}};
    else throw error('UNAVAILABLE');
  }
  confirmCommitRecovery(client:PoolClient,result:DocumentExchangeReceipt|DocumentExchangeSessionDescriptor):void{
    this.assertActive();if(!client||typeof client!=='object')throw error('UNAVAILABLE');const owner=shared.owners.get(client);if(owner&&owner!==this)throw error('UNAVAILABLE');
    const item=this.clients.get(client);if(!item)return;
    if(!item.binding||!item.unknown||item.inCommit)throw error('UNCERTAIN');
    const binding=item.binding;
    if(binding.kind==='update'){
      const expected=binding.expected;if(!validReceipt(result)||result.operationId!==expected.operationId||result.sessionFingerprint!==expected.sessionFingerprint||result.updateDigest!==expected.updateDigest||result.documentSequence!==expected.documentSequence)throw error('UNCERTAIN');
    }else{
      const expected=binding.expected;if(!validDescriptor(result)||result.actorId!==expected.actorId||result.projectId!==expected.projectId||result.ownerId!==expected.ownerId||result.grantGeneration!==expected.grantGeneration||result.sessionToken!==expected.sessionToken||result.sessionFingerprint!==expected.sessionFingerprint||result.retainUntil!==expected.retainUntil||Date.parse(result.expiresAt)<Date.parse(expected.expiresAt))throw error('UNCERTAIN');
    }
    item.unknown=false;this.unknowns.delete(item);this.uncertain=this.unknowns.size>0;
  }
  allowFailureResponse(status:number,payload:unknown):void{
    this.assertActive();if(!this.uncertain&&!this.commitInFlight)return;
    if(!exact(payload,['success','code'])||payload.success!==false||!((status===503&&payload.code==='DOCUMENT_EXCHANGE_UNCERTAIN')||(status===403&&payload.code==='DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN')))throw error('UNAVAILABLE');
    this.failureAllowed={status,code:payload.code};
  }
  private clearLifecycle():void{if(this.timer!==undefined)clearTimeout(this.timer);if(this.external&&this.abortListener)this.external.removeEventListener('abort',this.abortListener);}
  stop(reason:DocumentExecutionCode):void{
    if(this.ended)return;this.ended=true;this.reason=reason;if(this.commitInFlight>0){this.uncertain=true;for(const item of this.owned)if(item.inCommit){item.unknown=true;this.unknowns.add(item);}}this.clearLifecycle();this.controller.abort();
    for(const client of this.owned)this.release(client,true,true);this.drain();
  }
  finish():void{
    this.workDone=true;
    if(!this.ended){this.ended=true;this.clearLifecycle();this.controller.abort();for(const client of this.owned)this.release(client,true,true);}
    this.drain();
  }
  drain():void{
    if(!this.workDone||this.acquires||this.queries||this.observed||this.owned.size)return;if(!shared.scopes.delete(this))return;
    if(this.actor!==undefined){const n=(shared.actors.get(this.actor)??1)-1;if(n)shared.actors.set(this.actor,n);else shared.actors.delete(this.actor);}this.resolveDrained();
  }
  wait<T>(promise:Promise<T>,ignoreNormalFinish=false):Promise<T>{
    return new Promise<T>((resolve,reject)=>{
      let settled=false;const done=(cause:unknown,value?:T):void=>{if(settled)return;settled=true;this.signal.removeEventListener('abort',onAbort);if(cause)reject(cause);else resolve(value as T);};
      const onAbort=():void=>{if(ignoreNormalFinish&&this.workDone&&this.reason==='UNAVAILABLE')return;done(this.failure());};this.signal.addEventListener('abort',onAbort,{once:true});if(this.signal.aborted)onAbort();
      void promise.then(value=>done(null,value),cause=>done(cause));
    });
  }
  finishOwned(item:Owned):void{
    if(!item.released||!item.releaseReturned||item.failed)return;
    let ended=item.endSeen,healthy=false;
    try{
      const client=item.raw as unknown as {_ended?:unknown;_ending?:unknown;_queryable?:unknown};
      const pool=item.pool as unknown as {_clients?:unknown;ending?:unknown};
      ended ||=client._ended===true;
      healthy=!item.discard&&!item.errorSeen&&client._ended===false&&client._ending===false&&client._queryable===true&&pool.ending===false&&Array.isArray(pool._clients)&&pool._clients.includes(item.raw);
    }catch{/* Unknown driver state must remain accounted until end. */}
    if(!ended&&!healthy)return;
    try{item.raw.removeListener('error',item.onError);item.raw.removeListener('end',item.onEnd);}catch{item.failed=true;return;}
    this.owned.delete(item);this.drain();
  }
  release(item:Owned,discard:boolean,force=false):void{
    if(item.released||item.failed)return;item.requested=true;item.discard ||=discard;if(item.outstanding&&!force)return;
    item.released=true;
    try{item.raw.release(item.discard);item.releaseReturned=true;}catch{item.failed=true;}
    this.finishOwned(item);this.drain();
  }
  take(pool:Pool,raw:PoolClient):Owned{
    const item:Owned={raw,pool,proxy:undefined as unknown as PoolClient,outstanding:0,requested:false,discard:false,released:false,releaseReturned:false,failed:false,endSeen:false,errorSeen:false,inCommit:false,unknown:false,onError:()=>{},onEnd:()=>{}};
    item.onError=()=>{item.errorSeen=true;};item.onEnd=()=>{item.endSeen=true;this.finishOwned(item);};this.owned.add(item);
    try{raw.on('error',item.onError);raw.on('end',item.onEnd);if((raw as unknown as {_ended?:unknown})._ended===true)item.endSeen=true;}
    catch{item.failed=true;throw error('UNAVAILABLE');}
    item.proxy=this.client(item);this.clients.set(item.proxy,item);shared.owners.set(item.proxy,this);return item;
  }
  connect(pool:Pool):Promise<PoolClient>{
    try{this.assertActive();this.assertOwner();}catch(cause){return Promise.reject(cause);}this.acquires++;
    let captured:Owned|undefined;
    const capture=(raw:PoolClient):Owned=>{if(captured){if(captured.raw!==raw)throw error('UNAVAILABLE');return captured;}captured=this.take(pool,raw);return captured;};
    const acquisition=invoke<Owned>(done=>{
      const returned=pool.connect(((cause:Error|null,raw?:PoolClient)=>{if(cause||!raw){done(cause??error('UNAVAILABLE'));return;}try{done(null,capture(raw));}catch(failure){done(failure);}}) as never) as unknown;
      if(returned&&typeof (returned as PromiseLike<PoolClient>).then==='function')return Promise.resolve(returned as PromiseLike<PoolClient>).then(capture);
      return returned;
    });
    const observed=acquisition.then(item=>{
      try{this.assertActive();}catch(cause){this.release(item,true,true);throw cause;}return item.proxy;
    },cause=>{this.assertActive();throw safeDatabaseError(cause);}).finally(()=>{this.acquires--;this.drain();});
    return this.wait(observed);
  }
  query(item:Owned,args:unknown[]):Promise<unknown>{
    let sql:string;try{this.assertActive();this.assertOwner();if(item.released||item.failed||item.requested)throw error('UNAVAILABLE');sql=validSql(args[0]);if(this.commitInFlight)throw error('UNCERTAIN');}
    catch(cause){return Promise.reject(cause);}
    const commit=commitSql(sql);if(commit){this.commitInFlight++;item.inCommit=true;}this.queries++;item.outstanding++;
    const query=invoke<unknown>(done=>(item.raw.query as unknown as (...parameters:unknown[])=>unknown).apply(item.raw,[...args,done]));
    const observed=query.then(value=>{if(commit){this.commitInFlight--;item.inCommit=false;this.committed=true;}this.assertActive();return value;},cause=>{if(commit){this.commitInFlight--;item.inCommit=false;item.unknown=true;this.unknowns.add(item);this.uncertain=true;throw error('UNCERTAIN');}this.assertActive();throw safeDatabaseError(cause);})
      .finally(()=>{this.queries--;item.outstanding--;if(item.requested&&!item.released&&!item.failed)this.release(item,item.discard);this.drain();});
    return this.wait(observed);
  }
  client(item:Owned):PoolClient{
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const scope=this;const target=item.raw;const listeners=new WeakMap<(...args:unknown[])=>unknown,(...args:unknown[])=>unknown>();
    return new Proxy(Object.create(null) as PoolClient,{get(_ignored,key){
      if(key==='then')return undefined;
      if(typeof key==='symbol')return undefined;
      if(key==='release')return (discard?:boolean|Error):void=>{scope.assertOwner();scope.release(item,Boolean(discard));if(item.failed)throw error('UNAVAILABLE');};
      if(key==='query')return (...input:unknown[]):unknown=>{const args=[...input],last=args[args.length-1];const callback=typeof last==='function'?args.pop() as QueryCallback:undefined;return callbackResult(scope.query(item,args),callback);};
      if(key==='on'||key==='once'||key==='addListener'||key==='removeListener'||key==='off')return (...args:unknown[]):PoolClient=>{
        scope.assertOwner();const original=args[1];
        if(typeof original==='function'){
          const listener=original as (...values:unknown[])=>unknown;let wrapped=listeners.get(listener);
          if(!wrapped&&(key==='on'||key==='once'||key==='addListener')){wrapped=(...values:unknown[]):unknown=>Reflect.apply(listener,item.proxy,values);listeners.set(listener,wrapped);}
          if(wrapped)args[1]=wrapped;
        }
        Reflect.apply(Reflect.get(target,key,target),target,args);return item.proxy;
      };
      if(key==='processID')return Reflect.get(target,key,target);
      throw error('UNSUPPORTED');
    }});
  }
  wrapPool(pool:Pool):Pool{
    const existing=this.pools.get(pool);if(existing)return existing;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const scope=this,target=pool;
    const proxy=new Proxy(Object.create(null) as Pool,{get(_ignored,key){
      if(key==='then'||typeof key==='symbol')return undefined;
      if(key==='connect')return (callback?:PoolCallback):unknown=>{const promise=scope.connect(target);if(!callback)return promise;
        void promise.then(client=>callback(null,client,client.release.bind(client)),cause=>callback(safeCallbackError(cause))).catch(()=>undefined);};
      if(key==='query')return (...input:unknown[]):unknown=>{const args=[...input],last=args[args.length-1],callback=typeof last==='function'?args.pop() as QueryCallback:undefined;
        const task=scope.connect(target).then(async client=>{try{return await scope.query(scope.ownedClient(client),args);}finally{client.release();}});return callbackResult(task,callback);};
      throw error('UNSUPPORTED');
    }});this.pools.set(pool,proxy);return proxy;
  }
  ownedClient(proxy:PoolClient):Owned{const item=[...this.owned].find(value=>value.proxy===proxy);if(!item)throw error('UNAVAILABLE');return item;}
}

export async function runDocumentExecution<T>(options:DocumentExecutionOptions,work:(scope:DocumentExecutionScope)=>Promise<T>|T):Promise<T>{
  if(!options||typeof work!=='function')throw error('UNAVAILABLE');const parent=shared.als.getStore();
  if(parent){parent.assertActive();if(parent.kind!=='http'||(options.signal&&options.signal!==parent.signal))throw error('UNSUPPORTED');return await work(parent);}
  const timeout=options.timeoutMs??MAX_TIMEOUT;if(!Number.isSafeInteger(timeout)||timeout<1||timeout>MAX_TIMEOUT)throw error('UNAVAILABLE');
  let httpScopes=0;for(const existing of shared.scopes)if(existing.kind==='http')httpScopes++;
  if(httpScopes>=MAX_SCOPES)throw error('BUSY');const scope=new Context(options,timeout,'http');shared.scopes.add(scope);
  const task=shared.als.run(scope,()=>Promise.resolve().then(()=>{scope.assertActive();return work(scope);}));
  const observed=task.then(value=>{scope.assertActive();if(scope.uncertain||scope.commitInFlight){
    let status:unknown;try{status=typeof value==='object'&&value!==null?(value as {status?:unknown}).status:undefined;}catch{status=undefined;}
    if(!scope.failureAllowed||status!==scope.failureAllowed.status)throw error('UNCERTAIN');
  }return value;},cause=>{if(scope.uncertain||scope.commitInFlight||scope.committed)throw error('UNCERTAIN');throw cause;}).finally(()=>scope.finish());
  return scope.wait(observed,true);
}
export async function runDocumentWebSocketExecution<T>(work:(scope:DocumentExecutionScope)=>Promise<T>|T):Promise<T>{
  if(typeof work!=='function')throw error('UNAVAILABLE');
  // Waiting for a parent scope from inside that same scope would deadlock.
  if(shared.als.getStore())throw error('UNSUPPORTED');
  const scope=new Context({},undefined,'ws');shared.scopes.add(scope);
  const task=shared.als.run(scope,()=>Promise.resolve().then(()=>{scope.assertActive();return work(scope);}));
  const outcome=await task.then(value=>({ok:true as const,value}),cause=>({ok:false as const,cause}));
  scope.finish();await scope.drained;
  if(scope.uncertain||scope.commitInFlight||(!outcome.ok&&scope.committed))throw error('UNCERTAIN');
  if(!outcome.ok)throw outcome.cause;return outcome.value;
}
export function runIndependentDocumentWebSocketExecution<T>(work:(scope:DocumentExecutionScope)=>Promise<T>|T):Promise<T>{
  return shared.als.exit(()=>runDocumentWebSocketExecution(work));
}
export function getDocumentExecutionStats():DocumentExecutionStats{
  let drainingScopes=0,activeAcquires=0,activeQueries=0,activeObserved=0,ownedClients=0,actorAdmissions=0;
  for(const scope of shared.scopes){if(scope.ended)drainingScopes++;activeAcquires+=scope.acquires;activeQueries+=scope.queries;activeObserved+=scope.observed;ownedClients+=scope.owned.size;if(scope.actor!==undefined)actorAdmissions++;}
  return {activeScopes:shared.scopes.size,drainingScopes,activeAcquires,activeQueries,activeObserved,ownedClients,actorAdmissions};
}
export function getDocumentExecutionScope():DocumentExecutionScope|null{return shared.als.getStore()??null;}
export function reserveDocumentExecutionActor(actorId:string):()=>void{
  const scope=shared.als.getStore();if(!scope)throw error('UNAVAILABLE');scope.admitActor(actorId);
  // Deliberately no early release: actor admission belongs to the draining root.
  return ()=>{};
}
export function documentExecutionHttpFailure(cause:unknown):{status:number;code:string}|null{
  const tagged=typeof cause==='object'&&cause!==null&&(cause as {[ERROR_TAG]?:unknown})[ERROR_TAG]===true,code=tagged?(cause as {code?:unknown}).code:undefined;
  if(!tagged)return null;
  if(code==='BUSY')return {status:429,code:'DOCUMENT_EXCHANGE_BUSY'};if(code==='TIMEOUT')return {status:408,code:'DOCUMENT_EXCHANGE_REQUEST_TIMEOUT'};
  if(code==='CANCELLED')return {status:400,code:'DOCUMENT_EXCHANGE_REQUEST_CANCELLED'};if(code==='UNCERTAIN')return {status:503,code:'DOCUMENT_EXCHANGE_UNCERTAIN'};
  if(code==='UNSUPPORTED')return {status:400,code:'DOCUMENT_EXCHANGE_INVALID'};return {status:503,code:'DOCUMENT_EXCHANGE_UNAVAILABLE'};
}
