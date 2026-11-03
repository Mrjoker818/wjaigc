import { expect, it, vi } from 'vitest';
import { createSimpleChatSyncCoordinator } from '@/lib/simple-chat-sync-client';
import { createMemorySimpleChatEnvelopeStore, deferred, jsonResponse, project } from '@/__tests__/fixtures/simple-chat-sync';

it('preserves the last edit when it arrives during the second acknowledgement persistence', async () => {
  const memory = createMemorySimpleChatEnvelopeStore();
  const firstStart = deferred<void>(), firstRelease = deferred<void>();
  const secondStart = deferred<void>(), secondRelease = deferred<void>();
  let acknowledgements = 0;
  const store = { ...memory, put: async (value: Parameters<typeof memory.put>[0]) => {
    if (value.baseRevision === 1) {
      acknowledgements++;
      if (acknowledgements === 1) { firstStart.resolve(); await firstRelease.promise; }
      if (acknowledgements === 2) { secondStart.resolve(); await secondRelease.promise; }
    }
    await memory.put(value);
  }};
  let nextId = 0;
  const post = deferred<Response>();
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST'
    ? post.promise : jsonResponse(200, {success:true, principalId:'fixture-a',value:[],syncRevision:0}));
  const coordinator = createSimpleChatSyncCoordinator({store,fetchImpl,createId:()=>`00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`});
  try {
    await coordinator.initialize('fixture-a');
    coordinator.update([project('first')]);
    const flush = coordinator.flush('manual');
    await vi.waitFor(()=>expect(fetchImpl.mock.calls.some(([,init])=>init?.method==='POST')).toBe(true));
    post.resolve(jsonResponse(200,{success:true,principalId:'fixture-a',syncRevision:1}));
    await firstStart.promise;
    coordinator.update([project('first'),project('second')]);
    firstRelease.resolve();
    await secondStart.promise;
    coordinator.update([project('first'),project('second'),project('third')]);
    secondRelease.resolve();
    await flush;
    expect(coordinator.snapshot().projects.map(p=>p.id)).toEqual(['first','second','third']);
    expect(coordinator.snapshot().pendingOperations.length).toBeGreaterThan(0);
    await vi.waitFor(async () => expect((await memory.get('fixture-a'))?.currentProjects.map(p=>p.id)).toEqual(['first','second','third']));
    const stored = await memory.get('fixture-a');
    expect(stored?.currentProjects.map(p=>p.id)).toEqual(['first','second','third']);
    expect(stored?.baseRevision).toBe(1);
    expect(stored?.pendingOperations.length).toBeGreaterThan(0);
  } finally { firstRelease.resolve();secondRelease.resolve();post.resolve(jsonResponse(503,{}));await coordinator.dispose({flush:false}); }
}, 10000);


it('retains later edits and pending operations when the second acknowledgement write fails', async () => {
  const memory = createMemorySimpleChatEnvelopeStore();
  const firstStart=deferred<void>(),firstRelease=deferred<void>(),secondStart=deferred<void>(),secondRelease=deferred<void>();
  let acknowledgements=0,nextId=0;
  const store={...memory,put:async(value:Parameters<typeof memory.put>[0])=>{
    if(value.baseRevision===1){acknowledgements++;if(acknowledgements===1){firstStart.resolve();await firstRelease.promise}if(acknowledgements===2){secondStart.resolve();await secondRelease.promise;throw Error('synthetic local write failure')}}
    await memory.put(value);
  }};
  const post=deferred<Response>();
  const fetchImpl=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>init?.method==='POST'?post.promise:jsonResponse(200,{success:true,principalId:'fixture-a',value:[],syncRevision:0}));
  const c=createSimpleChatSyncCoordinator({store,fetchImpl,createId:()=>`00000000-0000-4000-8000-${String(++nextId).padStart(12,'0')}`});
  try{
    await c.initialize('fixture-a');c.update([project('first')]);const flushing=c.flush('manual');
    await vi.waitFor(()=>expect(fetchImpl.mock.calls.some(([,init])=>init?.method==='POST')).toBe(true));
    post.resolve(jsonResponse(200,{success:true,principalId:'fixture-a',syncRevision:1}));await firstStart.promise;
    c.update([project('first'),project('second')]);firstRelease.resolve();await secondStart.promise;
    c.update([project('first'),project('second'),project('third')]);secondRelease.resolve();await flushing;
    expect(c.snapshot().status).toBe('failed');expect(c.snapshot().projects.map(p=>p.id)).toEqual(['first','second','third']);
    await vi.waitFor(async()=>expect((await memory.get('fixture-a'))?.currentProjects.map(p=>p.id)).toEqual(['first','second','third']));
    const saved=await memory.get('fixture-a');expect(saved?.currentProjects.map(p=>p.id)).toEqual(['first','second','third']);
    expect(saved?.baseRevision).toBe(0);expect(saved?.pendingOperations.length).toBeGreaterThan(0);
  }finally{firstRelease.resolve();secondRelease.resolve();post.resolve(jsonResponse(503,{}));await c.dispose({flush:false})}
},10000);

it('disposal during a second acknowledgement write preserves the latest queued edit', async () => {
  const memory=createMemorySimpleChatEnvelopeStore();
  const firstStart=deferred<void>(),firstRelease=deferred<void>(),secondStart=deferred<void>(),secondRelease=deferred<void>();
  let writes=0,nextId=0;
  const store={...memory,put:async(value:Parameters<typeof memory.put>[0])=>{
    if(value.baseRevision===1){writes++;if(writes===1){firstStart.resolve();await firstRelease.promise}if(writes===2){secondStart.resolve();await secondRelease.promise}}
    await memory.put(value);
  }};
  const post=deferred<Response>();
  const fetchImpl=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>init?.method==='POST'?post.promise:jsonResponse(200,{success:true,principalId:'fixture-a',value:[],syncRevision:0}));
  const c=createSimpleChatSyncCoordinator({store,fetchImpl,createId:()=>`00000000-0000-4000-8000-${String(++nextId).padStart(12,'0')}`});
  try{
    await c.initialize('fixture-a');c.update([project('first')]);const flushing=c.flush('manual');
    await vi.waitFor(()=>expect(fetchImpl.mock.calls.some(([,init])=>init?.method==='POST')).toBe(true));
    post.resolve(jsonResponse(200,{success:true,principalId:'fixture-a',syncRevision:1}));await firstStart.promise;
    c.update([project('first'),project('second')]);firstRelease.resolve();await secondStart.promise;
    c.update([project('first'),project('second'),project('third')]);await c.dispose({flush:false});secondRelease.resolve();await flushing;
    await vi.waitFor(async()=>{const saved=await memory.get('fixture-a');expect(saved?.currentProjects.map(p=>p.id)).toEqual(['first','second','third']);expect(saved?.pendingOperations.length).toBeGreaterThan(0)});
    expect(fetchImpl.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
  }finally{firstRelease.resolve();secondRelease.resolve();post.resolve(jsonResponse(503,{}));await c.dispose({flush:false})}
},10000);
