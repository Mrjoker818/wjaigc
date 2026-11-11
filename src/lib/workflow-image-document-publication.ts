import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {getPool} from '@/lib/db-client';
import {createAssetStorageTransaction} from '@/lib/asset-core/storage';
import type {AssetVersion} from '@/lib/asset-core/types';
import {readDocumentWorkspaceProject} from '@/lib/collaboration/document-workspace-reference';
import {prepareDocumentAssetsForImport} from '@/lib/collaboration/document-asset-validation';
import {DocumentMediaError,parseMediaVersionImport,type MediaImportCommand} from '@/lib/collaboration/document-media-request';
import {importedMediaIdentity} from '@/lib/collaboration/document-media-source';
import {workflowImageGridPreparationIdentity,workflowImageGridDocumentMedia,workflowImagePublishedMediaMatches,type WorkflowImageGridPreparationIdentity,
  type PreparedWorkflowImageGrid,type WorkflowImageGridPublication} from './workflow-image-preparation';
import {commitPreparedDocumentDerivedGridInTransaction,readPreparedDocumentDerivedGridInTransaction,
  type WorkflowDocumentDerivedGridResult} from './collaboration/document-media-import';
export interface WorkflowDocumentImagePublicationDependencies {connect?:()=>Promise<PoolClient>}
export type WorkflowDocumentImageGridPublication=WorkflowImageGridPublication<WorkflowDocumentDerivedGridResult>&{connectionErrors?:readonly unknown[]};
interface GridReplay {value:WorkflowDocumentDerivedGridResult;versions:AssetVersion[]}
type GridAttempt=WorkflowDocumentImageGridPublication|{status:'verify-media';replay:GridReplay};
function conflict():never {throw new DocumentMediaError('DOCUMENT_MEDIA_CONFLICT');}
async function initialCommands(identity:WorkflowImageGridPreparationIdentity,signal:AbortSignal):Promise<MediaImportCommand[]> {
  const {input,source}=identity;
  if(source.access.kind!=='document'||source.access.actorUserId!==input.actorUserId||!source.version
    ||source.access.projectId!==input.projectId||!source.reference?.placementId||identity.legacyParentFile)conflict();
  signal.throwIfAborted();
  const current=await readDocumentWorkspaceProject(input.actorUserId,input.projectId);signal.throwIfAborted();
  const placement=current?.projection.placements[source.reference.placementId];
  if(!current||current.ownerId!==source.access.ownerId||current.projectId!==input.projectId||current.readOnly===true
    ||!placement||placement.deleted||placement.assetVersionId!==source.version.id)conflict();
  const width=source.version.file.width,height=source.version.file.height;
  if(!width||!height||width<1||height<1)conflict();
  const scale=Math.min(placement.width/width,placement.height/height,1200/width,1200/height);
  if(!Number.isFinite(scale)||scale<=0)conflict();
  const coordinate=(value:number):number=>Math.min(1_000_000,Math.max(-1_000_000,value));
  return identity.tiles.map((tile,index)=>parseMediaVersionImport({projectId:input.projectId,sourceVersionId:source.version!.id,
    idempotencyKey:'workflow-grid-layout',command:{action:'attach',transform:{
      x:coordinate(placement.x+placement.width+32+tile.cell.left*scale+tile.cell.column*16),
      y:coordinate(placement.y+tile.cell.top*scale+tile.cell.row*16),
      width:tile.cell.width*scale,height:tile.cell.height*scale,rotation:0,
      zIndex:coordinate(Math.trunc(placement.zIndex)+index+1)}}}).command);
}
/** Original media preparation runs outside the final transaction. Each child and
 * canonical Yjs receipt then commits together on one caller-owned connection. */
export async function publishPreparedDocumentWorkflowImageGrid(prepared:PreparedWorkflowImageGrid,signal:AbortSignal,
  dependencies:WorkflowDocumentImagePublicationDependencies={}):Promise<WorkflowDocumentImageGridPublication> {
  const identity=workflowImageGridPreparationIdentity(prepared),connect=dependencies.connect??(()=>getPool().connect());
  const connectionErrors:unknown[]=[];
  async function attempt(write:boolean,verified?:GridReplay):Promise<GridAttempt> {
    let client:PoolClient|undefined,open=false,commitSent=false,discard=false,released=false;
    const release=():void=>{if(client&&!released){released=true;try{client.release(discard);}catch(error){connectionErrors.push(error);}}};
    try{
      signal.throwIfAborted();
      // Reconciliation inherits the same original physical-media preparation as
      // ordinary replay; a durable command alone is not proof its media is ready.
      const commands=await initialCommands(identity,signal);
      const assets=await prepareDocumentAssetsForImport(identity.input.actorUserId,identity.input.projectId,commands[0],signal);
      signal.throwIfAborted();client=await connect();signal.throwIfAborted();
      open=true;await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
      const value=write
        ?await commitPreparedDocumentDerivedGridInTransaction(client,identity.input.actorUserId,prepared,assets,commands,signal)
        :await readPreparedDocumentDerivedGridInTransaction(client,identity.input.actorUserId,prepared,signal);
      if(!value){await client.query('ROLLBACK');open=false;return {status:'unknown',error:new Error('DOCUMENT_GRID_COMMIT_UNCONFIRMED')};}
      // Only a write returning these preparation IDs can rely on the staged
      // files. A concurrent commit may be newer than the document preflight.
      const freshlyWritten=write&&value.tiles.every(({reference},index)=>
        reference.assetVersionId===importedMediaIdentity(workflowImageGridDocumentMedia(prepared,index)).versionId);
      if(!freshlyWritten){
        const storage=createAssetStorageTransaction(client),versions:AssetVersion[]=[];
        for(const {reference} of value.tiles){
          signal.throwIfAborted();
          const version=await storage.findVersion(identity.source.access.ownerId,identity.input.projectId,reference.assetVersionId);
          if(!version||version.assetId!==reference.assetId||version.file.url!==reference.url)conflict();
          versions.push(version);
        }
        const replay={value,versions};
        if(!verified){await client.query('ROLLBACK');open=false;return {status:'verify-media',replay};}
        if(!isDeepStrictEqual(replay,verified))conflict();
      }
      signal.throwIfAborted();commitSent=true;await client.query('COMMIT');open=false;
      // A definitive COMMIT receipt wins over cancellation arriving during send.
      const actual=new Set(value.tiles.map(tile=>tile.reference.url));
      return {status:'committed',value,retainedFileUrls:[...new Set(identity.tiles.map(tile=>tile.file.url).filter(url=>actual.has(url)))]};
    }catch(error){
      if(commitSent){discard=true;release();return {status:'unknown',error};}
      if(open&&client){try{await client.query('ROLLBACK');open=false;}catch(rollbackError){discard=true;
        return {status:'unknown',error:new AggregateError([error,rollbackError],'DOCUMENT_GRID_ROLLBACK_UNCONFIRMED')};}}
      return {status:'rolled-back',error};
    }finally{release();}
  }
  async function resolved(write:boolean):Promise<WorkflowDocumentImageGridPublication>{
    const first=await attempt(write);if(first.status!=='verify-media')return first;
    try{
      for(const version of first.replay.versions)if(!await workflowImagePublishedMediaMatches(version,signal))conflict();
    }catch(error){return {status:'rolled-back',error};}
    const confirmed=await attempt(false,first.replay);
    return confirmed.status==='verify-media'?{status:'unknown',error:new Error('DOCUMENT_GRID_COMMIT_UNCONFIRMED')}:confirmed;
  }
  let result=await resolved(true);
  if(result.status==='unknown'){
    const original=result.error;
    // Never reuse a connection whose COMMIT outcome is unknown. Only a fresh,
    // fully authorized complete canonical manifest may turn uncertainty into ACK.
    try{const recovered=await resolved(false);result=recovered.status==='committed'?recovered
      :{status:'unknown',error:recovered.status==='unknown'?new AggregateError([original,recovered.error],'DOCUMENT_GRID_COMMIT_UNCONFIRMED'):original};}
    catch(error){result={status:'unknown',error:new AggregateError([original,error],'DOCUMENT_GRID_COMMIT_UNCONFIRMED')};}
  }
  return connectionErrors.length?{...result,connectionErrors}:result;
}
