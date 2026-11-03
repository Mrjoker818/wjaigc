import type {AssetStorage} from '@/lib/asset-core/storage';
import {AssetService,AssetServiceError,type CreateVersionWithPlacementInput} from '@/lib/asset-core/service';
import {assertWorkspaceEntityType,type Asset,type AssetVersion,type WorkspacePlacement} from '@/lib/asset-core/types';

export interface WorkflowImageBatchResult {asset:Asset;version:AssetVersion;placement:WorkspacePlacement;reused:boolean}

function nonempty(value:unknown):value is string {return typeof value==='string'&&value.trim().length>0;}
function invalid():never {throw new TypeError('WORKFLOW_IMAGE_BATCH_INVALID');}

function snapshotInputs(inputs:readonly CreateVersionWithPlacementInput[]):CreateVersionWithPlacementInput[] {
  if(!Array.isArray(inputs)||inputs.length<1||inputs.length>65)invalid();
  const head=inputs[0],keys=new Set<string>(),entities=new Set<string>();
  for(const input of inputs){
    if(!input||input.kind!=='image'||input.assetId!==undefined||typeof input.resolveFile!=='function'
      ||![input.actorUserId,input.projectId,input.idempotencyKey,input.requestDigest,input.placement?.workspaceId,input.placement?.entityId].every(nonempty))invalid();
    if(input.actorUserId!==head.actorUserId||input.projectId!==head.projectId
      ||input.placement.workspace!==head.placement.workspace||input.placement.workspaceId!==head.placement.workspaceId
      ||input.placement.entityType!==head.placement.entityType)throw new TypeError('WORKFLOW_IMAGE_BATCH_SCOPE_INVALID');
    assertWorkspaceEntityType(input.placement.workspace,input.placement.entityType);
    if(input.parentVersionIds!==undefined&&(!Array.isArray(input.parentVersionIds)||!input.parentVersionIds.every(nonempty)))invalid();
    const entity=JSON.stringify([input.placement.workspace,input.placement.workspaceId,input.placement.entityType,input.placement.entityId]);
    if(keys.has(input.idempotencyKey)||entities.has(entity))invalid();
    keys.add(input.idempotencyKey);entities.add(entity);
  }
  return inputs.map(input=>{
    const resolveFile=input.resolveFile;
    return {...input,parentVersionIds:input.parentVersionIds?.slice(),
      metadata:input.metadata===undefined?undefined:structuredClone(input.metadata),placement:structuredClone(input.placement),
      resolveFile:async()=>structuredClone(await resolveFile())};
  });
}

/** The caller supplies authorized storage and prepared files; this is not an access grant.
 * A legacy parent must already be resolved in the caller's SAME outer transaction.
 * No file cleanup or uncertain-COMMIT inference belongs in this storage adapter. */
export async function createWorkflowImageAssetBatch(storage:AssetStorage,inputs:readonly CreateVersionWithPlacementInput[],signal?:AbortSignal):Promise<WorkflowImageBatchResult[]> {
  signal?.throwIfAborted();
  const items=snapshotInputs(inputs),{actorUserId,projectId}=items[0];
  return storage.transaction(async transaction=>{
    signal?.throwIfAborted();
    if(!await transaction.findProject(actorUserId,projectId))throw new AssetServiceError('ASSET_NOT_FOUND');
    // The original per-item service also takes these locks. Acquire the complete
    // set first in a stable order without opening another storage transaction.
    for(const key of items.map(item=>item.idempotencyKey).sort()){
      signal?.throwIfAborted();await transaction.lockVersionIdempotency(actorUserId,projectId,key);
    }
    const existing=[];
    for(const item of items){
      signal?.throwIfAborted();
      const version=await transaction.findVersionByIdempotency(actorUserId,projectId,item.idempotencyKey);
      if(version&&version.requestDigest!==item.requestDigest)throw new AssetServiceError('ASSET_IDEMPOTENCY_CONFLICT');
      existing.push(version);
    }
    const existingCount=existing.filter(item=>item!==null).length;
    if(existingCount!==0&&existingCount!==items.length)throw new Error('WORKFLOW_IMAGE_BATCH_PARTIAL_REPLAY');
    if(existingCount===items.length){
      for(let index=0;index<items.length;index++){
        signal?.throwIfAborted();
        const replay=existing[index],item=items[index];
        if(!replay)throw new Error('WORKFLOW_IMAGE_BATCH_PARTIAL_REPLAY');
        const asset=await transaction.lockAsset(actorUserId,projectId,replay.version.assetId);
        if(!asset||asset.status!=='active'||asset.kind!=='image'||replay.version.ownerId!==actorUserId
          ||replay.version.projectId!==projectId||replay.version.file.availability!=='ready')
          throw new AssetServiceError('ASSET_PLACEMENT_CONFLICT');
        const placement=await transaction.findActivePlacement(actorUserId,projectId,item.placement.workspace,
          item.placement.workspaceId,item.placement.entityType,item.placement.entityId);
        if(!placement||placement.assetId!==asset.id||placement.assetVersionId!==replay.version.id)
          throw new AssetServiceError('ASSET_PLACEMENT_CONFLICT');
      }
    }
    const scopedStorage:AssetStorage={read:async callback=>callback(transaction),transaction:async callback=>callback(transaction)};
    const service=new AssetService(scopedStorage),results:WorkflowImageBatchResult[]=[];
    for(const item of items){
      signal?.throwIfAborted();
      const result=await service.createVersionWithPlacement(item);
      signal?.throwIfAborted();results.push(structuredClone(result));
    }
    signal?.throwIfAborted();
    // The storage owner controls COMMIT. A later cancellation/ambiguous commit
    // must be reconciled by the preparation job before touching staged files.
    return results;
  });
}
