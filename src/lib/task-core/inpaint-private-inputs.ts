import 'server-only';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import sharp from 'sharp';
import { getPool } from '@/lib/db-client';

export interface PrivateInpaintInputIdentity {
  taskId: string;
  userId: string;
  projectId: string;
  requestDigest: string;
}

export interface PrivateInpaintInput extends PrivateInpaintInputIdentity {
  source: Buffer;
  mask: Buffer;
  width: number;
  height: number;
  documentSource?: PrivateInpaintDocumentSource;
}

export interface PrivateInpaintDocumentSource {
  ownerId: string;
  grantGeneration: string;
  sourceVersionId: string;
  sourcePlacementId: string;
  canonicalUrl: string;
  origin: string;
}

const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_INPUT_EDGE = 2048;

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validIdentity(input: PrivateInpaintInputIdentity): boolean {
  return Boolean(input.taskId && input.userId && typeof input.projectId === 'string'
    && /^[a-f0-9]{64}$/.test(input.requestDigest));
}

async function validateImages(input: Pick<PrivateInpaintInput, 'source' | 'mask' | 'width' | 'height'>): Promise<void> {
  if (!Buffer.isBuffer(input.source) || !Buffer.isBuffer(input.mask)
    || input.source.length < 1 || input.mask.length < 1
    || input.source.length > MAX_INPUT_BYTES || input.mask.length > MAX_INPUT_BYTES
    || !Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height)
    || input.width < 1 || input.height < 1
    || input.width > MAX_INPUT_EDGE || input.height > MAX_INPUT_EDGE) {
    throw new Error('INPAINT_INPUT_INVALID');
  }
  try {
    const [source, mask] = await Promise.all([sharp(input.source).metadata(), sharp(input.mask).metadata()]);
    if (source.width !== input.width || source.height !== input.height
      || mask.width !== input.width || mask.height !== input.height) throw new Error('INPAINT_INPUT_INVALID');
  } catch {
    throw new Error('INPAINT_INPUT_INVALID');
  }
}

export async function insertPrivateInpaintInputs(
  client: PoolClient, input: PrivateInpaintInput,
): Promise<void> {
  if (!validIdentity(input)) throw new Error('INPAINT_INPUT_INVALID');
  if (input.documentSource && Object.values(input.documentSource).some(value =>
    typeof value !== 'string' || value.length === 0 || value.length > 2048)) {
    throw new Error('INPAINT_INPUT_INVALID');
  }
  await validateImages(input);
  await client.query(`INSERT INTO wujie_image_edit_private_inputs
    (task_id,user_id,project_id,request_digest,source_bytes,mask_bytes,
      source_sha256,mask_sha256,width,height,created_at,document_owner_id,
      document_grant_generation,document_source_version_id,document_source_placement_id,
      document_canonical_url,document_origin)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [
    input.taskId, input.userId, input.projectId, input.requestDigest,
    input.source, input.mask, sha256(input.source), sha256(input.mask),
    input.width, input.height, Date.now(),
    input.documentSource?.ownerId ?? null, input.documentSource?.grantGeneration ?? null,
    input.documentSource?.sourceVersionId ?? null, input.documentSource?.sourcePlacementId ?? null,
    input.documentSource?.canonicalUrl ?? null, input.documentSource?.origin ?? null,
  ]);
}

/** A document task must have one frozen source. Absence is never a personal-task fallback. */
export async function readPrivateInpaintDocumentSource(
  identity: PrivateInpaintInputIdentity,
): Promise<PrivateInpaintDocumentSource | null> {
  if (!validIdentity(identity)) return null;
  const found = await getPool().query<{
    document_owner_id: string | null; document_grant_generation: string | null;
    document_source_version_id: string | null; document_source_placement_id: string | null;
    document_canonical_url: string | null; document_origin: string | null;
  }>(`SELECT input.document_owner_id,input.document_grant_generation,
      input.document_source_version_id,input.document_source_placement_id,
      input.document_canonical_url,input.document_origin
    FROM wujie_image_edit_private_inputs input JOIN cloud_tasks task ON task.id=input.task_id
    WHERE input.task_id=$1 AND input.user_id=$2 AND input.project_id=$3 AND input.request_digest=$4
      AND task.user_id=$2 AND task.project_id=$3 AND task.request_digest=$4
      AND task.type='image-edit'
      AND task.result #>> '{imageEditAdmission,documentSource}' = 'true'`,
  [identity.taskId, identity.userId, identity.projectId, identity.requestDigest]);
  const row = found.rows[0];
  if (!row) return null;
  const values = [row.document_owner_id, row.document_grant_generation,
    row.document_source_version_id, row.document_source_placement_id,
    row.document_canonical_url, row.document_origin];
  if (values.some(value => typeof value !== 'string' || value.length === 0)) {
    throw new Error('INPAINT_DOCUMENT_SOURCE_CORRUPT');
  }
  return { ownerId: row.document_owner_id!, grantGeneration: row.document_grant_generation!,
    sourceVersionId: row.document_source_version_id!, sourcePlacementId: row.document_source_placement_id!,
    canonicalUrl: row.document_canonical_url!, origin: row.document_origin! };
}

export async function readPrivateInpaintInputs(
  identity: PrivateInpaintInputIdentity,
): Promise<Pick<PrivateInpaintInput, 'source' | 'mask' | 'width' | 'height'> | null> {
  if (!validIdentity(identity)) return null;
  const found = await getPool().query<{
    source_bytes: Buffer; mask_bytes: Buffer; source_sha256: string; mask_sha256: string;
    width: number; height: number;
  }>(`SELECT input.source_bytes,input.mask_bytes,input.source_sha256,input.mask_sha256,
      input.width,input.height
    FROM wujie_image_edit_private_inputs input JOIN cloud_tasks task ON task.id=input.task_id
    WHERE input.task_id=$1 AND input.user_id=$2 AND input.project_id=$3 AND input.request_digest=$4
      AND task.user_id=$2 AND task.project_id=$3 AND task.request_digest=$4
      AND task.type='image-edit'`, [identity.taskId, identity.userId,
    identity.projectId, identity.requestDigest]);
  const row = found.rows[0];
  if (!row) return null;
  const output = { source: row.source_bytes, mask: row.mask_bytes, width: row.width, height: row.height };
  if (!Buffer.isBuffer(output.source) || !Buffer.isBuffer(output.mask)
    || sha256(output.source) !== row.source_sha256 || sha256(output.mask) !== row.mask_sha256) {
    throw new Error('INPAINT_INPUT_CORRUPT');
  }
  try { await validateImages(output); }
  catch { throw new Error('INPAINT_INPUT_CORRUPT'); }
  return output;
}

/** Remove private recovery bytes only after a settled terminal task exists. */
export async function deleteTerminalPrivateInpaintInputs(
  identity: PrivateInpaintInputIdentity,
): Promise<boolean> {
  if (!validIdentity(identity)) return false;
  const deleted = await getPool().query(`DELETE FROM wujie_image_edit_private_inputs input
    USING cloud_tasks task
    WHERE input.task_id=$1 AND input.user_id=$2 AND input.project_id=$3
      AND input.request_digest=$4 AND task.id=input.task_id
      AND task.user_id=$2 AND task.project_id=$3 AND task.request_digest=$4
      AND task.type='image-edit'
      AND task.status IN ('completed','failed','cancelled','timeout')
      AND task.credit_status IN ('charged','refunded','not-applicable')
    RETURNING input.task_id`, [identity.taskId, identity.userId,
    identity.projectId, identity.requestDigest]);
  return deleted.rowCount === 1;
}
