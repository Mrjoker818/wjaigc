// @vitest-environment node
import {NextRequest,NextResponse} from 'next/server';
import {beforeEach,afterEach,expect,it,vi, beforeAll, afterAll} from 'vitest';
import type { WorkflowConnection } from '@/lib/workflow-engine';
let createConnection: typeof import('@/lib/workflow-engine').createConnection;
let createWorkflowNode: typeof import('@/lib/workflow-engine').createWorkflowNode;
const m=vi.hoisted(()=>({get:vi.fn(),create:vi.fn(),update:vi.fn(),admit:vi.fn(),claim:vi.fn(async(..._args:unknown[]):Promise<unknown>=>null),release:vi.fn(async(..._args:unknown[])=>false)}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/workflow-background',()=>({observeWorkflowBackground:<T>(p:Promise<T>)=>workers.observe(p)}));
vi.mock('@/lib/db-client',()=>({execSql:vi.fn(async()=>{boundary.violations.push('DB');throw Error('DB_FORBIDDEN')}),getPool:vi.fn(()=>{boundary.violations.push('DB');throw Error('DB_FORBIDDEN')})}));
vi.mock('@/lib/api-auth',()=>({requireApiAuthOrReject:vi.fn(async()=>({userId:'actor',userRole:'user',user:{productType:'all'}})),getInternalRequestHeaders:vi.fn(()=>({}))}));
vi.mock('@/lib/cloud-task-storage',()=>({createCloudTask:m.create,updateCloudTask:m.update,getCloudTaskForUser:async(...args:unknown[])=>workers.read(String(args[0]),await m.get(...args)),claimCloudTaskLease:async(...args:unknown[])=>workers.claim(await m.claim(...args)),renewCloudTaskLease:vi.fn(async()=>false),releaseCloudTaskLease:async(...args:unknown[])=>workers.release(String(args[0]),String(args[1]),await m.release(...args))}));
vi.mock('@/lib/workflow-image-retry-admission',()=>({admitWorkflowImageRetry:m.admit}));
vi.mock('@/lib/op-log',()=>({logError:vi.fn(),OP_ACTIONS:{WORKFLOW_EXECUTE:'workflow'}}));
vi.mock('@/lib/server-api-config',()=>({findProviderForModel:vi.fn(async()=>null),findProviderForFeature:vi.fn(async()=>null),findProviderById:vi.fn(async()=>null)}));
vi.mock('@/lib/skill-runtime/storage',()=>({loadUserSkillCatalog:vi.fn(async()=>[])}));
vi.mock('@/lib/asset-core/storage',()=>({createPostgresAssetStorage:vi.fn(()=>{boundary.violations.push('ASSET_STORAGE');throw Error('ASSET_STORAGE_FORBIDDEN');})}));
vi.mock('@/lib/asset-core/workflow-resolver',()=>({resolveWorkflowInputImageForActor:vi.fn()}));
import {installWorkflowOfflineGuard,trackWorkflowWorkers} from '@/__tests__/helpers/workflow-offline-guard';
const boundary=vi.hoisted(()=>({violations:[] as string[]}));
vi.mock('@/lib/server-data-root',()=>{const deny=()=>{boundary.violations.push('DATA_ROOT');throw Error('WORKFLOW_TEST_DATA_ROOT_FORBIDDEN');};return {getServerDataRoot:deny,getServerSystemDir:deny,getServerUsersDir:deny,isServerDataRootDurable:deny,saveImageFile:deny,deleteImageFile:deny};});
vi.mock('pg',()=>{boundary.violations.push('PG');throw Error('WORKFLOW_TEST_PG_FORBIDDEN');});
vi.mock('@/lib/server-auth',()=>({listManagedUsers:()=>{boundary.violations.push('AUTH_STORAGE');throw Error('WORKFLOW_TEST_AUTH_STORAGE_FORBIDDEN');}}));
let offline: ReturnType<typeof installWorkflowOfflineGuard>;
let workers: ReturnType<typeof trackWorkflowWorkers>;
let POST: typeof import('@/app/api/workflow/execute/route').POST;
beforeAll(async()=>{offline=installWorkflowOfflineGuard();workers=trackWorkflowWorkers();const engine=await import('@/lib/workflow-engine');createConnection=engine.createConnection;createWorkflowNode=engine.createWorkflowNode;POST=workers.wrap((await import('@/app/api/workflow/execute/route')).POST);});
afterAll(async()=>{if(!workers)return;await workers.drain();workers.restore();offline.restore();});
afterEach(async()=>{await workers.drain();vi.unstubAllGlobals();vi.unstubAllEnvs();expect([...offline.violations,...boundary.violations]).toEqual([]);},7000);

beforeEach(()=>{offline.verify();vi.stubEnv('DEPLOY_RUN_PORT','5000');vi.clearAllMocks();m.claim.mockReset().mockResolvedValue(null);m.release.mockReset().mockResolvedValue(false);m.admit.mockResolvedValue({task:{id:'child',status:'failed',error:'synthetic terminal',result:{results:{}}},reused:false});});
async function retryCase(kind:'valid'|'source-port'|'target-port'|'irrelevant'){
 const source=createWorkflowNode('input-image',0,0);source.id='source';source.config={...source.config,source:'url',imageUrl:'data:image/png;base64,AA=='};
 const target=createWorkflowNode('input-image',100,0);target.id='target';target.ports=[...target.ports,{id:'in-image',label:'图片',type:'image',direction:'in'}];target.config={...target.config,source:'upstream',imageInputTransform:{version:1,kind:'identity'}};
 const edge={...createConnection('source',kind==='source-port'?'out-missing':'out-image','target',kind==='target-port'?'in-missing':'in-image','image'),id:'receiver-edge'};
 const edges:WorkflowConnection[]=[edge];if(kind==='irrelevant')edges.push({...createConnection('source','out-image','target','unused-port','image'),id:'irrelevant-edge'});
 const graph=JSON.parse(JSON.stringify({nodes:[source,target],connections:edges}));const results={source:{nodeId:'source',status:'success',output:{imageUrl:'data:image/png;base64,AA=='}},target:{nodeId:'target',status:'failed',error:'synthetic'}};
 const original={id:'original-'+kind,userId:'actor',projectId:'project',type:'workflow',status:'failed',createdAt:1,result:{workflowStatus:'failed',projectId:'project',workflowId:'workflow',executionGraph:graph,results}};m.get.mockResolvedValue(original);
 const response=await POST(new NextRequest('http://synthetic.invalid/api/workflow/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'retry',executionId:original.id,projectId:'project',workflowId:'workflow',nodeId:'target',nodes:graph.nodes,connections:edges})}));const body=await response.json();console.log('RECEIVER_RETRY',JSON.stringify({kind,status:response.status,body,admissions:m.admit.mock.calls.length}));return {response,body};
}
it.each(['source-port','target-port'] as const)('receiver retry %s is rejected before admission',async kind=>{const {body}=await retryCase(kind);expect(body.success).toBe(false);expect(m.admit).not.toHaveBeenCalled();});
it.each(['valid','irrelevant'] as const)('receiver retry %s can still reach admission',async kind=>{await retryCase(kind);expect(m.admit).toHaveBeenCalledOnce();});
it.each([['invalid',false],['valid',true]] as const)('cold retry %s status guards before reconciling admission',async(kind,shouldAdmit)=>{
 const source=createWorkflowNode('input-image',0,0);source.id='source';source.config={...source.config,source:'url',imageUrl:'data:image/png;base64,AA=='};const target=createWorkflowNode('input-image',0,0);target.id='target';target.ports=[...target.ports,{id:'in-image',label:'图片',type:'image',direction:'in'}];target.config={...target.config,source:'upstream',imageInputTransform:{version:1,kind:'identity'}};const edge={...createConnection('source',shouldAdmit?'out-image':'out-missing','target','in-image','image'),id:'cold-edge'};const graph=JSON.parse(JSON.stringify({nodes:[source,target],connections:[edge]}));const results={source:{nodeId:'source',status:'success',output:{imageUrl:'data:image/png;base64,AA=='}}};const parent={id:'original-cold',userId:'actor',projectId:'project',type:'workflow',status:'failed',createdAt:1,result:{workflowStatus:'failed',projectId:'project',workflowId:'workflow',executionGraph:graph,results}};const child={id:'exec-image-retry-cold',userId:'actor',projectId:'project',type:'workflow',status:'processing',createdAt:1,result:{workflowStatus:'running',projectId:'project',workflowId:'workflow',executionGraph:graph,results,imageRetry:{version:1,sourceExecutionId:parent.id,nodeId:'target',phase:'admitted'}}};m.get.mockImplementation(async(id:string)=>id===parent.id?parent:id===child.id?child:null);m.admit.mockResolvedValue({task:child,reused:true});const response=await POST(new NextRequest('http://synthetic.invalid/api/workflow/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'status',executionId:child.id,reconcile:true})}));const body=await response.json();console.log('COLD_RETRY',JSON.stringify({status:response.status,body,admissions:m.admit.mock.calls.length}));if(shouldAdmit){expect(m.admit).toHaveBeenCalledOnce();expect(body.status).toBe('running');}else{expect(m.admit).not.toHaveBeenCalled();expect(body.error).toContain('图片接收节点');}
});

it('diagnoses a fenced cold retry: raw route returns 409, wrapper must preserve it',async()=>{
 const source=createWorkflowNode('input-image',0,0);source.id='source';source.config={...source.config,source:'url',imageUrl:'data:image/png;base64,AA=='};
 const target=createWorkflowNode('input-image',0,0);target.id='target';target.ports=[...target.ports,{id:'in-image',label:'图片',type:'image',direction:'in'}];target.config={...target.config,source:'upstream',imageInputTransform:{version:1,kind:'identity'}};
 const edge={...createConnection('source','out-image','target','in-image','image'),id:'cold-edge'};
 const graph=JSON.parse(JSON.stringify({nodes:[source,target],connections:[edge]}));const results={source:{nodeId:'source',status:'success',output:{imageUrl:'data:image/png;base64,AA=='}}};
 const parent={id:'original-cold',userId:'actor',projectId:'project',type:'workflow',status:'failed',createdAt:1,result:{workflowStatus:'failed',projectId:'project',workflowId:'workflow',executionGraph:graph,results}};
 async function call(wrapped:boolean){const id=wrapped?'exec-image-retry-fenced-b':'exec-image-retry-fenced-a';const child={id,userId:'actor',projectId:'project',type:'workflow',status:'processing',createdAt:1,result:{workflowStatus:'running',projectId:'project',workflowId:'workflow',executionGraph:graph,results,imageRetry:{version:1,sourceExecutionId:parent.id,nodeId:'target',phase:'admitted'}}};let reads=0;m.get.mockImplementation(async(key:string)=>key===parent.id?parent:key===id?(++reads===1?child:null):null);m.admit.mockResolvedValue({task:child,reused:true});const req=new NextRequest('http://synthetic.invalid/api/workflow/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'status',executionId:id,reconcile:true})});const post=wrapped?POST:(await import('@/app/api/workflow/execute/route')).POST;return post(req)}
 m.claim.mockImplementation(async(...args:unknown[])=>({taskId:String(args[0]),owner:String(args[1]),attemptCount:1}));const before=workers.registered;
 const raw=await call(false);const body=await raw.json();console.log('RAW_FENCED_RESPONSE',JSON.stringify({status:raw.status,error:body.error}));expect(raw.status).toBe(409);expect(body.error).toContain('WORKFLOW_EXECUTION_FENCE_LOST');
 const wrapped=await call(true);console.log('WRAPPED_FENCED_RESPONSE',wrapped.status);expect(wrapped.status).toBe(409);expect((await wrapped.json()).error).toBe('WORKFLOW_EXECUTION_FENCE_LOST');expect(m.release).toHaveBeenCalledTimes(2);expect(workers.registered).toBe(before);
});

it('claimed 409 without post-claim missing record and release still fails closed',async()=>{
 const local=trackWorkflowWorkers();
 const post=local.wrap(async()=>{local.claim({taskId:'synthetic',owner:'synthetic',attemptCount:1});return NextResponse.json({error:'WORKFLOW_EXECUTION_FENCE_LOST'},{status:409});});
 const req=new NextRequest('http://synthetic.invalid/api/workflow/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'status',executionId:'synthetic'})});
 await expect(post(req)).rejects.toThrow('WORKFLOW_TEST_UNTRACKED_RECOVERY');expect(local.unsafe).toBe(true);
});

it('preserves a fenced 409 when the post-claim lease owner differs',async()=>{
 const source=createWorkflowNode('input-image',0,0);source.id='source';source.config={...source.config,source:'url',imageUrl:'data:image/png;base64,AA=='};
 const target=createWorkflowNode('input-image',0,0);target.id='target';target.ports=[...target.ports,{id:'in-image',label:'图片',type:'image',direction:'in'}];target.config={...target.config,source:'upstream',imageInputTransform:{version:1,kind:'identity'}};
 const edge={...createConnection('source','out-image','target','in-image','image'),id:'cold-edge'};
 const graph=JSON.parse(JSON.stringify({nodes:[source,target],connections:[edge]}));const results={source:{nodeId:'source',status:'success',output:{imageUrl:'data:image/png;base64,AA=='}}};
 const parent={id:'original-cold',userId:'actor',projectId:'project',type:'workflow',status:'failed',createdAt:1,result:{workflowStatus:'failed',projectId:'project',workflowId:'workflow',executionGraph:graph,results}};
 async function call(wrapped:boolean){const id=wrapped?'exec-image-retry-fenced-b':'exec-image-retry-fenced-a';const child={id,userId:'actor',projectId:'project',type:'workflow',status:'processing',createdAt:1,result:{workflowStatus:'running',projectId:'project',workflowId:'workflow',executionGraph:graph,results,imageRetry:{version:1,sourceExecutionId:parent.id,nodeId:'target',phase:'admitted'}}};let reads=0;m.get.mockImplementation(async(key:string)=>key===parent.id?parent:key===id?(++reads===1?child:{...child,leaseOwner:'other-owner',attemptCount:1}):null);m.admit.mockResolvedValue({task:child,reused:true});const req=new NextRequest('http://synthetic.invalid/api/workflow/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'status',executionId:id,reconcile:true})});const post=wrapped?POST:(await import('@/app/api/workflow/execute/route')).POST;return post(req)}
 m.claim.mockImplementation(async(...args:unknown[])=>({taskId:String(args[0]),owner:String(args[1]),attemptCount:1}));const before=workers.registered;
 const raw=await call(false);const body=await raw.json();console.log('RAW_FENCED_RESPONSE',JSON.stringify({status:raw.status,error:body.error}));expect(raw.status).toBe(409);expect(body.error).toContain('WORKFLOW_EXECUTION_FENCE_LOST');
 const wrapped=await call(true);console.log('WRAPPED_FENCED_RESPONSE',wrapped.status);expect(wrapped.status).toBe(409);expect((await wrapped.json()).error).toBe('WORKFLOW_EXECUTION_FENCE_LOST');expect(m.release).toHaveBeenCalledTimes(2);expect(workers.registered).toBe(before);
});

it('a post-claim missing record with a different release owner still fails closed',async()=>{
 const local=trackWorkflowWorkers();
 const post=local.wrap(async()=>{local.claim({taskId:'synthetic',owner:'expected',attemptCount:1});local.read('synthetic',null);local.release('synthetic','other',false);return NextResponse.json({error:'WORKFLOW_EXECUTION_FENCE_LOST'},{status:409});});
 const req=new NextRequest('http://synthetic.invalid/api/workflow/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'status',executionId:'synthetic'})});
 await expect(post(req)).rejects.toThrow('WORKFLOW_TEST_UNTRACKED_RECOVERY');expect(local.unsafe).toBe(true);
});

it('a later valid post-claim reread invalidates earlier missing-record proof',async()=>{
 const local=trackWorkflowWorkers();
 const post=local.wrap(async()=>{local.claim({taskId:'synthetic',owner:'expected',attemptCount:1});local.read('synthetic',null);local.read('synthetic',{leaseOwner:'expected'});local.release('synthetic','expected',false);return NextResponse.json({error:'WORKFLOW_EXECUTION_FENCE_LOST'},{status:409});});
 const req=new NextRequest('http://synthetic.invalid/api/workflow/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'status',executionId:'synthetic'})});
 await expect(post(req)).rejects.toThrow('WORKFLOW_TEST_UNTRACKED_RECOVERY');expect(local.unsafe).toBe(true);
});
