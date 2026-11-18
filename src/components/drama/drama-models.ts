'use client';

import { useMemo } from 'react';
import { useTaskModelCatalog } from '@/hooks/use-task-model-catalog';
import type { ShotModelCapability } from '@/lib/drama/shot-runner';
import { taskModelKey, type TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';

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

/**
 * Mirrors the admission in /api/video/generate. Pear rejects character references outright, and a
 * model the catalog has not described gets none, so a shot never fails on references it guessed.
 */
export function shotCapabilityFromDescriptor(descriptor: TaskModelDescriptor | undefined): ShotModelCapability {
  const operations = descriptor?.supportedOperations;
  const acceptsReferences = Boolean(descriptor?.supportsReferenceImages) && descriptor?.protocol !== 'pearapi-video';
  return {
    imageToVideo: !operations || operations.includes('image-to-video') || operations.includes('first-last-frame'),
    maxReferenceImages: acceptsReferences ? (descriptor?.maxReferenceImages ?? 4) : 0,
    // Pear video rejects any last frame, whatever the descriptor says.
    firstLastFrame: Boolean(operations?.includes('first-last-frame')) && descriptor?.protocol !== 'pearapi-video',
  };
}

/** One image model the workbench can draw keyframes with. */
export interface DramaImageModelOption {
  key: string;
  modelId: string;
  providerId: string;
  name: string;
  providerName: string;
  isDefault: boolean;
  /** Reference images the model accepts; 0 means it draws from the prompt alone. */
  maxReferenceImages: number;
}

export function useDramaImageModels(): { models: DramaImageModelOption[]; loading: boolean } {
  const { models, descriptorsByKey, loading } = useTaskModelCatalog('image');
  const options = useMemo(() => models.map((model): DramaImageModelOption => {
    const descriptor = descriptorsByKey.get(taskModelKey(model.providerId, model.id));
    return {
      key: modelKey(model.providerId, model.id),
      modelId: model.id,
      providerId: model.providerId,
      name: model.displayName || model.name || model.id,
      providerName: model.providerName || model.providerId,
      isDefault: model.isDefault === true,
      maxReferenceImages: descriptor?.supportsReferenceImages ? (descriptor.maxReferenceImages ?? 4) : 0,
    };
  }), [models, descriptorsByKey]);
  return { models: options, loading };
}

export function useDramaVideoModels(): { models: DramaModelOption[]; loading: boolean; error: Error | null } {
  const { models, descriptorsByKey, loading, error } = useTaskModelCatalog('video');
  const options = useMemo(() => models.map((model): DramaModelOption => {
    const descriptor = descriptorsByKey.get(taskModelKey(model.providerId, model.id));
    return {
      key: modelKey(model.providerId, model.id),
      modelId: model.id,
      providerId: model.providerId,
      name: model.displayName || model.name || model.id,
      providerName: model.providerName || model.providerId,
      isDefault: model.isDefault === true,
      capability: shotCapabilityFromDescriptor(descriptor),
      durations: descriptor?.allowedDurationsSeconds ?? [],
      ...(descriptor?.maxDurationSeconds ? { maxDuration: descriptor.maxDurationSeconds } : {}),
      ratios: descriptor?.allowedRatios ?? [],
    };
  }), [models, descriptorsByKey]);
  return { models: options, loading, error };
}
