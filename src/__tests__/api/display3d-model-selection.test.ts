import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fixture = vi.hoisted(() => ({
  provider: {id:'provider-a',name:'synthetic',isEnabled:true,type:'image',modelType:'image',apiKey:'synthetic-key',baseUrl:'https://provider.invalid/v1',compatProfile:'',selectedModels:['image-one','image-two'],discoveredModels:[] as Array<{id:string;name:string;providerId:string;type:'image'}>,createdAt:1,updatedAt:1},
  otherProvider: false,
  otherSelected: null as string[] | null,
  configError: false,
  user: {id:'synthetic-user',name:'synthetic',role:'admin',status:'active',createdAt:1,updatedAt:1} as null | {id:string;name:string;role:'admin'|'user';status:'active'|'disabled';createdAt:number;updatedAt:number;imageModels?:string[]},
  requests: [] as Array<{base:string;model:string}>,
  pollRequests: [] as Array<{base:string;path:string}>,
  registered: [] as string[],
  updates: [] as Array<{status?:string;error?:string;label?:string;result?:unknown}>,
  upstreamMode: 'success' as 'success' | 'error' | 'throw' | 'polling',
  submitResponseUrl: '',
  remoteId: 'remote/with slash',
  holdPoll: false,
  cancelled: false,
  abortController: null as AbortController | null,
  releasePoll: null as (() => void) | null,
  pollSignal: null as AbortSignal | null,
  pollPending: false,
  released: 0,
  upstreamText: 'reason synthetic-key Bearer secret-token https://example.invalid/?token=another-secret',
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', () => ({getApiProviders: async () => {
  if (fixture.configError) throw new Error('synthetic-private-secret');
  return fixture.otherProvider ? [fixture.provider,{...fixture.provider,id:'provider-b',baseUrl:'https://other.invalid/v1',selectedModels:fixture.otherSelected ?? fixture.provider.selectedModels,discoveredModels:[]}] : [fixture.provider];
}}));
vi.mock('@/lib/api-compatibility', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api-compatibility')>(),
  parseResponseForProfile: (value: {stage?:string}) => value.stage === 'submit'
    ? {mode:'polling',taskIds:[fixture.remoteId],directImageUrls:[]}
    : fixture.pollPending ? {mode:'polling',taskIds:[],directImageUrls:[]} : {mode:'direct',directImageUrls:['/synthetic/image.png']},
}));
vi.mock('@/lib/display3d-prompts', () => ({buildDisplay3DRenderPrompt: () => 'synthetic prompt'}));
vi.mock('@/lib/task-registry', () => ({
  registerTask: (id: string) => {fixture.registered.push(id);},
  waitForQueueSlot: async () => true,
  updateTaskProgress: (_id:string, value:{status?:string;error?:string;label?:string;result?:unknown}) => {fixture.updates.push(value);},
  isTaskCancelled: () => fixture.cancelled,
  getTaskInfo: () => ({status:fixture.cancelled ? 'cancelled' : 'processing'}),
  registerTaskAbortController: (_id:string, controller:AbortController) => {fixture.abortController=controller;},
  unregisterTaskAbortController: () => {},
  releaseQueueSlot: () => {fixture.released++;},
}));
vi.mock('@/lib/api-helpers', () => ({fetchWithV1Retry: async (base:string, path:string, init:RequestInit) => {
  if (init.method !== 'POST') {
    fixture.pollRequests.push({base,path});
    fixture.pollSignal=init.signal ?? null;
    if (fixture.holdPoll) await new Promise<void>(resolve => {fixture.releasePoll=resolve;});
    return {ok:true,json:async () => ({stage:'poll'})};
  }
  const body = JSON.parse(String(init.body)) as {model:string};
  fixture.requests.push({base,model:body.model});
  if (fixture.upstreamMode === 'throw') throw new Error(fixture.upstreamText);
  if (fixture.upstreamMode === 'error') return {ok:false,status:503,text:async () => fixture.upstreamText};
  return {ok:true,url:fixture.submitResponseUrl,json:async () => fixture.upstreamMode === 'polling' ? {stage:'submit'} : {}};
}}));
vi.mock('@/lib/server-auth', () => ({getSessionUser: async () => fixture.user,listManagedUsers: async () => []}));
vi.mock('@/lib/calculate-pixels', () => ({calculateActualPixelsFromRatio: () => '1024x1024'}));
vi.mock('@/lib/api-validator', () => ({validateApiInputs: () => null}));

import { POST } from '@/app/api/display-3d/generate/route';
const request = (body: Record<string,unknown>) => new NextRequest('https://synthetic.invalid/api/display-3d/generate', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({brandName:'synthetic brand',...body})});
beforeEach(() => {fixture.requests=[];fixture.pollRequests=[];fixture.registered=[];fixture.updates=[];fixture.upstreamMode='success';fixture.submitResponseUrl='';fixture.remoteId='remote/with slash';fixture.holdPoll=false;fixture.cancelled=false;fixture.abortController=null;fixture.releasePoll=null;fixture.pollSignal=null;fixture.pollPending=false;fixture.released=0;fixture.upstreamText='reason synthetic-key Bearer secret-token https://example.invalid/?token=another-secret';fixture.otherProvider=false;fixture.otherSelected=null;fixture.configError=false;fixture.provider.baseUrl='https://provider.invalid/v1';fixture.provider.compatProfile='';fixture.provider.selectedModels=['image-one','image-two'];fixture.provider.discoveredModels=[];fixture.user={id:'synthetic-user',name:'synthetic',role:'admin',status:'active',createdAt:1,updatedAt:1};});

describe('display 3D explicit provider and model', () => {
  it('sends the explicitly selected second model to the chosen provider', async () => {
    const result=await POST(request({providerId:'provider-a',model:'image-two'}));
    expect(result.status,JSON.stringify(await result.clone().json())).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toEqual([{base:'https://provider.invalid/v1',model:'image-two'}]));
    expect(fixture.registered).toHaveLength(1);
  });
  it('rejects an explicit model not enabled for the chosen provider before task creation', async () => {
    const result=await POST(request({providerId:'provider-a',model:'not-enabled'}));
    expect(result.status).toBe(403);
    expect(fixture.registered).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
  });
  it('retains the legacy default when no model was supplied', async () => {
    const result=await POST(request({providerId:'provider-a'}));
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toEqual([{base:'https://provider.invalid/v1',model:'image-one'}]));
  });
  it('rejects an unauthenticated user before task creation', async () => {
    fixture.user=null;
    const result=await POST(request({providerId:'provider-a',model:'image-two'}));
    expect(result.status).toBe(401);
    expect(fixture.registered).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
  });
  it('rejects a model not allocated to the current user', async () => {
    fixture.user={id:'synthetic-user',name:'synthetic',role:'user',status:'active',createdAt:1,updatedAt:1,imageModels:['provider-a::image-one']};
    const result=await POST(request({providerId:'provider-a',model:'image-two'}));
    expect(result.status).toBe(403);
    expect(fixture.registered).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
  });
  it('preserves a configured model suffix in the provider request', async () => {
    fixture.provider.selectedModels=['image-one','image-two-4k'];
    const result=await POST(request({providerId:'provider-a',model:'image-two-4k'}));
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toEqual([{base:'https://provider.invalid/v1',model:'image-two-4k'}]));
  });
  it('uses the explicitly selected provider even when another has the same model', async () => {
    fixture.otherProvider=true;
    const result=await POST(request({providerId:'provider-b',model:'image-two'}));
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toEqual([{base:'https://other.invalid/v1',model:'image-two'}]));
  });
  it('supports a discovered model when the administrator has no selected model list', async () => {
    fixture.provider.selectedModels=[];
    fixture.provider.discoveredModels=[{id:'image-two',name:'Image Two',providerId:'provider-a',type:'image'}];
    const result=await POST(request({providerId:'provider-a',model:'image-two'}));
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toEqual([{base:'https://provider.invalid/v1',model:'image-two'}]));
  });
  it('does not fall back to a different provider for an unknown explicit provider', async () => {
    const result=await POST(request({providerId:'missing',model:'image-two'}));
    expect(result.status).toBe(400);
    expect(fixture.requests).toHaveLength(0);
    expect(fixture.registered).toHaveLength(0);
  });
  it('does not create a task for a disabled user', async () => {
    fixture.user={id:'synthetic-user',name:'synthetic',role:'user',status:'disabled',createdAt:1,updatedAt:1};
    const result=await POST(request({providerId:'provider-a',model:'image-two'}));
    expect(result.status).toBe(403);
    expect(fixture.requests).toHaveLength(0);
    expect(fixture.registered).toHaveLength(0);
  });
  it('rejects a profile that would remove the selected model from this generic endpoint', async () => {
    fixture.provider.compatProfile='apimart-midjourney';
    const result=await POST(request({providerId:'provider-a',model:'image-two'}));
    expect(result.status).toBe(400);
    expect(fixture.requests).toHaveLength(0);
    expect(fixture.registered).toHaveLength(0);
  });
  it('rejects a profile that requires a different endpoint before creating a task', async () => {
    fixture.provider.compatProfile='gemini-image';
    fixture.provider.selectedModels=['gemini-2.5-flash-image'];
    const result=await POST(request({providerId:'provider-a',model:'gemini-2.5-flash-image'}));
    expect(result.status).toBe(400);
    expect(fixture.requests).toHaveLength(0);
    expect(fixture.registered).toHaveLength(0);
  });
  it('does not send a model-specific Midjourney request to the generic image endpoint', async () => {
    fixture.provider.baseUrl='https://api.apib.ai/v1';
    fixture.provider.selectedModels=['midjourney'];
    const result=await POST(request({providerId:'provider-a',model:'midjourney'}));
    expect(result.status).toBe(400);
    expect(fixture.requests).toHaveLength(0);
    expect(fixture.registered).toHaveLength(0);
  });
  it('keeps legacy selected-model provider priority ahead of discovered-only providers', async () => {
    fixture.otherProvider=true;
    fixture.otherSelected=['image-two'];
    fixture.provider.selectedModels=[];
    fixture.provider.discoveredModels=[{id:'image-two',name:'Image Two',providerId:'provider-a',type:'image'}];
    const result=await POST(request({model:'image-two'}));
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.requests).toEqual([{base:'https://other.invalid/v1',model:'image-two'}]));
  });
  it('does not expose internal configuration exceptions to the caller', async () => {
    fixture.configError=true;
    const result=await POST(request({providerId:'provider-a',model:'image-two'}));
    expect(result.status).toBe(500);
    expect(JSON.stringify(await result.json())).not.toContain('synthetic-private-secret');
    expect(fixture.requests).toHaveLength(0);
    expect(fixture.registered).toHaveLength(0);
  });
  it.each(['error','throw'] as const)('redacts credentials before storing upstream %s errors in the task', async mode => {
    fixture.upstreamMode=mode;
    const result=await POST(request({providerId:'provider-a',model:'image-two'}));
    expect(result.status).toBe(200);
    await vi.waitFor(() => expect(fixture.updates.some(update => update.status==='failed')).toBe(true));
    const failure=fixture.updates.find(update => update.status==='failed')?.error ?? '';
    expect(failure).not.toContain('synthetic-key');
    expect(failure).not.toContain('secret-token');
    expect(failure).not.toContain('another-secret');
  });
  it.each(['{"authorization":"Basic dXNlcjpwYXNz"}', '{"password":"alpha beta"}', 'encoded %73ynthetic-key', 'https://example.invalid/?X-Amz-Signature=synthetic-signature'])(
    'does not store arbitrary upstream text that might contain encoded credentials: %s', async text => {
      fixture.upstreamMode='error';fixture.upstreamText=text;
      const result=await POST(request({providerId:'provider-a',model:'image-two'}));
      expect(result.status).toBe(200);
      await vi.waitFor(() => expect(fixture.updates.some(update=>update.status==='failed')).toBe(true));
      expect(fixture.updates.find(update=>update.status==='failed')?.error).toBe('API错误: 503');
    },
  );
  it('polls an asynchronous task at the configured provider URL with an encoded task id', async () => {
    vi.useFakeTimers();
    try {
      fixture.provider.baseUrl='https://api.apib.ai/v1';
      fixture.upstreamMode='polling';
      fixture.submitResponseUrl='https://api.apib.ai/v1/images/generations';
      const result=await POST(request({providerId:'provider-a',model:'image-two'}));
      expect(result.status).toBe(200);
      await vi.advanceTimersByTimeAsync(5000);
      expect(fixture.pollRequests).toEqual([{base:'https://api.apib.ai/v1',path:'/tasks/remote%2Fwith%20slash?language=zh'}]);
      expect(fixture.updates.some(update=>update.status==='completed')).toBe(true);
    } finally {vi.clearAllTimers();vi.useRealTimers();}
  });
  it('keeps an unversioned successful provider base when polling', async () => {
    vi.useFakeTimers();
    try {
      fixture.provider.baseUrl='https://provider.invalid';
      fixture.provider.compatProfile='apimart';
      fixture.submitResponseUrl='https://provider.invalid/images/generations';
      fixture.upstreamMode='polling';
      const result=await POST(request({providerId:'provider-a',model:'image-two'}));
      expect(result.status).toBe(200);
      await vi.advanceTimersByTimeAsync(5000);
      expect(fixture.pollRequests).toEqual([{base:'https://provider.invalid',path:'/tasks/remote%2Fwith%20slash?language=zh'}]);
      expect(fixture.updates.some(update=>update.status==='completed')).toBe(true);
    } finally {vi.clearAllTimers();vi.useRealTimers();}
  });
  it('does not send provider credentials to a different origin reported by a response', async () => {
    vi.useFakeTimers();
    try {
      fixture.provider.compatProfile='apimart';
      fixture.submitResponseUrl='https://other.invalid/v1/images/generations';
      fixture.upstreamMode='polling';
      const result=await POST(request({providerId:'provider-a',model:'image-two'}));
      expect(result.status).toBe(200);
      await vi.advanceTimersByTimeAsync(5000);
      expect(fixture.pollRequests).toEqual([{base:'https://provider.invalid/v1',path:'/tasks/remote%2Fwith%20slash?language=zh'}]);
    } finally {vi.clearAllTimers();vi.useRealTimers();}
  });
  it('keeps the legacy query fallback when the selected profile has no poll template', async () => {
    vi.useFakeTimers();
    try {
      fixture.provider.selectedModels=['gpt-image-1'];
      fixture.upstreamMode='polling';
      const result=await POST(request({providerId:'provider-a',model:'gpt-image-1'}));
      expect(result.status).toBe(200);
      await vi.advanceTimersByTimeAsync(5000);
      expect(fixture.pollRequests).toEqual([{base:'https://provider.invalid/v1',path:'/tasks/remote%2Fwith%20slash'}]);
      expect(fixture.updates.some(update=>update.status==='completed')).toBe(true);
    } finally {vi.clearAllTimers();vi.useRealTimers();}
  });
  it.each(['.','..'])('does not poll a path-navigation task id: %s', async remoteId => {
    vi.useFakeTimers();
    try {
      fixture.upstreamMode='polling';fixture.remoteId=remoteId;
      const result=await POST(request({providerId:'provider-a',model:'image-two'}));
      expect(result.status).toBe(200);
      await vi.advanceTimersByTimeAsync(5000);
      expect(fixture.pollRequests).toHaveLength(0);
      expect(fixture.updates.some(update=>update.status==='failed')).toBe(false);
    } finally {vi.clearAllTimers();vi.useRealTimers();}
  });
  it('does not overlap slow status queries', async () => {
    vi.useFakeTimers();
    try {
      fixture.upstreamMode='polling';fixture.holdPoll=true;
      expect((await POST(request({providerId:'provider-a',model:'image-two'}))).status).toBe(200);
      await vi.advanceTimersByTimeAsync(5000);
      expect(fixture.pollRequests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(20000);
      expect(fixture.pollRequests).toHaveLength(1);
      fixture.releasePoll?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.updates.some(update=>update.status==='completed')).toBe(true);
    } finally {fixture.releasePoll?.();vi.clearAllTimers();vi.useRealTimers();}
  });
  it('stops an in-flight query after cancellation and ignores its late success', async () => {
    vi.useFakeTimers();
    try {
      fixture.upstreamMode='polling';fixture.holdPoll=true;
      expect((await POST(request({providerId:'provider-a',model:'image-two'}))).status).toBe(200);
      await vi.advanceTimersByTimeAsync(5000);
      expect(fixture.abortController).not.toBeNull();
      fixture.cancelled=true;fixture.abortController?.abort();
      expect(fixture.pollSignal?.aborted).toBe(true);
      fixture.releasePoll?.();
      await vi.advanceTimersByTimeAsync(20000);
      expect(fixture.pollRequests).toHaveLength(1);
      expect(fixture.updates.some(update=>update.status==='completed')).toBe(false);
    } finally {fixture.releasePoll?.();vi.clearAllTimers();vi.useRealTimers();}
  });
  it('leaves a polling timeout unconfirmed and releases its local queue slot', async () => {
    vi.useFakeTimers();
    try {
      fixture.upstreamMode='polling';fixture.pollPending=true;
      expect((await POST(request({providerId:'provider-a',model:'image-two'}))).status).toBe(200);
      await vi.advanceTimersByTimeAsync(305000);
      expect(fixture.updates.some(update=>update.status==='failed')).toBe(false);
      expect(fixture.updates.some(update=>update.status==='processing' && update.label?.includes('核实'))).toBe(true);
      expect(fixture.updates.some(update=>update.status==='processing' && (update.result as {display3dOutcomeUnconfirmed?:boolean} | undefined)?.display3dOutcomeUnconfirmed === true)).toBe(true);
      expect(fixture.released).toBe(1);
      expect(fixture.pollRequests).toHaveLength(60);
    } finally {vi.clearAllTimers();vi.useRealTimers();}
  });
  it('bounds a hung status query and ignores its late success', async () => {
    vi.useFakeTimers();
    try {
      fixture.upstreamMode='polling';fixture.holdPoll=true;
      expect((await POST(request({providerId:'provider-a',model:'image-two'}))).status).toBe(200);
      await vi.advanceTimersByTimeAsync(305000);
      expect(fixture.pollRequests).toHaveLength(1);
      expect(fixture.pollSignal?.aborted).toBe(true);
      expect(fixture.updates.some(update=>update.status==='processing' && update.label?.includes('核实'))).toBe(true);
      expect(fixture.updates.some(update=>update.status==='failed')).toBe(false);
      expect(fixture.released).toBe(1);
      fixture.releasePoll?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.updates.some(update=>update.status==='completed')).toBe(false);
    } finally {fixture.releasePoll?.();vi.clearAllTimers();vi.useRealTimers();}
  });
});
