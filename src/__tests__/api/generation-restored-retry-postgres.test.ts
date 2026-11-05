import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { createDurableGenerationBatch } from '@/lib/task-core/generation-batch';
import { admitCanvasGenerationBatch, parseCanvasGenerationPublication } from '@/lib/collaboration/canvas-generation-batch-admission';
import { readFile } from 'node:fs/promises';
import { withIsolatedPostgres, type QueryFn } from '../../../tests/helpers/postgres-test-database';
vi.mock('server-only', () => ({}));
const state=vi.hoisted(()=>({ user:{id:'actor',name:'Synthetic',role:'user',status:'active',createdAt:1,updatedAt:1},
 provider:{id:'y-b',name:'Synthetic B',type:'image',modelType:'image',apiKey:'offline-only-key',baseUrl:'https://retry-provider.invalid',selectedModels:['y-image'],isEnabled:true,createdAt:1,updatedAt:1},
 beforeCost:undefined as (()=>Promise<void>)|undefined, network:vi.fn() }));
vi.mock('next/server',async original=>({...await original<typeof import('next/server')>(),after:():void=>{}}));
vi.mock('@/lib/server-auth',()=>({getSessionUser:async()=>state.user}));
vi.mock('@/lib/desktop-cloud',async original=>({...await original<typeof import('@/lib/desktop-cloud')>(),getDesktopAuth:async()=>null}));
vi.mock('@/lib/server-api-config',()=>({findProviderById:async(id:string)=>id==='y-b'?state.provider:null,
 findProviderForModel:async()=>state.provider,findAllProvidersForType:async()=>[{provider:state.provider,models:['y-image']}],normalizeApiBaseUrl:(v:string):string=>v}));
vi.mock('@/lib/task-core/model-catalog',()=>({resolveTaskModelForUser:async(providerId:string,modelId:string)=>({providerId,modelId,kind:'image',sourceType:'image',protocol:'openai',executionMode:'sync',allowedRatios:['1:1'],allowedSizes:['1024x1024','2K'],qualityOptions:['high'],maxOutputs:1,supportsReferenceImages:true,supportsMask:false,supportedOperations:['text-to-image','image-to-image'],outputKinds:['png'],capabilitySources:{}})}));
vi.mock('@/lib/identify-subject',async original=>({...await original<typeof import('@/lib/identify-subject')>(),freezeSubjectIdentificationTargets:async()=>[]}));
vi.mock('@/lib/credits',async original=>({...await original<typeof import('@/lib/credits')>(),calculateConfiguredCreditCost:async()=>{await state.beforeCost?.();return 7;}}));
vi.mock('@/lib/server-user-storage',()=>({appendUserJsonl:async()=>undefined}));
vi.mock('@/lib/op-log',()=>({logOperation:():void=>{},logError:():void=>{},startTimer:()=>({end:()=>0}),OP_ACTIONS:{IMAGE_GENERATE:'image_generate'},sanitizeRequestData:(v:unknown):unknown=>v}));
import { POST } from '@/app/api/generate/route';
import { createCloudTask, getCloudTaskForUser, ensureCloudTaskTables, terminateCloudTaskAndRefund } from '@/lib/cloud-task-storage';
import { ensureCoreTables } from '@/lib/db-storage';

beforeEach(()=>{state.beforeCost=undefined;vi.clearAllMocks();state.network.mockImplementation(()=>{throw Error('Z_EXTERNAL_NETWORK_FORBIDDEN');});vi.stubGlobal('fetch',state.network);vi.stubEnv('WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER','true');vi.stubEnv('WUJIE_ENABLE_IN_PROCESS_ASYNC_WORKER','false');vi.stubEnv('WUJIE_YJS_ENABLED','true');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const frozen={projectId:'personal',prompt:'合成蓝色杯子',model:'y-image',providerId:'y-b',aspectRatio:'1:1',size:'1024x1024',quality:'high',referenceImages:[],outputCount:1,n:1};
function request(body:Record<string,unknown>,key?:string):NextRequest{return new NextRequest('http://localhost/api/generate',{method:'POST',headers:{'content-type':'application/json',...(key?{'idempotency-key':key}:{})},body:JSON.stringify(body)});}
function retry(taskId:string,projectId='personal'):NextRequest{return request({retryTaskId:taskId,projectId,submitOnly:true,outputCount:1,n:1});}
async function seed(query:QueryFn):Promise<void>{
 for(const file of ['20260809_wj_core_users.sql','20260810_wj_stable_s2_assets.sql','20260924_project_presence.sql','20260925_yjs_canvas_editors.sql','20260925_yjs_canvas_documents.sql','20260926_yjs_canvas_authority_fence.sql'])await query(await readFile('migrations/'+file,'utf8'));
 await ensureCoreTables();await ensureCloudTaskTables();
 await query(await readFile('migrations/20260927_yjs_canvas_task_publications.sql','utf8'));
 await query(await readFile('migrations/20260927_yjs_canvas_task_publications_intent.sql','utf8'));
 await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES('actor','Actor','synthetic','active','user',1,1),('owner','Owner','synthetic','active','user',1,1)");
 await query("INSERT INTO wujie_projects(id,owner_id,name,status) VALUES('personal','actor','Personal','active'),('shared','owner','Shared','active')");
 await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES('shared','owner',true)");
 await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES('shared','owner')");
 await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES('shared','owner','actor')");
 await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES('z-credits','actor',100,100,0,1,1)");
}
async function oldPersonal():Promise<void>{await createCloudTask({id:'z-old',userId:'actor',projectId:'personal',type:'generate-async',status:'failed',providerId:'y-b',model:'y-image',progress:0,createdAt:1,updatedAt:2,creditStatus:'refunded',creditCost:7,idempotencyKey:'old:0',requestDigest:'old-digest',error:'合成供应商失败',result:{submissionPayload:{...frozen,workerMode:'recovery'}}});}
async function seedSource(query:QueryFn):Promise<void>{
 await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES('source-asset','owner','shared','image')");
 await query("INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,width,height) VALUES('source-version','source-asset','owner','shared','/api/serve-upload/source.png','image/png',64,64)");
 await query("UPDATE wujie_assets SET current_version_id='source-version' WHERE id='source-asset'");
 await query("INSERT INTO wujie_workspace_placements(id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id) VALUES('source-placement','owner','shared','source-asset','source-version','canvas','shared','canvas-image','source-entity')");
 await query('UPDATE wujie_project_canvas_documents SET projection=$1::jsonb WHERE project_id=$2',[JSON.stringify({placements:{'source-placement':{assetVersionId:'source-version',x:0,y:0,width:64,height:64,rotation:0,zIndex:0}}}),'shared']);
}
describe('standalone retry z postgres',()=>{
 it('preserves the established empty pixel-size representation for a descriptor-backed resolution-tier retry',async()=>{
  await withIsolatedPostgres('z-retry-empty-pixel-size',async({query})=>{
   await seed(query);
   const initial=await POST(request({...frozen,projectId:'shared',size:'',resolution:'2K',submitOnly:true},'z-empty-pixel-size'));
   expect(initial.status,'optional size fixture must be admitted through the original POST').toBe(200);const original=await initial.json();
   await terminateCloudTaskAndRefund(original.taskId,'failed','合成分辨率任务失败');
   const response=await POST(retry(original.taskId,'shared'));
   expect(response.status,'standalone retry z postgres descriptor-backed optional empty size must retain established semantics').toBe(200);
   const child=await response.json();const persisted=await getCloudTaskForUser(child.taskId,'actor');
   expect(persisted?.result?.ordinaryGeneration).toMatchObject({plan:{body:{size:'',resolution:'2K',providerId:'y-b',model:'y-image'},requestedCount:1}});
   expect(Number((await query("SELECT balance FROM wujie_credits WHERE user_id='actor'")).rows[0].balance)).toBe(93);expect(state.network).not.toHaveBeenCalled();
  });
 });

 it('retries a legacy document task through its actual stored publication without a read-only locking failure',async()=>{
  await withIsolatedPostgres('z-retry-legacy-document',async({query})=>{
   await seed(query);
   const access={kind:'document' as const,actorUserId:'actor',ownerId:'owner',projectId:'shared',grantGeneration:'1'};
   const body={...frozen,projectId:'shared'};
   const batch=createDurableGenerationBatch({batchId:'batch-'+createHash('sha256').update('z-legacy-root').digest('hex').slice(0,24),requestedCount:1,createTaskId:()=> 'z-legacy-original'});
   await admitCanvasGenerationBatch({access,batch,rootIdempotencyKey:'z-legacy-root',requestDigest:'z-legacy-digest',creditCost:7,
    publication:parseCanvasGenerationPublication({access,body}),submissionPayload:{...body,workerMode:'recovery'},providerId:'y-b',model:'y-image'});
   await terminateCloudTaskAndRefund('z-legacy-original','failed','合成旧任务失败');
   const old=await getCloudTaskForUser('z-legacy-original','actor');
   const response=await POST(retry('z-legacy-original','shared'));
   expect(response.status,'standalone retry z postgres legacy locking readers must run in a compatible transaction').toBe(200);
   const child=await response.json();expect(child.taskId).not.toBe('z-legacy-original');
   const task=await getCloudTaskForUser(child.taskId,'actor');expect(task?.type).toBe('generate');expect(task?.result?.ordinaryGeneration).toMatchObject({publication:{access,ordinarySourceSnapshot:[]}});
   expect(await getCloudTaskForUser('z-legacy-original','actor')).toEqual(old);expect(Number((await query("SELECT balance FROM wujie_credits WHERE user_id='actor'")).rows[0].balance)).toBe(93);expect(state.network).not.toHaveBeenCalled();
  });
 });

 it('reports insufficient credits without creating or charging a retry task',async()=>{
  await withIsolatedPostgres('z-retry-credit-denial',async({query})=>{
   await seed(query);await oldPersonal();await query("UPDATE wujie_credits SET balance=0 WHERE user_id='actor'");
   const response=await POST(retry('z-old'));
   expect(response.status,'standalone retry z postgres preserves insufficient-credit status').toBe(402);
   expect(await response.json()).toMatchObject({success:false,code:'INSUFFICIENT_CREDITS'});
   expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(1);expect((await query('SELECT id FROM wujie_credit_transactions')).rows).toEqual([]);expect(state.network).not.toHaveBeenCalled();
  });
 });
 it('carries the original document sources into one new child and permits the next retry from the failed child identity',async()=>{
  await withIsolatedPostgres('z-retry-document-child',async({query})=>{
   await seed(query);await seedSource(query);
   const initial=await POST(request({...frozen,projectId:'shared',referenceImages:['/api/serve-upload/source.png'],assetParentVersionIds:['source-version'],assetSelectedEntityIds:['source-entity'],submitOnly:true},'z-doc-child'));
   expect(initial.status,'source fixture original admission must succeed').toBe(200);const original=await initial.json();
   await terminateCloudTaskAndRefund(original.taskId,'failed','原任务合成失败');
   const old=await getCloudTaskForUser(original.taskId,'actor');
   const response=await POST(retry(original.taskId,'shared'));expect(response.status).toBe(200);const child=await response.json();
   const persisted=await getCloudTaskForUser(child.taskId,'actor');
   const oldDescriptor=old?.result?.ordinaryGeneration as {publication:unknown};
   const descriptor=persisted?.result?.ordinaryGeneration as {publication:unknown;plan:{body:Record<string,unknown>;requestedCount:number}};
   expect(child.taskId).not.toBe(original.taskId);expect(descriptor.publication).toEqual(oldDescriptor.publication);
   expect(descriptor.plan.requestedCount).toBe(1);expect(descriptor.plan.body).toMatchObject({referenceImages:['/api/serve-upload/source.png'],assetParentVersionIds:['source-version'],assetSelectedEntityIds:['source-entity'],providerId:'y-b',model:'y-image',prompt:'合成蓝色杯子'});
   await terminateCloudTaskAndRefund(child.taskId,'failed','新子任务合成失败');
   const reused=await POST(retry(original.taskId,'shared'));expect(reused.status).toBe(200);expect(await reused.json()).toMatchObject({success:false,taskId:child.taskId,status:'failed',error:'新子任务合成失败'});
   const next=await POST(retry(child.taskId,'shared'));expect(next.status).toBe(200);expect((await next.json()).taskId).not.toBe(child.taskId);
   expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(3);expect(Number((await query("SELECT balance FROM wujie_credits WHERE user_id='actor'")).rows[0].balance)).toBe(93);
   expect(await getCloudTaskForUser(original.taskId,'actor')).toEqual(old);expect(state.network).not.toHaveBeenCalled();
  });
 });
 it('keeps the original parent/source fingerprint under the charge transaction when the source changes during model admission',async()=>{
  await withIsolatedPostgres('z-retry-source-fence',async({query})=>{
   await seed(query);await seedSource(query);
   const initial=await POST(request({...frozen,projectId:'shared',referenceImages:['/api/serve-upload/source.png'],assetParentVersionIds:['source-version'],assetSelectedEntityIds:['source-entity'],submitOnly:true},'z-original-source'));
   expect(initial.status,'source fixture original admission must succeed').toBe(200);const original=await initial.json();
   await terminateCloudTaskAndRefund(original.taskId,'failed','合成失败');
   const before=(await query('SELECT balance,total_used FROM wujie_credits')).rows;
   let hookRan=false;state.beforeCost=async()=>{hookRan=true;state.beforeCost=undefined;await query("UPDATE wujie_asset_versions SET checksum='changed-after-source-admission' WHERE id='source-version'");};
   const response=await POST(retry(original.taskId,'shared'));
   expect(hookRan,'source rejection must be after the real model-admission boundary').toBe(true);expect(response.status,'standalone retry z postgres original source fingerprint is preserved').toBe(409);
   expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(1);expect((await query('SELECT balance,total_used FROM wujie_credits')).rows).toEqual(before);expect(state.network).not.toHaveBeenCalled();
  });
 });
 it('concurrent retry receipts create one real task and one real ledger charge with legacy wrapper enabled',async()=>{
  await withIsolatedPostgres('z-retry-concurrent',async({query})=>{
   await seed(query);await oldPersonal();const old=await getCloudTaskForUser('z-old','actor');
   const responses=await Promise.all(Array.from({length:8},()=>POST(retry('z-old'))));
   expect(responses.map(r=>r.status),'standalone retry z postgres concurrent safe admissions').toEqual(Array(8).fill(200));
   const bodies=await Promise.all(responses.map(r=>r.json()));expect(new Set(bodies.map(b=>b.taskId)).size).toBe(1);expect(bodies[0].taskId).not.toBe('z-old');
   expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(2);
   expect((await query("SELECT amount,task_id FROM wujie_credit_transactions WHERE type='consume'")).rows).toEqual([{amount:-7,task_id:bodies[0].taskId}]);
   expect(Number((await query("SELECT balance FROM wujie_credits WHERE user_id='actor'")).rows[0].balance)).toBe(93);
   expect(await getCloudTaskForUser('z-old','actor')).toEqual(old);expect(state.network).not.toHaveBeenCalled();
  });
 });
 it('retains original document grant through the atomic admission when revoked and regranted during model admission',async()=>{
  await withIsolatedPostgres('z-retry-grant-fence',async({query})=>{
   await seed(query);const initial=await POST(request({...frozen,projectId:'shared',submitOnly:true},'z-original-doc'));expect(initial.status).toBe(200);
   const body=await initial.json();await terminateCloudTaskAndRefund(body.taskId,'failed','合成失败');
   const before=await query('SELECT balance,total_used FROM wujie_credits');
   let hookRan=false;state.beforeCost=async()=>{hookRan=true;state.beforeCost=undefined;await query("UPDATE wujie_project_document_editors SET status='active',grant_generation=grant_generation+2 WHERE project_id='shared'");};
   const response=await POST(retry(body.taskId,'shared'));
   expect(hookRan,'grant rejection must be after the real model-admission boundary').toBe(true);expect(response.status,'standalone retry z postgres original grant is not replaced').toBe(403);
   expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(1);expect((await query('SELECT balance,total_used FROM wujie_credits')).rows).toEqual(before.rows);expect(state.network).not.toHaveBeenCalled();
  });
 });
});
