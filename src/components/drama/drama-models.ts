'use client';

import { useMemo } from 'react';
import { useTaskModelCatalog } from '@/hooks/use-task-model-catalog';
import type { ShotModelCapability } from '@/lib/drama/shot-runner';
import { taskModelKey, type TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import { referenceAudioLimit } from '@/lib/video-reference-audio';

/** One video model the workbench can generate shots with, with the limits the engine needs. */
export interface DramaModelOption {
  /** `providerId::modelId`, the same key the video model catalog uses. */
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
    maxReferenceAudios: descriptor ? referenceAudioLimit(descriptor.protocol, descriptor.modelId ?? '') : 0,
  };
}

export const VOICE_MODEL_MISSING = '后台还没有可用的语音模型，请管理员在供应商设置里添加一个语音（TTS）模型后再生成配音。';

/**
 * Whether the admin configured a speech model; without one every voiceover fails the same way.
 * While the catalog loads, or when it cannot be read, the workbench lets the request through and shows the server's answer.
 */
export function useDramaVoiceAvailable(): boolean {
  const { models, loading, error } = useTaskModelCatalog('audio');
  return loading || Boolean(error) || models.length > 0;
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
