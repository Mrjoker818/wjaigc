import 'server-only';
import type {PoolClient} from 'pg';
import {getPool} from '@/lib/db-client';
import {prepareDocumentAssetsForImport} from '@/lib/collaboration/document-asset-validation';
import {workflowImageCellPreparationIdentity,type PreparedWorkflowImageCell,type WorkflowImageGridPublication} from './workflow-image-preparation';
import type {WorkflowImageCellRuntimeExpectation,WorkflowImageRuntimePublicationValue} from './workflow-image-runtime-publication';
import {commitPreparedDocumentRuntimeCellInTransaction,readPreparedDocumentRuntimeCellInTransaction,verifyPreparedDocumentRuntimeCellReplay,
  type PreparedDocumentRuntimeCellReplay,type VerifiedDocumentRuntimeCellReplay} from './collaboration/document-media-import';
export interface WorkflowDocumentRuntimeCellValue extends WorkflowImageRuntimePublicationValue {documentSequence:number}
export type WorkflowDocumentRuntimeCellPublication=WorkflowImageGridPublication<WorkflowDocumentRuntimeCellValue>&{connectionErrors?:readonly unknown[]};
type RuntimeCellAttempt=WorkflowDocumentRuntimeCellPublication|{status:'verify-media';replay:PreparedDocumentRuntimeCellReplay};
export async function publishPreparedDocumentWorkflowImageCell(prepared:PreparedWorkflowImageCell,expectation:WorkflowImageCellRuntimeExpectation,signal:AbortSignal,dependencies:{connect?:()=>Promise<PoolClient>}={}):Promise<WorkflowDocumentRuntimeCellPublication> {
  let identity:ReturnType<typeof workflowImageCellPreparationIdentity>,held:WorkflowImageCellRuntimeExpectation;
  try{signal.throwIfAborted();identity=workflowImageCellPreparationIdentity(prepared);held=structuredClone(expectation);
    if(identity.source.access.kind!=='document'||identity.source.access.actorUserId!==identity.input.actorUserId)throw new Error('WORKFLOW_IMAGE_DOCUMENT_SCOPE_INVALID');}
  catch(error){return {status:'rolled-back',error};}
  const connect=dependencies.connect??(()=>getPool().connect()),connectionErrors:unknown[]=[];
  async function attempt(write:boolean,verification?:VerifiedDocumentRuntimeCellReplay):Promise<RuntimeCellAttempt>{
    let client:PoolClient|undefined,open=false,commitSent=false,discard=false,released=false;
    const release=():void=>{if(client&&!released){released=true;try{client.release(discard);}catch(error){connectionErrors.push(error);}}};
    try{
      signal.throwIfAborted();
      // Verify the current complete document media set before holding the final
      // parent/project locks. This import preparation is genuine opaque media.
      const assets=await prepareDocumentAssetsForImport(identity.input.actorUserId,identity.input.projectId,
        {action:'attach',transform:{x:0,y:0,width:1,height:1,rotation:0,zIndex:0}},signal);
      signal.throwIfAborted();client=await connect();signal.throwIfAborted();open=true;await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
      const outcome=write
        ?await commitPreparedDocumentRuntimeCellInTransaction(client,identity.input.actorUserId,prepared,held,assets,signal,verification)
        :await readPreparedDocumentRuntimeCellInTransaction(client,identity.input.actorUserId,prepared,held,assets,signal,verification);
      if(!outcome){await client.query('ROLLBACK');open=false;return {status:'unknown',error:new Error('DOCUMENT_RUNTIME_COMMIT_UNCONFIRMED')};}
      if(outcome.status==='verify-media'){await client.query('ROLLBACK');open=false;return outcome;}
      const value=outcome.value;
      signal.throwIfAborted();commitSent=true;await client.query('COMMIT');open=false;
      // Definitive commit wins late cancellation. Only the actual committed
      // file may survive; unused staging from exact replay is compensated.
      return {status:'committed',value,retainedFileUrls:identity.tile.file.url===value.nodeResult.output?.imageUrl?[identity.tile.file.url]:[]};
    }catch(error){
      if(commitSent){discard=true;release();return {status:'unknown',error};}
      if(open&&client){try{await client.query('ROLLBACK');open=false;}catch(rollbackError){discard=true;return {status:'unknown',error:new AggregateError([error,rollbackError],'DOCUMENT_RUNTIME_ROLLBACK_UNCONFIRMED')};}}
      return {status:'rolled-back',error};
    }finally{release();}
  }
  async function resolved(write:boolean):Promise<WorkflowDocumentRuntimeCellPublication>{
    const first=await attempt(write);if(first.status!=='verify-media')return first;
    let verification:VerifiedDocumentRuntimeCellReplay;
    try{verification=await verifyPreparedDocumentRuntimeCellReplay(first.replay,signal);}catch(error){return {status:'rolled-back',error};}
    const final=await attempt(write,verification);
    return final.status==='verify-media'?{status:'unknown',error:new Error('DOCUMENT_RUNTIME_COMMIT_UNCONFIRMED')}:final;
  }
  let result=await resolved(true);
  if(result.status==='unknown'){
    const original=result.error,recovered=await resolved(false);
    result=recovered.status==='committed'?recovered:{status:'unknown',error:new AggregateError([original,recovered.error],'DOCUMENT_RUNTIME_COMMIT_UNCONFIRMED')};
  }
  return connectionErrors.length?{...result,connectionErrors}:result;
}
