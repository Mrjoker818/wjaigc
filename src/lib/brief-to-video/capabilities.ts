import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import type { SkillCapabilityOptions } from '@/lib/skill-runtime/types';

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
