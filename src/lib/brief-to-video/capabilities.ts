import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import type { SkillCapabilityOptions } from '@/lib/skill-runtime/types';

export type BriefToVideoOperation = 'text-to-video' | 'image-to-video' | 'first-last-frame';

const OPERATION_LABELS: Readonly<Record<BriefToVideoOperation, string>> = {
  'text-to-video': '文生视频',
  'image-to-video': '首帧图生视频',
  'first-last-frame': '首尾帧视频',
};

/** Zero frames run text-to-video, a start frame image-to-video, and a start plus end frame first-last-frame. */
export function briefToVideoOperation(frames: { startFrame?: unknown; endFrame?: unknown }): BriefToVideoOperation {
  if (frames.endFrame) return 'first-last-frame';
  return frames.startFrame ? 'image-to-video' : 'text-to-video';
}

export class BriefToVideoOperationUnsupportedError extends Error {
  readonly code = 'MODEL_CAPABILITY_MISMATCH';
  readonly status = 422;

  constructor(readonly operation: BriefToVideoOperation) {
    super(`所选视频模型不支持${OPERATION_LABELS[operation]}，请更换支持该模式的视频模型或调整首尾帧`);
    this.name = 'BriefToVideoOperationUnsupportedError';
  }
}

/** Fails before any charge when the frozen video model cannot run the mode the frames select. */
export function assertBriefToVideoOperationSupported(
  descriptor: TaskModelDescriptor,
  frames: { startFrame?: unknown; endFrame?: unknown },
): void {
  const operation = briefToVideoOperation(frames);
  if (!descriptor.supportedOperations?.includes(operation)) {
    throw new BriefToVideoOperationUnsupportedError(operation);
  }
}

export function resolveVideoCapabilityFieldOptions(
  descriptor: TaskModelDescriptor | undefined,
  field: SkillCapabilityOptions['field'],
): string[] {
  if (!descriptor || descriptor.kind !== 'video') return [];
  const values = field === 'durationSeconds'
    ? descriptor.allowedDurationsSeconds?.map(String) ?? []
    : field === 'aspectRatio'
      ? descriptor.allowedRatios
      : descriptor.allowedSizes;
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}
