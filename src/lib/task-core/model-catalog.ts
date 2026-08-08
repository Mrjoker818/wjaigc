import { resolveProfileForModel } from '@/lib/api-compatibility';
import {
  getProviderAspectRatios,
  getQualityLevelOptions,
  getResolutionTierOptions,
} from '@/lib/canvas-generation-group';
import {
  classifyModelFamily,
  getImageTaskCapabilityDefaults,
} from '@/lib/model-capabilities';
import { getApiProviders, inferModelType } from '@/lib/server-api-config';
import { listManagedUsers } from '@/lib/server-auth';
import type { ApiKind, ApiProvider, ModelInfo } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';
import { getVideoModelInfo, resolveVideoCompatProfile } from '@/lib/video-api';

export interface TaskModelDescriptor {
  providerId: string;
  modelId: string;
  kind: 'image' | 'video' | 'chat' | 'edit' | 'upscale' | 'layer' | '3d';
  protocol: string;
  executionMode: 'sync' | 'async';
  allowedRatios: string[];
  allowedSizes: string[];
  qualityOptions: string[];
  maxOutputs: number;
  maxDurationSeconds?: number;
  supportsReferenceImages: boolean;
  supportsMask: boolean;
  outputKinds: string[];
}

type TaskModelKind = TaskModelDescriptor['kind'];
type TaskModelOverride = Partial<Omit<TaskModelDescriptor, 'providerId' | 'modelId'>>;

const TASK_MODEL_KINDS = new Set<TaskModelKind>([
  'image',
  'video',
  'chat',
  'edit',
  'upscale',
  'layer',
  '3d',
]);
const EXECUTION_MODES = new Set<TaskModelDescriptor['executionMode']>(['sync', 'async']);
const IMAGE_AUTH_TYPES = new Set<ApiKind>([
  'image',
  'vectorize',
  'layer',
  'imageEdit',
  'upscaler',
  'removebg',
]);
const CHAT_AUTH_TYPES = new Set<ApiKind>(['chat', 'vlm']);

export function taskModelKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

function isConfiguredModel(provider: ApiProvider, modelId: string): boolean {
  const selectedModels = provider.selectedModels || [];
  if (selectedModels.length > 0) return selectedModels.includes(modelId);
  return Boolean(provider.discoveredModels?.some(model => model.id === modelId));
}

function findConfiguredModel(provider: ApiProvider, modelId: string): ModelInfo | null {
  if (
    !provider.isEnabled
    || !provider.baseUrl
    || !provider.apiKey
    || !isConfiguredModel(provider, modelId)
  ) {
    return null;
  }

  return provider.discoveredModels?.find(model => model.id === modelId) || {
    id: modelId,
    name: modelId,
    providerId: provider.id,
    type: provider.modelType || provider.type,
  };
}

function inferGeneralModelType(modelId: string): ApiKind {
  const family = classifyModelFamily(modelId);
  if (family !== 'other') return 'image';
  return inferModelType(modelId, 'chat');
}

function resolveSourceType(provider: ApiProvider, model: ModelInfo): ApiKind {
  const sourceType = model.type || provider.modelType || provider.type;
  return sourceType === 'general' || sourceType === 'universal'
    ? inferGeneralModelType(model.id)
    : sourceType;
}

function resolveTaskKind(sourceType: ApiKind): TaskModelKind | null {
  switch (sourceType) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'chat':
    case 'vlm':
      return 'chat';
    case 'vectorize':
    case 'imageEdit':
    case 'removebg':
      return 'edit';
    case 'upscaler':
      return 'upscale';
    case 'layer':
      return 'layer';
    case '3d':
      return '3d';
    default:
      return null;
  }
}

function hasExactAssignment(
  allowedModels: string[] | undefined,
  providerId: string,
  modelId: string,
): boolean {
  if (!allowedModels?.length) return true;
  return allowedModels.includes(taskModelKey(providerId, modelId));
}

function hasRequiredPermission(user: User, sourceType: ApiKind): boolean {
  const permissions = user.apiPermissions;
  if (!permissions) return sourceType !== 'layer';

  switch (sourceType) {
    case 'image':
      return permissions.image !== false;
    case 'chat':
      return permissions.chat !== false;
    case '3d':
      return permissions.threeD === true;
    case 'vectorize':
      return permissions.vectorize === true;
    case 'layer':
      return permissions.layer === true;
    case 'video':
      return permissions.video === true;
    case 'vlm':
      return permissions.vlm === true;
    case 'imageEdit':
      return permissions.imageEdit === true;
    case 'upscaler':
      return permissions.upscaler === true;
    case 'removebg':
      return permissions.removebg === true;
    case 'audio':
      return permissions.audio === true;
    case 'general':
    case 'universal':
      return true;
  }
}

function isAuthorizedForModel(
  user: User | null,
  provider: ApiProvider,
  model: ModelInfo,
): boolean {
  if (!user || user.role === 'admin') return true;

  const sourceType = resolveSourceType(provider, model);
  if (!hasRequiredPermission(user, sourceType)) return false;
  if (IMAGE_AUTH_TYPES.has(sourceType)) {
    return hasExactAssignment(user.imageModels, provider.id, model.id);
  }
  if (CHAT_AUTH_TYPES.has(sourceType)) {
    return hasExactAssignment(user.chatModels, provider.id, model.id);
  }
  return true;
}

function providerHint(provider: ApiProvider): string {
  return [
    provider.providerPreset,
    provider.name,
    provider.displayName,
    provider.baseUrl,
  ].filter(Boolean).join(' ');
}

function createImageDescriptor(
  provider: ApiProvider,
  model: ModelInfo,
  kind: Extract<TaskModelKind, 'image' | 'edit' | 'upscale'>,
  sourceType: ApiKind,
): TaskModelDescriptor {
  const defaults = getImageTaskCapabilityDefaults(model.id);
  const profile = resolveProfileForModel(model.id, provider);
  const hint = providerHint(provider);
  const inferredQualityOptions = getQualityLevelOptions(model.id, hint);

  return {
    providerId: provider.id,
    modelId: model.id,
    kind,
    protocol: profile.id,
    executionMode: profile.responseMode === 'direct' ? 'sync' : 'async',
    allowedRatios: model.supportedAspectRatios !== undefined
      ? [...model.supportedAspectRatios]
      : getProviderAspectRatios(model.id, hint),
    allowedSizes: defaults.allowedSizes.length > 0
      ? [...defaults.allowedSizes]
      : getResolutionTierOptions(model.id, hint),
    qualityOptions: model.supportedQualities !== undefined
      ? [...model.supportedQualities]
      : (inferredQualityOptions.length > 0
          ? inferredQualityOptions
          : [...defaults.qualityOptions]),
    maxOutputs: model.maxImages ?? defaults.maxOutputs,
    supportsReferenceImages: kind === 'image'
      ? defaults.supportsReferenceImages
      : true,
    supportsMask: sourceType === 'imageEdit' || (kind === 'image' && defaults.supportsMask),
    outputKinds: sourceType === 'vectorize'
      ? ['svg', 'png']
      : kind === 'upscale'
        ? ['png', 'jpeg', 'webp']
        : [...defaults.outputKinds],
  };
}

function createBaseDescriptor(
  provider: ApiProvider,
  model: ModelInfo,
): TaskModelDescriptor | null {
  const sourceType = resolveSourceType(provider, model);
  const kind = resolveTaskKind(sourceType);
  if (!kind) return null;

  if (kind === 'image' || kind === 'edit' || kind === 'upscale') {
    return createImageDescriptor(provider, model, kind, sourceType);
  }

  if (kind === 'video') {
    const info = getVideoModelInfo(model.id);
    const protocol = resolveVideoCompatProfile(
      model.id,
      provider.advancedParams?.compatProfile,
      provider.baseUrl,
    );
    return {
      providerId: provider.id,
      modelId: model.id,
      kind,
      protocol,
      executionMode: 'async',
      allowedRatios: model.supportedAspectRatios !== undefined
        ? [...model.supportedAspectRatios]
        : [...(info?.features.ratios || [])],
      allowedSizes: [...(info?.features.resolutions || [])],
      qualityOptions: model.supportedQualities !== undefined
        ? [...model.supportedQualities]
        : ['std', 'pro'],
      maxOutputs: model.maxImages ?? 1,
      maxDurationSeconds: info?.features.maxDuration,
      supportsReferenceImages: Boolean(
        info?.features.firstLastFrame || info?.features.multiReference,
      ),
      supportsMask: false,
      outputKinds: ['mp4'],
    };
  }

  const protocol = provider.requestStyle
    || provider.advancedParams?.compatProfile
    || (kind === 'chat' ? 'chat-completions' : sourceType);
  const shared = {
    providerId: provider.id,
    modelId: model.id,
    protocol,
    allowedRatios: [] as string[],
    allowedSizes: [] as string[],
    qualityOptions: [] as string[],
    maxOutputs: model.maxImages ?? 1,
    supportsMask: false,
  };

  switch (kind) {
    case 'chat':
      return {
        ...shared,
        kind,
        executionMode: 'sync',
        supportsReferenceImages: sourceType === 'vlm',
        outputKinds: ['text'],
      };
    case 'layer':
      return {
        ...shared,
        kind,
        executionMode: 'async',
        supportsReferenceImages: true,
        outputKinds: ['png', 'psd', 'json'],
      };
    case '3d':
      return {
        ...shared,
        kind,
        executionMode: 'async',
        supportsReferenceImages: true,
        outputKinds: ['glb', 'obj', 'fbx', 'usdz', 'stl'],
      };
  }
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? [...value]
    : undefined;
}

function readTaskModelOverride(provider: ApiProvider, modelId: string): TaskModelOverride {
  const raw = provider.advancedParams?.taskModelCapabilities;
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const candidate = (parsed as Record<string, unknown>)[modelId];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
    const value = candidate as Record<string, unknown>;
    const override: TaskModelOverride = {};

    if (typeof value.kind === 'string' && TASK_MODEL_KINDS.has(value.kind as TaskModelKind)) {
      override.kind = value.kind as TaskModelKind;
    }
    if (typeof value.protocol === 'string' && value.protocol) override.protocol = value.protocol;
    if (
      typeof value.executionMode === 'string'
      && EXECUTION_MODES.has(value.executionMode as TaskModelDescriptor['executionMode'])
    ) {
      override.executionMode = value.executionMode as TaskModelDescriptor['executionMode'];
    }

    const allowedRatios = readStringArray(value.allowedRatios);
    if (allowedRatios !== undefined) override.allowedRatios = allowedRatios;
    const allowedSizes = readStringArray(value.allowedSizes);
    if (allowedSizes !== undefined) override.allowedSizes = allowedSizes;
    const qualityOptions = readStringArray(value.qualityOptions);
    if (qualityOptions !== undefined) override.qualityOptions = qualityOptions;
    const outputKinds = readStringArray(value.outputKinds);
    if (outputKinds !== undefined) override.outputKinds = outputKinds;

    if (typeof value.maxOutputs === 'number' && value.maxOutputs > 0) {
      override.maxOutputs = Math.floor(value.maxOutputs);
    }
    if (typeof value.maxDurationSeconds === 'number' && value.maxDurationSeconds > 0) {
      override.maxDurationSeconds = value.maxDurationSeconds;
    }
    if (typeof value.supportsReferenceImages === 'boolean') {
      override.supportsReferenceImages = value.supportsReferenceImages;
    }
    if (typeof value.supportsMask === 'boolean') override.supportsMask = value.supportsMask;

    return override;
  } catch {
    return {};
  }
}

function describeConfiguredModel(
  provider: ApiProvider,
  model: ModelInfo,
): TaskModelDescriptor | null {
  const descriptor = createBaseDescriptor(provider, model);
  if (!descriptor) return null;

  return {
    ...descriptor,
    ...readTaskModelOverride(provider, model.id),
    providerId: provider.id,
    modelId: model.id,
  };
}

export async function resolveTaskModel(
  providerId: string,
  modelId: string,
  userId: string,
): Promise<TaskModelDescriptor> {
  const [providers, users] = await Promise.all([getApiProviders(), listManagedUsers()]);
  const provider = providers.find(candidate => candidate.id === providerId);
  const model = provider ? findConfiguredModel(provider, modelId) : null;
  if (!provider || !model) {
    throw new Error(`Task model ${taskModelKey(providerId, modelId)} is not configured`);
  }

  const user = users.find(candidate => candidate.id === userId) || null;
  if (!user || user.status === 'disabled' || !isAuthorizedForModel(user, provider, model)) {
    throw new Error(`User ${userId} is not authorized for ${taskModelKey(providerId, modelId)}`);
  }

  const descriptor = describeConfiguredModel(provider, model);
  if (!descriptor) {
    throw new Error(`Task model ${taskModelKey(providerId, modelId)} is not supported`);
  }
  return descriptor;
}

export async function resolveTaskModelCatalog(
  models: ModelInfo[],
  user: User | null,
): Promise<TaskModelDescriptor[]> {
  const providers = await getApiProviders();
  const providersById = new Map(providers.map(provider => [provider.id, provider]));

  return models.flatMap(model => {
    const provider = providersById.get(model.providerId);
    if (!provider) return [];
    const configuredModel = findConfiguredModel(provider, model.id);
    if (!configuredModel || !isAuthorizedForModel(user, provider, configuredModel)) return [];
    const descriptor = describeConfiguredModel(provider, { ...configuredModel, ...model });
    return descriptor ? [descriptor] : [];
  });
}
