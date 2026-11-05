import 'server-only';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {getPool} from '@/lib/db-client';
import {getAgentExecutionFence,type AgentExecutionFence} from '@/lib/agent-runtime/execution-fence';
import {AssetService,type CreateAssetVersionInput} from '@/lib/asset-core/service';
import {createAssetStorageTransaction,type AssetStorage,type AssetStorageTransaction} from '@/lib/asset-core/storage';
import {readManagedAssetVersionBytes} from '@/lib/asset-core/managed-media-read';
import type {AssetVersion,WorkspacePlacement,AssetFile} from '@/lib/asset-core/types';
import {resolveInlineSubgraph,type Workflow,type ExecutionResult} from '@/lib/workflow-engine';
import {assertWorkflowImageExecutionInTransaction,type WorkflowImageExecutionFenceInput,type WorkflowImageExecutionFenceSnapshot} from './workflow-image-execution-fence';
import {workflowImageCellPreparationIdentity,assertWorkflowImageCellPreparationInTransaction,type WorkflowImageCellPreparationIdentity,type PreparedWorkflowImageCell,type WorkflowImageGridPublication} from './workflow-image-preparation';
import {selectWorkflowImageUpstream,readWorkflowImageInputTransform} from './workflow-image-receiver';
import type {WorkflowImagePublicationDependencies} from './workflow-image-publication';
export interface WorkflowImageRuntimeTargetExpectation {placementId:string;assetId:string;assetVersionId:string}
export interface WorkflowImageCellRuntimeExpectation {execution:WorkflowImageExecutionFenceInput;expectedTarget:WorkflowImageRuntimeTargetExpectation|null}
export type WorkflowImageLogicalExecution=Pick<WorkflowImageExecutionFenceInput,'actorUserId'|'projectId'|'workflowId'|'parentExecutionId'|'nodeId'|'subgraphPath'|'attempt'|'loop'|'expectedGraph'>;
export interface WorkflowImageCellReceiptExpectation {execution:WorkflowImageLogicalExecution;expectedTarget:WorkflowImageRuntimeTargetExpectation|null}
export interface WorkflowImageRuntimePublicationValue {projectId:string;workflowId:string;operationId:string;parentVersionId:string;nodeResult:ExecutionResult;revision:number}
export type PersonalWorkflowImageCellPublication=WorkflowImageGridPublication<WorkflowImageRuntimePublicationValue>&{connectionErrors?:readonly unknown[]};
type Identity=WorkflowImageCellPreparationIdentity;
interface Intent {root:string;digest:string;parentKey:string;parentDigest:string;childKey:string;childDigest:string}
interface Replay {version:AssetVersion;placement:WorkspacePlacement;legacyParent:AssetVersion|null;parentVersionId:string;nodeResult:ExecutionResult;checkpointMatches:boolean}
type Attempt=PersonalWorkflowImageCellPublication|{status:'verify-media';snapshot:Replay};
const digest=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function invalid():never {throw new Error('WORKFLOW_IMAGE_RUNTIME_PUBLICATION_INVALID');}
function changed():never {throw new Error('WORKFLOW_IMAGE_TARGET_CHANGED');}
function lost():never {throw new Error('WORKFLOW_EXECUTION_FENCE_LOST');}
function conflict():never {throw new Error('WORKFLOW_IMAGE_RUNTIME_IDEMPOTENCY_CONFLICT');}
function object(value:unknown):Record<string,unknown>|undefined {return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function id(value:unknown):value is string {return typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value&&!/\p{Cc}/u.test(value);}
function logicalIdentity(execution:WorkflowImageLogicalExecution):unknown[] {
  if(!execution||![execution.actorUserId,execution.projectId,execution.workflowId,execution.parentExecutionId,execution.nodeId].every(id)
    ||!Array.isArray(execution.subgraphPath)||execution.subgraphPath.length>3||!Number.isSafeInteger(execution.attempt)||execution.attempt<0)invalid();
  for(let index=0;index<execution.subgraphPath.length;index++)if(!id(execution.subgraphPath[index]))invalid();
  if(execution.loop&&(!id(execution.loop.nodeId)||!Number.isSafeInteger(execution.loop.index)||execution.loop.index<1||execution.loop.index>100))invalid();
  return [execution.actorUserId,execution.projectId,execution.workflowId,execution.parentExecutionId,execution.subgraphPath,execution.nodeId,execution.attempt,execution.loop??null];
}
/** Logical operation identity excludes replaceable worker leases and revisions. */
export function workflowImageRuntimeOperationId(execution:WorkflowImageLogicalExecution):string {
  return 'workflow-input:v1:'+digest(logicalIdentity(execution));
}
export function workflowImageRuntimeTarget(execution:WorkflowImageLogicalExecution):{workspaceId:string;entityId:string} {
  logicalIdentity(execution);
  const slot=(path:readonly string[],nodeId:string):string=>path.length?'workflow-input:'+digest([execution.workflowId,path,nodeId]):nodeId;
  const entityId=slot(execution.subgraphPath,execution.nodeId);let matches=0;
  const walk=(graph:WorkflowImageExecutionFenceInput['expectedGraph'],path:readonly string[]):void=>{
    if(!graph||!Array.isArray(graph.nodes))invalid();
    for(const node of graph.nodes){
      if(node.type==='input-image'&&slot(path,node.id)===entityId)matches++;
      if(node.type==='subgraph'&&path.length<3){const nested=resolveInlineSubgraph(node);if(nested)walk(nested,[...path,node.id]);}
    }
  };
  walk(execution.expectedGraph,[]);
  if(matches>1)throw new Error('WORKFLOW_IMAGE_RUNTIME_TARGET_COLLISION');
  return {workspaceId:execution.workflowId,entityId};
}
function intent(identity:Identity,held:WorkflowImageCellReceiptExpectation):Intent {
  const {input,source}=identity,execution=held.execution,target=workflowImageRuntimeTarget(execution);
  if(source.access.kind!=='personal'||source.access.actorUserId!==execution.actorUserId||source.access.ownerId!==execution.actorUserId
    ||source.access.projectId!==execution.projectId||input.actorUserId!==execution.actorUserId||input.projectId!==execution.projectId
    ||input.workspaceId!==target.workspaceId||input.entityId!==target.entityId||input.targetNodeId!==target.entityId
    ||input.operationId!==workflowImageRuntimeOperationId(execution)||source.input.entityId!==target.entityId
    ||source.input.workspaceId!==target.workspaceId||source.input.actorUserId!==execution.actorUserId||source.input.projectId!==execution.projectId)invalid();
  if(held.expectedTarget!==null&&(!object(held.expectedTarget)||Object.keys(held.expectedTarget).sort().join(',')!=='assetId,assetVersionId,placementId'
    ||![held.expectedTarget.assetId,held.expectedTarget.assetVersionId,held.expectedTarget.placementId].every(id)))invalid();
  const sourceIdentity={assetId:source.version?.assetId??null,versionId:source.version?.id??null,placementId:source.reference?.placementId??null,
    sha256:source.sha256,urlDigest:source.version?null:digest(source.input.reference.imageUrl)};
  const requestDigest=digest({schema:'workflow-image-runtime-cell/v1',operationId:input.operationId,source:sourceIdentity,
    columns:input.columns,rows:input.rows,column:input.column,row:input.row,cell:identity.tile.cell,target});
  const root='workflow-image-runtime:v1:'+digest([input.actorUserId,input.projectId,input.operationId]);
  return {root,digest:requestDigest,parentKey:root+':source',parentDigest:digest([requestDigest,'source',source.sha256]),
    childKey:root+':cell',childDigest:digest([requestDigest,'cell',identity.tile.file.checksum])};
}
function metadata(identity:Identity,op:Intent,role:'legacy-source'|'cell'):Record<string,unknown> {
  return {schema:'workflow-image-runtime-cell/v1',rootKey:op.root,operationDigest:op.digest,operationId:identity.input.operationId,
    sourceSha256:identity.source.sha256,role,...(role==='cell'?{targetEntityId:identity.input.targetNodeId,cell:identity.tile.cell}:{})};
}
function agentCondition(start:number):string {
  // Preserve the original cloud-task active-generation semantics on this client.
  return `(NOT EXISTS (SELECT 1 FROM wujie_agent_execution_leases bound_agent WHERE bound_agent.task_id=cloud_tasks.id AND bound_agent.completed_at=0)
    OR ($${start}::text<>'' AND EXISTS (SELECT 1 FROM wujie_agent_execution_leases agent_lease WHERE agent_lease.task_id=cloud_tasks.id
      AND agent_lease.task_id=$${start} AND agent_lease.lease_owner=$${start+1} AND agent_lease.generation=$${start+2}
      AND agent_lease.paused_at=0 AND agent_lease.completed_at=0)))`;
}
function agentParams(fence:AgentExecutionFence|undefined):unknown[] {return fence?[fence.runId,fence.leaseOwner,fence.generation]:['','',-1];}
async function parentState(client:PoolClient,execution:WorkflowImageExecutionFenceInput,agent:AgentExecutionFence|undefined):Promise<Record<string,unknown>> {
  const selected=await client.query(`SELECT result FROM cloud_tasks WHERE id=$1 AND user_id=$2 AND ${agentCondition(3)}`,
    [execution.parentExecutionId,execution.actorUserId,...agentParams(agent)]);
  const result=object(selected.rows[0]?.result);if(selected.rows.length!==1||!result)lost();return result;
}
function durableSource(identity:Identity,execution:WorkflowImageExecutionFenceInput,result:Record<string,unknown>):Record<string,unknown> {
  let graph=execution.expectedGraph,local=result,executionId=execution.parentExecutionId;
  for(const container of execution.subgraphPath){
    const node=graph.nodes.find(entry=>entry.id===container),next=node?resolveInlineSubgraph(node):null;
    executionId+=':'+container;const nested=object(object(result.sketchNested)?.[executionId]);
    if(!next||!nested)lost();graph=next;local=nested;
  }
  const target=graph.nodes.find(node=>node.id===execution.nodeId),transform=target?readWorkflowImageInputTransform(target):null;
  const different=():never=>{throw new Error('WORKFLOW_IMAGE_DURABLE_SOURCE_CHANGED');};
  if(!transform||transform.kind!=='grid'||transform.columns!==identity.input.columns||transform.rows!==identity.input.rows
    ||transform.column!==identity.input.column||transform.row!==identity.input.row)different();
  const results=object(local.results);if(!results)lost();
  const workflow:Workflow={id:execution.workflowId,name:'Runtime',version:'1',status:'idle',createdAt:0,updatedAt:0,...graph};
  const upstream=selectWorkflowImageUpstream(workflow,execution.nodeId,new Map(Object.entries(results as Record<string,ExecutionResult>))).output;
  if(upstream.projectId!==undefined&&upstream.projectId!==identity.input.projectId)different();
  if(identity.source.version){
    if(upstream.assetVersionId!==identity.source.version.id
      ||upstream.assetId!==undefined&&upstream.assetId!==''&&upstream.assetId!==identity.source.version.assetId
      ||upstream.placementId!==undefined&&upstream.placementId!==''&&upstream.placementId!==identity.source.reference?.placementId)different();
  }else if(upstream.assetVersionId||upstream.assetId||upstream.placementId||upstream.imageUrl!==identity.source.input.reference.imageUrl)different();
  return local;
}
function storageOn(transaction:AssetStorageTransaction):AssetStorage {return {read:async callback=>callback(transaction),transaction:async callback=>callback(transaction)};}
async function targetPlacement(transaction:AssetStorageTransaction,identity:Identity):Promise<WorkspacePlacement|null> {
  const {actorUserId,projectId,workspaceId,targetNodeId}=identity.input;
  const current=await transaction.findActivePlacement(actorUserId,projectId,'workflow',workspaceId,'workflow-input',targetNodeId);
  if(!current)return null;
  const locked=await transaction.lockPlacement(actorUserId,projectId,current.id);
  if(!locked||!isDeepStrictEqual(locked,current)||locked.status!=='active'||locked.deletedAt!==null
    ||locked.ownerId!==actorUserId||locked.projectId!==projectId||locked.workspace!=='workflow'||locked.workspaceId!==workspaceId
    ||locked.entityType!=='workflow-input'||locked.entityId!==targetNodeId)changed();
  return structuredClone(locked);
}
function assertExpectedTarget(placement:WorkspacePlacement|null,expected:WorkflowImageRuntimeTargetExpectation|null):void {
  if(!placement&&!expected)return;
  if(!placement||!expected||placement.id!==expected.placementId||placement.assetId!==expected.assetId||placement.assetVersionId!==expected.assetVersionId)changed();
}
function matchFile(version:AssetVersion,file:AssetFile):void {
  if(version.file.availability!=='ready'||version.file.checksum!==file.checksum||version.file.mimeType!==file.mimeType
    ||version.file.byteSize!==file.byteSize||version.file.width!==file.width||version.file.height!==file.height)conflict();
}
async function lockedVersion(client:PoolClient,transaction:AssetStorageTransaction,identity:Identity,key:string,digestValue:string,version:AssetVersion):Promise<void> {
  const {actorUserId,projectId}=identity.input,asset=await transaction.lockAsset(actorUserId,projectId,version.assetId);
  if(!asset||asset.status!=='active'||asset.kind!=='image'||version.ownerId!==actorUserId||version.projectId!==projectId)changed();
  const locked=await client.query(`SELECT v.id FROM wujie_asset_versions v JOIN wujie_assets a ON a.id=v.asset_id AND a.owner_id=v.owner_id AND a.project_id=v.project_id
    WHERE v.id=$1 AND v.asset_id=$2 AND v.owner_id=$3 AND v.project_id=$4 FOR SHARE OF v,a`,[version.id,version.assetId,actorUserId,projectId]);
  const current=await transaction.findVersionByIdempotency(actorUserId,projectId,key);
  if(locked.rows.length!==1||!current||current.requestDigest!==digestValue||!isDeepStrictEqual(current.version,version))conflict();
}
function nodeResult(identity:Identity,execution:WorkflowImageLogicalExecution,parentVersionId:string,version:AssetVersion,placement:WorkspacePlacement,durationMs=0):ExecutionResult {
  return {nodeId:execution.nodeId,status:'success',durationMs,output:{_type:'input-image',projectId:identity.input.projectId,imageUrl:version.file.url,
    assetId:version.assetId,assetVersionId:version.id,placementId:placement.id,entityId:placement.entityId,
    imageInput:{version:1,operationId:identity.input.operationId,parentVersionId,cell:structuredClone(identity.tile.cell)}}};
}
function existingCheckpoint(local:Record<string,unknown>,expected:ExecutionResult):ExecutionResult|null {
  const actual=object(object(local.results)?.[expected.nodeId]);
  return actual?.nodeId===expected.nodeId&&actual.status==='success'&&typeof actual.durationMs==='number'&&Number.isFinite(actual.durationMs)
    &&actual.durationMs>=0&&isDeepStrictEqual(actual.output,expected.output)?{...expected,durationMs:actual.durationMs}:null;
}
async function inspect(client:PoolClient,transaction:AssetStorageTransaction,identity:Identity,held:WorkflowImageCellReceiptExpectation,op:Intent,local:Record<string,unknown>):Promise<Replay|null> {
  const {actorUserId,projectId}=identity.input;
  const parent=identity.source.version?null:await transaction.findVersionByIdempotency(actorUserId,projectId,op.parentKey);
  const child=await transaction.findVersionByIdempotency(actorUserId,projectId,op.childKey);
  if(!child){if(parent)throw new Error('WORKFLOW_IMAGE_RUNTIME_PARTIAL_REPLAY');return null;}
  if(child.requestDigest!==op.childDigest||!identity.source.version&&!parent)conflict();
  const parentVersionId=identity.source.version?.id??parent!.version.id;
  if(parent){
    if(parent.requestDigest!==op.parentDigest||!identity.legacyParentFile)conflict();
    await lockedVersion(client,transaction,identity,op.parentKey,op.parentDigest,parent.version);
    if(!isDeepStrictEqual(parent.version.metadata?.workflowImageRuntimeCell,metadata(identity,op,'legacy-source'))||parent.version.parentVersionIds.length!==0)conflict();
    matchFile(parent.version,identity.legacyParentFile);
  }
  await lockedVersion(client,transaction,identity,op.childKey,op.childDigest,child.version);
  if(!isDeepStrictEqual(child.version.parentVersionIds,[parentVersionId])
    ||!isDeepStrictEqual(child.version.metadata?.workflowImageRuntimeCell,metadata(identity,op,'cell')))conflict();
  matchFile(child.version,identity.tile.file);
  const placement=await targetPlacement(transaction,identity);
  if(!placement||placement.assetId!==child.version.assetId||placement.assetVersionId!==child.version.id)changed();
  const expected=nodeResult(identity,held.execution,parentVersionId,child.version,placement),checkpoint=existingCheckpoint(local,expected);
  return {version:structuredClone(child.version),placement,legacyParent:parent?structuredClone(parent.version):null,parentVersionId,
    nodeResult:checkpoint??expected,checkpointMatches:checkpoint!==null};
}
/** Existing immutable receipts only. This does not acquire a worker lease or repair a checkpoint. */
export async function readPersonalWorkflowImageCellReceiptInTransaction(client:PoolClient,identity:Identity,execution:WorkflowImageLogicalExecution,local:Record<string,unknown>):Promise<ExecutionResult> {
  const held={execution,expectedTarget:null},op=intent(identity,held);
  const replay=await inspect(client,createAssetStorageTransaction(client),identity,held,op,local);
  if(!replay?.checkpointMatches)throw new Error('WORKFLOW_IMAGE_RUNTIME_CHECKPOINT_UNCONFIRMED');
  return replay.nodeResult;
}
async function checkpoint(client:PoolClient,fence:WorkflowImageExecutionFenceSnapshot,result:ExecutionResult,agent:AgentExecutionFence|undefined):Promise<number> {
  const updated=await client.query(`UPDATE cloud_tasks SET result=jsonb_set(result,$7::text[],$8::jsonb,true),revision=revision+1,
    updated_at=(EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint
    WHERE id=$1 AND user_id=$2 AND project_id=$3 AND type='workflow' AND status='processing' AND revision=$4
      AND lease_owner=$5 AND attempt_count=$6 AND lease_expires_at>(EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint
      AND result->>'workflowStatus'='running' AND result->'dispatchStopped' IS DISTINCT FROM 'true'::jsonb AND ${agentCondition(9)}
    RETURNING revision`,[fence.parentExecutionId,fence.actorUserId,fence.projectId,fence.revision,fence.leaseOwner,fence.leaseAttemptCount,
      fence.resultPath,JSON.stringify(result),...agentParams(agent)]);
  if(updated.rowCount!==1||updated.rows.length!==1||updated.rows[0].revision!==fence.revision+1)lost();return updated.rows[0].revision as number;
}
function publicationValue(identity:Identity,execution:WorkflowImageExecutionFenceInput,replay:Replay,revision:number):WorkflowImageRuntimePublicationValue {
  return {projectId:identity.input.projectId,workflowId:execution.workflowId,operationId:identity.input.operationId,parentVersionId:replay.parentVersionId,
    nodeResult:replay.nodeResult,revision};
}
function retained(identity:Identity,replay:Replay):string[] {
  const actual=new Set([replay.version.file.url,...(replay.legacyParent?[replay.legacyParent.file.url]:[])]);
  return [identity.tile.file.url,...(identity.legacyParentFile?[identity.legacyParentFile.url]:[])].filter(url=>actual.has(url));
}
async function verifyMedia(replay:Replay,signal:AbortSignal,read:typeof readManagedAssetVersionBytes):Promise<void> {
  for(const version of [...(replay.legacyParent?[replay.legacyParent]:[]),replay.version]){
    signal.throwIfAborted();const media=await read(version,'image',{signal,maxBytes:32*1024*1024});signal.throwIfAborted();
    if(media.mimeType!==version.file.mimeType||media.bytes.length!==version.file.byteSize||media.totalBytes!==media.bytes.length
      ||createHash('sha256').update(media.bytes).digest('hex')!==version.file.checksum)conflict();
  }
}
/** Actual caller-client publication. Recovery is a read-only reconciliation, never
 * a second creation/binding attempt. A COMMIT exception retains staged files. */
export async function publishPreparedPersonalWorkflowImageCell(prepared:PreparedWorkflowImageCell,expectation:WorkflowImageCellRuntimeExpectation,signal:AbortSignal,dependencies:WorkflowImagePublicationDependencies={}):Promise<PersonalWorkflowImageCellPublication> {
  let identity:Identity,held:WorkflowImageCellRuntimeExpectation,op:Intent;
  try {signal.throwIfAborted();identity=workflowImageCellPreparationIdentity(prepared);held=structuredClone(expectation);op=intent(identity,held);}
  catch(error){return {status:'rolled-back',error};}
  const agent=getAgentExecutionFence(),heldAgent=agent?structuredClone(agent):undefined;
  const connect=dependencies.connect??(()=>getPool().connect()),read=dependencies.readMedia??readManagedAssetVersionBytes,connectionErrors:unknown[]=[];
  async function attempt(mode:'write'|'recover',verified?:Replay):Promise<Attempt>{
    let client:PoolClient|undefined,open=false,commitSent=false,discard=false,closed=false;
    const release=():void=>{if(client&&!closed){closed=true;try{client.release(discard);}catch(error){connectionErrors.push(error);}}};
    try {
      signal.throwIfAborted();client=await connect();signal.throwIfAborted();open=true;await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
      const execution=structuredClone(held.execution);
      if(mode==='recover'){
        const fresh=await client.query('SELECT revision FROM cloud_tasks WHERE id=$1 AND user_id=$2 FOR UPDATE',[execution.parentExecutionId,execution.actorUserId]);
        if(fresh.rows.length!==1||!Number.isSafeInteger(fresh.rows[0].revision))lost();execution.expectedRevision=fresh.rows[0].revision as number;
      }
      const fence=await assertWorkflowImageExecutionInTransaction(client,execution,signal);
      const parent=await parentState(client,execution,heldAgent),local=durableSource(identity,execution,parent);
      await assertWorkflowImageCellPreparationInTransaction(client,prepared,signal);
      const transaction=createAssetStorageTransaction(client),{actorUserId,projectId,workspaceId,targetNodeId}=identity.input;
      for(const key of [op.root,op.childKey,...(!identity.source.version?[op.parentKey]:[])].sort())await transaction.lockVersionIdempotency(actorUserId,projectId,key);
      await transaction.lockWorkspacePlacementSlot(actorUserId,projectId,'workflow',workspaceId,'workflow-input',targetNodeId);signal.throwIfAborted();
      const replay=await inspect(client,transaction,identity,held,op,local);
      if(replay){
        if(!replay.checkpointMatches)throw new Error('WORKFLOW_IMAGE_RUNTIME_CHECKPOINT_UNCONFIRMED');
        if(!verified){await client.query('ROLLBACK');open=false;return {status:'verify-media',snapshot:replay};}
        if(!isDeepStrictEqual(replay,verified))changed();
        const revision=fence.revision;
        signal.throwIfAborted();commitSent=true;await client.query('COMMIT');open=false;
        return {status:'committed',value:publicationValue(identity,execution,replay,revision),retainedFileUrls:retained(identity,replay)};
      }
      if(mode!=='write'){await client.query('ROLLBACK');open=false;return {status:'unknown',error:new Error('WORKFLOW_IMAGE_RUNTIME_PUBLICATION_UNCONFIRMED')};}
      const current=await targetPlacement(transaction,identity);assertExpectedTarget(current,held.expectedTarget);
      // Do not reuse createVersionWithPlacement: its replay path can restore a
      // trashed asset/slot. The runtime replay above is deliberately read-only.
      const service=new AssetService(storageOn(transaction));let parentVersionId=identity.source.version?.id,legacyParent:AssetVersion|null=null;
      if(!parentVersionId){
        if(!identity.legacyParentFile)invalid();
        const parentInput:CreateAssetVersionInput={actorUserId,projectId,kind:'image',file:identity.legacyParentFile,idempotencyKey:op.parentKey,
          requestDigest:op.parentDigest,metadata:{workflowImageRuntimeCell:metadata(identity,op,'legacy-source')}};
        const created=await service.createAssetVersion(parentInput);if(created.reused||created.asset.status!=='active')conflict();
        parentVersionId=created.version.id;legacyParent=created.version;
      }
      const created=await service.createAssetVersion({actorUserId,projectId,kind:'image',file:identity.tile.file,idempotencyKey:op.childKey,
        requestDigest:op.childDigest,parentVersionIds:[parentVersionId],metadata:{workflowImageRuntimeCell:metadata(identity,op,'cell')}});
      if(created.reused||created.asset.status!=='active')conflict();
      const bound=await service.bindWorkflowInputPlacement({actorUserId,projectId,assetVersionId:created.version.id,workspace:'workflow',workspaceId,entityType:'workflow-input',entityId:targetNodeId});
      const node=nodeResult(identity,execution,parentVersionId,created.version,bound.placement);
      const revision=await checkpoint(client,fence,node,heldAgent);signal.throwIfAborted();
      const completed:Replay={version:created.version,placement:bound.placement,legacyParent,parentVersionId,nodeResult:node,checkpointMatches:true};
      commitSent=true;await client.query('COMMIT');open=false;
      return {status:'committed',value:publicationValue(identity,execution,completed,revision),retainedFileUrls:retained(identity,completed)};
    }catch(error){
      if(commitSent){discard=true;release();return {status:'unknown',error};}
      if(open&&client){try{await client.query('ROLLBACK');open=false;}catch(rollbackError){discard=true;return {status:'unknown',error:new AggregateError([error,rollbackError],'WORKFLOW_IMAGE_RUNTIME_ROLLBACK_UNCONFIRMED')};}}
      return {status:'rolled-back',error};
    }finally{release();}
  }
  async function resolved(mode:'write'|'recover'):Promise<PersonalWorkflowImageCellPublication>{
    const first=await attempt(mode);if(first.status!=='verify-media')return first;
    try{await verifyMedia(first.snapshot,signal,read);}catch(error){return {status:'rolled-back',error};}
    const confirmed=await attempt(mode,first.snapshot);
    return confirmed.status==='verify-media'?{status:'unknown',error:new Error('WORKFLOW_IMAGE_RUNTIME_PUBLICATION_UNCONFIRMED')}:confirmed;
  }
  let result=await resolved('write');
  if(result.status==='unknown'){
    const original=result.error;const recovery=await resolved('recover');
    result=recovery.status==='committed'?recovery:{status:'unknown',error:new AggregateError([original,recovery.error],'WORKFLOW_IMAGE_RUNTIME_PUBLICATION_UNCONFIRMED')};
  }
  return connectionErrors.length?{...result,connectionErrors}:result;
}

// Server-internal seams shared by the canonical publisher. These descriptions
// are not authority tokens; the caller must retain the actual parent/client locks.
export {parentState as readWorkflowImageRuntimeParentInTransaction,durableSource as assertWorkflowImageRuntimeDurableSource,
  checkpoint as writeWorkflowImageRuntimeNodeCheckpoint,existingCheckpoint as matchWorkflowImageRuntimeNodeCheckpoint};
