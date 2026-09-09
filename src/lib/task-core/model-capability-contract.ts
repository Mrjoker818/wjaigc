import type { ApiKind } from '@/lib/universal-api-types';

export const CAPABILITY_CATALOG_VERSION = 1 as const;

export type CapabilitySource = 'admin' | 'adapter' | 'discovery' | 'fallback';

export const CAPABILITY_FIELDS = [
  'protocol',
  'executionMode',
  'allowedRatios',
  'allowedSizes',
  'qualityOptions',
  'maxOutputs',
  'supportsVision',
  'supportsReferenceImages',
  'maxReferenceImages',
  'supportsMask',
  'allowedDurationsSeconds',
  'maxDurationSeconds',
  'supportedOperations',
  'outputKinds',
] as const;

export type CapabilityField = typeof CAPABILITY_FIELDS[number];

export type SupportedOperation =
  | 'text-to-image'
  | 'image-to-image'
  | 'text-to-video'
  | 'image-to-video'
  | 'first-last-frame'
  | 'multi-reference'
  | 'video-extend';

export interface TaskModelDescriptor {
  providerId: string;
  modelId: string;
  kind: 'image' | 'video' | 'chat' | 'edit' | 'upscale' | 'layer' | '3d';
  sourceType: ApiKind;
  protocol: string;
  executionMode: 'sync' | 'async';
  allowedRatios: string[];
  allowedSizes: string[];
  qualityOptions: string[];
  maxOutputs: number;
  supportsVision?: boolean;
  supportsReferenceImages: boolean;
  maxReferenceImages?: number;
  supportsMask: boolean;
  allowedDurationsSeconds?: number[];
  maxDurationSeconds?: number;
  supportedOperations?: SupportedOperation[];
  outputKinds: string[];
  capabilitySources: Partial<Record<CapabilityField, CapabilitySource>>;
}

export type CapabilityLayer = Partial<Pick<TaskModelDescriptor, CapabilityField>>;

export interface CapabilityMergeResult {
  value: CapabilityLayer;
  sources: Partial<Record<CapabilityField, CapabilitySource>>;
}

export type CapabilityOverrideV1 = CapabilityLayer;

export interface ProviderCapabilityOverridesV1 {
  version: typeof CAPABILITY_CATALOG_VERSION;
  models: Record<string, CapabilityOverrideV1>;
}

export interface TaskModelSelection {
  aspectRatio?: string;
  size?: string;
  quality?: string;
  outputCount?: number;
  referenceImageCount?: number;
  usesMask?: boolean;
  durationSeconds?: number;
  operation?: SupportedOperation;
}

export interface CapabilityMismatch {
  code: 'MODEL_CAPABILITY_MISMATCH';
  field:
    | 'aspectRatio'
    | 'size'
    | 'quality'
    | 'outputCount'
    | 'referenceImages'
    | 'mask'
    | 'duration'
    | 'operation';
  received: unknown;
  allowed: unknown[];
}

export type CapabilityValidationResult =
  | { ok: true }
  | { ok: false; error: CapabilityMismatch };

export type ModelCapabilityErrorCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'MODEL_NOT_AUTHORIZED'
  | 'MODEL_CAPABILITY_UNAVAILABLE'
  | 'MODEL_CAPABILITY_MISMATCH';

export class ModelCapabilityError extends Error {
  constructor(
    public readonly code: ModelCapabilityErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ModelCapabilityError';
  }
}

export function taskModelKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

export function createTaskModelCatalogIndex(
  items: TaskModelDescriptor[],
): Map<string, TaskModelDescriptor> {
  return new Map(items.map(item => [taskModelKey(item.providerId, item.modelId), item]));
}
