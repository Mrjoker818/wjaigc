import 'server-only';
import type {Workflow,ExecutionResult} from '@/lib/workflow-engine';
import {authorizeGenerationProject} from '@/lib/collaboration/generation-project-access';
import {createPostgresAssetStorage} from '@/lib/asset-core/storage';
import {resolveWorkflowImageSourceForActor} from './workflow-image-source';
import {prepareAndPublishWorkflowImageReference,prepareAndPublishWorkflowImageCell,workflowImageCellPreparationIdentity} from './workflow-image-preparation';
import type {WorkflowImageMediaInput} from './workflow-image-media';
import {publishPreparedWorkflowImageReference} from './workflow-image-reference-runtime';
import {publishPreparedPersonalWorkflowImageCell,workflowImageRuntimeOperationId,workflowImageRuntimeTarget,type WorkflowImageRuntimeTargetExpectation} from './workflow-image-runtime-publication';
import {publishPreparedDocumentWorkflowImageCell} from './workflow-image-document-runtime-publication';
import type {WorkflowImageExecutionFenceInput} from './workflow-image-execution-fence';
export type WorkflowImageInputExecutionOutcome={status:'committed';nodeResult:ExecutionResult;revision:number}|{status:'unknown';error:unknown};
export async function executeWorkflowImageInputForActor(workflow:Workflow,results:ReadonlyMap<string,ExecutionResult>,execution:WorkflowImageExecutionFenceInput,signal:AbortSignal):Promise<WorkflowImageInputExecutionOutcome>{
  const target=workflowImageRuntimeTarget(execution),node=workflow.nodes.find(entry=>entry.id===execution.nodeId);
  if(!node||workflow.id!==execution.workflowId)throw new Error('WORKFLOW_IMAGE_RUNTIME_SCOPE_INVALID');
  const source=await resolveWorkflowImageSourceForActor(execution.actorUserId,workflow,execution.nodeId,results,
    {projectId:execution.projectId,workspaceId:execution.workflowId,entityId:execution.nodeId,bindPlacement:false,requireManagedAsset:workflow.nodes.some(entry=>entry.type==='ai-skill')},signal);
  if(!source.transform)throw new Error('WORKFLOW_IMAGE_RECEIVER_INVALID');
  const reference:WorkflowImageMediaInput['reference']={};
  for(const key of ['projectId','assetId','assetVersionId','placementId','imageUrl'] as const){const value=source.image[key];if(value!==undefined){if(typeof value!=='string')throw new Error('WORKFLOW_IMAGE_SOURCE_REFERENCE_INVALID');reference[key]=value;}}
  const input={actorUserId:execution.actorUserId,projectId:execution.projectId,workspaceId:target.workspaceId,entityId:target.entityId,
    requireManagedAsset:workflow.nodes.some(entry=>entry.type==='ai-skill'),reference,operationId:workflowImageRuntimeOperationId(execution)};
  if(source.transform.kind==='identity'){
    const result=await prepareAndPublishWorkflowImageReference(input,(prepared,active)=>publishPreparedWorkflowImageReference(prepared,execution,active),{signal});
    return result.status==='committed'?{status:'committed',nodeResult:result.value.nodeResult,revision:result.value.revision}:{status:'unknown',error:result.error};
  }
  const access=await authorizeGenerationProject({actorUserId:execution.actorUserId,projectId:execution.projectId});signal.throwIfAborted();
  if(access.kind==='unscoped')throw new Error('WORKFLOW_IMAGE_RUNTIME_SCOPE_INVALID');
  let expectedTarget:WorkflowImageRuntimeTargetExpectation|null=null;
  if(access.kind==='personal'){
    const placement=await createPostgresAssetStorage().read(transaction=>transaction.findActivePlacement(execution.actorUserId,execution.projectId,'workflow',target.workspaceId,'workflow-input',target.entityId));
    if(placement)expectedTarget={placementId:placement.id,assetId:placement.assetId,assetVersionId:placement.assetVersionId};
  }else{
    const loop=execution.loop,previous=loop?results.get(execution.nodeId):undefined;
    if(loop&&previous?.status==='success'){
      const output=previous.output,raw=output?.imageInput;
      const marker=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:undefined;
      const rawCell=marker?.cell,cell=rawCell&&typeof rawCell==='object'&&!Array.isArray(rawCell)?rawCell as Record<string,unknown>:undefined;
      const preceding=loop.index>1?workflowImageRuntimeOperationId({...execution,loop:{...loop,index:loop.index-1}}):undefined;
      const values=[output?.placementId,output?.assetId,output?.assetVersionId,output?.entityId];
      const validId=(value:unknown):boolean=>typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value&&!/\p{Cc}/u.test(value);
      if(previous.nodeId!==execution.nodeId||output?.projectId!==execution.projectId||marker?.version!==1||typeof marker.operationId!=='string'
        ||!validId(marker.parentVersionId)||!cell||Object.keys(cell).sort().join(',')!=='column,columns,height,index,left,row,rows,top,width'
        ||!Object.values(cell).every(value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)
        ||cell.columns!==source.transform.columns||cell.rows!==source.transform.rows||cell.column!==source.transform.column||cell.row!==source.transform.row
        ||cell.index!==source.transform.row*source.transform.columns+source.transform.column||Number(cell.width)<1||Number(cell.height)<1
        ||!Number.isSafeInteger(Number(cell.left)+Number(cell.width))||!Number.isSafeInteger(Number(cell.top)+Number(cell.height))
        ||marker.operationId!==input.operationId&&marker.operationId!==preceding
        ||!values.every(validId))throw new Error('WORKFLOW_IMAGE_TARGET_CHANGED');
      expectedTarget={placementId:String(values[0]),assetId:String(values[1]),assetVersionId:String(values[2])};
    }else{
      const values=[node.config.placementId,node.config.assetId,node.config.assetVersionId],present=values.map(value=>typeof value==='string'&&value.length>0);
      if(present.some(Boolean)&&!present.every(Boolean))throw new Error('WORKFLOW_IMAGE_TARGET_CHANGED');
      if(present.every(Boolean))expectedTarget={placementId:String(values[0]),assetId:String(values[1]),assetVersionId:String(values[2])};
    }
  }
  const transform=source.transform,expectation={execution,expectedTarget};
  const result=await prepareAndPublishWorkflowImageCell({...input,targetNodeId:target.entityId,columns:transform.columns,rows:transform.rows,column:transform.column,row:transform.row},async(prepared,active)=>{
    const actual=workflowImageCellPreparationIdentity(prepared).source.access;
    if(actual.kind!==access.kind||actual.ownerId!==access.ownerId)throw new Error('WORKFLOW_IMAGE_MEDIA_SOURCE_CHANGED');
    return actual.kind==='document'?publishPreparedDocumentWorkflowImageCell(prepared,expectation,active):publishPreparedPersonalWorkflowImageCell(prepared,expectation,active);
  },{signal});
  return result.status==='committed'?{status:'committed',nodeResult:result.value.nodeResult,revision:result.value.revision}:{status:'unknown',error:result.error};
}
