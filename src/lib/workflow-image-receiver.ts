import {canConnectPorts,type ExecutionResult,type Workflow,type WorkflowNode} from '@/lib/workflow-engine';
import {assertWorkflowImageGridShape} from './workflow-image-actions';

export type WorkflowImageInputTransform={version:1;kind:'identity'}|{version:1;kind:'grid';columns:number;rows:number;column:number;row:number};
export interface WorkflowImageUpstream {sourceNodeId:string;sourcePortId:string;connectionId:string;output:Record<string,unknown>}

function isRecord(value:unknown):value is Record<string,unknown> {
  return value!==null&&typeof value==='object'&&!Array.isArray(value);
}

function isNonemptyString(value:unknown):value is string {
  return typeof value==='string'&&value.trim().length>0;
}

/** Explicit receiver metadata never changes ordinary upload/URL input behavior. */
export function readWorkflowImageInputTransform(node:WorkflowNode):WorkflowImageInputTransform|null {
  if(node.type!=='input-image'||node.config.source!=='upstream')return null;
  const value=node.config.imageInputTransform;
  if(!isRecord(value)||value.version!==1)throw new TypeError('WORKFLOW_IMAGE_RECEIVER_INVALID');
  const keys=Object.keys(value).sort().join(',');
  if(value.kind==='identity'&&keys==='kind,version')return {version:1,kind:'identity'};
  if(value.kind==='grid'&&keys==='column,columns,kind,row,rows,version'){
    const {columns,rows,column,row}=value;
    if(typeof columns==='number'&&typeof rows==='number'&&typeof column==='number'&&typeof row==='number'){
      try {assertWorkflowImageGridShape(columns,rows);}
      catch {throw new TypeError('WORKFLOW_IMAGE_RECEIVER_INVALID');}
      if(Number.isSafeInteger(column)&&Number.isSafeInteger(row)&&column>=0&&column<columns&&row>=0&&row<rows)
        return {version:1,kind:'grid',columns,rows,column,row};
    }
  }
  throw new TypeError('WORKFLOW_IMAGE_RECEIVER_INVALID');
}

/** Validate graph provenance only. The caller must reauthorize the asset reference. */
export function selectWorkflowImageUpstream(workflow:Workflow,nodeId:string,results:ReadonlyMap<string,ExecutionResult>):WorkflowImageUpstream {
  const targets=workflow.nodes.filter(node=>node.id===nodeId),target=targets[0];
  if(targets.length!==1||!readWorkflowImageInputTransform(target))throw new TypeError('WORKFLOW_IMAGE_RECEIVER_INVALID');
  const inputs=target.ports.filter(port=>port.id==='in-image');
  const blocked=target.config.blockedInputs;
  if(inputs.length!==1||inputs[0].direction!=='in'||inputs[0].type!=='image'
    ||(blocked!==undefined&&(!Array.isArray(blocked)||!blocked.every(isNonemptyString))))
    throw new TypeError('WORKFLOW_IMAGE_RECEIVER_INVALID');
  const blockedIds=new Set<string>(blocked as string[]|undefined);
  const incoming=workflow.connections.filter(connection=>connection.toNodeId===nodeId&&connection.toPortId===inputs[0].id&&!blockedIds.has(connection.id));
  if(incoming.length===0)throw new Error('WORKFLOW_IMAGE_UPSTREAM_MISSING');
  if(incoming.length!==1)throw new Error('WORKFLOW_IMAGE_UPSTREAM_AMBIGUOUS');
  const connection=incoming[0],sources=workflow.nodes.filter(node=>node.id===connection.fromNodeId),source=sources[0];
  if(connection.fromNodeId===nodeId||sources.length!==1||!isNonemptyString(connection.id))throw new TypeError('WORKFLOW_IMAGE_UPSTREAM_INVALID');
  const outputs=source.ports.filter(port=>port.id===connection.fromPortId),outputPort=outputs[0];
  if(outputs.length!==1||outputPort.direction!=='out'||connection.type!==outputPort.type||!canConnectPorts(outputPort.type,inputs[0].type))
    throw new TypeError('WORKFLOW_IMAGE_UPSTREAM_INVALID');
  const result=results.get(source.id);
  if(result?.status!=='success'||result.nodeId!==source.id)throw new Error('WORKFLOW_IMAGE_UPSTREAM_NOT_READY');
  const output=result.output;
  if(!isRecord(output)||(!isNonemptyString(output.imageUrl)&&!isNonemptyString(output.assetVersionId)))throw new Error('WORKFLOW_IMAGE_UPSTREAM_NOT_IMAGE');
  return {sourceNodeId:source.id,sourcePortId:outputPort.id,connectionId:connection.id,output:structuredClone(output)};
}
