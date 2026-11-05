import { AsyncLocalStorage } from 'node:async_hooks';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import dns from 'node:dns';
import dgram from 'node:dgram';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import type {NextRequest,NextResponse} from 'next/server';

export function isSyntheticSaveRequest(input:RequestInfo|URL,init?:RequestInit):boolean {
  const request=input instanceof Request?input:undefined;
  const url=request?request.url:String(input);
  const method=String(init?.method ?? request?.method ?? 'GET').toUpperCase();
  const headers=new Headers(init?.headers ?? request?.headers);
  return url==='http://localhost:5000/api/save-image' && method==='POST'
    && !['authorization','cookie','x-api-key','api-key'].some(name=>headers.has(name));
}

// Track the actual start worker's finally promise, including persistence drain.
// If the route no longer exposes this identifiable finally callback, accepted
// starts fail closed instead of guessing from a terminal status or a delay.
export function trackWorkflowWorkers() {
  type RequestContext={tracked:boolean; claimed:boolean; action:unknown; claimId?:string; claimOwner?:string; invalidAfterClaim?:boolean; releasedAfterInvalid?:boolean};
  const context = new AsyncLocalStorage<RequestContext>();
  const pending = new Set<Promise<unknown>>(), requests = new Set<Promise<unknown>>();
  const errors: unknown[] = [];
  let registered = 0, unsafe = false;
  function observe<T>(actual:Promise<T>):Promise<T> {
    const current=context.getStore();if(current)current.tracked=true;
    registered++;pending.add(actual);
    void actual.then(()=>{pending.delete(actual);},error=>{pending.delete(actual);errors.push(error);});
    return actual;
  }
  function claim<T>(lease:T):T {
    const current=context.getStore();
    if(current?.action==='status' && lease){
      current.claimed=true;current.invalidAfterClaim=false;current.releasedAfterInvalid=false;
      const detail=lease as {taskId?:unknown;owner?:unknown};
      current.claimId=typeof detail.taskId==='string'?detail.taskId:undefined;
      current.claimOwner=typeof detail.owner==='string'?detail.owner:undefined;
    }
    return lease;
  }
  function read<T>(id:string,value:T):T {
    const current=context.getStore();
    if(current?.claimed && current.claimId===id && current.claimOwner){
      const record=value && typeof value==='object' ? value as {leaseOwner?:unknown} : undefined;
      current.invalidAfterClaim=value===null || typeof record?.leaseOwner==='string' && record.leaseOwner!==current.claimOwner;
      current.releasedAfterInvalid=false;
    }
    return value;
  }
  function release<T>(id:string,owner:string,value:T):T {
    const current=context.getStore();
    if(current?.invalidAfterClaim && current.claimId===id && current.claimOwner===owner)current.releasedAfterInvalid=true;
    return value;
  }
  async function drain(timeoutMs=5000):Promise<void> {
    if(unsafe)throw Error('WORKFLOW_TEST_UNTRACKED_WORKER');
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      await Promise.race([
        (async()=>{while(pending.size||requests.size)await Promise.all([...pending,...requests].map(p=>p.then(()=>undefined,()=>undefined)));})(),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('WORKFLOW_TEST_WORKER_DRAIN_TIMEOUT')),timeoutMs);}),
      ]);
      if(errors.length)throw new AggregateError(errors,'WORKFLOW_TEST_WORKER_FAILED');
    }catch(error){unsafe=true;throw error;}finally{if(timer)clearTimeout(timer);}
  }
  function wrap(post:(request:NextRequest)=>Promise<NextResponse>) {
    return (request:NextRequest):Promise<NextResponse>=>{
      const running=(async()=>{
        const action=(await request.clone().json() as {action?:unknown}).action;
        const current:RequestContext={tracked:false,claimed:false,action};
        let response:NextResponse;
        try{response=await context.run(current,()=>post(request));}
        catch(error){if(!current.tracked&&(action==='start'||action==='status'&&current.claimed))unsafe=true;throw error;}
        if(action==='start'&&response.ok){const body=await response.clone().json() as {executionId?:unknown};if(typeof body.executionId==='string'&&!current.tracked){unsafe=true;throw Error('WORKFLOW_TEST_UNTRACKED_WORKER');}}
        if(action==='status'&&current.claimed&&!current.tracked){
          // The frozen image-retry path aborts before dispatch if the task is
          // absent or has another lease owner on the post-claim reread, then awaits release of that lease.
          // A 409 alone or an unrelated/missing release is not sufficient.
          let fenced=false;
          if(response.status===409&&current.invalidAfterClaim&&current.releasedAfterInvalid){
            const body=await response.clone().json().catch(()=>null) as {error?:unknown}|null;
            fenced=body?.error==='WORKFLOW_EXECUTION_FENCE_LOST';
          }
          if(!fenced){unsafe=true;throw Error('WORKFLOW_TEST_UNTRACKED_RECOVERY');}
        }
        return response;
      })();
      requests.add(running);void running.then(()=>requests.delete(running),()=>requests.delete(running));return running;
    };
  }
  return {observe,claim,read,release,drain,wrap,get pending(){return pending.size;},get requests(){return requests.size;},get registered(){return registered;},get unsafe(){return unsafe;},
    restore(){if(unsafe||pending.size||requests.size)throw Error('WORKFLOW_TEST_WORKER_NOT_DRAINED');}};
}
/** Runs before importing the application route; any attempted IO fails the test. */
export function installWorkflowOfflineGuard(): { violations: string[]; verify(): void; restore(): void } {
  const violations: string[] = [];
  const undo: Array<() => void> = [];
  const installed: Array<() => boolean> = [];
  const previousFetch = globalThis.fetch;
  const restore = (): void => {
    globalThis.fetch = previousFetch;
    for (const revert of undo.reverse()) revert();
    syncBuiltinESMExports();
  };
  const deny = (kind: string) => () => { violations.push(kind); throw new Error(`WORKFLOW_TEST_${kind}_FORBIDDEN`); };
  function replace(object: object, key: string, value: unknown): void {
    const holder = object as Record<string, unknown>;
    const previous = holder[key]; holder[key] = value; installed.push(() => holder[key] === value); undo.push(() => { holder[key] = previous; });
  }
  try {
  // Builtin namespace exports are immutable, but their default CJS objects are
  // shared with Node consumers. syncBuiltinESMExports covers named ESM imports.
  const n = net, t = tls, h = http, s = https, h2 = http2, d = dns, g = dgram;
  replace(n, 'connect', deny('NETWORK')); replace(n, 'createConnection', deny('NETWORK'));
  replace(n.Socket.prototype, 'connect', deny('NETWORK')); replace(t, 'connect', deny('NETWORK'));
  replace(h, 'request', deny('NETWORK')); replace(h, 'get', deny('NETWORK'));
  replace(s, 'request', deny('NETWORK')); replace(s, 'get', deny('NETWORK'));
  replace(h2, 'connect', deny('NETWORK'));
  for (const key of Object.keys(d).filter(key => key === 'lookup' || key.startsWith('resolve'))) replace(d, key, deny('NETWORK'));
  for (const key of Object.keys(d.promises).filter(key => key === 'lookup' || key.startsWith('resolve'))) replace(d.promises, key, deny('NETWORK'));
  replace(g, 'createSocket', deny('NETWORK'));
  for (const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) replace(childProcess,key,deny('PROCESS'));
  // Tests do not need filesystem writes. Prevent hidden write/cleanup paths in
  // this worker and reject direct reads of the application's data roots.
  const roots = [path.resolve(process.cwd(),'data'), process.env.WUJIE_DATA_DIR,
    process.env.SERVER_DATA_ROOT, process.env.COZE_WORKSPACE_PATH && path.join(process.env.COZE_WORKSPACE_PATH,'data')]
    .filter((value): value is string => Boolean(value)).map(value => path.resolve(value).toLowerCase());
  const fsDenied = deny('FILESYSTEM');
  const readSafe = (value: unknown): void => {
    if (typeof value !== 'string' && !(value instanceof URL) && !Buffer.isBuffer(value)) return;
    const name = value instanceof URL ? fileURLToPath(value) : String(value);
    const resolved = path.resolve(name).toLowerCase();
    if (roots.some(root => resolved === root || resolved.startsWith(root + path.sep))) fsDenied();
  };
  const writeFlag = (flag: unknown): boolean => typeof flag === 'string' ? /[wax+]/.test(flag)
    : typeof flag === 'number' && Boolean(flag & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND));
  for (const [api, isPromise] of [[fs, false], [fs.promises, true]] as const) {
    const holder = api as unknown as Record<string, (...args: unknown[]) => unknown>;
    const readNames = isPromise ? ['access','stat','lstat','readdir','readFile','realpath']
      : ['access','accessSync','stat','statSync','lstat','lstatSync','readdir','readdirSync','readFile','readFileSync','realpath','realpathSync','existsSync'];
    for (const key of readNames) {
      const original = holder[key]; if (typeof original !== 'function') continue;
      const wrapped = function(this: unknown, ...args: unknown[]): unknown { readSafe(args[0]); return Reflect.apply(original,this,args); };
      replace(api,key,wrapped);
    }
    for (const key of isPromise ? ['mkdir','mkdtemp','writeFile','appendFile','unlink','rm','rmdir','truncate','rename','copyFile','cp','symlink','link','chmod','chown','utimes']
      : ['mkdir','mkdirSync','mkdtemp','mkdtempSync','writeFile','writeFileSync','appendFile','appendFileSync','unlink','unlinkSync','rm','rmSync','rmdir','rmdirSync','truncate','truncateSync','rename','renameSync','copyFile','copyFileSync','cp','cpSync','symlink','symlinkSync','link','linkSync','chmod','chmodSync','chown','chownSync','utimes','utimesSync','createWriteStream']) {
      if (typeof holder[key] === 'function') replace(api,key,fsDenied);
    }
    for (const key of isPromise ? ['open'] : ['open','openSync']) {
      const original=holder[key]; if(typeof original!=='function') continue;
      replace(api,key,function(this: unknown,...args: unknown[]): unknown {readSafe(args[0]);if(writeFlag(args[1]))return fsDenied();return Reflect.apply(original,this,args);});
    }
  }
  const blockedFetch = deny('FETCH') as typeof fetch;
  globalThis.fetch = blockedFetch;
  syncBuiltinESMExports();
  return {
    violations,
    verify() {
      if (!installed.every(check => check()) || globalThis.fetch !== blockedFetch) throw Error('WORKFLOW_TEST_NETWORK_GUARD_MISSING');
    },
    restore,
  };
  } catch (error) {
    restore();
    throw error;
  }
}
