import 'server-only';

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { lockAssetGraphWriteGate } from '@/lib/asset-core/storage';
import { assertDocumentEditor, assertDocumentProjectEnabled, DocumentAccessError } from './document-access';
import { loadDocumentInTransaction, commitDocumentSkillRestorationInTransaction } from './document-store';
import { readCanvasDocument } from './canvas-document';
import { readTaskPublicationAccess } from './task-publication-access';
import { prepareDocumentAssetsForImport, prepareDocumentAssetsForSkillBatch } from './document-asset-validation';
import { executeDocumentAssetCommandInTransaction } from './document-asset-commands';
import { parseDocumentAssetCommandRequest } from './canvas-asset-command';
import { prepareSkillRestoration, type PreparedSkillRestoration } from './document-skill-restoration';
import { resolveSkillRunAssets, prepareSkillDelivery, assertPreparedSkillDelivery, readSkillDeliveryIdentity } from '@/lib/skill-runtime/document-assets';
import { acquireKey, prepareDocumentVersionForBatch, preparedDocumentMediaCommitIdentity,
  commitPreparedDocumentMediaInTransaction, cleanupPreparedDocumentMediaCommit, readDocumentMediaBatchChild,
  type PreparedDocumentMediaCommit } from './document-media-import';
import { DocumentMediaError, assertMediaActive, mediaDeadline, parseMediaAdoption, parseMediaVersionImport } from './document-media-request';
import { parseDocumentMediaBatchRequest, type DocumentMediaBatchRequest, type DocumentMediaBatchResult,
  type DocumentMediaBatchItemResult } from './document-media-batch-request';

function conflict(): never { throw new DocumentMediaError('DOCUMENT_MEDIA_CONFLICT'); }
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function documentMediaBatchKeys(actorId: string, input: Pick<DocumentMediaBatchRequest, 'projectId' | 'idempotencyKey'>):
{ root: string; child(index: number): string } {
  const identity = digest([actorId, input.projectId, input.idempotencyKey]);
  return { root: 'batch-root:' + identity, child: (index: number): string => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= 100) conflict();
    return 'batch-child:' + identity + ':' + index;
  } };
}
interface CanonicalRow {
  placement_id: string; asset_id: string; asset_version_id: string; entity_id: string; file_url: string; kind: 'image' | 'video';
}
async function canonical(client: PoolClient, ownerId: string, projectId: string, versionId: string,
  placementId?: string): Promise<DocumentMediaBatchItemResult> {
  const { doc, sequence } = await loadDocumentInTransaction(client, projectId);
  try {
    const placements = Object.entries(readCanvasDocument(doc).placements).filter(([id, placement]) =>
      !placement.deleted && placement.assetVersionId === versionId && (!placementId || id === placementId));
    if (placements.length !== 1) conflict();
    const id = placements[0][0];
    const rows = (await client.query<CanonicalRow>(`SELECT placement.id AS placement_id,version.asset_id,
      version.id AS asset_version_id,placement.entity_id,version.file_url,asset.kind
      FROM wujie_workspace_placements placement
      JOIN wujie_asset_versions version ON version.id=placement.asset_version_id
        AND version.asset_id=placement.asset_id AND version.owner_id=placement.owner_id AND version.project_id=placement.project_id
      JOIN wujie_assets asset ON asset.id=version.asset_id AND asset.owner_id=version.owner_id AND asset.project_id=version.project_id
      JOIN wujie_projects project ON project.id=asset.project_id AND project.owner_id=asset.owner_id
      WHERE placement.id=$1 AND placement.owner_id=$2 AND placement.project_id=$3
        AND placement.asset_version_id=$4 AND placement.status='active' AND placement.workspace_kind='canvas'
        AND placement.workspace_id IN ($3,'canvas:' || $3) AND placement.entity_type IN ('canvas-image','canvas-video')
        AND placement.entity_type='canvas-' || asset.kind
        AND version.availability='ready' AND asset.status='active' AND project.status='active' AND asset.kind IN ('image','video')
      FOR SHARE OF placement,version,asset,project`, [id, ownerId, projectId, versionId])).rows;
    const row = rows[0];
    if (rows.length !== 1 || row.placement_id !== id || row.asset_version_id !== versionId
      || !row.asset_id || !row.entity_id || !row.file_url || !['image','video'].includes(row.kind)) conflict();
    return { sourceVersionId: versionId, mode: 'confirm', childKey: null, placementId: id,
      assetVersionId: versionId, documentSequence: sequence,
      assetReference: { assetId: row.asset_id, assetVersionId: versionId, placementId: id,
        entityId: row.entity_id, url: row.file_url, kind: row.kind } };
  } finally { doc.destroy(); }
}
type SourceIdentity = ReturnType<typeof preparedDocumentMediaCommitIdentity>;
interface ManifestItem {
  result: DocumentMediaBatchItemResult;
  source: null | Omit<SourceIdentity, 'byteSize'>;
}
interface Manifest { version: 1; actorId: string; ownerId: string; request: DocumentMediaBatchRequest;
  digest: string; items: ManifestItem[]; documentSequence: number; skill?: {runId:string;intent:unknown} }
interface RootRow { owner_id: string; placement_id: string; asset_id: string; asset_version_id: string;
  document_sequence: string; request_digest: string; source_request_digest: string | null;
  source_kind: string | null; batch_manifest: unknown }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) conflict();
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) conflict();
}
/** Validate persisted JSONB before any per-item read. Schema casts never grant ACK. */
function manifest(row: RootRow, actorId: string, ownerId: string, input: DocumentMediaBatchRequest): Manifest {
  const value = record(row.batch_manifest);
  exactKeys(value, ['version','actorId','ownerId','request','digest','items','documentSequence',...(input.skillRunId?['skill']:[])]);
  if(input.skillRunId) {
    const skill=record(value.skill);exactKeys(skill,['runId','intent']);if(skill.runId!==input.skillRunId)conflict();
  }
  if (value.version !== 1 || value.actorId !== actorId || value.ownerId !== ownerId
    || row.owner_id !== ownerId || row.source_kind !== null
    || value.digest !== digest(input) || row.request_digest !== value.digest || row.source_request_digest !== value.digest
    || !isDeepStrictEqual(parseDocumentMediaBatchRequest(value.request), input)
    || !Number.isSafeInteger(value.documentSequence) || Number(value.documentSequence) < 0
    || String(value.documentSequence) !== row.document_sequence || !Array.isArray(value.items)
    || value.items.length !== input.items.length) conflict();
  const keys = documentMediaBatchKeys(actorId, input);
  for (const [index, raw] of value.items.entries()) {
    const item = record(raw); exactKeys(item, ['result','source']);
    const result = record(item.result);
    exactKeys(result, ['sourceVersionId','mode','childKey','placementId','assetVersionId','documentSequence','assetReference']);
    if (result.sourceVersionId !== input.items[index].sourceVersionId
      || !Number.isSafeInteger(result.documentSequence) || Number(result.documentSequence) < 0
      || Number(result.documentSequence) > Number(value.documentSequence)
      || typeof result.placementId !== 'string' || !result.placementId
      || typeof result.assetVersionId !== 'string' || !result.assetVersionId) conflict();
    if (result.mode === 'confirm') {
      if (item.source !== null || result.childKey !== null || result.assetVersionId !== result.sourceVersionId) conflict();
    } else if (input.skillRunId && (result.mode === 'attach' || result.mode === 'restore')) {
      if(item.source!==null||result.childKey!==keys.child(index)||result.assetVersionId!==result.sourceVersionId
        ||(result.mode==='restore')!==!!input.items[index].restore)conflict();
    } else if (result.mode === 'import' && !input.skillRunId) {
      if (result.childKey !== keys.child(index)) conflict();
      const source = record(item.source);
      exactKeys(source, ['actorId','input','sourceProjectId','sourceDigest','kind']);
      const bound = source.kind === 'task' ? parseMediaAdoption(source.input) : source.kind === 'version'
        ? parseMediaVersionImport(source.input) : conflict();
      if (source.actorId !== actorId || typeof source.sourceProjectId !== 'string' || !source.sourceProjectId
        || source.sourceDigest !== digest({ kind: source.kind, input: bound })
        || bound.projectId !== input.projectId || bound.sourceVersionId !== result.sourceVersionId
        || bound.idempotencyKey !== keys.child(index) || !isDeepStrictEqual(bound.command, input.items[index].command)) conflict();
    } else conflict();
  }
  if (value.documentSequence !== Math.max(...(value.items as ManifestItem[]).map(item => item.result.documentSequence))) conflict();
  const result = (value.items[0] as ManifestItem).result;
  const ref = record(result.assetReference);
  if (row.placement_id !== result.placementId || row.asset_version_id !== result.assetVersionId || row.asset_id !== ref.assetId) conflict();
  return value as unknown as Manifest;
}
async function readDurable(client: PoolClient, actorId: string, ownerId: string,
  input: DocumentMediaBatchRequest): Promise<DocumentMediaBatchResult | undefined> {
  const root = documentMediaBatchKeys(actorId, input).root;
  const rows = (await client.query<RootRow>(`SELECT owner_id,placement_id,asset_id,asset_version_id,document_sequence::text,
    request_digest,source_request_digest,source_kind,batch_manifest FROM wujie_canvas_asset_commands
    WHERE actor_id=$1 AND project_id=$2 AND idempotency_key=$3`, [actorId, input.projectId, root])).rows;
  if (!rows.length) return undefined;
  if (rows.length !== 1) conflict();
  let sealed: Manifest;
  try { sealed = manifest(rows[0], actorId, ownerId, input); }
  catch { conflict(); }
  if(input.skillRunId) {
    const current=await readSkillDeliveryIdentity(client,{actorUserId:actorId,projectId:input.projectId,runId:input.skillRunId},
      input.items.map(item=>item.sourceVersionId));
    if(current.ownerId!==ownerId||!isDeepStrictEqual(current.intent,sealed.skill?.intent))conflict();
  }
  for (const [index, item] of sealed.items.entries()) {
    const current = await canonical(client, ownerId, input.projectId, item.result.assetVersionId, item.result.placementId);
    if (!isDeepStrictEqual(current.assetReference, item.result.assetReference)) conflict();
    if (item.result.mode === 'confirm' && input.items[index].placementId
      && input.items[index].placementId !== item.result.placementId) conflict();
    if (item.source) {
      const child = await readDocumentMediaBatchChild(client, actorId, ownerId, item.source.input, item.source.sourceProjectId);
      if (!isDeepStrictEqual(child, { placementId: item.result.placementId, assetVersionId: item.result.assetVersionId,
        documentSequence: item.result.documentSequence, assetReference: item.result.assetReference })) conflict();
    }
    if(item.result.mode==='attach'||item.result.mode==='restore') {
      const command=parseDocumentAssetCommandRequest({projectId:input.projectId,idempotencyKey:item.result.childKey,
        command:{...input.items[index].command,assetVersionId:item.result.assetVersionId}}).command;
      const child=(await client.query<{request_digest:string;placement_id:string;asset_version_id:string;document_sequence:string;source_request_digest:string|null}>(
        `SELECT request_digest,placement_id,asset_version_id,document_sequence::text,source_request_digest
          FROM wujie_canvas_asset_commands WHERE actor_id=$1 AND project_id=$2 AND owner_id=$3 AND idempotency_key=$4`,
        [actorId,input.projectId,ownerId,item.result.childKey])).rows[0];
      if(!child||child.request_digest!==digest(command)||child.source_request_digest!==null
        ||child.placement_id!==item.result.placementId||child.asset_version_id!==item.result.assetVersionId
        ||Number(child.document_sequence)!==item.result.documentSequence)conflict();
    }
  }
  const current = await loadDocumentInTransaction(client, input.projectId);
  try { if (current.sequence < sealed.documentSequence) conflict(); }
  finally { current.doc.destroy(); }
  return { projectId: input.projectId, documentSequence: sealed.documentSequence, items: sealed.items.map(item => item.result) };
}
async function authorizedSnapshot(actorId: string, input: DocumentMediaBatchRequest): Promise<{
  ownerId: string; result?: DocumentMediaBatchResult; confirmations: Array<DocumentMediaBatchItemResult | undefined>;
}> {
  const client = await getPool().connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    const runIdentity=input.skillRunId?await readSkillDeliveryIdentity(client,
      {actorUserId:actorId,projectId:input.projectId,runId:input.skillRunId},input.items.map(item=>item.sourceVersionId)):undefined;
    const { ownerId } = await assertDocumentEditor(actorId, input.projectId, client);
    if(runIdentity&&runIdentity.ownerId!==ownerId)conflict();
    await assertDocumentProjectEnabled(client, ownerId, input.projectId);
    const result = await readDurable(client, actorId, ownerId, input);
    const confirmations: Array<DocumentMediaBatchItemResult | undefined> = [];
    if (!result && !input.skillRunId) for (const item of input.items) {
      const rows = (await client.query<{ owner_id: string; project_id: string }>(`SELECT owner_id,project_id FROM wujie_asset_versions
        WHERE id=$1 AND (owner_id=$2 OR (owner_id=$3 AND project_id=$4))`,
      [item.sourceVersionId, actorId, ownerId, input.projectId])).rows;
      if (rows.length !== 1) throw new DocumentMediaError('DOCUMENT_MEDIA_SOURCE_FORBIDDEN');
      const source = rows[0];
      if (source.owner_id === ownerId && source.project_id === input.projectId) {
        confirmations.push(await canonical(client, ownerId, input.projectId, item.sourceVersionId, item.placementId));
      } else {
        if (source.owner_id !== actorId) throw new DocumentMediaError('DOCUMENT_MEDIA_SOURCE_FORBIDDEN');
        // A source that already belongs to any enabled shared document is not personal.
        const settings = await client.query('SELECT 1 FROM wujie_project_document_settings WHERE project_id=$1 AND enabled=true', [source.project_id]);
        if (settings.rowCount) throw new DocumentMediaError('DOCUMENT_MEDIA_SOURCE_FORBIDDEN');
        confirmations.push(undefined);
      }
    }
    await client.query('COMMIT');
    return { ownerId, result, confirmations };
  } catch (error) { try { await client.query('ROLLBACK'); } catch { discard = true; } throw error; }
  finally { client.release(discard); }
}

/** Canonical ready media and explicit restores reuse the same root, lock and final transaction. */
async function importSkillBatch(actorId:string,input:DocumentMediaBatchRequest,signal:AbortSignal):Promise<DocumentMediaBatchResult> {
  if(!input.skillRunId)conflict();
  const keys=documentMediaBatchKeys(actorId,input);
  await authorizedSnapshot(actorId,input);
  const lock=await acquireKey(actorId,{projectId:input.projectId,idempotencyKey:keys.root},signal);
  try {
    const prior=await authorizedSnapshot(actorId,input);if(prior.result)return prior.result;
    const delivery=await prepareSkillDelivery({actorUserId:actorId,projectId:input.projectId,runId:input.skillRunId,
      assetVersionIds:input.items.map(item=>item.sourceVersionId),signal});
    const resolved=await resolveSkillRunAssets({actorUserId:actorId,projectId:input.projectId,runId:input.skillRunId,
      assetVersionIds:input.items.map(item=>item.sourceVersionId),signal});
    const restores=new Map<number,PreparedSkillRestoration>();let bytes=0;
    for(const [index,item] of input.items.entries()) {
      const reference=resolved.references[index],state=reference.placementState;
      if(!reference.assetId||!['image','video'].includes(reference.kind??''))conflict();
      const row=(await getPool().query<{byte_size:string}>(`SELECT byte_size::text FROM wujie_asset_versions
        WHERE id=$1 AND project_id=$2`,[item.sourceVersionId,input.projectId])).rows[0];
      const size=Number(row?.byte_size);if(!Number.isSafeInteger(size)||size<1)conflict();bytes+=size;
      if(!Number.isSafeInteger(bytes)||bytes>512*1024*1024)throw new DocumentMediaError('DOCUMENT_MEDIA_TOO_LARGE');
      if(state?.kind==='deleted') {
        if(!item.restore||item.restore.placementId!==state.placementId
          ||item.restore.expectedRemovalSequence!==state.removalSequence)conflict();
        restores.set(index,await prepareSkillRestoration(actorId,input.projectId,item.sourceVersionId,item.restore,signal));
      }else if(item.restore||!state||(item.placementId&&(state.kind!=='live'||item.placementId!==state.placementId)))conflict();
      assertMediaActive(signal);await lock.check();
    }
    const prepared=await prepareDocumentAssetsForSkillBatch(actorId,input.projectId,input.items.map(item=>item.sourceVersionId),
      [...restores.values()],signal);
    const client=await getPool().connect();let sent=false,released=false,discard=false;
    try {
      await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
      await lockAssetGraphWriteGate(client,'shared');
      const run=await assertPreparedSkillDelivery(client,delivery);
      await client.query('SELECT 1 FROM wujie_projects WHERE id=$1 FOR UPDATE NOWAIT',[input.projectId]);
      if(run.ownerId!==prior.ownerId||await readDurable(client,actorId,run.ownerId,input))conflict();
      const items:ManifestItem[]=[];
      for(const [index,item] of input.items.entries()) {
        assertMediaActive(signal);await lock.check();
        const state=resolved.references[index].placementState;
        if(state?.kind==='live') {
          const current=await canonical(client,run.ownerId,input.projectId,item.sourceVersionId,state.placementId);
          if(item.restore)conflict();items.push({source:null,result:current});continue;
        }
        const loaded=await loadDocumentInTransaction(client,input.projectId);
        try {
          const placements=Object.values(readCanvasDocument(loaded.doc).placements).filter(p=>p.assetVersionId===item.sourceVersionId);
          if(placements.some(p=>!p.deleted)||(!item.restore&&placements.some(p=>p.deleted)))conflict();
        }finally{loaded.doc.destroy();}
        const commandResult=await executeDocumentAssetCommandInTransaction(client,{actorId,projectId:input.projectId,
          idempotencyKey:keys.child(index),command:{...item.command,assetVersionId:item.sourceVersionId}},prepared);
        const restoration=restores.get(index);
        if(restoration) {
          const update=await commitDocumentSkillRestorationInTransaction(client,{actorId,projectId:input.projectId,
            placementId:commandResult.placementId,prepared,restoration});
          commandResult.documentSequence=update.sequence;
          await client.query(`UPDATE wujie_canvas_asset_commands SET document_sequence=$4
            WHERE actor_id=$1 AND project_id=$2 AND idempotency_key=$3`,[actorId,input.projectId,keys.child(index),update.sequence]);
        }
        const current=await canonical(client,run.ownerId,input.projectId,item.sourceVersionId,commandResult.placementId);
        items.push({source:null,result:{...current,documentSequence:commandResult.documentSequence,
          mode:restoration?'restore':'attach',childKey:keys.child(index)}});
      }
      await assertPreparedSkillDelivery(client,delivery);
      const loaded=await loadDocumentInTransaction(client,input.projectId);const documentSequence=loaded.sequence;loaded.doc.destroy();
      const sealed:Manifest={version:1,actorId,ownerId:run.ownerId,request:input,digest:digest(input),items,documentSequence,
        skill:{runId:input.skillRunId,intent:run.intent}};
      const first=items[0].result;
      await client.query(`INSERT INTO wujie_canvas_asset_commands
        (actor_id,project_id,idempotency_key,request_digest,owner_id,placement_id,asset_id,asset_version_id,
          document_sequence,source_request_digest,source_kind,batch_manifest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$4,NULL,$10::jsonb)`,[actorId,input.projectId,keys.root,sealed.digest,run.ownerId,
        first.placementId,first.assetReference.assetId,first.assetVersionId,documentSequence,JSON.stringify(sealed)]);
      const result=await readDurable(client,actorId,run.ownerId,input);if(!result)conflict();
      assertMediaActive(signal);await lock.check();sent=true;await client.query('COMMIT');return result;
    }catch(error) {
      if(sent) {
        client.release(true);released=true;
        try{const recovered=await authorizedSnapshot(actorId,input);if(recovered.result)return recovered.result;}catch{/* No authorized durable ACK. */}
        throw new Error('DOCUMENT_MEDIA_COMMIT_UNCONFIRMED');
      }
      try{await client.query('ROLLBACK');}catch{discard=true;}throw error;
    }finally{if(!released)client.release(discard);}
  }finally{await lock.release();}
}

/** All new-media and Yjs children share this one final COMMIT. */
export async function importDocumentMediaBatch(actorId: string, value: unknown, parentSignal?: AbortSignal): Promise<DocumentMediaBatchResult> {
  const input = parseDocumentMediaBatchRequest(value);
  const deadline = mediaDeadline(parentSignal);
  const signal = deadline.signal;
  const keys = documentMediaBatchKeys(actorId, input);
  const capabilities = new Map<number, PreparedDocumentMediaCommit>();
  let preserve = false;
  let lock: Awaited<ReturnType<typeof acquireKey>> | undefined;
  try {
    assertMediaActive(signal);
    if(input.skillRunId)return await importSkillBatch(actorId,input,signal);
    await authorizedSnapshot(actorId, input); // Authorization before advisory lock or live source preparation.
    lock = await acquireKey(actorId, { projectId: input.projectId, idempotencyKey: keys.root }, signal);
    const initial = await authorizedSnapshot(actorId, input);
    assertMediaActive(signal);
    if (initial.result) return initial.result;
    let byteSize = 0;
    for (const [index, item] of input.items.entries()) {
      assertMediaActive(signal);
      if (initial.confirmations[index]) continue;
      const capability = await prepareDocumentVersionForBatch(actorId, { projectId: input.projectId,
        sourceVersionId: item.sourceVersionId, idempotencyKey: keys.child(index), command: item.command }, signal);
      capabilities.set(index, capability);
      byteSize += preparedDocumentMediaCommitIdentity(capability).byteSize;
      if (!Number.isSafeInteger(byteSize) || byteSize > 512 * 1024 * 1024) throw new DocumentMediaError('DOCUMENT_MEDIA_TOO_LARGE');
      await lock.check();
    }
    const prepared = capabilities.size ? await prepareDocumentAssetsForImport(actorId, input.projectId, input.items[0].command, signal) : undefined;
    const client = await getPool().connect();
    let sent = false, released = false, discard = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
      await lockAssetGraphWriteGate(client, 'shared');
      const identities = [...capabilities.values()].map(preparedDocumentMediaCommitIdentity);
      const tasks = [...new Set(identities.flatMap(identity => 'taskId' in identity.input ? [identity.input.taskId] : []))].sort();
      for (const taskId of tasks) { assertMediaActive(signal); await readTaskPublicationAccess(client, actorId, taskId); }
      const projects = [...new Set([input.projectId, ...identities.map(identity => identity.sourceProjectId)])].sort();
      for (const projectId of projects) {
        const row = await client.query("SELECT id FROM wujie_projects WHERE id=$1 AND status='active' FOR UPDATE NOWAIT", [projectId]);
        if (row.rowCount !== 1) { if (projectId === input.projectId) throw new DocumentAccessError(); conflict(); }
      }
      const { ownerId } = await assertDocumentEditor(actorId, input.projectId, client);
      await assertDocumentProjectEnabled(client, ownerId, input.projectId);
      if (ownerId !== initial.ownerId || await readDurable(client, actorId, ownerId, input)) conflict();
      const items: ManifestItem[] = [];
      for (const [index, item] of input.items.entries()) {
        assertMediaActive(signal); await lock.check();
        const prior = initial.confirmations[index];
        if (prior) {
          const current = await canonical(client, ownerId, input.projectId, item.sourceVersionId, prior.placementId);
          if (!isDeepStrictEqual(current.assetReference, prior.assetReference)) conflict();
          items.push({ result: current, source: null });
        } else {
          const capability = capabilities.get(index);
          if (!capability || !prepared) conflict();
          const identity = preparedDocumentMediaCommitIdentity(capability);
          // No private fallback if a formerly personal project acquired document authority.
          const settings = await client.query('SELECT 1 FROM wujie_project_document_settings WHERE project_id=$1 AND enabled=true FOR SHARE', [identity.sourceProjectId]);
          if (settings.rowCount) throw new DocumentMediaError('DOCUMENT_MEDIA_SOURCE_FORBIDDEN');
          const result = await commitPreparedDocumentMediaInTransaction(client, actorId, capability, prepared, signal);
          const source = { actorId: identity.actorId, input: identity.input, sourceProjectId: identity.sourceProjectId,
            sourceDigest: identity.sourceDigest, kind: identity.kind };
          items.push({ source, result: { ...result, sourceVersionId: item.sourceVersionId, mode: 'import', childKey: keys.child(index) } });
        }
      }
      const current = await loadDocumentInTransaction(client, input.projectId);
      const documentSequence = current.sequence; current.doc.destroy();
      // Revalidate the whole batch after the last child before writing its receipt.
      for (const item of items) {
        const registered = await canonical(client, ownerId, input.projectId, item.result.assetVersionId, item.result.placementId);
        if (!isDeepStrictEqual(registered.assetReference, item.result.assetReference)) conflict();
      }
      const sealed: Manifest = { version: 1, actorId, ownerId, request: input, digest: digest(input), items, documentSequence };
      const first = items[0].result;
      await client.query(`INSERT INTO wujie_canvas_asset_commands
        (actor_id,project_id,idempotency_key,request_digest,owner_id,placement_id,asset_id,asset_version_id,
          document_sequence,source_request_digest,source_kind,batch_manifest)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$4,NULL,$10::jsonb)`,
      [actorId, input.projectId, keys.root, sealed.digest, ownerId, first.placementId,
        first.assetReference.assetId, first.assetVersionId, documentSequence, JSON.stringify(sealed)]);
      const result = await readDurable(client, actorId, ownerId, input);
      if (!result) conflict();
      assertMediaActive(signal); await lock.check();
      sent = true; await client.query('COMMIT'); preserve = true;
      return result;
    } catch (error) {
      if (sent) {
        preserve = true; client.release(true); released = true;
        try { const recovered = await authorizedSnapshot(actorId, input); if (recovered.result) return recovered.result; }
        catch { /* No durable authorized complete ACK; preserve every prepared file. */ }
        throw new Error('DOCUMENT_MEDIA_COMMIT_UNCONFIRMED');
      }
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally { if (!released) client.release(discard); }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && ['55P03','57014','40P01'].includes(String(error.code))) {
      throw new DocumentMediaError('DOCUMENT_MEDIA_BUSY');
    }
    throw error;
  } finally {
    try {
      if (!preserve) {
        const failures: unknown[] = [];
        for (const capability of capabilities.values()) {
          try { await cleanupPreparedDocumentMediaCommit(capability); } catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, 'DOCUMENT_MEDIA_BATCH_CLEANUP_FAILED');
      }
    } finally { try { await lock?.release(); } finally { deadline.dispose(); } }
  }
}
