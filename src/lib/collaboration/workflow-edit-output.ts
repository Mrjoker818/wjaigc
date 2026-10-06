import 'server-only';

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { getPool } from '@/lib/db-client';
import { completeCloudTask, terminateCloudTaskAndRefund } from '@/lib/cloud-task-storage';
import { persistAssetBytes, type PersistedAssetFile } from '@/lib/asset-core/binary-persistence';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import { readWorkflowEditAcceptedResult } from './workflow-edit-acceptance';
import { importedMediaIdentity, prepareAdoptedMedia, prepareMediaTaskSource,
  assertMediaTaskSource } from './document-media-source';
import { prepareWorkflowEditSourceInTransaction, WorkflowEditSourceError,
  type WorkflowEditPublicationInput } from './workflow-edit-publication';

interface WorkflowEditRow {
  id: string; user_id: string; project_id: string; status: string;
  credit_status: string; error: string | null;
  request_digest: string | null; provider_id: string | null; model: string | null;
  result: Record<string, unknown>;
  actor_id: string; owner_id: string; workflow_id: string; node_id: string;
  intent_project_id: string;
  source_entity_id: string; grant_generation: string; source_asset_id: string;
  source_version_id: string; source_placement_id: string; canonical_url: string;
  intent_digest: string; intent_provider_id: string; intent_model_id: string;
  rejection_reason: string | null;
}

interface OutputRow {
  task_id: string; output_index: number; owner_id: string; project_id: string;
  asset_id: string; version_id: string; placement_id: string; source_url: string;
  checksum: string;
}

function outputEntityId(nodeId: string, outputIndex: number): string {
  return outputIndex === 0 ? nodeId : `${nodeId}:${outputIndex}`;
}

export class WorkflowEditOutputError extends Error {
  constructor(readonly code: 'WORKFLOW_EDIT_OUTPUT_CONFLICT' | 'WORKFLOW_EDIT_OUTPUT_PENDING') {
    super(code);
    this.name = 'WorkflowEditOutputError';
  }
}

function outputUrl(result: Record<string, unknown>): string {
  const image = result.image;
  if (image && typeof image === 'object' && !Array.isArray(image)
    && typeof (image as Record<string, unknown>).url === 'string') {
    return (image as Record<string, unknown>).url as string;
  }
  const images = result.images;
  if (Array.isArray(images) && images[0] && typeof images[0] === 'object'
    && typeof (images[0] as Record<string, unknown>).url === 'string') {
    return (images[0] as Record<string, unknown>).url as string;
  }
  return typeof result.imageUrl === 'string' ? result.imageUrl : '';
}

async function readWorkflowEdit(client: PoolClient, taskId: string, actorId: string,
  lock: 'share' | 'update'): Promise<WorkflowEditRow | null> {
  const taskLock = lock === 'update' ? 'FOR UPDATE OF t' : 'FOR SHARE OF t';
  const task = (await client.query<WorkflowEditRow>(`SELECT t.id,t.user_id,t.project_id,t.status,t.credit_status,t.error,
    t.request_digest,t.provider_id,t.model,t.result,
    i.actor_id,i.owner_id,i.project_id AS intent_project_id,i.workflow_id,i.node_id,i.source_entity_id,i.grant_generation,
    i.source_asset_id,i.source_version_id,i.source_placement_id,i.canonical_url,
    i.request_digest AS intent_digest,i.provider_id AS intent_provider_id,i.model_id AS intent_model_id,
    i.rejection_reason
    FROM cloud_tasks t JOIN wujie_workflow_edit_publications i ON i.task_id=t.id
    WHERE t.id=$1 AND t.user_id=$2 AND t.type='edit' ${taskLock}`,
  [taskId, actorId])).rows[0];
  return task ?? null;
}

function assertFrozenTaskIdentity(task: WorkflowEditRow): void {
  if (task.actor_id !== task.user_id
    || task.project_id !== task.intent_project_id || task.request_digest !== task.intent_digest
    || task.provider_id !== task.intent_provider_id || task.model !== task.intent_model_id) {
    throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
  }
}

function assertOutputTask(task: WorkflowEditRow): string {
  assertFrozenTaskIdentity(task);
  if (task.status !== 'completed' || !task.result || typeof task.result !== 'object' || Array.isArray(task.result)) {
    throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
  }
  const url = outputUrl(task.result);
  if (!url) throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_PENDING');
  return url;
}

function sourceInput(task: WorkflowEditRow): WorkflowEditPublicationInput {
  let origin = 'https://workflow.local.invalid';
  if (/^https?:\/\//i.test(task.canonical_url)) {
    try { origin = new URL(task.canonical_url).origin; }
    catch { throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT'); }
  }
  return {
    access: { kind: 'document', actorUserId: task.actor_id, ownerId: task.owner_id,
      projectId: task.project_id, grantGeneration: task.grant_generation },
    workflowId: task.workflow_id, nodeId: task.node_id, sourceEntityId: task.source_entity_id,
    sourceVersionId: task.source_version_id, sourcePlacementId: task.source_placement_id,
    imageUrl: task.canonical_url, origin,
  };
}

async function assertFrozenSource(client: PoolClient, task: WorkflowEditRow): Promise<void> {
  const source = await prepareWorkflowEditSourceInTransaction(client, sourceInput(task));
  if (source.assetId !== task.source_asset_id || source.canonicalUrl !== task.canonical_url) {
    throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
  }
}

async function existingOutput(client: PoolClient, task: WorkflowEditRow,
  url: string, outputIndex = 0): Promise<WorkspaceAssetReference | null> {
  const row = (await client.query<OutputRow>(`SELECT task_id,output_index,owner_id,project_id,
    asset_id,version_id,placement_id,source_url,checksum
    FROM wujie_workflow_edit_outputs WHERE task_id=$1 AND output_index=$2 FOR SHARE`, [task.id, outputIndex])).rows[0];
  if (!row) return null;
  if (row.owner_id !== task.owner_id || row.project_id !== task.project_id || row.source_url !== url) {
    throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
  }
  const asset = (await client.query<{ file_url: string; checksum: string | null }>(`
    SELECT v.file_url,v.checksum FROM wujie_asset_versions v
    JOIN wujie_workspace_placements p ON p.id=$2 AND p.asset_version_id=v.id
      AND p.asset_id=v.asset_id AND p.owner_id=v.owner_id AND p.project_id=v.project_id
    JOIN wujie_assets a ON a.id=v.asset_id AND a.owner_id=v.owner_id AND a.project_id=v.project_id
    WHERE v.id=$1 AND v.asset_id=$3 AND v.owner_id=$4 AND v.project_id=$5
      AND v.availability='ready' AND a.status='active'
      AND p.status='active' AND p.deleted_at IS NULL
      AND p.workspace_kind='workflow' AND p.workspace_id=$6
      AND p.entity_type='workflow-output' AND p.entity_id=$7`,
  [row.version_id, row.placement_id, row.asset_id, task.owner_id, task.project_id,
    task.workflow_id, outputEntityId(task.node_id, outputIndex)])).rows[0];
  if (!asset || asset.checksum !== row.checksum) {
    throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
  }
  return { assetId: row.asset_id, assetVersionId: row.version_id, placementId: row.placement_id,
    entityId: outputEntityId(task.node_id, outputIndex), kind: 'image', url: asset.file_url };
}

async function acceptedOutputs(client: PoolClient, task: WorkflowEditRow): Promise<WorkspaceAssetReference[]> {
  assertFrozenTaskIdentity(task);
  if (task.status !== 'completed' || task.result?.workflowEditAccepted !== true
    || !Array.isArray(task.result.images) || task.result.images.length < 1) {
    throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
  }
  const rows = (await client.query<OutputRow>(`SELECT task_id,output_index,owner_id,project_id,
    asset_id,version_id,placement_id,source_url,checksum
    FROM wujie_workflow_edit_outputs WHERE task_id=$1 ORDER BY output_index FOR SHARE`, [task.id])).rows;
  if (rows.length !== task.result.images.length) throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_PENDING');
  const references: WorkspaceAssetReference[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.output_index !== index || row.source_url !== `accepted:${row.checksum}`) {
      throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
    }
    const reference = await existingOutput(client, task, row.source_url, index);
    const image = task.result.images[index] as { url?: unknown } | undefined;
    if (!reference || image?.url !== reference.url) throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
    references.push(reference);
  }
  return references;
}

async function recoverCommittedAcceptedOutput(actorId: string, taskId: string,
  expectedCount: number): Promise<boolean> {
  const client = await getPool().connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    const task = await readWorkflowEdit(client, taskId, actorId, 'share');
    if (!task || task.status !== 'completed' || task.result?.workflowEditAccepted !== true) {
      await client.query('ROLLBACK');
      return false;
    }
    await assertFrozenSource(client, task);
    const outputs = await acceptedOutputs(client, task);
    await client.query('COMMIT');
    return outputs.length === expectedCount;
  } catch {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    return false;
  } finally { client.release(discard); }
}

async function recoverCommittedWorkflowEditDenial(actorId: string, taskId: string,
  expectedReason: WorkflowEditSourceError['code'] | 'WORKFLOW_EDIT_ACCEPTANCE_REJECTED'): Promise<boolean> {
  const client = await getPool().connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    const task = await readWorkflowEdit(client, taskId, actorId, 'share');
    if (!task) { await client.query('ROLLBACK'); return false; }
    assertFrozenTaskIdentity(task);
    if (task.status !== 'failed' || task.credit_status !== 'refunded' || task.error !== expectedReason) {
      await client.query('ROLLBACK');
      return false;
    }
    const outputs = await client.query(`SELECT 1 FROM wujie_workflow_edit_outputs
      WHERE task_id=$1 LIMIT 1`, [taskId]);
    await client.query('COMMIT');
    return outputs.rows.length === 0;
  } catch {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    return false;
  } finally { client.release(discard); }
}

const acceptedMimeSuffix: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp',
};

async function cleanupUnpublishedAcceptedFiles(taskId: string, files: PersistedAssetFile[]): Promise<void> {
  const results = await Promise.allSettled(files.map(file => file.cleanup()));
  const failures = results.filter(result => result.status === 'rejected').length;
  if (failures) console.error({ code: 'WORKFLOW_EDIT_OUTPUT_CLEANUP_FAILED', taskId, failures });
}

/** Persist a definitive rejection before attempting its separately committed refund. */
export async function recordWorkflowEditAcceptanceRejection(actorId: string, taskId: string): Promise<
  'recorded' | 'terminal' | 'pending'> {
  let client: PoolClient | undefined;
  let commitIssued = false;
  let discard = false;
  try {
    client = await getPool().connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    const task = await readWorkflowEdit(client, taskId, actorId, 'update');
    if (!task) throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
    assertFrozenTaskIdentity(task);
    if (task.status !== 'processing') {
      commitIssued = true;
      await client.query('COMMIT');
      return 'terminal';
    }
    if (task.rejection_reason && task.rejection_reason !== 'WORKFLOW_EDIT_ACCEPTANCE_REJECTED') {
      throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
    }
    if (!task.rejection_reason) {
      await client.query(`UPDATE wujie_workflow_edit_publications
        SET rejection_reason='WORKFLOW_EDIT_ACCEPTANCE_REJECTED'
        WHERE task_id=$1 AND actor_id=$2 AND rejection_reason IS NULL`, [taskId, actorId]);
    }
    commitIssued = true;
    await client.query('COMMIT');
    return 'recorded';
  } catch (error) {
    if (commitIssued) discard = true;
    else try { await client?.query('ROLLBACK'); } catch { discard = true; }
    console.error('[workflow-edit-output] Acceptance rejection checkpoint pending', error);
    return 'pending';
  } finally { client?.release(discard); }
}

/** Recover a checkpointed rejection only after a certain private-manifest absence. */
export async function recoverWorkflowEditAcceptanceRejection(actorId: string, taskId: string): Promise<
  'completed' | 'denied' | 'rejected' | 'pending' | 'terminal'> {
  let client: PoolClient | undefined;
  let discard = false;
  let task: WorkflowEditRow | null = null;
  try {
    client = await getPool().connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    task = await readWorkflowEdit(client, taskId, actorId, 'share');
    if (!task) { await client.query('ROLLBACK'); return 'pending'; }
    assertFrozenTaskIdentity(task);
    await client.query('COMMIT');
  } catch (error) {
    try { await client?.query('ROLLBACK'); } catch { discard = true; }
    console.error('[workflow-edit-output] Acceptance rejection identity unavailable', error);
    return 'pending';
  } finally { client?.release(discard); }
  if (task.status !== 'processing') return 'terminal';
  if (task.rejection_reason !== 'WORKFLOW_EDIT_ACCEPTANCE_REJECTED'
    || !task.request_digest || !task.provider_id || !task.model) return 'pending';
  try {
    const accepted = await readWorkflowEditAcceptedResult({ taskId, actorId,
      requestDigest: task.request_digest, providerId: task.provider_id, modelId: task.model });
    if (accepted) return 'pending';
  } catch (error) {
    console.error('[workflow-edit-output] Acceptance rejection manifest unavailable', error);
    return 'pending';
  }
  return settleWorkflowEditSourceDenial(actorId, taskId, true);
}

/** A revoked source can be refunded even when the provider artifact cannot be accepted. */
export async function settleWorkflowEditSourceDenial(actorId: string, taskId: string,
  rejectInvalidResult = false): Promise<'denied' | 'rejected' | 'pending' | 'terminal'> {
  let client: PoolClient | undefined;
  let commitIssued = false;
  let discard = false;
  let settlement: { outcome: 'denied' | 'rejected'; reason:
    WorkflowEditSourceError['code'] | 'WORKFLOW_EDIT_ACCEPTANCE_REJECTED' } | null = null;
  try {
    client = await getPool().connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    const task = await readWorkflowEdit(client, taskId, actorId, 'update');
    if (!task) throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
    assertFrozenTaskIdentity(task);
    if (task.status !== 'processing') {
      await client.query('COMMIT');
      return 'terminal';
    }
    try { await assertFrozenSource(client, task); }
    catch (error) {
      if (!(error instanceof WorkflowEditSourceError) || error.code === 'WORKFLOW_EDIT_SOURCE_UNAVAILABLE') throw error;
      const settled = await terminateCloudTaskAndRefund(taskId, 'failed', error.code,
        undefined, { client, requireActive: true });
      if (!settled.transitioned) throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
      settlement = { outcome: 'denied', reason: error.code };
      commitIssued = true;
      await client.query('COMMIT');
      return 'denied';
    }
    if (rejectInvalidResult) {
      const settled = await terminateCloudTaskAndRefund(taskId, 'failed',
        'WORKFLOW_EDIT_ACCEPTANCE_REJECTED', undefined, { client, requireActive: true });
      if (!settled.transitioned) throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
      settlement = { outcome: 'rejected', reason: 'WORKFLOW_EDIT_ACCEPTANCE_REJECTED' };
      commitIssued = true;
      await client.query('COMMIT');
      return 'rejected';
    }
    await client.query('COMMIT');
    return 'pending';
  } catch (error) {
    if (commitIssued) {
      client?.release(true);
      client = undefined;
      if (settlement && await recoverCommittedWorkflowEditDenial(actorId, taskId, settlement.reason)
        .catch(() => false)) return settlement.outcome;
    } else try { await client?.query('ROLLBACK'); } catch { discard = true; }
    console.error('[workflow-edit-output] Source denial settlement pending', error);
    return 'pending';
  } finally { client?.release(discard); }
}

/** Only an accepted private task manifest may drive this processing→published transition. */
export async function settleAcceptedWorkflowEditTask(actorId: string, taskId: string): Promise<
  'completed' | 'denied' | 'rejected' | 'pending' | 'terminal'> {
  let first: WorkflowEditRow | null = null;
  let reader: PoolClient | undefined;
  try {
    reader = await getPool().connect();
    await reader.query('BEGIN');
    await reader.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    first = await readWorkflowEdit(reader, taskId, actorId, 'share');
    if (first) assertFrozenTaskIdentity(first);
    await reader.query('COMMIT');
  } catch (error) {
    try { await reader?.query('ROLLBACK'); } catch { /* A broken connection is discarded below. */ }
    console.error('[workflow-edit-output] Accepted result identity unavailable', error);
    return 'pending';
  } finally { reader?.release(); }
  if (!first) return 'pending';
  if (first.status === 'completed') return 'completed';
  if (first.status !== 'processing') return 'terminal';
  if (!first.request_digest || !first.provider_id || !first.model) return 'pending';

  let accepted: Awaited<ReturnType<typeof readWorkflowEditAcceptedResult>>;
  const files: PersistedAssetFile[] = [];
  try {
    accepted = await readWorkflowEditAcceptedResult({ taskId, actorId,
      requestDigest: first.request_digest, providerId: first.provider_id, modelId: first.model });
    if (!accepted) return recoverWorkflowEditAcceptanceRejection(actorId, taskId);
    for (const image of accepted.manifest.images) {
      const suffix = acceptedMimeSuffix[image.mimeType];
      if (!suffix) throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
      files.push(await persistAssetBytes({ bytes: accepted.images[image.index],
        filename: `workflow-edit-${image.index}.${suffix}`, mimeType: image.mimeType }));
    }
  } catch (error) {
    console.error('[workflow-edit-output] Accepted media unavailable', error);
    await cleanupUnpublishedAcceptedFiles(taskId, files);
    return 'pending';
  }

  let writer: PoolClient | undefined;
  let commitIssued = false;
  let cleanupPrepared = true;
  let discard = false;
  let deniedReason: WorkflowEditSourceError['code'] | null = null;
  try {
    writer = await getPool().connect();
    await writer.query('BEGIN');
    await writer.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    const current = await readWorkflowEdit(writer, taskId, actorId, 'update');
    if (!current) throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
    assertFrozenTaskIdentity(current);
    if (current.status !== 'processing') {
      await writer.query('COMMIT');
      return current.status === 'completed' ? 'completed' : 'terminal';
    }
    if (current.request_digest !== accepted.manifest.requestDigest
      || current.provider_id !== accepted.manifest.providerId || current.model !== accepted.manifest.modelId) {
      throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
    }
    try { await assertFrozenSource(writer, current); }
    catch (error) {
      if (!(error instanceof WorkflowEditSourceError) || error.code === 'WORKFLOW_EDIT_SOURCE_UNAVAILABLE') throw error;
      const settled = await terminateCloudTaskAndRefund(taskId, 'failed', error.code,
        undefined, { client: writer, requireActive: true });
      if (!settled.transitioned) throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
      deniedReason = error.code;
      commitIssued = true;
      await writer.query('COMMIT');
      return 'denied';
    }
    const references: WorkspaceAssetReference[] = [];
    for (const image of accepted.manifest.images) {
      const file = files[image.index];
      if (!file || file.checksum !== image.sha256) throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
      const assetId = randomUUID();
      const versionId = randomUUID();
      const placementId = randomUUID();
      await writer.query(`INSERT INTO wujie_assets(id,owner_id,project_id,kind,status,metadata)
        VALUES ($1,$2,$3,'image','active',$4::jsonb)`, [assetId, current.owner_id,
        current.project_id, JSON.stringify({ source: 'workflow-edit', taskId })]);
      await writer.query(`INSERT INTO wujie_asset_versions
        (id,asset_id,owner_id,project_id,file_url,storage_key,checksum,mime_type,byte_size,
         availability,task_id,provider_id,model_id,metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',$10,$11,$12,$13::jsonb)`, [
        versionId, assetId, current.owner_id, current.project_id, file.url,
        file.storageKey ?? null, file.checksum, file.mimeType, file.byteSize,
        taskId, current.provider_id, current.model,
        JSON.stringify({ source: 'workflow-edit', sourceVersionId: current.source_version_id,
          sourcePlacementId: current.source_placement_id, outputIndex: image.index }),
      ]);
      await writer.query('UPDATE wujie_assets SET current_version_id=$2 WHERE id=$1', [assetId, versionId]);
      await writer.query(`INSERT INTO wujie_workspace_placements
        (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id,metadata)
        VALUES ($1,$2,$3,$4,$5,'workflow',$6,'workflow-output',$7,$8::jsonb)`, [
        placementId, current.owner_id, current.project_id, assetId, versionId,
        current.workflow_id, outputEntityId(current.node_id, image.index), JSON.stringify({ source: 'workflow-edit', taskId,
          outputIndex: image.index }),
      ]);
      await writer.query(`INSERT INTO wujie_workflow_edit_outputs
        (task_id,output_index,owner_id,project_id,asset_id,version_id,placement_id,source_url,checksum)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [taskId, image.index, current.owner_id,
        current.project_id, assetId, versionId, placementId, `accepted:${image.sha256}`, file.checksum]);
      references.push({ assetId, assetVersionId: versionId, placementId,
        entityId: outputEntityId(current.node_id, image.index), kind: 'image', url: file.url });
    }
    const urls = references.map(reference => reference.url);
    const completed = await completeCloudTask(taskId, {
      workflowEditAccepted: true, success: true, image: { url: urls[0] },
      images: urls.map(url => ({ url })), imageUrl: urls[0], imageUrls: urls,
      assetProjection: { status: 'completed', references,
        versionIds: references.map(reference => reference.assetVersionId) },
    }, { client: writer });
    if (!completed) throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
    // A sent COMMIT may have succeeded even when its acknowledgement is lost.
    cleanupPrepared = false;
    commitIssued = true;
    await writer.query('COMMIT');
    return 'completed';
  } catch (error) {
    if (commitIssued) {
      writer?.release(true);
      writer = undefined;
      if (deniedReason) {
        if (await recoverCommittedWorkflowEditDenial(actorId, taskId, deniedReason)
          .catch(() => false)) return 'denied';
        console.error('[workflow-edit-output] Accepted result denial pending', error);
        return 'pending';
      }
      if (await recoverCommittedAcceptedOutput(actorId, taskId, accepted.manifest.images.length)
        .catch(() => false)) return 'completed';
      console.error('[workflow-edit-output] Accepted result settlement pending', error);
      return 'pending';
    }
    try { await writer?.query('ROLLBACK'); } catch { discard = true; }
    console.error('[workflow-edit-output] Accepted result settlement pending', error);
    return 'pending';
  } finally {
    writer?.release(discard);
    if (cleanupPrepared) await cleanupUnpublishedAcceptedFiles(taskId, files);
  }
}

async function recoverCommittedOutput(taskId: string, actorId: string,
  expectedUrl: string): Promise<WorkspaceAssetReference | null> {
  const client = await getPool().connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    const task = await readWorkflowEdit(client, taskId, actorId, 'share');
    if (!task || assertOutputTask(task) !== expectedUrl) {
      await client.query('ROLLBACK');
      return null;
    }
    await assertFrozenSource(client, task);
    const output = await existingOutput(client, task, expectedUrl);
    await client.query('COMMIT');
    return output;
  } catch {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    return null;
  } finally { client.release(discard); }
}

/** Returns null only when this task has no frozen workflow publication intent. */
export async function projectWorkflowEditTaskResult(actorId: string,
  taskId: string, signal?: AbortSignal): Promise<WorkspaceAssetReference[] | null> {
  const pool = getPool();
  const client = await pool.connect();
  let commitSent = false;
  let discard = false;
  let released = false;
  let expectedUrl = '';
  let preparedFile: PersistedAssetFile | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    const first = await readWorkflowEdit(client, taskId, actorId, 'share');
    if (!first) { await client.query('COMMIT'); return null; }
    if (first.result?.workflowEditAccepted === true) {
      await assertFrozenSource(client, first);
      const accepted = await acceptedOutputs(client, first);
      await client.query('COMMIT');
      return accepted;
    }
    const firstUrl = assertOutputTask(first);
    expectedUrl = firstUrl;
    await assertFrozenSource(client, first);
    const prior = await existingOutput(client, first, firstUrl);
    await client.query('COMMIT');
    if (prior) return [prior];

    const sourceIdentity = { projectId: first.project_id, taskId, outputIndex: 0 };
    const mediaSource = await prepareMediaTaskSource(actorId, sourceIdentity);
    const media = await prepareAdoptedMedia(mediaSource, actorId, first.owner_id,
      first.project_id, signal ?? new AbortController().signal);
    const identity = importedMediaIdentity(media);
    const file = identity.file;
    preparedFile = file;

    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    const current = await readWorkflowEdit(client, taskId, actorId, 'update');
    if (!current || assertOutputTask(current) !== firstUrl) {
      throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_CONFLICT');
    }
    await assertFrozenSource(client, current);
    const raced = await existingOutput(client, current, firstUrl);
    if (raced) { await client.query('COMMIT'); return [raced]; }
    await assertMediaTaskSource(client, actorId, sourceIdentity, mediaSource);
    signal?.throwIfAborted();

    const placementId = randomUUID();
    await client.query(`INSERT INTO wujie_assets(id,owner_id,project_id,kind,status,metadata)
      VALUES ($1,$2,$3,'image','active',$4::jsonb)`, [identity.assetId, current.owner_id,
      current.project_id, JSON.stringify({ source: 'workflow-edit', taskId })]);
    await client.query(`INSERT INTO wujie_asset_versions
      (id,asset_id,owner_id,project_id,file_url,storage_key,checksum,mime_type,byte_size,
       availability,task_id,provider_id,model_id,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',$10,$11,$12,$13::jsonb)`, [
      identity.versionId, identity.assetId, current.owner_id, current.project_id,
      file.url, file.storageKey ?? null, file.checksum, file.mimeType, file.byteSize,
      taskId, current.provider_id, current.model,
      JSON.stringify({ source: 'workflow-edit', sourceVersionId: current.source_version_id,
        sourcePlacementId: current.source_placement_id, outputIndex: 0 }),
    ]);
    await client.query('UPDATE wujie_assets SET current_version_id=$2 WHERE id=$1',
      [identity.assetId, identity.versionId]);
    await client.query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id,metadata)
      VALUES ($1,$2,$3,$4,$5,'workflow',$6,'workflow-output',$7,$8::jsonb)`, [
      placementId, current.owner_id, current.project_id, identity.assetId, identity.versionId,
      current.workflow_id, current.node_id, JSON.stringify({ source: 'workflow-edit', taskId }),
    ]);
    await client.query(`INSERT INTO wujie_workflow_edit_outputs
      (task_id,output_index,owner_id,project_id,asset_id,version_id,placement_id,source_url,checksum)
      VALUES ($1,0,$2,$3,$4,$5,$6,$7,$8)`, [taskId, current.owner_id, current.project_id,
      identity.assetId, identity.versionId, placementId, firstUrl, file.checksum]);
    const reference: WorkspaceAssetReference = { assetId: identity.assetId,
      assetVersionId: identity.versionId, placementId, entityId: current.node_id,
      kind: 'image', url: file.url };
    await client.query(`UPDATE cloud_tasks SET result=jsonb_set(result,'{assetProjection}',$2::jsonb,true)
      WHERE id=$1 AND user_id=$3 AND status='completed'`, [taskId,
      JSON.stringify({ status: 'completed', references: [reference], versionIds: [identity.versionId] }), actorId]);
    commitSent = true;
    await client.query('COMMIT');
    return [reference];
  } catch (error) {
    if (commitSent) {
      client.release(true); released = true;
      const recovered = await recoverCommittedOutput(taskId, actorId, expectedUrl).catch(() => null);
      if (recovered) return [recovered];
      throw new WorkflowEditOutputError('WORKFLOW_EDIT_OUTPUT_PENDING');
    }
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally {
    // Cleanup failure may enqueue an outbox record using this same pool.
    // Return our checkout before cleanup, including under pool saturation.
    if (!released) client.release(discard);
    // The race loser and confirmed rollback own only this newly adopted file.
    // A sent COMMIT or failed rollback is uncertain: retain it for recovery.
    if (preparedFile && !commitSent && !discard) {
      await cleanupUnpublishedAcceptedFiles(taskId, [preparedFile]);
    }
  }
}
