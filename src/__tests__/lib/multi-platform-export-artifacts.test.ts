import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const cleanupOutboxMocks = vi.hoisted(() => ({
  recordAssetCleanupFailure: vi.fn(async () => undefined),
}));

vi.mock('@/lib/asset-core/cleanup-outbox', () => cleanupOutboxMocks);

import {
  buildExportArchive,
  persistExportArtifacts,
  persistExportImageVersion,
  validateMultiPlatformExportRetryLineage,
} from '@/lib/multi-platform-export/artifacts';
import type { AssetFile, AssetVersion } from '@/lib/asset-core/types';
import type { CreateAssetVersionInput } from '@/lib/asset-core/service';

function assetServiceDouble() {
  const byKey = new Map<string, { version: AssetVersion; digest: string }>();
  let sequence = 0;
  const createAssetVersion = vi.fn(async (input: CreateAssetVersionInput) => {
      const old = byKey.get(input.idempotencyKey);
      if (old) {
        if (old.digest !== input.requestDigest) throw new Error('ASSET_IDEMPOTENCY_CONFLICT');
        return { asset: { id: old.version.assetId }, version: old.version, reused: true };
      }
      sequence += 1;
      const version: AssetVersion = {
        id: `version-${sequence}`, assetId: `asset-${sequence}`,
        ownerId: input.actorUserId, projectId: input.projectId, kind: undefined as never,
        file: input.file, parentVersionIds: input.parentVersionIds ?? [],
        idempotencyKey: input.idempotencyKey, metadata: input.metadata,
        createdAt: '2026-09-09T00:00:00.000Z',
      } as AssetVersion;
      byKey.set(input.idempotencyKey, { version, digest: input.requestDigest });
      return { asset: { id: version.assetId }, version, reused: false };
  });
  const findAssetVersionByIdempotency = vi.fn(async (input: {
    actorUserId: string; projectId: string; idempotencyKey: string; requestDigest: string;
  }) => {
    const stored = byKey.get(input.idempotencyKey);
    if (!stored) return null;
    if (stored.digest !== input.requestDigest) throw new Error('ASSET_IDEMPOTENCY_CONFLICT');
    return stored.version;
  });
  return {
    createAssetVersion,
    findAssetVersionByIdempotency,
    createAssetVersionsAtomically: vi.fn(async (inputs: readonly CreateAssetVersionInput[]) => {
      const snapshot = new Map(byKey);
      const initialSequence = sequence;
      try {
        return await Promise.all(inputs.map(input => createAssetVersion(input)));
      } catch (error) {
        byKey.clear();
        for (const [key, value] of snapshot) byKey.set(key, value);
        sequence = initialSequence;
        throw error;
      }
    }),
  };
}

const persistedFile = (filename: string, mimeType: string, bytes: Buffer): AssetFile => ({
  url: `/api/serve-upload/exports/${filename}`, availability: 'ready', mimeType,
  byteSize: bytes.length, checksum: createHash('sha256').update(bytes).digest('hex'), storageKey: `/exports/${filename}`,
});

const exportMetadata = (overrides: Record<string, unknown> = {}) => ({
  schemaId: 'multi-platform-export-v1', runId: 'run-1', sourceAssetVersionId: 'source-v1',
  presetId: 'post', presetVersion: 1, platform: 'instagram', usage: 'post',
  width: 10, height: 10, fit: 'cover', outputFormat: 'png', outputFilename: 'a.png',
  requestDigest: 'a'.repeat(64), ...overrides,
});

describe('multi-platform export artifacts', () => {
  beforeEach(() => {
    cleanupOutboxMocks.recordAssetCleanupFailure.mockClear();
  });

  it('writes retry lineage and both reused and newly created images into the new manifest', async () => {
    const service = assetServiceDouble();
    const reusedBytes = Buffer.from('reused');
    const newBytes = Buffer.from('new');
    const reused = {
      id: 'version-reused', assetId: 'asset-reused', ownerId: 'user-1', projectId: 'project-1',
      file: persistedFile('reused.png', 'image/png', reusedBytes), parentVersionIds: ['source-v1'],
      metadata: exportMetadata({ runId: 'run-old', requestDigest: 'b'.repeat(64), outputFilename: 'reused.png' }),
      createdAt: '2026-09-09T00:00:00.000Z',
    } as AssetVersion;
    const created = {
      id: 'version-new', assetId: 'asset-new', ownerId: 'user-1', projectId: 'project-1',
      file: persistedFile('new.png', 'image/png', newBytes), parentVersionIds: ['source-v2'],
      metadata: exportMetadata({
        runId: 'run-new', requestDigest: 'c'.repeat(64), sourceAssetVersionId: 'source-v2',
        presetId: 'story', usage: 'story', outputFilename: 'new.png',
      }), createdAt: '2026-09-09T00:00:00.000Z',
    } as AssetVersion;
    const persistBytes = vi.fn(async ({ bytes, filename, mimeType }: { bytes: Buffer; filename: string; mimeType: string }) => (
      persistedFile(filename, mimeType, bytes)
    ));

    const result = await persistExportArtifacts({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-new', requestDigest: 'c'.repeat(64),
      createdAt: '2026-09-09T00:00:00.000Z', frozenParameters: {}, failures: [],
      lineage: {
        kind: 'multi-platform-export-retry-v1', rootRunId: 'run-old', retryOfRunId: 'run-old', attempt: 2,
        failedItems: [{ sourceAssetVersionId: 'source-v2', presetId: 'story', presetVersion: 1, code: 'EXPORT_IMAGE_TRANSFORM_FAILED', retryable: true }],
        reusedImageAssetVersionIds: ['version-reused'],
      },
      images: [
        { version: reused, filename: 'reused.png', bytes: reusedBytes, sourceAssetVersionId: 'source-v1', platform: 'instagram', usage: 'post', width: 10, height: 10, mimeType: 'image/png', sha256: reused.file.checksum!, reusedFromRunId: 'run-old' },
        { version: created, filename: 'new.png', bytes: newBytes, sourceAssetVersionId: 'source-v2', platform: 'instagram', usage: 'story', width: 10, height: 10, mimeType: 'image/png', sha256: created.file.checksum! },
      ], assetService: service, persistBytes,
    });

    expect(result.manifest.lineage).toEqual(expect.objectContaining({
      rootRunId: 'run-old', retryOfRunId: 'run-old', attempt: 2,
      reusedImageAssetVersionIds: ['version-reused'],
    }));
    expect(result.manifest.files.map(file => file.derivedAssetVersionId).sort())
      .toEqual(['version-new', 'version-reused']);
  });

  it('rejects reused versions whose authoritative preset/source matrix is incomplete or conflicting', async () => {
    const bytes = Buffer.from('reused');
    const reused = {
      id: 'version-reused', assetId: 'asset-reused', ownerId: 'user-1', projectId: 'project-1',
      file: persistedFile('reused.png', 'image/png', bytes), parentVersionIds: ['source-v1'],
      metadata: exportMetadata({ runId: 'run-old', requestDigest: 'b'.repeat(64), outputFilename: 'reused.png' }),
      createdAt: '2026-09-09T00:00:00.000Z',
    } as AssetVersion;
    const storage = {
      read: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
        findProject: vi.fn(async () => true),
        findVersion: vi.fn(async () => reused),
      }),
    } as never;
    const lineage = {
      kind: 'multi-platform-export-retry-v1' as const, rootRunId: 'run-old', retryOfRunId: 'run-old', attempt: 2,
      reusedImageAssetVersionIds: ['version-reused'], failedItems: [{
        sourceAssetVersionId: 'source-v1', presetId: 'story', presetVersion: 1,
        outputFilename: 'story.png', code: 'EXPORT_IMAGE_TRANSFORM_FAILED', retryable: true,
      }, {
        sourceAssetVersionId: 'source-v1', code: 'EXPORT_ZIP_FAILED', retryable: true,
      }],
    };
    await expect(validateMultiPlatformExportRetryLineage({
      actorUserId: 'user-1', projectId: 'project-1', sourceAssetVersionIds: ['source-v1'],
      targetPresetIds: ['post-v1', 'story-v1'], lineage, storage,
    })).resolves.toBeUndefined();
    await expect(validateMultiPlatformExportRetryLineage({
      actorUserId: 'user-1', projectId: 'project-1', sourceAssetVersionIds: ['source-v1'],
      targetPresetIds: ['story-v1'], lineage, storage,
    })).rejects.toThrow('EXPORT_RETRY_LINEAGE_INVALID');
  });
  it('treats a single image commit-then-throw as published and never deletes its referenced file', async () => {
    const service = assetServiceDouble();
    const committedCreate = service.createAssetVersion.getMockImplementation()!;
    service.createAssetVersion.mockImplementationOnce(async input => {
      await committedCreate(input);
      throw new Error('connection lost after commit');
    });
    const bytes = Buffer.from('png');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const cleanup = vi.fn(async () => undefined);
    const persistBytes = vi.fn(async () => ({
      ...persistedFile('post.png', 'image/png', bytes), checksum: sha256,
      createdThisCall: true, cleanup,
    }));

    await expect(persistExportImageVersion({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'commit-run', sourceAssetVersionId: 'source-v1',
      presetId: 'post', presetVersion: 1, platform: 'instagram', usage: 'post', width: 10, height: 10,
      fit: 'cover', outputFormat: 'png', outputFilename: 'post.png', requestDigest: 'd'.repeat(64),
      transformed: { bytes, mimeType: 'image/png', sha256 }, assetService: service, persistBytes,
    })).resolves.toMatchObject({ reused: true, version: { file: { checksum: sha256 } } });
    expect(service.findAssetVersionByIdempotency).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
    expect(cleanupOutboxMocks.recordAssetCleanupFailure).not.toHaveBeenCalled();
  });

  it('does not delete a committed image when cancellation arrives after the DB call started', async () => {
    const service = assetServiceDouble();
    const committedCreate = service.createAssetVersion.getMockImplementation()!;
    const controller = new AbortController();
    service.createAssetVersion.mockImplementationOnce(async input => {
      await committedCreate(input);
      controller.abort(new DOMException('cancelled after commit', 'AbortError'));
      throw new Error('connection lost after commit');
    });
    const bytes = Buffer.from('png');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const cleanup = vi.fn(async () => undefined);
    const persistBytes = vi.fn(async () => ({
      ...persistedFile('post.png', 'image/png', bytes), checksum: sha256,
      createdThisCall: true, cleanup,
    }));

    await expect(persistExportImageVersion({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'commit-abort-run', sourceAssetVersionId: 'source-v1',
      presetId: 'post', presetVersion: 1, platform: 'instagram', usage: 'post', width: 10, height: 10,
      fit: 'cover', outputFormat: 'png', outputFilename: 'post.png', requestDigest: 'd'.repeat(64),
      transformed: { bytes, mimeType: 'image/png', sha256 }, signal: controller.signal,
      assetService: service, persistBytes,
    })).resolves.toMatchObject({ reused: true });
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('cleans only the new private file when authority resolves an older matching version', async () => {
    const service = assetServiceDouble();
    const bytes = Buffer.from('png');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const firstInput = {
      actorUserId: 'user-1', projectId: 'project-1', runId: 'replay-run', sourceAssetVersionId: 'source-v1',
      presetId: 'post', presetVersion: 1, platform: 'instagram', usage: 'post', width: 10, height: 10,
      fit: 'cover' as const, outputFormat: 'png' as const, outputFilename: 'post.png', requestDigest: 'd'.repeat(64),
      transformed: { bytes, mimeType: 'image/png' as const, sha256 }, assetService: service,
    };
    await persistExportImageVersion({
      ...firstInput,
      persistBytes: vi.fn(async () => ({ ...persistedFile('old-post.png', 'image/png', bytes), checksum: sha256 })),
    });
    service.createAssetVersion.mockRejectedValueOnce(new Error('connection lost before replay result'));
    const cleanup = vi.fn(async () => undefined);
    await expect(persistExportImageVersion({
      ...firstInput,
      persistBytes: vi.fn(async () => ({
        ...persistedFile('new-post.png', 'image/png', bytes), checksum: sha256, createdThisCall: true, cleanup,
      })),
    })).resolves.toMatchObject({ reused: true, version: { file: { url: expect.stringContaining('old-post.png') } } });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('recovers both manifest and ZIP when the atomic commit succeeds before the client throws', async () => {
    cleanupOutboxMocks.recordAssetCleanupFailure.mockClear();
    const service = assetServiceDouble();
    const committedCreate = service.createAssetVersionsAtomically.getMockImplementation()!;
    service.createAssetVersionsAtomically.mockImplementationOnce(async inputs => {
      await committedCreate(inputs);
      throw new Error('connection lost after commit');
    });
    const cleanup = vi.fn(async () => undefined);
    const persistBytes = vi.fn(async ({ bytes, filename, mimeType }: { bytes: Buffer; filename: string; mimeType: string }) => ({
      ...persistedFile(filename, mimeType, bytes), createdThisCall: true, cleanup,
    }));

    await expect(persistExportArtifacts({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'commit-run', requestDigest: 'a'.repeat(64),
      createdAt: '2026-09-09T00:00:00.000Z', frozenParameters: {}, images: [],
      failures: [{ sourceAssetVersionId: 'source-v1', code: 'EXPORT_FAILED', retryable: false }],
      assetService: service, persistBytes,
    })).resolves.toMatchObject({ manifestVersion: { id: 'version-1' }, zipVersion: { id: 'version-2' } });
    expect(service.findAssetVersionByIdempotency).toHaveBeenCalledTimes(2);
    expect(cleanup).not.toHaveBeenCalled();
    expect(cleanupOutboxMocks.recordAssetCleanupFailure).not.toHaveBeenCalled();
  });

  it('defers cleanup with grace when DB publication cannot be authoritatively resolved', async () => {
    cleanupOutboxMocks.recordAssetCleanupFailure.mockClear();
    const service = assetServiceDouble();
    service.createAssetVersion.mockRejectedValueOnce(new Error('database uncertain'));
    service.findAssetVersionByIdempotency.mockResolvedValueOnce(null);
    const bytes = Buffer.from('png');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const cleanup = vi.fn(async () => undefined);
    const persistBytes = vi.fn(async () => ({
      ...persistedFile('post.png', 'image/png', bytes), checksum: sha256,
      createdThisCall: true, cleanup,
    }));

    await expect(persistExportImageVersion({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'uncertain-run', sourceAssetVersionId: 'source-v1',
      presetId: 'post', presetVersion: 1, platform: 'instagram', usage: 'post', width: 10, height: 10,
      fit: 'cover', outputFormat: 'png', outputFilename: 'post.png', requestDigest: 'd'.repeat(64),
      transformed: { bytes, mimeType: 'image/png', sha256 }, assetService: service, persistBytes,
    })).rejects.toThrow('database uncertain');
    expect(cleanup).not.toHaveBeenCalled();
    expect(cleanupOutboxMocks.recordAssetCleanupFailure).toHaveBeenCalledWith(expect.objectContaining({
      rootId: 'server-data', storageKey: 'exports/post.png', nextAttemptAt: expect.any(Date),
    }));
  });
  it('creates a new derived image Asset with a cross-Asset source parent and reuses it deterministically', async () => {
    const service = assetServiceDouble();
    const persistBytes = vi.fn(async ({ bytes, filename, mimeType }: { bytes: Buffer; filename: string; mimeType: string }) => ({
      ...persistedFile(filename, mimeType, bytes),
      checksum: createHash('sha256').update(bytes).digest('hex'),
    }));
    const input = {
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      sourceAssetVersionId: 'source-version-1', presetId: 'instagram-post', presetVersion: 1,
      platform: 'instagram', usage: 'post', width: 1080, height: 1080,
      fit: 'cover' as const, outputFormat: 'png' as const, outputFilename: 'post.png',
      requestDigest: 'd'.repeat(64), transformed: { bytes: Buffer.from('png'), mimeType: 'image/png' as const, sha256: createHash('sha256').update('png').digest('hex') },
      assetService: service, persistBytes,
    };
    const first = await persistExportImageVersion(input);
    const second = await persistExportImageVersion(input);

    expect(first.version.parentVersionIds).toEqual(['source-version-1']);
    expect(first.version.metadata).toMatchObject({ schemaId: 'multi-platform-export-v1', runId: 'run-1', presetVersion: 1 });
    expect(second.version.id).toBe(first.version.id);
    expect(second.reused).toBe(true);
    expect(service.createAssetVersion.mock.calls[0][0]).not.toHaveProperty('assetId');
  });

  it('packages exactly the successful flat files plus manifest.json', async () => {
    const images = [
      { filename: 'b.png', bytes: Buffer.from('b') },
      { filename: 'a.png', bytes: Buffer.from('a') },
    ];
    const manifestJson = JSON.stringify({ files: images.map(image => ({ filename: image.filename })) });
    const archive = await buildExportArchive({ images, manifestJson });
    const zip = await JSZip.loadAsync(archive);
    expect(Object.keys(zip.files).sort()).toEqual(['a.png', 'b.png', 'manifest.json']);
    await expect(zip.file('a.png')?.async('nodebuffer')).resolves.toEqual(Buffer.from('a'));
    await expect(zip.file('manifest.json')?.async('string')).resolves.toBe(manifestJson);
  });

  it('produces byte-identical ZIP output at different wall-clock times', async () => {
    const first = await buildExportArchive({ images: [{ filename: 'a.png', bytes: Buffer.from('a') }], manifestJson: '{}' });
    await new Promise(resolve => setTimeout(resolve, 2_100));
    const second = await buildExportArchive({ images: [{ filename: 'a.png', bytes: Buffer.from('a') }], manifestJson: '{}' });
    expect(second).toEqual(first);
  });

  it('persists manifest and ZIP as document versions and exposes a structured result', async () => {
    const service = assetServiceDouble();
    const persistBytes = vi.fn(async ({ bytes, filename, mimeType }: { bytes: Buffer; filename: string; mimeType: string }) => persistedFile(filename, mimeType, bytes));
    const imageBytes = Buffer.from('a');
    const imageChecksum = createHash('sha256').update(imageBytes).digest('hex');
    const imageVersion = { id: 'image-v1', assetId: 'asset-image', ownerId: 'user-1', projectId: 'project-1', file: { ...persistedFile('a.png', 'image/png', imageBytes), checksum: imageChecksum }, parentVersionIds: ['source-v1'], metadata: exportMetadata(), createdAt: 'now' } as AssetVersion;
    const output = await persistExportArtifacts({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', requestDigest: 'a'.repeat(64),
      createdAt: '2026-09-09T00:00:00.000Z', frozenParameters: { fit: 'cover' },
      images: [{ version: imageVersion, filename: 'a.png', bytes: imageBytes, sourceAssetVersionId: 'source-v1', platform: 'instagram', usage: 'post', width: 10, height: 10, mimeType: 'image/png', sha256: imageChecksum }],
      failures: [{ sourceAssetVersionId: 'bad-v1', code: 'EXPORT_SOURCE_CORRUPT', retryable: false }],
      assetService: service, persistBytes,
    });

    expect(service.createAssetVersion.mock.calls.slice(-2).map(call => call[0].kind)).toEqual(['document', 'document']);
    expect(service.createAssetVersionsAtomically).toHaveBeenCalledOnce();
    expect(output.result).toMatchObject({
      schemaVersion: 1, runId: 'run-1', outcome: 'partial_success',
      imageAssetVersionIds: ['image-v1'],
      manifestAssetVersionId: 'version-1', zipAssetVersionId: 'version-2',
    });
    expect(output.manifest.failures).toEqual([{ sourceAssetVersionId: 'bad-v1', code: 'EXPORT_SOURCE_CORRUPT', retryable: false }]);
  });

  it('does not immediately delete either document when atomic publication is uncertain', async () => {
    const service = assetServiceDouble();
    service.createAssetVersionsAtomically.mockRejectedValueOnce(new Error('database failed'));
    const cleanup = vi.fn(async () => undefined);
    const persistBytes = vi.fn(async ({ bytes, filename, mimeType }: { bytes: Buffer; filename: string; mimeType: string }) => ({ ...persistedFile(filename, mimeType, bytes), createdThisCall: true, cleanup }));
    await expect(persistExportArtifacts({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', requestDigest: 'a'.repeat(64),
      createdAt: '2026-09-09T00:00:00.000Z', frozenParameters: {}, images: [], failures: [],
      assetService: service, persistBytes,
    })).rejects.toThrow('database failed');
    expect(service.createAssetVersion).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(cleanupOutboxMocks.recordAssetCleanupFailure).toHaveBeenCalledTimes(2);
  });

  it('cleans the newly persisted manifest when ZIP persistence fails', async () => {
    const service = assetServiceDouble();
    const cleanup = vi.fn(async () => undefined);
    const persistBytes = vi.fn()
      .mockResolvedValueOnce({ ...persistedFile('manifest.json', 'application/json', Buffer.from('{}')), createdThisCall: true, cleanup })
      .mockRejectedValueOnce(new Error('zip storage failed'));

    await expect(persistExportArtifacts({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', requestDigest: 'a'.repeat(64),
      createdAt: '2026-09-09T00:00:00.000Z', frozenParameters: {}, images: [],
      failures: [{ sourceAssetVersionId: 'source-v1', code: 'EXPORT_FAILED', retryable: false }],
      assetService: service, persistBytes,
    })).rejects.toThrow('zip storage failed');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(service.createAssetVersionsAtomically).not.toHaveBeenCalled();
  });

  it('enforces entry and pre/post compression byte limits before persistence', async () => {
    const many = Array.from({ length: 101 }, (_, index) => ({ filename: `${index}.png`, bytes: Buffer.from('x') }));
    await expect(buildExportArchive({ images: many, manifestJson: '{}' })).rejects.toThrow('EXPORT_ZIP_ENTRY_LIMIT');
    await expect(buildExportArchive({ images: [{ filename: 'a.png', bytes: Buffer.alloc(9) }], manifestJson: '{}', limits: { maxUncompressedBytes: 10 } }))
      .rejects.toThrow('EXPORT_ZIP_UNCOMPRESSED_LIMIT');
    await expect(buildExportArchive({ images: [{ filename: 'a.png', bytes: Buffer.alloc(100, 1) }], manifestJson: '{}', limits: { maxCompressedBytes: 1 } }))
      .rejects.toThrow('EXPORT_ZIP_COMPRESSED_LIMIT');
  });

  it('rejects a forged transformed checksum before creating an image version', async () => {
    const service = assetServiceDouble();
    const bytes = Buffer.from('real bytes');
    const persistBytes = vi.fn(async ({ filename, mimeType }: { filename: string; mimeType: string }) => ({
      ...persistedFile(filename, mimeType, bytes), checksum: createHash('sha256').update(bytes).digest('hex'),
    }));
    await expect(persistExportImageVersion({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', sourceAssetVersionId: 'source-1',
      presetId: 'post', presetVersion: 1, platform: 'p', usage: 'u', width: 1, height: 1,
      fit: 'cover', outputFormat: 'png', outputFilename: 'a.png', requestDigest: 'd'.repeat(64),
      transformed: { bytes, mimeType: 'image/png', sha256: 'f'.repeat(64) }, assetService: service, persistBytes,
    })).rejects.toThrow('EXPORT_TRANSFORM_CHECKSUM_MISMATCH');
    expect(service.createAssetVersion).not.toHaveBeenCalled();
  });

  it('rejects an image whose manifest checksum disagrees with its persisted AssetFile', async () => {
    const service = assetServiceDouble();
    const bytes = Buffer.from('a');
    const imageVersion = { id: 'image-v1', assetId: 'asset-image', ownerId: 'user-1', projectId: 'project-1', file: { ...persistedFile('a.png', 'image/png', bytes), checksum: 'c'.repeat(64) }, parentVersionIds: ['source-v1'], metadata: exportMetadata({ platform: 'p', usage: 'u', width: 1, height: 1 }), createdAt: 'now' } as AssetVersion;
    await expect(persistExportArtifacts({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', requestDigest: 'a'.repeat(64),
      createdAt: '2026-09-09T00:00:00.000Z', frozenParameters: {}, failures: [],
      images: [{ version: imageVersion, filename: 'a.png', bytes, sourceAssetVersionId: 'source-v1', platform: 'p', usage: 'u', width: 1, height: 1, mimeType: 'image/png', sha256: createHash('sha256').update(bytes).digest('hex') }],
      assetService: service, persistBytes: vi.fn(),
    })).rejects.toThrow('EXPORT_IMAGE_ARTIFACT_INTEGRITY_INVALID');
  });

  it('uses frozen AssetVersion metadata as manifest facts and rejects caller conflicts', async () => {
    const service = assetServiceDouble();
    const bytes = Buffer.from('a');
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const version = {
      id: 'image-v1', assetId: 'asset-image', ownerId: 'user-1', projectId: 'project-1',
      file: persistedFile('a.png', 'image/png', bytes), parentVersionIds: ['source-v1'],
      metadata: exportMetadata(), createdAt: 'now',
    } as AssetVersion;
    await expect(persistExportArtifacts({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', requestDigest: 'a'.repeat(64),
      createdAt: '2026-09-09T00:00:00.000Z', frozenParameters: {}, failures: [],
      images: [{ version, filename: 'a.png', bytes, sourceAssetVersionId: 'source-v1', platform: 'tiktok', usage: 'post', width: 10, height: 10, mimeType: 'image/png', sha256: checksum }],
      assetService: service, persistBytes: vi.fn(),
    })).rejects.toThrow('EXPORT_IMAGE_DECLARATION_CONFLICT');
    expect(service.createAssetVersionsAtomically).not.toHaveBeenCalled();
  });

  it('cleans a reused derived image but defers cleanup when DB creation is uncertain', async () => {
    const bytes = Buffer.from('png');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const cleanup = vi.fn(async () => undefined);
    const persistBytes = vi.fn(async () => ({ ...persistedFile('post.png', 'image/png', bytes), checksum: sha256, createdThisCall: true, cleanup }));
    const service = assetServiceDouble();
    const common = {
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', sourceAssetVersionId: 'source-version-1',
      presetId: 'instagram-post', presetVersion: 1, platform: 'instagram', usage: 'post', width: 1080, height: 1080,
      fit: 'cover' as const, outputFormat: 'png' as const, outputFilename: 'post.png', requestDigest: 'd'.repeat(64),
      transformed: { bytes, mimeType: 'image/png' as const, sha256 }, assetService: service, persistBytes,
    };
    await persistExportImageVersion(common);
    await persistExportImageVersion(common);
    expect(cleanup).toHaveBeenCalledOnce();

    service.createAssetVersion.mockRejectedValueOnce(new Error('database failed'));
    await expect(persistExportImageVersion({ ...common, runId: 'run-2' })).rejects.toThrow('database failed');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanupOutboxMocks.recordAssetCleanupFailure).toHaveBeenCalledOnce();
  });

  it('rechecks cancellation after image persistence and never publishes a DB version', async () => {
    const controller = new AbortController();
    const cleanup = vi.fn(async () => undefined);
    const bytes = Buffer.from('png');
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const service = assetServiceDouble();
    const persistBytes = vi.fn(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'));
      return { ...persistedFile('post.png', 'image/png', bytes), checksum, createdThisCall: true, cleanup };
    });
    await expect(persistExportImageVersion({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-cancel', sourceAssetVersionId: 'source-v1',
      presetId: 'post', presetVersion: 1, platform: 'instagram', usage: 'post', width: 10, height: 10,
      fit: 'cover', outputFormat: 'png', outputFilename: 'post.png', requestDigest: 'd'.repeat(64),
      transformed: { bytes, mimeType: 'image/png', sha256: checksum }, signal: controller.signal,
      assetService: service, persistBytes,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(service.createAssetVersion).not.toHaveBeenCalled();
  });

  it('rechecks cancellation after document persistence and never publishes manifest or ZIP versions', async () => {
    const controller = new AbortController();
    const cleanup = vi.fn(async () => undefined);
    const service = assetServiceDouble();
    const persistBytes = vi.fn(async ({ bytes, filename, mimeType }: { bytes: Buffer; filename: string; mimeType: string }) => {
      controller.abort(new DOMException('cancelled', 'AbortError'));
      return { ...persistedFile(filename, mimeType, bytes), createdThisCall: true, cleanup };
    });
    await expect(persistExportArtifacts({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-cancel', requestDigest: 'a'.repeat(64),
      createdAt: '2026-09-09T00:00:00.000Z', frozenParameters: {}, images: [],
      failures: [{ sourceAssetVersionId: 'source-v1', code: 'EXPORT_FAILED', retryable: false }],
      signal: controller.signal, assetService: service, persistBytes,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(service.createAssetVersionsAtomically).not.toHaveBeenCalled();
  });

  it('rejects the same output idempotency key when transformed bytes change', async () => {
    const service = assetServiceDouble();
    const persistBytes = vi.fn(async ({ bytes, filename, mimeType }: { bytes: Buffer; filename: string; mimeType: string }) => ({
      ...persistedFile(filename, mimeType, bytes), checksum: createHash('sha256').update(bytes).digest('hex'),
    }));
    const base = {
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1', sourceAssetVersionId: 'source-1',
      presetId: 'post', presetVersion: 1, platform: 'p', usage: 'u', width: 1, height: 1,
      fit: 'cover' as const, outputFormat: 'png' as const, outputFilename: 'a.png',
      requestDigest: 'd'.repeat(64), assetService: service, persistBytes,
    };
    const firstBytes = Buffer.from('first');
    await persistExportImageVersion({ ...base, transformed: { bytes: firstBytes, mimeType: 'image/png', sha256: createHash('sha256').update(firstBytes).digest('hex') } });
    const secondBytes = Buffer.from('second');
    await expect(persistExportImageVersion({ ...base, transformed: { bytes: secondBytes, mimeType: 'image/png', sha256: createHash('sha256').update(secondBytes).digest('hex') } }))
      .rejects.toThrow('ASSET_IDEMPOTENCY_CONFLICT');
  });
});
