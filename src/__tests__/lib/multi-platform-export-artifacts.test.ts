import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  buildExportArchive,
  persistExportArtifacts,
  persistExportImageVersion,
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
  return {
    createAssetVersion,
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

  it('does not publish only one document version when atomic artifact creation fails', async () => {
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
    expect(cleanup).toHaveBeenCalledTimes(2);
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

  it('cleans a newly persisted derived image when the version is reused or DB creation fails', async () => {
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
    expect(cleanup).toHaveBeenCalledTimes(2);
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
