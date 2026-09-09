import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  parseExportPlanningContext,
  planMultiPlatformExport,
} from '@/lib/multi-platform-export/planner';
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

  it('hashes an explicit canonical DTO independent of property insertion order and runtime extras', () => {
    const reorderedSource = {
      runtimeNote: 'ignored',
      hasTransparency: false,
      assetName: '乙',
      versionId: 'version-b',
    } as ExportSourceDescriptor;
    const reorderedPreset = {
      runtimeNote: 'ignored', enabled: true, supportsTransparency: false,
      recommendedFormat: 'jpeg', height: 1080, width: 1080, label: '方图',
      usage: 'post', platform: 'instagram', version: 1, id: 'square',
    } as FrozenPlatformExportPreset;
    const reorderedContext = {
      skillVersion: 1,
      skillId: ' preset-multi-platform-export ',
      projectName: ' 中文项目 ',
      projectId: ' project-a ',
      userId: ' user-a ',
      runtimeNote: 'ignored',
    } as ExportPlanningContext;
    const baseline = planMultiPlatformExport(input, sources, presets, planningContext);
    const equivalent = planMultiPlatformExport(
      input,
      [reorderedSource, { ...sources[1], versionId: 'version-a', assetName: '甲' }],
      [reorderedPreset, { ...presets[1], runtimeNote: 'ignored' } as FrozenPlatformExportPreset],
      reorderedContext,
    );

    expect(equivalent.requestDigest).toBe(baseline.requestDigest);
    expect(Object.keys(equivalent.digestPayload.sources[0])).toEqual([
      'versionId', 'assetName', 'hasTransparency',
    ]);
    expect(Object.keys(equivalent.digestPayload.frozenPresets[0])).toEqual([
      'id', 'version', 'platform', 'usage', 'label', 'width', 'height',
      'recommendedFormat', 'supportsTransparency', 'enabled',
    ]);
    expect(equivalent.digestPayload).toMatchObject({
      userId: 'user-a', projectId: 'project-a', projectName: '中文项目',
      skillId: 'preset-multi-platform-export', skillVersion: 1,
    });
    expect(equivalent.outputs[0].outputFilename.startsWith('乙-instagram')).toBe(true);

    expect(planMultiPlatformExport(input, [
      { ...sources[0], assetName: '甲' },
      { ...sources[1], versionId: 'version-b', assetName: '不同名称' },
    ], presets, planningContext).requestDigest).not.toBe(baseline.requestDigest);
    expect(planMultiPlatformExport(input, sources, [
      { ...presets[0], supportsTransparency: true }, presets[1],
    ], planningContext).requestDigest).not.toBe(baseline.requestDigest);
  });

  it.each([
    [{ ...planningContext, userId: 1 }, 'EXPORT_USER_ID_INVALID'],
    [{ ...planningContext, userId: 'bad/id' }, 'EXPORT_USER_ID_INVALID'],
    [{ ...planningContext, projectId: ' ' }, 'EXPORT_PROJECT_ID_INVALID'],
    [{ ...planningContext, projectName: 1 }, 'EXPORT_PROJECT_NAME_INVALID'],
    [{ ...planningContext, projectName: 'x'.repeat(257) }, 'EXPORT_PROJECT_NAME_INVALID'],
    [{ ...planningContext, skillId: 'bad skill' }, 'EXPORT_SKILL_ID_INVALID'],
    [{ ...planningContext, skillVersion: 0 }, 'EXPORT_SKILL_VERSION_INVALID'],
    [{ ...planningContext, skillVersion: 2_147_483_648 }, 'EXPORT_SKILL_VERSION_INVALID'],
  ] as const)('rejects invalid planning context with named error %s', (value, code) => {
    expect(() => parseExportPlanningContext(value)).toThrow(code);
    expect(() => planMultiPlatformExport(input, sources, presets, value as ExportPlanningContext)).toThrow(code);
  });

  it('rejects transparent output when the selected format cannot preserve alpha', () => {
    expect(() => planMultiPlatformExport(
      { ...input, sourceAssetVersionIds: ['version-a'], targetPresetIds: ['square-v1'], background: 'transparent' },
      [{ ...sources[0], hasTransparency: true }],
      [presets[0]],
      planningContext,
    )).toThrow('EXPORT_TRANSPARENCY_FORMAT_CONFLICT');
  });

  it('derives transparency from RGBA alpha and source alpha without rejecting opaque output', () => {
    const jpegPreset = presets[0];
    const oneSourceInput = {
      ...input,
      sourceAssetVersionIds: ['version-a'],
      targetPresetIds: ['square-v1'],
    };
    expect(() => planMultiPlatformExport(
      { ...oneSourceInput, background: '#ffffff00' }, [sources[0]], [jpegPreset], planningContext,
    )).toThrow('EXPORT_TRANSPARENCY_FORMAT_CONFLICT');
    expect(() => planMultiPlatformExport(
      { ...oneSourceInput, background: '#ffffff80' }, [sources[0]], [jpegPreset], planningContext,
    )).toThrow('EXPORT_TRANSPARENCY_FORMAT_CONFLICT');
    expect(() => planMultiPlatformExport(
      { ...oneSourceInput, background: '#ffffffff' },
      [{ ...sources[0], hasTransparency: true }],
      [jpegPreset],
      planningContext,
    )).toThrow('EXPORT_TRANSPARENCY_FORMAT_CONFLICT');
    expect(() => planMultiPlatformExport(
      { ...oneSourceInput, background: '#ffffffff' }, [sources[0]], [jpegPreset], planningContext,
    )).not.toThrow();
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

    expect(() => planMultiPlatformExport(
      { ...input, sourceAssetVersionIds: ['version-a'], targetPresetIds: ['square-v2147483648'] },
      [sources[0]],
      [{ ...presets[0], version: 2_147_483_648 }],
      planningContext,
    )).toThrow('EXPORT_PRESET_VERSION_INVALID');
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
