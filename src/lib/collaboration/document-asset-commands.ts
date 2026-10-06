import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { lockAssetGraphWriteGate } from '@/lib/asset-core/storage';
import { assertDocumentEditor, assertDocumentProjectEnabled } from './document-access';
import { readCanvasDocument } from './canvas-document';
import { commitDocumentAssetCommandInTransaction, loadDocumentInTransaction } from './document-store';
import { assertPreparedDocumentAssets, prepareDocumentAssets, type PreparedDocumentAssets } from './document-asset-validation';
import { DocumentAssetCommandConflictError, DocumentAssetCommandInvalidError, parseDocumentAssetCommandRequest, parseDocumentAssetCommandResult,
  type DocumentAssetCommandInput, type DocumentAssetCommandResult } from './canvas-asset-command';

export type { DocumentAssetCommandInput, DocumentAssetCommandResult } from './canvas-asset-command';
interface StoredResult {
  request_digest: string; placement_id: string; asset_version_id: string; document_sequence: string;
  source_request_digest: string | null;
  remove_snapshot: unknown;
}
function normalize(input: DocumentAssetCommandInput): DocumentAssetCommandInput {
  if (!input || typeof input.actorId !== 'string' || !input.actorId.trim() || input.actorId.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(input.actorId)) throw new DocumentAssetCommandInvalidError();
  const { actorId, ...request } = input;
  return { actorId, ...parseDocumentAssetCommandRequest(request) };
}
function digest(input: DocumentAssetCommandInput): string {
  return createHash('sha256').update(JSON.stringify(input.command)).digest('hex');
}
async function lockScope(client: PoolClient, input: DocumentAssetCommandInput): Promise<string> {
  await lockAssetGraphWriteGate(client, 'shared');
  await client.query('SELECT 1 FROM wujie_projects WHERE id=$1 FOR UPDATE', [input.projectId]);
  const { ownerId } = await assertDocumentEditor(input.actorId, input.projectId, client);
  await assertDocumentProjectEnabled(client, ownerId, input.projectId);
  return ownerId;
}
async function readResult(client: PoolClient, input: DocumentAssetCommandInput, ownerId: string): Promise<DocumentAssetCommandResult | undefined> {
  const result = await client.query<StoredResult>(`SELECT request_digest, placement_id, asset_version_id, document_sequence,
    to_jsonb(wujie_canvas_asset_commands)->>'source_request_digest' AS source_request_digest,
    to_jsonb(wujie_canvas_asset_commands)->'remove_snapshot' AS remove_snapshot
    FROM wujie_canvas_asset_commands WHERE actor_id=$1 AND project_id=$2 AND idempotency_key=$3 AND owner_id=$4`,
  [input.actorId, input.projectId, input.idempotencyKey, ownerId]);
  const row = result.rows[0];
  if (!row) return undefined;
  if (row.source_request_digest || row.request_digest !== digest(input)) throw new DocumentAssetCommandConflictError();
  const documentSequence = Number(row.document_sequence);
  if (!Number.isSafeInteger(documentSequence) || documentSequence < 0) throw new Error('Invalid persisted command sequence');
  return parseDocumentAssetCommandResult({ placementId: row.placement_id, assetVersionId: row.asset_version_id, documentSequence,
    ...(row.remove_snapshot == null ? {} : { removeSnapshot: row.remove_snapshot }) }, input);
}

async function readAuthorizedResult(input: DocumentAssetCommandInput): Promise<DocumentAssetCommandResult | undefined> {
  const client = await getPool().connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    const ownerId = await lockScope(client, input);
    const result = await readResult(client, input, ownerId);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally { client.release(discard); }
}

/** Pending result only. Caller owns BEGIN/COMMIT/ROLLBACK and must not ACK early.
 * Ready media preparation is opaque; no HTTP flags or validation callbacks. */
export async function executeDocumentAssetCommandInTransaction(
  client: PoolClient, raw: DocumentAssetCommandInput, prepared: PreparedDocumentAssets,
): Promise<DocumentAssetCommandResult> {
  const input = normalize(raw);
  const { projectId, command } = input;
  const ownerId = await lockScope(client, input);
  const replay = await readResult(client, input, ownerId);
  if (replay) return replay;
  const loaded = await loadDocumentInTransaction(client, projectId);
  const projection = readCanvasDocument(loaded.doc);
  // Check the pre-operation set too: removing a placement must not bypass media
  // identity changes or annotation-current-version races during preparation.
  await assertPreparedDocumentAssets(client, ownerId, projectId, projection, prepared);
  const placementId = command.action === 'attach' ? randomUUID() : command.placementId;
  const assetVersionId = command.action === 'remove' ? command.expectedAssetVersionId : command.assetVersionId;
  if (command.action !== 'attach') {
    const placement = projection.placements[placementId];
    if (!placement || placement.deleted || placement.assetVersionId !== command.expectedAssetVersionId) throw new DocumentAssetCommandConflictError();
    const graph = await client.query<{ asset_version_id: string }>(`SELECT asset_version_id FROM wujie_workspace_placements
      WHERE id=$1 AND owner_id=$2 AND project_id=$3 AND status='active' AND workspace_kind='canvas'
        AND workspace_id IN ($3,'canvas:' || $3) AND entity_type IN ('canvas-image','canvas-video') FOR UPDATE`,
    [placementId, ownerId, projectId]);
    if (graph.rows[0]?.asset_version_id !== command.expectedAssetVersionId) throw new DocumentAssetCommandConflictError();
  }
  const version = await client.query<{ asset_id: string; kind: string }>(`SELECT version.asset_id,asset.kind
    FROM wujie_asset_versions version JOIN wujie_assets asset ON asset.id=version.asset_id
    WHERE version.id=$1 AND version.owner_id=$2 AND version.project_id=$3 FOR SHARE OF version,asset`, [assetVersionId, ownerId, projectId]);
  if (!version.rows[0]) throw new DocumentAssetCommandConflictError();
  const { asset_id: assetId, kind } = version.rows[0];
  if (command.action === 'attach') {
    await client.query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id,transform)
      VALUES ($1,$2,$3,$4,$5,'canvas',$3,$6,$7,$8::jsonb)`,
    [placementId, ownerId, projectId, assetId, assetVersionId, `canvas-${kind}`, randomUUID(), JSON.stringify(command.transform)]);
  } else if (command.action === 'remove') {
    await client.query("UPDATE wujie_workspace_placements SET status='trashed',deleted_at=now(),updated_at=now() WHERE id=$1", [placementId]);
  } else if (command.assetVersionId !== command.expectedAssetVersionId) {
    await client.query('UPDATE wujie_workspace_placements SET asset_id=$2,asset_version_id=$3,entity_type=$4,updated_at=now() WHERE id=$1',
      [placementId, assetId, assetVersionId, `canvas-${kind}`]);
  }
  const update = await commitDocumentAssetCommandInTransaction(client, { ...input, placementId, prepared });
  await client.query(`INSERT INTO wujie_canvas_asset_commands
    (actor_id,project_id,idempotency_key,request_digest,owner_id,placement_id,asset_id,asset_version_id,document_sequence,remove_snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
  [input.actorId, projectId, input.idempotencyKey, digest(input), ownerId, placementId, assetId, assetVersionId, update.sequence,
    update.removeSnapshot ? JSON.stringify(update.removeSnapshot) : null]);
  return { placementId, assetVersionId, documentSequence: update.sequence,
    ...(update.removeSnapshot ? { removeSnapshot: update.removeSnapshot } : {}) };
}

export async function executeDocumentAssetCommand(raw: DocumentAssetCommandInput): Promise<DocumentAssetCommandResult> {
  const input = normalize(raw);
  const replay = await readAuthorizedResult(input);
  if (replay) return replay;
  let prepared: PreparedDocumentAssets;
  try {
    prepared = await prepareDocumentAssets(input.actorId, input.projectId, input.command);
  } catch (error) {
    // A concurrent same-key command may commit after our initial miss and make
    // preflight CAS/media checks fail. Recover only a freshly authorized durable
    // result with the same digest; otherwise preserve the original failure.
    const persisted = await readAuthorizedResult(input);
    if (persisted) return persisted;
    throw error;
  }
  const client = await getPool().connect();
  let committing = false;
  let released = false;
  let discard = false;
  try {
    await client.query('BEGIN');
    const result = await executeDocumentAssetCommandInTransaction(client, input, prepared);
    committing = true;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (committing) {
      // COMMIT may have succeeded. Never ACK the in-memory result; discard the
      // uncertain connection and resolve only the durable, authorized digest.
      client.release(true);
      released = true;
      const persisted = await readAuthorizedResult(input);
      if (persisted) return persisted;
    } else {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
    }
    throw error;
  } finally { if (!released) client.release(discard); }
}
