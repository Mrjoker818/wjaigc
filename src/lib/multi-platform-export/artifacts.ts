import 'server-only';

import JSZip from 'jszip';
import { createHash } from 'node:crypto';

import { persistAssetBytes, type PersistAssetBytesInput } from '@/lib/asset-core/binary-persistence';
import { createAssetService, type CreateAssetVersionInput } from '@/lib/asset-core/service';
import type { AssetFile, AssetVersion } from '@/lib/asset-core/types';
import type { ExportFormat, MultiPlatformExportInput } from './types';
import {
  assertFlatExportFilename,
  buildMultiPlatformExportManifest,
  canonicalMultiPlatformExportManifestJson,
  type ExportFailure,
  type MultiPlatformExportManifestV1,
  type MultiPlatformExportResultV1,
} from './manifest';

const MAX_ZIP_ENTRIES = 101;
const MAX_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_ZIP_COMPRESSED_BYTES = 256 * 1024 * 1024;
const ZIP_ENTRY_DATE = new Date('1980-01-01T00:00:00.000Z');

interface ExportAssetService {
  createAssetVersion(input: CreateAssetVersionInput): Promise<{ version: AssetVersion; reused: boolean; asset: unknown }>;
  createAssetVersionsAtomically(inputs: readonly CreateAssetVersionInput[]): Promise<Array<{ version: AssetVersion; reused: boolean; asset: unknown }>>;
}
type PersistBytes = (input: PersistAssetBytesInput) => Promise<AssetFile>;

function artifactDigest(requestDigest: string, kind: string, checksum: string): string {
  return createHash('sha256').update(`${requestDigest}\u0000${kind}\u0000${checksum}`).digest('hex');
}

export interface PersistExportImageVersionInput {
  actorUserId: string; projectId: string; runId: string; sourceAssetVersionId: string;
  presetId: string; presetVersion: number; platform: string; usage: string;
  width: number; height: number; fit: MultiPlatformExportInput['fit']; outputFormat: ExportFormat;
  outputFilename: string; requestDigest: string;
  transformed: { bytes: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; sha256: string };
  signal?: AbortSignal; assetService?: ExportAssetService; persistBytes?: PersistBytes;
}

export async function persistExportImageVersion(input: PersistExportImageVersionInput): Promise<{ version: AssetVersion; reused: boolean }> {
  input.signal?.throwIfAborted();
  const actualChecksum = createHash('sha256').update(input.transformed.bytes).digest('hex');
  if (actualChecksum !== input.transformed.sha256) throw new Error('EXPORT_TRANSFORM_CHECKSUM_MISMATCH');
  const file = await (input.persistBytes ?? persistAssetBytes)({
    bytes: input.transformed.bytes, filename: input.outputFilename, mimeType: input.transformed.mimeType, signal: input.signal,
  });
  if (file.checksum !== input.transformed.sha256) throw new Error('EXPORT_STORAGE_CHECKSUM_MISMATCH');
  const metadata = {
    schemaId: 'multi-platform-export-v1', runId: input.runId,
    sourceAssetVersionId: input.sourceAssetVersionId, presetId: input.presetId,
    presetVersion: input.presetVersion, platform: input.platform, usage: input.usage,
    width: input.width, height: input.height, fit: input.fit,
    outputFormat: input.outputFormat, outputFilename: assertFlatExportFilename(input.outputFilename),
    requestDigest: input.requestDigest,
  };
  const created = await (input.assetService ?? createAssetService()).createAssetVersion({
    actorUserId: input.actorUserId, projectId: input.projectId, kind: 'image', file,
    parentVersionIds: [input.sourceAssetVersionId],
    idempotencyKey: `skill:${input.runId}:export:${input.sourceAssetVersionId}:${input.presetId}:v${input.presetVersion}`,
    requestDigest: artifactDigest(input.requestDigest, 'image', input.transformed.sha256), metadata,
  });
  return { version: created.version.metadata ? created.version : { ...created.version, metadata }, reused: created.reused };
}

export async function buildExportArchive(input: {
  images: readonly { filename: string; bytes: Buffer }[];
  manifestJson: string;
  signal?: AbortSignal;
  limits?: { maxUncompressedBytes?: number; maxCompressedBytes?: number };
}): Promise<Buffer> {
  input.signal?.throwIfAborted();
  if (input.images.length + 1 > MAX_ZIP_ENTRIES) throw new Error('EXPORT_ZIP_ENTRY_LIMIT');
  const names = new Set<string>();
  let total = Buffer.byteLength(input.manifestJson);
  const zip = new JSZip();
  for (const image of [...input.images].sort((a, b) => a.filename < b.filename ? -1 : 1)) {
    input.signal?.throwIfAborted();
    const filename = assertFlatExportFilename(image.filename);
    const normalized = filename.toLocaleLowerCase('en-US');
    if (names.has(normalized) || normalized === 'manifest.json') throw new Error('EXPORT_ARCHIVE_FILENAME_DUPLICATE');
    names.add(normalized);
    if (!Buffer.isBuffer(image.bytes) || image.bytes.length < 1) throw new Error('EXPORT_ARCHIVE_BYTES_INVALID');
    total += image.bytes.length;
    zip.file(filename, image.bytes, { binary: true, date: ZIP_ENTRY_DATE, createFolders: false });
  }
  const maxUncompressed = input.limits?.maxUncompressedBytes ?? MAX_ZIP_UNCOMPRESSED_BYTES;
  if (total > maxUncompressed) throw new Error('EXPORT_ZIP_UNCOMPRESSED_LIMIT');
  zip.file('manifest.json', input.manifestJson, { date: ZIP_ENTRY_DATE, createFolders: false });
  const archive = await zip.generateAsync(
    { type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX' },
    () => input.signal?.throwIfAborted(),
  );
  input.signal?.throwIfAborted();
  if (archive.length > (input.limits?.maxCompressedBytes ?? MAX_ZIP_COMPRESSED_BYTES)) throw new Error('EXPORT_ZIP_COMPRESSED_LIMIT');
  return archive;
}

export interface PersistedExportImage {
  version: AssetVersion; filename: string; bytes: Buffer; sourceAssetVersionId: string;
  platform: string; usage: string; width: number; height: number;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; sha256: string;
}

export interface PersistExportArtifactsInput {
  actorUserId: string; projectId: string; runId: string; requestDigest: string; createdAt: string;
  frozenParameters: Record<string, unknown>; images: readonly PersistedExportImage[];
  failures: readonly ExportFailure[]; signal?: AbortSignal;
  assetService?: ExportAssetService; persistBytes?: PersistBytes;
}

export async function persistExportArtifacts(input: PersistExportArtifactsInput): Promise<{
  manifest: MultiPlatformExportManifestV1; manifestVersion: AssetVersion; zipVersion: AssetVersion;
  result: MultiPlatformExportResultV1;
}> {
  input.signal?.throwIfAborted();
  for (const image of input.images) {
    const checksum = createHash('sha256').update(image.bytes).digest('hex');
    if (
      checksum !== image.sha256
      || image.version.file.checksum !== checksum
      || image.version.file.byteSize !== image.bytes.length
      || image.version.file.mimeType !== image.mimeType
      || image.version.ownerId !== input.actorUserId
      || image.version.projectId !== input.projectId
    ) throw new Error('EXPORT_IMAGE_ARTIFACT_INTEGRITY_INVALID');
  }
  const manifest = buildMultiPlatformExportManifest({
    runId: input.runId, requestDigest: input.requestDigest, createdAt: input.createdAt,
    frozenParameters: input.frozenParameters,
    files: input.images.map(image => ({
      filename: image.filename, sourceAssetVersionId: image.sourceAssetVersionId,
      derivedAssetVersionId: image.version.id, platform: image.platform, usage: image.usage,
      width: image.width, height: image.height, mimeType: image.mimeType,
      byteSize: image.bytes.length, sha256: image.sha256,
    })), failures: [...input.failures],
  });
  const manifestJson = canonicalMultiPlatformExportManifestJson(manifest);
  const zipBytes = await buildExportArchive({
    images: input.images.map(image => ({ filename: image.filename, bytes: image.bytes })),
    manifestJson, signal: input.signal,
  });
  const persist = input.persistBytes ?? persistAssetBytes;
  const manifestFile = await persist({ bytes: Buffer.from(manifestJson), filename: 'manifest.json', mimeType: 'application/json', signal: input.signal });
  const zipFile = await persist({ bytes: zipBytes, filename: 'multi-platform-export.zip', mimeType: 'application/zip', signal: input.signal });
  const manifestChecksum = createHash('sha256').update(manifestJson).digest('hex');
  const zipChecksum = createHash('sha256').update(zipBytes).digest('hex');
  if (
    manifestFile.checksum !== manifestChecksum
    || manifestFile.byteSize !== Buffer.byteLength(manifestJson)
    || manifestFile.mimeType !== 'application/json'
    || zipFile.checksum !== zipChecksum
    || zipFile.byteSize !== zipBytes.length
    || zipFile.mimeType !== 'application/zip'
  ) throw new Error('EXPORT_ARTIFACT_STORAGE_INTEGRITY_INVALID');
  const service = input.assetService ?? createAssetService();
  const documentInput = (suffix: 'manifest' | 'zip', file: AssetFile): CreateAssetVersionInput => {
    const metadata = { schemaId: suffix === 'manifest' ? 'multi-platform-export-manifest-v1' : 'multi-platform-export-archive-v1', runId: input.runId, requestDigest: input.requestDigest };
    return {
      actorUserId: input.actorUserId, projectId: input.projectId, kind: 'document', file,
      parentVersionIds: input.images.map(image => image.version.id),
      idempotencyKey: `skill:${input.runId}:export:${suffix}`,
      requestDigest: artifactDigest(input.requestDigest, suffix, file.checksum as string), metadata,
    };
  };
  const documents = await service.createAssetVersionsAtomically([
    documentInput('manifest', manifestFile),
    documentInput('zip', zipFile),
  ]);
  const [manifestVersion, zipVersion] = documents.map(created => created.version);
  return {
    manifest, manifestVersion, zipVersion,
    result: {
      schemaVersion: 1, runId: input.runId,
      outcome: input.failures.length === 0 ? 'completed' : 'partial_success',
      imageAssetVersionIds: input.images.map(image => image.version.id).sort(),
      manifestAssetVersionId: manifestVersion.id, zipAssetVersionId: zipVersion.id,
      failures: [...manifest.failures],
    },
  };
}
