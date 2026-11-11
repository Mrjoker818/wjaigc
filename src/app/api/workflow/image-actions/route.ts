import {NextRequest,NextResponse} from 'next/server';
import {requireApiAuthOrReject} from '@/lib/api-auth';
import {readMediaBody,consumeMediaBody,reserveMediaPreparation,mediaDeadline} from '@/lib/collaboration/document-media-request';
import {parseWorkflowImageGridAction,WorkflowImageActionRequestError,type WorkflowImageGridActionRequest} from '../../../../lib/workflow-image-action-request';
import {prepareAndPublishWorkflowImageGrid,workflowImageGridPreparationIdentity} from '../../../../lib/workflow-image-preparation';
import {publishPreparedPersonalWorkflowImageGrid,type WorkflowImageGridPublicationValue} from '../../../../lib/workflow-image-publication';
import {publishPreparedDocumentWorkflowImageGrid} from '../../../../lib/workflow-image-document-publication';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const MAX_BODY_BYTES=48*1024*1024,INGRESS_TIMEOUT_MS=10_000;
class ActionHttpError extends Error {
  constructor(readonly status:number,readonly code:string){super(code);}
}
function response(value:Record<string,unknown>,status:number):NextResponse {
  return NextResponse.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie, Authorization'}});
}
async function readInput(request:NextRequest):Promise<WorkflowImageGridActionRequest> {
  if(!/^application\/json(?:\s*;\s*charset\s*=\s*"?utf-8"?)?\s*$/i.test(request.headers.get('content-type')??''))
    throw new ActionHttpError(415,'WORKFLOW_IMAGE_ACTION_CONTENT_TYPE');
  const deadline=mediaDeadline(request.signal,INGRESS_TIMEOUT_MS);
  try{
    const raw=consumeMediaBody(await readMediaBody(request,MAX_BODY_BYTES,deadline.signal));
    let value:unknown;
    try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw.bytes));}
    catch{throw new WorkflowImageActionRequestError();}
    return parseWorkflowImageGridAction(value);
  }catch(error){
    if(request.signal.aborted)throw new ActionHttpError(409,'WORKFLOW_IMAGE_ACTION_CANCELLED');
    if(deadline.signal.aborted)throw new ActionHttpError(408,'WORKFLOW_IMAGE_ACTION_INGRESS_TIMEOUT');
    throw error;
  }finally{deadline.dispose();}
}
function failure(error:unknown):NextResponse {
  if(error instanceof ActionHttpError)return response({success:false,code:error.code},error.status);
  if(error instanceof WorkflowImageActionRequestError)return response({success:false,code:error.code},400);
  const code=error instanceof Error&&'code' in error&&typeof error.code==='string'?error.code:'';
  const known:Readonly<Record<string,number>>={GENERATION_PROJECT_INVALID:400,GENERATION_PROJECT_FORBIDDEN:403,
    GENERATION_PROJECT_UNAVAILABLE:503,DOCUMENT_FORBIDDEN:403,DOCUMENT_DISABLED:503,DOCUMENT_PROJECT_NOT_ENABLED:403,
    DOCUMENT_MEDIA_SOURCE_FORBIDDEN:403,DOCUMENT_ASSET_FORBIDDEN:403,DOCUMENT_MEDIA_CONFLICT:409,
    DOCUMENT_AUTHORITY_CONFLICT:409,DOCUMENT_ASSET_COMMAND_CONFLICT:409,
    ASSET_NOT_FOUND:404,ASSET_REQUEST_INVALID:400,ASSET_REFERENCE_UNAVAILABLE:503,
    ASSET_IDEMPOTENCY_CONFLICT:409,ASSET_PLACEMENT_CONFLICT:409};
  if(Object.hasOwn(known,code))return response({success:false,code},known[code]);
  if(code==='DOCUMENT_MEDIA_TOO_LARGE')return response({success:false,code:'WORKFLOW_IMAGE_ACTION_TOO_LARGE'},413);
  if(code==='DOCUMENT_MEDIA_INVALID')return response({success:false,code:'WORKFLOW_IMAGE_ACTION_INVALID'},400);
  if(code==='DOCUMENT_MEDIA_CANCELLED')return response({success:false,code:'WORKFLOW_IMAGE_ACTION_CANCELLED'},409);
  const message=error instanceof Error?error.message:'';
  if(message==='WORKFLOW_IMAGE_GRID_OUTPUT_LIMIT')return response({success:false,code:'WORKFLOW_IMAGE_ACTION_TOO_LARGE'},413);
  if(code==='DOCUMENT_MEDIA_BUSY'||message==='WORKFLOW_IMAGE_PREPARATION_BUSY')
    return response({success:false,code:'WORKFLOW_IMAGE_ACTION_BUSY',retrySameOperation:true},503);
  if(['WORKFLOW_IMAGE_MEDIA_SOURCE_CHANGED','WORKFLOW_IMAGE_MEDIA_SOURCE_INVALID'].includes(message))
    return response({success:false,code:'WORKFLOW_IMAGE_SOURCE_CHANGED'},409);
  if(['WORKFLOW_IMAGE_PREPARATION_TIMEOUT','WORKFLOW_IMAGE_GRID_TIMEOUT'].includes(message))
    return response({success:false,code:'WORKFLOW_IMAGE_ACTION_TIMEOUT',retrySameOperation:true},408);
  if(message==='WORKFLOW_IMAGE_GRID_INVALID')return response({success:false,code:'WORKFLOW_IMAGE_ACTION_INVALID'},400);
  return response({success:false,code:'WORKFLOW_IMAGE_ACTION_UNAVAILABLE',retrySameOperation:true},503);
}
/** CPU-only request. This route creates no model task or accounting authority;
 * existing opaque media preparation and original final publishers own the write. */
export async function POST(request:NextRequest):Promise<NextResponse> {
  let releaseIngress:(()=>void)|undefined;
  try{
    const auth=await requireApiAuthOrReject(request);
    if(auth instanceof NextResponse)return response({success:false,code:'AUTHENTICATION_REQUIRED'},auth.status);
    if(request.headers.get('x-wujie-expected-actor-id')!==auth.userId)
      throw new ActionHttpError(409,'ACTOR_SCOPE_CHANGED');
    // Reuse the existing bounded preparation reservation through ingress AND
    // publication. The inner full-job CPU slot remains held until its real receipt.
    releaseIngress=reserveMediaPreparation(MAX_BODY_BYTES,request.signal);
    const input=await readInput(request);
    const result=await prepareAndPublishWorkflowImageGrid<WorkflowImageGridPublicationValue>({actorUserId:auth.userId,
      projectId:input.projectId,workspaceId:input.workspaceId,entityId:input.sourceNodeId,reference:input.source,
      columns:input.columns,rows:input.rows,targetNodeIds:input.targetNodeIds,operationId:input.operationId},
      async(prepared,signal)=>{
        const identity=workflowImageGridPreparationIdentity(prepared);
        // A browser flag is never scope authority, and a document rejection has
        // no personal fallback. Both publishers retain their original final fences.
        return identity.source.access.kind==='document'
          ?publishPreparedDocumentWorkflowImageGrid(prepared,signal)
          :publishPreparedPersonalWorkflowImageGrid(prepared,signal);
      },{signal:request.signal});
    if(result.status==='unknown')return response({success:false,status:'unknown',code:'WORKFLOW_IMAGE_PUBLICATION_UNCONFIRMED',
      projectId:input.projectId,workspaceId:input.workspaceId,operationId:input.operationId,retrySameOperation:true},202);
    // Do not turn an actual COMMIT into an error after late cancellation or expose
    // private SQL/filesystem diagnostics to the browser.
    return response({success:true,status:'committed',value:result.value,cleanupPending:Boolean(result.cleanupErrors?.length)},200);
  }catch(error){return failure(error);}
  finally{releaseIngress?.();}
}
