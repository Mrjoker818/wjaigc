import 'server-only';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { getPool } from './db-client';
import { createAssetStorageTransaction } from './asset-core/storage';
import { readManagedAssetVersionBytes } from './asset-core/managed-media-read';
import { inspectBinaryImage } from './asset-core/binary-image-validation';
import { assertAnnotationSourceUnchanged, findAuthorizedAnnotationSource,
  AnnotationSourceAdmissionError, type AuthorizedAnnotationSource } from './annotation-authorized-source';
import { CanvasPublicationIntentError, type AnnotationImageByteProof } from './collaboration/task-publication-intent';

declare const proofBrand: unique symbol;
export interface PreparedAnnotationImageByteProof { readonly [proofBrand]: true }
const proofs = new WeakMap<PreparedAnnotationImageByteProof, AnnotationImageByteProof>();
const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

function identity(source: AuthorizedAnnotationSource): Omit<AnnotationImageByteProof,
  'version' | 'sourceFingerprint' | 'mimeType' | 'byteSize' | 'width' | 'height' | 'checksum'> {
  const access = source.access;
  if (access?.kind !== 'document' || !source.assetId || !source.assetVersionId || !source.placementId
    || source.actorUserId !== access.actorUserId || source.projectId !== access.projectId) {
    throw new CanvasPublicationIntentError();
  }
  return { actorUserId: source.actorUserId, ownerId: access.ownerId, projectId: source.projectId,
    grantGeneration: access.grantGeneration, imageId: source.imageId, versionId: source.versionId,
    assetId: source.assetId, assetVersionId: source.assetVersionId, placementId: source.placementId,
    urlDigest: digest(source.imageUrl) };
}

/** Short consistent metadata reads; the connection is released before media I/O. */
async function metadata(source: AuthorizedAnnotationSource): Promise<{
  version: NonNullable<Awaited<ReturnType<ReturnType<typeof createAssetStorageTransaction>['findVersion']>>>;
  fingerprint: string;
}> {
  const tuple = identity(source);
  const client = await getPool().connect().catch((): never => { throw new AnnotationSourceAdmissionError(503); });
  let discard = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='10000ms'");
    const storage = createAssetStorageTransaction(client);
    const version = await storage.findVersion(tuple.ownerId, tuple.projectId, tuple.assetVersionId);
    const asset = await storage.findAsset(tuple.ownerId, tuple.projectId, tuple.assetId);
    if (!version || !asset || asset.kind !== 'image' || asset.status !== 'active'
      || version.assetId !== tuple.assetId || version.file.availability !== 'ready'
      || version.file.url !== source.imageUrl) throw new AnnotationSourceAdmissionError(409);
    const { readOrdinaryPublicationSourceSnapshot } = await import('./collaboration/task-publication');
    const snapshot = await readOrdinaryPublicationSourceSnapshot(client, tuple.ownerId, tuple.projectId,
      [tuple.assetVersionId], false);
    await client.query('COMMIT');
    return { version, fingerprint: snapshot[0].fingerprint };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    if (!discard && error instanceof AnnotationSourceAdmissionError) throw error;
    throw new AnnotationSourceAdmissionError(503);
  } finally { client.release(discard); }
}

/** Only this actual managed read mints a capability. No caller-supplied MIME proof. */
export async function prepareAnnotationImageByteProof(source: AuthorizedAnnotationSource,
  signal?: AbortSignal): Promise<PreparedAnnotationImageByteProof | undefined> {
  source = structuredClone(source);
  const tuple = identity(source);
  await assertAnnotationSourceUnchanged(source);
  const before = await metadata(source);
  // Preserve all registered-MIME consumers, including historical formats that
  // are not supported by the narrower NULL-MIME managed-image reader.
  if (before.version.file.mimeType !== undefined) return undefined;
  let read: Awaited<ReturnType<typeof readManagedAssetVersionBytes>>;
  const mediaSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]);
  let dimensions: { width: number; height: number };
  try {
    read = await readManagedAssetVersionBytes(before.version, 'image', { signal: mediaSignal });
    // The byte reader intentionally exposes no descriptor dimensions. Derive
    // them from this SAME verified buffer, never from a second source read.
    // Its BMP layout was fully checked by the managed reader; Sharp does not
    // support BMP, so only extract that already-verified header's display size.
    dimensions = read.mimeType === 'image/bmp'
      ? { width: read.bytes.readInt32LE(18), height: Math.abs(read.bytes.readInt32LE(22)) }
      : await inspectBinaryImage(read.bytes, read.mimeType, mediaSignal);
  }
  catch { throw new AnnotationSourceAdmissionError(409); }
  mediaSignal.throwIfAborted();
  await assertAnnotationSourceUnchanged(source);
  const after = await metadata(source);
  if (!isDeepStrictEqual(before, after)) throw new AnnotationSourceAdmissionError(409);
  const proof: AnnotationImageByteProof = Object.freeze({ version: 1, ...tuple,
    sourceFingerprint: before.fingerprint, mimeType: read.mimeType as AnnotationImageByteProof['mimeType'],
    byteSize: read.bytes.length, width: dimensions.width, height: dimensions.height, checksum: digest(read.bytes) });
  const handle = Object.freeze({}) as PreparedAnnotationImageByteProof;
  proofs.set(handle, proof);
  return handle;
}

export function annotationImageByteProof(handle: PreparedAnnotationImageByteProof,
  source: AuthorizedAnnotationSource): AnnotationImageByteProof {
  const proof = proofs.get(handle);
  if (!proof || Object.entries(identity(source)).some(([key, value]) => proof[key as keyof AnnotationImageByteProof] !== value)) {
    throw new CanvasPublicationIntentError();
  }
  return Object.freeze({ ...proof });
}

/** Checks the exact raw buffer used by the worker, before transforms or dispatch. */
export function assertAnnotationImageBytes(handle: PreparedAnnotationImageByteProof,
  source: AuthorizedAnnotationSource, bytes: Buffer, mimeType: string): void {
  const proof = annotationImageByteProof(handle, source);
  if (bytes.length !== proof.byteSize || mimeType !== proof.mimeType || digest(bytes) !== proof.checksum) {
    throw new CanvasPublicationIntentError();
  }
}

/** Recovery re-reads the actual source without carrying the in-memory capability. */
export async function verifyFrozenAnnotationImageByteProof(proof: AnnotationImageByteProof,
  actorId: string, ownerId: string, projectId: string): Promise<void> {
  if (proof.actorUserId !== actorId || proof.ownerId !== ownerId || proof.projectId !== projectId) {
    throw new CanvasPublicationIntentError();
  }
  const source = await findAuthorizedAnnotationSource(actorId, projectId, proof.imageId);
  if (!source) throw new CanvasPublicationIntentError();
  const handle = await prepareAnnotationImageByteProof(source);
  if (!handle || !isDeepStrictEqual(annotationImageByteProof(handle, source), proof)) {
    throw new CanvasPublicationIntentError();
  }
}
