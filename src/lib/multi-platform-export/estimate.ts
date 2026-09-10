import 'server-only';

import { planMultiPlatformExport } from './planner';
import { freezePlatformExportPresets } from './presets';
import { parseMultiPlatformExportInput } from './schema';
import { readAuthorizedExportSources } from './source-reader';

export interface MultiPlatformExportPlanEstimate {
  fileCount: number;
  totalPixels: number;
  estimatedZipBytes: number;
}

export async function estimateMultiPlatformExportPlan(input: {
  actorUserId: string;
  projectId: string;
  skillId: string;
  skillVersion: number;
  inputValues: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<MultiPlatformExportPlanEstimate> {
  const parsed = parseMultiPlatformExportInput(input.inputValues);
  const [presets, sources] = await Promise.all([
    freezePlatformExportPresets(parsed.targetPresetIds),
    readAuthorizedExportSources({
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      sourceVersionIds: parsed.sourceAssetVersionIds,
      signal: input.signal,
    }),
  ]);
  const plan = planMultiPlatformExport(
    parsed,
    sources.map(source => ({
      versionId: source.versionId,
      assetName: source.assetName,
      hasTransparency: source.hasTransparency,
    })),
    presets,
    {
      userId: input.actorUserId,
      projectId: input.projectId,
      projectName: input.projectId,
      skillId: input.skillId,
      skillVersion: input.skillVersion,
    },
  );
  return {
    fileCount: plan.outputCount,
    totalPixels: plan.totalPixels,
    estimatedZipBytes: plan.outputCount === 0
      ? 0
      : Math.ceil(plan.totalPixels * 0.72 + plan.outputCount * 1_024),
  };
}
