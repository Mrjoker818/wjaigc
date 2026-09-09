import 'server-only';

import JSZip from 'jszip';
import { createHash } from 'node:crypto';

import { persistAssetBytes, type PersistAssetBytesInput, type PersistedAssetFile } from '@/lib/asset-core/binary-persistence';
import { recordAssetCleanupFailure } from '@/lib/asset-core/cleanup-outbox';
import { createAssetService, type CreateAssetVersionInput } from '@/lib/asset-core/service';
import type { AssetFile, AssetVersion } from '@/lib/asset-core/types';
import { createPostgresAssetStorage, type AssetStorage } from '@/lib/asset-core/storage';
import type { ExportFormat, MultiPlatformExportInput } from './types';
import {
  assertFlatExportFilename,
  buildMultiPlatformExportManifest,
  canonicalMultiPlatformExportManifestJson,
  type ExportFailure,
  type MultiPlatformExportManifestV1,
  type MultiPlatformExportResultV1,
  type MultiPlatformExportRetryLineage,
} from './manifest';
import { readAuthorizedExportSources } from './source-reader';
import type { ExportPlan } from './types';

const MAX_ZIP_ENTRIES = 101;
const MAX_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_ZIP_COMPRESSED_BYTES = 256 * 1024 * 1024;
const ZIP_ENTRY_DATE = new Date('1980-01-01T00:00:00.000Z');

interface ExportAssetService {
  createAssetVersion(input: CreateAssetVersionInput): Promise<{ version: AssetVersion; reused: boolean; asset: unknown }>;
  createAssetVersionsAtomically(inputs: readonly CreateAssetVersionInput[]): Promise<Array<{ version: AssetVersion; reused: boolean; asset: unknown }>>;
  findAssetVersionByIdempotency(input: {
    actorUserId: string; projectId: string; idempotencyKey: string; requestDigest: string;
  }): Promise<AssetVersion | null>;
}
type ManagedAssetFile = AssetFile & Partial<Pick<PersistedAssetFile, 'createdThisCall' | 'cleanup'>>;
type PersistBytes = (input: PersistAssetBytesInput) => Promise<ManagedAssetFile>;

async function cleanupCreatedFile(file: ManagedAssetFile | undefined): Promise<void> {
  if (file?.createdThisCall && file.cleanup) await file.cleanup();
}

function isSamePersistedTarget(authoritative: AssetFile, candidate: AssetFile): boolean {
  const authoritativeKey = authoritative.storageKey?.replace(/^\/+/, '');
  const candidateKey = candidate.storageKey?.replace(/^\/+/, '');
  if (authoritativeKey && candidateKey) return authoritativeKey === candidateKey;
  return authoritative.url === candidate.url;
}

const UNCERTAIN_PUBLICATION_GRACE_MS = 5 * 60_000;

async function deferCreatedFileCleanup(file: ManagedAssetFile | undefined, error: unknown): Promise<void> {
  if (!file?.createdThisCall) return;
  const storageKey = file.storageKey?.replace(/^\/+/, '');
  const localPath = file.url.match(/^\/api\/serve-upload\/(exports\/[A-Za-z0-9._-]+)$/u)?.[1];
  if (!storageKey && !localPath) throw new Error('EXPORT_CLEANUP_TARGET_UNAVAILABLE');
  await recordAssetCleanupFailure({
    rootId: 'server-data',
    ...(storageKey ? { storageKey } : {}),
    ...(localPath ? { localPath } : {}),
    lastError: error instanceof Error ? error.message : String(error),
    nextAttemptAt: new Date(Date.now() + UNCERTAIN_PUBLICATION_GRACE_MS),
  });
}

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
  if (file.checksum !== input.transformed.sha256) {
    await cleanupCreatedFile(file);
    throw new Error('EXPORT_STORAGE_CHECKSUM_MISMATCH');
  }
  const metadata = {
    schemaId: 'multi-platform-export-v1', runId: input.runId,
    sourceAssetVersionId: input.sourceAssetVersionId, presetId: input.presetId,
    presetVersion: input.presetVersion, platform: input.platform, usage: input.usage,
    width: input.width, height: input.height, fit: input.fit,
    outputFormat: input.outputFormat, outputFilename: assertFlatExportFilename(input.outputFilename),
    requestDigest: input.requestDigest,
  };
  const idempotencyKey = `skill:${input.runId}:export:${input.sourceAssetVersionId}:${input.presetId}:v${input.presetVersion}`;
  const versionRequestDigest = artifactDigest(input.requestDigest, 'image', input.transformed.sha256);
  const service = input.assetService ?? createAssetService();
  let created: Awaited<ReturnType<ExportAssetService['createAssetVersion']>>;
  let publicationStarted = false;
  try {
    input.signal?.throwIfAborted();
    publicationStarted = true;
    created = await service.createAssetVersion({
      actorUserId: input.actorUserId, projectId: input.projectId, kind: 'image', file,
      parentVersionIds: [input.sourceAssetVersionId],
      idempotencyKey,
      requestDigest: versionRequestDigest, metadata,
    });
  } catch (error) {
    if (!publicationStarted && input.signal?.aborted) {
      await cleanupCreatedFile(file);
      throw error;
    }
    try {
      const authoritative = await service.findAssetVersionByIdempotency({
        actorUserId: input.actorUserId,
        projectId: input.projectId,
        idempotencyKey,
        requestDigest: versionRequestDigest,
      });
      if (authoritative) {
        if (!isSamePersistedTarget(authoritative.file, file)) await cleanupCreatedFile(file);
        return { version: authoritative, reused: true };
      }
    } catch {
      // Publication remains uncertain; delayed cleanup rechecks authoritative references.
    }
    await deferCreatedFileCleanup(file, error);
    throw error;
  }
  if (created.reused) await cleanupCreatedFile(file);
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
  reusedFromRunId?: string;
}

export async function validateMultiPlatformExportRetryLineage(input: {
  actorUserId: string;
  projectId: string;
  sourceAssetVersionIds: readonly string[];
  targetPresetIds: readonly string[];
  lineage: MultiPlatformExportRetryLineage;
  storage?: AssetStorage;
}): Promise<void> {
  const storage = input.storage ?? createPostgresAssetStorage();
  const sources = new Set(input.sourceAssetVersionIds);
  const presets = new Set(input.targetPresetIds);
  const expectedCount = sources.size * presets.size;
  const failedKeys = new Set<string>();
  for (const failure of input.lineage.failedItems) {
    if (!sources.has(failure.sourceAssetVersionId)) throw new Error('EXPORT_RETRY_LINEAGE_INVALID');
    if (failure.presetId === undefined) continue;
    const presetReference = `${failure.presetId}-v${failure.presetVersion}`;
    if (!presets.has(presetReference) || !failure.outputFilename) throw new Error('EXPORT_RETRY_LINEAGE_INVALID');
    const key = `${failure.sourceAssetVersionId}\0${presetReference}\0${failure.outputFilename}`;
    if (failedKeys.has(key)) throw new Error('EXPORT_RETRY_LINEAGE_INVALID');
    failedKeys.add(key);
  }
  const versions = await storage.read(async transaction => {
    if (!await transaction.findProject(input.actorUserId, input.projectId)) throw new Error('EXPORT_RETRY_LINEAGE_INVALID');
    return Promise.all(input.lineage.reusedImageAssetVersionIds.map(async versionId => {
      const version = await transaction.findVersion(input.actorUserId, input.projectId, versionId);
      if (!version) throw new Error('EXPORT_RETRY_LINEAGE_INVALID');
      return version;
    }));
  });
  const versionKeys = new Set<string>();
  const digests = new Set<string>();
  for (const version of versions) {
    const metadata = version.metadata;
    if (!metadata || metadata.schemaId !== 'multi-platform-export-v1'
      || typeof metadata.sourceAssetVersionId !== 'string' || !sources.has(metadata.sourceAssetVersionId)
      || typeof metadata.presetId !== 'string' || !Number.isSafeInteger(metadata.presetVersion)
      || !presets.has(`${metadata.presetId}-v${metadata.presetVersion}`)
      || typeof metadata.outputFilename !== 'string' || typeof metadata.requestDigest !== 'string'
      || !/^[a-f0-9]{64}$/u.test(metadata.requestDigest)
      || version.parentVersionIds.length !== 1 || version.parentVersionIds[0] !== metadata.sourceAssetVersionId) {
      throw new Error('EXPORT_RETRY_LINEAGE_INVALID');
    }
    const key = `${metadata.sourceAssetVersionId}\0${metadata.presetId}-v${metadata.presetVersion}\0${metadata.outputFilename}`;
    if (versionKeys.has(key) || failedKeys.has(key)) throw new Error('EXPORT_RETRY_LINEAGE_INVALID');
    versionKeys.add(key);
    digests.add(metadata.requestDigest);
  }
  if (digests.size > 1) throw new Error('EXPORT_RETRY_LINEAGE_INVALID');
  const archiveOnlyFailure = input.lineage.failedItems.some(failure => failure.presetId === undefined);
  if (archiveOnlyFailure ? versionKeys.size !== expectedCount : versionKeys.size + failedKeys.size !== expectedCount) {
    throw new Error('EXPORT_RETRY_LINEAGE_INVALID');
  }
}

export async function loadPersistedExportImages(input: {
  actorUserId: string; projectId: string; runId: string; requestDigest: string;
  plan: ExportPlan; signal: AbortSignal; retryLineage?: MultiPlatformExportRetryLineage;
  storage?: AssetStorage;
  readSources?: typeof readAuthorizedExportSources;
}): Promise<PersistedExportImage[]> {
  input.signal.throwIfAborted();
  const storage = input.storage ?? createPostgresAssetStorage();
  const expectedByKey = new Map(input.plan.outputs.map(output => [
    `${output.sourceVersionId}\0${output.presetId}\0${output.presetVersion}\0${output.outputFilename}`,
    output,
  ]));
  const versions = await storage.read(async transaction => {
    if (!await transaction.findProject(input.actorUserId, input.projectId)) throw new Error('EXPORT_REUSED_VERSION_INVALID');
    if (input.retryLineage) {
      return Promise.all(input.retryLineage.reusedImageAssetVersionIds.map(async id => {
        const version = await transaction.findVersion(input.actorUserId, input.projectId, id);
        if (!version) throw new Error('EXPORT_REUSED_VERSION_INVALID');
        return version;
      }));
    }
    const found = await Promise.all(input.plan.outputs.map(output => transaction.findVersionByIdempotency(
      input.actorUserId,
      input.projectId,
      `skill:${input.runId}:export:${output.sourceVersionId}:${output.presetId}:v${output.presetVersion}`,
    )));
    return found.filter((item): item is NonNullable<typeof item> => item !== null).map(item => item.version);
  });
  if (new Set(versions.map(version => version.id)).size !== versions.length) throw new Error('EXPORT_REUSED_VERSION_INVALID');
  const sources = [];
  for (let offset = 0; offset < versions.length; offset += 20) {
    sources.push(...await (input.readSources ?? readAuthorizedExportSources)({
      actorUserId: input.actorUserId, projectId: input.projectId,
      sourceVersionIds: versions.slice(offset, offset + 20).map(version => version.id), signal: input.signal,
    }));
  }
  const bytesById = new Map(sources.map(source => [source.versionId, source]));
  return versions.map(version => {
    const metadata = version.metadata;
    if (!metadata || metadata.schemaId !== 'multi-platform-export-v1'
      || typeof metadata.runId !== 'string' || typeof metadata.requestDigest !== 'string'
      || !/^[a-f0-9]{64}$/u.test(metadata.requestDigest)
      || typeof metadata.sourceAssetVersionId !== 'string' || typeof metadata.presetId !== 'string'
      || !Number.isSafeInteger(metadata.presetVersion) || typeof metadata.outputFilename !== 'string') {
      throw new Error('EXPORT_REUSED_VERSION_INVALID');
    }
    if (!input.retryLineage && (metadata.runId !== input.runId || metadata.requestDigest !== input.requestDigest)) {
      throw new Error('EXPORT_REUSED_VERSION_INVALID');
    }
    const key = `${metadata.sourceAssetVersionId}\0${metadata.presetId}\0${metadata.presetVersion}\0${metadata.outputFilename}`;
    const expected = expectedByKey.get(key);
    const source = bytesById.get(version.id);
    if (!expected || !source || version.parentVersionIds.length !== 1
      || version.parentVersionIds[0] !== expected.sourceVersionId
      || metadata.platform !== expected.platform || metadata.usage !== expected.usage
      || metadata.width !== expected.width || metadata.height !== expected.height
      || version.file.mimeType !== source.mimeType || version.file.checksum !== source.sha256) {
      throw new Error('EXPORT_REUSED_VERSION_INVALID');
    }
    return {
      version, filename: expected.outputFilename, bytes: source.bytes,
      sourceAssetVersionId: expected.sourceVersionId, platform: expected.platform, usage: expected.usage,
      width: expected.width, height: expected.height, mimeType: source.mimeType, sha256: source.sha256,
      ...(metadata.runId === input.runId ? {} : { reusedFromRunId: metadata.runId }),
    };
  });
}

export interface PersistExportArtifactsInput {
  actorUserId: string; projectId: string; runId: string; requestDigest: string; createdAt: string;
  frozenParameters: Record<string, unknown>; images: readonly PersistedExportImage[];
  failures: readonly ExportFailure[]; signal?: AbortSignal;
  lineage?: MultiPlatformExportRetryLineage;
  assetService?: ExportAssetService; persistBytes?: PersistBytes;
}

export async function persistExportArtifacts(input: PersistExportArtifactsInput): Promise<{
  manifest: MultiPlatformExportManifestV1; manifestVersion: AssetVersion; zipVersion: AssetVersion;
  result: MultiPlatformExportResultV1;
}> {
  input.signal?.throwIfAborted();
  const reusedIds = new Set(input.images.filter(image => image.reusedFromRunId).map(image => image.version.id));
  const frozenReusedIds = new Set(input.lineage?.reusedImageAssetVersionIds ?? []);
  if ((input.lineage === undefined && reusedIds.size > 0)
    || reusedIds.size !== frozenReusedIds.size
    || [...reusedIds].some(id => !frozenReusedIds.has(id))) {
    throw new Error('EXPORT_RETRY_LINEAGE_INVALID');
  }
  for (const image of input.images) {
    const checksum = createHash('sha256').update(image.bytes).digest('hex');
    const metadata = image.version.metadata;
    if (
      checksum !== image.sha256
      || image.version.file.checksum !== checksum
      || image.version.file.byteSize !== image.bytes.length
      || image.version.file.mimeType !== image.mimeType
      || image.version.ownerId !== input.actorUserId
      || image.version.projectId !== input.projectId
    ) throw new Error('EXPORT_IMAGE_ARTIFACT_INTEGRITY_INVALID');
    if (
      !metadata
      || metadata.schemaId !== 'multi-platform-export-v1'
      || (image.reusedFromRunId ? metadata.runId !== image.reusedFromRunId : metadata.runId !== input.runId)
      || (!image.reusedFromRunId && metadata.requestDigest !== input.requestDigest)
      || metadata.sourceAssetVersionId !== image.sourceAssetVersionId
      || image.version.parentVersionIds.length !== 1
      || image.version.parentVersionIds[0] !== metadata.sourceAssetVersionId
      || metadata.platform !== image.platform
      || metadata.usage !== image.usage
      || metadata.width !== image.width
      || metadata.height !== image.height
      || metadata.outputFilename !== image.filename
      || metadata.outputFormat !== image.mimeType.split('/')[1]
      || typeof metadata.presetId !== 'string'
      || !Number.isSafeInteger(metadata.presetVersion)
    ) throw new Error('EXPORT_IMAGE_DECLARATION_CONFLICT');
  }
  const manifest = buildMultiPlatformExportManifest({
    runId: input.runId, requestDigest: input.requestDigest, createdAt: input.createdAt,
    frozenParameters: input.frozenParameters,
    files: input.images.map(image => {
      const metadata = image.version.metadata as Record<string, unknown>;
      return {
        filename: metadata.outputFilename as string,
        sourceAssetVersionId: image.version.parentVersionIds[0],
        derivedAssetVersionId: image.version.id,
        platform: metadata.platform as string,
        usage: metadata.usage as string,
        width: metadata.width as number,
        height: metadata.height as number,
        mimeType: image.version.file.mimeType as PersistedExportImage['mimeType'],
        byteSize: image.version.file.byteSize as number,
        sha256: image.version.file.checksum as string,
      };
    }), failures: [...input.failures],
    ...(input.lineage ? { lineage: input.lineage } : {}),
  });
  const manifestJson = canonicalMultiPlatformExportManifestJson(manifest);
  const zipBytes = await buildExportArchive({
    images: input.images.map(image => ({ filename: image.filename, bytes: image.bytes })),
    manifestJson, signal: input.signal,
  });
  const persist = input.persistBytes ?? persistAssetBytes;
  let manifestFile: ManagedAssetFile | undefined;
  let zipFile: ManagedAssetFile | undefined;
  try {
    manifestFile = await persist({ bytes: Buffer.from(manifestJson), filename: 'manifest.json', mimeType: 'application/json', signal: input.signal });
    input.signal?.throwIfAborted();
    zipFile = await persist({ bytes: zipBytes, filename: 'multi-platform-export.zip', mimeType: 'application/zip', signal: input.signal });
    input.signal?.throwIfAborted();
  } catch (error) {
    await Promise.all([cleanupCreatedFile(manifestFile), cleanupCreatedFile(zipFile)]);
    throw error;
  }
  const manifestChecksum = createHash('sha256').update(manifestJson).digest('hex');
  const zipChecksum = createHash('sha256').update(zipBytes).digest('hex');
  if (
    manifestFile.checksum !== manifestChecksum
    || manifestFile.byteSize !== Buffer.byteLength(manifestJson)
    || manifestFile.mimeType !== 'application/json'
    || zipFile.checksum !== zipChecksum
    || zipFile.byteSize !== zipBytes.length
    || zipFile.mimeType !== 'application/zip'
  ) {
    await Promise.all([cleanupCreatedFile(manifestFile), cleanupCreatedFile(zipFile)]);
    throw new Error('EXPORT_ARTIFACT_STORAGE_INTEGRITY_INVALID');
  }
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
  const documentInputs = [
    documentInput('manifest', manifestFile),
    documentInput('zip', zipFile),
  ] as const;
  let documents: Awaited<ReturnType<ExportAssetService['createAssetVersionsAtomically']>>;
  let publicationStarted = false;
  try {
    input.signal?.throwIfAborted();
    publicationStarted = true;
    documents = await service.createAssetVersionsAtomically(documentInputs);
  } catch (error) {
    if (!publicationStarted && input.signal?.aborted) {
      await Promise.all([cleanupCreatedFile(manifestFile), cleanupCreatedFile(zipFile)]);
      throw error;
    }
    try {
      const authoritative = await Promise.all(documentInputs.map(document => (
        service.findAssetVersionByIdempotency({
          actorUserId: document.actorUserId,
          projectId: document.projectId,
          idempotencyKey: document.idempotencyKey,
          requestDigest: document.requestDigest,
        })
      )));
      if (authoritative.every((version): version is AssetVersion => version !== null)) {
        documents = authoritative.map((version, index) => ({
          version,
          reused: !isSamePersistedTarget(version.file, index === 0 ? manifestFile : zipFile),
          asset: { id: version.assetId },
        }));
      } else {
        await Promise.all([
          deferCreatedFileCleanup(manifestFile, error),
          deferCreatedFileCleanup(zipFile, error),
        ]);
        throw error;
      }
    } catch (resolutionError) {
      if (resolutionError === error) throw error;
      await Promise.all([
        deferCreatedFileCleanup(manifestFile, error),
        deferCreatedFileCleanup(zipFile, error),
      ]);
      throw error;
    }
  }
  await Promise.all(documents.map((created, index) => (
    created.reused ? cleanupCreatedFile(index === 0 ? manifestFile : zipFile) : Promise.resolve()
  )));
  const [manifestVersion, zipVersion] = documents.map(created => created.version);
  return {
    manifest, manifestVersion, zipVersion,
    result: {
      schemaVersion: 1, runId: input.runId,
      outcome: input.failures.length === 0 ? 'completed' : 'partial_success',
      imageAssetVersionIds: input.images.map(image => image.version.id).sort(),
      manifestAssetVersionId: manifestVersion.id, zipAssetVersionId: zipVersion.id,
      failures: [...manifest.failures],
      ...(input.lineage ? { lineage: input.lineage } : {}),
    },
  };
}
