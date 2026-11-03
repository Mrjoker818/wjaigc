import 'server-only';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {authorizeGenerationProject,type GenerationProjectAccess} from '@/lib/collaboration/generation-project-access';
import {resolveDocumentWorkspaceReference,resolvePersonalWorkspaceReference} from '@/lib/collaboration/document-workspace-reference';
import {prepareWorkflowEditSourceInTransaction} from '@/lib/collaboration/workflow-edit-publication';
import {assertSketchFenceRestoringTimeouts} from '@/lib/sketch-to-code/document';
import {createPostgresAssetStorage,createAssetStorageTransaction,type AssetStorageTransaction} from '@/lib/asset-core/storage';
import {AssetService} from '@/lib/asset-core/service';
import {readManagedAssetVersionBytes} from '@/lib/asset-core/managed-media-read';
import {loadSafeImageInput,detectImageMimeType,withSafeSharp,assertSafePixelDimensions} from '@/lib/safe-image-input';
import type {AssetVersion,WorkspaceAssetReference} from '@/lib/asset-core/types';

export interface WorkflowImageMediaInput {
  actorUserId:string;projectId:string;workspaceId:string;entityId:string;requireManagedAsset?:boolean;
  reference:{projectId?:string;assetId?:string;assetVersionId?:string;placementId?:string;imageUrl?:string};
}
declare const sourceBrand:unique symbol;
export interface WorkflowImageMediaSource {readonly [sourceBrand]:true}
export interface WorkflowImageMediaIdentity {
  input:WorkflowImageMediaInput;access:Exclude<GenerationProjectAccess,{kind:'unscoped'}>;
  reference:WorkspaceAssetReference|null;version:AssetVersion|null;sha256:string;
}
export interface WorkflowImageMedia {bytes:Buffer;mimeType:string;source:WorkflowImageMediaSource}
type ScopedAccess=WorkflowImageMediaIdentity['access'];
interface SourceSnapshot {input:WorkflowImageMediaInput;access:ScopedAccess;reference:WorkspaceAssetReference|null;version:AssetVersion|null}
interface SourceProof extends SourceSnapshot {sha256:string;signal?:AbortSignal}
const sources=new WeakMap<WorkflowImageMediaSource,SourceProof>();
const maxBytes=32*1024*1024,maxPixels=40_000_000;
function invalid():never {throw new Error('WORKFLOW_IMAGE_MEDIA_SOURCE_INVALID');}
function changed():never {throw new Error('WORKFLOW_IMAGE_MEDIA_SOURCE_CHANGED');}
function id(value:unknown):value is string {return typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value&&!/\p{Cc}/u.test(value);}
function freezeInput(input:WorkflowImageMediaInput):WorkflowImageMediaInput {
  if(!input||![input.actorUserId,input.projectId,input.workspaceId,input.entityId].every(id)||!input.reference
    ||typeof input.reference!=='object'||Array.isArray(input.reference)
    ||input.requireManagedAsset!==undefined&&typeof input.requireManagedAsset!=='boolean')invalid();
  const reference:WorkflowImageMediaInput['reference']={};
  for(const key of ['projectId','assetId','assetVersionId','placementId'] as const){
    const value=input.reference[key];if(value!==undefined&&value!==''){if(!id(value))invalid();reference[key]=value;}
  }
  if(input.reference.imageUrl!==undefined){if(typeof input.reference.imageUrl!=='string')invalid();reference.imageUrl=input.reference.imageUrl;}
  if(reference.projectId&&reference.projectId!==input.projectId)invalid();
  return {actorUserId:input.actorUserId,projectId:input.projectId,workspaceId:input.workspaceId,entityId:input.entityId,
    ...(input.requireManagedAsset===undefined?{}:{requireManagedAsset:input.requireManagedAsset}),reference};
}
function referenceTuple(reference:WorkspaceAssetReference):WorkspaceAssetReference {
  return {assetId:reference.assetId,assetVersionId:reference.assetVersionId,placementId:reference.placementId,
    entityId:reference.entityId,kind:reference.kind,url:reference.url};
}
async function storedVersion(transaction:AssetStorageTransaction,access:ScopedAccess,reference:WorkspaceAssetReference):Promise<AssetVersion> {
  if(!id(reference.assetId)||!id(reference.assetVersionId)||reference.kind!=='image')invalid();
  const version=await transaction.findVersion(access.ownerId,access.projectId,reference.assetVersionId);
  const asset=version?await transaction.findAsset(access.ownerId,access.projectId,version.assetId):null;
  // A frozen historical version remains valid; currentVersionId is not its identity.
  if(!version||!asset||asset.status!=='active'||asset.kind!=='image'||asset.ownerId!==access.ownerId
    ||asset.projectId!==access.projectId||asset.id!==reference.assetId||version.id!==reference.assetVersionId
    ||version.assetId!==reference.assetId||version.ownerId!==access.ownerId||version.projectId!==access.projectId
    ||version.file.availability!=='ready'||version.file.url!==reference.url)invalid();
  return structuredClone(version);
}
async function snapshot(input:WorkflowImageMediaInput,signal?:AbortSignal,expectedAccess?:ScopedAccess):Promise<SourceSnapshot> {
  signal?.throwIfAborted();
  const access=await authorizeGenerationProject({actorUserId:input.actorUserId,projectId:input.projectId});
  signal?.throwIfAborted();
  if(expectedAccess&&!isDeepStrictEqual(access,expectedAccess))changed();
  if(access.kind==='unscoped'||access.actorUserId!==input.actorUserId||access.projectId!==input.projectId
    ||!id(access.ownerId)||access.kind==='personal'&&access.ownerId!==input.actorUserId)invalid();
  const {assetVersionId,placementId}=input.reference;
  if(!assetVersionId){
    if(input.requireManagedAsset)throw new Error('WORKFLOW_IMAGE_MEDIA_MANAGED_REQUIRED');
    if(access.kind==='document'||input.reference.assetId||placementId||!input.reference.imageUrl)invalid();
    return {input,access:structuredClone(access),reference:null,version:null};
  }
  const query={projectId:input.projectId,assetVersionId,...(placementId?{placementId}:{})};
  // This is source reading. Do not bind a source/parent to the eventual receiver.
  const resolved=access.kind==='document'
    ?await resolveDocumentWorkspaceReference(input.actorUserId,query)
    :await resolvePersonalWorkspaceReference(input.actorUserId,query);
  signal?.throwIfAborted();
  if(!resolved||resolved.assetVersionId!==assetVersionId||input.reference.assetId&&input.reference.assetId!==resolved.assetId
    ||placementId&&resolved.placementId!==placementId)invalid();
  const reference=referenceTuple(resolved);
  const version=await createPostgresAssetStorage().read(transaction=>storedVersion(transaction,access,reference));
  signal?.throwIfAborted();
  return {input,access:structuredClone(access),reference,version};
}
function proof(source:WorkflowImageMediaSource):SourceProof {const record=sources.get(source);if(!record)invalid();return record;}
/** Reads actual authorized bytes; this capability is not permission for a later write. */
export async function readWorkflowImageMediaForActor(input:WorkflowImageMediaInput,signal?:AbortSignal):Promise<WorkflowImageMedia> {
  signal?.throwIfAborted();input=freezeInput(input);
  const before=await snapshot(input,signal);
  try {
    const read=before.version
      ?await readManagedAssetVersionBytes(before.version,'image',{maxBytes,signal})
      :await loadSafeImageInput(input.reference.imageUrl!,{maxBytes,maxPixels,signal});
    signal?.throwIfAborted();
    const bytes=Buffer.from('bytes' in read?read.bytes:read.buffer),mimeType=read.mimeType;
    if(bytes.length<1||bytes.length>maxBytes||detectImageMimeType(bytes)!==mimeType)invalid();
    const sha256=createHash('sha256').update(bytes).digest('hex');
    if(before.version){
      const file=before.version.file,registered=file.checksum;
      // Registered-MIME reads expose a descriptor; explicitly verify these bytes too.
      if(file.byteSize!==bytes.length||'totalBytes' in read&&read.totalBytes!==bytes.length
        ||registered!==undefined&&(!/^(?:sha256:)?[a-f0-9]{64}$/iu.test(registered)
          ||registered.replace(/^sha256:/iu,'').toLowerCase()!==sha256))invalid();
    }
    const dimensions=await withSafeSharp(bytes,{maxPixels,signal},pipeline=>pipeline.timeout({seconds:30}).metadata());
    assertSafePixelDimensions(dimensions.width,dimensions.height,maxPixels);
    if(before.version&&(before.version.file.width!==undefined&&before.version.file.width!==dimensions.width
      ||before.version.file.height!==undefined&&before.version.file.height!==dimensions.height))invalid();
    signal?.throwIfAborted();
    const after=await snapshot(input,signal,before.access);
    if(!isDeepStrictEqual(after,before))changed();
    const source=Object.freeze({}) as WorkflowImageMediaSource;
    sources.set(source,{...structuredClone(before),sha256,signal});
    return {bytes,mimeType,source};
  } catch(error){signal?.throwIfAborted();throw error;}
}
export function workflowImageMediaIdentity(source:WorkflowImageMediaSource):WorkflowImageMediaIdentity {
  const {signal:_signal,...identity}=proof(source);return structuredClone(identity);
}
/** Caller owns BEGIN/COMMIT and retains these original project/source locks. */
export async function assertWorkflowImageMediaSourceInTransaction(client:PoolClient,source:WorkflowImageMediaSource,signal?:AbortSignal):Promise<void> {
  const record=proof(source),active=():void=>{record.signal?.throwIfAborted();signal?.throwIfAborted();};active();
  await assertSketchFenceRestoringTimeouts(client,record.access);active();
  if(!record.version||!record.reference)return;
  const {access,input,reference,version}=record;
  if(access.kind==='document'){
    if(!reference.placementId||!reference.entityId)invalid();
    const current=await prepareWorkflowEditSourceInTransaction(client,{access,workflowId:input.workspaceId,nodeId:input.entityId,
      sourceEntityId:reference.entityId,sourceVersionId:version.id,sourcePlacementId:reference.placementId,
      imageUrl:reference.url,origin:'https://workflow.local.invalid'});
    if(current.assetId!==reference.assetId||current.sourceVersionId!==version.id
      ||current.sourcePlacementId!==reference.placementId||current.canonicalUrl!==reference.url)changed();
  }
  const locked=await client.query(`SELECT v.id FROM wujie_asset_versions v
    JOIN wujie_assets a ON a.id=v.asset_id AND a.owner_id=v.owner_id AND a.project_id=v.project_id
    WHERE v.id=$1 AND v.asset_id=$2 AND v.owner_id=$3 AND v.project_id=$4 FOR SHARE OF v,a`,
  [version.id,version.assetId,access.ownerId,access.projectId]);
  if(locked.rows.length!==1)changed();active();
  const transaction=createAssetStorageTransaction(client);
  if(access.kind==='personal'){
    if(reference.placementId){
      const placement=await client.query(`SELECT id FROM wujie_workspace_placements
        WHERE id=$1 AND owner_id=$2 AND project_id=$3 AND asset_version_id=$4 AND asset_id=$5
          AND status='active' AND deleted_at IS NULL FOR SHARE`,
      [reference.placementId,access.ownerId,access.projectId,version.id,version.assetId]);
      if(placement.rows.length!==1)changed();
    }
    const storage={read:async<T>(callback:(tx:AssetStorageTransaction)=>Promise<T>):Promise<T>=>callback(transaction),
      transaction:async<T>(_callback:(tx:AssetStorageTransaction)=>Promise<T>):Promise<T>=>{throw new Error('WORKFLOW_IMAGE_MEDIA_UNEXPECTED_WRITE');}};
    const current=await new AssetService(storage).resolveAssetReference({actorUserId:access.actorUserId,projectId:access.projectId,
      assetVersionId:version.id,...(reference.placementId?{placementId:reference.placementId}:{})});
    if(!isDeepStrictEqual(referenceTuple(current),reference))changed();
  }
  if(!isDeepStrictEqual(await storedVersion(transaction,access,reference),version))changed();active();
}
