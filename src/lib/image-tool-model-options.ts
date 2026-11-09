import {
  DEFAULT_ASPECT_RATIOS,
  DEFAULT_QUALITIES,
  MODEL_ASPECT_RATIOS,
  MODEL_QUALITIES,
  findModelConfig,
  isResolutionTier,
} from '@/lib/canvas-generation-group';
import {
  taskModelKey,
  type TaskModelDescriptor,
} from '@/lib/task-core/model-capability-contract';

/** The part of an exact provider/model descriptor that the image tool panels render. */
export interface ImageToolModelCapability {
  allowedRatios: string[];
  allowedSizes: string[];
  qualityOptions: string[];
  maxOutputs: number;
}

/** Keyed by `providerId::modelId`. */
export type ImageToolCapabilityIndex = Record<string, ImageToolModelCapability>;

export interface ImageToolOptions {
  ratios: string[];
  qualities: string[];
  maxOutputs: number;
}

const TOOL_MAX_OUTPUTS = 4;

export function toImageToolCapability(
  descriptor: Pick<TaskModelDescriptor, 'allowedRatios' | 'allowedSizes' | 'qualityOptions' | 'maxOutputs'>,
): ImageToolModelCapability {
  return {
    allowedRatios: [...descriptor.allowedRatios],
    allowedSizes: [...descriptor.allowedSizes],
    qualityOptions: [...descriptor.qualityOptions],
    maxOutputs: descriptor.maxOutputs,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/** Accepts either a capability index or a task model catalog array; malformed entries are skipped. */
export function indexImageToolCapabilities(value: unknown): ImageToolCapabilityIndex {
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.flatMap(item => {
      const record = item as Partial<TaskModelDescriptor> | null;
      return record && typeof record.providerId === 'string' && typeof record.modelId === 'string'
        ? [[taskModelKey(record.providerId, record.modelId), record] as [string, unknown]]
        : [];
    })
    : value && typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>)
      : [];
  const index: ImageToolCapabilityIndex = {};
  for (const [key, raw] of entries) {
    const item = raw as Partial<ImageToolModelCapability> | null;
    if (
      item
      && isStringArray(item.allowedRatios)
      && isStringArray(item.allowedSizes)
      && isStringArray(item.qualityOptions)
      && typeof item.maxOutputs === 'number'
    ) {
      index[key] = toImageToolCapability(item as ImageToolModelCapability);
    }
  }
  return index;
}

/**
 * Options for the editor/refine/font panels. The exact capability wins; the name-based
 * tables are only a fallback when the catalog has no entry for the model.
 */
export function resolveImageToolOptions(
  modelId: string,
  capability?: ImageToolModelCapability,
): ImageToolOptions {
  const fallbackRatios = findModelConfig(MODEL_ASPECT_RATIOS, modelId) || DEFAULT_ASPECT_RATIOS;
  if (!capability) {
    return {
      ratios: fallbackRatios,
      qualities: findModelConfig(MODEL_QUALITIES, modelId) || DEFAULT_QUALITIES,
      maxOutputs: TOOL_MAX_OUTPUTS,
    };
  }
  // The tools send a single quality value, which the routes also use as the resolution tier.
  const tiers = capability.allowedSizes.filter(isResolutionTier);
  const qualities = capability.qualityOptions.length > 0 ? capability.qualityOptions : tiers;
  return {
    ratios: capability.allowedRatios.length > 0 ? capability.allowedRatios : fallbackRatios,
    qualities: qualities.length > 0 ? qualities : ['auto'],
    maxOutputs: Math.min(Math.max(1, capability.maxOutputs), TOOL_MAX_OUTPUTS),
  };
}

export interface ImageToolSelection {
  aspectRatio?: string;
  quality?: string;
  count?: number;
}

/**
 * Fits a panel's requested ratio/quality/count to the exact model capability, so tools whose
 * own option lists are generic still send values the selected model accepts. Without a
 * catalog entry the request is returned unchanged.
 */
export function fitImageToolSelection(
  modelId: string,
  capability: ImageToolModelCapability | undefined,
  requested: ImageToolSelection,
): ImageToolSelection {
  if (!capability) return { ...requested };
  const options = resolveImageToolOptions(modelId, capability);
  const pick = (value: string | undefined, allowed: string[], preferred: string): string | undefined => {
    if (allowed.length === 0) return value;
    if (value && allowed.includes(value)) return value;
    return allowed.includes(preferred) ? preferred : allowed[0];
  };
  return {
    aspectRatio: pick(requested.aspectRatio, options.ratios, '1:1'),
    quality: pick(requested.quality, options.qualities, options.qualities[0]),
    count: requested.count === undefined
      ? undefined
      : Math.min(Math.max(1, Math.floor(requested.count) || 1), options.maxOutputs),
  };
}

/** The main generation panel's last ratio/quality, which several tools reuse as their defaults. */
export function readSavedImageSelection(): ImageToolSelection {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem('wujie_selected_model');
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    return {
      aspectRatio: typeof parsed?.aspectRatio === 'string' ? parsed.aspectRatio : undefined,
      quality: typeof parsed?.quality === 'string' ? parsed.quality : undefined,
    };
  } catch {
    return {};
  }
}
