import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {getPool} from '@/lib/db-client';
import {createAnnotationRequestHash} from '@/lib/annotation-idempotency';
import {createCloudTask,getCloudTaskForUser,type CloudTask} from '@/lib/cloud-task-storage';
import {authorizeGenerationProject} from '@/lib/collaboration/generation-project-access';
import {assertSketchFenceRestoringTimeouts} from '@/lib/sketch-to-code/document';
import type {ExecutionResult,WorkflowNode,WorkflowConnection} from '@/lib/workflow-engine';
import {readWorkflowImageInputTransform} from './workflow-image-receiver';

type Graph={nodes:WorkflowNode[];connections:WorkflowConnection[]};
export interface WorkflowImageRetryMarker {version:1;sourceExecutionId:string;nodeId:string;phase:'admitted'|'running'}
export class WorkflowImageRetryAdmissionError extends Error {
  constructor(readonly status:409|503,readonly code:string,cause?:unknown){super(code,cause===undefined?undefined:{cause});this.name='WorkflowImageRetryAdmissionError';}
}
function conflict():never{throw new WorkflowImageRetryAdmissionError(409,'WORKFLOW_IMAGE_RETRY_CONFLICT');}
function unavailable(errors:unknown[]=[]):never{throw new WorkflowImageRetryAdmissionError(503,'WORKFLOW_IMAGE_RETRY_ADMISSION_UNCONFIRMED',
  errors.length?new AggregateError(errors,'WORKFLOW_IMAGE_RETRY_FAILURES_IN_ORDER'):undefined);}
function object(value:unknown):Record<string,unknown>|undefined{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function json(value:unknown):unknown{return JSON.parse(JSON.stringify(value));}
export function isNonbillableWorkflowImageRetry(cost:unknown,status:unknown,charge:unknown,refund:unknown):boolean {
  // pg returns NUMERIC as text. Check exact zero before conversion to a JS number.
  return (cost===0||typeof cost==='string'&&/^0+(?:\.0+)?$/u.test(cost))&&status==='not-applicable'
    &&(charge==null||charge==='')&&(refund==null||refund==='');
}

/** Admission shares the original cloud-task uniqueness and caller transaction.
 * The terminal ancestor is locked for reading; it is never reopened or charged. */
export async function admitWorkflowImageRetry(input:{
  actorUserId:string;original:CloudTask;nodeId:string;expectedGraph:Graph;existingOnly?:true;
}):Promise<{task:CloudTask;reused:boolean;connectionErrors?:readonly unknown[]}>{
  if(input.existingOnly!==undefined&&input.existingOnly!==true)conflict();
  const original=structuredClone(input.original),graph=structuredClone(input.expectedGraph),result=object(original.result);
  const node=graph.nodes.find(entry=>entry.id===input.nodeId);
  if(original.userId!==input.actorUserId||original.type!=='workflow'||!original.projectId||!result
    ||!['failed','completed','cancelled','timeout'].includes(original.status)
    ||!['failed','completed','cancelled'].includes(String(result.workflowStatus))
    ||result.projectId!==original.projectId||typeof result.workflowId!=='string'||!result.workflowId
    ||!isDeepStrictEqual(result.executionGraph,json(graph))||!object(result.results)
    ||node?.type!=='input-image'||!readWorkflowImageInputTransform(node))conflict();
  const access=await authorizeGenerationProject({actorUserId:input.actorUserId,projectId:original.projectId});
  if(access.kind==='unscoped'||access.actorUserId!==input.actorUserId||access.projectId!==original.projectId)conflict();
  const scopedAccess=access;
  const identity={version:1,actorUserId:input.actorUserId,projectId:original.projectId,sourceExecutionId:original.id,nodeId:input.nodeId};
  const hash=createAnnotationRequestHash(identity),id='exec-image-retry-'+hash;
  const idempotencyKey='workflow-image-retry:v1:'+hash;
  const requestDigest=createAnnotationRequestHash({...identity,graph,results:result.results,retryAttempts:result.retryAttempts??{}});
  const matches=(row:Record<string,unknown>):void=>{
    const snapshot=object(row.result),marker=object(snapshot?.imageRetry);
    if(!snapshot||!marker||row.id!==id||row.user_id!==input.actorUserId||row.project_id!==original.projectId||row.type!=='workflow'
      ||row.idempotency_key!==idempotencyKey||row.request_digest!==requestDigest
      ||!isNonbillableWorkflowImageRetry(row.credit_cost,row.credit_status,row.charged_transaction_id,row.refunded_transaction_id)
      ||snapshot?.projectId!==original.projectId||snapshot.workflowId!==result.workflowId
      ||!isDeepStrictEqual(snapshot.executionGraph,json(graph))||marker?.version!==1
      ||marker.sourceExecutionId!==original.id||marker.nodeId!==input.nodeId
      ||!['admitted','running'].includes(String(marker.phase)))conflict();
  };
  let created=false;const connectionErrors:unknown[]=[],commitErrors:unknown[]=[];
  async function transaction(recoverOnly:boolean):Promise<'confirmed'|'unknown'>{
    let client:PoolClient|undefined,open=false,commitSent=false,discard=false;
    let failureErrors:unknown[]|undefined;
    try{
      client=await getPool().connect();open=true;await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5000ms'; SET LOCAL statement_timeout='10000ms'");
      const locked=(await client.query(`SELECT * FROM cloud_tasks /* workflow-image-retry-admission */
        WHERE id=$1 AND user_id=$2 FOR SHARE`,[original.id,input.actorUserId])).rows;
      const parent=locked[0];
      if(locked.length!==1||parent.id!==original.id||parent.user_id!==input.actorUserId
        ||parent.project_id!==original.projectId||parent.type!=='workflow'||parent.status!==original.status
        ||!isDeepStrictEqual(parent.result,json(original.result)))conflict();
      await assertSketchFenceRestoringTimeouts(client,scopedAccess);
      const select=async():Promise<Record<string,unknown>|undefined>=>{
        const selected=(await client!.query(`SELECT * FROM cloud_tasks /* workflow-image-retry-admission */
          WHERE id=$1 AND user_id=$2 FOR SHARE`,[id,input.actorUserId])).rows;
        if(selected.length>1)conflict();return selected[0];
      };
      let child=await select();
      if(!child){
        if(recoverOnly||input.existingOnly){await client.query('ROLLBACK');open=false;return 'unknown';}
        const priorAttempts=object(result!.retryAttempts)??{},previous=priorAttempts[input.nodeId]??0;
        if(!Number.isSafeInteger(previous)||Number(previous)<0||Number(previous)>=Number.MAX_SAFE_INTEGER)conflict();
        // Successful context is retained for upstream resolution only. No other
        // node is dispatched, and no previous child/skill task is inherited.
        const context=Object.fromEntries(Object.entries(result!.results as Record<string,ExecutionResult>)
          .filter(([nodeId,value])=>nodeId!==input.nodeId&&object(value)?.status==='success'));
        const marker:WorkflowImageRetryMarker={version:1,sourceExecutionId:original.id,nodeId:input.nodeId,phase:'admitted'};
        const now=Date.now();
        created=await createCloudTask({id,userId:input.actorUserId,projectId:original.projectId,type:'workflow',status:'processing',
          progress:0,label:'重试图片节点',creditCost:0,creditStatus:'not-applicable',idempotencyKey,requestDigest,
          result:{workflowStatus:'running',projectId:original.projectId,workflowId:result!.workflowId,totalNodes:1,currentNodeId:input.nodeId,
            results:context,startedAt:now,completedAt:null,executionGraph:graph,
            retryAttempts:{[input.nodeId]:Number(previous)+1},imageRetry:marker,
            submissionPayload:{assetWorkspace:'workflow',assetWorkspaceId:`workflow:${original.projectId}`}},createdAt:now,updatedAt:now},client);
        child=await select();
      }
      if(!child)unavailable();matches(child);
      commitSent=true;await client.query('COMMIT');open=false;return 'confirmed';
    }catch(error){
      if(commitSent){discard=true;commitErrors.push(error);return 'unknown';}
      failureErrors=[error];
      if(open&&client){try{await client.query('ROLLBACK');open=false;}catch(rollbackError){discard=true;failureErrors.push(rollbackError);unavailable(failureErrors);}}
      throw error;
    }finally{
      try{client?.release(discard);}catch(releaseError){
        if(failureErrors)unavailable([...failureErrors,releaseError]);
        // A cleanup error cannot reverse a confirmed COMMIT or prevent a
        // fresh, read-only reconciliation after an uncertain COMMIT.
        connectionErrors.push(releaseError);
      }
    }
  }
  const first=await transaction(false);
  // Never repeat INSERT after an uncertain COMMIT in this request. Fresh,
  // permission-fenced read-only reconciliation may only find the same child.
  if(first==='unknown'){
    let recovered:'confirmed'|'unknown';
    try{recovered=await transaction(true);}catch(error){unavailable([...commitErrors,error,...connectionErrors]);}
    if(recovered!=='confirmed')unavailable([...commitErrors,...connectionErrors]);
  }
  const task=await getCloudTaskForUser(id,input.actorUserId);if(!task)unavailable();
  matches({id:task.id,user_id:task.userId,project_id:task.projectId,type:task.type,idempotency_key:task.idempotencyKey,
    request_digest:task.requestDigest,result:task.result,credit_cost:task.creditCost,credit_status:task.creditStatus,
    charged_transaction_id:task.chargedTransactionId,refunded_transaction_id:task.refundedTransactionId});
  return {task,reused:!created,...(connectionErrors.length?{connectionErrors}:{} )};
}
