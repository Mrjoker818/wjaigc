import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Doc } from 'yjs';
import { getPool } from '@/lib/db-client';
import { assertDocumentEditor, assertDocumentProjectEnabled } from './document-access';
import { parseDocumentPlacementRemovalSnapshot, DocumentAssetCommandConflictError,
  type DocumentPlacementRemovalSnapshot } from './canvas-asset-command';
import { readCanvasDocument } from './canvas-document';
import { restoreCanvasDocumentAnnotationIdentity } from './canvas-document-image-bridge';

export interface SkillRestorationRequest { placementId: string; expectedRemovalSequence: number }
declare const restoration: unique symbol;
export interface PreparedSkillRestoration { readonly [restoration]: true }
interface Restoration {
  actorId: string; projectId: string; ownerId: string; versionId: string;
  request: SkillRestorationRequest; snapshot: DocumentPlacementRemovalSnapshot;
}
const restored = new WeakMap<PreparedSkillRestoration, Restoration>();
function conflict(): never { throw new DocumentAssetCommandConflictError(); }
function state(capability: PreparedSkillRestoration): Restoration { return restored.get(capability) ?? conflict(); }
async function snapshot(client: PoolClient, input: Omit<Restoration,'snapshot'>, signal?: AbortSignal): Promise<DocumentPlacementRemovalSnapshot> {
  signal?.throwIfAborted();
  const {ownerId}=await assertDocumentEditor(input.actorId,input.projectId,client);
  signal?.throwIfAborted();
  if(ownerId!==input.ownerId)conflict();await assertDocumentProjectEnabled(client,ownerId,input.projectId);
  signal?.throwIfAborted();
  const row=(await client.query<{remove_snapshot:unknown}>(`SELECT command.remove_snapshot FROM wujie_canvas_asset_commands command
    JOIN wujie_workspace_placements placement ON placement.id=command.placement_id
      AND placement.asset_version_id=command.asset_version_id AND placement.owner_id=command.owner_id AND placement.project_id=command.project_id
    WHERE command.project_id=$1 AND command.owner_id=$2 AND command.placement_id=$3 AND command.asset_version_id=$4
      AND command.document_sequence=$5 AND command.remove_snapshot IS NOT NULL AND placement.status='trashed'
      AND placement.workspace_kind='canvas' AND placement.workspace_id IN ($1,'canvas:'||$1)
    FOR SHARE OF command,placement`,[input.projectId,ownerId,input.request.placementId,input.versionId,input.request.expectedRemovalSequence])).rows;
  signal?.throwIfAborted();
  if(row.length!==1)conflict();
  const value=parseDocumentPlacementRemovalSnapshot(row[0].remove_snapshot);
  if(value.projectId!==input.projectId||value.placementId!==input.request.placementId||value.placement.assetVersionId!==input.versionId)conflict();
  return value;
}
export async function prepareSkillRestoration(actorId:string,projectId:string,versionId:string,
  request:SkillRestorationRequest, signal?: AbortSignal):Promise<PreparedSkillRestoration> {
  signal?.throwIfAborted();
  const client=await getPool().connect();let discard=false;
  try {
    signal?.throwIfAborted();
    await client.query('BEGIN');signal?.throwIfAborted();
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");signal?.throwIfAborted();
    const {ownerId}=await assertDocumentEditor(actorId,projectId,client);signal?.throwIfAborted();
    const value={actorId,projectId,ownerId,versionId,request:{...request}};
    const captured=await snapshot(client,value,signal);signal?.throwIfAborted();await client.query('COMMIT');
    signal?.throwIfAborted();
    const capability=Object.freeze({}) as PreparedSkillRestoration;
    restored.set(capability,{...value,snapshot:captured});return capability;
  } catch(error){try{await client.query('ROLLBACK');}catch{discard=true;}throw error;}
  finally{client.release(discard);}
}
/** Read-only preparation targets come only from the sealed server remove record. */
export function skillRestorationMediaTargets(capability:PreparedSkillRestoration): {
  versionId:string; annotationAssetIds:string[];
} {
  const value=state(capability);
  return {versionId:value.versionId,annotationAssetIds:[...new Set(Object.values(value.snapshot.annotationRecords)
    .flatMap(annotation=>[annotation.maskAssetId,annotation.overlayAssetId].filter((id):id is string=>!!id)))]};
}
/** No raw snapshot/JS callback authority: only WeakMap-minted capability reaches mutation. */
export async function applyPreparedSkillRestoration(client:PoolClient,doc:Doc,capability:PreparedSkillRestoration,
  actorId:string,projectId:string,newPlacementId:string):Promise<void> {
  const value=state(capability);
  if(value.actorId!==actorId||value.projectId!==projectId||newPlacementId===value.request.placementId)conflict();
  const current=await snapshot(client,value);
  if(!isDeepStrictEqual(current,value.snapshot))conflict();
  const projection=readCanvasDocument(doc),old=projection.placements[value.request.placementId],next=projection.placements[newPlacementId];
  if(!old?.deleted||old.assetVersionId!==value.versionId||!next||next.deleted||next.assetVersionId!==value.versionId
    ||!isDeepStrictEqual(old,{...current.placement,deleted:true}))conflict();
  for(const [id,annotation] of Object.entries(current.annotationRecords)) {
    if(!projection.annotationTombstones?.[id]||!isDeepStrictEqual(projection.annotationRecords?.[id],annotation))conflict();
  }
  const placement={...current.placement};
  const liveGroups=current.groupIds.filter(id=>projection.groupDefinitions?.[id]&&!projection.groupTombstones?.[id]);
  if(placement.groupId&&!liveGroups.includes(placement.groupId))placement.groupId=null;
  doc.transact(()=>{
    doc.getMap('transforms').set(newPlacementId,{x:placement.x,y:placement.y,width:placement.width,height:placement.height,
      rotation:placement.rotation,zIndex:placement.zIndex});
    if(placement.groupId!==undefined)doc.getMap('groups').set(newPlacementId,placement.groupId);
    if(placement.annotation!==undefined)doc.getMap('annotations').set(newPlacementId,placement.annotation);
    for(const id of liveGroups){const group=projection.groupDefinitions![id];
      doc.getMap('groupDefinitions').set(id,{...group,imageIds:[...group.imageIds,newPlacementId]});}
    for(const annotation of Object.values(current.annotationRecords)){
      const id=randomUUID();doc.getMap('annotationRecords').set(id,restoreCanvasDocumentAnnotationIdentity(annotation,id,newPlacementId));}
  },'skill-explicit-restore');
  await client.query('UPDATE wujie_workspace_placements SET transform=$2::jsonb,updated_at=now() WHERE id=$1 AND owner_id=$3 AND project_id=$4',
    [newPlacementId,JSON.stringify({x:placement.x,y:placement.y,width:placement.width,height:placement.height,
      rotation:placement.rotation,zIndex:placement.zIndex}),value.ownerId,projectId]);
}
