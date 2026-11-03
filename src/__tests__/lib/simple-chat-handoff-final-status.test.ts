import { expect,it,vi } from 'vitest';
import { createSimpleChatSyncCoordinator } from '@/lib/simple-chat-sync-client';
import { createMemorySimpleChatEnvelopeStore,deferred,jsonResponse,project } from '@/__tests__/fixtures/simple-chat-sync';

async function setup(){
 const memory=createMemorySimpleChatEnvelopeStore(),started=deferred<void>(),release=deferred<void>();let writes=0,id=0;const base=project('base');
 const store={...memory,put:async(v:Parameters<typeof memory.put>[0])=>{
  if(v.baseRevision===1){writes++;if(writes<=4)c.update(c.snapshot().projects.map(p=>({...p,name:writes===4?'first':`changed-${writes}`})));else if(writes===5){started.resolve();await release.promise}}
  await memory.put(v);
 }};
 const fetchImpl=vi.fn(async(_u:RequestInfo|URL,init?:RequestInit)=>init?.method==='POST'?jsonResponse(200,{success:true,syncRevision:1}):jsonResponse(200,{success:true,value:[base],syncRevision:0}));
 const c=createSimpleChatSyncCoordinator({store,fetchImpl,createId:()=>`00000000-0000-4000-8000-${String(++id).padStart(12,'0')}`});
 await c.initialize('fixture-a');c.update([{...base,name:'first'}]);const flushing=c.flush('manual');
 return {c,memory,release,started,flushing,getWrites:()=>writes};
}
it('marks synced when bounded acknowledgement finishes with no remaining edits',async()=>{
 const f=await setup();try{
  await vi.waitFor(()=>expect(f.getWrites()).toBeGreaterThanOrEqual(5));await f.started.promise;f.release.resolve();await f.flushing;
  expect(f.c.snapshot().projects[0].name).toBe('first');expect(f.c.snapshot().pendingOperations).toHaveLength(0);expect(f.c.snapshot().status).toBe('synced');
  await vi.waitFor(async()=>expect((await f.memory.get('fixture-a'))?.pendingOperations).toHaveLength(0));
 }finally{f.release.resolve();await f.c.dispose({flush:false});await f.flushing}
},10000);
it('retains a new edit made during the final bounded acknowledgement write',async()=>{
 const f=await setup();try{
  await vi.waitFor(()=>expect(f.getWrites()).toBeGreaterThanOrEqual(5));await f.started.promise;
  f.c.update(f.c.snapshot().projects.map(p=>({...p,name:'after-handoff'})));f.release.resolve();await f.flushing;
  expect(f.c.snapshot().projects[0].name).toBe('after-handoff');expect(f.c.snapshot().pendingOperations.length).toBeGreaterThan(0);expect(f.c.snapshot().status).toBe('syncing');
  await vi.waitFor(async()=>{const v=await f.memory.get('fixture-a');expect(v?.currentProjects[0].name).toBe('after-handoff');expect(v?.pendingOperations.length).toBeGreaterThan(0)});
 }finally{f.release.resolve();await f.c.dispose({flush:false});await f.flushing}
},10000);
