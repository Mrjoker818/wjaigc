// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, expect, it, vi , beforeAll, afterAll} from 'vitest';
let createConnection: typeof import('@/lib/workflow-engine').createConnection;
let createWorkflowNode: typeof import('@/lib/workflow-engine').createWorkflowNode;
let parseComfyUIWorkflow: typeof import('@/lib/workflow-engine').parseComfyUIWorkflow;
import { createMultiPlatformExportSkill } from '@/lib/skill-runtime/multi-platform-export-preset';
import { createWorkflowFromPreset, WORKFLOW_PRESETS } from '@/lib/workflow-presets';
const mocks=vi.hoisted(()=>({create:vi.fn(async(..._args:unknown[])=>undefined),update:vi.fn(async(..._args:unknown[])=>true),get:vi.fn(async(..._args:unknown[])=>null),skills:vi.fn(async()=>[] as unknown[]),auth:vi.fn(async()=>({userId:'actor',userRole:'user',user:{productType:'all'}}) as unknown),image:vi.fn(async()=>({imageUrl:'data:image/png;base64,U1lOVEhFVElD',_type:'input-image'})),claim:vi.fn(async(..._args:unknown[]):Promise<unknown>=>null),release:vi.fn(async(..._args:unknown[])=>false)}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/workflow-background',()=>({observeWorkflowBackground:<T>(p:Promise<T>)=>workers.observe(p)}));
vi.mock('@/lib/db-client',()=>({execSql:vi.fn(async()=>{boundary.violations.push('DB');throw Error('DB_FORBIDDEN');}),getPool:vi.fn(()=>{boundary.violations.push('DB');throw Error('DB_FORBIDDEN');})}));
vi.mock('@/lib/api-auth',()=>({requireApiAuthOrReject:mocks.auth,getInternalRequestHeaders:vi.fn(()=>({}))}));
vi.mock('@/lib/cloud-task-storage',()=>({createCloudTask:mocks.create,updateCloudTask:mocks.update,getCloudTaskForUser:async(...args:unknown[])=>workers.read(String(args[0]),await mocks.get(...args)),claimCloudTaskLease:async(...args:unknown[])=>workers.claim(await mocks.claim(...args)),renewCloudTaskLease:vi.fn(async()=>false),releaseCloudTaskLease:async(...args:unknown[])=>workers.release(String(args[0]),String(args[1]),await mocks.release(...args))}));
vi.mock('@/lib/op-log',()=>({logError:vi.fn(),OP_ACTIONS:{WORKFLOW_EXECUTE:'workflow'}}));
vi.mock('@/lib/server-api-config',()=>({findProviderForModel:vi.fn(async()=>null),findProviderForFeature:vi.fn(async()=>null),findProviderById:vi.fn(async()=>null)}));
vi.mock('@/lib/skill-runtime/storage',()=>({loadUserSkillCatalog:mocks.skills}));
vi.mock('@/lib/asset-core/storage',()=>({createPostgresAssetStorage:vi.fn(()=>{boundary.violations.push('ASSET_STORAGE');throw Error('ASSET_STORAGE_FORBIDDEN');})}));
vi.mock('@/lib/asset-core/workflow-resolver',()=>({resolveWorkflowInputImageForActor:mocks.image}));
import {installWorkflowOfflineGuard,isSyntheticSaveRequest,trackWorkflowWorkers} from '@/__tests__/helpers/workflow-offline-guard';
const boundary=vi.hoisted(()=>({violations:[] as string[]}));
vi.mock('@/lib/server-data-root',()=>{const deny=()=>{boundary.violations.push('DATA_ROOT');throw Error('WORKFLOW_TEST_DATA_ROOT_FORBIDDEN');};return {getServerDataRoot:deny,getServerSystemDir:deny,getServerUsersDir:deny,isServerDataRootDurable:deny,saveImageFile:deny,deleteImageFile:deny};});
vi.mock('pg',()=>{boundary.violations.push('PG');throw Error('WORKFLOW_TEST_PG_FORBIDDEN');});
vi.mock('@/lib/server-auth',()=>({listManagedUsers:()=>{boundary.violations.push('AUTH_STORAGE');throw Error('WORKFLOW_TEST_AUTH_STORAGE_FORBIDDEN');}}));
let offline: ReturnType<typeof installWorkflowOfflineGuard>;
let workers: ReturnType<typeof trackWorkflowWorkers>;
let POST: typeof import('@/app/api/workflow/execute/route').POST;
beforeAll(async()=>{offline=installWorkflowOfflineGuard();workers=trackWorkflowWorkers();const engine=await import('@/lib/workflow-engine');createConnection=engine.createConnection;createWorkflowNode=engine.createWorkflowNode;parseComfyUIWorkflow=engine.parseComfyUIWorkflow;POST=workers.wrap((await import('@/app/api/workflow/execute/route')).POST);});
afterAll(async()=>{if(!workers)return;await workers.drain();workers.restore();offline.restore();});
afterEach(async()=>{await workers.drain();vi.unstubAllGlobals();vi.unstubAllEnvs();expect([...offline.violations,...boundary.violations]).toEqual([]);},7000);

beforeEach(()=>{offline.verify();vi.stubEnv('DEPLOY_RUN_PORT','5000');vi.clearAllMocks();mocks.create.mockResolvedValue(undefined);mocks.update.mockResolvedValue(true);mocks.skills.mockResolvedValue([]);mocks.get.mockResolvedValue(null);mocks.claim.mockReset().mockResolvedValue(null);mocks.release.mockReset().mockResolvedValue(false);mocks.auth.mockResolvedValue({userId:'actor',userRole:'user',user:{productType:'all'}});});
function request(body:Record<string,unknown>){return new NextRequest('http://synthetic.invalid/api/workflow/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
function image(){const n=createWorkflowNode('input-image',0,0);n.id='source';n.config={...n.config,source:'url',imageUrl:'data:image/png;base64,U1lOVEhFVElD'};return n;}
async function start(nodes:ReturnType<typeof createWorkflowNode>[],connections:ReturnType<typeof createConnection>[],extra:Record<string,unknown>={}){return POST(request({action:'start',projectId:'synthetic-project',workflowId:'synthetic-workflow',nodes,connections,...extra}));}
async function terminal(executionId:string){let result:Record<string,unknown>|undefined;await vi.waitFor(async()=>{result=await (await POST(request({action:'status',executionId}))).json();expect(['completed','failed']).toContain(result?.status)},{timeout:3000,interval:25});return result!;}

it('executes the advertising preset with one synthetic chat response, seven ordered clips, and one narration', async () => {
  const preset = WORKFLOW_PRESETS.find(candidate => candidate.id === 'ecom-video-storyboard')!;
  const workflow = createWorkflowFromPreset(preset);
  const scenes = Array.from({ length: 7 }, (_, index) => ({
    prompt: `Product scene ${index + 1}`,
    narration: `Narration ${index + 1}`,
  }));
  const clips = scenes.map((_, index) => `/api/serve-upload/clip-${index + 1}.mp4`);
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin === 'http://localhost:5000' && !url.search && !url.hash && init?.method === 'POST'
      && typeof init.body === 'string') {
      const body = JSON.parse(init.body);
      requests.push({ path: url.pathname, body });
      switch (url.pathname) {
        case '/api/chat':
          return Response.json({ choices: [{ message: { content: JSON.stringify({ scenes }) } }] });
        case '/api/video/generate': {
          const index = scenes.findIndex(scene => scene.prompt === body.prompt);
          if (index >= 0) return Response.json({ success: true, videoUrl: clips[index] });
          break;
        }
        case '/api/audio/generate':
          return Response.json({ success: true, audioUrl: '/api/serve-upload/narration.mp3' });
        case '/api/video/tools':
          if (body.action === 'concat-videos') return Response.json({ success: true, videoUrl: '/api/serve-upload/concat.mp4' });
          if (body.action === 'add-audio') return Response.json({ success: true, videoUrl: '/api/serve-upload/ad.mp4' });
      }
    }
    boundary.violations.push('UNEXPECTED_FETCH');
    throw Error('UNEXPECTED_FETCH');
  });

  const response = await start(workflow.nodes, workflow.connections);
  const started = await response.json();
  expect(response.status, JSON.stringify(started)).toBe(200);
  const { executionId } = started;
  const result = await terminal(executionId);
  expect(result.status).toBe('completed');
  expect(requests.filter(call => call.path === '/api/chat')).toHaveLength(1);
  expect(requests.filter(call => call.path === '/api/video/generate').map(call => call.body.prompt))
    .toEqual(scenes.map(scene => scene.prompt));
  expect(requests.filter(call => call.path === '/api/audio/generate').map(call => call.body.text))
    .toEqual([scenes.map(scene => scene.narration).join('\n')]);
  expect(requests.filter(call => call.path === '/api/video/tools').map(call => call.body)).toEqual([
    { action: 'concat-videos', videoUrls: clips },
    { action: 'add-audio', videoUrl: '/api/serve-upload/concat.mp4', audioUrl: '/api/serve-upload/narration.mp3', volume: 1 },
  ]);
  const finalNode = workflow.nodes.find(node => node.type === 'output-video')!;
  expect(result.results).toMatchObject({
    [finalNode.id]: { status: 'success', output: { videoUrl: '/api/serve-upload/ad.mp4' } },
  });
});

it('rejects an invalid storyboard selector before creating an execution', async () => {
  const preset = WORKFLOW_PRESETS.find(candidate => candidate.id === 'ecom-video-storyboard')!;
  const workflow = createWorkflowFromPreset(preset);
  const firstScene = workflow.nodes.find(node => node.type === 'ai-video-generate')!;
  firstScene.config.storyboardPart = 8;
  const response = await start(workflow.nodes, workflow.connections);
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ code: 'WORKFLOW_EXECUTION_GRAPH_UNSAFE' });
  expect(mocks.create).not.toHaveBeenCalled();
});

it('LIFECYCLE drain waits for final persistence after terminal status',async()=>{
 let release!:()=>void;let entered=false;let finished=false;const gate=new Promise<void>(resolve=>{release=resolve;});
 mocks.update.mockImplementation(async(...args:unknown[])=>{const payload=args[1] as {result?:{workflowStatus?:string}}|undefined;if(payload?.result?.workflowStatus==='completed'){entered=true;await gate;finished=true;}return true;});
 try{const a=image(),b=createWorkflowNode('output-image',0,0);b.id='target';const e={...createConnection(a.id,'out-image',b.id,'in-image','image'),id:'normal'};const response=await start([a,b],[e]);expect(response.status).toBe(200);const {executionId}=await response.json();const result=await terminal(executionId);await vi.waitFor(()=>expect(entered).toBe(true));expect(result.status).toBe('completed');expect(finished).toBe(false);expect(workers.pending).toBeGreaterThan(0);let drained=false;const waiting=workers.drain().then(()=>{drained=true;});await Promise.resolve();expect(drained).toBe(false);offline.verify();release();await waiting;expect(finished).toBe(true);expect(workers.pending).toBe(0);console.log('LIFECYCLE_DRAINED',JSON.stringify({finished,drained}));}finally{release();}
});
it('LIFECYCLE assertion failure propagates only after persistence drains',async()=>{
 let release!:()=>void;let entered=false;let finished=false;const gate=new Promise<void>(resolve=>{release=resolve;});
 mocks.update.mockImplementation(async(...args:unknown[])=>{const payload=args[1] as {result?:{workflowStatus?:string}}|undefined;if(payload?.result?.workflowStatus==='completed'){entered=true;await gate;finished=true;}return true;});
 const body=async()=>{const a=image(),b=createWorkflowNode('output-image',0,0);b.id='target';const e={...createConnection(a.id,'out-image',b.id,'in-image','image'),id:'normal'};const response=await start([a,b],[e]);const {executionId}=await response.json();await terminal(executionId);throw Error('EXPECTED_ASSERTION_FAILURE');};
 let settled=false;const outcome=(async()=>{try{await body();}finally{await workers.drain();}})().then(()=>{settled=true;return null;},error=>{settled=true;return error;});
 try{await vi.waitFor(()=>expect(entered).toBe(true));await Promise.resolve();expect(settled).toBe(false);offline.verify();release();const failure=await outcome;expect(failure).toBeInstanceOf(Error);expect((failure as Error).message).toBe('EXPECTED_ASSERTION_FAILURE');expect(finished).toBe(true);expect(workers.pending).toBe(0);}finally{release();}
});
it('LIFECYCLE drain tracks a start request before its background worker exists',async()=>{
 let release!:()=>void;let entered=false;const gate=new Promise<void>(resolve=>{release=resolve;});mocks.create.mockImplementation(async()=>{entered=true;await gate;return undefined;});
 try{const a=image(),b=createWorkflowNode('output-image',0,0);b.id='target';const e={...createConnection(a.id,'out-image',b.id,'in-image','image'),id:'normal'};const before=workers.registered;const starting=start([a,b],[e]);await vi.waitFor(()=>expect(entered).toBe(true));expect(workers.requests).toBeGreaterThan(0);expect(workers.registered).toBe(before);let drained=false;const waiting=workers.drain().then(()=>{drained=true;});await Promise.resolve();expect(drained).toBe(false);offline.verify();release();const response=await starting;expect(response.status).toBe(200);const {executionId}=await response.json();expect((await terminal(executionId)).status).toBe('completed');await waiting;expect(workers.requests).toBe(0);expect(workers.pending).toBe(0);}finally{release();}
});
it('portable fixture enforces its own network, database and data-root boundaries',async()=>{
 offline.verify();
 const net=await import('node:net');expect(()=>net.default.connect(9,'127.0.0.1')).toThrow('WORKFLOW_TEST_NETWORK_FORBIDDEN');
 expect(()=>fetch('https://synthetic.invalid/')).toThrow('WORKFLOW_TEST_FETCH_FORBIDDEN');
 const fs=await import('node:fs');expect(()=>fs.default.writeFileSync('never-created-fixture','x')).toThrow('WORKFLOW_TEST_FILESYSTEM_FORBIDDEN');
 const child=await import('node:child_process');expect(()=>child.default.spawn('never-started')).toThrow('WORKFLOW_TEST_PROCESS_FORBIDDEN');
 const db=await import('@/lib/db-client');await expect(db.execSql('SELECT 1')).rejects.toThrow('DB_FORBIDDEN');
 const root=await import('@/lib/server-data-root');expect(()=>root.getServerDataRoot()).toThrow('WORKFLOW_TEST_DATA_ROOT_FORBIDDEN');
 expect(offline.violations).toEqual(['NETWORK','FETCH','FILESYSTEM','PROCESS']);expect(boundary.violations).toEqual(['DB','DATA_ROOT']);
 offline.violations.length=0;boundary.violations.length=0;
});
it('synthetic save accepts only the expected origin, path, method and headers',()=>{
 expect(isSyntheticSaveRequest('http://localhost:5000/api/save-image',{method:'POST'})).toBe(true);
 expect(isSyntheticSaveRequest('https://other.invalid/api/save-image',{method:'POST'})).toBe(false);
 expect(isSyntheticSaveRequest('http://localhost:5000/api/save-image',{method:'GET'})).toBe(false);
 expect(isSyntheticSaveRequest('http://localhost:5000/api/save-image?x=1',{method:'POST'})).toBe(false);
 expect(isSyntheticSaveRequest('http://localhost:5000/api/save-image',{method:'POST',headers:{authorization:'test'}})).toBe(false);
});
it.each([401,403])('PREFLIGHT honors authentication rejection %s before side effects',async status=>{
 mocks.auth.mockResolvedValue(NextResponse.json({error:'synthetic authorization denied'},{status}));
 const a=image(),b=createWorkflowNode('output-image',0,0);b.id='target';const edge={...createConnection(a.id,'out-image',b.id,'missing','image'),id:'invalid'};
 const response=await start([a,b],[edge]);expect(response.status).toBe(status);expect(mocks.create).not.toHaveBeenCalled();expect(mocks.image).not.toHaveBeenCalled();expect(mocks.skills).not.toHaveBeenCalled();
});
it.each(['target','source','type'] as const)('PREFLIGHT static %s mismatch rejects before task or source',async mode=>{
 const a=image(),b=createWorkflowNode('output-image',0,0);b.id='target';if(mode==='type')b.ports=[...b.ports,{id:'in-prompt',label:'prompt',type:'prompt',direction:'in'}];
 const e={...createConnection('source',mode==='source'?'missing':'out-image','target',mode==='target'?'missing':mode==='type'?'in-prompt':'in-image','image'),id:'invalid-edge'};
 const response=await start([a,b],[e]);const body=await response.json();console.log('STATIC',JSON.stringify({mode,status:response.status,body,creates:mocks.create.mock.calls.length,image:mocks.image.mock.calls.length}));
 expect(response.status).toBe(422);expect(JSON.stringify(body)).toContain('invalid-edge');expect(mocks.create).not.toHaveBeenCalled();expect(mocks.image).not.toHaveBeenCalled();
});
it('PREFLIGHT skill port comes from the actor catalog rather than client ports',async()=>{
 const skill=createMultiPlatformExportSkill(true);mocks.skills.mockResolvedValue([skill]);const a=image();a.config={...a.config,imageUrl:'/api/serve-upload/synthetic.png'};const b=createWorkflowNode('ai-skill',0,0);b.id='skill';b.ports=[...b.ports,{id:'in-start-frame',label:'forged',type:'image',direction:'in'}];b.config={...b.config,skillId:skill.id,version:skill.version,inputValues:{},modelBindings:{}};const e={...createConnection(a.id,'out-image',b.id,'in-start-frame','image'),id:'forged-skill-edge'};
 const response=await start([a,b],[e]);const payload=await response.json();console.log('SKILL_AUTHORITY',JSON.stringify({status:response.status,payload,lookups:mocks.skills.mock.calls.length}));expect(response.status).toBe(422);expect(JSON.stringify(payload)).toContain('forged-skill-edge');expect(mocks.skills).toHaveBeenCalledWith('actor','workflow');expect(mocks.create).not.toHaveBeenCalled();expect(mocks.image).not.toHaveBeenCalled();
});
it('PREFLIGHT inactive conditional edge remains nonblocking',async()=>{
 const c=createWorkflowNode('condition-if',0,0);c.id='condition';c.config={...c.config,condition:'false'};const b=createWorkflowNode('output-image',0,0);b.id='target';const e={...createConnection(c.id,'out-true',b.id,'missing','condition'),id:'branch'};
 const response=await start([c,b],[e]);expect(response.status).toBe(200);const {executionId}=await response.json();const result=await terminal(executionId);expect((result.results as Record<string,{status:string}>).target.status).toBe('skipped');
});
it('PREFLIGHT ordinary upstream output can deactivate another incoming edge',async()=>{
 const a=image(),x=createWorkflowNode('input-text',0,0),b=createWorkflowNode('output-image',0,0);x.id='control-like';x.config={...x.config,text:'test',activePorts:['out-data']};b.id='target';
 const edges=[{...createConnection(a.id,'out-image',b.id,'missing','image'),id:'bad-inactive'}, {...createConnection(x.id,'out-prompt',b.id,'in-image','prompt'),id:'inactive-control'}];
 const response=await start([a,x,b],edges);const payload=await response.json();console.log('ARBITRARY_ACTIVE_PORTS',JSON.stringify({status:response.status,payload}));expect(response.status).toBe(200);const result=await terminal(payload.executionId);expect((result.results as Record<string,{status:string}>).target.status).toBe('skipped');
});
it('PREFLIGHT selected parallel batch validates both branches before any branch fetch',async()=>{
 const c=createWorkflowNode('parallel',0,0);c.id='parallel';c.config={...c.config,channels:2};const a=createWorkflowNode('output-save',0,0);a.id='first';a.ports=[...a.ports,{id:'in-data',label:'data',direction:'in',type:'any'}];const b=createWorkflowNode('output-save',0,0);b.id='second';b.ports=[...b.ports,{id:'in-data',label:'data',direction:'in',type:'any'}];
 const edges=[{...createConnection(c.id,'out-1',a.id,'in-data','any'),id:'good'},{...createConnection(c.id,'out-2',b.id,'missing','any'),id:'bad'}];
 const call=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{if(!isSyntheticSaveRequest(input,init)){boundary.violations.push('UNEXPECTED_FETCH');throw Error('UNEXPECTED_FETCH');}return Response.json({success:true,url:'synthetic'});});vi.stubGlobal('fetch',call);
 const response=await start([c,a,b],edges);expect(response.status).toBe(200);const {executionId}=await response.json();const result=await terminal(executionId);console.log('PARALLEL_BATCH',JSON.stringify({status:result.status,calls:call.mock.calls.length}));expect(result.status).toBe('failed');expect(call).not.toHaveBeenCalled();
});
it('PREFLIGHT valid parallel batch still dispatches both branches',async()=>{
 const c=createWorkflowNode('parallel',0,0);c.id='parallel';c.config={...c.config,channels:2};const a=createWorkflowNode('output-save',0,0);a.id='first';a.ports=[...a.ports,{id:'in-data',label:'data',direction:'in',type:'any'}];const b=createWorkflowNode('output-save',0,0);b.id='second';b.ports=[...b.ports,{id:'in-data',label:'data',direction:'in',type:'any'}];
 const edges=[{...createConnection(c.id,'out-1',a.id,'in-data','any'),id:'one'},{...createConnection(c.id,'out-2',b.id,'in-data','any'),id:'two'}];
 const call=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{if(!isSyntheticSaveRequest(input,init)){boundary.violations.push('UNEXPECTED_FETCH');throw Error('UNEXPECTED_FETCH');}return Response.json({success:true,url:'synthetic'});});vi.stubGlobal('fetch',call);
 const response=await start([c,a,b],edges);expect(response.status).toBe(200);const {executionId}=await response.json();const result=await terminal(executionId);console.log('PARALLEL_POSITIVE',JSON.stringify({status:result.status,calls:call.mock.calls.length}));expect(result.status).toBe('completed');expect(call.mock.calls.length).toBeGreaterThanOrEqual(2);
});
it('PREFLIGHT dynamic active mismatch still fails on retry',async()=>{
 const c=createWorkflowNode('condition-if',0,0);c.id='condition';c.config={...c.config,condition:'false'};const b=createWorkflowNode('output-image',0,0);b.id='target';const e={...createConnection(c.id,'out-false',b.id,'missing','condition'),id:'dynamic-retry'};
 const response=await start([c,b],[e]);expect(response.status).toBe(200);const {executionId}=await response.json();const result=await terminal(executionId);expect((result.results as Record<string,{status:string}>).target.status).toBe('failed');
 const retry=await POST(request({action:'retry',executionId,nodeId:b.id,nodes:[c,b],connections:[e]}));const body=await retry.json();expect(body.success).toBe(false);expect(body.error).toContain('dynamic-retry');
});
it.each(['source','target','type'] as const)('OLD-SAFETY dynamic %s mismatch rejects consumption after prior success',async mode=>{
 const a=image(),control=createWorkflowNode('input-text',0,0),b=createWorkflowNode('output-image',0,0);control.id='control';control.config={...control.config,text:'synthetic',activePorts:['out-data']};b.id='target';b.ports=[...b.ports,{id:'in-data',label:'data',type:'any',direction:'in'},{id:'in-prompt',label:'prompt',type:'prompt',direction:'in'}];
 const bad={...createConnection(a.id,mode==='source'?'missing':'out-image',b.id,mode==='target'?'missing':mode==='type'?'in-prompt':'in-image','image'),id:'old-safety-edge'};
 const marker={...createConnection(control.id,'out-data',b.id,'in-data','data'),id:'active-marker'};const edges=[bad,marker];
 const response=await start([a,control,b],edges);expect(response.status).toBe(200);const {executionId}=await response.json();const result=await terminal(executionId);const results=result.results as Record<string,{status:string;error?:string;output?:{imageUrl?:string}}>;
 console.log('OLD_SAFETY_DYNAMIC',JSON.stringify({mode,workflow:result.status,source:results.source?.status,target:results.target?.status,creates:mocks.create.mock.calls.length,image:mocks.image.mock.calls.length}));
 expect(result.status).toBe('failed');expect(results.source.status).toBe('success');expect(results.target.status).toBe('failed');expect(results.target.error).toContain('old-safety-edge');expect(results.target.output?.imageUrl).toBeUndefined();expect(mocks.create).toHaveBeenCalledOnce();expect(mocks.image).toHaveBeenCalledOnce();
 if(mode==='target'){const retry=await POST(request({action:'retry',executionId,nodeId:b.id,nodes:[a,control,b],connections:edges}));const data=await retry.json();expect(data.success).toBe(false);expect(data.error).toContain('old-safety-edge');expect(data.output?.imageUrl).toBeUndefined();expect(mocks.image).toHaveBeenCalledOnce();}
});
it('OLD-SAFETY a previously persisted paused frozen graph rejects ordinary retry without dispatch',async()=>{
 const a=image(),b=createWorkflowNode('output-image',0,0);b.id='target';const edge={...createConnection(a.id,'out-image',b.id,'missing','image'),id:'old-frozen-edge'};
 const graph=JSON.parse(JSON.stringify({nodes:[a,b],connections:[edge]}));const sourceResult={nodeId:'source',status:'success',output:{imageUrl:'data:image/png;base64,U1lOVEhFVElD'},durationMs:0};
 const persisted={id:'synthetic-old-frozen',userId:'actor',projectId:'synthetic-project',type:'workflow',status:'processing',createdAt:1,result:{workflowStatus:'paused',projectId:'synthetic-project',workflowId:'synthetic-workflow',executionGraph:graph,results:{source:sourceResult,target:{nodeId:'target',status:'failed',error:'previous failure',durationMs:0}}}};
 mocks.get.mockImplementation(async()=>persisted as never);const call=vi.fn(async()=>{boundary.violations.push('UNEXPECTED_FETCH');throw Error('UNEXPECTED_FETCH')});vi.stubGlobal('fetch',call);
 const response=await POST(request({action:'retry',executionId:persisted.id,nodeId:'target',nodes:graph.nodes,connections:graph.connections}));const body=await response.json();
 expect(body.success).toBe(false);expect(body.error).toContain('old-frozen-edge');expect(body.output?.imageUrl).toBeUndefined();expect(call).not.toHaveBeenCalled();expect(mocks.image).not.toHaveBeenCalled();
 expect(mocks.update).toHaveBeenCalled();const update=mocks.update.mock.calls.at(-1) as unknown as [string,{result:{results:Record<string,unknown>}}];expect(update[1].result.results.source).toEqual(sourceResult);
});
it('PREFLIGHT blocked input stays nonblocking',async()=>{
 const a=image(),b=createWorkflowNode('output-image',0,0);b.id='target';b.config={...b.config,blockedInputs:['blocked']};const e={...createConnection(a.id,'out-image',b.id,'missing','image'),id:'blocked'};const response=await start([a,b],[e]);expect(response.status).toBe(200);const {executionId}=await response.json();expect((await terminal(executionId)).status).toBe('completed');
});
it('PREFLIGHT real ComfyUI any image input remains supported',async()=>{
 const graph=parseComfyUIWorkflow(JSON.stringify({nodes:[{id:1,type:'LoadImage'},{id:2,type:'PreviewImage'}],links:[[1,1,0,2,0,'IMAGE']]}));expect(graph).not.toBeNull();expect(graph!.connections[0].type).toBe('any');const response=await start(graph!.nodes,graph!.connections);expect(response.status).toBe(200);const {executionId}=await response.json();const result=await terminal(executionId);expect(result.status).toBe('completed');expect((result.results as Record<string,{output?:{imageUrl?:string}}>)[graph!.nodes[1].id].output?.imageUrl).toContain('data:image/');
});
it('PREFLIGHT selected start scope ignores unrelated invalid edge',async()=>{
 const a=image(),b=createWorkflowNode('output-image',0,0);b.id='target';const x=createWorkflowNode('input-text',0,0);x.id='x';const y=createWorkflowNode('output-image',0,0);y.id='y';const edges=[{...createConnection(a.id,'out-image',b.id,'in-image','image'),id:'good'},{...createConnection(x.id,'out-prompt',y.id,'missing','prompt'),id:'unrelated'}];const response=await start([a,b,x,y],edges,{startNodeId:a.id});expect(response.status).toBe(200);const {executionId}=await response.json();const result=await terminal(executionId);expect(result.status).toBe('completed');expect((result.results as Record<string,unknown>).y).toBeUndefined();
});

it('LIFECYCLE a rejected caller still drains an already started worker',async()=>{
 let release!:()=>void;let entered=false;const gate=new Promise<void>(resolve=>{release=resolve;});
 mocks.update.mockImplementation(async(...args:unknown[])=>{const payload=args[1] as {result?:{workflowStatus?:string}}|undefined;if(payload?.result?.workflowStatus==='completed'){entered=true;await gate;}return true;});
 const route=(await import('@/app/api/workflow/execute/route')).POST;
 const rejecting=workers.wrap(async req=>{await route(req);throw Error('SYNTHETIC_RESPONSE_DELIVERY_FAILED');});
 try{const a=image(),b=createWorkflowNode('output-image',0,0);b.id='target';const e={...createConnection(a.id,'out-image',b.id,'in-image','image'),id:'normal'};await expect(rejecting(request({action:'start',projectId:'synthetic-project',workflowId:'synthetic-workflow',nodes:[a,b],connections:[e]}))).rejects.toThrow('SYNTHETIC_RESPONSE_DELIVERY_FAILED');await vi.waitFor(()=>expect(entered).toBe(true));expect(workers.pending).toBeGreaterThan(0);let done=false;const draining=workers.drain().then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);offline.verify();release();await draining;expect(workers.pending).toBe(0);}finally{release();}
});
it('LIFECYCLE simultaneous starts each drain their own finally',async()=>{
 const entered=new Set<string>();const releases=new Map<string,()=>void>();
 mocks.update.mockImplementation(async(...args:unknown[])=>{const payload=args[1] as {result?:{workflowStatus?:string}}|undefined;if(payload?.result?.workflowStatus==='completed'){const id=String(args[0]);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});releases.set(id,release);entered.add(id);await gate;}return true;});
 try{const a=image(),b=createWorkflowNode('output-image',0,0);b.id='target';const e={...createConnection(a.id,'out-image',b.id,'in-image','image'),id:'normal'};const responses=await Promise.all([start([a,b],[e]),start([a,b],[e])]);expect(responses.map(r=>r.status)).toEqual([200,200]);await vi.waitFor(()=>expect(entered.size).toBe(2));expect(workers.pending).toBe(2);let done=false;const draining=workers.drain().then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);offline.verify();const finish=[...releases.values()];finish[0]();await vi.waitFor(()=>expect(workers.pending).toBe(1));expect(done).toBe(false);offline.verify();finish[1]();await draining;expect(workers.pending).toBe(0);}finally{for(const release of releases.values())release();}
});
it('LIFECYCLE cold status recovery must drain async finally and lease release',async()=>{
 let release!:()=>void;let entered=false;const gate=new Promise<void>(resolve=>{release=resolve;});
 mocks.claim.mockResolvedValue({taskId:'cold-recovery-test',owner:'synthetic',attemptCount:1});
 mocks.release.mockImplementation(async()=>{entered=true;await gate;return false;});
 const n=createWorkflowNode('ai-edit',0,0);n.id='recovery-node';
 const saved={id:'cold-recovery-test',userId:'actor',projectId:'synthetic-project',type:'workflow',status:'processing',createdAt:1,result:{workflowStatus:'running',projectId:'synthetic-project',workflowId:'synthetic-workflow',executionGraph:{nodes:[n],connections:[]},currentNodeId:n.id,results:{[n.id]:{nodeId:n.id,status:'success',output:{text:'synthetic'}}},activeChildTasks:{'cold-recovery-test:recovery-node':'synthetic-child'}}};
 mocks.get.mockResolvedValue(saved as never);
 try{const response=await POST(request({action:'status',executionId:saved.id}));expect(response.status).toBe(200);await vi.waitFor(()=>expect(entered).toBe(true));expect(workers.pending).toBeGreaterThan(0);let done=false;const draining=workers.drain().then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);offline.verify();release();await draining;expect(workers.pending).toBe(0);}finally{release();}
});

function coldRecoveryFixture(id:string){
 const n=createWorkflowNode('ai-edit',0,0);n.id='recovery-node';
 return {id,userId:'actor',projectId:'synthetic-project',type:'workflow',status:'processing',createdAt:1,result:{workflowStatus:'running',projectId:'synthetic-project',workflowId:'synthetic-workflow',executionGraph:{nodes:[n],connections:[]},currentNodeId:n.id,results:{[n.id]:{nodeId:n.id,status:'success',output:{text:'synthetic'}}},activeChildTasks:{[`${id}:recovery-node`]:'synthetic-child'}}};
}
it('LIFECYCLE unknown stack still tracks cold recovery through actual release',async()=>{
 const originalLimit=Error.stackTraceLimit;let release!:()=>void;let entered=false;const gate=new Promise<void>(resolve=>{release=resolve;});const saved=coldRecoveryFixture('unknown-stack-cold');
 mocks.claim.mockResolvedValue({taskId:saved.id,owner:'synthetic',attemptCount:1});mocks.get.mockResolvedValue(saved as never);mocks.release.mockImplementation(async()=>{entered=true;await gate;return false;});
 try{Error.stackTraceLimit=0;const response=await POST(request({action:'status',executionId:saved.id}));expect(response.status).toBe(200);await vi.waitFor(()=>expect(entered).toBe(true));expect(workers.pending).toBeGreaterThan(0);let done=false;const waiting=workers.drain().then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);offline.verify();release();await waiting;expect(workers.pending).toBe(0);}finally{Error.stackTraceLimit=originalLimit;release();}
});
it('LIFECYCLE multiple cold recovery requests drain separately without stack names',async()=>{
 const originalLimit=Error.stackTraceLimit;const releases=new Map<string,()=>void>();const finished=new Set<string>();const saved=new Map(['multi-cold-one','multi-cold-two'].map(id=>[id,coldRecoveryFixture(id)]));
 mocks.get.mockImplementation(async(...args:unknown[])=>saved.get(String(args[0])) as never);mocks.claim.mockResolvedValue({taskId:'unused',owner:'synthetic',attemptCount:1});mocks.release.mockImplementation(async(...args:unknown[])=>{let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const id=String(args[0]);releases.set(id,release);await gate;finished.add(id);return false;});
 try{Error.stackTraceLimit=0;const responses=await Promise.all([...saved.keys()].map(id=>POST(request({action:'status',executionId:id}))));expect(responses.map(r=>r.status)).toEqual([200,200]);await vi.waitFor(()=>expect(releases.size).toBe(2));expect(workers.pending).toBeGreaterThanOrEqual(2);let done=false;const waiting=workers.drain().then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);offline.verify();releases.get('multi-cold-one')!();await vi.waitFor(()=>expect(finished.has('multi-cold-one')).toBe(true));expect(finished.has('multi-cold-two')).toBe(false);await Promise.resolve();expect(done).toBe(false);offline.verify();releases.get('multi-cold-two')!();await waiting;expect(workers.pending).toBe(0);}finally{Error.stackTraceLimit=originalLimit;for(const release of releases.values())release();}
});
