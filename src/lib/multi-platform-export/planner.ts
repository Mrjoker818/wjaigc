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
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_CONTEXT_ID_LENGTH = 256;
const MAX_PROJECT_NAME_LENGTH = 256;
const CONTEXT_ID = /^[A-Za-z0-9._:-]+$/;

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

function parseContextId(value: unknown, code: string): string {
  if (typeof value !== 'string') fail(code);
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > MAX_CONTEXT_ID_LENGTH
    || !CONTEXT_ID.test(normalized)
  ) fail(code);
  return normalized;
}

export function parseExportPlanningContext(value: unknown): ExportPlanningContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('EXPORT_PLANNING_CONTEXT_INVALID');
  }
  const context = value as Record<string, unknown>;
  const userId = parseContextId(context.userId, 'EXPORT_USER_ID_INVALID');
  const projectId = parseContextId(context.projectId, 'EXPORT_PROJECT_ID_INVALID');
  const skillId = parseContextId(context.skillId, 'EXPORT_SKILL_ID_INVALID');
  if (typeof context.projectName !== 'string') fail('EXPORT_PROJECT_NAME_INVALID');
  const projectName = context.projectName.trim();
  if (
    !projectName
    || projectName.length > MAX_PROJECT_NAME_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(projectName)
  ) fail('EXPORT_PROJECT_NAME_INVALID');
  if (
    !Number.isSafeInteger(context.skillVersion)
    || (context.skillVersion as number) < 1
    || (context.skillVersion as number) > MAX_POSTGRES_INTEGER
  ) fail('EXPORT_SKILL_VERSION_INVALID');
  return {
    userId,
    projectId,
    projectName,
    skillId,
    skillVersion: context.skillVersion as number,
  };
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
    if (
      !Number.isSafeInteger(preset.version)
      || preset.version < 1
      || preset.version > MAX_POSTGRES_INTEGER
    ) fail('EXPORT_PRESET_VERSION_INVALID');
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
  const normalizedContext = parseExportPlanningContext(context);
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
    const backgroundNeedsTransparency = input.background === 'transparent'
      || input.background.slice(-2).toLowerCase() !== 'ff';
    const needsTransparency = backgroundNeedsTransparency || source.hasTransparency;
    if (needsTransparency && (
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
      project: normalizedContext.projectName,
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
    userId: normalizedContext.userId,
    projectId: normalizedContext.projectId,
    projectName: normalizedContext.projectName,
    skillId: normalizedContext.skillId,
    skillVersion: normalizedContext.skillVersion,
    sourceAssetVersionIds: [...input.sourceAssetVersionIds],
    sources: orderedSources.map(source => ({
      versionId: source.versionId,
      assetName: source.assetName,
      hasTransparency: source.hasTransparency,
    })),
    frozenPresets: orderedPresets.map(preset => ({
      id: preset.id,
      version: preset.version,
      platform: preset.platform,
      usage: preset.usage,
      label: preset.label,
      width: preset.width,
      height: preset.height,
      recommendedFormat: preset.recommendedFormat,
      supportsTransparency: preset.supportsTransparency,
      enabled: preset.enabled,
    })),
    fit: input.fit,
    background: input.background,
    namingTemplate: input.namingTemplate,
  };
  const requestDigest = createHash('sha256')
    .update(JSON.stringify(digestPayload))
    .digest('hex');

  return { requestDigest, digestPayload, outputCount, totalPixels, outputs };
}
