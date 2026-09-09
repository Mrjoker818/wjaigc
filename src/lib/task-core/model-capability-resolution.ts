import {
  CAPABILITY_FIELDS,
  type CapabilityField,
  type CapabilityLayer,
  type CapabilityMergeResult,
  type CapabilityMismatch,
  type CapabilitySource,
  type CapabilityValidationResult,
  type ProviderCapabilityOverridesV1,
  type SupportedOperation,
  type TaskModelDescriptor,
  type TaskModelSelection,
} from './model-capability-contract';

const MAX_CAPABILITY_MODELS = 512;
const MAX_MODEL_ID_LENGTH = 256;
const MAX_ARRAY_ITEMS = 32;
const MAX_STRING_ITEM_LENGTH = 128;
const MAX_PROTOCOL_LENGTH = 128;
const MAX_OUTPUTS = 4;
const MAX_REFERENCE_IMAGES = 16;
const MAX_DURATION_SECONDS = 3600;
const DANGEROUS_MODEL_IDS = new Set(['__proto__', 'prototype', 'constructor']);
const SUPPORTED_OPERATIONS = new Set<SupportedOperation>([
  'text-to-image',
  'image-to-image',
  'text-to-video',
  'image-to-video',
  'first-last-frame',
  'multi-reference',
  'video-extend',
]);

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function cloneCapabilityValue<T>(value: T): T {
  return (Array.isArray(value) ? [...value] : value) as T;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) return undefined;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return undefined;
    const normalized = item.trim();
    if (!normalized || normalized.length > MAX_STRING_ITEM_LENGTH) return undefined;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function readDurationArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) return undefined;
  const result: number[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    if (
      typeof item !== 'number'
      || !Number.isInteger(item)
      || item < 1
      || item > MAX_DURATION_SECONDS
    ) {
      return undefined;
    }
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function readOperations(value: unknown): SupportedOperation[] | undefined {
  const operations = readStringArray(value);
  if (!operations || operations.some(item => !SUPPORTED_OPERATIONS.has(item as SupportedOperation))) {
    return undefined;
  }
  return operations as SupportedOperation[];
}

function readBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : undefined;
}

export function readCapabilityOverride(value: unknown): CapabilityLayer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const candidate = value as Record<string, unknown>;
  const result: CapabilityLayer = {};

  if (hasOwn(candidate, 'protocol') && typeof candidate.protocol === 'string') {
    const protocol = candidate.protocol.trim();
    if (protocol && protocol.length <= MAX_PROTOCOL_LENGTH) result.protocol = protocol;
  }
  if (
    hasOwn(candidate, 'executionMode')
    && (candidate.executionMode === 'sync' || candidate.executionMode === 'async')
  ) {
    result.executionMode = candidate.executionMode;
  }

  for (const field of ['allowedRatios', 'allowedSizes', 'qualityOptions', 'outputKinds'] as const) {
    if (!hasOwn(candidate, field)) continue;
    const parsed = readStringArray(candidate[field]);
    if (parsed !== undefined) Object.assign(result, { [field]: parsed });
  }

  if (hasOwn(candidate, 'allowedDurationsSeconds')) {
    const durations = readDurationArray(candidate.allowedDurationsSeconds);
    if (durations !== undefined) result.allowedDurationsSeconds = durations;
  }
  if (hasOwn(candidate, 'supportedOperations')) {
    const operations = readOperations(candidate.supportedOperations);
    if (operations !== undefined) result.supportedOperations = operations;
  }

  const maxOutputs = readBoundedInteger(candidate.maxOutputs, 1, MAX_OUTPUTS);
  if (hasOwn(candidate, 'maxOutputs') && maxOutputs !== undefined) result.maxOutputs = maxOutputs;
  const maxReferenceImages = readBoundedInteger(
    candidate.maxReferenceImages,
    0,
    MAX_REFERENCE_IMAGES,
  );
  if (hasOwn(candidate, 'maxReferenceImages') && maxReferenceImages !== undefined) {
    result.maxReferenceImages = maxReferenceImages;
  }
  const maxDurationSeconds = readBoundedInteger(
    candidate.maxDurationSeconds,
    1,
    MAX_DURATION_SECONDS,
  );
  if (hasOwn(candidate, 'maxDurationSeconds') && maxDurationSeconds !== undefined) {
    result.maxDurationSeconds = maxDurationSeconds;
  }

  if (
    hasOwn(candidate, 'supportsVision')
    && typeof candidate.supportsVision === 'boolean'
  ) {
    result.supportsVision = candidate.supportsVision;
  }
  if (
    hasOwn(candidate, 'supportsReferenceImages')
    && typeof candidate.supportsReferenceImages === 'boolean'
  ) {
    result.supportsReferenceImages = candidate.supportsReferenceImages;
  }
  if (hasOwn(candidate, 'supportsMask') && typeof candidate.supportsMask === 'boolean') {
    result.supportsMask = candidate.supportsMask;
  }

  return result;
}

function readLegacyCapabilityOverride(value: unknown): CapabilityLayer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const candidate = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(candidate)) normalized[key] = candidate[key];

  for (const field of ['allowedRatios', 'allowedSizes', 'qualityOptions', 'outputKinds'] as const) {
    const raw = normalized[field];
    if (!Array.isArray(raw) || raw.some(item => typeof item !== 'string')) continue;
    const values = Array.from(new Set(
      raw.map(item => (item as string).trim()).filter(Boolean),
    ));
    if (raw.length > 0 && values.length === 0) {
      delete normalized[field];
    } else {
      normalized[field] = values;
    }
  }
  return readCapabilityOverride(normalized);
}

function parseJsonValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

export type StrictProviderCapabilityOverridesResult =
  | { ok: true; value: ProviderCapabilityOverridesV1 }
  | { ok: false; error: string };

export function parseProviderCapabilityOverridesStrict(
  raw: unknown,
): StrictProviderCapabilityOverridesResult {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'taskModelCapabilities must be a non-empty JSON string' };
  }
  const parsed = parseJsonValue(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'taskModelCapabilities must be a JSON object' };
  }
  const root = parsed as Record<string, unknown>;
  if (
    Object.keys(root).some(key => key !== 'version' && key !== 'models')
    || root.version !== 1
    || !hasOwn(root, 'models')
    || !root.models
    || typeof root.models !== 'object'
    || Array.isArray(root.models)
  ) {
    return { ok: false, error: 'taskModelCapabilities must use the version 1 wrapper' };
  }

  const rawModels = root.models as Record<string, unknown>;
  const modelIds = Object.keys(rawModels);
  if (modelIds.length > MAX_CAPABILITY_MODELS) {
    return { ok: false, error: 'taskModelCapabilities contains too many models' };
  }

  const models: ProviderCapabilityOverridesV1['models'] = {};
  for (const modelId of modelIds.sort()) {
    if (
      !modelId
      || modelId !== modelId.trim()
      || modelId.length > MAX_MODEL_ID_LENGTH
      || DANGEROUS_MODEL_IDS.has(modelId)
    ) {
      return { ok: false, error: 'taskModelCapabilities contains an invalid model id' };
    }
    const candidate = rawModels[modelId];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return { ok: false, error: `taskModelCapabilities.${modelId} must be an object` };
    }
    const unknownField = Object.keys(candidate).find(field => !CAPABILITY_FIELDS.includes(field as CapabilityField));
    if (unknownField) {
      return { ok: false, error: `taskModelCapabilities.${modelId}.${unknownField} is not supported` };
    }
    const override = readCapabilityOverride(candidate);
    for (const field of Object.keys(candidate) as CapabilityField[]) {
      if (!hasOwn(override, field)) {
        return { ok: false, error: `taskModelCapabilities.${modelId}.${field} is invalid` };
      }
    }
    Object.defineProperty(models, modelId, {
      value: override,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return { ok: true, value: { version: 1, models } };
}

export function readProviderCapabilityOverrides(raw: unknown): ProviderCapabilityOverridesV1 {
  const parsed = parseJsonValue(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { version: 1, models: {} };
  }
  const root = parsed as Record<string, unknown>;
  const isVersioned = hasOwn(root, 'version') || hasOwn(root, 'models');
  if (isVersioned && (root.version !== 1 || !root.models || typeof root.models !== 'object' || Array.isArray(root.models))) {
    return { version: 1, models: {} };
  }
  const rawModels = (isVersioned ? root.models : root) as Record<string, unknown>;
  const models: ProviderCapabilityOverridesV1['models'] = {};
  const modelIds = Object.keys(rawModels).slice(0, MAX_CAPABILITY_MODELS).sort();
  for (const modelId of modelIds) {
    if (!modelId || modelId.length > MAX_MODEL_ID_LENGTH) continue;
    const candidate = rawModels[modelId];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    models[modelId] = isVersioned
      ? readCapabilityOverride(candidate)
      : readLegacyCapabilityOverride(candidate);
  }
  return { version: 1, models };
}

export function readModelCapabilityOverride(raw: unknown, modelId: string): CapabilityLayer {
  return readProviderCapabilityOverrides(raw).models[modelId] || {};
}

export function serializeProviderCapabilityOverrides(
  value: ProviderCapabilityOverridesV1,
): string {
  return JSON.stringify(readProviderCapabilityOverrides(value));
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
