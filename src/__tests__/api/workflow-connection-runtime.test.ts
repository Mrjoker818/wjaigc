// @vitest-environment node
import {NextRequest} from 'next/server';
import {beforeEach,afterEach,expect,it,vi, beforeAll, afterAll} from 'vitest';
let createConnection: typeof import('@/lib/workflow-engine').createConnection;
let createEmptyWorkflow: typeof import('@/lib/workflow-engine').createEmptyWorkflow;
let createWorkflowNode: typeof import('@/lib/workflow-engine').createWorkflowNode;
let isWorkflowConnectionValid: typeof import('@/lib/workflow-engine').isWorkflowConnectionValid;
const mocks=vi.hoisted(()=>({create:vi.fn(async()=>undefined),update:vi.fn(async()=>true),get:vi.fn(async()=>null),image:vi.fn(async()=>({imageUrl:'data:image/png;base64,U1lOVEhFVElD',_type:'input-image'}))}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/workflow-background',()=>({observeWorkflowBackground:<T>(p:Promise<T>)=>workers.observe(p)}));
vi.mock('@/lib/db-client',()=>({execSql:vi.fn(async()=>{boundary.violations.push('DB');throw Error('DB_FORBIDDEN');}),getPool:vi.fn(()=>{boundary.violations.push('DB');throw Error('DB_FORBIDDEN');})}));
vi.mock('@/lib/api-auth',()=>({requireApiAuthOrReject:vi.fn(async()=>({userId:'actor',userRole:'user',user:{productType:'all'}})),getInternalRequestHeaders:vi.fn(()=>({}))}));
vi.mock('@/lib/cloud-task-storage',()=>({createCloudTask:mocks.create,updateCloudTask:mocks.update,getCloudTaskForUser:mocks.get,claimCloudTaskLease:vi.fn(async()=>workers.claim(null)),renewCloudTaskLease:vi.fn(async()=>false),releaseCloudTaskLease:vi.fn(async()=>false)}));
vi.mock('@/lib/op-log',()=>({logError:vi.fn(),OP_ACTIONS:{WORKFLOW_EXECUTE:'workflow'}}));
vi.mock('@/lib/server-api-config',()=>({findProviderForModel:vi.fn(async()=>null),findProviderForFeature:vi.fn(async()=>null),findProviderById:vi.fn(async()=>null)}));
vi.mock('@/lib/skill-runtime/storage',()=>({loadUserSkillCatalog:vi.fn(async()=>[])}));
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
beforeAll(async()=>{offline=installWorkflowOfflineGuard();workers=trackWorkflowWorkers();const engine=await import('@/lib/workflow-engine');createConnection=engine.createConnection;createEmptyWorkflow=engine.createEmptyWorkflow;createWorkflowNode=engine.createWorkflowNode;isWorkflowConnectionValid=engine.isWorkflowConnectionValid;POST=workers.wrap((await import('@/app/api/workflow/execute/route')).POST);});
afterAll(async()=>{if(!workers)return;await workers.drain();workers.restore();offline.restore();});
afterEach(async()=>{await workers.drain();vi.unstubAllGlobals();vi.unstubAllEnvs();expect([...offline.violations,...boundary.violations]).toEqual([]);},7000);

beforeEach(()=>{offline.verify();vi.stubEnv('DEPLOY_RUN_PORT','5000');vi.clearAllMocks();});
function request(body:Record<string,unknown>){return new NextRequest('http://synthetic.invalid/api/workflow/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
// Preserve the original runtime assertions on a genuinely dynamic route: this
// upstream emits activePorts, so start cannot safely resolve its branch yet.
function dynamicGraph(a:ReturnType<typeof createWorkflowNode>,b:ReturnType<typeof createWorkflowNode>,edge:ReturnType<typeof createConnection>){
 const control=createWorkflowNode('input-text',0,0);control.id='dynamic-control';control.config={...control.config,text:'synthetic',activePorts:['out-data']};
 b.ports=[...b.ports,{id:'in-data',label:'数据',type:'any',direction:'in'}];
 const marker={...createConnection(control.id,'out-data',b.id,'in-data','data'),id:'active-marker'};
 return {nodes:[a,control,b],connections:[edge,marker]};
}

async function runCase(mode:'target'|'source'|'type'|'valid'|'any'|'blocked'){
 const a=createWorkflowNode('input-image',0,0);a.id='source';a.config={...a.config,source:'url',imageUrl:'data:image/png;base64,U1lOVEhFVElD'};const b=createWorkflowNode('output-image',100,0);b.id='target';if(mode==='type')b.ports=[...b.ports,{id:'in-prompt',label:'提示词',direction:'in',type:'prompt'}];if(mode==='blocked')b.config={...b.config,blockedInputs:['edge']};
 const edge={...createConnection(a.id,mode==='source'?'out-absent':'out-image',b.id,mode==='target'||mode==='blocked'?'in-absent':mode==='type'?'in-prompt':'in-image',mode==='any'?'any':'image'),id:'edge'};
 const before=structuredClone(edge);const graph=['target','source','type'].includes(mode)?dynamicGraph(a,b,edge):{nodes:[a,b],connections:[edge]};const response=await POST(request({action:'start',projectId:'synthetic-project',workflowId:'synthetic-workflow',...graph}));expect(response.status).toBe(200);const started=await response.json();let final:Record<string,unknown>|undefined;await vi.waitFor(async()=>{final=await (await POST(request({action:'status',executionId:started.executionId}))).json();expect(['completed','failed']).toContain(final?.status);},{timeout:2000,interval:25});const target=(final!.results as Record<string,{status:string;error?:string;output?:{imageUrl?:string}}>).target;console.log('CONSUMPTION',JSON.stringify({mode,terminal:final!.status,target}));expect(edge).toEqual(before);return target;
}
it.each(['target','source','type'] as const)('active %s mismatch fails at consumption',async mode=>{const target=await runCase(mode);expect(target.status).toBe('failed');expect(target.error).toContain('edge');expect(target.output?.imageUrl).toBeUndefined();});
it.each(['valid','any'] as const)('%s compatible edge retains image output',async mode=>{const target=await runCase(mode);expect(target.status).toBe('success');expect(target.output?.imageUrl).toBe('data:image/png;base64,U1lOVEhFVElD');});
it('blocked stale input is not consumed',async()=>{const target=await runCase('blocked');expect(target.status).toBe('success');expect(target.output?.imageUrl).toBeUndefined();});

async function startGraph(nodes:ReturnType<typeof createWorkflowNode>[],connections:ReturnType<typeof createConnection>[]){
 const response=await POST(request({action:'start',projectId:'synthetic-project',workflowId:'synthetic-workflow',nodes,connections}));expect(response.status).toBe(200);const {executionId}=await response.json();let terminal:Record<string,unknown>|undefined;await vi.waitFor(async()=>{terminal=await (await POST(request({action:'status',executionId}))).json();expect(['completed','failed']).toContain(terminal?.status);},{timeout:2000,interval:25});return {executionId,terminal:terminal!};
}
it('retry cannot consume the originally failed invalid edge',async()=>{
 const a=createWorkflowNode('input-image',0,0);a.id='source';a.config={...a.config,source:'url',imageUrl:'data:image/png;base64,U1lOVEhFVElD'};const b=createWorkflowNode('output-image',100,0);b.id='target';const edge={...createConnection(a.id,'out-image',b.id,'in-absent','image'),id:'retry-edge'};const graph=dynamicGraph(a,b,edge);const {executionId}=await startGraph(graph.nodes,graph.connections);const retry=await POST(request({action:'retry',executionId,nodeId:b.id,...graph}));const data=await retry.json();console.log('RETRY_OBSERVATION',JSON.stringify({status:retry.status,data}));expect(data.success).toBe(false);expect(data.error).toContain('retry-edge');expect(data.output?.imageUrl).toBeUndefined();
});
it.each([['out-false','failed'],['out-true','skipped']] as const)('condition branch %s applies checks only when active',async(port,expected)=>{
 const condition=createWorkflowNode('condition-if',0,0);condition.id='condition';condition.config={...condition.config,condition:'false'};const target=createWorkflowNode('output-image',100,0);target.id='target';const edge={...createConnection(condition.id,port,target.id,'in-absent','condition'),id:'branch-edge'};const {terminal}=await startGraph([condition,target],[edge]);const result=(terminal.results as Record<string,{status:string;error?:string}>).target;console.log('BRANCH_OBSERVATION',JSON.stringify({port,status:result?.status,error:result?.error}));expect(result.status).toBe(expected);if(expected==='failed')expect(result.error).toContain('branch-edge');
});
it('active invalid edge in an inline subgraph is rejected with its location',async()=>{
 const a=createWorkflowNode('input-text',0,0);a.id='child-source';a.config={...a.config,text:'synthetic'};const b=createWorkflowNode('output-image',100,0);b.id='child-target';const edge={...createConnection(a.id,'out-prompt',b.id,'in-absent','prompt'),id:'child-edge'};const parent=createWorkflowNode('subgraph',0,0);parent.id='parent';parent.config={...parent.config,inlineWorkflow:{nodes:[a,b],connections:[edge]}};const {terminal}=await startGraph([parent],[]);const result=(terminal.results as Record<string,{status:string;error?:string}>).parent;console.log('SUBGRAPH_OBSERVATION',JSON.stringify(result));expect(result.status).toBe('failed');expect(result.error).toContain('child-edge');
});
it('valid inline subgraph retains normal success',async()=>{
 const a=createWorkflowNode('input-text',0,0);a.id='child-source';a.config={...a.config,text:'synthetic'};const b=createWorkflowNode('output-image',100,0);b.id='child-target';b.ports=[...b.ports,{id:'in-prompt',label:'提示词',type:'prompt',direction:'in'}];const edge={...createConnection(a.id,'out-prompt',b.id,'in-prompt','prompt'),id:'child-valid'};const parent=createWorkflowNode('subgraph',0,0);parent.id='parent';parent.config={...parent.config,inlineWorkflow:{nodes:[a,b],connections:[edge]}};const {terminal}=await startGraph([parent],[]);const result=(terminal.results as Record<string,{status:string;error?:string}>).parent;console.log('SUBGRAPH_VALID',JSON.stringify(result));expect(result.status).toBe('success');
});
it('start-node execution ignores invalid edges on an unrelated branch',async()=>{
 const a=createWorkflowNode('input-image',0,0);a.id='source';a.config={...a.config,source:'url',imageUrl:'data:image/png;base64,U1lOVEhFVElD'};const b=createWorkflowNode('output-image',0,0);b.id='target';const x=createWorkflowNode('input-text',0,0);x.id='unrelated-source';x.config={...x.config,text:'test'};const y=createWorkflowNode('output-image',0,0);y.id='unrelated-target';const edges=[{...createConnection(a.id,'out-image',b.id,'in-image','image'),id:'valid-edge'},{...createConnection(x.id,'out-prompt',y.id,'missing-port','prompt'),id:'unrelated-invalid'}];const response=await POST(request({action:'start',projectId:'synthetic-project',workflowId:'synthetic-workflow',startNodeId:'source',nodes:[a,b,x,y],connections:edges}));expect(response.status).toBe(200);const {executionId}=await response.json();let terminal:Record<string,unknown>|undefined;await vi.waitFor(async()=>{terminal=await (await POST(request({action:'status',executionId}))).json();expect(terminal?.status).toBe('completed');},{timeout:2000,interval:25});const results=terminal!.results as Record<string,{status:string}>;expect(results.target.status).toBe('success');expect(results['unrelated-target']).toBeUndefined();
});
it('a downstream mismatch can be found after a prior node and task have already completed work',async()=>{
 const a=createWorkflowNode('input-image',0,0);a.id='source';a.config={...a.config,source:'url',imageUrl:'data:image/png;base64,U1lOVEhFVElD'};const b=createWorkflowNode('output-image',100,0);b.id='target';const edge={...createConnection(a.id,'out-image',b.id,'missing','image'),id:'late-validation'};const graph=dynamicGraph(a,b,edge);const {terminal}=await startGraph(graph.nodes,graph.connections);const results=terminal.results as Record<string,{status:string}>;expect(results.source.status).toBe('success');expect(results.target.status).toBe('failed');expect(mocks.create).toHaveBeenCalled();expect(mocks.image).toHaveBeenCalled();
});
it.each(['parallel','loop-for'] as const)('%s actual controller rejects an active stale child edge',async mode=>{
 const control=createWorkflowNode(mode,0,0);control.id='controller';control.config={...control.config,channels:1,loopCount:1};const child=createWorkflowNode('output-image',100,0);child.id='child';const edge={...createConnection(control.id,mode==='parallel'?'out-1':'out-loop',child.id,'missing','any'),id:'controller-edge'};const {terminal}=await startGraph([control,child],[edge]);const results=terminal.results as Record<string,{status:string;error?:string}>;console.log('CONTROLLER_PROBE',JSON.stringify({mode,status:terminal.status,results}));expect(terminal.status).toBe('failed');expect(JSON.stringify(results)).toContain('controller-edge');
});
it.each(['parallel','loop-for'] as const)('%s valid control edge preserves normal completion',async mode=>{
 const control=createWorkflowNode(mode,0,0);control.id='controller';control.config={...control.config,channels:1,loopCount:1};const child=createWorkflowNode('output-image',100,0);child.id='child';child.ports=[...child.ports,{id:'in-data',label:'数据',type:'any',direction:'in'}];const edge={...createConnection(control.id,mode==='parallel'?'out-1':'out-loop',child.id,'in-data','any'),id:'control-valid'};const {terminal}=await startGraph([control,child],[edge]);const results=terminal.results as Record<string,{status:string;error?:string}>;console.log('CONTROLLER_VALID',JSON.stringify({mode,status:terminal.status,results}));expect(terminal.status).toBe('completed');expect(results.controller.status).toBe('success');
});
it.each([['missing',false],['in-data',true]] as const)('loop body endpoint %s dispatches only for a valid control edge',async(port,shouldDispatch)=>{
 const control=createWorkflowNode('loop-for',0,0);control.id='controller';control.config={...control.config,loopCount:1};const child=createWorkflowNode('output-save',100,0);child.id='child';child.ports=[...child.ports,{id:'in-data',label:'数据',type:'any',direction:'in'}];const edge={...createConnection(control.id,'out-loop',child.id,port,'any'),id:'loop-side-effect-edge'};const fakeFetch=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);if(!isSyntheticSaveRequest(input,init)){boundary.violations.push('UNEXPECTED_FETCH');throw Error('UNEXPECTED_REQUEST '+url);}return Response.json({success:true,url:'synthetic'});});vi.stubGlobal('fetch',fakeFetch);const {terminal}=await startGraph([control,child],[edge]);console.log('LOOP_EFFECT',JSON.stringify({port,status:terminal.status,calls:fakeFetch.mock.calls.length}));expect(fakeFetch.mock.calls.length>0).toBe(shouldDispatch);expect(terminal.status).toBe(shouldDispatch?'completed':'failed');
});
