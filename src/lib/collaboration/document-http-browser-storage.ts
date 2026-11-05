'use client';

import type { PendingDocumentUpdateStore } from './document-client';
import type { DocumentExchangeSessionDescriptor } from './document-exchange-session-protocol';
import type { DocumentHttpOperationJournal, DocumentHttpOperationRecord } from './document-http-transport';

const SESSION_PREFIX = 'wujie-canvas-document-http-session-v1:';
const JOURNAL_PREFIX = 'wujie-canvas-document-http-journal-v1:';
const LIMIT = 256;
const MAX_RECORD = 4096;
const MAX_FRAME = 1_048_577;
const MAX_EXPORT_BYTES = 16 * 1024 * 1024;
const DOMAIN = new TextEncoder().encode('wujie-document-update-v1\0');
const descriptorKeys = ['sessionToken','sessionFingerprint','actorId','ownerId','projectId','grantGeneration','expiresAt','retainUntil'];
const journalKeys = ['operationId','sessionFingerprint','updateDigest','actorId','projectId','ownerId','grantGeneration'];

type Pending = ReturnType<PendingDocumentUpdateStore['load']>[number];
type JournalItem = { pendingId: string; record: DocumentHttpOperationRecord };
export interface DocumentHttpBrowserStorageOptions {
  actorId: string;
  projectId: string;
  /** The original store must have been created for this same actor/project scope. */
  pendingStore: PendingDocumentUpdateStore;
  assertLease: () => void;
  storage?: Storage;
}
export interface DocumentHttpBrowserInspection {
  state: 'empty' | 'ready' | 'recovery';
  reasons: string[];
  pendingCount: number;
  journalCount: number;
}
export interface DocumentHttpBrowserJournal extends DocumentHttpOperationJournal {
  list(): JournalItem[];
  removeConfirmedOrphan(id:string, expected:DocumentHttpOperationRecord, receipt:{operationId:string;sessionFingerprint:string;updateDigest:string;documentSequence:number}): void;
}
export interface DocumentHttpPendingExport {
  actorId: string;
  projectId: string;
  pendingFrames: Array<{ frameBase64: string; rejected: boolean; intent?: Record<string, unknown> }>;
}
export interface DocumentHttpBrowserStorage {
  guardedPendingStore: PendingDocumentUpdateStore;
  readDescriptor(): Promise<DocumentExchangeSessionDescriptor | null>;
  saveDescriptor(value: DocumentExchangeSessionDescriptor): Promise<void>;
  rotateEmptyDescriptor(expected: DocumentExchangeSessionDescriptor, next: DocumentExchangeSessionDescriptor, expectedStartMarker: string): Promise<void>;
  journalFor(value: DocumentExchangeSessionDescriptor): DocumentHttpBrowserJournal;
  inspect(): Promise<DocumentHttpBrowserInspection>;
  exportPending(): DocumentHttpPendingExport;
}
function invalid(): Error { return new Error('DOCUMENT_HTTP_STORAGE_INVALID'); }
function safe(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}
function generation(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9]\d{0,18})$/u.test(value) && BigInt(value) <= BigInt('9223372036854775807');
}
function objectWithKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function parseJson(raw: string): unknown {
  if (raw.length > MAX_RECORD) throw invalid();
  try { return JSON.parse(raw) as unknown; } catch { throw invalid(); }
}
function validDescriptor(value: unknown, actorId: string, projectId: string): DocumentExchangeSessionDescriptor {
  if (!objectWithKeys(value, descriptorKeys) || !safe(value.actorId) || !safe(value.projectId) || !safe(value.ownerId) ||
      value.actorId !== actorId || value.projectId !== projectId || typeof value.sessionToken !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(value.sessionToken) || typeof value.sessionFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(value.sessionFingerprint) || !generation(value.grantGeneration) ||
      !safe(value.expiresAt, 128) || !safe(value.retainUntil, 128) || !Number.isFinite(Date.parse(value.expiresAt)) ||
      !Number.isFinite(Date.parse(value.retainUntil)) || Date.parse(value.expiresAt) > Date.parse(value.retainUntil)) throw invalid();
  return {sessionToken:value.sessionToken,sessionFingerprint:value.sessionFingerprint,actorId:value.actorId,ownerId:value.ownerId,
    projectId:value.projectId,grantGeneration:value.grantGeneration,expiresAt:value.expiresAt,retainUntil:value.retainUntil};
}
function validJournal(value: unknown, actorId: string, projectId: string): DocumentHttpOperationRecord {
  if (!objectWithKeys(value,journalKeys) || !safe(value.actorId) || !safe(value.projectId) || !safe(value.ownerId) ||
      value.actorId !== actorId || value.projectId !== projectId || !generation(value.grantGeneration) ||
      typeof value.operationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value.operationId) ||
      typeof value.sessionFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sessionFingerprint) ||
      typeof value.updateDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(value.updateDigest)) throw invalid();
  return {operationId:value.operationId,sessionFingerprint:value.sessionFingerprint,updateDigest:value.updateDigest,
    actorId:value.actorId,projectId:value.projectId,ownerId:value.ownerId,grantGeneration:value.grantGeneration};
}
function scopeMatches(a: DocumentHttpOperationRecord, b: DocumentExchangeSessionDescriptor): boolean {
  return a.actorId===b.actorId && a.projectId===b.projectId && a.ownerId===b.ownerId &&
    a.grantGeneration===b.grantGeneration && a.sessionFingerprint===b.sessionFingerprint;
}
function base64(bytes: Uint8Array): string {
  let text=''; for(let i=0;i<bytes.length;i+=8192) text+=String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(text);
}
function safeIntent(value: unknown, depth = 0): void {
  if (depth > 30) throw invalid();
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (Array.isArray(value)) { for (const item of value) safeIntent(item,depth+1); return; }
  if (typeof value !== 'object') throw invalid();
  for (const [key,item] of Object.entries(value)) {
    const normalized=key.replace(/[^a-z0-9]/gi,'').toLowerCase();
    if (/token|cookie|authorization|session|apikey|password|secret|credential|privatekey/.test(normalized)) throw invalid();
    safeIntent(item,depth+1);
  }
}

export function createDocumentHttpBrowserStorage(options: DocumentHttpBrowserStorageOptions): DocumentHttpBrowserStorage {
  const {actorId,projectId,pendingStore,assertLease}=options;
  if (!safe(actorId) || !safe(projectId) || typeof assertLease !== 'function' || !pendingStore ||
      typeof pendingStore.load !== 'function' || typeof pendingStore.append !== 'function' || typeof pendingStore.remove !== 'function') throw invalid();
  assertLease();
  const storage=options.storage ?? window.localStorage;
  let scoped: string;
  try { scoped=`${encodeURIComponent(actorId)}:${encodeURIComponent(projectId)}`; } catch { throw invalid(); }
  const sessionKey=SESSION_PREFIX+scoped, journalPrefix=JOURNAL_PREFIX+scoped+':';
  const startMarkerKey='wujie-canvas-document-http-start-unknown-v1:'+scoped;
  let verifiedRaw: string | null=null;
  let verifiedDescriptor: DocumentExchangeSessionDescriptor | null=null;
  const armed=new Map<string,string>();
  function access<T>(fn:()=>T): T { assertLease(); const value=fn(); assertLease(); return value; }
  function read(key:string): string | null { return access(()=>storage.getItem(key)); }
  function pending(): Pending[] {
    const values=access(()=>pendingStore.load());
    if (!Array.isArray(values) || values.length>LIMIT) throw invalid();
    const ids=new Set<string>();
    for (const item of values) {
      if (!item || !safe(item.id,512) || ids.has(item.id) || !(item.frame instanceof Uint8Array) ||
          item.frame.length<2 || item.frame.length>MAX_FRAME || item.frame[0]!==2 ||
          (item.rejected!==undefined && typeof item.rejected!=='boolean')) throw invalid();
      ids.add(item.id);
    }
    return values;
  }
  function equalBytes(a:Uint8Array,b:Uint8Array):boolean { return a.length===b.length && a.every((v,i)=>v===b[i]); }
  const guardedPendingStore: PendingDocumentUpdateStore = {
    load: pending,
    append(frame,intent) {
      assertLease(); const id=access(()=>pendingStore.append(frame,intent));
      const found=pending().find(item=>item.id===id);
      if (!found || !equalBytes(found.frame,frame) || JSON.stringify(found.intent) !== JSON.stringify(intent)) throw invalid();
      return id;
    },
    remove(id) {
      if (!safe(id,512)) throw invalid();
      access(()=>pendingStore.remove(id));
      if (pending().some(item=>item.id===id)) throw invalid();
    },
    ...(pendingStore.markRejected ? {markRejected(id:string):void {
      if (!safe(id,512)) throw invalid();
      access(()=>pendingStore.markRejected!(id));
      const item=pending().find(entry=>entry.id===id); if (!item?.rejected) throw invalid();
    }} : {}),
  };
  function journalKey(id:string): string {
    if (!safe(id,512)) throw invalid();
    try { return journalPrefix+encodeURIComponent(id); } catch { throw invalid(); }
  }
  function listJournal(): JournalItem[] {
    const length=access(()=>storage.length); if (!Number.isSafeInteger(length) || length<0) throw invalid();
    const keys:string[]=[];
    for (let i=0;i<length;i++) {
      const key=access(()=>storage.key(i));
      if (key?.startsWith(journalPrefix)) { keys.push(key); if (keys.length>LIMIT) throw invalid(); }
    }
    return keys.sort().map(key=>{
      let id:string;try { id=decodeURIComponent(key.slice(journalPrefix.length)); } catch { throw invalid(); }
      if (journalKey(id)!==key) throw invalid();
      const raw=read(key); if (raw===null) throw invalid();
      return {pendingId:id,record:validJournal(parseJson(raw),actorId,projectId)};
    });
  }
  async function sha(bytes:Uint8Array):Promise<string> {
    assertLease(); const digest=await crypto.subtle.digest('SHA-256',bytes.slice().buffer as ArrayBuffer); assertLease();
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function verify(value:unknown):Promise<DocumentExchangeSessionDescriptor> {
    const result=validDescriptor(value,actorId,projectId);
    const digest=await sha(new TextEncoder().encode(result.sessionToken)); assertLease();
    if (digest!==result.sessionFingerprint) throw invalid(); return result;
  }
  async function readSnapshot():Promise<{raw:string|null;descriptor:DocumentExchangeSessionDescriptor|null}> {
    const raw=read(sessionKey);
    if (raw===null) return {raw,descriptor:null};
    const descriptor=await verify(parseJson(raw)); assertLease();
    if (read(sessionKey)!==raw) throw invalid();
    return {raw,descriptor};
  }
  async function readDescriptor():Promise<DocumentExchangeSessionDescriptor|null> {
    const snapshot=await readSnapshot(); assertLease();
    if (read(sessionKey)!==snapshot.raw) throw invalid();
    verifiedRaw=snapshot.raw;verifiedDescriptor=snapshot.descriptor;
    return snapshot.descriptor ? {...snapshot.descriptor} : null;
  }
  async function saveDescriptor(value:DocumentExchangeSessionDescriptor):Promise<void> {
    const next=await verify(value); assertLease();
    const snapshot=await readSnapshot(); assertLease();
    const {descriptor:current,raw:before}=snapshot;
    if (current) {
      for (const key of ['sessionToken','sessionFingerprint','actorId','projectId','ownerId','grantGeneration','retainUntil'] as const) {
        if (current[key]!==next[key]) throw invalid();
      }
      if (Date.parse(next.expiresAt)<Date.parse(current.expiresAt)) throw invalid();
    } else if (pending().length || listJournal().length) throw invalid();
    if (read(sessionKey)!==before) throw invalid();
    const encoded=JSON.stringify(next);
    access(()=>storage.setItem(sessionKey,encoded));
    if (read(sessionKey)!==encoded) throw invalid();
    verifiedRaw=encoded;verifiedDescriptor=next;
  }
  /**
   * The caller must hold the scope lease and prove that the exact marker belongs
   * to its just-completed authorized start, with no earlier unknown start.
   * This method never removes the marker or infers server commit state.
   */
  async function rotateEmptyDescriptor(
    expected:DocumentExchangeSessionDescriptor, value:DocumentExchangeSessionDescriptor, expectedStartMarker:string,
  ):Promise<void> {
    assertLease();
    const original=validDescriptor(expected,actorId,projectId), candidate=validDescriptor(value,actorId,projectId);
    if (original.ownerId!==candidate.ownerId || typeof expectedStartMarker!=='string' ||
        expectedStartMarker.length===0 || expectedStartMarker.length>256) throw invalid();
    const before=read(sessionKey);
    if (before===null) throw invalid();
    const guard=():void=>{
      assertLease();
      if (read(sessionKey)!==before || read(startMarkerKey)!==expectedStartMarker ||
          pending().length!==0 || listJournal().length!==0) throw invalid();
      assertLease();
    };
    guard();
    const next=await verify(candidate);guard();
    const snapshot=await readSnapshot();guard();
    if (snapshot.raw!==before || !snapshot.descriptor ||
        JSON.stringify(snapshot.descriptor)!==JSON.stringify(original)) throw invalid();
    guard();
    const encoded=JSON.stringify(next);
    access(()=>storage.setItem(sessionKey,encoded));
    if (read(sessionKey)!==encoded || read(startMarkerKey)!==expectedStartMarker ||
        pending().length!==0 || listJournal().length!==0) throw invalid();
    verifiedRaw=encoded;verifiedDescriptor=next;
  }
  function checkedDescriptor(value:DocumentExchangeSessionDescriptor):DocumentExchangeSessionDescriptor {
    assertLease();const parsed=validDescriptor(value,actorId,projectId);
    if (!verifiedDescriptor || !verifiedRaw || JSON.stringify(parsed)!==JSON.stringify(verifiedDescriptor) || read(sessionKey)!==verifiedRaw) throw invalid();
    return parsed;
  }
  function journalFor(value:DocumentExchangeSessionDescriptor):DocumentHttpBrowserJournal {
    const binding=checkedDescriptor(value);
    function ensure(): void { checkedDescriptor(binding); }
    function readOne(id:string):DocumentHttpOperationRecord|undefined {
      ensure();const raw=read(journalKey(id));if(raw===null)return undefined;
      const record=validJournal(parseJson(raw),actorId,projectId);if(!scopeMatches(record,binding))throw invalid();return record;
    }
    function removeRecord(id:string,key:string,raw:string):void {
      try { access(()=>storage.removeItem(key)); if(read(key)!==null)throw invalid(); armed.delete(id); }
      catch(error) {
        // Restore only when still holding the lease and the original key is absent.
        try { assertLease();if(read(key)===null){access(()=>storage.setItem(key,raw));if(read(key)!==raw)throw invalid();} } catch { /* Storage may be unavailable. */ }
        throw error;
      }
    }
    return {
      get(id) {
        const record=readOne(id);
        if (record && pending().some(item=>item.id===id)) armed.set(id,JSON.stringify(record));
        return record;
      },
      list() { ensure();const records=listJournal();if(records.some(item=>!scopeMatches(item.record,binding)))throw invalid();return records; },
      put(id,value) {
        ensure();const record=validJournal(value,actorId,projectId);if(!scopeMatches(record,binding) || !pending().some(item=>item.id===id))throw invalid();
        const key=journalKey(id),existing=readOne(id),encoded=JSON.stringify(record);
        if(existing) { if(JSON.stringify(existing)!==encoded)throw invalid(); armed.set(id,encoded);return; }
        if(listJournal().length>=LIMIT)throw invalid();
        if(read(key)!==null)throw invalid();
        access(()=>storage.setItem(key,encoded));
        if(read(key)!==encoded || JSON.stringify(readOne(id))!==encoded)throw invalid();
        armed.set(id,encoded);
      },
      removeConfirmedOrphan(id,expected,receipt) {
        ensure();
        const wanted=validJournal(expected,actorId,projectId);
        if (!scopeMatches(wanted,binding) || !objectWithKeys(receipt,['operationId','sessionFingerprint','updateDigest','documentSequence']) ||
            receipt.operationId!==wanted.operationId || receipt.sessionFingerprint!==wanted.sessionFingerprint ||
            receipt.updateDigest!==wanted.updateDigest || typeof receipt.documentSequence!=='number' ||
            !Number.isSafeInteger(receipt.documentSequence) || receipt.documentSequence<0) throw invalid();
        const key=journalKey(id),raw=read(key);if(raw===null)throw invalid();
        const current=validJournal(parseJson(raw),actorId,projectId);
        if(!scopeMatches(current,binding) || JSON.stringify(current)!==JSON.stringify(wanted) || pending().some(item=>item.id===id))throw invalid();
        // The supplied object must come from a separately authorized server query;
        // this synchronous method verifies identity, not receipt provenance.
        ensure();if(read(key)!==raw || pending().some(item=>item.id===id))throw invalid();
        removeRecord(id,key,raw);
      },
      remove(id) {
        ensure();const current=readOne(id);if(!current || armed.get(id)!==JSON.stringify(current) || pending().some(item=>item.id===id))throw invalid();
        const key=journalKey(id),raw=read(key);if(raw===null)throw invalid();
        removeRecord(id,key,raw);
      },
    };
  }
  async function inspect():Promise<DocumentHttpBrowserInspection> {
    const beforeDesc=read(sessionKey);
    const desc=await readDescriptor();assertLease();
    if(read(sessionKey)!==beforeDesc || (desc===null)!==(beforeDesc===null))throw invalid();
    const pendingItems=pending(), journals=listJournal(), reasons=new Set<string>();
    const empty=!desc && pendingItems.length===0 && journals.length===0;
    if(!desc && (pendingItems.length || journals.length))reasons.add('missing-descriptor');
    if(pendingItems.length)reasons.add('pending-unconfirmed');
    const pendingIds=new Set(pendingItems.map(item=>item.id));
    for(const item of journals) {
      if(!pendingIds.has(item.pendingId))reasons.add('orphan-journal');
      if(desc && !scopeMatches(item.record,desc))reasons.add('journal-scope-mismatch');
    }
    for(const item of pendingItems) {
      if(item.rejected)reasons.add('rejected-pending');
      const record=journals.find(entry=>entry.pendingId===item.id)?.record;
      if(!record){reasons.add('missing-journal');continue;}
      const payload=new Uint8Array(DOMAIN.length+item.frame.length-1);payload.set(DOMAIN);payload.set(item.frame.subarray(1),DOMAIN.length);
      const digest=await sha(payload);assertLease();if(digest!==record.updateDigest)reasons.add('digest-mismatch');
    }
    const after=pending(),afterJournal=listJournal();
    if(read(sessionKey)!==beforeDesc || after.length!==pendingItems.length ||
       after.some((item,i)=>item.id!==pendingItems[i].id || !equalBytes(item.frame,pendingItems[i].frame) || item.rejected!==pendingItems[i].rejected || JSON.stringify(item.intent)!==JSON.stringify(pendingItems[i].intent)) ||
       JSON.stringify(afterJournal)!==JSON.stringify(journals))throw invalid();
    return {state:empty?'empty':reasons.size?'recovery':'ready',reasons:[...reasons],pendingCount:pendingItems.length,journalCount:journals.length};
  }
  function exportPending():DocumentHttpPendingExport {
    const raw=read(sessionKey);
    const token=raw===null ? null : validDescriptor(parseJson(raw),actorId,projectId).sessionToken;
    const records=pending();let total=0;
    const pendingFrames=records.map(item=>{
      if(token && new TextDecoder().decode(item.frame).includes(token))throw invalid();
      total+=item.frame.byteLength;if(total>MAX_EXPORT_BYTES)throw invalid();
      let intent:Record<string,unknown>|undefined;
      if(item.intent!==undefined){safeIntent(item.intent);const encoded=JSON.stringify(item.intent);if(encoded.length>MAX_FRAME || (token && encoded.includes(token)))throw invalid();intent=JSON.parse(encoded) as Record<string,unknown>;}
      return {frameBase64:base64(item.frame),rejected:item.rejected===true,...(intent?{intent}:{})};
    });
    assertLease();return {actorId,projectId,pendingFrames};
  }
  return {guardedPendingStore,readDescriptor,saveDescriptor,rotateEmptyDescriptor,journalFor,inspect,exportPending};
}
