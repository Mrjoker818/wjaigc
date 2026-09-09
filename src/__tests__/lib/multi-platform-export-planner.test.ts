import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { planMultiPlatformExport } from '@/lib/multi-platform-export/planner';
import type {
  ExportPlanningContext,
  ExportSourceDescriptor,
  FrozenPlatformExportPreset,
  MultiPlatformExportInput,
} from '@/lib/multi-platform-export/types';

const input: MultiPlatformExportInput = {
  sourceAssetVersionIds: ['version-b', 'version-a'],
  targetPresetIds: ['square-v1', 'story-v2'],
  fit: 'cover',
  background: '#ffffffff',
  namingTemplate: '{asset}-{platform}-{size}-{index}',
};

const sources: ExportSourceDescriptor[] = [
  { versionId: 'version-a', assetName: '甲', hasTransparency: false },
  { versionId: 'version-b', assetName: '乙', hasTransparency: false },
];

const presets: FrozenPlatformExportPreset[] = [
  Object.freeze({ id: 'square', version: 1, platform: 'instagram', usage: 'post', label: '方图', width: 1080, height: 1080, recommendedFormat: 'jpeg', supportsTransparency: false, enabled: true }),
  Object.freeze({ id: 'story', version: 2, platform: 'douyin', usage: 'story', label: '竖图', width: 1080, height: 1920, recommendedFormat: 'png', supportsTransparency: true, enabled: true }),
];

const planningContext: ExportPlanningContext = {
  userId: 'user-a',
  projectId: 'project-a',
  projectName: '中文项目',
  skillId: 'preset-multi-platform-export',
  skillVersion: 1,
};

describe('multi-platform export planner', () => {
  it('keeps source input order followed by frozen preset order', () => {
    const plan = planMultiPlatformExport(input, sources, presets, planningContext);

    expect(plan.outputs.map(output => `${output.sourceVersionId}:${output.presetId}-v${output.presetVersion}`)).toEqual([
      'version-b:square-v1',
      'version-b:story-v2',
      'version-a:square-v1',
      'version-a:story-v2',
    ]);
    expect(plan.outputs.map(output => output.outputFormat)).toEqual(['jpeg', 'png', 'jpeg', 'png']);
  });

  it('computes a deterministic SHA-256 digest over every required identity and frozen input', () => {
    const first = planMultiPlatformExport(input, sources, presets, planningContext);
    const second = planMultiPlatformExport(input, [...sources].reverse(), presets, planningContext);

    expect(first.requestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(second.requestDigest).toBe(first.requestDigest);
    expect(planMultiPlatformExport(input, sources, presets, { ...planningContext, userId: 'user-b' }).requestDigest)
      .not.toBe(first.requestDigest);
    expect(planMultiPlatformExport(input, sources, presets, { ...planningContext, projectId: 'project-b' }).requestDigest)
      .not.toBe(first.requestDigest);
    expect(planMultiPlatformExport(input, sources, presets, { ...planningContext, skillVersion: 2 }).requestDigest)
      .not.toBe(first.requestDigest);
    expect(planMultiPlatformExport({ ...input, namingTemplate: '{asset}' }, sources, presets, planningContext).requestDigest)
      .not.toBe(first.requestDigest);
    expect(planMultiPlatformExport({ ...input, fit: 'contain' }, sources, presets, planningContext).requestDigest)
      .not.toBe(first.requestDigest);
    expect(planMultiPlatformExport(input, sources, [{ ...presets[0], width: 1200 }, presets[1]], planningContext).requestDigest)
      .not.toBe(first.requestDigest);

    const digestPayload = first.digestPayload;
    expect(first.requestDigest).toBe(createHash('sha256').update(JSON.stringify(digestPayload)).digest('hex'));
    expect(digestPayload).toMatchObject({
      userId: 'user-a', projectId: 'project-a', skillId: 'preset-multi-platform-export', skillVersion: 1,
      sourceAssetVersionIds: ['version-b', 'version-a'], fit: 'cover',
      background: '#ffffffff', namingTemplate: input.namingTemplate,
    });
    expect(digestPayload.frozenPresets).toEqual(presets);
  });

  it('rejects transparent output when the selected format cannot preserve alpha', () => {
    expect(() => planMultiPlatformExport(
      { ...input, sourceAssetVersionIds: ['version-a'], targetPresetIds: ['square-v1'], background: 'transparent' },
      [{ ...sources[0], hasTransparency: true }],
      [presets[0]],
      planningContext,
    )).toThrow('EXPORT_TRANSPARENCY_FORMAT_CONFLICT');
  });

  it('enforces source, target, output and pixel budgets defensively', () => {
    const tooManySources = Array.from({ length: 21 }, (_, index) => ({
      versionId: `version-${index}`, assetName: `图-${index}`, hasTransparency: false,
    }));
    expect(() => planMultiPlatformExport(
      { ...input, sourceAssetVersionIds: tooManySources.map(source => source.versionId), targetPresetIds: ['square-v1'] },
      tooManySources,
      [presets[0]],
      planningContext,
    )).toThrow('EXPORT_SOURCE_COUNT_INVALID');

    const sixSources = Array.from({ length: 6 }, (_, index) => ({
      versionId: `version-${index}`, assetName: `图-${index}`, hasTransparency: false,
    }));
    const twentyPresets = Array.from({ length: 20 }, (_, index) => ({
      ...presets[0], id: `preset-${index}`,
    }));
    expect(() => planMultiPlatformExport(
      { ...input, sourceAssetVersionIds: sixSources.map(source => source.versionId), targetPresetIds: twentyPresets.map(preset => `${preset.id}-v1`) },
      sixSources,
      twentyPresets,
      planningContext,
    )).toThrow('EXPORT_OUTPUT_COUNT_INVALID');

    expect(() => planMultiPlatformExport(
      { ...input, sourceAssetVersionIds: ['version-a'], targetPresetIds: ['huge-v1'] },
      [sources[0]],
      [{ ...presets[0], id: 'huge', width: 8193, height: 8192 }],
      planningContext,
    )).toThrow('EXPORT_OUTPUT_PIXEL_LIMIT');

    const batchPresets = Array.from({ length: 8 }, (_, index) => ({
      ...presets[0], id: `large-${index}`, width: 8000, height: 7000,
    }));
    expect(() => planMultiPlatformExport(
      { ...input, sourceAssetVersionIds: ['version-a'], targetPresetIds: batchPresets.map(preset => `${preset.id}-v1`) },
      [sources[0]],
      batchPresets,
      planningContext,
    )).toThrow('EXPORT_BATCH_PIXEL_LIMIT');
  });

  it('rejects missing, duplicate or mismatched source and frozen preset descriptors', () => {
    expect(() => planMultiPlatformExport(input, [sources[0]], presets, planningContext))
      .toThrow('EXPORT_SOURCE_DESCRIPTOR_MISMATCH');
    expect(() => planMultiPlatformExport(input, sources, [presets[0]], planningContext))
      .toThrow('EXPORT_PRESET_DESCRIPTOR_MISMATCH');
    expect(() => planMultiPlatformExport(input, [sources[0], sources[0]], presets, planningContext))
      .toThrow('EXPORT_SOURCE_DESCRIPTOR_MISMATCH');
  });
});
