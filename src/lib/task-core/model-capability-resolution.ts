import {
  CAPABILITY_FIELDS,
  type CapabilityField,
  type CapabilityLayer,
  type CapabilityMergeResult,
  type CapabilityMismatch,
  type CapabilitySource,
  type CapabilityValidationResult,
  type TaskModelDescriptor,
  type TaskModelSelection,
} from './model-capability-contract';

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function cloneCapabilityValue<T>(value: T): T {
  return (Array.isArray(value) ? [...value] : value) as T;
}

export function mergeCapabilityLayers(input: {
  fallback: CapabilityLayer;
  discovery?: CapabilityLayer;
  adapter?: CapabilityLayer;
  admin?: CapabilityLayer;
}): CapabilityMergeResult {
  const layers: Array<[CapabilitySource, CapabilityLayer | undefined]> = [
    ['fallback', input.fallback],
    ['discovery', input.discovery],
    ['adapter', input.adapter],
    ['admin', input.admin],
  ];
  const value: CapabilityLayer = {};
  const sources: Partial<Record<CapabilityField, CapabilitySource>> = {};

  for (const [source, layer] of layers) {
    if (!layer) continue;
    for (const field of CAPABILITY_FIELDS) {
      if (!hasOwn(layer, field) || layer[field] === undefined) continue;
      Object.assign(value, { [field]: cloneCapabilityValue(layer[field]) });
      sources[field] = source;
    }
  }

  return { value, sources };
}

function mismatch(
  field: CapabilityMismatch['field'],
  received: unknown,
  allowed: unknown[],
): CapabilityValidationResult {
  return {
    ok: false,
    error: {
      code: 'MODEL_CAPABILITY_MISMATCH',
      field,
      received,
      allowed: [...allowed],
    },
  };
}

function integerRange(start: number, end: number): number[] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function validateTaskModelSelection(
  descriptor: TaskModelDescriptor,
  selection: TaskModelSelection,
): CapabilityValidationResult {
  if (
    selection.aspectRatio !== undefined
    && !descriptor.allowedRatios.includes(selection.aspectRatio)
  ) {
    return mismatch('aspectRatio', selection.aspectRatio, descriptor.allowedRatios);
  }
  if (selection.size !== undefined && !descriptor.allowedSizes.includes(selection.size)) {
    return mismatch('size', selection.size, descriptor.allowedSizes);
  }
  if (
    selection.quality !== undefined
    && !descriptor.qualityOptions.includes(selection.quality)
  ) {
    return mismatch('quality', selection.quality, descriptor.qualityOptions);
  }
  if (
    selection.outputCount !== undefined
    && (
      !Number.isInteger(selection.outputCount)
      || selection.outputCount < 1
      || selection.outputCount > descriptor.maxOutputs
    )
  ) {
    return mismatch('outputCount', selection.outputCount, integerRange(1, descriptor.maxOutputs));
  }
  if (selection.referenceImageCount !== undefined && selection.referenceImageCount > 0) {
    if (!descriptor.supportsReferenceImages) {
      return mismatch('referenceImages', selection.referenceImageCount, [0]);
    }
    if (
      descriptor.maxReferenceImages !== undefined
      && selection.referenceImageCount > descriptor.maxReferenceImages
    ) {
      return mismatch(
        'referenceImages',
        selection.referenceImageCount,
        integerRange(0, descriptor.maxReferenceImages),
      );
    }
  }
  if (selection.usesMask && !descriptor.supportsMask) {
    return mismatch('mask', true, [false]);
  }
  if (selection.durationSeconds !== undefined) {
    if (
      descriptor.allowedDurationsSeconds !== undefined
      && !descriptor.allowedDurationsSeconds.includes(selection.durationSeconds)
    ) {
      return mismatch(
        'duration',
        selection.durationSeconds,
        descriptor.allowedDurationsSeconds,
      );
    }
    if (
      descriptor.allowedDurationsSeconds === undefined
      && (
        descriptor.maxDurationSeconds === undefined
        || selection.durationSeconds < 1
        || selection.durationSeconds > descriptor.maxDurationSeconds
      )
    ) {
      return mismatch(
        'duration',
        selection.durationSeconds,
        descriptor.maxDurationSeconds
          ? integerRange(1, descriptor.maxDurationSeconds)
          : [],
      );
    }
  }
  if (
    selection.operation !== undefined
    && !descriptor.supportedOperations?.includes(selection.operation)
  ) {
    return mismatch('operation', selection.operation, descriptor.supportedOperations || []);
  }
  return { ok: true };
}
