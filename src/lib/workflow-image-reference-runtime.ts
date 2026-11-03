import 'server-only';
import type {PoolClient} from 'pg';
import {getPool} from '@/lib/db-client';
import {getAgentExecutionFence} from '@/lib/agent-runtime/execution-fence';
import {resolveInlineSubgraph,type ExecutionResult,type Workflow} from '@/lib/workflow-engine';
import {assertWorkflowImageExecutionInTransaction,type WorkflowImageExecutionFenceInput} from './workflow-image-execution-fence';
import {readWorkflowImageInputTransform,selectWorkflowImageUpstream} from './workflow-image-receiver';
import {workflowImageRuntimeOperationId,workflowImageRuntimeTarget,readWorkflowImageRuntimeParentInTransaction,
  writeWorkflowImageRuntimeNodeCheckpoint,matchWorkflowImageRuntimeNodeCheckpoint,type WorkflowImageLogicalExecution} from './workflow-image-runtime-publication';
import {workflowImageReferencePreparationIdentity,assertWorkflowImageReferencePreparationInTransaction,revalidateWorkflowImageReferenceBytes,
  type PreparedWorkflowImageReference,type WorkflowImageReferencePreparationIdentity,type WorkflowImageReferencePublication} from './workflow-image-preparation';

export interface WorkflowImageReferenceRuntimeValue {projectId:string;workflowId:string;operationId:string;nodeResult:ExecutionResult;revision:number}
export interface WorkflowImageReferenceRuntimeDependencies {connect?:()=>Promise<PoolClient>}
function object(value:unknown):Record<string,unknown>|undefined{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function lost():never{throw new Error('WORKFLOW_EXECUTION_FENCE_LOST');}
function changed():never{throw new Error('WORKFLOW_IMAGE_DURABLE_SOURCE_CHANGED');}
function scope(identity:WorkflowImageReferencePreparationIdentity,execution:WorkflowImageExecutionFenceInput):void{
  const target=workflowImageRuntimeTarget(execution),input=identity.input,source=identity.source;
  if(input.actorUserId!==execution.actorUserId||input.projectId!==execution.projectId||input.workspaceId!==target.workspaceId||input.entityId!==target.entityId
    ||input.operationId!==workflowImageRuntimeOperationId(execution)||source.access.actorUserId!==execution.actorUserId||source.access.projectId!==execution.projectId
    ||source.input.actorUserId!==input.actorUserId||source.input.projectId!==input.projectId||source.input.workspaceId!==input.workspaceId||source.input.entityId!==input.entityId)
    throw new Error('WORKFLOW_IMAGE_REFERENCE_PUBLICATION_INVALID');
}
function durableSource(identity:WorkflowImageReferencePreparationIdentity,execution:WorkflowImageExecutionFenceInput,parent:Record<string,unknown>):Record<string,unknown>{
  let graph=execution.expectedGraph,local=parent,id=execution.parentExecutionId;
  for(const container of execution.subgraphPath){const node=graph.nodes.find(entry=>entry.id===container),nested=node?resolveInlineSubgraph(node):null;id+=':'+container;
    const child=object(object(parent.sketchNested)?.[id]);if(!nested||!child)lost();graph=nested;local=child;}
  const node=graph.nodes.find(entry=>entry.id===execution.nodeId);if(!node||readWorkflowImageInputTransform(node)?.kind!=='identity')changed();
  const results=object(local.results);if(!results)lost();
  const workflow:Workflow={id:execution.workflowId,name:'Reference runtime',version:'1',status:'idle',createdAt:0,updatedAt:0,...graph};
  const output=selectWorkflowImageUpstream(workflow,execution.nodeId,new Map(Object.entries(results as Record<string,ExecutionResult>))).output;
  if(output.projectId!==undefined&&output.projectId!==execution.projectId)changed();
  if(identity.source.version){
    if(output.assetVersionId!==identity.source.version.id||output.assetId!==undefined&&output.assetId!==''&&output.assetId!==identity.source.version.assetId
      ||output.placementId!==undefined&&output.placementId!==''&&output.placementId!==identity.source.reference?.placementId
      ||output.entityId!==undefined&&output.entityId!==''&&output.entityId!==identity.source.reference?.entityId)changed();
  }else if(output.assetVersionId||output.assetId||output.placementId||output.imageUrl!==identity.source.input.reference.imageUrl)changed();
  return local;
}
export function workflowImageReferenceNodeResult(identity:WorkflowImageReferencePreparationIdentity,execution:WorkflowImageLogicalExecution):ExecutionResult{
  const source=identity.source,reference=source.reference;
  return {nodeId:execution.nodeId,status:'success',durationMs:0,output:{_type:'input-image',projectId:execution.projectId,
    imageUrl:reference?.url??source.input.reference.imageUrl,
    ...(reference?{assetId:reference.assetId,assetVersionId:reference.assetVersionId,
      ...(reference.placementId?{placementId:reference.placementId}:{}),...(reference.entityId?{entityId:reference.entityId}:{})}:{}),
    imageInput:{version:1,kind:'identity',operationId:identity.input.operationId,referenceKind:source.version?'asset-version':'legacy-url',readSha256:source.sha256}}};
}
/** Reference publication writes only the original parent node checkpoint. Source
 * material and placements remain untouched, including in shared documents. */
export async function publishPreparedWorkflowImageReference(prepared:PreparedWorkflowImageReference,expectation:WorkflowImageExecutionFenceInput,signal:AbortSignal,dependencies:WorkflowImageReferenceRuntimeDependencies={}):Promise<WorkflowImageReferencePublication<WorkflowImageReferenceRuntimeValue>>{
  let identity:WorkflowImageReferencePreparationIdentity,held:WorkflowImageExecutionFenceInput;
  try{signal.throwIfAborted();identity=workflowImageReferencePreparationIdentity(prepared);held=structuredClone(expectation);scope(identity,held);}catch(error){return {kind:'reference',status:'rolled-back',error};}
  const activeAgent=getAgentExecutionFence(),agent=activeAgent?structuredClone(activeAgent):undefined,connect=dependencies.connect??(()=>getPool().connect()),connectionErrors:unknown[]=[];
  async function attempt(recover:boolean):Promise<WorkflowImageReferencePublication<WorkflowImageReferenceRuntimeValue>>{
    let client:PoolClient|undefined,open=false,commitSent=false,discard=false,closed=false;
    const release=():void=>{if(client&&!closed){closed=true;try{client.release(discard);}catch(error){connectionErrors.push(error);}}};
    try{
      signal.throwIfAborted();client=await connect();signal.throwIfAborted();open=true;await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
      const execution=structuredClone(held);
      if(recover){const selected=await client.query('SELECT revision FROM cloud_tasks WHERE id=$1 AND user_id=$2 FOR UPDATE',[execution.parentExecutionId,execution.actorUserId]);
        if(selected.rows.length!==1||!Number.isSafeInteger(selected.rows[0].revision)||selected.rows[0].revision<held.expectedRevision)lost();execution.expectedRevision=selected.rows[0].revision as number;}
      const fence=await assertWorkflowImageExecutionInTransaction(client,execution,signal);
      const parent=await readWorkflowImageRuntimeParentInTransaction(client,execution,agent),local=durableSource(identity,execution,parent);
      await assertWorkflowImageReferencePreparationInTransaction(client,prepared,signal);
      if(identity.source.access.kind==='document'){
        const reference=identity.source.reference,version=identity.source.version;if(!reference?.placementId||!reference.entityId||!version)changed();
        const exact=await client.query(`SELECT id FROM wujie_workspace_placements WHERE id=$1 AND owner_id=$2 AND project_id=$3
          AND asset_id=$4 AND asset_version_id=$5 AND entity_id=$6 AND status='active' AND deleted_at IS NULL FOR SHARE`,
        [reference.placementId,identity.source.access.ownerId,execution.projectId,reference.assetId,version.id,reference.entityId]);
        if(exact.rows.length!==1)changed();
      }
      const expected=workflowImageReferenceNodeResult(identity,execution),matched=matchWorkflowImageRuntimeNodeCheckpoint(local,expected),previous=object(object(local.results)?.[execution.nodeId]);
      let result=matched,revision=fence.revision;
      if(!matched){
        if(recover){await client.query('ROLLBACK');open=false;return {kind:'reference',status:'unknown',error:new Error('WORKFLOW_IMAGE_REFERENCE_CHECKPOINT_UNCONFIRMED')};}
        if(previous?.status==='success'){
          const marker=object(object(previous.output)?.imageInput);
          if(marker?.operationId===identity.input.operationId||execution.attempt===0&&!execution.loop)throw new Error('WORKFLOW_IMAGE_REFERENCE_CHECKPOINT_CONFLICT');
        }
        result=expected;revision=await writeWorkflowImageRuntimeNodeCheckpoint(client,fence,result,agent);
      }
      signal.throwIfAborted();commitSent=true;await client.query('COMMIT');open=false;
      return {kind:'reference',status:'committed',value:{projectId:execution.projectId,workflowId:execution.workflowId,operationId:identity.input.operationId,nodeResult:result!,revision}};
    }catch(error){
      if(commitSent){discard=true;release();return {kind:'reference',status:'unknown',error};}
      if(open&&client){try{await client.query('ROLLBACK');open=false;}catch(rollbackError){discard=true;return {kind:'reference',status:'unknown',error:new AggregateError([error,rollbackError],'WORKFLOW_IMAGE_REFERENCE_ROLLBACK_UNCONFIRMED')};}}
      return {kind:'reference',status:'rolled-back',error};
    }finally{release();}
  }
  let result=await attempt(false);
  if(result.status==='unknown'){
    const initial=result.error;
    try{await revalidateWorkflowImageReferenceBytes(prepared);const recovered=await attempt(true);
      result=recovered.status==='committed'?recovered:{kind:'reference',status:'unknown',error:new AggregateError([initial,recovered.error],'WORKFLOW_IMAGE_REFERENCE_PUBLICATION_UNCONFIRMED')};
    }catch(error){result={kind:'reference',status:'unknown',error:new AggregateError([initial,error],'WORKFLOW_IMAGE_REFERENCE_PUBLICATION_UNCONFIRMED')};}
  }
  return connectionErrors.length?{...result,connectionErrors}:result;
}
