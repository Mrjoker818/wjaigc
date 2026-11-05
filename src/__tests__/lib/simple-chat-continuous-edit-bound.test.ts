import { expect,it,vi } from 'vitest';
import { createSimpleChatSyncCoordinator } from '@/lib/simple-chat-sync-client';
import { createMemorySimpleChatEnvelopeStore,jsonResponse,project } from '@/__tests__/fixtures/simple-chat-sync';

it.each(['ack','conflict'] as const)('bounds %s re-persistence under continuing edits and later recovers the newest pending data',async mode=>{
 const memory=createMemorySimpleChatEnvelopeStore();const remote=[project('base')];let edits=0,ids=0,posts=0,reads=0,recover=false,inject=true;
 const store={...memory,put:async(v:Parameters<typeof memory.put>[0])=>{
  if(inject&&v.baseRevision===(mode==='ack'?1:2)&&edits<8){edits++;const current=c.snapshot().projects.map(p=>p.id==='base'?{...p,name:`edit-${edits}`}:p);c.update(current)}
  await memory.put(v);
 }};
 const fetchImpl=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method!=='POST'){reads++;return jsonResponse(200,{success:true,value:reads===1?remote:mode==='ack'?[{...remote[0],name:'first'}]:remote,syncRevision:reads===1?0:mode==='ack'?1:2})}
  posts++;if(!recover)return mode==='ack'&&posts===1?jsonResponse(200,{success:true,syncRevision:1}):posts===1?jsonResponse(409,{success:false,code:'CHAT_SYNC_CONFLICT'}):jsonResponse(503,{success:false});
  return posts===2?jsonResponse(409,{success:false,code:'CHAT_SYNC_CONFLICT'}):jsonResponse(200,{success:true,syncRevision:mode==='ack'?2:3});
 });
 const c=createSimpleChatSyncCoordinator({store,fetchImpl,sleep:async()=>{},createId:()=>`00000000-0000-4000-8000-${String(++ids).padStart(12,'0')}`});
 try{
  await c.initialize('fixture-a');c.update([{...remote[0],name:'first'}]);await c.flush('manual');
  inject=false;
  expect(edits).toBeGreaterThan(1);expect(edits).toBeLessThan(8);
  expect(c.snapshot().projects.find(p=>p.id==='base')?.name).toBe(`edit-${edits}`);expect(c.snapshot().pendingOperations.length).toBeGreaterThan(0);expect(c.snapshot().status).not.toBe('synced');
  await vi.waitFor(async()=>expect((await memory.get('fixture-a'))?.currentProjects.find(p=>p.id==='base')?.name).toBe(`edit-${edits}`));expect((await memory.get('fixture-a'))?.currentProjects.find(p=>p.id==='base')?.name).toBe(`edit-${edits}`);
  recover=true;await c.flush('manual');
  console.log('RECOVERY',mode,JSON.stringify(c.snapshot().projects.map(p=>({id:p.id,name:p.name}))),c.snapshot().status,c.snapshot().pendingOperations.length);
  expect(c.snapshot().projects.find(p=>p.id==='base')?.name).toBe(`edit-${edits}`);expect(c.snapshot().pendingOperations).toHaveLength(0);expect(c.snapshot().status).toBe('synced');
 }finally{inject=false;await c.dispose({flush:false})}
},10000);




it('keeps the latest edit and reports failure if the bounded handoff cannot be written locally',async()=>{
 const memory=createMemorySimpleChatEnvelopeStore();let edits=0,ackWrites=0,ids=0,posts=0;const remote=[project('base')];
 const store={...memory,put:async(v:Parameters<typeof memory.put>[0])=>{
  if(v.baseRevision===1){ackWrites++;if(ackWrites<=4){edits++;c.update(c.snapshot().projects.map(p=>({...p,name:`edit-${edits}`})))}else if(ackWrites===5)throw Error('synthetic handoff failure')}
  await memory.put(v);
 }};
 const fetchImpl=vi.fn(async(_u:RequestInfo|URL,init?:RequestInit)=>init?.method==='POST'?jsonResponse(200,{success:true,syncRevision:++posts}):jsonResponse(200,{success:true,value:remote,syncRevision:0}));
 const c=createSimpleChatSyncCoordinator({store,fetchImpl,createId:()=>`00000000-0000-4000-8000-${String(++ids).padStart(12,'0')}`});
 try{
  await c.initialize('fixture-a');c.update([{...remote[0],name:'first'}]);await c.flush('manual');
  expect(ackWrites).toBe(5);expect(c.snapshot().status).toBe('failed');expect(c.snapshot().projects[0].name).toBe('edit-4');expect(c.snapshot().pendingOperations.length).toBeGreaterThan(0);
  await vi.waitFor(async()=>expect((await memory.get('fixture-a'))?.currentProjects[0].name).toBe('edit-4'));
  expect(posts).toBe(1);expect(c.snapshot().status).toBe('failed');
 }finally{await c.dispose({flush:false})}
},10000);

