import { fetchImageBuffer } from '@/lib/fetch-image-buffer';
import { inferSafeRasterImageType } from '@/lib/media-validation';
import { validateRecoveredSourceMedia } from '@/lib/asset-core/binary-media-validation';
import {
  putWorkflowEditAcceptanceObject,
  putWorkflowEditAcceptedMedia,
  readWorkflowEditAcceptanceObject,
  readWorkflowEditAcceptedMedia,
} from '@/lib/s3-storage';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 32;

export interface WorkflowEditAcceptanceIdentity {
  taskId: string;
  actorId: string;
  requestDigest: string;
  providerId: string;
  modelId: string;
}

export interface WorkflowEditAcceptanceInput {
  taskId: WorkflowEditAcceptanceIdentity['taskId'];
  actorId: WorkflowEditAcceptanceIdentity['actorId'];
  requestDigest: WorkflowEditAcceptanceIdentity['requestDigest'];
  providerId: WorkflowEditAcceptanceIdentity['providerId'];
  modelId: WorkflowEditAcceptanceIdentity['modelId'];
  result: {
    image?: { url: string };
    images?: Array<{ url: string }>;
  };
}

export interface WorkflowEditAcceptanceManifest extends WorkflowEditAcceptanceIdentity {
  version: 1;
  images: Array<{ index: number; mimeType: string; sha256: string }>;
}

function assertIdentity(identity: WorkflowEditAcceptanceIdentity): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(identity.taskId)
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(identity.actorId)
    || !/^[a-f0-9]{64}$/u.test(identity.requestDigest)
    || typeof identity.providerId !== 'string' || !identity.providerId || identity.providerId.length > 256
    || typeof identity.modelId !== 'string' || !identity.modelId || identity.modelId.length > 256
    || /[\x00-\x1f]/u.test(identity.providerId + identity.modelId)
    || /(?:https?:\/\/|data:|[?#])/iu.test(identity.providerId + identity.modelId)) {
    throw new TypeError('WORKFLOW_EDIT_ACCEPTANCE_IDENTITY_INVALID');
  }
}

function identityFrom(input: WorkflowEditAcceptanceIdentity): WorkflowEditAcceptanceIdentity {
  return {
    taskId: input.taskId, actorId: input.actorId, requestDigest: input.requestDigest,
    providerId: input.providerId, modelId: input.modelId,
  };
}

function parseManifest(bytes: Buffer, expected: WorkflowEditAcceptanceIdentity): WorkflowEditAcceptanceManifest {
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString('utf8')); }
  catch { throw new TypeError('WORKFLOW_EDIT_ACCEPTANCE_CORRUPT'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('WORKFLOW_EDIT_ACCEPTANCE_CORRUPT');
  }
  const value = parsed as Record<string, unknown>;
  if (value.version !== 1 || !Array.isArray(value.images) || value.images.length < 1
    || value.images.length > MAX_IMAGES || value.taskId !== expected.taskId
    || value.actorId !== expected.actorId || value.requestDigest !== expected.requestDigest
    || value.providerId !== expected.providerId || value.modelId !== expected.modelId
    || Object.keys(value).sort().join(',') !== 'actorId,images,modelId,providerId,requestDigest,taskId,version') {
    throw new TypeError('WORKFLOW_EDIT_ACCEPTANCE_CONFLICT');
  }
  const allowedMime = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);
  for (let index = 0; index < value.images.length; index++) {
    const image = value.images[index];
    if (!image || typeof image !== 'object' || Array.isArray(image)
      || Object.keys(image).sort().join(',') !== 'index,mimeType,sha256'
      || image.index !== index || typeof image.mimeType !== 'string' || !allowedMime.has(image.mimeType)
      || typeof image.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(image.sha256)) {
      throw new TypeError('WORKFLOW_EDIT_ACCEPTANCE_CORRUPT');
    }
  }
  return value as unknown as WorkflowEditAcceptanceManifest;
}

/** An acceptance record is private evidence, never a task completion or a publishable URL. */
export async function acceptWorkflowEditResult(input: WorkflowEditAcceptanceInput): Promise<WorkflowEditAcceptanceManifest> {
  const identity = identityFrom(input);
  assertIdentity(identity);
  const images = input.result.images ?? (input.result.image ? [input.result.image] : []);
  if (images.length < 1 || images.length > MAX_IMAGES
    || (input.result.image && input.result.images && input.result.images[0]?.url !== input.result.image.url)) {
    throw new TypeError('WORKFLOW_EDIT_ACCEPTANCE_IMAGES_INVALID');
  }
  const accepted: WorkflowEditAcceptanceManifest['images'] = [];
  for (let index = 0; index < images.length; index++) {
    const url = images[index]?.url;
    if (typeof url !== 'string' || !url) throw new TypeError('WORKFLOW_EDIT_ACCEPTANCE_IMAGES_INVALID');
    const bytes = await fetchImageBuffer(url, { maxBytes: MAX_IMAGE_BYTES });
    const media = inferSafeRasterImageType(bytes);
    if (!media) throw new TypeError('WORKFLOW_EDIT_ACCEPTANCE_MEDIA_INVALID');
    await validateRecoveredSourceMedia(bytes, media.mimeType);
    const written = await putWorkflowEditAcceptedMedia(identity.taskId, index, bytes, media.mimeType);
    if (!written) throw new Error('WORKFLOW_EDIT_ACCEPTANCE_STORAGE_UNAVAILABLE');
    accepted.push({ index, mimeType: media.mimeType, sha256: written.sha256 });
  }
  const manifest: WorkflowEditAcceptanceManifest = { version: 1, ...identity, images: accepted };
  const bytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  const status = await putWorkflowEditAcceptanceObject(identity.taskId, bytes);
  if (!status) throw new Error('WORKFLOW_EDIT_ACCEPTANCE_STORAGE_UNAVAILABLE');
  const stored = await readWorkflowEditAcceptanceObject(identity.taskId);
  if (!stored) throw new Error('WORKFLOW_EDIT_ACCEPTANCE_STORAGE_UNAVAILABLE');
  const recovered = parseManifest(stored, identity);
  if (!stored.equals(bytes)) throw new TypeError('WORKFLOW_EDIT_ACCEPTANCE_CONFLICT');
  return recovered;
}

/** Recover all accepted outputs without consulting an expired provider URL. */
export async function readWorkflowEditAcceptedResult(identity: WorkflowEditAcceptanceIdentity): Promise<{
  manifest: WorkflowEditAcceptanceManifest;
  images: Buffer[];
} | null> {
  assertIdentity(identity);
  const stored = await readWorkflowEditAcceptanceObject(identity.taskId);
  if (!stored) return null;
  const manifest = parseManifest(stored, identity);
  const images: Buffer[] = [];
  for (const image of manifest.images) {
    const bytes = await readWorkflowEditAcceptedMedia(identity.taskId, image.index, image.sha256, image.mimeType);
    if (!bytes) throw new Error('WORKFLOW_EDIT_ACCEPTANCE_MEDIA_MISSING');
    await validateRecoveredSourceMedia(bytes, image.mimeType);
    images.push(bytes);
  }
  return { manifest, images };
}
