import 'server-only';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {getPool} from '@/lib/db-client';
import type {AssetVersion,RegisteredWorkspaceAssetReference,WorkspacePlacement} from '@/lib/asset-core/types';
import {AssetService,AssetServiceError,type CreateVersionWithPlacementInput} from '@/lib/asset-core/service';
import {createAssetStorageTransaction,type AssetStorage,type AssetStorageTransaction} from '@/lib/asset-core/storage';
import {readManagedAssetVersionBytes} from '@/lib/asset-core/managed-media-read';
import type {WorkflowImageGridCell} from './workflow-image-actions';
import {workflowImageGridPreparationIdentity,assertWorkflowImageGridPreparationInTransaction,
  type WorkflowImageGridPreparationIdentity,type PreparedWorkflowImageGrid,type WorkflowImageGridPublication} from './workflow-image-preparation';
import {createWorkflowImageAssetBatch} from './workflow-image-batch';
export interface WorkflowImageGridPublicationValue {projectId:string;workspaceId:string;operationId:string;parentVersionId:string;tiles:Array<{nodeId:string;cell:WorkflowImageGridCell;reference:RegisteredWorkspaceAssetReference}>}
export interface WorkflowImagePublicationDependencies {connect?:()=>Promise<PoolClient>;readMedia?:typeof readManagedAssetVersionBytes}
export type PersonalWorkflowImageGridPublication=WorkflowImageGridPublication<WorkflowImageGridPublicationValue>&{connectionErrors?:readonly unknown[]};
interface Intent {root:string;digest:string;parentKey:string;parentDigest:string;keys:string[]}
interface ReplaySnapshot {parentVersionId:string;versions:AssetVersion[];placements:WorkspacePlacement[];legacyParent:AssetVersion|null;value:WorkflowImageGridPublicationValue}
type AttemptResult=PersonalWorkflowImageGridPublication|{status:'verify-media';snapshot:ReplaySnapshot};
const digest=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function conflict():never {throw new AssetServiceError('ASSET_IDEMPOTENCY_CONFLICT');}
function placementConflict():never {throw new AssetServiceError('ASSET_PLACEMENT_CONFLICT');}
function scopedStorage(transaction:AssetStorageTransaction):AssetStorage {return {read:async callback=>callback(transaction),transaction:async callback=>callback(transaction)};}
function intent(identity:WorkflowImageGridPreparationIdentity):Intent {
  const {input,source}=identity;
  if(source.access.kind!=='personal'||source.access.actorUserId!==input.actorUserId||source.access.ownerId!==input.actorUserId
    ||source.access.projectId!==input.projectId||source.input.actorUserId!==input.actorUserId||source.input.projectId!==input.projectId
    ||source.input.workspaceId!==input.workspaceId||source.input.entityId!==input.entityId)throw new Error('WORKFLOW_IMAGE_PUBLICATION_SCOPE_INVALID');
  const root='workflow-image-grid:v1:'+digest([input.actorUserId,input.projectId,input.workspaceId,input.operationId]);
  const requestDigest=digest({version:1,actorUserId:input.actorUserId,projectId:input.projectId,workspaceId:input.workspaceId,
    sourceEntityId:input.entityId,operationId:input.operationId,columns:input.columns,rows:input.rows,targetNodeIds:input.targetNodeIds,
    source:{kind:source.access.kind,ownerId:source.access.ownerId,assetId:source.version?.assetId??null,versionId:source.version?.id??null,
      placementId:source.reference?.placementId??null,sha256:source.sha256,
      urlDigest:digest(source.reference?.url??source.input.reference.imageUrl)}});
  return {root,digest:requestDigest,parentKey:root+':source',parentDigest:digest([requestDigest,'source',source.sha256]),keys:identity.tiles.map((_,index)=>root+':tile:'+index)};
}
function metadata(identity:WorkflowImageGridPreparationIdentity,op:Intent,index:number):Record<string,unknown> {
  return {schema:'workflow-image-grid/v1',rootKey:op.root,operationDigest:op.digest,operationId:identity.input.operationId,
    workspaceId:identity.input.workspaceId,sourceEntityId:identity.input.entityId,sourceSha256:identity.source.sha256,index,
    ...(index<0?{role:'legacy-source'}:{targetNodeId:identity.tiles[index].targetNodeId,cell:identity.tiles[index].cell})};
}
function childInputs(identity:WorkflowImageGridPreparationIdentity,op:Intent,parentVersionId:string):CreateVersionWithPlacementInput[] {
  return identity.tiles.map((tile,index)=>({actorUserId:identity.input.actorUserId,projectId:identity.input.projectId,kind:'image',
    idempotencyKey:op.keys[index],requestDigest:digest([op.digest,index,parentVersionId,tile.file.checksum]),parentVersionIds:[parentVersionId],
    metadata:{workflowImageGrid:metadata(identity,op,index)},resolveFile:async()=>structuredClone(tile.file),
    placement:{workspace:'workflow',workspaceId:identity.input.workspaceId,entityType:'workflow-input',entityId:tile.targetNodeId}}));
}
function value(identity:WorkflowImageGridPreparationIdentity,parentVersionId:string,versions:readonly AssetVersion[],placements:readonly WorkspacePlacement[]):WorkflowImageGridPublicationValue {
  return {projectId:identity.input.projectId,workspaceId:identity.input.workspaceId,operationId:identity.input.operationId,parentVersionId,
    tiles:versions.map((version,index)=>({nodeId:identity.tiles[index].targetNodeId,cell:structuredClone(identity.tiles[index].cell),
      reference:{assetId:version.assetId,assetVersionId:version.id,placementId:placements[index].id,entityId:placements[index].entityId,kind:'image',url:version.file.url}}))};
}
async function lockTargets(transaction:AssetStorageTransaction,identity:WorkflowImageGridPreparationIdentity):Promise<void> {
  for(const entityId of [...identity.input.targetNodeIds].sort())await transaction.lockWorkspacePlacementSlot(identity.input.actorUserId,
    identity.input.projectId,'workflow',identity.input.workspaceId,'workflow-input',entityId);
}
async function lockVersion(client:PoolClient,version:AssetVersion):Promise<void> {
  const locked=await client.query(`SELECT v.id FROM wujie_asset_versions v
    JOIN wujie_assets a ON a.id=v.asset_id AND a.owner_id=v.owner_id AND a.project_id=v.project_id
    WHERE v.id=$1 AND v.asset_id=$2 AND v.owner_id=$3 AND v.project_id=$4 FOR SHARE OF v,a`,
  [version.id,version.assetId,version.ownerId,version.projectId]);if(locked.rows.length!==1)placementConflict();
}
function matchingFile(version:AssetVersion,file:AssetVersion['file']):void {
  if(version.file.availability!=='ready'||version.file.checksum!==file.checksum||version.file.mimeType!==file.mimeType
    ||version.file.byteSize!==file.byteSize||version.file.width!==file.width||version.file.height!==file.height)placementConflict();
}
/** A durable lookup never calls creation/restore paths. Its root/id/slot/asset/placement
 * locks remain held until the caller's COMMIT or ROLLBACK. */
async function inspect(client:PoolClient,transaction:AssetStorageTransaction,identity:WorkflowImageGridPreparationIdentity,op:Intent):Promise<ReplaySnapshot|null> {
  const {actorUserId,projectId}=identity.input;
  const parent=identity.source.version?null:await transaction.findVersionByIdempotency(actorUserId,projectId,op.parentKey);
  if(parent&&parent.requestDigest!==op.parentDigest)conflict();
  const children=[];for(const key of op.keys)children.push(await transaction.findVersionByIdempotency(actorUserId,projectId,key));
  const count=children.filter(Boolean).length;
  if(count===0){if(parent)throw new Error('WORKFLOW_IMAGE_BATCH_PARTIAL_REPLAY');return null;}
  if(count!==children.length||!identity.source.version&&!parent)throw new Error('WORKFLOW_IMAGE_BATCH_PARTIAL_REPLAY');
  const parentVersionId=identity.source.version?.id??parent!.version.id,expected=childInputs(identity,op,parentVersionId);
  const versions=children.map((row,index)=>{if(!row||row.requestDigest!==expected[index].requestDigest)conflict();return structuredClone(row.version);});
  const assets=[...new Set([...versions.map(version=>version.assetId),...(parent?[parent.version.assetId]:[])])].sort();
  for(const assetId of assets){const asset=await transaction.lockAsset(actorUserId,projectId,assetId);if(!asset||asset.status!=='active'||asset.kind!=='image')placementConflict();}
  if(parent){
    await lockVersion(client,parent.version);
    const current=await transaction.findVersionByIdempotency(actorUserId,projectId,op.parentKey);
    if(!current||current.requestDigest!==op.parentDigest||!isDeepStrictEqual(current.version,parent.version))conflict();
    if(!identity.legacyParentFile||!isDeepStrictEqual(parent.version.metadata?.workflowImageGrid,metadata(identity,op,-1)))conflict();
    matchingFile(parent.version,identity.legacyParentFile);
  }
  const placements:WorkspacePlacement[]=[];
  for(const [index,version]of versions.entries()){
    await lockVersion(client,version);
    const current=await transaction.findVersionByIdempotency(actorUserId,projectId,op.keys[index]);
    if(!current||current.requestDigest!==expected[index].requestDigest||!isDeepStrictEqual(current.version,version))conflict();
    if(version.ownerId!==actorUserId||version.projectId!==projectId||!isDeepStrictEqual(version.parentVersionIds,[parentVersionId])
      ||!isDeepStrictEqual(version.metadata?.workflowImageGrid,metadata(identity,op,index)))conflict();
    matchingFile(version,identity.tiles[index].file);
    const located=await transaction.findActivePlacement(actorUserId,projectId,'workflow',identity.input.workspaceId,'workflow-input',identity.tiles[index].targetNodeId);
    if(!located)placementConflict();
    const placement=await transaction.lockPlacement(actorUserId,projectId,located.id);
    if(!placement||placement.status!=='active'||placement.deletedAt!==null||placement.ownerId!==actorUserId||placement.projectId!==projectId
      ||placement.workspace!=='workflow'||placement.workspaceId!==identity.input.workspaceId||placement.entityType!=='workflow-input'
      ||placement.entityId!==identity.tiles[index].targetNodeId||placement.assetVersionId!==version.id||placement.assetId!==version.assetId)placementConflict();
    placements.push(structuredClone(placement));
  }
  return {parentVersionId,versions,placements,legacyParent:parent?structuredClone(parent.version):null,value:value(identity,parentVersionId,versions,placements)};
}
function retained(identity:WorkflowImageGridPreparationIdentity,snapshot:ReplaySnapshot):string[] {
  const actual=new Set([...snapshot.versions.map(version=>version.file.url),...(snapshot.legacyParent?[snapshot.legacyParent.file.url]:[])]);
  return [...identity.tiles.map(tile=>tile.file.url),...(identity.legacyParentFile?[identity.legacyParentFile.url]:[])].filter(url=>actual.has(url));
}
async function verifyMedia(snapshot:ReplaySnapshot,signal:AbortSignal,read:typeof readManagedAssetVersionBytes):Promise<void> {
  // Outside a DB transaction, still inside the preparation's single full IO job.
  for(const version of [...(snapshot.legacyParent?[snapshot.legacyParent]:[]),...snapshot.versions]){
    signal.throwIfAborted();const media=await read(version,'image',{maxBytes:32*1024*1024,signal});signal.throwIfAborted();
    if(media.mimeType!==version.file.mimeType||media.bytes.length!==version.file.byteSize||media.totalBytes!==media.bytes.length
      ||createHash('sha256').update(media.bytes).digest('hex')!==version.file.checksum)placementConflict();
  }
}
/** Personal asset publication only. The document dispatcher must use canonical
 * commands and PreparedImportedMedia; it must never call this as the owner. */
export async function publishPreparedPersonalWorkflowImageGrid(prepared:PreparedWorkflowImageGrid,signal:AbortSignal,dependencies:WorkflowImagePublicationDependencies={}):Promise<PersonalWorkflowImageGridPublication> {
  const identity=workflowImageGridPreparationIdentity(prepared),op=intent(identity),connect=dependencies.connect??(()=>getPool().connect()),read=dependencies.readMedia??readManagedAssetVersionBytes;
  const connectionErrors:unknown[]=[];
  async function attempt(write:boolean,verified?:ReplaySnapshot):Promise<AttemptResult>{
    let client:PoolClient|undefined,open=false,commitSent=false,discard=false,closed=false;
    const release=():void=>{if(client&&!closed){closed=true;try{client.release(discard);}catch(error){connectionErrors.push(error);}}};
    try {
      signal.throwIfAborted();client=await connect();signal.throwIfAborted();
      open=true;await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
      await assertWorkflowImageGridPreparationInTransaction(client,prepared,signal);
      const transaction=createAssetStorageTransaction(client);
      await transaction.lockVersionIdempotency(identity.input.actorUserId,identity.input.projectId,op.root);
      for(const key of [...op.keys,...(!identity.source.version?[op.parentKey]:[])].sort())await transaction.lockVersionIdempotency(identity.input.actorUserId,identity.input.projectId,key);
      await lockTargets(transaction,identity);signal.throwIfAborted();
      const replay=await inspect(client,transaction,identity,op);
      if(replay){
        if(!verified){await client.query('ROLLBACK');open=false;return {status:'verify-media',snapshot:replay};}
        if(!isDeepStrictEqual(replay,verified))placementConflict();
        signal.throwIfAborted();commitSent=true;await client.query('COMMIT');open=false;
        return {status:'committed',value:replay.value,retainedFileUrls:retained(identity,replay)};
      }
      if(!write){await client.query('ROLLBACK');open=false;return {status:'unknown',error:new Error('WORKFLOW_IMAGE_PUBLICATION_UNCONFIRMED')};}
      const storage=scopedStorage(transaction),service=new AssetService(storage);
      let parentVersionId=identity.source.version?.id;
      if(!parentVersionId){
        if(!identity.legacyParentFile)throw new Error('WORKFLOW_IMAGE_PUBLICATION_PARENT_INVALID');
        const parent=await service.createAssetVersion({actorUserId:identity.input.actorUserId,projectId:identity.input.projectId,kind:'image',
          idempotencyKey:op.parentKey,requestDigest:op.parentDigest,file:identity.legacyParentFile,metadata:{workflowImageGrid:metadata(identity,op,-1)}});
        if(parent.reused||parent.asset.status!=='active')conflict();parentVersionId=parent.version.id;
      }
      const rows=await createWorkflowImageAssetBatch(storage,childInputs(identity,op,parentVersionId),signal);
      if(rows.some(row=>row.reused))throw new Error('WORKFLOW_IMAGE_BATCH_PARTIAL_REPLAY');
      const result=value(identity,parentVersionId,rows.map(row=>row.version),rows.map(row=>row.placement));
      signal.throwIfAborted();commitSent=true;await client.query('COMMIT');open=false;
      return {status:'committed',value:result,retainedFileUrls:[...identity.tiles.map(tile=>tile.file.url),...(identity.legacyParentFile?[identity.legacyParentFile.url]:[])]};
    } catch(error){
      if(commitSent){discard=true;release();return {status:'unknown',error};}
      if(open&&client){try{await client.query('ROLLBACK');open=false;}catch(rollbackError){discard=true;return {status:'unknown',error:new AggregateError([error,rollbackError],'WORKFLOW_IMAGE_PUBLICATION_ROLLBACK_UNCONFIRMED')};}}
      return {status:'rolled-back',error};
    } finally {release();}
  }
  async function resolved(write:boolean):Promise<PersonalWorkflowImageGridPublication>{
    const first=await attempt(write);
    if(first.status!=='verify-media')return first;
    try {await verifyMedia(first.snapshot,signal,read);}
    catch(error){return {status:'rolled-back',error};}
    const confirmed=await attempt(false,first.snapshot);
    return confirmed.status==='verify-media'?{status:'unknown',error:new Error('WORKFLOW_IMAGE_PUBLICATION_UNCONFIRMED')}:confirmed;
  }
  let result=await resolved(true);
  if(result.status==='unknown'){
    // Discarded COMMIT session is never reused. Fresh exact root/child locks and
    // active complete results may ACK; absence/failure stays unknown, no deletion.
    const original=result.error;
    try {const recovered=await resolved(false);if(recovered.status==='committed')result=recovered;
      else result={status:'unknown',error:recovered.status==='unknown'?new AggregateError([original,recovered.error],'WORKFLOW_IMAGE_PUBLICATION_UNCONFIRMED'):original};}
    catch(error){result={status:'unknown',error:new AggregateError([original,error],'WORKFLOW_IMAGE_PUBLICATION_UNCONFIRMED')};}
  }
  return connectionErrors.length?{...result,connectionErrors}:result;
}
