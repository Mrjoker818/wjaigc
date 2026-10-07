import 'server-only';

import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { createAssetService, type CreateAssetVersionInput, type ResolveAssetReferenceInput } from '@/lib/asset-core/service';
import { createAssetStorageTransaction, lockAssetGraphWriteGate, type AssetStorage,
  type AssetStorageTransaction } from '@/lib/asset-core/storage';
import type { AssetVersion, WorkspaceAssetReference } from '@/lib/asset-core/types';
import { assertDocumentEditor, assertDocumentProjectEnabled } from '@/lib/collaboration/document-access';
import { readTaskPublicationAccess, readTaskPublicationIntent, type TaskPublicationAccess } from '@/lib/collaboration/task-publication-access';
import { readCanvasDocument } from '@/lib/collaboration/canvas-document';
import { loadDocumentInTransaction } from '@/lib/collaboration/document-store';
import { readAuthorizedExportSources } from '@/lib/multi-platform-export/source-reader';
import { loadPersistedExportImages, persistExportImageVersion, persistExportArtifacts } from '@/lib/multi-platform-export/artifacts';
import type { ExecuteSkillStepInput } from './executor';

export interface SkillAssetResolutionInput {
  actorUserId: string; projectId: string; runId: string;
  assetVersionIds: readonly string[]; signal?: AbortSignal;
}
export type SkillPlacementState = { kind: 'live'; placementId: string } | { kind: 'unplaced' }
  | { kind: 'deleted'; placementId: string; removalSequence: number };
export interface SkillAssetResolution {
  actorUserId: string; projectId: string; runId: string;
  references: Array<WorkspaceAssetReference & { placementState?: SkillPlacementState }>;
}
export class SkillAssetScopeError extends Error {
  readonly code = 'SKILL_ASSET_SCOPE_REJECTED'; readonly status = 403;
  constructor() { super('Skill asset scope rejected'); }
}
function reject(): never { throw new SkillAssetScopeError(); }
function id(value: string): string {
  if (!value || value !== value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) reject();
  return value;
}
function ids(value: readonly string[], maximum = 100): string[] {
  if (!Array.isArray(value) || value.length > maximum || new Set(value).size !== value.length) reject();
  return value.map(id);
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v) : [];
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject();
  return value as Record<string, unknown>;
}
interface RunIdentity {
  ownerId: string; access: TaskPublicationAccess; intent: unknown;
  created: Record<string, unknown>; outputIds: Set<string>; sourceIds: string[];
}
type RunInput = Pick<SkillAssetResolutionInput, 'actorUserId' | 'projectId' | 'runId' | 'signal'> & {
  executionFence?: ExecuteSkillStepInput['operation']['executionFence'];
  stepId?: string;
};
/** Current read authorization is distinct from the original execution grant. */
async function identity(client: PoolClient, input: RunInput, writing = false): Promise<RunIdentity> {
  input.signal?.throwIfAborted();
  const task = (await client.query<{ user_id: string; project_id: string; type: string; status: string;
    credit_status: string; refunded_transaction_id: string }>(
    'SELECT user_id,project_id,type,status,credit_status,refunded_transaction_id FROM cloud_tasks WHERE id=$1 FOR SHARE', [id(input.runId)] )).rows[0];
  if (!task || task.user_id !== id(input.actorUserId) || task.project_id !== id(input.projectId)
    || task.type !== 'agent-run' || (writing && (task.status !== 'processing'
      || task.credit_status === 'refunded' || task.refunded_transaction_id))) reject();
  const access = await readTaskPublicationAccess(client, input.actorUserId, input.runId);
  const intent = access ? await readTaskPublicationIntent(client, input.actorUserId, input.runId) : null;
  const events = (await client.query<{ event_type: string; payload: Record<string, unknown> }>(
    `SELECT event_type,payload FROM wujie_agent_events WHERE task_id=$1 AND owner_id=$2 AND project_id=$3 ORDER BY sequence`,
    [input.runId,input.actorUserId,input.projectId])).rows;
  const createdRows = events.filter(e => e.event_type === 'run.created');
  if (createdRows.length !== 1) reject();
  const created = object(createdRows[0].payload), skill = object(created.skillSnapshot);
  if (typeof skill.id !== 'string' || !Number.isSafeInteger(skill.version) || Number(skill.version) < 1) reject();
  if (!Array.isArray(created.sourceVersionIds) || created.sourceVersionIds.some(v => typeof v !== 'string')) reject();
  const sourceIds = ids(created.sourceVersionIds as string[]);
  const outputIds = new Set<string>();
  for (const event of events) {
    if (event.event_type === 'asset.created' && typeof event.payload.assetVersionId === 'string') outputIds.add(event.payload.assetVersionId);
    if (event.event_type === 'tool.completed' || event.event_type === 'run.completed') {
      for (const versionId of strings(event.payload.assetVersionIds)) outputIds.add(versionId);
    }
  }
  if (writing) {
    const fence = input.executionFence;
    if (!fence || fence.runId !== input.runId) reject();
    const lease = await client.query(`SELECT 1 FROM wujie_agent_execution_leases WHERE task_id=$1 AND owner_id=$2 AND project_id=$3
      AND lease_owner=$4 AND generation=$5 AND paused_at=0 AND completed_at=0 FOR SHARE`,
      [input.runId,input.actorUserId,input.projectId,fence.leaseOwner,fence.generation]);
    if (lease.rowCount !== 1) reject();
    await client.query('SELECT 1 FROM wujie_projects WHERE id=$1 FOR UPDATE',[input.projectId]);
  }
  let ownerId = input.actorUserId;
  if (access) {
    if (created.workspace !== 'canvas' || (created.workspaceId !== input.projectId && created.workspaceId !== `canvas:${input.projectId}`)
      || access.projectId !== input.projectId) reject();
    ownerId = (await assertDocumentEditor(input.actorUserId,input.projectId,client,writing ? access.grantGeneration : undefined)).ownerId;
    if (ownerId !== access.ownerId) reject();
    await assertDocumentProjectEnabled(client,ownerId,input.projectId);
  } else {
    // Only genuine absent publication + personal project uses the old namespace.
    const project = (await client.query<{owner_id:string; enabled:boolean|null}>(`SELECT p.owner_id,s.enabled
      FROM wujie_projects p JOIN wujie_users actor ON actor.id=$2 AND actor.status='active'
      LEFT JOIN wujie_project_document_settings s ON s.project_id=p.id
      WHERE p.id=$1 AND p.status='active' FOR SHARE OF p,actor`,[input.projectId,input.actorUserId])).rows[0];
    if (!project || project.owner_id !== input.actorUserId || project.enabled) reject();
  }
  input.signal?.throwIfAborted();
  return {ownerId,access,intent,created,sourceIds,outputIds};
}
async function transaction<T>(input: RunInput, writing: boolean,
  callback: (client: PoolClient, scope: RunIdentity) => Promise<T>): Promise<T> {
  const client = await getPool().connect(); let discard = false, committing = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    if (writing) await lockAssetGraphWriteGate(client,'shared');
    const scope = await identity(client,input,writing);
    const result = await callback(client,scope);
    input.signal?.throwIfAborted(); committing = true; await client.query('COMMIT'); return result;
  } catch (error) {
    if (committing) discard = true;
    else try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally { client.release(discard); }
}
function bind(input: RunInput, actorUserId: string, projectId: string): void {
  if (actorUserId !== input.actorUserId || projectId !== input.projectId) reject();
}
function repository(client: PoolClient, input: RunInput, scope: RunIdentity): AssetStorageTransaction {
  const native = createAssetStorageTransaction(client);
  // Used only by existing readonly export/retry/report repositories.
  return new Proxy(native, { get(target, key, receiver) {
    if (key === 'findProject') return async (actor: string, project: string): Promise<boolean> => {
      bind(input,actor,project); return target.findProject(scope.ownerId,project);
    };
    if (key === 'findVersion') return async (actor: string, project: string, version: string): Promise<AssetVersion|null> => {
      bind(input,actor,project);
      const found=await target.findVersion(scope.ownerId,project,version);if(!found)return null;
      const lineage=scope.created.retryLineage;
      const reused=lineage&&typeof lineage==='object'&&!Array.isArray(lineage)
        ?strings((lineage as Record<string,unknown>).reusedImageAssetVersionIds):[];
      if(scope.sourceIds.includes(version)||scope.outputIds.has(version)||reused.includes(version)
        ||(input.stepId&&found.metadata?.runId===input.runId&&found.metadata.skillStepId===input.stepId))return found;
      if(found.taskId) {
        const child=await client.query(`SELECT 1 FROM cloud_tasks WHERE id=$1 AND user_id=$2 AND project_id=$3
          AND status='completed' AND result->'skillBillingProvenance'->>'runId'=$4 FOR SHARE`,
          [found.taskId,input.actorUserId,input.projectId,input.runId]);
        if(child.rowCount===1)return found;
      }
      reject();
    };
    if (key === 'findAsset') return async (actor: string, project: string, asset: string) => {
      bind(input,actor,project); return target.findAsset(scope.ownerId,project,asset);
    };
    if (key === 'findVersionByIdempotency') return async (actor: string, project: string, keyValue: string) => {
      bind(input,actor,project);
      if(!keyValue.startsWith(`skill:${input.runId}:export:`))reject();
      return target.findVersionByIdempotency(scope.ownerId,project,keyValue);
    };
    void receiver;
    // This facade is readonly, even though the existing repository interface also
    // describes mutation methods used by AssetService's separate native writer.
    return () => reject();
  } });
}
export function skillRunAssetReadStorage(input: RunInput): AssetStorage {
  return { read: callback => transaction(input,false,(client,scope) => callback(repository(client,input,scope))),
    transaction: async () => reject() };
}
export async function resolveSkillRunAssets(input: SkillAssetResolutionInput): Promise<SkillAssetResolution> {
  const requested = ids(input.assetVersionIds);
  if (!requested.length) reject();
  return transaction(input,false,async (client,scope) => {
    if (requested.some(v => !scope.outputIds.has(v))) reject();
    const storage: AssetStorage = { read: async callback => callback(createAssetStorageTransaction(client)),transaction: async () => reject() };
    const service = createAssetService(storage);
    const references: SkillAssetResolution['references'] = [];
    let loaded: Awaited<ReturnType<typeof loadDocumentInTransaction>> | undefined;
    try {
      if (scope.access) loaded = await loadDocumentInTransaction(client,input.projectId);
      const placements = loaded ? readCanvasDocument(loaded.doc).placements : {};
      for (const versionId of requested) {
        input.signal?.throwIfAborted();
        const reference = await service.resolveReadableAssetReference({ actorUserId:scope.ownerId,projectId:input.projectId,assetVersionId:versionId });
        const live = Object.entries(placements).filter(([,p])=>p.assetVersionId===versionId&&!p.deleted);
        const deleted = Object.entries(placements).filter(([,p])=>p.assetVersionId===versionId&&p.deleted);
        let placementState: SkillPlacementState = {kind:'unplaced'};
        if (live.length > 1) reject();
        if (live.length) {
          placementState={kind:'live',placementId:live[0][0]};
          const row = (await client.query<{entity_id:string}>(`SELECT entity_id FROM wujie_workspace_placements
            WHERE id=$1 AND owner_id=$2 AND project_id=$3 AND asset_version_id=$4 AND status='active' FOR SHARE`,
            [live[0][0],scope.ownerId,input.projectId,versionId])).rows[0];
          if (!row) reject(); reference.placementId=live[0][0]; reference.entityId=row.entity_id;
        } else if (deleted.length) {
          const row=(await client.query<{placement_id:string;document_sequence:string}>(`SELECT placement_id,document_sequence::text
            FROM wujie_canvas_asset_commands WHERE project_id=$1 AND owner_id=$2 AND asset_version_id=$3
              AND placement_id=ANY($4) AND remove_snapshot IS NOT NULL ORDER BY document_sequence DESC LIMIT 1`,
            [input.projectId,scope.ownerId,versionId,deleted.map(([placementId])=>placementId)])).rows[0];
          if(!row || !Number.isSafeInteger(Number(row.document_sequence)) || Number(row.document_sequence)<1)reject();
          placementState={kind:'deleted',placementId:row.placement_id,removalSequence:Number(row.document_sequence)};
        }
        references.push({...reference,...(scope.access?{placementState}:{})});
      }
    } finally {loaded?.doc.destroy();}
    return {actorUserId:input.actorUserId,projectId:input.projectId,runId:input.runId,references};
  });
}
/** Input preview is a distinct allowlist, never an expansion of run outputs. */
export async function resolveSkillRunSources(input: SkillAssetResolutionInput): Promise<SkillAssetResolution> {
  const requested = ids(input.assetVersionIds);
  if (!requested.length) reject();
  return transaction(input, false, async (client, scope) => {
    if (requested.some(version => !scope.sourceIds.includes(version))) reject();
    const storage: AssetStorage = { read: async callback => callback(createAssetStorageTransaction(client)), transaction: async () => reject() };
    const service = createAssetService(storage);
    const references: SkillAssetResolution['references'] = [];
    for (const assetVersionId of requested) {
      input.signal?.throwIfAborted();
      references.push(await service.resolveReadableAssetReference({ actorUserId: scope.ownerId, projectId: input.projectId, assetVersionId }));
      input.signal?.throwIfAborted();
    }
    return { actorUserId: input.actorUserId, projectId: input.projectId, runId: input.runId, references };
  });
}
export interface SkillDocumentAssetScopeInput extends RunInput {
  stepId: string; requestDigest: string; sourceVersionIds: readonly string[];
  executionFence: ExecuteSkillStepInput['operation']['executionFence'];
  toolId: string; operationKey: string; operationIdempotencyKey: string;
}
async function sourceIdentities(client: PoolClient, ownerId: string, projectId: string, sources: string[]): Promise<unknown[]> {
  const result = await client.query<{ identity: unknown }>(`SELECT jsonb_build_object('version',to_jsonb(v),'asset',to_jsonb(a)) AS identity
    FROM wujie_asset_versions v JOIN wujie_assets a ON a.id=v.asset_id AND a.owner_id=v.owner_id AND a.project_id=v.project_id
    WHERE v.owner_id=$1 AND v.project_id=$2 AND v.id=ANY($3) AND v.availability='ready' AND a.status='active'
    ORDER BY v.id FOR SHARE OF v,a`,[ownerId,projectId,sources]);
  if (result.rows.length !== sources.length) reject();
  return result.rows.map(row => row.identity);
}
declare const delivery: unique symbol;
export interface PreparedSkillDelivery { readonly [delivery]: true }
interface Delivery {input: RunInput; versions: string[]; identities: unknown[]; scope: RunIdentity; grant: string}
const deliveries = new WeakMap<PreparedSkillDelivery, Delivery>();
async function currentGrant(client: PoolClient,input:RunInput,ownerId:string):Promise<string> {
  if (ownerId === input.actorUserId) return '0';
  const row = (await client.query<{generation:string}>(`SELECT grant_generation::text AS generation FROM wujie_project_document_editors
    WHERE project_id=$1 AND owner_id=$2 AND member_user_id=$3 AND status='active' FOR SHARE`,
    [input.projectId,ownerId,input.actorUserId])).rows[0];
  if (!row) reject(); return row.generation;
}
function deliveryState(capability:PreparedSkillDelivery):Delivery {return deliveries.get(capability)??reject();}
export async function prepareSkillDelivery(input: SkillAssetResolutionInput):Promise<PreparedSkillDelivery> {
  const versions=ids(input.assetVersionIds);
  const value=await transaction(input,false,async(client,scope)=>{
    if(!scope.access || !versions.length || versions.some(v=>!scope.outputIds.has(v)))reject();
    const identities=await sourceIdentities(client,scope.ownerId,input.projectId,versions);
    return {input:{actorUserId:input.actorUserId,projectId:input.projectId,runId:input.runId,signal:input.signal},versions,
      identities,scope,grant:await currentGrant(client,input,scope.ownerId)};
  });
  const capability=Object.freeze({}) as PreparedSkillDelivery; deliveries.set(capability,value); return capability;
}
export async function assertPreparedSkillDelivery(client:PoolClient, capability:PreparedSkillDelivery):Promise<{ownerId:string;intent:unknown}> {
  const frozen=deliveryState(capability),scope=await identity(client,frozen.input);
  if(!scope.access||scope.ownerId!==frozen.scope.ownerId||!isDeepStrictEqual(scope.intent,frozen.scope.intent)
    ||!isDeepStrictEqual(scope.created,frozen.scope.created)||!isDeepStrictEqual(scope.access,frozen.scope.access)
    ||await currentGrant(client,frozen.input,scope.ownerId)!==frozen.grant
    ||frozen.versions.some(v=>!scope.outputIds.has(v))
    ||!isDeepStrictEqual(await sourceIdentities(client,scope.ownerId,frozen.input.projectId,frozen.versions),frozen.identities))reject();
  return {ownerId:scope.ownerId,intent:scope.intent};
}
/** Durable replay validates today's read authority, not the historical execution lease. */
export async function readSkillDeliveryIdentity(client:PoolClient,input:RunInput,versions:readonly string[]):Promise<{ownerId:string;intent:unknown}> {
  const scope=await identity(client,input);
  if(!scope.access||ids(versions).some(v=>!scope.outputIds.has(v)))reject();
  return {ownerId:scope.ownerId,intent:scope.intent};
}
/** File/Sharp operations remain in the existing consumers, outside storage callbacks. */
export async function createSkillDocumentAssetScope(input: SkillDocumentAssetScopeInput) {
  id(input.stepId); id(input.requestDigest); const sources = ids(input.sourceVersionIds,32);
  const frozen = await transaction(input,false,async (client,scope) => {
    if(sources.some(v=>!scope.sourceIds.includes(v)))reject();
    const versions = await sourceIdentities(client,scope.ownerId,input.projectId,sources);
    return {scope,versions};
  });
  async function check(client: PoolClient): Promise<RunIdentity> {
    const scope=await identity(client,input,true);
    if(!isDeepStrictEqual(scope.access,frozen.scope.access)||!isDeepStrictEqual(scope.intent,frozen.scope.intent)
      ||!isDeepStrictEqual(scope.created,frozen.scope.created))reject();
    const versions=await sourceIdentities(client,scope.ownerId,input.projectId,sources);
    const operation = await client.query(`SELECT 1 FROM wujie_agent_downstream_operations WHERE operation_key=$1
      AND owner_id=$2 AND project_id=$3 AND task_id=$4 AND tool_id=$5 AND request_digest=$6
      AND idempotency_key=$7 AND step_id=$8 AND status='prepared' FOR SHARE`,[input.operationKey,input.actorUserId,input.projectId,
      input.runId,input.toolId,input.requestDigest,input.operationIdempotencyKey,input.stepId]);
    if (operation.rowCount !== 1) reject();
    if(!isDeepStrictEqual(versions,frozen.versions))reject(); return scope;
  }
  const guarded: AssetStorage = {read:callback=>transaction(input,false,(client)=>callback(createAssetStorageTransaction(client))),
    transaction:callback=>transaction(input,true,async(client)=>{
      const scope=await check(client),nativeStorage=createAssetStorageTransaction(client);
      const storage=new Proxy(nativeStorage,{get(target,key,receiver){
        if(key==='insertVersion')return async(version:AssetVersion,requestDigest:string,metadata?:Record<string,unknown>):Promise<void>=>{
          if(version.ownerId!==scope.ownerId||version.projectId!==input.projectId||metadata?.skillStepId!==input.stepId
            ||metadata?.skillStepRequestDigest!==input.requestDigest)reject();
          for(const parentId of version.parentVersionIds) {
            const parent=await target.findVersion(scope.ownerId,input.projectId,parentId);
            if(!parent)reject();
            if(metadata?.schemaId==='multi-platform-export-v1') {if(!sources.includes(parent.id))reject();}
            else if(metadata?.schemaId==='multi-platform-export-manifest-v1'||metadata?.schemaId==='multi-platform-export-archive-v1') {
              const lineage=scope.created.retryLineage;
              const reused=lineage&&typeof lineage==='object'&&!Array.isArray(lineage)
                ?strings((lineage as Record<string,unknown>).reusedImageAssetVersionIds):[];
              if(parent.metadata?.schemaId!=='multi-platform-export-v1'||!sources.includes(String(parent.metadata.sourceAssetVersionId))
                ||(parent.metadata.runId!==input.runId&&!reused.includes(parent.id)))reject();
            }else reject();
          }
          await target.insertVersion(version,requestDigest,metadata);
        };
        const value:unknown=Reflect.get(target,key,receiver);return typeof value==='function'?value.bind(target):value;
      }});
      const result=await callback(storage);await check(client);return result;
    })};
  const native=createAssetService(guarded);
  const reader=skillRunAssetReadStorage(input);
  async function ownedReference(value: ResolveAssetReferenceInput) {
    bind(input,value.actorUserId,value.projectId);
    return transaction(input,false,async(client,scope)=>{
      const version=await createAssetStorageTransaction(client).findVersion(scope.ownerId,input.projectId,value.assetVersionId);
      const lineage=scope.created.retryLineage;
      const reused=lineage&&typeof lineage==='object'&&!Array.isArray(lineage)
        ?strings((lineage as Record<string,unknown>).reusedImageAssetVersionIds):[];
      if(!version||(!sources.includes(version.id)&&!reused.includes(version.id)
        &&(version.metadata?.runId!==input.runId||version.metadata?.skillStepId!==input.stepId)))reject();
      const service=createAssetService({read:async cb=>cb(createAssetStorageTransaction(client)),transaction:async()=>reject()});
      return service.resolveReadableAssetReference({...value,actorUserId:scope.ownerId});
    });
  }
  function creation(value: CreateAssetVersionInput): CreateAssetVersionInput {
    bind(input,value.actorUserId,value.projectId);
    const meta=value.metadata;
    if(!meta||value.assetId)reject();
    const parents=value.parentVersionIds??[];
    const exportImage=meta.schemaId==='multi-platform-export-v1';
    const artifact=meta.schemaId==='multi-platform-export-manifest-v1'||meta.schemaId==='multi-platform-export-archive-v1';
    const report=meta.schemaId==='platform-compliance-report-v1';
    if(!report&&meta.runId!==input.runId)reject();
    if(exportImage) {
      if(value.kind!=='image'||parents.length!==1||parents[0]!==meta.sourceAssetVersionId||!sources.includes(parents[0])
        ||value.idempotencyKey!==`skill:${input.runId}:export:${String(meta.sourceAssetVersionId)}:${String(meta.presetId)}:v${String(meta.presetVersion)}`)reject();
    } else if(artifact) {
      if(value.kind!=='document'||!parents.length||parents.length>100
        ||!['manifest','zip'].some(suffix=>value.idempotencyKey===`skill:${input.runId}:export:${suffix}`))reject();
    } else if(report) {
      const reportSources=strings(meta.sourceVersionIds),trace=object(meta.sourceTrace);
      if(value.kind!=='document'||trace.runId!==input.runId||!reportSources.length||reportSources.some(v=>!sources.includes(v))
        || !['completed','vision-error'].some(phase => value.idempotencyKey === `${input.operationIdempotencyKey}:report-asset:${phase}`)
        || value.requestDigest !== input.requestDigest)reject();
    } else reject();
    return {...value,actorUserId:frozen.scope.ownerId,metadata:{...meta,runId:input.runId,skillStepId:input.stepId,skillStepRequestDigest:input.requestDigest}};
  }
  const assetService={
    resolveAssetReference:ownedReference,
    createAssetVersion:async(value:CreateAssetVersionInput)=>native.createAssetVersion(creation(value)),
    createAssetVersionsAtomically:async(values:readonly CreateAssetVersionInput[])=>{
      const mapped=values.map(creation);
      return native.createAssetVersionsAtomically(mapped);
    },
    findAssetVersionByIdempotency:async(value:{actorUserId:string;projectId:string;idempotencyKey:string;requestDigest:string})=>{
      bind(input,value.actorUserId,value.projectId);
      if(!value.idempotencyKey.startsWith(`skill:${input.runId}:export:`)
        &&!['completed','vision-error'].some(phase=>value.idempotencyKey===`${input.operationIdempotencyKey}:report-asset:${phase}`))reject();
      return transaction(input,false,async(client,scope)=>createAssetService({read:async cb=>cb(createAssetStorageTransaction(client)),transaction:async()=>reject()})
        .findAssetVersionByIdempotency({...value,actorUserId:scope.ownerId}));
    },
  };
  const readExportSources:typeof readAuthorizedExportSources=value=>{
    bind(input,value.actorUserId,value.projectId);
    return readAuthorizedExportSources({...value,dependencies:{...value.dependencies,resolveAssetReference:ownedReference}});
  };
  return {assetService,storage:reader,readExportSources,
    persistExportImage:(value:Parameters<typeof persistExportImageVersion>[0])=>persistExportImageVersion({...value,assetService}),
    loadPersistedExportImages:(value:Parameters<typeof loadPersistedExportImages>[0])=>loadPersistedExportImages({...value,storage:reader,readSources:readExportSources}),
    persistExportArtifacts:(value:Parameters<typeof persistExportArtifacts>[0])=>persistExportArtifacts({...value,assetService,imageVersionStorage:reader}),
  };
}
