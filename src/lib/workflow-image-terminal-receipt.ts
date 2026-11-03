import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {getPool} from '@/lib/db-client';
import {getCloudTaskForUser,type CloudTask} from '@/lib/cloud-task-storage';
import {createAnnotationRequestHash} from '@/lib/annotation-idempotency';
import {createPostgresAssetStorage} from '@/lib/asset-core/storage';
import {withSafeSharp} from '@/lib/safe-image-input';
import {getNodeInputs,resolveInlineSubgraph,resolveWorkflowIterations,topologicalSort,type Workflow,type ExecutionResult,type WorkflowNode,type WorkflowConnection} from '@/lib/workflow-engine';
import {resolveWorkflowImageSourceForActor} from './workflow-image-source';
import {readWorkflowImageInputTransform} from './workflow-image-receiver';
import {partitionWorkflowImageGrid} from './workflow-image-actions';
import {withWorkflowImageReceiptRead,type WorkflowImageCellPreparationIdentity} from './workflow-image-preparation';
import {readWorkflowImageMediaForActor,workflowImageMediaIdentity,assertWorkflowImageMediaSourceInTransaction,type WorkflowImageMedia,type WorkflowImageMediaInput} from './workflow-image-media';
import {workflowImageRuntimeOperationId,workflowImageRuntimeTarget,readPersonalWorkflowImageCellReceiptInTransaction,matchWorkflowImageRuntimeNodeCheckpoint,type WorkflowImageLogicalExecution} from './workflow-image-runtime-publication';
import {workflowImageReferenceNodeResult} from './workflow-image-reference-runtime';

type Graph={nodes:WorkflowNode[];connections:WorkflowConnection[]};
function object(value:unknown):Record<string,unknown>|undefined{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function unconfirmed():never{throw new Error('WORKFLOW_IMAGE_TERMINAL_RECEIPT_UNCONFIRMED');}
function json(value:unknown):unknown{return JSON.parse(JSON.stringify(value));}
function text(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value&&!/\p{Cc}/u.test(value);}
function imageReference(value:Record<string,unknown>):WorkflowImageMediaInput['reference']{
  const reference:WorkflowImageMediaInput['reference']={};
  for(const key of ['projectId','assetId','assetVersionId','placementId','imageUrl'] as const){
    if(value[key]!==undefined){if(typeof value[key]!=='string')unconfirmed();reference[key]=value[key];}
  }
  return reference;
}
async function sameTask(client:PoolClient,task:CloudTask):Promise<void>{
  const selected=await client.query(`SELECT id,user_id,project_id,type,status,result,revision,idempotency_key,request_digest
    FROM cloud_tasks /* workflow-image-terminal-receipt */ WHERE id=$1 AND user_id=$2 FOR SHARE`,[task.id,task.userId]);
  const row=selected.rows[0];
  if(selected.rows.length!==1||row.id!==task.id||row.user_id!==task.userId||row.project_id!==task.projectId
    ||row.type!==task.type||row.status!==task.status||row.revision!==task.revision
    ||(row.idempotency_key??'')!==(task.idempotencyKey??'')||(row.request_digest??'')!==(task.requestDigest??'')
    ||!isDeepStrictEqual(row.result,json(task.result)))unconfirmed();
}
/** Reads a durable successful retry, its original admission and actual immutable media.
 * No worker lease, task transition, publication, file creation or checkpoint repair. */
export async function verifyCompletedWorkflowImageRetry(task:CloudTask,actorUserId:string,signal?:AbortSignal):Promise<Record<string,ExecutionResult>>{
  task=structuredClone(task);
  const result=object(task.result),marker=object(result?.imageRetry),rawGraph=object(result?.executionGraph),saved=object(result?.results);
  if(task.userId!==actorUserId||task.type!=='workflow'||task.status!=='completed'||result?.workflowStatus!=='completed'
    ||!text(task.projectId)||result.projectId!==task.projectId||!text(result.workflowId)||!marker||marker.version!==1
    ||!text(marker.sourceExecutionId)||!text(marker.nodeId)||!['admitted','running'].includes(String(marker.phase))
    ||!rawGraph||!Array.isArray(rawGraph.nodes)||!Array.isArray(rawGraph.connections)||!saved)unconfirmed();
  const graph=rawGraph as unknown as Graph,node=graph.nodes.find(entry=>entry.id===marker.nodeId);
  const transform=node?readWorkflowImageInputTransform(node):null,checkpoint=object(saved[marker.nodeId]);
  const attempt=object(result.retryAttempts)?.[marker.nodeId];
  if(!node||node.type!=='input-image'||!transform||checkpoint?.status!=='success'||!object(checkpoint.output)
    ||!Number.isSafeInteger(attempt)||Number(attempt)<1)unconfirmed();
  const original=await getCloudTaskForUser(marker.sourceExecutionId,actorUserId),ancestor=object(original?.result);
  if(!original||original.type!=='workflow'||original.projectId!==task.projectId
    ||!['completed','failed','cancelled','timeout'].includes(original.status)||!ancestor||!object(ancestor.results)
    ||ancestor.workflowId!==result.workflowId||ancestor.projectId!==task.projectId||!isDeepStrictEqual(ancestor.executionGraph,graph))unconfirmed();
  const prior=object(ancestor.retryAttempts)?.[marker.nodeId]??0;
  if(!Number.isSafeInteger(prior)||Number(prior)+1!==attempt)unconfirmed();
  const identity={version:1,actorUserId,projectId:task.projectId,sourceExecutionId:original.id,nodeId:marker.nodeId};
  const hash=createAnnotationRequestHash(identity);
  if(task.id!=='exec-image-retry-'+hash||task.idempotencyKey!=='workflow-image-retry:v1:'+hash
    ||task.requestDigest!==createAnnotationRequestHash({...identity,graph,results:ancestor.results,retryAttempts:ancestor.retryAttempts??{}}))unconfirmed();
  const execution:WorkflowImageLogicalExecution={actorUserId,projectId:task.projectId,workflowId:result.workflowId,parentExecutionId:task.id,
    nodeId:marker.nodeId,subgraphPath:[],attempt:Number(attempt),expectedGraph:graph};
  return withWorkflowImageReceiptRead(active=>verifyWorkflowImageNodeReceipt([original,task],execution,graph,saved,result,node,checkpoint,active),{signal});
}

async function verifyWorkflowImageNodeReceipt(tasks:readonly CloudTask[],execution:WorkflowImageLogicalExecution,graph:Graph,
  saved:Record<string,unknown>,result:Record<string,unknown>,node:WorkflowNode,checkpoint:Record<string,unknown>,active:AbortSignal):Promise<Record<string,ExecutionResult>>{
  const actorUserId=execution.actorUserId,transform=readWorkflowImageInputTransform(node);
  if(!transform)unconfirmed();
  const target=workflowImageRuntimeTarget(execution),operationId=workflowImageRuntimeOperationId(execution);
  const workflow:Workflow={id:execution.workflowId,name:'Receipt verification',version:'1',status:'idle',createdAt:0,updatedAt:0,...graph};
  active.throwIfAborted();
    const resolved=await resolveWorkflowImageSourceForActor(actorUserId,workflow,execution.nodeId,new Map(Object.entries(saved as Record<string,ExecutionResult>)),
      {projectId:execution.projectId,workspaceId:execution.workflowId,entityId:execution.nodeId,bindPlacement:false,requireManagedAsset:graph.nodes.some(entry=>entry.type==='ai-skill')},active);
    if(!isDeepStrictEqual(resolved.transform,transform))unconfirmed();
    const input:WorkflowImageMediaInput={actorUserId,projectId:execution.projectId,workspaceId:target.workspaceId,entityId:target.entityId,
      requireManagedAsset:graph.nodes.some(entry=>entry.type==='ai-skill'),reference:imageReference(resolved.image)};
    const media=await readWorkflowImageMediaForActor(input,active),source=workflowImageMediaIdentity(media.source),proofs:WorkflowImageMedia[]=[media];
    let cellIdentity:WorkflowImageCellPreparationIdentity|undefined;
    if(transform.kind==='grid'){
      const output=object(checkpoint.output)!;
      const targetMedia=await readWorkflowImageMediaForActor({...input,requireManagedAsset:true,reference:imageReference(output)},active);
      const actual=workflowImageMediaIdentity(targetMedia.source),version=actual.version;
      if(!version||!actual.reference||!text(output.entityId)||actual.reference.entityId!==output.entityId)unconfirmed();
      const size=await withSafeSharp(media.bytes,{maxPixels:40_000_000,signal:active},pipeline=>pipeline.timeout({seconds:30}).metadata());
      active.throwIfAborted();
      const rotated=size.orientation!==undefined&&size.orientation>=5&&size.orientation<=8;
      const width=rotated?size.height:size.width,height=rotated?size.width:size.height;
      if(!width||!height)unconfirmed();
      const cell=partitionWorkflowImageGrid(width,height,transform.columns,transform.rows)[transform.row*transform.columns+transform.column];
      if(version.file.mimeType!=='image/png'||targetMedia.mimeType!=='image/png'||version.file.checksum!==actual.sha256
        ||version.file.width!==cell.width||version.file.height!==cell.height)unconfirmed();
      proofs.push(targetMedia);
      cellIdentity={input:{...source.input,operationId,targetNodeId:target.entityId,columns:transform.columns,rows:transform.rows,column:transform.column,row:transform.row},
        source,tile:{targetNodeId:target.entityId,cell,file:version.file}};
      if(!source.version){
        const parentId=object(output.imageInput)?.parentVersionId;if(!text(parentId))unconfirmed();
        const legacy=await createPostgresAssetStorage().read(transaction=>transaction.findVersion(actorUserId,execution.projectId,parentId));
        if(!legacy||legacy.file.checksum!==source.sha256)unconfirmed();
        const parentMedia=await readWorkflowImageMediaForActor({...input,requireManagedAsset:true,reference:{assetId:legacy.assetId,assetVersionId:legacy.id}},active);
        const parent=workflowImageMediaIdentity(parentMedia.source);
        if(!parent.version||parent.sha256!==source.sha256)unconfirmed();
        cellIdentity.legacyParentFile=parent.version.file;proofs.push(parentMedia);
      }
    }
    // IO is fully settled before SQL locks. Recheck each opaque source and both
    // immutable task snapshots under this one client; a changed grant fails closed.
    let client:PoolClient|undefined,open=false,discard=false;
    const failures:unknown[]=[];let verified:Record<string,ExecutionResult>|undefined;
    try{
      active.throwIfAborted();client=await getPool().connect();open=true;await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
      for(const snapshot of tasks)await sameTask(client,snapshot);
      for(const proof of proofs){active.throwIfAborted();await assertWorkflowImageMediaSourceInTransaction(client,proof.source,active);}
      let actual:ExecutionResult;
      if(transform.kind==='identity'){
        const expected=workflowImageReferenceNodeResult({input:{...source.input,operationId},source},execution);
        const matched=matchWorkflowImageRuntimeNodeCheckpoint(result,expected);if(!matched)unconfirmed();actual=matched;
      }else if(cellIdentity){
        actual=source.access.kind==='document'
          ?await (await import('./collaboration/document-media-import')).readDocumentWorkflowImageCellReceiptInTransaction(client,cellIdentity,execution,result,active)
          :await readPersonalWorkflowImageCellReceiptInTransaction(client,cellIdentity,execution,result);
      }else unconfirmed();
      if(!isDeepStrictEqual(actual,checkpoint))unconfirmed();
      active.throwIfAborted();await client.query('ROLLBACK');open=false;
      verified=structuredClone(saved as Record<string,ExecutionResult>);
    }catch(error){failures.push(error);}
    finally{
      if(open&&client)try{await client.query('ROLLBACK');open=false;}catch(error){discard=true;failures.push(error);}
      if(client)try{client.release(discard);}catch(error){failures.push(error);}
    }
    if(failures.length)throw failures.length===1?failures[0]:new AggregateError(failures,'WORKFLOW_IMAGE_TERMINAL_READ_FAILURES_IN_ORDER');
    if(!verified)unconfirmed();return verified;
}

interface RecoveryFrame {graph:Graph;local:Record<string,unknown>;path:string[]}
function recoveryFrames(task:CloudTask):{root:Graph;frames:RecoveryFrame[]}{
  const result=object(task.result),raw=object(result?.executionGraph);
  if(task.type!=='workflow'||task.status!=='processing'||!text(task.userId)||!text(task.projectId)
    ||result?.projectId!==task.projectId||!text(result.workflowId)||result.workflowStatus!=='running'
    ||result.dispatchStopped===true||result.imageRetry!==undefined||!raw||!Array.isArray(raw.nodes)||!Array.isArray(raw.connections))unconfirmed();
  const root=raw as unknown as Graph,frames:RecoveryFrame[]=[],nested=object(result.sketchNested);
  const visit=(graph:Graph,local:Record<string,unknown>,path:string[]):void=>{
    const saved=object(local.results);if(!saved)unconfirmed();
    frames.push({graph,local,path});
    for(const node of graph.nodes){
      if(!text(node.id)||typeof node.type!=='string'||!object(node.config)||!Array.isArray(node.ports))unconfirmed();
      if(node.type!=='subgraph')continue;
      if(path.length>=3)unconfirmed();
      const inline=resolveInlineSubgraph(node);if(!inline)unconfirmed();
      const childPath=[...path,node.id],child=object(nested?.[[task.id,...childPath].join(':')]),parent=object(saved[node.id]);
      if(parent?.status==='skipped'||parent?.status==='failed')continue;
      if(parent?.status==='success'&&(!child||child.status!=='completed'))unconfirmed();
      const inputs=getNodeInputs(node,graph.connections,new Map(Object.entries(saved) as Array<[string,ExecutionResult]>));
      const hydrated=inline.nodes.map(entry=>!entry.type.startsWith('input-')&&entry.type!=='audio-input'?entry
        :{...entry,config:{...inputs,...entry.config}});
      visit({nodes:hydrated,connections:inline.connections},child||{results:{}},childPath);
    }
  };
  visit(root,result,[]);return{root,frames};
}

/** Other task kinds retain their original accepted-task recovery protocol. */
export function supportsWorkflowImageCpuRecovery(task:CloudTask):boolean{
  try{
    const result=object(task.result)!;
    if(['activeSkillRuns','activeChildTasks','activeLayerTasks','sketchIntents'].some(key=>Object.keys(object(result?.[key])||{}).length))return false;
    return recoveryFrames(task).frames.every(frame=>frame.graph.nodes.every(node=>{
      return ['input-text','input-image','subgraph','parallel','loop-for','loop-each','loop-while','group'].includes(node.type)
        ||node.type.startsWith('condition-');
    }));
  }catch{return false;}
}

/** Verify already committed CPU receipts with one shared read job and deadline.
 * This never claims, writes a checkpoint, publishes media or repairs loop cursors. */
export async function verifyRunningWorkflowImageCheckpoints(task:CloudTask,actorUserId:string,signal?:AbortSignal):Promise<void>{
  task=structuredClone(task);
  if(task.userId!==actorUserId||!supportsWorkflowImageCpuRecovery(task))unconfirmed();
  const {root,frames}=recoveryFrames(task),rootResult=object(task.result)!;
  await withWorkflowImageReceiptRead(async active=>{
    for(const frame of frames){
      active.throwIfAborted();const saved=object(frame.local.results)!;
      const results=new Map(Object.entries(saved) as Array<[string,ExecutionResult]>);
      for(const loop of frame.graph.nodes){
        if(!['loop-for','loop-each','loop-while'].includes(loop.type)||object(saved[loop.id])?.status!=='success'
          ||object(frame.local.loopResume)?.loopNodeId===loop.id)continue;
        const iterations=resolveWorkflowIterations(loop,getNodeInputs(loop,frame.graph.connections,results));
        if(!iterations.length)continue;
        const outgoing=frame.graph.connections.filter(edge=>edge.fromNodeId===loop.id),explicit=outgoing.filter(edge=>edge.fromPortId==='out-loop');
        const body=explicit.length?explicit:outgoing.filter(edge=>edge.fromPortId!=='out-done');
        for(const edge of body){const target=frame.graph.nodes.find(node=>node.id===edge.toNodeId);
          if(target?.type==='input-image'&&readWorkflowImageInputTransform(target)&&object(saved[target.id])?.status!=='success')unconfirmed();}
      }
      for(const node of frame.graph.nodes){
        if(node.type!=='input-image'||!readWorkflowImageInputTransform(node))continue;
        const checkpoint=object(saved[node.id]);
        if(checkpoint?.status!=='success')continue;
        const attempt=object(frame.local.retryAttempts)?.[node.id]??0;
        if(checkpoint.nodeId!==node.id||!object(checkpoint.output)||!Number.isSafeInteger(attempt)||Number(attempt)<0)unconfirmed();
        const execution:WorkflowImageLogicalExecution={actorUserId,projectId:task.projectId!,workflowId:String(rootResult.workflowId),
          parentExecutionId:task.id,nodeId:node.id,subgraphPath:frame.path,attempt:Number(attempt),expectedGraph:root};
        const operationId=object(object(checkpoint.output)?.imageInput)?.operationId;
        let selected:WorkflowImageLogicalExecution|undefined;
        if(operationId===workflowImageRuntimeOperationId(execution))selected=execution;
        for(const loop of frame.graph.nodes){
          if(!['loop-for','loop-each','loop-while'].includes(loop.type))continue;
          const outgoing=frame.graph.connections.filter(edge=>edge.fromNodeId===loop.id),explicit=outgoing.filter(edge=>edge.fromPortId==='out-loop');
          const body=explicit.length?explicit:outgoing.filter(edge=>edge.fromPortId!=='out-done');
          if(!body.some(edge=>edge.toNodeId===node.id))continue;
          const iterations=resolveWorkflowIterations(loop,getNodeInputs(loop,frame.graph.connections,results));
          const match=iterations.find(iteration=>operationId===workflowImageRuntimeOperationId({...execution,loop:{nodeId:loop.id,index:iteration.index}}));
          if(!match)continue;
          const rawCursor=object(frame.local.loopResume),cursor=rawCursor?.loopNodeId===loop.id?rawCursor:undefined;
          if(cursor){
            const bodyIds=new Set(body.map(edge=>edge.toNodeId));
            const ordered=topologicalSort(frame.graph.nodes,frame.graph.connections).filter(entry=>bodyIds.has(entry.id));
            const position=ordered.findIndex(entry=>entry.id===node.id),next=Number(cursor.nextNodeIndex);
            if(cursor.loopNodeId!==loop.id||frame.local.currentNodeId!==loop.id||!Number.isSafeInteger(cursor.iterationIndex)
              ||!iterations.some(iteration=>iteration.index===cursor.iterationIndex)
              ||!Number.isSafeInteger(cursor.nextNodeIndex)||next<0||next>=ordered.length||position<0||cursor.pausedNodeId!==undefined
              ||match.index!==cursor.iterationIndex&&match.index!==Number(cursor.iterationIndex)-1
              ||match.index===cursor.iterationIndex&&next<position
              ||match.index!==cursor.iterationIndex&&next>position)unconfirmed();
          }else if(object(saved[loop.id])?.status!=='success'||match.index!==iterations.at(-1)?.index)unconfirmed();
          if(selected)unconfirmed();selected={...execution,loop:{nodeId:loop.id,index:match.index}};
        }
        if(!selected)unconfirmed();
        await verifyWorkflowImageNodeReceipt([task],selected,frame.graph,saved,frame.local,node,checkpoint,active);
      }
    }
  },{signal});
}
