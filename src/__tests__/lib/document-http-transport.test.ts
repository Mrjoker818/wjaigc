import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { applyCanvasImagePatch, createCanvasDocument } from '@/lib/collaboration/canvas-document';
import { createCanvasDocumentSession, type PendingDocumentUpdateStore } from '@/lib/collaboration/document-client';
import { createDocumentHttpTransport } from '@/lib/collaboration/document-http-transport';

const descriptor = { sessionToken: 't'.repeat(43), sessionFingerprint: createHash('sha256').update('t'.repeat(43)).digest('hex'), actorId: 'actor-a', ownerId: 'owner-a', projectId: 'project-a', grantGeneration: '1', expiresAt: '2099-01-01T00:00:00Z', retainUntil: '2099-02-01T00:00:00Z' };
const headers = { 'content-type': 'application/octet-stream', 'x-wujie-document-session-fingerprint': descriptor.sessionFingerprint };
const frame = (seq: number, update: Uint8Array): Uint8Array<ArrayBuffer> => { const b = new Uint8Array(update.length + 9); b[0] = 0x11; new DataView(b.buffer).setBigUint64(1, BigInt(seq)); b.set(update, 9); return b; };
const digest = (b: Uint8Array): string => createHash('sha256').update('wujie-document-update-v1\0').update(b).digest('hex');
const memoryStore = (): PendingDocumentUpdateStore => { const map = new Map<string, Uint8Array>(); let i = 0; return { load: () => [...map].map(([id, value]) => ({ id, frame: value })), append: b => { const id = String(++i); map.set(id, b.slice()); return id; }, remove: id => { map.delete(id); } }; };
type JournalEntry = { operationId: string; sessionFingerprint: string; updateDigest: string; actorId: string; projectId: string; ownerId: string; grantGeneration: string };
type TestJournal = { get(id: string): JournalEntry | undefined; put(id: string, record: JournalEntry): void; remove(id: string): void; reopen(): TestJournal };
const memoryJournal = (storage = new Map<string, string>()): TestJournal => ({ get: (id: string): JournalEntry | undefined => { const json=storage.get(id); return json === undefined ? undefined : JSON.parse(json) as JournalEntry; }, put: (id: string, record: JournalEntry): void => { storage.set(id, JSON.stringify(record)); }, remove: (id: string): void => { storage.delete(id); }, reopen: () => memoryJournal(storage) });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const wait = async (condition: () => boolean): Promise<void> => { await vi.waitFor(() => { expect(condition()).toBe(true); }, { timeout: 1500, interval: 5 }); };
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup() {
  vi.stubGlobal('WebSocket', { OPEN: 1 });
  const server = createCanvasDocument(); applyCanvasImagePatch(server, { placementId: 'p1', assetVersionId: 'version-p1', x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0 }, 'seed');
  const requests: Array<{ body: Uint8Array; headers: Headers; signal: AbortSignal; result: ReturnType<typeof deferred<Response>> }> = [];
  const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = new Uint8Array(init?.body as ArrayBuffer); const result = deferred<Response>(); requests.push({ body, headers: new Headers(init?.headers), signal: init!.signal!, result }); return result.promise;
  });
  const store = memoryStore(); const journal = memoryJournal();
  const transport = createDocumentHttpTransport({ sessionDescriptor: descriptor, pendingStore: store, operationJournal: journal, fetch: fetcher });
  const session = createCanvasDocumentSession(transport.socket, undefined, store);
  cleanups.push(() => { session.disconnect(); transport.close(); server.destroy(); });
  const answerPull = (index: number, seq: number): void => { const request = requests[index]; const update = Y.encodeStateAsUpdate(server, request.body.subarray(1)); request.result.resolve(new Response(frame(seq, update), { headers })); };
  const answerWrite = (index: number, seq: number, overrides: Record<string, unknown> = {}): void => { const request = requests[index]; const receipt = { operationId: request.headers.get('x-wujie-document-operation-id'), sessionFingerprint: descriptor.sessionFingerprint, updateDigest: digest(request.body.subarray(1)), documentSequence: seq, ...overrides }; request.result.resolve(Response.json({ success: true, receipt })); };
  return { server, requests, store, journal, transport, session, answerPull, answerWrite };
}
async function initialize(f: ReturnType<typeof setup>): Promise<void> { const start = f.transport.start(); await wait(() => f.requests.length === 1); f.answerPull(0, 1); await start; expect(f.session.status).toBe('saved'); }

describe('HTTP transport with real canvas document session', () => {
  it('starts with an empty vector and binds one exact receipt before sending the next update', async () => {
    const f = setup(); await initialize(f); expect(Y.decodeStateVector(f.requests[0].body.subarray(1)).size).toBe(0);
    expect(f.requests[0].headers.get('x-wujie-document-session')).toBe(descriptor.sessionToken);
    f.session.applyLocalChange({ placementId: 'p1', x: 11 }); f.session.applyLocalChange({ placementId: 'p1', x: 12 });
    await wait(() => f.requests.length === 2); expect(f.requests[1].body[0]).toBe(2); expect(f.store.load()).toHaveLength(2);
    await new Promise(r => setTimeout(r, 20)); expect(f.requests).toHaveLength(2);
    f.answerWrite(1, 2); await wait(() => f.requests.length === 3); expect(f.store.load()).toHaveLength(1);
    f.answerWrite(2, 3); await wait(() => f.store.load().length === 0); expect(await f.session.waitForPendingUpdates()).toBe(3);
    expect(f.requests[1].headers.get('x-wujie-document-operation-id')).not.toBe(f.requests[2].headers.get('x-wujie-document-operation-id'));
  });
  it.each([{operationId:'wrong'}, {sessionFingerprint:'0'.repeat(64)}, {updateDigest:'0'.repeat(64)}, {documentSequence:-1}, {documentSequence:0}])('retains the queue on a mismatched receipt %o', async bad => {
    const f=setup(); await initialize(f); f.session.applyLocalChange({placementId:'p1',x:11}); f.session.applyLocalChange({placementId:'p1',x:12}); await wait(()=>f.requests.length===2); f.answerWrite(1,2,bad); await wait(()=>f.session.status==='unavailable'); expect(f.store.load()).toHaveLength(2); expect(f.requests).toHaveLength(2);
  });
  it('uses only server pull state for later vectors, and never clears pending on a pull', async () => {
    const f=setup(); await initialize(f); f.session.applyLocalChange({placementId:'p1',x:11}); await wait(()=>f.requests.length===2); const poll=f.transport.pull(); const observed=poll.then(()=>'resolved',error=>String(error.message)); expect(f.requests).toHaveLength(2);
    f.answerWrite(1,2,{updateDigest:'0'.repeat(64)}); await wait(()=>f.session.status==='unavailable'); expect(await observed).toBe('DOCUMENT_HTTP_CLOSED'); expect(f.store.load()).toHaveLength(1);
  });
  it('sends the server mirror vector on periodic/manual pull without local pending updates in it', async () => {
    const f=setup(); await initialize(f); applyCanvasImagePatch(f.server,{placementId:'p1',x:50},'remote'); const poll=f.transport.pull(); await wait(()=>f.requests.length===2); const vector=Y.decodeStateVector(f.requests[1].body.subarray(1)); expect(vector.size).toBeGreaterThan(0); f.answerPull(1,2); await poll; expect(f.session.images.p1.x).toBe(50); expect(f.session.appliedServerSequence).toBe(2);
  });
  it('aborts on close and ignores a late matching response', async () => {
    const f=setup(); await initialize(f); f.session.applyLocalChange({placementId:'p1',x:11}); await wait(()=>f.requests.length===2); f.transport.close(); expect(f.requests[1].signal.aborted).toBe(true); f.answerWrite(1,2); await new Promise(r=>setTimeout(r,30)); expect(f.store.load()).toHaveLength(1);
  });
  it.each([503,409])('retains pending on unsuccessful HTTP %i', async status => {
    const f=setup(); await initialize(f); f.session.applyLocalChange({placementId:'p1',x:11}); await wait(()=>f.requests.length===2); f.requests[1].result.resolve(Response.json({success:false,code:'DOCUMENT_EXCHANGE_DEPENDENCY_PENDING'},{status})); await wait(()=>f.session.status==='unavailable'); expect(f.store.load()).toHaveLength(1);
  });
  it('never includes an acknowledged local write in the mirror before receiving it as a server frame', async () => {
    const f=setup(); await initialize(f); const canonicalVector=Y.encodeStateVector(f.server);
    f.session.applyLocalChange({placementId:'p1',x:25}); await wait(()=>f.requests.length===2);
    const poll=f.transport.pull(); f.answerWrite(1,2); await wait(()=>f.requests.length===3);
    expect([...f.requests[2].body.subarray(1)]).toEqual([...canonicalVector]);
    Y.applyUpdate(f.server,f.requests[1].body.subarray(1)); f.answerPull(2,2); await poll; expect(f.session.images.p1.x).toBe(25);
  });
  it('accepts a fingerprinted 204 only after initial state and leaves the session unchanged', async () => {
    const f=setup(); await initialize(f); const poll=f.transport.pull(); await wait(()=>f.requests.length===2);
    expect(f.requests[1].headers.get('x-wujie-document-after-sequence')).toBe('1');
    f.requests[1].result.resolve(new Response(null,{status:204,headers})); await poll;
    expect(f.session.appliedServerSequence).toBe(1); expect(f.session.status).toBe('saved');
  });
  it('does not replay prior durable frames lacking operation identities', async () => {
    vi.stubGlobal('WebSocket',{OPEN:1}); const store=memoryStore(); store.append(new Uint8Array([2,0,0]));
    const server=createCanvasDocument(); const fetcher=vi.fn(async()=>new Response(frame(1,Y.encodeStateAsUpdate(server)),{headers}));
    const transport=createDocumentHttpTransport({sessionDescriptor:descriptor,pendingStore:store,operationJournal:memoryJournal(),fetch:fetcher});
    const session=createCanvasDocumentSession(transport.socket,undefined,store); cleanups.push(()=>{session.disconnect();transport.close();server.destroy()});
    await transport.start(); expect(session.status).toBe('recovery'); session.retryRecovered();
    expect(store.load()).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(1); expect(session.status).toBe('unavailable');
  });
  it('starts a replacement adapter with an empty vector even when the real session already has state', async () => {
    const f=setup(); await initialize(f); f.transport.close(); expect(f.session.status).toBe('unavailable');
    applyCanvasImagePatch(f.server,{placementId:'p1',x:71},'remote'); let received: Uint8Array | undefined;
    const fetcher=vi.fn(async (_input: string, init: RequestInit) => { received=new Uint8Array(init.body as ArrayBuffer); return new Response(frame(2,Y.encodeStateAsUpdate(f.server)),{headers}); });
    const next=createDocumentHttpTransport({sessionDescriptor:descriptor,pendingStore:f.store,operationJournal:f.journal.reopen(),fetch:fetcher}); cleanups.push(()=>next.close());
    f.session.replaceSocket(next.socket); await next.start(); expect(Y.decodeStateVector(received!.subarray(1)).size).toBe(0);
    expect(f.session.images.p1.x).toBe(71); expect(f.session.appliedServerSequence).toBe(2);
  });
  it('times out an unresponsive read, aborts it and preserves the session fail-closed', async () => {
    const f=setup(); await initialize(f); vi.useFakeTimers(); const poll=f.transport.pull(); const result=poll.then(()=>'resolved',error=>String(error.message));
    await vi.advanceTimersByTimeAsync(0); expect(f.requests).toHaveLength(2); await vi.advanceTimersByTimeAsync(10_000); expect(await result).toBe('DOCUMENT_HTTP_TIMEOUT');
    expect(f.requests[1].signal.aborted).toBe(true); expect(f.session.status).toBe('unavailable');
  });
  it('rejects an oversized write receipt without clearing the durable update', async () => {
    const f=setup(); await initialize(f); f.session.applyLocalChange({placementId:'p1',x:35}); await wait(()=>f.requests.length===2);
    f.requests[1].result.resolve(new Response('x',{status:200,headers:{'content-type':'application/json','content-length':'4097'}}));
    await wait(()=>f.session.status==='unavailable'); expect(f.store.load()).toHaveLength(1);
  });
  it('polls periodically and stops scheduling after close', async () => {
    const f=setup(); await initialize(f); await vi.waitFor(()=>expect(f.requests).toHaveLength(2),{timeout:2500,interval:20});
    f.requests[1].result.resolve(new Response(null,{status:204,headers})); await new Promise(r=>setTimeout(r,40));
    f.transport.close(); await new Promise(r=>setTimeout(r,1600)); expect(f.requests).toHaveLength(2);
  }, 5000);
  it('fails closed when the declared initial response exceeds its limit', async () => {
    const f=setup(); const start=f.transport.start(); const result=start.then(()=>'resolved',error=>String(error.message));
    await wait(()=>f.requests.length===1); f.requests[0].result.resolve(new Response('x',{headers:{...headers,'content-length':String(5*1024*1024+1)}}));
    expect(await result).toBe('DOCUMENT_HTTP_RESPONSE_TOO_LARGE'); expect(f.session.status).toBe('unavailable');
  });
  it('caps the queued writes and retains unacknowledged frames', async () => {
    const f=setup(); await initialize(f); f.session.applyLocalChange({placementId:'p1',x:11}); await wait(()=>f.requests.length===2);
    for(let i=0;i<260 && f.session.status!=='unavailable';i++) f.session.applyLocalChange({placementId:'p1',x:12+i});
    expect(f.session.status).toBe('unavailable'); expect(f.requests).toHaveLength(2); expect(f.store.load().length).toBeGreaterThan(1);
  }, 10000);
  it('journals before the first write and explicitly retries the same identity after a real session refresh', async () => {
    const f=setup(); await initialize(f); f.session.applyLocalChange({placementId:'p1',x:40}); await wait(()=>f.requests.length===2);
    const pending=f.store.load()[0]; const original=f.requests[1]; const operationId=original.headers.get('x-wujie-document-operation-id');
    const saved=f.journal.get(pending.id); expect(saved).toMatchObject({operationId,sessionFingerprint:descriptor.sessionFingerprint,updateDigest:digest(original.body.subarray(1)),actorId:descriptor.actorId,projectId:descriptor.projectId,grantGeneration:descriptor.grantGeneration});
    Y.applyUpdate(f.server,original.body.subarray(1)); applyCanvasImagePatch(f.server,{placementId:'p1',x:55},'remote');
    f.session.disconnect(); f.transport.close();
    const calls: Array<{body:Uint8Array;headers:Headers;result:ReturnType<typeof deferred<Response>>}> = [];
    const fetcher=vi.fn((_url: string, init: RequestInit) => {const result=deferred<Response>(); calls.push({body:new Uint8Array(init.body as ArrayBuffer),headers:new Headers(init.headers),result}); return result.promise;});
    const next=createDocumentHttpTransport({sessionDescriptor:descriptor,pendingStore:f.store,operationJournal:f.journal.reopen(),fetch:fetcher});
    const session=createCanvasDocumentSession(next.socket,undefined,f.store); cleanups.push(()=>{session.disconnect();next.close()});
    const start=next.start(); await wait(()=>calls.length===1); calls[0].result.resolve(new Response(frame(3,Y.encodeStateAsUpdate(f.server)),{headers})); await start;
    expect(session.status).toBe('recovery'); expect(calls).toHaveLength(1); session.retryRecovered(); await wait(()=>calls.length===2);
    expect(calls[1].headers.get('x-wujie-document-operation-id')).toBe(operationId); expect([...calls[1].body]).toEqual([...original.body]);
    expect(digest(calls[1].body.subarray(1))).toBe(saved!.updateDigest);
    calls[1].result.resolve(Response.json({success:true,receipt:{operationId,sessionFingerprint:descriptor.sessionFingerprint,updateDigest:saved!.updateDigest,documentSequence:2}}));
    await wait(()=>f.store.load().length===0); await wait(()=>f.journal.get(pending.id)===undefined);
  });
  it('does not send a write if persisting its operation identity fails', async () => {
    const f=setup(); await initialize(f); vi.spyOn(f.journal,'put').mockImplementation(()=>{throw Error('disk full')});
    f.session.applyLocalChange({placementId:'p1',x:41}); await wait(()=>f.session.status==='unavailable'); expect(f.requests).toHaveLength(1); expect(f.store.load()).toHaveLength(1);
  });
  it('retains the operation identity when pending removal throws after a valid ACK', async () => {
    const f=setup(); await initialize(f); vi.spyOn(f.store,'remove').mockImplementation(()=>{throw Error('disk full')});
    f.session.applyLocalChange({placementId:'p1',x:42}); await wait(()=>f.requests.length===2); const id=f.store.load()[0].id;
    expect(f.journal.get(id)).toBeDefined(); f.answerWrite(1,2); await wait(()=>f.session.status==='unavailable');
    expect(f.store.load()).toHaveLength(1); expect(f.journal.get(id)).toBeDefined();
  });
  it('stops at 64 in-flight and queued writes, keeping all pending frames', async () => {
    const f=setup(); await initialize(f); f.session.applyLocalChange({placementId:'p1',x:100}); await wait(()=>f.requests.length===2);
    for(let i=0;i<64 && f.session.status!=='unavailable';i++) f.session.applyLocalChange({placementId:'p1',x:101+i});
    expect(f.session.status).toBe('unavailable'); expect(f.requests).toHaveLength(2); expect(f.store.load().length).toBeGreaterThan(64);
  });
  it('blocks automatic replay during an existing session socket replacement', async () => {
    const f=setup(); await initialize(f); f.session.applyLocalChange({placementId:'p1',x:89}); await wait(()=>f.requests.length===2);
    expect(f.journal.get(f.store.load()[0].id)).toBeDefined(); f.transport.close(); expect(f.session.status).toBe('unavailable');
    const calls: Array<Uint8Array> = []; const fetcher=vi.fn(async (_url:string,init:RequestInit)=>{const body=new Uint8Array(init.body as ArrayBuffer); calls.push(body); return new Response(frame(2,Y.encodeStateAsUpdate(f.server)),{headers});});
    const next=createDocumentHttpTransport({sessionDescriptor:descriptor,pendingStore:f.store,operationJournal:f.journal.reopen(),fetch:fetcher}); cleanups.push(()=>next.close());
    f.session.replaceSocket(next.socket); await expect(next.start()).rejects.toThrow(); await new Promise(r=>setTimeout(r,30));
    expect(calls.map(b=>b[0])).toEqual([1]); expect(f.store.load()).toHaveLength(1); expect(f.session.status).toBe('unavailable');
  });
  it.each(['actorId','projectId','ownerId','grantGeneration','sessionFingerprint'] as const)('never reuses a pending operation under changed %s', async field => {
    const f=setup(); await initialize(f); f.session.applyLocalChange({placementId:'p1',x:93}); await wait(()=>f.requests.length===2);
    const id=f.store.load()[0].id; const original=f.journal.get(id)!; f.session.disconnect(); f.transport.close();
    const altered={...descriptor,[field]:field==='sessionFingerprint'?'0'.repeat(64):field==='grantGeneration'?'2':'different'};
    const fetcher=vi.fn(async()=>new Response(frame(1,Y.encodeStateAsUpdate(f.server)),{headers}));
    const next=createDocumentHttpTransport({sessionDescriptor:altered,pendingStore:f.store,operationJournal:f.journal,fetch:fetcher});
    const session=createCanvasDocumentSession(next.socket,undefined,f.store); cleanups.push(()=>{session.disconnect();next.close()});
    await expect(next.start()).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); expect(f.store.load()).toHaveLength(1); expect(f.journal.get(id)).toEqual(original);
  });
  it('rejects a recovered record whose digest no longer matches its saved frame', async () => {
    const f=setup(); await initialize(f); f.session.applyLocalChange({placementId:'p1',x:94}); await wait(()=>f.requests.length===2);
    const id=f.store.load()[0].id; const saved=f.journal.get(id)!; f.session.disconnect(); f.transport.close(); f.journal.put(id,{...saved,updateDigest:'0'.repeat(64)});
    const fetcher=vi.fn(async()=>new Response(frame(1,Y.encodeStateAsUpdate(f.server)),{headers}));
    const next=createDocumentHttpTransport({sessionDescriptor:descriptor,pendingStore:f.store,operationJournal:f.journal.reopen(),fetch:fetcher});
    const session=createCanvasDocumentSession(next.socket,undefined,f.store); cleanups.push(()=>{session.disconnect();next.close()});
    await next.start(); expect(session.status).toBe('recovery'); session.retryRecovered(); await wait(()=>session.status==='unavailable');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(f.store.load()).toHaveLength(1); expect(f.journal.get(id)?.updateDigest).toBe('0'.repeat(64));
  });
  it('bounds all in-flight and queued update bytes to 4 MiB with real session edits', async () => {
    const f=setup(); await initialize(f);
    for(let n=0;n<8 && f.session.status!=='unavailable';n++) {
      const groups=Object.fromEntries(Array.from({length:700},(_,i)=>{const id='large-'+i; return [id,{id,name:'group',note:String(n)+'x'.repeat(990),imageIds:[],x:0,y:0,collapsed:false}];}));
      f.session.applyLocalGroups(groups);
    }
    const pending=f.store.load(); expect(f.session.status).toBe('unavailable'); expect(pending.length).toBeLessThanOrEqual(64);
    expect(pending.reduce((sum,item)=>sum+item.frame.byteLength,0)).toBeGreaterThan(4*1024*1024);
  }, 20000);
  it('retains separate queued operation identities over refresh and retries them in order', async () => {
    const f=setup(); await initialize(f); f.session.applyLocalChange({placementId:'p1',x:105}); f.session.applyLocalChange({placementId:'p1',x:106});
    await wait(()=>f.requests.length===2 && f.store.load().length===2 && f.store.load().every(item=>!!f.journal.get(item.id)));
    const items=f.store.load(); const records=items.map(item=>f.journal.get(item.id)!); expect(records[0].operationId).not.toBe(records[1].operationId);
    f.session.disconnect(); f.transport.close();
    const calls: Array<{body:Uint8Array;headers:Headers;result:ReturnType<typeof deferred<Response>>}> = [];
    const fetcher=vi.fn((_url:string,init:RequestInit)=>{const result=deferred<Response>();calls.push({body:new Uint8Array(init.body as ArrayBuffer),headers:new Headers(init.headers),result});return result.promise;});
    const next=createDocumentHttpTransport({sessionDescriptor:descriptor,pendingStore:f.store,operationJournal:f.journal.reopen(),fetch:fetcher});
    const session=createCanvasDocumentSession(next.socket,undefined,f.store); cleanups.push(()=>{session.disconnect();next.close()});
    const start=next.start(); await wait(()=>calls.length===1); calls[0].result.resolve(new Response(frame(1,Y.encodeStateAsUpdate(f.server)),{headers})); await start;
    expect(session.status).toBe('recovery'); session.retryRecovered(); await wait(()=>calls.length===2);
    expect(calls[1].headers.get('x-wujie-document-operation-id')).toBe(records[0].operationId); expect([...calls[1].body]).toEqual([...items[0].frame]);
    calls[1].result.resolve(Response.json({success:true,receipt:{operationId:records[0].operationId,sessionFingerprint:descriptor.sessionFingerprint,updateDigest:records[0].updateDigest,documentSequence:2}}));
    await wait(()=>calls.length===3); expect(calls[2].headers.get('x-wujie-document-operation-id')).toBe(records[1].operationId); expect([...calls[2].body]).toEqual([...items[1].frame]);
    calls[2].result.resolve(Response.json({success:true,receipt:{operationId:records[1].operationId,sessionFingerprint:descriptor.sessionFingerprint,updateDigest:records[1].updateDigest,documentSequence:3}}));
    await wait(()=>f.store.load().length===0); await wait(()=>items.every(item=>!f.journal.get(item.id)));
  });
  it.each(['throw','silent'] as const)('stops before a second write when durable removal is %s', async mode => {
    const f=setup(); await initialize(f);
    const removal=vi.spyOn(f.store,'remove').mockImplementation(()=>{if(mode==='throw')throw Error('disk full')});
    f.session.applyLocalChange({placementId:'p1',x:120}); f.session.applyLocalChange({placementId:'p1',x:121});
    await wait(()=>f.requests.length===2 && f.store.load().every(item=>!!f.journal.get(item.id)));
    const items=f.store.load(); const records=items.map(item=>f.journal.get(item.id)!);
    const waiting=f.session.waitForPendingUpdates().then(()=> 'resolved',error=>String(error.message));
    f.answerWrite(1,2); await wait(()=>f.session.status==='unavailable');
    expect(await waiting).toBe('DOCUMENT_PENDING_CONFIRMATION_UNAVAILABLE'); expect(f.requests).toHaveLength(2);
    expect(f.store.load().map(item=>item.id)).toEqual(items.map(item=>item.id));
    expect(items.map(item=>f.journal.get(item.id))).toEqual(records);
    removal.mockRestore(); f.session.disconnect(); f.transport.close();
    const calls:Array<{body:Uint8Array;headers:Headers;result:ReturnType<typeof deferred<Response>>}>=[];
    const fetcher=vi.fn((_url:string,init:RequestInit)=>{const result=deferred<Response>();calls.push({body:new Uint8Array(init.body as ArrayBuffer),headers:new Headers(init.headers),result});return result.promise});
    const next=createDocumentHttpTransport({sessionDescriptor:descriptor,pendingStore:f.store,operationJournal:f.journal.reopen(),fetch:fetcher});
    const session=createCanvasDocumentSession(next.socket,undefined,f.store); cleanups.push(()=>{session.disconnect();next.close()});
    const started=next.start(); await wait(()=>calls.length===1); calls[0].result.resolve(new Response(frame(1,Y.encodeStateAsUpdate(f.server)),{headers})); await started;
    expect(session.status).toBe('recovery'); session.retryRecovered(); await wait(()=>calls.length===2);
    expect(calls[1].headers.get('x-wujie-document-operation-id')).toBe(records[0].operationId);
    expect([...calls[1].body]).toEqual([...items[0].frame]);
    calls[1].result.resolve(Response.json({success:true,receipt:{operationId:records[0].operationId,sessionFingerprint:descriptor.sessionFingerprint,updateDigest:records[0].updateDigest,documentSequence:2}}));
    await wait(()=>calls.length===3); expect(calls[2].headers.get('x-wujie-document-operation-id')).toBe(records[1].operationId);
    calls[2].result.resolve(Response.json({success:true,receipt:{operationId:records[1].operationId,sessionFingerprint:descriptor.sessionFingerprint,updateDigest:records[1].updateDigest,documentSequence:3}}));
    await wait(()=>f.store.load().length===0);
  });
  it('stops and retains the journal if durable state cannot be read immediately after ACK', async () => {
    const f=setup(); await initialize(f); const original=f.store.remove.bind(f.store);
    vi.spyOn(f.store,'remove').mockImplementation(id=>{original(id);vi.spyOn(f.store,'load').mockImplementation(()=>{throw Error('read failed')});});
    f.session.applyLocalChange({placementId:'p1',x:122}); f.session.applyLocalChange({placementId:'p1',x:123});
    await wait(()=>f.requests.length===2 && f.store.load().every(item=>!!f.journal.get(item.id)));
    const ids=f.store.load().map(item=>item.id); const waiting=f.session.waitForPendingUpdates().then(()=> 'resolved',error=>String(error.message));
    f.answerWrite(1,2); await wait(()=>f.session.status==='unavailable'); expect(await waiting).toBe('DOCUMENT_PENDING_CONFIRMATION_UNAVAILABLE');
    expect(f.requests).toHaveLength(2); expect(ids.map(id=>f.journal.get(id))).toEqual(ids.map(()=>expect.objectContaining({operationId:expect.any(String)})));
  });
  it.each(['status','fingerprint','mime','length'] as const)('cancels and aborts a rejected streaming response at headers: %s', async kind => {
    const f=setup(); await initialize(f); const cancel=vi.fn();
    const stream=new ReadableStream<Uint8Array>({cancel});
    if(kind==='status' || kind==='mime') f.session.applyLocalChange({placementId:'p1',x:124});
    const pull = kind==='fingerprint'||kind==='length' ? f.transport.pull().then(()=> 'resolved',error=>String(error.message)) : null;
    await wait(()=>f.requests.length===2); const req=f.requests[1];
    const h = kind==='fingerprint' ? {...headers,'x-wujie-document-session-fingerprint':'bad'} : kind==='length' ? {...headers,'content-length':String(5*1024*1024+1)} : {'content-type':kind==='mime'?'text/plain':'application/json'};
    req.result.resolve(new Response(stream,{status:kind==='status'?503:200,headers:h}));
    await wait(()=>f.session.status==='unavailable'); if(pull) await pull;
    await wait(()=>cancel.mock.calls.length>0); expect(req.signal.aborted).toBe(true); expect(f.store.load()).toHaveLength(kind==='status'||kind==='mime'?1:0);
  });
  it.each(['timeout','close'] as const)('aborts and cancels an already-started stalled response body on %s', async action => {
    const f=setup(); await initialize(f); vi.useFakeTimers(); const cancel=vi.fn(); const readStarted=vi.fn();
    const stream=new ReadableStream<Uint8Array>({pull(){readStarted()},cancel});
    const pending=f.transport.pull().then(()=> 'resolved',error=>String(error.message));
    await vi.advanceTimersByTimeAsync(0); expect(f.requests).toHaveLength(2); const req=f.requests[1]; req.result.resolve(new Response(stream,{headers}));
    await vi.advanceTimersByTimeAsync(0); expect(readStarted).toHaveBeenCalled();
    if(action==='timeout') await vi.advanceTimersByTimeAsync(10_000); else f.transport.close();
    expect(await pending).toBe(action==='timeout'?'DOCUMENT_HTTP_TIMEOUT':'DOCUMENT_HTTP_CLOSED');
    expect(req.signal.aborted).toBe(true); expect(cancel).toHaveBeenCalled(); expect(f.session.status).toBe('unavailable');
  });
  it.each([
    {expiresAt:''},{expiresAt:'not-a-date'},{expiresAt:'2100-01-01T00:00:00Z'},
    {retainUntil:''},{retainUntil:'invalid'},{grantGeneration:'9223372036854775808'},
    {actorId:123},{ownerId:null},{projectId:{}}
  ])('rejects malformed descriptor before any fetch: %o', bad => {
    vi.stubGlobal('WebSocket',{OPEN:1});const fetcher=vi.fn();const store=memoryStore();
    expect(()=>createDocumentHttpTransport({sessionDescriptor:{...descriptor,...bad} as typeof descriptor,pendingStore:store,operationJournal:memoryJournal(),fetch:fetcher})).toThrow('DOCUMENT_HTTP_DESCRIPTOR_INVALID');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('permits an expired but still retained descriptor without substituting the session', async () => {
    vi.stubGlobal('WebSocket',{OPEN:1});const server=createCanvasDocument(); const old={...descriptor,expiresAt:'2020-01-01T00:00:00Z',retainUntil:'2099-02-01T00:00:00Z'};
    const fetcher=vi.fn(async()=>new Response(frame(1,Y.encodeStateAsUpdate(server)),{headers}));const store=memoryStore();
    const transport=createDocumentHttpTransport({sessionDescriptor:old,pendingStore:store,operationJournal:memoryJournal(),fetch:fetcher});
    const session=createCanvasDocumentSession(transport.socket,undefined,store);cleanups.push(()=>{session.disconnect();transport.close();server.destroy()});
    await transport.start(); expect(fetcher).toHaveBeenCalledTimes(1);expect(session.status).toBe('saved');
  });
  it('does not resolve a single pending waiter when durable removal fails after ACK', async () => {
    const f=setup(); await initialize(f); vi.spyOn(f.store,'remove').mockImplementation(()=>{throw Error('disk full')});
    f.session.applyLocalChange({placementId:'p1',x:126}); await wait(()=>f.requests.length===2);
    const waiting=f.session.waitForPendingUpdates().then(()=> 'resolved',error=>String(error.message));
    f.answerWrite(1,2); await wait(()=>f.session.status==='unavailable');
    expect(f.store.load()).toHaveLength(1);
    expect(await waiting).toBe('DOCUMENT_PENDING_CONFIRMATION_UNAVAILABLE');
  });
  it.each(['delete-then-throw','silent-no-delete','read-back-throws'] as const)('keeps one real-session pending in memory when ACK cleanup fails: %s', async mode => {
    const f=setup(); await initialize(f); const originalRemove=f.store.remove.bind(f.store); const originalLoad=f.store.load.bind(f.store);
    let afterRemove=false;
    const remove=vi.spyOn(f.store,'remove').mockImplementation(id=>{
      if(mode!=='silent-no-delete') originalRemove(id);
      afterRemove=true;
      if(mode==='delete-then-throw') throw Error('remove failed after deletion');
    });
    const load=vi.spyOn(f.store,'load').mockImplementation(()=>{if(mode==='read-back-throws' && afterRemove)throw Error('read failed');return originalLoad();});
    f.session.applyLocalChange({placementId:'p1',x:127}); await wait(()=>f.requests.length===2); const id=originalLoad()[0].id;
    const waiting=f.session.waitForPendingUpdates().then(()=> 'resolved',error=>String(error.message));
    f.answerWrite(1,2); await wait(()=>f.session.status==='unavailable');
    expect(await waiting).toBe('DOCUMENT_PENDING_CONFIRMATION_UNAVAILABLE'); expect(f.journal.get(id)).toBeDefined();
    f.session.disconnect(); expect(f.session.exportRecoveryCopy().pendingFrames).toHaveLength(1);
    load.mockRestore(); remove.mockRestore();
  });
  it('maps only a definitive 422 rejection to the real session 4400 path and retains its pending and journal', async () => {
    const f=setup(); await initialize(f); const mark=vi.fn(); f.store.markRejected=mark; const remove=vi.spyOn(f.store,'remove');
    f.session.applyLocalChange({placementId:'p1',x:131}); f.session.applyLocalChange({placementId:'p1',x:132});
    await wait(()=>f.requests.length===2 && f.store.load().every(item=>!!f.journal.get(item.id))); const pending=f.store.load();
    const waiting=f.session.waitForPendingUpdates().then(()=> 'resolved',error=>String(error.message));
    f.requests[1].result.resolve(Response.json({success:false,code:'DOCUMENT_EXCHANGE_REJECTED'},{status:422}));
    await wait(()=>f.session.status==='rejected'); expect(await waiting).toBe('DOCUMENT_PENDING_CONFIRMATION_UNAVAILABLE');
    expect(f.requests).toHaveLength(2); expect(remove).not.toHaveBeenCalled(); expect(f.store.load()).toHaveLength(2);
    expect(mark.mock.calls.map(call=>call[0])).toEqual(pending.map(item=>item.id));
    expect(pending.every(item=>!!f.journal.get(item.id))).toBe(true);
    expect(f.session.exportRecoveryCopy().pendingFrames.every(item=>item.rejected)).toBe(true);
  });
  it.each([
    {status:422,body:{success:false,code:'DOCUMENT_EXCHANGE_OTHER'}},
    {status:422,body:{success:true,code:'DOCUMENT_EXCHANGE_REJECTED'}},
    {status:503,body:{success:false,code:'DOCUMENT_EXCHANGE_REJECTED'}},
    {status:409,body:{success:false,code:'DOCUMENT_EXCHANGE_DEPENDENCY_PENDING'}},
    {status:403,body:{success:false,code:'DOCUMENT_EXCHANGE_UNCERTAIN_FORBIDDEN'}}
  ])('keeps non-definitive HTTP failure unavailable without marking rejection: %o', async ({status,body}) => {
    const f=setup(); await initialize(f); const mark=vi.fn(); f.store.markRejected=mark; const remove=vi.spyOn(f.store,'remove');
    f.session.applyLocalChange({placementId:'p1',x:133}); await wait(()=>f.requests.length===2); const id=f.store.load()[0].id;
    f.requests[1].result.resolve(Response.json(body,{status})); await wait(()=>f.session.status==='unavailable');
    expect(mark).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(f.store.load()).toHaveLength(1); expect(f.journal.get(id)).toBeDefined();
  });
  it.each(['malformed','oversized','wrong-mime'] as const)('keeps ambiguous 422 body unavailable: %s', async kind => {
    const f=setup(); await initialize(f); const mark=vi.fn(); f.store.markRejected=mark; f.session.applyLocalChange({placementId:'p1',x:134}); await wait(()=>f.requests.length===2);
    const id=f.store.load()[0].id; const data=kind==='malformed'?'{broken':JSON.stringify({success:false,code:'DOCUMENT_EXCHANGE_REJECTED'});
    f.requests[1].result.resolve(new Response(data,{status:422,headers:{'content-type':kind==='wrong-mime'?'text/plain':'application/json',...(kind==='oversized'?{'content-length':'4097'}:{})}}));
    await wait(()=>f.session.status==='unavailable'); expect(mark).not.toHaveBeenCalled(); expect(f.store.load()).toHaveLength(1); expect(f.journal.get(id)).toBeDefined();
  });
  it('ignores a definitive 422 arriving after the transport has closed', async () => {
    const f=setup(); await initialize(f); const mark=vi.fn(); f.store.markRejected=mark; f.session.applyLocalChange({placementId:'p1',x:135}); await wait(()=>f.requests.length===2);
    const id=f.store.load()[0].id; f.transport.close(); f.requests[1].result.resolve(Response.json({success:false,code:'DOCUMENT_EXCHANGE_REJECTED'},{status:422}));
    await new Promise(r=>setTimeout(r,30)); expect(f.session.status).toBe('unavailable'); expect(mark).not.toHaveBeenCalled(); expect(f.store.load()).toHaveLength(1); expect(f.journal.get(id)).toBeDefined();
  });
  it('closes a stalled 422 body without marking an incomplete response as rejected', async () => {
    const f=setup(); await initialize(f); const mark=vi.fn(); f.store.markRejected=mark; f.session.applyLocalChange({placementId:'p1',x:136});
    await wait(()=>f.requests.length===2); const id=f.store.load()[0].id, started=vi.fn(), cancelled=vi.fn();
    const stream=new ReadableStream<Uint8Array>({pull(){started()},cancel:cancelled});
    f.requests[1].result.resolve(new Response(stream,{status:422,headers:{'content-type':'application/json'}}));
    await wait(()=>started.mock.calls.length>0); f.transport.close(); await wait(()=>cancelled.mock.calls.length>0);
    expect(f.requests[1].signal.aborted).toBe(true); expect(f.session.status).toBe('unavailable'); expect(mark).not.toHaveBeenCalled();
    expect(f.store.load()).toHaveLength(1); expect(f.journal.get(id)).toBeDefined();
  });
  it('bounds a chunked 422 error body even without a declared content length', async () => {
    const f=setup(); await initialize(f); const mark=vi.fn(); f.store.markRejected=mark; f.session.applyLocalChange({placementId:'p1',x:137});
    await wait(()=>f.requests.length===2); const id=f.store.load()[0].id;
    const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(4097));controller.close();}});
    f.requests[1].result.resolve(new Response(body,{status:422,headers:{'content-type':'application/json'}}));
    await wait(()=>f.session.status==='unavailable'); expect(mark).not.toHaveBeenCalled(); expect(f.store.load()).toHaveLength(1); expect(f.journal.get(id)).toBeDefined();
  });
  it('keeps an extra-field 422 response unavailable and retains its pending and journal', async () => {
    const f=setup(); await initialize(f); const mark=vi.fn(); f.store.markRejected=mark; const remove=vi.spyOn(f.store,'remove');
    f.session.applyLocalChange({placementId:'p1',x:138}); await wait(()=>f.requests.length===2); const pending=f.store.load()[0];
    const journal=f.journal.get(pending.id);
    f.requests[1].result.resolve(Response.json({success:false,code:'DOCUMENT_EXCHANGE_REJECTED',unexpected:'extra'},{status:422}));
    await wait(()=>f.session.status==='unavailable'); expect(mark).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    expect(f.store.load()).toEqual([pending]); expect(f.journal.get(pending.id)).toEqual(journal); expect(journal).toBeDefined();
  });
  it('refuses an initial untrusted 204 and mismatched pull fingerprint', async () => {
    const f=setup(); const start=f.transport.start(); await wait(()=>f.requests.length===1); f.requests[0].result.resolve(new Response(null,{status:204,headers})); await expect(start).rejects.toThrow(); expect(f.session.status).toBe('unavailable');
    const g=setup(); const other=g.transport.start(); await wait(()=>g.requests.length===1); g.requests[0].result.resolve(new Response(frame(1,Y.encodeStateAsUpdate(g.server)),{headers:{...headers,'x-wujie-document-session-fingerprint':'wrong'}})); await expect(other).rejects.toThrow(); expect(g.session.status).toBe('unavailable');
  });
});
