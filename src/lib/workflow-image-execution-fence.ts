import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {resolveInlineSubgraph,topologicalSort,getNodeInputs,resolveWorkflowIterations,type ExecutionResult,type WorkflowNode,type WorkflowConnection} from '@/lib/workflow-engine';
export interface WorkflowImageExecutionFenceInput {
  actorUserId:string;projectId:string;workflowId:string;parentExecutionId:string;nodeId:string;
  subgraphPath:readonly string[];expectedGraph:{nodes:WorkflowNode[];connections:WorkflowConnection[]};
  expectedRevision:number;leaseOwner:string;leaseAttemptCount:number;attempt:number;
  loop?:{nodeId:string;index:number};
}
export interface WorkflowImageExecutionFenceSnapshot {
  actorUserId:string;projectId:string;workflowId:string;parentExecutionId:string;executionId:string;nodeId:string;
  revision:number;leaseOwner:string;leaseAttemptCount:number;attempt:number;resultPath:string[];
}
/** A caller-owned transaction keeps the original cloud-task row lock. This
 * detached snapshot is not an authorization token or a COMMIT receipt. */
type Graph=WorkflowImageExecutionFenceInput['expectedGraph'];
function lost():never {throw new Error('WORKFLOW_EXECUTION_FENCE_LOST');}
function object(value:unknown):Record<string,unknown>|undefined {return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function id(value:unknown):value is string {return typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value&&!/\p{Cc}/u.test(value);}
function integer(value:unknown):number|undefined {
  const result=typeof value==='number'?value:typeof value==='string'&&/^(?:0|[1-9][0-9]*)$/u.test(value)?Number(value):NaN;
  return Number.isSafeInteger(result)&&result>=0?result:undefined;
}
function graph(value:unknown):Graph|undefined {
  const raw=object(value);if(!Array.isArray(raw?.nodes)||!Array.isArray(raw?.connections))return;
  const ids=new Set<string>();
  for(const entry of raw.nodes){const node=object(entry);if(!node||!id(node.id)||ids.has(node.id)||typeof node.type!=='string'||!object(node.config)||!Array.isArray(node.ports))return;ids.add(node.id);}
  const edgeIds=new Set<string>();
  for(const entry of raw.connections){const edge=object(entry);if(!edge||!id(edge.id)||edgeIds.has(edge.id)||!id(edge.fromNodeId)||!id(edge.toNodeId)
    ||!ids.has(edge.fromNodeId)||!ids.has(edge.toNodeId)||!id(edge.fromPortId)||!id(edge.toPortId)||typeof edge.type!=='string')return;edgeIds.add(edge.id);}
  return value as Graph;
}
function snapshot(input:WorkflowImageExecutionFenceInput):WorkflowImageExecutionFenceInput {
  let held:WorkflowImageExecutionFenceInput;
  try {held=structuredClone(input);}catch{lost();}
  if(!held||![held.actorUserId,held.projectId,held.workflowId,held.parentExecutionId,held.nodeId,held.leaseOwner].every(id)
    ||!Number.isSafeInteger(held.expectedRevision)||held.expectedRevision<0||!Number.isSafeInteger(held.leaseAttemptCount)||held.leaseAttemptCount<1
    ||!Number.isSafeInteger(held.attempt)||held.attempt<0||!Array.isArray(held.subgraphPath)||held.subgraphPath.length>3||!graph(held.expectedGraph))lost();
  for(let index=0;index<held.subgraphPath.length;index++)if(!id(held.subgraphPath[index]))lost();
  if(held.loop!==undefined&&(!object(held.loop)||!id(held.loop.nodeId)||!Number.isSafeInteger(held.loop.index)||held.loop.index<1||held.loop.index>100))lost();
  try {if(JSON.stringify(held.expectedGraph).length>6*1024*1024)lost();}catch{lost();}
  return held;
}
function nodeInGraph(held:WorkflowImageExecutionFenceInput):{graph:Graph;node:WorkflowNode;executionId:string} {
  let selected=held.expectedGraph;
  for(const containerId of held.subgraphPath){
    const matches=selected.nodes.filter(node=>node.id===containerId);if(matches.length!==1||matches[0].type!=='subgraph')lost();
    const nested=resolveInlineSubgraph(matches[0]);if(!nested||!graph(nested))lost();selected=nested;
  }
  const matches=selected.nodes.filter(node=>node.id===held.nodeId);if(matches.length!==1||matches[0].type!=='input-image')lost();
  return {graph:selected,node:matches[0],executionId:[held.parentExecutionId,...held.subgraphPath].join(':')};
}
function assertLoopTarget(selected:Graph,loop:WorkflowNode,targetId:string,cursor:Record<string,unknown>,local:Record<string,unknown>,index:number):void {
  if(!Number.isSafeInteger(cursor.nextNodeIndex)||Number(cursor.nextNodeIndex)<0)lost();
  // Match the original executor's direct body selection and topological order;
  // reachability alone would include the out-done path and transitive nodes.
  const outgoing=selected.connections.filter(edge=>edge.fromNodeId===loop.id);
  const explicit=outgoing.filter(edge=>edge.fromPortId==='out-loop');
  const bodyIds=new Set((explicit.length?explicit:outgoing.filter(edge=>edge.fromPortId!=='out-done')).map(edge=>edge.toNodeId));
  try {
    const body=topologicalSort(selected.nodes,selected.connections).filter(node=>bodyIds.has(node.id));
    if(body[Number(cursor.nextNodeIndex)]?.id!==targetId)lost();
    const inputs=getNodeInputs(loop,selected.connections,new Map(Object.entries(local.results as Record<string,ExecutionResult>)));
    if(!resolveWorkflowIterations(loop,inputs).some(iteration=>iteration.index===index))lost();
  }catch{lost();}
}
function localExecutionState(result:Record<string,unknown>,held:WorkflowImageExecutionFenceInput):Record<string,unknown> {
  let local=result,executionId=held.parentExecutionId;const nested=object(result.sketchNested);
  for(const containerId of held.subgraphPath){
    if(local.currentNodeId!==containerId||local.dispatchStopped===true||local.loopResume!==undefined)lost();
    executionId+=':'+containerId;const child=object(nested?.[executionId]);
    if(!child||child.status!=='running'||child.dispatchStopped===true||!object(child.results))lost();
    local=child;
  }
  return local;
}
export async function assertWorkflowImageExecutionInTransaction(client:PoolClient,input:WorkflowImageExecutionFenceInput,signal?:AbortSignal):Promise<WorkflowImageExecutionFenceSnapshot> {
  signal?.throwIfAborted();const held=snapshot(input),target=nodeInGraph(held);
  const locked=await client.query(`SELECT id,user_id,project_id,type,status,result,revision,lease_owner,attempt_count,lease_expires_at,
    (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS fence_now
    FROM cloud_tasks WHERE id=$1 AND user_id=$2 FOR UPDATE`,[held.parentExecutionId,held.actorUserId]);
  signal?.throwIfAborted();if(locked.rows.length!==1)lost();
  const row=object(locked.rows[0]),result=object(row?.result),now=integer(row?.fence_now),expires=integer(row?.lease_expires_at);
  if(!row||row.id!==held.parentExecutionId||row.user_id!==held.actorUserId||row.project_id!==held.projectId||row.type!=='workflow'
    ||row.status!=='processing'||row.revision!==held.expectedRevision||row.lease_owner!==held.leaseOwner
    ||integer(row.attempt_count)!==held.leaseAttemptCount||now===undefined||expires===undefined||expires<=now
    ||!result||result.projectId!==held.projectId||result.workflowId!==held.workflowId||result.workflowStatus!=='running'
    ||result.dispatchStopped===true||!isDeepStrictEqual(result.executionGraph,held.expectedGraph))lost();
  const local=localExecutionState(result,held);
  if(!object(local.results)||local.dispatchStopped===true)lost();
  const attempts=object(local.retryAttempts);if(local.retryAttempts!==undefined&&!attempts)lost();
  const attempt=attempts?.[held.nodeId]??0;if(integer(attempt)!==attempt||attempt!==held.attempt)lost();
  if(held.loop){
    const cursor=object(local.loopResume),loop=target.graph.nodes.find(node=>node.id===held.loop!.nodeId);
    if(!cursor||!loop?.type.startsWith('loop-')||local.currentNodeId!==held.loop.nodeId||cursor.loopNodeId!==held.loop.nodeId
      ||cursor.iterationIndex!==held.loop.index)lost();
    assertLoopTarget(target.graph,loop,held.nodeId,cursor,local,held.loop.index);
  }else if(local.currentNodeId!==held.nodeId||local.loopResume!==undefined)lost();
  return {actorUserId:held.actorUserId,projectId:held.projectId,workflowId:held.workflowId,parentExecutionId:held.parentExecutionId,
    executionId:target.executionId,nodeId:held.nodeId,revision:held.expectedRevision,leaseOwner:held.leaseOwner,
    leaseAttemptCount:held.leaseAttemptCount,attempt:held.attempt,
    resultPath:held.subgraphPath.length?['sketchNested',target.executionId,'results',held.nodeId]:['results',held.nodeId]};
}
