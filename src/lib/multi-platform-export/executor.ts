import 'server-only';

import { AssetServiceError } from '@/lib/asset-core/service';
import type { AssetVersion } from '@/lib/asset-core/types';
import type { ExecuteSkillStepInput } from '@/lib/skill-runtime/executor';
import type { SkillStepResult } from '@/lib/skill-runtime/types';
import { loadPersistedExportImages, persistExportArtifacts, persistExportImageVersion, type PersistedExportImage } from './artifacts';
import { MULTI_PLATFORM_EXPORT_RESULT_SCHEMA_ID, type ExportFailure, type MultiPlatformExportRetryLineage } from './manifest';
import { planMultiPlatformExport } from './planner';
import { freezePlatformExportPresets } from './presets';
import { parseMultiPlatformExportInput } from './schema';
import {
  MultiPlatformExportSourceError,
  readAuthorizedExportSources,
  type AuthorizedExportImageSource,
} from './source-reader';
import { transformPlatformImage } from './transformer';
import type { ExportPlan, ExportPlanOutput, MultiPlatformExportInput } from './types';

export interface MultiPlatformExportProgress {
  completed: number;
  total: number;
  succeeded: number;
  failed: number;
  outputFilename: string;
  failureCode?: string;
  retryable?: boolean;
}

export interface MultiPlatformExportExecutorDependencies {
  parseInput: typeof parseMultiPlatformExportInput;
  freezePresets: typeof freezePlatformExportPresets;
  readSources: typeof readAuthorizedExportSources;
  plan: typeof planMultiPlatformExport;
  loadPersistedImages(input: {
    actorUserId: string;
    projectId: string;
    runId: string;
    requestDigest: string;
    plan: ExportPlan;
    signal: AbortSignal;
    retryLineage?: MultiPlatformExportRetryLineage;
  }): Promise<PersistedExportImage[]>;
  transform: typeof transformPlatformImage;
  persistImage: typeof persistExportImageVersion;
  persistArtifacts: typeof persistExportArtifacts;
  onProgress?(progress: MultiPlatformExportProgress): Promise<void>;
  now(): Date;
  retryLineage?: MultiPlatformExportRetryLineage;
}

export class SkillPartialSuccessError extends Error {
  readonly code = 'SKILL_PARTIAL_SUCCESS';
  readonly status = 422;
  readonly retryable = true;

  constructor(readonly result: SkillStepResult) {
    super('Multi-platform export completed with one or more failed items');
    this.name = 'SkillPartialSuccessError';
  }
}

const defaults: MultiPlatformExportExecutorDependencies = {
  parseInput: parseMultiPlatformExportInput,
  freezePresets: freezePlatformExportPresets,
  readSources: readAuthorizedExportSources,
  plan: planMultiPlatformExport,
  loadPersistedImages: loadPersistedExportImages,
  transform: transformPlatformImage,
  persistImage: persistExportImageVersion,
  persistArtifacts: persistExportArtifacts,
  now: () => new Date(),
};

function outputKey(output: Pick<ExportPlanOutput, 'sourceVersionId' | 'presetId' | 'presetVersion' | 'outputFilename'>): string {
  return `${output.sourceVersionId}\0${output.presetId}\0${output.presetVersion}\0${output.outputFilename}`;
}

function matchesFailedItem(output: ExportPlanOutput, failure: ExportFailure): boolean {
  return failure.sourceAssetVersionId === output.sourceVersionId
    && failure.presetId === output.presetId
    && failure.presetVersion === output.presetVersion
    && (failure.outputFilename === undefined || failure.outputFilename === output.outputFilename);
}

function errorCode(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const record = error as { code?: unknown; message?: unknown };
  for (const candidate of [record.code, record.message]) {
    if (typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(candidate)) return candidate;
  }
  return fallback;
}

function failureFor(output: ExportPlanOutput, error: unknown): ExportFailure {
  return {
    sourceAssetVersionId: output.sourceVersionId,
    presetId: output.presetId,
    presetVersion: output.presetVersion,
    outputFilename: output.outputFilename,
    code: errorCode(error, 'EXPORT_IMAGE_TRANSFORM_FAILED'),
    retryable: true,
  };
}

function partialResult(
  runId: string,
  images: readonly PersistedExportImage[],
  failures: readonly ExportFailure[],
  lineage?: MultiPlatformExportRetryLineage,
): SkillStepResult {
  return {
    assetVersionIds: images.map(image => image.version.id),
    media: images.map(image => ({ width: image.width, height: image.height })),
    structured: {
      schemaId: MULTI_PLATFORM_EXPORT_RESULT_SCHEMA_ID,
      value: {
        schemaVersion: 1,
        runId,
        outcome: 'partial_success',
        imageAssetVersionIds: images.map(image => image.version.id).sort(),
        failures: [...failures],
        ...(lineage ? { lineage } : {}),
      },
    },
  };
}

function persistedImage(
  created: { version: AssetVersion },
  output: ExportPlanOutput,
  transformed: Awaited<ReturnType<typeof transformPlatformImage>>,
): PersistedExportImage {
  return {
    version: created.version,
    filename: output.outputFilename,
    bytes: transformed.bytes,
    sourceAssetVersionId: output.sourceVersionId,
    platform: output.platform,
    usage: output.usage,
    width: output.width,
    height: output.height,
    mimeType: transformed.mimeType,
    sha256: transformed.sha256,
  };
}

async function readSourcesWithIsolation(input: {
  dependencies: MultiPlatformExportExecutorDependencies;
  actorUserId: string;
  projectId: string;
  sourceVersionIds: readonly string[];
  signal: AbortSignal;
}): Promise<{
  sources: AuthorizedExportImageSource[];
  failures: Map<string, MultiPlatformExportSourceError>;
}> {
  const read = (sourceVersionIds: readonly string[]) => input.dependencies.readSources({
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    sourceVersionIds,
    signal: input.signal,
  });
  try {
    return { sources: await read(input.sourceVersionIds), failures: new Map() };
  } catch (error) {
    input.signal.throwIfAborted();
    if (error instanceof AssetServiceError || !(error instanceof MultiPlatformExportSourceError)) throw error;
  }

  const sources: AuthorizedExportImageSource[] = [];
  const failures = new Map<string, MultiPlatformExportSourceError>();
  for (const sourceVersionId of input.sourceVersionIds) {
    input.signal.throwIfAborted();
    try {
      sources.push(...await read([sourceVersionId]));
    } catch (error) {
      input.signal.throwIfAborted();
      if (error instanceof AssetServiceError || !(error instanceof MultiPlatformExportSourceError)) throw error;
      failures.set(sourceVersionId, error);
    }
  }
  return { sources, failures };
}

export async function executeMultiPlatformExportStep(
  step: ExecuteSkillStepInput,
  overrides: Partial<MultiPlatformExportExecutorDependencies> = {},
): Promise<SkillStepResult> {
  const dependencies = { ...defaults, ...overrides } as MultiPlatformExportExecutorDependencies;
  step.signal.throwIfAborted();
  const input: MultiPlatformExportInput = dependencies.parseInput(step.inputValues);
  const frozenPresets = await dependencies.freezePresets(input.targetPresetIds);
  const { sources, failures: sourceReadFailures } = await readSourcesWithIsolation({
    dependencies,
    actorUserId: step.actorUserId,
    projectId: step.projectId,
    sourceVersionIds: input.sourceAssetVersionIds,
    signal: step.signal,
  });
  const sourceById = new Map<string, AuthorizedExportImageSource>(sources.map(source => [source.versionId, source]));
  const plan = dependencies.plan(input, input.sourceAssetVersionIds.map(versionId => {
    const source = sourceById.get(versionId);
    return source
      ? { versionId, assetName: source.assetName, hasTransparency: source.hasTransparency }
      : { versionId, assetName: versionId, hasTransparency: false };
  }), frozenPresets, {
    userId: step.actorUserId,
    projectId: step.projectId,
    projectName: step.projectId,
    skillId: step.definition.id,
    skillVersion: step.definition.version,
  });
  const existing = await dependencies.loadPersistedImages({
    actorUserId: step.actorUserId,
    projectId: step.projectId,
    runId: step.runId,
    requestDigest: plan.requestDigest,
    plan,
    signal: step.signal,
    ...(dependencies.retryLineage ? { retryLineage: dependencies.retryLineage } : {}),
  });
  const byOutput = new Map(existing.map(image => {
    const metadata = image.version.metadata || {};
    return [outputKey({
      sourceVersionId: image.sourceAssetVersionId,
      presetId: String(metadata.presetId || ''),
      presetVersion: Number(metadata.presetVersion), outputFilename: image.filename,
    }), image] as const;
  }));
  const outputs = dependencies.retryLineage
    ? plan.outputs.filter(output => dependencies.retryLineage!.failedItems.some(failure => matchesFailedItem(output, failure)))
    : plan.outputs;
  const images: PersistedExportImage[] = dependencies.retryLineage ? [...existing] : [];
  const failures: ExportFailure[] = [];
  let cursor = 0;
  let completed = 0;
  let succeeded = 0;
  let progressWrites = Promise.resolve();
  const reportProgress = (progress: MultiPlatformExportProgress): Promise<void> => {
    progressWrites = progressWrites.then(async () => dependencies.onProgress?.(progress));
    return progressWrites;
  };

  const worker = async (): Promise<void> => {
    while (true) {
      if (step.signal.aborted) return;
      const index = cursor;
      cursor += 1;
      if (index >= outputs.length) return;
      const output = outputs[index];
      const reused = byOutput.get(outputKey(output));
      let outputFailure: ExportFailure | undefined;
      try {
        if (reused) {
          images.push(reused);
        } else {
          const sourceReadFailure = sourceReadFailures.get(output.sourceVersionId);
          if (sourceReadFailure) throw sourceReadFailure;
          const source = sourceById.get(output.sourceVersionId);
          if (!source) throw Object.assign(new Error('Source unavailable'), { code: 'EXPORT_SOURCE_UNAVAILABLE' });
          const transformed = await dependencies.transform({
            source,
            target: { width: output.width, height: output.height, outputFormat: output.outputFormat },
            fit: input.fit,
            background: input.background,
            signal: step.signal,
          });
          step.signal.throwIfAborted();
          const created = await dependencies.persistImage({
            actorUserId: step.actorUserId,
            projectId: step.projectId,
            runId: step.runId,
            sourceAssetVersionId: output.sourceVersionId,
            presetId: output.presetId,
            presetVersion: output.presetVersion,
            platform: output.platform,
            usage: output.usage,
            width: output.width,
            height: output.height,
            fit: input.fit,
            outputFormat: output.outputFormat,
            outputFilename: output.outputFilename,
            requestDigest: plan.requestDigest,
            transformed,
            signal: step.signal,
          });
          images.push(persistedImage(created, output, transformed));
        }
        succeeded += 1;
      } catch (error) {
        if (step.signal.aborted) throw step.signal.reason;
        outputFailure = failureFor(output, error);
        failures.push(outputFailure);
      }
      completed += 1;
      await reportProgress({
        completed,
        total: outputs.length,
        succeeded,
        failed: failures.length,
        outputFilename: output.outputFilename,
        ...(outputFailure ? {
          failureCode: outputFailure.code,
          retryable: outputFailure.retryable,
        } : {}),
      });
    }
  };

  await Promise.all([worker(), worker()]);
  step.signal.throwIfAborted();
  const orderedImages = [...images].sort((left, right) => left.filename.localeCompare(right.filename));
  let artifacts;
  try {
    artifacts = await dependencies.persistArtifacts({
      actorUserId: step.actorUserId,
      projectId: step.projectId,
      runId: step.runId,
      requestDigest: plan.requestDigest,
      createdAt: dependencies.now().toISOString(),
      frozenParameters: plan.digestPayload as unknown as Record<string, unknown>,
      images: orderedImages,
      failures,
      ...(dependencies.retryLineage ? { lineage: dependencies.retryLineage } : {}),
      signal: step.signal,
    });
  } catch (error) {
    if (step.signal.aborted) throw step.signal.reason;
    throw new SkillPartialSuccessError(partialResult(step.runId, orderedImages, [...failures, {
      sourceAssetVersionId: input.sourceAssetVersionIds[0],
      code: errorCode(error, 'EXPORT_ZIP_FAILED'),
      retryable: true,
    }], dependencies.retryLineage));
  }
  const result: SkillStepResult = {
    assetVersionIds: [
      ...orderedImages.map(image => image.version.id),
      artifacts.manifestVersion.id,
      artifacts.zipVersion.id,
    ],
    media: orderedImages.map(image => ({ width: image.width, height: image.height })),
    structured: { schemaId: MULTI_PLATFORM_EXPORT_RESULT_SCHEMA_ID, value: artifacts.result },
  };
  if (failures.length > 0) throw new SkillPartialSuccessError(result);
  return result;
}
