import { createHash } from 'node:crypto';

import {
  canonicalBriefToVideoPlanJson,
  parseBriefToVideoResult,
} from './schema';
import {
  BRIEF_TO_VIDEO_RESULT_SCHEMA_ID,
  type BriefToVideoPlanV1,
  type BriefToVideoResultV1,
} from './types';

export interface BuildBriefToVideoResultInput {
  runId: string;
  plan: BriefToVideoPlanV1;
  videoAssetVersionId: string;
  sourceAssetVersionIds: readonly string[];
  providerId: string;
  modelId: string;
  remoteTaskId?: string;
  resolution?: string;
  thumbnailUrl?: string;
}

export function buildBriefToVideoResult(
  input: BuildBriefToVideoResultInput,
): BriefToVideoResultV1 {
  const canonicalPlan = canonicalBriefToVideoPlanJson(input.plan);
  return parseBriefToVideoResult({
    schemaId: BRIEF_TO_VIDEO_RESULT_SCHEMA_ID,
    runId: input.runId,
    planChecksum: createHash('sha256').update(canonicalPlan).digest('hex'),
    videoAssetVersionId: input.videoAssetVersionId,
    sourceAssetVersionIds: [...input.sourceAssetVersionIds],
    providerId: input.providerId,
    modelId: input.modelId,
    ...(input.remoteTaskId ? { remoteTaskId: input.remoteTaskId } : {}),
    durationSeconds: input.plan.durationSeconds,
    aspectRatio: input.plan.aspectRatio,
    ...(input.resolution ? { resolution: input.resolution } : {}),
    ...(input.thumbnailUrl ? { thumbnailUrl: input.thumbnailUrl } : {}),
  });
}

export { canonicalBriefToVideoResultJson } from './schema';
