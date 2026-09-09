import { describe, expect, it } from 'vitest';

import {
  buildMultiPlatformExportManifest,
  canonicalMultiPlatformExportManifestJson,
} from '@/lib/multi-platform-export/manifest';

describe('multi-platform export manifest', () => {
  it('sorts files and failures deterministically and records checksums with a prefix', () => {
    const manifest = buildMultiPlatformExportManifest({
      runId: 'run-1', requestDigest: 'a'.repeat(64), createdAt: '2026-09-09T00:00:00.000Z',
      frozenParameters: { fit: 'contain', background: 'transparent' },
      files: [
        { filename: 'z.png', sourceAssetVersionId: 'source-z', derivedAssetVersionId: 'derived-z', platform: 'z', usage: 'post', width: 2, height: 2, mimeType: 'image/png', byteSize: 8, sha256: 'b'.repeat(64) },
        { filename: 'a.png', sourceAssetVersionId: 'source-a', derivedAssetVersionId: 'derived-a', platform: 'a', usage: 'post', width: 2, height: 2, mimeType: 'image/png', byteSize: 7, sha256: 'a'.repeat(64) },
      ],
      failures: [
        { sourceAssetVersionId: 'source-z', code: 'EXPORT_SOURCE_CORRUPT', retryable: false },
        { sourceAssetVersionId: 'source-a', code: 'EXPORT_STORAGE_FAILED', retryable: true },
      ],
    });

    expect(manifest.files.map(file => file.filename)).toEqual(['a.png', 'z.png']);
    expect(manifest.files.every(file => file.sha256.startsWith('sha256:'))).toBe(true);
    expect(manifest.failures.map(failure => failure.sourceAssetVersionId)).toEqual(['source-a', 'source-z']);
    expect(canonicalMultiPlatformExportManifestJson({ ...manifest, files: [...manifest.files].reverse() }))
      .toBe(canonicalMultiPlatformExportManifestJson(manifest));
  });

  it('rejects duplicate or unsafe flat archive filenames', () => {
    const base = { sourceAssetVersionId: 's', derivedAssetVersionId: 'd', platform: 'p', usage: 'u', width: 1, height: 1, mimeType: 'image/png' as const, byteSize: 1, sha256: 'a'.repeat(64) };
    const input = { runId: 'run', requestDigest: 'b'.repeat(64), createdAt: '2026-09-09T00:00:00.000Z', frozenParameters: {}, failures: [] };
    expect(() => buildMultiPlatformExportManifest({ ...input, files: [{ ...base, filename: '../a.png' }] }))
      .toThrow('EXPORT_ARCHIVE_FILENAME_INVALID');
    expect(() => buildMultiPlatformExportManifest({ ...input, files: [{ ...base, filename: 'a.png' }, { ...base, derivedAssetVersionId: 'd2', filename: 'a.png' }] }))
      .toThrow('EXPORT_ARCHIVE_FILENAME_DUPLICATE');
  });
});
