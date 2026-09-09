import { createHash } from 'node:crypto';
import { renderExportFilename } from './naming';
import type {
  ExportDigestPayload,
  ExportPlan,
  ExportPlanningContext,
  ExportSourceDescriptor,
  FrozenPlatformExportPreset,
  MultiPlatformExportInput,
} from './types';

const MAX_SOURCE_COUNT = 20;
const MAX_TARGET_COUNT = 20;
const MAX_OUTPUT_COUNT = 100;
const MAX_OUTPUT_PIXELS = 67_108_864;
const MAX_BATCH_PIXELS = 402_653_184;

export class MultiPlatformExportPlanError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'MultiPlatformExportPlanError';
  }
}

function fail(code: string): never {
  throw new MultiPlatformExportPlanError(code);
}

function presetReference(preset: FrozenPlatformExportPreset): string {
  return `${preset.id}-v${preset.version}`;
}

function requirePlanningContext(context: ExportPlanningContext): void {
  if (
    !context.userId.trim()
    || !context.projectId.trim()
    || !context.skillId.trim()
    || !Number.isSafeInteger(context.skillVersion)
    || context.skillVersion < 1
  ) {
    fail('EXPORT_PLANNING_CONTEXT_INVALID');
  }
}

function orderSources(
  input: MultiPlatformExportInput,
  sources: readonly ExportSourceDescriptor[],
): ExportSourceDescriptor[] {
  if (sources.length !== input.sourceAssetVersionIds.length) fail('EXPORT_SOURCE_DESCRIPTOR_MISMATCH');
  const byId = new Map<string, ExportSourceDescriptor>();
  for (const source of sources) {
    if (byId.has(source.versionId)) fail('EXPORT_SOURCE_DESCRIPTOR_MISMATCH');
    byId.set(source.versionId, source);
  }
  return input.sourceAssetVersionIds.map(id => byId.get(id) ?? fail('EXPORT_SOURCE_DESCRIPTOR_MISMATCH'));
}

function validatePresets(
  input: MultiPlatformExportInput,
  presets: readonly FrozenPlatformExportPreset[],
): FrozenPlatformExportPreset[] {
  if (presets.length !== input.targetPresetIds.length) fail('EXPORT_PRESET_DESCRIPTOR_MISMATCH');
  const seen = new Set<string>();
  for (let index = 0; index < presets.length; index += 1) {
    const preset = presets[index];
    const reference = presetReference(preset);
    if (seen.has(reference) || reference !== input.targetPresetIds[index]) {
      fail('EXPORT_PRESET_DESCRIPTOR_MISMATCH');
    }
    if (
      !Number.isSafeInteger(preset.width)
      || !Number.isSafeInteger(preset.height)
      || preset.width < 1
      || preset.height < 1
    ) {
      fail('EXPORT_PRESET_DIMENSIONS_INVALID');
    }
    seen.add(reference);
  }
  return [...presets];
}

export function planMultiPlatformExport(
  input: MultiPlatformExportInput,
  sources: readonly ExportSourceDescriptor[],
  frozenPresets: readonly FrozenPlatformExportPreset[],
  context: ExportPlanningContext,
): ExportPlan {
  requirePlanningContext(context);
  if (input.sourceAssetVersionIds.length < 1 || input.sourceAssetVersionIds.length > MAX_SOURCE_COUNT) {
    fail('EXPORT_SOURCE_COUNT_INVALID');
  }
  if (input.targetPresetIds.length < 1 || input.targetPresetIds.length > MAX_TARGET_COUNT) {
    fail('EXPORT_TARGET_COUNT_INVALID');
  }
  const outputCount = input.sourceAssetVersionIds.length * input.targetPresetIds.length;
  if (outputCount > MAX_OUTPUT_COUNT) fail('EXPORT_OUTPUT_COUNT_INVALID');

  const orderedSources = orderSources(input, sources);
  const orderedPresets = validatePresets(input, frozenPresets);
  const usedNames = new Set<string>();
  let totalPixels = 0;
  const outputs = orderedSources.flatMap((source, sourceIndex) => orderedPresets.map(preset => {
    if (input.background === 'transparent' && (
      !preset.supportsTransparency || preset.recommendedFormat === 'jpeg'
    )) {
      fail('EXPORT_TRANSPARENCY_FORMAT_CONFLICT');
    }
    const pixelCount = preset.width * preset.height;
    if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_OUTPUT_PIXELS) {
      fail('EXPORT_OUTPUT_PIXEL_LIMIT');
    }
    totalPixels += pixelCount;
    if (totalPixels > MAX_BATCH_PIXELS) fail('EXPORT_BATCH_PIXEL_LIMIT');
    const outputFilename = renderExportFilename(input.namingTemplate, {
      project: context.projectName,
      asset: source.assetName,
      platform: preset.platform,
      usage: preset.usage,
      width: preset.width,
      height: preset.height,
      index: sourceIndex + 1,
      outputFormat: preset.recommendedFormat,
      sourceVersionId: source.versionId,
      presetId: preset.id,
      presetVersion: preset.version,
    }, usedNames);
    return {
      sourceVersionId: source.versionId,
      presetId: preset.id,
      presetVersion: preset.version,
      platform: preset.platform,
      usage: preset.usage,
      width: preset.width,
      height: preset.height,
      outputFormat: preset.recommendedFormat,
      outputFilename,
      pixelCount,
    };
  }));

  const digestPayload: ExportDigestPayload = {
    userId: context.userId,
    projectId: context.projectId,
    projectName: context.projectName,
    skillId: context.skillId,
    skillVersion: context.skillVersion,
    sourceAssetVersionIds: [...input.sourceAssetVersionIds],
    sources: orderedSources.map(source => ({ ...source })),
    frozenPresets: orderedPresets.map(preset => ({ ...preset })),
    fit: input.fit,
    background: input.background,
    namingTemplate: input.namingTemplate,
  };
  const requestDigest = createHash('sha256')
    .update(JSON.stringify(digestPayload))
    .digest('hex');

  return { requestDigest, digestPayload, outputCount, totalPixels, outputs };
}
