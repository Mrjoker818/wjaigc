import { expect, it, vi } from 'vitest';
import { createSimpleChatSyncCoordinator } from '@/lib/simple-chat-sync-client';
import { createMemorySimpleChatEnvelopeStore, deferred, jsonResponse, project } from '@/__tests__/fixtures/simple-chat-sync';

it('preserves a later edit while the second conflict rebase is being persisted',async()=>{
 const memory=createMemorySimpleChatEnvelopeStore(), first=deferred<void>(),firstRelease=deferred<void>(),second=deferred<void>(),secondRelease=deferred<void>(),post2=deferred<Response>();
 let writes=0,reads=0,posts=0,id=0;
 const store={...memory,put:async(v:Parameters<typeof memory.put>[0])=>{
  if(v.baseRevision===2){writes++;if(writes===1){first.resolve();await firstRelease.promise}if(writes===2){second.resolve();await secondRelease.promise}}
  await memory.put(v);
 }};
 const fetchImpl=vi.fn(async(_u:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method==='POST'){posts++;return posts===1?jsonResponse(409,{success:false,code:'CHAT_SYNC_CONFLICT'}):post2.promise}
  reads++;return jsonResponse(200,{success:true,value:reads===1?[]:[project('remote')],syncRevision:reads===1?1:2});
 });
 const c=createSimpleChatSyncCoordinator({store,fetchImpl,createId:()=>`00000000-0000-4000-8000-${String(++id).padStart(12,'0')}`,sleep:async()=>{}});
 try{
  await c.initialize('fixture-a');c.update([project('first')]);const flushing=c.flush('manual');await first.promise;
  c.update([project('first'),project('second')]);firstRelease.resolve();await second.promise;
  c.update([project('first'),project('second'),project('third')]);secondRelease.resolve();
  await vi.waitFor(()=>expect(posts).toBe(2));
  expect(c.snapshot().projects.map(p=>p.id)).toEqual(expect.arrayContaining(['remote','first','second','third']));
  const saved=await memory.get('fixture-a');expect(saved?.currentProjects.map(p=>p.id)).toEqual(expect.arrayContaining(['remote','first','second','third']));
  expect(c.snapshot().pendingOperations.length).toBeGreaterThan(0);
  post2.resolve(jsonResponse(503,{success:false}));await flushing;
 }finally{firstRelease.resolve();secondRelease.resolve();post2.resolve(jsonResponse(503,{success:false}));await c.dispose({flush:false})}
},10000);
