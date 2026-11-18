'use client';

import { useMemo } from 'react';
import { useTaskModelCatalog } from '@/hooks/use-task-model-catalog';
import type { ShotModelCapability } from '@/lib/drama/shot-runner';
import { taskModelKey } from '@/lib/task-core/model-capability-contract';

/** One video model the workbench can generate shots with, with the limits the engine needs. */
export interface DramaModelOption {
  /** `providerId::modelId`, the same key the canvas video panel uses. */
  key: string;
  modelId: string;
  providerId: string;
  name: string;
  providerName: string;
  isDefault: boolean;
  capability: ShotModelCapability;
  durations: number[];
  maxDuration?: number;
  ratios: string[];
}

export function modelKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

export function useDramaVideoModels(): { models: DramaModelOption[]; loading: boolean; error: Error | null } {
  const { models, descriptorsByKey, loading, error } = useTaskModelCatalog('video');
  const options = useMemo(() => models.map((model): DramaModelOption => {
    const descriptor = descriptorsByKey.get(taskModelKey(model.providerId, model.id));
    const operations = descriptor?.supportedOperations;
    return {
      key: modelKey(model.providerId, model.id),
      modelId: model.id,
      providerId: model.providerId,
      name: model.displayName || model.name || model.id,
      providerName: model.providerName || model.providerId,
      isDefault: model.isDefault === true,
      capability: {
        imageToVideo: !operations || operations.includes('image-to-video') || operations.includes('first-last-frame'),
        maxReferenceImages: descriptor?.supportsReferenceImages === false ? 0 : (descriptor?.maxReferenceImages ?? 4),
      },
      durations: descriptor?.allowedDurationsSeconds ?? [],
      ...(descriptor?.maxDurationSeconds ? { maxDuration: descriptor.maxDurationSeconds } : {}),
      ratios: descriptor?.allowedRatios ?? [],
    };
  }), [models, descriptorsByKey]);
  return { models: options, loading, error };
}
