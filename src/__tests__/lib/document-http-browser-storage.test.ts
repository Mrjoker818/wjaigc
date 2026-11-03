// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
// @ts-expect-error The existing jsdom dependency has no installed declarations.
import { JSDOM } from 'jsdom';
import { createBrowserPendingUpdateStore } from '@/lib/collaboration/document-client';
import { createDocumentHttpBrowserStorage } from '@/lib/collaboration/document-http-browser-storage';

const token='t'.repeat(43), hash=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
const descriptor={sessionToken:token,sessionFingerprint:hash(token),actorId:'actor-a',ownerId:'owner-a',projectId:'project-a',grantGeneration:'1',expiresAt:'2030-01-01T00:00:00.000Z',retainUntil:'2030-02-01T00:00:00.000Z'};
const update=new Uint8Array([2,0,0]), updateDigest=createHash('sha256').update('wujie-document-update-v1\0').update(update.subarray(1)).digest('hex');
const journalRecord={operationId:'12345678-1234-4234-8234-123456789abc',sessionFingerprint:descriptor.sessionFingerprint,updateDigest,actorId:descriptor.actorId,projectId:descriptor.projectId,ownerId:descriptor.ownerId,grantGeneration:descriptor.grantGeneration};
const sessionKey='wujie-canvas-document-http-session-v1:actor-a:project-a';
const journalPrefix='wujie-canvas-document-http-journal-v1:actor-a:project-a:';
function setup(options: {storage?: Storage; assertLease?:()=>void}={}) {
  const original=createBrowserPendingUpdateStore('project-a','actor-a');
  return {original, store:createDocumentHttpBrowserStorage({actorId:'actor-a',projectId:'project-a',pendingStore:original,assertLease:options.assertLease??(()=>{}),storage:options.storage})};
}
function faultStorage(changes: Partial<Storage>): Storage {
  const backing=window.localStorage;
  return new Proxy(backing,{get(target,key){if(key in changes){const value=Reflect.get(changes,key);return typeof value==='function'?value.bind(changes):value;}const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
}
beforeEach(()=>{const dom=new JSDOM('',{url:'https://fixture.invalid/'});vi.stubGlobal('localStorage',dom.window.localStorage);vi.stubGlobal('sessionStorage',dom.window.sessionStorage);vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>{window.localStorage.clear();window.sessionStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('explicit empty descriptor rotation',()=>{
  const markerKey='wujie-canvas-document-http-start-unknown-v1:actor-a:project-a';
  const marker=JSON.stringify({version:2,attempts:[123]});
  const nextToken='u'.repeat(43);
  const next={...descriptor,sessionToken:nextToken,sessionFingerprint:hash(nextToken),grantGeneration:'2'};
  function rotate(store:ReturnType<typeof createDocumentHttpBrowserStorage>,expected=descriptor,candidate=next,expectedMarker=marker):Promise<void>{
    return store.rotateEmptyDescriptor(expected,candidate,expectedMarker);
  }
  async function ready(){const a=setup();await a.store.saveDescriptor(descriptor);window.localStorage.setItem(markerKey,marker);return a;}
  it('rotates an exactly matched empty scope under the captured start marker',async()=>{
    const a=await ready();await rotate(a.store);expect(await a.store.readDescriptor()).toEqual(next);
    expect(window.localStorage.getItem(markerKey)).toBe(marker);expect(a.original.load()).toHaveLength(0);
    await expect(a.store.saveDescriptor(descriptor)).rejects.toThrow();
  });
  it.each(['pending','orphan'] as const)('preserves original descriptor with %s',async kind=>{
    const a=await ready(),id=a.original.append(update);
    if(kind==='orphan'){a.store.journalFor(descriptor).put(id,journalRecord);a.original.remove(id);}
    const before=window.localStorage.getItem(sessionKey);
    await expect(rotate(a.store)).rejects.toThrow();expect(window.localStorage.getItem(sessionKey)).toBe(before);
    expect(kind==='pending'?a.original.load().length:window.localStorage.getItem(journalPrefix+encodeURIComponent(id))).toBeTruthy();
    expect(window.localStorage.getItem(markerKey)).toBe(marker);
  });
  it.each(['actorId','projectId','ownerId'] as const)('rejects a new %s scope',async field=>{
    const a=await ready(),before=window.localStorage.getItem(sessionKey);
    await expect(rotate(a.store,descriptor,{...next,[field]:'other'})).rejects.toThrow();
    expect(window.localStorage.getItem(sessionKey)).toBe(before);
  });
  it('rejects a fingerprint which does not match the new token',async()=>{
    const a=await ready(),before=window.localStorage.getItem(sessionKey);
    await expect(rotate(a.store,descriptor,{...next,sessionFingerprint:'0'.repeat(64)})).rejects.toThrow();
    expect(window.localStorage.getItem(sessionKey)).toBe(before);
  });
  it('rejects a changed original descriptor and changed or absent marker',async()=>{
    const a=await ready(),before=window.localStorage.getItem(sessionKey);
    await expect(rotate(a.store,{...descriptor,expiresAt:'2030-01-02T00:00:00.000Z'})).rejects.toThrow();
    await expect(rotate(a.store,descriptor,next,'another-marker')).rejects.toThrow();
    window.localStorage.removeItem(markerKey);await expect(rotate(a.store)).rejects.toThrow();
    expect(window.localStorage.getItem(sessionKey)).toBe(before);
  });
  it.each(['pending','orphan','marker','descriptor','lease'] as const)('rejects %s changes during new-token digest',async change=>{
    let held=true;const a=setup({assertLease(){if(!held)throw Error('LEASE_LOST')}});await a.store.saveDescriptor(descriptor);
    window.localStorage.setItem(markerKey,marker);const before=window.localStorage.getItem(sessionKey);
    let finish!:(v:ArrayBuffer)=>void,started!:()=>void;const begun=new Promise<void>(r=>{started=r});
    const slow=new Promise<ArrayBuffer>(r=>{finish=r});
    vi.stubGlobal('crypto',{getRandomValues:webcrypto.getRandomValues.bind(webcrypto),subtle:{digest:()=>{started();return slow;}}});
    const pending=rotate(a.store);await begun;
    if(change==='pending')a.original.append(update);
    if(change==='orphan')window.localStorage.setItem(journalPrefix+'orphan',JSON.stringify(journalRecord));
    if(change==='marker')window.localStorage.setItem(markerKey,'other');
    if(change==='descriptor')window.localStorage.setItem(sessionKey,JSON.stringify({...descriptor,expiresAt:'2030-01-02T00:00:00.000Z'}));
    if(change==='lease')held=false;
    finish(Uint8Array.from(Buffer.from(next.sessionFingerprint,'hex')).buffer);
    await expect(pending).rejects.toThrow();
    if(change!=='descriptor')expect(window.localStorage.getItem(sessionKey)).toBe(before);
    else expect(window.localStorage.getItem(sessionKey)).not.toBe(JSON.stringify(next));
  });
  it('allows only one concurrent rotation for the same original descriptor',async()=>{
    const a=await ready(),otherToken='v'.repeat(43),other={...next,sessionToken:otherToken,sessionFingerprint:hash(otherToken)};
    const outcomes=await Promise.allSettled([rotate(a.store),rotate(a.store,descriptor,other)]);
    expect(outcomes.filter(item=>item.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.filter(item=>item.status==='rejected')).toHaveLength(1);
    const stored=await a.store.readDescriptor();expect([next.sessionToken,otherToken]).toContain(stored?.sessionToken);
    expect(window.localStorage.getItem(markerKey)).toBe(marker);
  });
  it('uses captured descriptor fields even if the caller mutates its object during digest',async()=>{
    const a=await ready(),mutable={...next};let finish!:(v:ArrayBuffer)=>void,started!:()=>void,calls=0;
    const begun=new Promise<void>(r=>{started=r}),slow=new Promise<ArrayBuffer>(r=>{finish=r});
    vi.stubGlobal('crypto',{getRandomValues:webcrypto.getRandomValues.bind(webcrypto),subtle:{digest:(_alg:string,data:ArrayBuffer)=>{
      if(++calls===1){started();return slow;}
      return Promise.resolve(Uint8Array.from(createHash('sha256').update(new Uint8Array(data)).digest()).buffer);
    }}});
    const rotating=rotate(a.store,descriptor,mutable);await begun;mutable.ownerId='other';mutable.grantGeneration='3';
    finish(Uint8Array.from(Buffer.from(next.sessionFingerprint,'hex')).buffer);await rotating;
    expect(await a.store.readDescriptor()).toEqual(next);
  });
});

describe('scoped browser storage with the original pending store',()=>{
  it('persists the descriptor and per-pending journal across newly created instances',async()=>{
    const a=setup(); expect((await a.store.inspect()).state).toBe('empty'); await a.store.saveDescriptor(descriptor);
    const id=a.store.guardedPendingStore.append(update,{placements:{p1:{x:2}}});
    const j=a.store.journalFor((await a.store.readDescriptor())!);j.put(id,journalRecord);
    expect(window.localStorage.getItem(sessionKey)).toContain(token); expect(window.localStorage.getItem(journalPrefix+encodeURIComponent(id))).not.toContain(token);
    const b=setup(); expect(await b.store.readDescriptor()).toEqual(descriptor); expect((await b.store.inspect()).state).toBe('recovery');
    expect(b.store.journalFor((await b.store.readDescriptor())!).get(id)).toEqual(journalRecord);
    expect(b.store.guardedPendingStore.load()[0].frame).toEqual(update);
    const exported=b.store.exportPending(); expect(exported.actorId).toBe('actor-a');expect(exported.projectId).toBe('project-a');
    expect(exported.pendingFrames[0]).toMatchObject({frameBase64:'AgAA',rejected:false,intent:{placements:{p1:{x:2}}}});
    expect(JSON.stringify(exported)).not.toContain(token); expect(exported).not.toHaveProperty('projection');
  });
  it('prevents a new descriptor when legacy pending or an orphan journal exists',async()=>{
    const a=setup();const id=a.original.append(update);expect((await a.store.inspect()).state).toBe('recovery');
    await expect(a.store.saveDescriptor(descriptor)).rejects.toThrow();expect(a.original.load().map(x=>x.id)).toEqual([id]);expect(window.localStorage.getItem(sessionKey)).toBeNull();
    a.original.remove(id);window.localStorage.setItem(journalPrefix+'orphan',JSON.stringify(journalRecord));
    expect((await a.store.inspect()).state).toBe('recovery');await expect(a.store.saveDescriptor(descriptor)).rejects.toThrow();expect(window.localStorage.getItem(journalPrefix+'orphan')).not.toBeNull();
  });
  it('preserves an orphan after recreation and refuses to remove it without a live pending observation',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.store.guardedPendingStore.append(update);a.store.journalFor(descriptor).put(id,journalRecord);
    a.store.guardedPendingStore.remove(id);const b=setup();const state=await b.store.inspect();expect(state.state).toBe('recovery');expect(state.reasons).toContain('orphan-journal');
    const j=b.store.journalFor((await b.store.readDescriptor())!);expect(j.get(id)).toEqual(journalRecord);expect(()=>j.remove(id)).toThrow();expect(window.localStorage.getItem(journalPrefix+encodeURIComponent(id))).not.toBeNull();
  });
  it('allows normal ACK cleanup only after observing a matching pending in the same instance',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.store.guardedPendingStore.append(update);const j=a.store.journalFor(descriptor);j.put(id,journalRecord);
    expect(()=>j.remove(id)).toThrow();a.store.guardedPendingStore.remove(id);j.remove(id);expect(j.get(id)).toBeUndefined();expect((await a.store.inspect()).state).toBe('ready');
  });
  it('retains a pending with missing journal and an explicitly rejected frame as recovery',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.store.guardedPendingStore.append(update);expect((await a.store.inspect()).reasons).toContain('missing-journal');
    a.store.journalFor(descriptor).put(id,journalRecord);a.store.guardedPendingStore.markRejected!(id);
    expect((await a.store.inspect()).reasons).toContain('rejected-pending');expect(a.store.exportPending().pendingFrames[0].rejected).toBe(true);
  });
  it('refuses mismatched digest without discarding the pending or journal',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.store.guardedPendingStore.append(update);a.store.journalFor(descriptor).put(id,{...journalRecord,updateDigest:'0'.repeat(64)});
    expect((await a.store.inspect()).reasons).toContain('digest-mismatch');expect(a.original.load()).toHaveLength(1);expect(window.localStorage.getItem(journalPrefix+encodeURIComponent(id))).not.toBeNull();
  });
  it.each([{actorId:'other'},{projectId:'other'},{ownerId:'other'},{grantGeneration:'2'},{sessionToken:'x'.repeat(43)},{sessionFingerprint:'0'.repeat(64)},{retainUntil:'2031-01-01T00:00:00.000Z'}])('rejects renewal changes to the fixed identity: %o',async changed=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const before=window.localStorage.getItem(sessionKey);
    await expect(a.store.saveDescriptor({...descriptor,...changed})).rejects.toThrow();expect(window.localStorage.getItem(sessionKey)).toBe(before);
  });
  it.each([{extra:true},{expiresAt:'bad'},{retainUntil:'bad'},{expiresAt:'2031-01-01T00:00:00.000Z'},{grantGeneration:'9223372036854775808'},{actorId:' a'},{sessionFingerprint:'0'.repeat(64)}])('rejects invalid descriptor without writing: %o',async changed=>{
    const a=setup();await expect(a.store.saveDescriptor({...descriptor,...changed})).rejects.toThrow();expect(window.localStorage.getItem(sessionKey)).toBeNull();
  });
  it('allows matching renewal and an expired descriptor without using local time for authorization',async()=>{
    const a=setup();const old={...descriptor,expiresAt:'2020-01-01T00:00:00.000Z'};await a.store.saveDescriptor(old);
    await a.store.saveDescriptor(descriptor);expect(await a.store.readDescriptor()).toEqual(descriptor);
  });
  it('never overwrites a conflicting journal and detects corrupted records',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.store.guardedPendingStore.append(update);const j=a.store.journalFor(descriptor);j.put(id,journalRecord);
    const key=journalPrefix+encodeURIComponent(id),before=window.localStorage.getItem(key);expect(()=>j.put(id,{...journalRecord,updateDigest:'0'.repeat(64)})).toThrow();expect(window.localStorage.getItem(key)).toBe(before);
    window.localStorage.setItem(key,'{broken');expect(()=>j.get(id)).toThrow();expect((window.localStorage.getItem(key))).toBe('{broken');
  });
  it('fails closed on descriptor write or readback failure without deleting the key',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const before=window.localStorage.getItem(sessionKey);
    const failed=setup({storage:faultStorage({setItem(){throw Error('quota')}})});await expect(failed.store.saveDescriptor({...descriptor,expiresAt:'2030-01-02T00:00:00.000Z'})).rejects.toThrow();expect(window.localStorage.getItem(sessionKey)).toBe(before);
    let writes=0;const readFail=setup({storage:faultStorage({setItem(k,v){window.localStorage.setItem(k,v);writes++},getItem(k){if(writes && k===sessionKey)throw Error('readback');return window.localStorage.getItem(k)}})});
    await expect(readFail.store.saveDescriptor({...descriptor,expiresAt:'2030-01-02T00:00:00.000Z'})).rejects.toThrow();expect(window.localStorage.getItem(sessionKey)).not.toBeNull();
  });
  it('guards every pending, journal and descriptor operation after lease loss',async()=>{
    let held=true;const a=setup({assertLease(){if(!held)throw Error('LEASE_LOST')}});await a.store.saveDescriptor(descriptor);
    const id=a.store.guardedPendingStore.append(update);const j=a.store.journalFor(descriptor);j.put(id,journalRecord);const before=window.localStorage.getItem(journalPrefix+encodeURIComponent(id));held=false;
    expect(()=>a.store.guardedPendingStore.load()).toThrow('LEASE_LOST');expect(()=>a.store.guardedPendingStore.append(update)).toThrow('LEASE_LOST');expect(()=>a.store.guardedPendingStore.remove(id)).toThrow('LEASE_LOST');expect(()=>a.store.guardedPendingStore.markRejected!(id)).toThrow('LEASE_LOST');
    expect(()=>j.get(id)).toThrow('LEASE_LOST');expect(()=>j.put(id,journalRecord)).toThrow('LEASE_LOST');expect(()=>j.remove(id)).toThrow('LEASE_LOST');await expect(a.store.readDescriptor()).rejects.toThrow('LEASE_LOST');expect(window.localStorage.getItem(journalPrefix+encodeURIComponent(id))).toBe(before);
  });
  it('does not write a descriptor after the lease is lost during SHA-256',async()=>{
    let held=true,finish!: (v:ArrayBuffer)=>void;const slow=new Promise<ArrayBuffer>(r=>{finish=r});vi.stubGlobal('crypto',{getRandomValues:webcrypto.getRandomValues.bind(webcrypto),subtle:{digest:()=>slow}});
    const a=setup({assertLease(){if(!held)throw Error('LEASE_LOST')}});const saving=a.store.saveDescriptor(descriptor);held=false;finish(new Uint8Array(Buffer.from(descriptor.sessionFingerprint,'hex')).buffer);
    await expect(saving).rejects.toThrow('LEASE_LOST');expect(window.localStorage.getItem(sessionKey)).toBeNull();
  });
  it('rejects mismatched or extra journal fields and preserves the pending',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.original.append(update);const j=a.store.journalFor(descriptor);
    const extra={...journalRecord,extra:true};expect(()=>j.put(id,{...journalRecord,actorId:'other'})).toThrow();expect(()=>j.put(id,extra)).toThrow();
    expect(()=>j.put(id,{...journalRecord,grantGeneration:'9223372036854775808'})).toThrow();
    expect(a.original.load()).toHaveLength(1);expect(window.localStorage.getItem(journalPrefix+encodeURIComponent(id))).toBeNull();
  });
  it('caps journal records at 256 while permitting an identical existing entry',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.original.append(update);const j=a.store.journalFor(descriptor);j.put(id,journalRecord);
    for(let i=0;i<255;i++)window.localStorage.setItem(journalPrefix+'manual-'+i,JSON.stringify(journalRecord));
    expect(j.list()).toHaveLength(256);expect(()=>j.put(id,journalRecord)).not.toThrow();
    const next=a.original.append(update);expect(()=>j.put(next,journalRecord)).toThrow();expect(a.original.load()).toHaveLength(2);
  });
  it('reports a journal count over 256 without deleting any records',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);for(let i=0;i<257;i++)window.localStorage.setItem(journalPrefix+'manual-'+i,JSON.stringify(journalRecord));
    await expect(a.store.inspect()).rejects.toThrow();expect(window.localStorage.getItem(journalPrefix+'manual-256')).not.toBeNull();
  });
  it('preserves the journal when an armed normal cleanup encounters a storage deletion failure',async()=>{
    let failDelete=false;const wrapped=faultStorage({removeItem(k){if(failDelete && k.startsWith(journalPrefix))throw Error('delete failed');window.localStorage.removeItem(k)}});
    const a=setup({storage:wrapped});await a.store.saveDescriptor(descriptor);const id=a.store.guardedPendingStore.append(update);const j=a.store.journalFor(descriptor);j.put(id,journalRecord);
    a.store.guardedPendingStore.remove(id);failDelete=true;expect(()=>j.remove(id)).toThrow();expect(window.localStorage.getItem(journalPrefix+encodeURIComponent(id))).not.toBeNull();
  });
  it('detects failed journal readback without deleting the written key',async()=>{
    let written=false;const wrapped=faultStorage({setItem(k,v){window.localStorage.setItem(k,v);if(k.startsWith(journalPrefix))written=true},getItem(k){if(written && k.startsWith(journalPrefix))return null;return window.localStorage.getItem(k)}});
    const a=setup({storage:wrapped});await a.store.saveDescriptor(descriptor);const id=a.original.append(update);const j=a.store.journalFor(descriptor);
    expect(()=>j.put(id,journalRecord)).toThrow();expect(a.original.load()).toHaveLength(1);expect(window.localStorage.getItem(journalPrefix+encodeURIComponent(id))).not.toBeNull();
  });
  it('isolates actor and project keys and exports only the requested scope',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);a.store.guardedPendingStore.append(update);
    const second=createDocumentHttpBrowserStorage({actorId:'actor-b',projectId:'project-a',pendingStore:createBrowserPendingUpdateStore('project-a','actor-b'),assertLease:()=>{}});
    expect((await second.inspect()).state).toBe('empty');expect(second.exportPending().pendingFrames).toHaveLength(0);expect(a.store.exportPending().pendingFrames).toHaveLength(1);
  });
  it('fails closed when a pending write loses the lease before its return',()=>{
    let held=true;const a=setup({assertLease(){if(!held)throw Error('LEASE_LOST')}});const append=a.original.append.bind(a.original);
    vi.spyOn(a.original,'append').mockImplementation((frame,intent)=>{const id=append(frame,intent);held=false;return id});
    expect(()=>a.store.guardedPendingStore.append(update)).toThrow('LEASE_LOST');expect(a.original.load()).toHaveLength(1);
  });
  it('does not complete a descriptor read when the lease is lost during its hash',async()=>{
    let held=true;const a=setup({assertLease(){if(!held)throw Error('LEASE_LOST')}});await a.store.saveDescriptor(descriptor);
    let finish!:(v:ArrayBuffer)=>void;const slow=new Promise<ArrayBuffer>(r=>{finish=r});vi.stubGlobal('crypto',{getRandomValues:webcrypto.getRandomValues.bind(webcrypto),subtle:{digest:()=>slow}});
    const reading=a.store.readDescriptor();held=false;finish(new Uint8Array(Buffer.from(descriptor.sessionFingerprint,'hex')).buffer);
    await expect(reading).rejects.toThrow('LEASE_LOST');expect(window.localStorage.getItem(sessionKey)).not.toBeNull();
  });
  it('does not export intent with credential-like keys',()=>{
    const a=setup();a.original.append(update,{sessionToken:'secret'});expect(()=>a.store.exportPending()).toThrow();expect(a.original.load()).toHaveLength(1);
  });
  it('refuses to export the descriptor token if it appears as a pending intent value',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);a.original.append(update,{note:descriptor.sessionToken});
    expect(()=>a.store.exportPending()).toThrow();expect(a.original.load()).toHaveLength(1);
  });
  it('restores the original journal when deletion takes effect and then throws while lease remains held',async()=>{
    const wrapped=faultStorage({removeItem(k){window.localStorage.removeItem(k);if(k.startsWith(journalPrefix))throw Error('delete failed after effect')}});
    const a=setup({storage:wrapped});await a.store.saveDescriptor(descriptor);const id=a.store.guardedPendingStore.append(update);const j=a.store.journalFor(descriptor);j.put(id,journalRecord);
    a.store.guardedPendingStore.remove(id);const key=journalPrefix+encodeURIComponent(id),before=window.localStorage.getItem(key);
    expect(()=>j.remove(id)).toThrow();expect(window.localStorage.getItem(key)).toBe(before);
  });
  it('reports recovery for matching durable pending after recreating the instance',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.store.guardedPendingStore.append(update);a.store.journalFor(descriptor).put(id,journalRecord);
    const b=setup(),state=await b.store.inspect();expect(state.state).toBe('recovery');expect(state.reasons).toContain('pending-unconfirmed');
    expect(b.original.load()).toHaveLength(1);expect(window.localStorage.getItem(journalPrefix+encodeURIComponent(id))).not.toBeNull();
  });
  it('does not overwrite a concurrently installed different first session under one lease',async()=>{
    vi.stubGlobal('crypto',{getRandomValues:webcrypto.getRandomValues.bind(webcrypto),subtle:{digest:(_algorithm:string,data:ArrayBuffer)=>Promise.resolve(Uint8Array.from(createHash('sha256').update(new Uint8Array(data)).digest()).buffer)}});
    const a=setup(),differentToken='u'.repeat(43),different={...descriptor,sessionToken:differentToken,sessionFingerprint:hash(differentToken)};
    const outcomes=await Promise.allSettled([a.store.saveDescriptor(descriptor),a.store.saveDescriptor(different)]);
    expect(outcomes.map(result=>result.status)).toEqual(['fulfilled','rejected']);expect(await a.store.readDescriptor()).toEqual(descriptor);
  });
  it('does not roll back expiry during concurrent renewals under one lease',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);
    vi.stubGlobal('crypto',{getRandomValues:webcrypto.getRandomValues.bind(webcrypto),subtle:{digest:(_algorithm:string,data:ArrayBuffer)=>Promise.resolve(Uint8Array.from(createHash('sha256').update(new Uint8Array(data)).digest()).buffer)}});
    const newer={...descriptor,expiresAt:'2030-01-20T00:00:00.000Z'},older={...descriptor,expiresAt:'2030-01-10T00:00:00.000Z'};
    const outcomes=await Promise.allSettled([a.store.saveDescriptor(newer),a.store.saveDescriptor(older)]);
    expect(outcomes.map(result=>result.status)).toEqual(['fulfilled','rejected']);expect(await a.store.readDescriptor()).toEqual(newer);
  });
  it('does not report empty if a descriptor appears while inspect is yielded',async()=>{
    const a=setup();const reading=a.store.inspect();window.localStorage.setItem(sessionKey,JSON.stringify(descriptor));
    await expect(reading).rejects.toThrow();expect(window.localStorage.getItem(sessionKey)).not.toBeNull();
  });
  it.each(['apiKey','api_key','password','secret','credential','privateKey','PRIVATE_KEY','authToken'] as const)('refuses nested credential field %s without modifying intent',field=>{
    const a=setup(),intent={nested:{[field]:'synthetic-value'}},id=a.original.append(update,intent);
    expect(()=>a.store.exportPending()).toThrow();expect(a.original.load().find(item=>item.id===id)?.intent).toEqual(intent);
  });
  it('removes a retained orphan only for an exactly matching supplied receipt',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.store.guardedPendingStore.append(update);a.store.journalFor(descriptor).put(id,journalRecord);a.store.guardedPendingStore.remove(id);
    const b=setup();const j=b.store.journalFor((await b.store.readDescriptor())!);const receipt={operationId:journalRecord.operationId,sessionFingerprint:journalRecord.sessionFingerprint,updateDigest:journalRecord.updateDigest,documentSequence:8};
    expect((await b.store.inspect()).reasons).toContain('orphan-journal');j.removeConfirmedOrphan(id,journalRecord,receipt);
    expect(window.localStorage.getItem(journalPrefix+encodeURIComponent(id))).toBeNull();expect(window.localStorage.getItem(sessionKey)).not.toBeNull();
  });
  it.each([
    null,{}, {operationId:journalRecord.operationId,sessionFingerprint:journalRecord.sessionFingerprint,updateDigest:journalRecord.updateDigest,documentSequence:-1},
    {operationId:journalRecord.operationId,sessionFingerprint:journalRecord.sessionFingerprint,updateDigest:journalRecord.updateDigest,documentSequence:1.5},
    {operationId:journalRecord.operationId,sessionFingerprint:journalRecord.sessionFingerprint,updateDigest:journalRecord.updateDigest,documentSequence:Number.MAX_SAFE_INTEGER+1},
    {operationId:'other',sessionFingerprint:journalRecord.sessionFingerprint,updateDigest:journalRecord.updateDigest,documentSequence:1},
    {operationId:journalRecord.operationId,sessionFingerprint:'0'.repeat(64),updateDigest:journalRecord.updateDigest,documentSequence:1},
    {operationId:journalRecord.operationId,sessionFingerprint:journalRecord.sessionFingerprint,updateDigest:'0'.repeat(64),documentSequence:1},
    {operationId:journalRecord.operationId,sessionFingerprint:journalRecord.sessionFingerprint,updateDigest:journalRecord.updateDigest,documentSequence:1,extra:true}
  ])('rejects missing, mismatched or malformed orphan receipt %o',async receipt=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.original.append(update);a.store.journalFor(descriptor).put(id,journalRecord);a.original.remove(id);
    const b=setup(),j=b.store.journalFor((await b.store.readDescriptor())!),key=journalPrefix+encodeURIComponent(id),before=window.localStorage.getItem(key);
    expect(()=>j.removeConfirmedOrphan(id,journalRecord,receipt as {operationId:string;sessionFingerprint:string;updateDigest:string;documentSequence:number})).toThrow();
    expect(window.localStorage.getItem(key)).toBe(before);expect(window.localStorage.getItem(sessionKey)).not.toBeNull();
  });
  it('rejects orphan cleanup when pending still exists, expected scope differs or the stored record was replaced',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.original.append(update),j=a.store.journalFor(descriptor);j.put(id,journalRecord);
    const receipt={operationId:journalRecord.operationId,sessionFingerprint:journalRecord.sessionFingerprint,updateDigest:journalRecord.updateDigest,documentSequence:1};
    expect(()=>j.removeConfirmedOrphan(id,journalRecord,receipt)).toThrow();a.original.remove(id);
    expect(()=>j.removeConfirmedOrphan(id,{...journalRecord,actorId:'other'},receipt)).toThrow();
    const key=journalPrefix+encodeURIComponent(id),replacement={...journalRecord,updateDigest:'0'.repeat(64)};window.localStorage.setItem(key,JSON.stringify(replacement));
    expect(()=>j.removeConfirmedOrphan(id,journalRecord,receipt)).toThrow();expect(window.localStorage.getItem(key)).toBe(JSON.stringify(replacement));
  });
  it('does not remove an orphan if the lease was lost before confirmed cleanup',async()=>{
    let held=true;const a=setup({assertLease(){if(!held)throw Error('LEASE_LOST')}});await a.store.saveDescriptor(descriptor);const id=a.original.append(update),j=a.store.journalFor(descriptor);j.put(id,journalRecord);a.original.remove(id);
    held=false;const receipt={operationId:journalRecord.operationId,sessionFingerprint:journalRecord.sessionFingerprint,updateDigest:journalRecord.updateDigest,documentSequence:1};
    expect(()=>j.removeConfirmedOrphan(id,journalRecord,receipt)).toThrow('LEASE_LOST');expect(window.localStorage.getItem(journalPrefix+encodeURIComponent(id))).not.toBeNull();
  });
  it('rejects inspect if the descriptor changes while its digest is pending',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);let finish!:(value:ArrayBuffer)=>void;
    const delayed=new Promise<ArrayBuffer>(resolve=>{finish=resolve});vi.stubGlobal('crypto',{getRandomValues:webcrypto.getRandomValues.bind(webcrypto),subtle:{digest:()=>delayed}});
    const checking=a.store.inspect();window.localStorage.setItem(sessionKey,JSON.stringify({...descriptor,expiresAt:'2030-01-02T00:00:00.000Z'}));
    finish(Uint8Array.from(Buffer.from(descriptor.sessionFingerprint,'hex')).buffer);await expect(checking).rejects.toThrow();
  });
  it('rejects inspect if pending changes while the update digest is pending',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.original.append(update);a.store.journalFor(descriptor).put(id,journalRecord);
    let calls=0,started!:()=>void,finish!:(value:ArrayBuffer)=>void;const begun=new Promise<void>(resolve=>{started=resolve});const delayed=new Promise<ArrayBuffer>(resolve=>{finish=resolve});
    vi.stubGlobal('crypto',{getRandomValues:webcrypto.getRandomValues.bind(webcrypto),subtle:{digest:(_alg:string,data:ArrayBuffer)=>{calls++;if(calls===2){started();return delayed;}return Promise.resolve(Uint8Array.from(createHash('sha256').update(new Uint8Array(data)).digest()).buffer)}}});
    const checking=a.store.inspect();await begun;a.original.append(update);finish(Uint8Array.from(Buffer.from(updateDigest,'hex')).buffer);
    await expect(checking).rejects.toThrow();expect(a.original.load()).toHaveLength(2);
  });
  it('refuses confirmed orphan removal if the pending reappears before deletion',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.original.append(update);a.store.journalFor(descriptor).put(id,journalRecord);a.original.remove(id);
    const key=journalPrefix+encodeURIComponent(id),pendingKey='wujie-canvas-document-pending-v1:actor-a:project-a:'+id;let active=false,reads=0;
    const wrapped=faultStorage({getItem(k){if(active && k===key && ++reads===2)window.localStorage.setItem(pendingKey,'AgAA');return window.localStorage.getItem(k)}});
    const b=setup({storage:wrapped}),j=b.store.journalFor((await b.store.readDescriptor())!);const receipt={operationId:journalRecord.operationId,sessionFingerprint:journalRecord.sessionFingerprint,updateDigest:journalRecord.updateDigest,documentSequence:1};
    active=true;expect(()=>j.removeConfirmedOrphan(id,journalRecord,receipt)).toThrow();expect(window.localStorage.getItem(key)).not.toBeNull();expect(b.original.load().map(item=>item.id)).toContain(id);
  });
  it('refuses confirmed orphan removal if its record is replaced before deletion',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.original.append(update);a.store.journalFor(descriptor).put(id,journalRecord);a.original.remove(id);
    const key=journalPrefix+encodeURIComponent(id),replacement={...journalRecord,updateDigest:'0'.repeat(64)};let active=false,reads=0;
    const wrapped=faultStorage({getItem(k){if(active && k===key && ++reads===2)window.localStorage.setItem(key,JSON.stringify(replacement));return window.localStorage.getItem(k)}});
    const b=setup({storage:wrapped}),j=b.store.journalFor((await b.store.readDescriptor())!);const receipt={operationId:journalRecord.operationId,sessionFingerprint:journalRecord.sessionFingerprint,updateDigest:journalRecord.updateDigest,documentSequence:1};
    active=true;expect(()=>j.removeConfirmedOrphan(id,journalRecord,receipt)).toThrow();expect(window.localStorage.getItem(key)).toBe(JSON.stringify(replacement));
  });
  it('restores a confirmed orphan when storage deletes it and then throws',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.original.append(update);a.store.journalFor(descriptor).put(id,journalRecord);a.original.remove(id);
    const wrapped=faultStorage({removeItem(k){window.localStorage.removeItem(k);if(k.startsWith(journalPrefix))throw Error('deleted then failed')}});
    const b=setup({storage:wrapped}),j=b.store.journalFor((await b.store.readDescriptor())!);const key=journalPrefix+encodeURIComponent(id),before=window.localStorage.getItem(key);
    const receipt={operationId:journalRecord.operationId,sessionFingerprint:journalRecord.sessionFingerprint,updateDigest:journalRecord.updateDigest,documentSequence:1};
    expect(()=>j.removeConfirmedOrphan(id,journalRecord,receipt)).toThrow();expect(window.localStorage.getItem(key)).toBe(before);
  });
  it('fails closed on journal write, readback and removal faults',async()=>{
    const a=setup();await a.store.saveDescriptor(descriptor);const id=a.original.append(update);let failWrite=true;
    const wrapped=setup({storage:faultStorage({setItem(k,v){if(failWrite && k.startsWith(journalPrefix))throw Error('quota');window.localStorage.setItem(k,v)}})});
    const j=wrapped.store.journalFor((await wrapped.store.readDescriptor())!);expect(()=>j.put(id,journalRecord)).toThrow();expect(window.localStorage.getItem(journalPrefix+encodeURIComponent(id))).toBeNull();
    failWrite=false;j.put(id,journalRecord);a.original.remove(id);
    const removal=setup({storage:faultStorage({removeItem(){throw Error('delete failed')}})});const j2=removal.store.journalFor((await removal.store.readDescriptor())!);
    expect(()=>j2.remove(id)).toThrow();expect(window.localStorage.getItem(journalPrefix+encodeURIComponent(id))).not.toBeNull();
  });
});
