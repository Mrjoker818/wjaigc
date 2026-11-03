import { expect,it,vi } from 'vitest';
import { createSimpleChatSyncCoordinator } from '@/lib/simple-chat-sync-client';
import { createMemorySimpleChatEnvelopeStore,deferred,jsonResponse,project } from '@/__tests__/fixtures/simple-chat-sync';

it('does not mark an empty frozen batch synced when an edit arrives while local persistence waits',async()=>{
 const memory=createMemorySimpleChatEnvelopeStore(),started=deferred<void>(),release=deferred<void>();let hold=false,id=0,posts=0;
 const store={...memory,put:async(v:Parameters<typeof memory.put>[0])=>{if(hold){hold=false;started.resolve();await release.promise}await memory.put(v)}};
 const fetchImpl=vi.fn(async(_u:RequestInfo|URL,init?:RequestInit)=>{if(init?.method==='POST'){posts++;return jsonResponse(200,{success:true,syncRevision:1})}return jsonResponse(200,{success:true,value:[],syncRevision:0})});
 const c=createSimpleChatSyncCoordinator({store,fetchImpl,createId:()=>`00000000-0000-4000-8000-${String(++id).padStart(12,'0')}`});
 try{
  await c.initialize('fixture-a');hold=true;c.update([]);await started.promise;const flushing=c.flush('manual');c.update([project('new-edit')]);release.resolve();await flushing;
  expect(c.snapshot().projects.map(p=>p.id)).toEqual(['new-edit']);expect(c.snapshot().pendingOperations.length).toBeGreaterThan(0);expect(c.snapshot().status).toBe('syncing');expect(posts).toBe(0);
  await vi.waitFor(async()=>expect((await memory.get('fixture-a'))?.currentProjects.map(p=>p.id)).toEqual(['new-edit']));
  await c.flush('manual');expect(posts).toBe(1);expect(c.snapshot().pendingOperations).toHaveLength(0);expect(c.snapshot().status).toBe('synced');
 }finally{release.resolve();await c.dispose({flush:false})}
},10000);

