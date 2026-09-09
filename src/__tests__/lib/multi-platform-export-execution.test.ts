import { describe, expect, it, vi } from 'vitest';

import {
  executeMultiPlatformExportStep,
  SkillPartialSuccessError,
  type MultiPlatformExportExecutorDependencies,
} from '@/lib/multi-platform-export/executor';
import type { ExecuteSkillStepInput } from '@/lib/skill-runtime/executor';
import type { AssetVersion } from '@/lib/asset-core/types';
import type { PersistedExportImage } from '@/lib/multi-platform-export/artifacts';

vi.mock('server-only', () => ({}));

function version(id: string, sourceId: string, filename: string): AssetVersion {
  return {
    id, assetId: `asset-${id}`, ownerId: 'user-1', projectId: 'project-1',
    file: {
      url: `/api/serve-upload/exports/${filename}`, availability: 'ready',
      mimeType: 'image/png', byteSize: 3, checksum: 'a'.repeat(64),
    },
    parentVersionIds: [sourceId],
    metadata: {
      schemaId: 'multi-platform-export-v1', runId: 'run-1', requestDigest: 'digest',
      sourceAssetVersionId: sourceId, presetId: 'square', presetVersion: 1,
      platform: 'test', usage: 'post', width: 10, height: 10, fit: 'cover',
      outputFormat: 'png', outputFilename: filename,
    },
    createdAt: '2026-09-09T00:00:00.000Z',
  };
}

function stepInput(signal = new AbortController().signal): ExecuteSkillStepInput {
  return {
    actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
    definition: {
      id: 'preset-multi-platform-export', version: 1, name: '多平台批量导出',
      category: 'export', description: '', systemPrompt: '',
      allowedSurfaces: ['canvas', 'workflow', 'simple-chat'],
      catalogSurfaces: ['canvas', 'workflow'], inputs: [], steps: [], enabled: true,
      builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
    },
    step: {
      id: 'export', label: '生成平台尺寸', toolId: 'multi_platform_export',
      runtime: 'local', execution: 'sequential', promptTemplate: '',
      qualityGateIds: ['output-present'],
    },
    inputValues: {
      sourceAssetVersionIds: ['version-aaaaaaaaaaaaaaaa'],
      targetPresetIds: ['square-v1'], fit: 'cover', background: '#ffffffff',
      namingTemplate: '{asset}-{platform}-{size}-{index}',
    },
    requestDigest: 'step-digest', signal,
    operation: {
      idempotencyKey: 'step-key', operationKey: 'operation-key', recovery: false,
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
      signal, beginSubmission: vi.fn(), recordAccepted: vi.fn(),
      recordLocalAccepted: vi.fn(), executeOperation: vi.fn(),
    },
  };
}

function dependencies(outputCount = 3): MultiPlatformExportExecutorDependencies {
  const source = {
    versionId: 'version-aaaaaaaaaaaaaaaa', assetName: '素材', bytes: Buffer.from('src'),
    mimeType: 'image/png' as const, width: 10, height: 10,
    hasTransparency: false, sha256: 'b'.repeat(64),
  };
  const outputs = Array.from({ length: outputCount }, (_, index) => ({
    sourceVersionId: source.versionId, presetId: `square-${index}`, presetVersion: 1,
    platform: 'test', usage: `post-${index}`, width: 10, height: 10,
    outputFormat: 'png' as const, outputFilename: `output-${index}.png`, pixelCount: 100,
  }));
  return {
    parseInput: value => value as never,
    freezePresets: vi.fn(async () => [{
      id: 'square', version: 1, platform: 'test', usage: 'post', label: 'Square',
      width: 10, height: 10, recommendedFormat: 'png' as const, supportsTransparency: true,
      enabled: true,
    }]),
    readSources: vi.fn(async () => [source]),
    plan: vi.fn(() => ({
      requestDigest: 'digest', digestPayload: {
        userId: 'user-1', projectId: 'project-1', projectName: 'project-1',
        skillId: 'preset-multi-platform-export', skillVersion: 1,
        sourceAssetVersionIds: [source.versionId],
        sources: [{ versionId: source.versionId, assetName: source.assetName, hasTransparency: false }],
        frozenPresets: [], fit: 'cover' as const, background: '#ffffffff' as const, namingTemplate: '{asset}',
      }, outputCount, totalPixels: outputCount * 100, outputs,
    })),
    loadPersistedImages: vi.fn(async () => []),
    transform: vi.fn(async ({ target }) => ({
      bytes: Buffer.from('img'), mimeType: 'image/png' as const, width: target.width,
      height: target.height, hasTransparency: false, sha256: 'a'.repeat(64),
      metadata: { width: target.width, height: target.height, format: 'png' as const, hasAlpha: false },
    })),
    persistImage: vi.fn(async input => ({
      version: version(`image-${input.outputFilename}`, input.sourceAssetVersionId, input.outputFilename),
      reused: false,
    })),
    persistArtifacts: vi.fn(async input => ({
      manifest: {} as never,
      manifestVersion: version('manifest-v1', source.versionId, 'manifest.json'),
      zipVersion: version('zip-v1', source.versionId, 'archive.zip'),
      result: {
        schemaVersion: 1 as const, runId: 'run-1',
        outcome: input.failures.length ? 'partial_success' as const : 'completed' as const,
        imageAssetVersionIds: input.images.map((image: PersistedExportImage) => image.version.id).sort(),
        manifestAssetVersionId: 'manifest-v1', zipAssetVersionId: 'zip-v1',
        failures: [...input.failures],
      },
    })),
    onProgress: vi.fn(async () => undefined),
    now: () => new Date('2026-09-09T00:00:00.000Z'),
  };
}

describe('multi-platform export execution', () => {
  it('limits work to two concurrent items and reports only completed items', async () => {
    const deps = dependencies(3);
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    deps.transform = vi.fn(async input => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>(resolve => releases.push(resolve));
      active -= 1;
      return {
        bytes: Buffer.from('img'), mimeType: 'image/png' as const, width: input.target.width,
        height: input.target.height, hasTransparency: false, sha256: 'a'.repeat(64),
        metadata: { width: input.target.width, height: input.target.height, format: 'png' as const, hasAlpha: false },
      };
    });

    const running = executeMultiPlatformExportStep(stepInput(), deps);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.shift()?.();
    releases.shift()?.();
    const result = await running;

    expect(maximum).toBe(2);
    expect(deps.onProgress!).toHaveBeenCalledTimes(3);
    expect(vi.mocked(deps.onProgress!).mock.calls.map(call => call[0].completed)).toEqual([1, 2, 3]);
    expect(result.structured?.value).toMatchObject({ outcome: 'completed' });
  });

  it('does not acquire new items after abort', async () => {
    const controller = new AbortController();
    const deps = dependencies(4);
    const releases: Array<() => void> = [];
    deps.transform = vi.fn(async input => {
      await new Promise<void>(resolve => releases.push(resolve));
      input.signal?.throwIfAborted();
      return {} as never;
    });

    const running = executeMultiPlatformExportStep(stepInput(controller.signal), deps);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    controller.abort(new DOMException('cancelled', 'AbortError'));
    releases.splice(0).forEach(release => release());

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.transform).toHaveBeenCalledTimes(2);
    expect(deps.persistArtifacts).not.toHaveBeenCalled();
  });

  it('preserves successful images and returns partial success after an item failure', async () => {
    const deps = dependencies(3);
    vi.mocked(deps.transform).mockRejectedValueOnce(Object.assign(new Error('bad image'), {
      code: 'EXPORT_IMAGE_TRANSFORM_FAILED',
    }));

    await expect(executeMultiPlatformExportStep(stepInput(), deps)).rejects.toSatisfy(error => {
      expect(error).toBeInstanceOf(SkillPartialSuccessError);
      expect((error as SkillPartialSuccessError).result).toMatchObject({
        assetVersionIds: expect.arrayContaining(['manifest-v1', 'zip-v1']),
        structured: { value: { outcome: 'partial_success', failures: [
          expect.objectContaining({ code: 'EXPORT_IMAGE_TRANSFORM_FAILED' }),
        ] } },
      });
      return true;
    });
    expect(deps.persistImage).toHaveBeenCalledTimes(2);
  });

  it('reuses completed images and transforms only missing outputs during recovery', async () => {
    const deps = dependencies(2);
    const existing = version('existing-v1', 'version-aaaaaaaaaaaaaaaa', 'output-0.png');
    existing.metadata = { ...existing.metadata, presetId: 'square-0', usage: 'post-0' };
    deps.loadPersistedImages = vi.fn(async () => [{
      version: existing, filename: 'output-0.png', bytes: Buffer.from('img'),
      sourceAssetVersionId: 'version-aaaaaaaaaaaaaaaa', platform: 'test', usage: 'post-0',
      width: 10, height: 10, mimeType: 'image/png' as const, sha256: 'a'.repeat(64),
    }]);

    const result = await executeMultiPlatformExportStep(stepInput(), deps);

    expect(deps.transform).toHaveBeenCalledTimes(1);
    expect(deps.persistImage).toHaveBeenCalledTimes(1);
    expect(result.assetVersionIds).toContain('existing-v1');
    expect(result.structured?.value).toMatchObject({
      imageAssetVersionIds: expect.arrayContaining(['existing-v1']),
    });
  });

  it('retries only frozen failed item pairs and carries reused versions into the complete manifest', async () => {
    const deps = dependencies(3);
    const reused = version('reused-v1', 'version-aaaaaaaaaaaaaaaa', 'output-0.png');
    reused.metadata = { ...reused.metadata, presetId: 'square-0', usage: 'post-0' };
    deps.loadPersistedImages = vi.fn(async () => [{
      version: reused, filename: 'output-0.png', bytes: Buffer.from('img'),
      sourceAssetVersionId: 'version-aaaaaaaaaaaaaaaa', platform: 'test', usage: 'post-0',
      width: 10, height: 10, mimeType: 'image/png' as const, sha256: 'a'.repeat(64),
      reusedFromRunId: 'run-old',
    }]);

    const result = await executeMultiPlatformExportStep(stepInput(), {
      ...deps,
      retryLineage: {
        kind: 'multi-platform-export-retry-v1', rootRunId: 'run-old',
        retryOfRunId: 'run-old', attempt: 2,
        failedItems: [{
          sourceAssetVersionId: 'version-aaaaaaaaaaaaaaaa', presetId: 'square-1',
          presetVersion: 1, outputFilename: 'output-1.png',
          code: 'EXPORT_IMAGE_TRANSFORM_FAILED', retryable: true,
        }],
        reusedImageAssetVersionIds: ['reused-v1'],
      },
    });

    expect(deps.transform).toHaveBeenCalledTimes(1);
    expect(deps.persistImage).toHaveBeenCalledWith(expect.objectContaining({ presetId: 'square-1' }));
    expect(deps.persistArtifacts).toHaveBeenCalledWith(expect.objectContaining({
      images: expect.arrayContaining([
        expect.objectContaining({ version: expect.objectContaining({ id: 'reused-v1' }) }),
        expect.objectContaining({ version: expect.objectContaining({ id: 'image-output-1.png' }) }),
      ]),
      lineage: expect.objectContaining({ retryOfRunId: 'run-old', attempt: 2 }),
    }));
    expect(result.structured?.value).toMatchObject({ outcome: 'completed' });
  });

  it('keeps image versions available when archive persistence fails', async () => {
    const deps = dependencies(2);
    vi.mocked(deps.transform).mockRejectedValueOnce(Object.assign(new Error('bad image'), {
      code: 'EXPORT_IMAGE_TRANSFORM_FAILED',
    }));
    vi.mocked(deps.persistArtifacts).mockRejectedValue(Object.assign(new Error('zip failed'), {
      code: 'EXPORT_ZIP_FAILED',
    }));

    await expect(executeMultiPlatformExportStep(stepInput(), deps)).rejects.toSatisfy(error => {
      expect(error).toBeInstanceOf(SkillPartialSuccessError);
      expect((error as SkillPartialSuccessError).result).toMatchObject({
        assetVersionIds: expect.arrayContaining(['image-output-1.png']),
        structured: { value: {
          outcome: 'partial_success',
          imageAssetVersionIds: expect.arrayContaining(['image-output-1.png']),
          failures: expect.arrayContaining([
            expect.objectContaining({ code: 'EXPORT_IMAGE_TRANSFORM_FAILED', outputFilename: 'output-0.png' }),
            expect.objectContaining({ code: 'EXPORT_ZIP_FAILED' }),
          ]),
        } },
      });
      const structured = (error as SkillPartialSuccessError).result.structured?.value as {
        failures?: unknown[];
      };
      expect(structured.failures).toHaveLength(2);
      return true;
    });
  });

  it('retries image failures but only repackages an archive failure', async () => {
    const deps = dependencies(2);
    const reused = version('reused-v1', 'version-aaaaaaaaaaaaaaaa', 'output-1.png');
    reused.metadata = { ...reused.metadata, presetId: 'square-1', usage: 'post-1' };
    deps.loadPersistedImages = vi.fn(async () => [{
      version: reused, filename: 'output-1.png', bytes: Buffer.from('img'),
      sourceAssetVersionId: 'version-aaaaaaaaaaaaaaaa', platform: 'test', usage: 'post-1',
      width: 10, height: 10, mimeType: 'image/png' as const, sha256: 'a'.repeat(64),
      reusedFromRunId: 'run-old',
    }]);

    await executeMultiPlatformExportStep(stepInput(), {
      ...deps,
      retryLineage: {
        kind: 'multi-platform-export-retry-v1', rootRunId: 'run-old', retryOfRunId: 'run-old', attempt: 2,
        failedItems: [{
          sourceAssetVersionId: 'version-aaaaaaaaaaaaaaaa', presetId: 'square-0', presetVersion: 1,
          outputFilename: 'output-0.png', code: 'EXPORT_IMAGE_TRANSFORM_FAILED', retryable: true,
        }, {
          sourceAssetVersionId: 'version-aaaaaaaaaaaaaaaa', code: 'EXPORT_ZIP_FAILED', retryable: true,
        }],
        reusedImageAssetVersionIds: ['reused-v1'],
      },
    });

    expect(deps.transform).toHaveBeenCalledTimes(1);
    expect(deps.persistImage).toHaveBeenCalledWith(expect.objectContaining({ outputFilename: 'output-0.png' }));
    expect(deps.persistArtifacts).toHaveBeenCalledOnce();
  });
});
