import {isDeepStrictEqual} from 'node:util';
import type {ExecutionResult,Workflow,WorkflowNode} from '@/lib/workflow-engine';
import {resolveWorkflowInputImageForActor} from '@/lib/asset-core/workflow-resolver';
import {readWorkflowImageInputTransform,selectWorkflowImageUpstream,type WorkflowImageInputTransform,type WorkflowImageUpstream} from './workflow-image-receiver';

export interface WorkflowImageSourceContext {projectId:string;workspaceId:string;entityId:string;requireManagedAsset?:boolean;bindPlacement?:false}
export interface ResolvedWorkflowImageSource {image:Record<string,unknown>;transform:WorkflowImageInputTransform|null}

const referenceKeys=['projectId','assetId','assetVersionId','placementId','imageUrl'] as const;
function nonempty(value:unknown):value is string {return typeof value==='string'&&value.trim().length>0;}

function targetNode(workflow:Workflow,nodeId:string):WorkflowNode {
  const nodes=workflow.nodes.filter(node=>node.id===nodeId);
  if(nodes.length!==1||nodes[0].type!=='input-image')throw new TypeError('WORKFLOW_IMAGE_SOURCE_SCOPE_INVALID');
  return nodes[0];
}

function bindingSnapshot(context:Readonly<WorkflowImageSourceContext>):WorkflowImageSourceContext {
  return {projectId:context.projectId,workspaceId:context.workspaceId,entityId:context.entityId,
    ...(context.requireManagedAsset===undefined?{}:{requireManagedAsset:context.requireManagedAsset}),
    ...(context.bindPlacement===undefined?{}:{bindPlacement:context.bindPlacement})};
}

function referenceIdentity(config:Record<string,unknown>):Record<string,unknown> {
  return Object.fromEntries(referenceKeys.map(key=>[key,config[key]]));
}

function targetIdentity(node:WorkflowNode):Record<string,unknown> {
  const transform=readWorkflowImageInputTransform(node);
  return {id:node.id,type:node.type,source:node.config.source,projectId:node.config.projectId,transform,
    // Upstream mode's cached image tuple is presentation only, never authority.
    ...(transform?{}:{reference:referenceIdentity(node.config)})};
}

function upstreamConfig(upstream:WorkflowImageUpstream,projectId:string):Record<string,unknown> {
  const output=upstream.output;
  for(const key of referenceKeys)if(output[key]!==undefined&&typeof output[key]!=='string')throw new TypeError('WORKFLOW_IMAGE_SOURCE_REFERENCE_INVALID');
  const config:Record<string,unknown>={source:'url',projectId:nonempty(output.projectId)?output.projectId:projectId,
    imageUrl:typeof output.imageUrl==='string'?output.imageUrl:''};
  if(nonempty(output.assetVersionId)){
    config.assetVersionId=output.assetVersionId;
    if(nonempty(output.assetId))config.assetId=output.assetId;
    if(nonempty(output.placementId))config.placementId=output.placementId;
  }
  return config;
}

function upstreamIdentity(upstream:WorkflowImageUpstream,projectId:string):Record<string,unknown> {
  return {sourceNodeId:upstream.sourceNodeId,sourcePortId:upstream.sourcePortId,connectionId:upstream.connectionId,reference:upstreamConfig(upstream,projectId)};
}

/** Source authorization only; a grid transform must be processed before publication. */
export async function resolveWorkflowImageSourceForActor(actorUserId:string,workflow:Workflow,nodeId:string,results:ReadonlyMap<string,ExecutionResult>,context:Readonly<WorkflowImageSourceContext>,signal?:AbortSignal):Promise<ResolvedWorkflowImageSource> {
  signal?.throwIfAborted();
  const binding=bindingSnapshot(context);
  if(!nonempty(actorUserId)||![binding.projectId,binding.workspaceId,binding.entityId].every(nonempty)||binding.entityId!==nodeId
    ||(binding.requireManagedAsset!==undefined&&typeof binding.requireManagedAsset!=='boolean')
    ||(binding.bindPlacement!==undefined&&binding.bindPlacement!==false))throw new TypeError('WORKFLOW_IMAGE_SOURCE_SCOPE_INVALID');
  const snapshot=structuredClone(targetNode(workflow,nodeId));
  if(snapshot.config.projectId!==undefined&&snapshot.config.projectId!==''&&snapshot.config.projectId!==binding.projectId)
    throw new Error('工作流图片输入不属于当前项目');
  const identity=targetIdentity(snapshot),transform=readWorkflowImageInputTransform(snapshot);
  const upstream=transform?selectWorkflowImageUpstream(workflow,nodeId,results):null;
  const sourceIdentity=upstream?upstreamIdentity(upstream,binding.projectId):null;
  const sourceNode=upstream?{...snapshot,config:upstreamConfig(upstream,binding.projectId)}:snapshot;
  // Runtime preparation reads without replacing a target slot. The final parent
  // transaction owns that replacement; the existing default binding stays intact.
  // Never retry authorization errors through another resolver or cached URL.
  const image=await resolveWorkflowInputImageForActor(actorUserId,sourceNode,transform?.kind==='grid'||binding.bindPlacement===false?{...binding,bindPlacement:false}:binding);
  signal?.throwIfAborted();
  try {
    if(!isDeepStrictEqual(bindingSnapshot(context),binding)||!isDeepStrictEqual(targetIdentity(targetNode(workflow,nodeId)),identity))
      throw new Error('WORKFLOW_IMAGE_SOURCE_CHANGED');
    if(upstream&&!isDeepStrictEqual(upstreamIdentity(selectWorkflowImageUpstream(workflow,nodeId,results),binding.projectId),sourceIdentity))
      throw new Error('WORKFLOW_IMAGE_SOURCE_CHANGED');
  } catch {
    throw new Error('WORKFLOW_IMAGE_SOURCE_CHANGED');
  }
  // Await the real resolver receipt even when cancelled; its existing transaction
  // owns its cleanup. This result is not an executed/persisted grid tile.
  return {image,transform};
}
