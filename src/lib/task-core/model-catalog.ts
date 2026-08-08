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

export interface ModelAuthorizationMigration {
  resolved: Array<{
    legacyModelId: string;
    exactModelId: string;
  }>;
  required: Array<{
    legacyModelId: string;
    reason: 'ambiguous' | 'not-visible';
    candidates: string[];
  }>;
}

export interface TaskModelCatalogResult {
  taskModelCatalog: TaskModelDescriptor[];
  authorizedModelKeys: Set<string>;
  effectiveModelTypes: Map<string, ApiKind>;
  modelAuthorizationMigration: ModelAuthorizationMigration;
}

type TaskModelKind = TaskModelDescriptor['kind'];
type TaskModelOverride = Partial<Omit<
  TaskModelDescriptor,
  'providerId' | 'modelId' | 'kind'
>>;

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
const MAX_OVERRIDE_ARRAY_ITEMS = 32;
const MAX_OVERRIDE_ARRAY_ITEM_LENGTH = 128;
const MAX_OVERRIDE_PROTOCOL_LENGTH = 128;
const MAX_OVERRIDE_OUTPUTS = 4;
const MAX_OVERRIDE_DURATION_SECONDS = 3600;

interface CatalogEntry {
  provider: ApiProvider;
  model: ModelInfo;
  sourceType: ApiKind;
  descriptor: TaskModelDescriptor | null;
}

interface AssignmentResolution {
  unrestricted: boolean;
  exactModelIds: Set<string>;
  migration: ModelAuthorizationMigration;
}

export function taskModelKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
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

function inferGeneralModelType(modelId: string): ReturnType<typeof inferModelType> {
  const family = classifyModelFamily(modelId);
  return inferModelType(modelId, family === 'other' ? 'chat' : 'image');
}

function resolveSourceType(provider: ApiProvider, model: ModelInfo): ApiKind {
  const providerType = provider.modelType || provider.type;
  if (providerType !== 'general' && providerType !== 'universal') {
    return providerType;
  }

  const discoveredFallback: Parameters<typeof inferModelType>[1] = model.type
    && model.type !== 'general'
    && model.type !== 'universal'
    ? (model.type === 'imageEdit' ? 'image' : model.type)
    : inferGeneralModelType(model.id);
  return inferModelType(model.id, discoveredFallback);
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
  if (!Array.isArray(value)) return undefined;

  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim();
    if (
      !normalized
      || normalized.length > MAX_OVERRIDE_ARRAY_ITEM_LENGTH
      || seen.has(normalized)
    ) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= MAX_OVERRIDE_ARRAY_ITEMS) break;
  }
  return result;
}

function readTaskModelOverride(provider: ApiProvider, modelId: string): TaskModelOverride {
  const advancedParams = provider.advancedParams;
  if (
    !advancedParams
    || !hasOwn(advancedParams, 'taskModelCapabilities')
  ) {
    return {};
  }
  const raw = advancedParams.taskModelCapabilities;
  if (typeof raw !== 'string' || !raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    if (!hasOwn(parsed, modelId)) return {};
    const candidate = (parsed as Record<string, unknown>)[modelId];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
    const value = candidate as Record<string, unknown>;
    const override: TaskModelOverride = {};

    if (hasOwn(value, 'protocol') && typeof value.protocol === 'string') {
      const protocol = value.protocol.trim();
      if (protocol && protocol.length <= MAX_OVERRIDE_PROTOCOL_LENGTH) {
        override.protocol = protocol;
      }
    }
    if (
      hasOwn(value, 'executionMode')
      && typeof value.executionMode === 'string'
      && EXECUTION_MODES.has(value.executionMode as TaskModelDescriptor['executionMode'])
    ) {
      override.executionMode = value.executionMode as TaskModelDescriptor['executionMode'];
    }

    const allowedRatios = hasOwn(value, 'allowedRatios')
      ? readStringArray(value.allowedRatios)
      : undefined;
    if (allowedRatios !== undefined) override.allowedRatios = allowedRatios;
    const allowedSizes = hasOwn(value, 'allowedSizes')
      ? readStringArray(value.allowedSizes)
      : undefined;
    if (allowedSizes !== undefined) override.allowedSizes = allowedSizes;
    const qualityOptions = hasOwn(value, 'qualityOptions')
      ? readStringArray(value.qualityOptions)
      : undefined;
    if (qualityOptions !== undefined) override.qualityOptions = qualityOptions;
    const outputKinds = hasOwn(value, 'outputKinds')
      ? readStringArray(value.outputKinds)
      : undefined;
    if (outputKinds !== undefined) override.outputKinds = outputKinds;

    if (
      hasOwn(value, 'maxOutputs')
      && typeof value.maxOutputs === 'number'
      && Number.isFinite(value.maxOutputs)
      && value.maxOutputs >= 1
      && value.maxOutputs <= MAX_OVERRIDE_OUTPUTS
    ) {
      override.maxOutputs = Math.floor(value.maxOutputs);
    }
    if (
      hasOwn(value, 'maxDurationSeconds')
      && typeof value.maxDurationSeconds === 'number'
      && Number.isFinite(value.maxDurationSeconds)
      && value.maxDurationSeconds >= 1
      && value.maxDurationSeconds <= MAX_OVERRIDE_DURATION_SECONDS
    ) {
      override.maxDurationSeconds = Math.floor(value.maxDurationSeconds);
    }
    if (
      hasOwn(value, 'supportsReferenceImages')
      && typeof value.supportsReferenceImages === 'boolean'
    ) {
      override.supportsReferenceImages = value.supportsReferenceImages;
    }
    if (hasOwn(value, 'supportsMask') && typeof value.supportsMask === 'boolean') {
      override.supportsMask = value.supportsMask;
    }

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

function emptyMigration(): ModelAuthorizationMigration {
  return { resolved: [], required: [] };
}

function mergeMigration(
  target: ModelAuthorizationMigration,
  source: ModelAuthorizationMigration,
): void {
  target.resolved.push(...source.resolved);
  target.required.push(...source.required);
}

function resolveAssignments(
  allowedModels: string[] | undefined,
  entries: CatalogEntry[],
): AssignmentResolution {
  if (!allowedModels?.length) {
    return {
      unrestricted: true,
      exactModelIds: new Set(),
      migration: emptyMigration(),
    };
  }

  const visibleKeys = new Set(entries.map(entry => (
    taskModelKey(entry.provider.id, entry.model.id)
  )));
  const candidatesByModelId = new Map<string, string[]>();
  for (const entry of entries) {
    const exactModelId = taskModelKey(entry.provider.id, entry.model.id);
    const candidates = candidatesByModelId.get(entry.model.id) || [];
    if (!candidates.includes(exactModelId)) candidates.push(exactModelId);
    candidatesByModelId.set(entry.model.id, candidates);
  }

  const exactModelIds = new Set<string>();
  const migration = emptyMigration();
  const seenAssignments = new Set<string>();
  for (const assignment of allowedModels) {
    if (typeof assignment !== 'string' || seenAssignments.has(assignment)) continue;
    seenAssignments.add(assignment);

    if (assignment.includes('::')) {
      if (visibleKeys.has(assignment)) exactModelIds.add(assignment);
      continue;
    }

    const candidates = candidatesByModelId.get(assignment) || [];
    if (candidates.length === 1) {
      exactModelIds.add(candidates[0]);
      migration.resolved.push({
        legacyModelId: assignment,
        exactModelId: candidates[0],
      });
      continue;
    }

    migration.required.push({
      legacyModelId: assignment,
      reason: candidates.length > 1 ? 'ambiguous' : 'not-visible',
      candidates,
    });
  }

  return { unrestricted: false, exactModelIds, migration };
}

function configuredModelsForProviders(providers: ApiProvider[]): ModelInfo[] {
  return providers.flatMap(provider => {
    if (!provider.isEnabled || !provider.baseUrl || !provider.apiKey) return [];
    const modelIds = provider.selectedModels?.length
      ? provider.selectedModels
      : (provider.discoveredModels || []).map(model => model.id);
    return modelIds.map(modelId => {
      const discovered = provider.discoveredModels?.find(model => model.id === modelId);
      return discovered ? {
        ...discovered,
        providerId: provider.id,
      } : {
        id: modelId,
        name: modelId,
        providerId: provider.id,
        type: provider.modelType || provider.type,
      };
    });
  });
}

function buildTaskModelCatalogResult(
  models: ModelInfo[],
  user: User | null,
  providers: ApiProvider[],
): TaskModelCatalogResult {
  const providersById = new Map(providers.map(provider => [provider.id, provider]));
  const entries = models.flatMap((model): CatalogEntry[] => {
    const provider = providersById.get(model.providerId);
    if (!provider) return [];
    const configuredModel = findConfiguredModel(provider, model.id);
    if (!configuredModel) return [];
    const mergedModel = { ...configuredModel, ...model };
    const sourceType = resolveSourceType(provider, mergedModel);
    return [{
      provider,
      model: mergedModel,
      sourceType,
      descriptor: describeConfiguredModel(provider, mergedModel),
    }];
  });

  const effectiveModelTypes = new Map(entries.map(entry => [
    taskModelKey(entry.provider.id, entry.model.id),
    entry.sourceType,
  ]));
  if (!user || user.role === 'admin') {
    return {
      taskModelCatalog: entries.flatMap(entry => entry.descriptor ? [entry.descriptor] : []),
      authorizedModelKeys: new Set(models.map(model => taskModelKey(model.providerId, model.id))),
      effectiveModelTypes,
      modelAuthorizationMigration: emptyMigration(),
    };
  }
  if (user.status === 'disabled') {
    return {
      taskModelCatalog: [],
      authorizedModelKeys: new Set(),
      effectiveModelTypes,
      modelAuthorizationMigration: emptyMigration(),
    };
  }

  const permissionEligibleEntries = entries.filter(entry => (
    !entry.descriptor || hasRequiredPermission(user, entry.sourceType)
  ));
  const imageEntries = permissionEligibleEntries.filter(entry => (
    entry.descriptor && IMAGE_AUTH_TYPES.has(entry.sourceType)
  ));
  const chatEntries = permissionEligibleEntries.filter(entry => (
    entry.descriptor && CHAT_AUTH_TYPES.has(entry.sourceType)
  ));
  const imageAssignments = resolveAssignments(user.imageModels, imageEntries);
  const chatAssignments = resolveAssignments(user.chatModels, chatEntries);
  const modelAuthorizationMigration = emptyMigration();
  mergeMigration(modelAuthorizationMigration, imageAssignments.migration);
  mergeMigration(modelAuthorizationMigration, chatAssignments.migration);

  const authorizedModelKeys = new Set<string>();
  const taskModelCatalog: TaskModelDescriptor[] = [];
  for (const entry of entries) {
    const key = taskModelKey(entry.provider.id, entry.model.id);
    if (!entry.descriptor) {
      authorizedModelKeys.add(key);
      continue;
    }
    if (!hasRequiredPermission(user, entry.sourceType)) continue;

    const assignments = IMAGE_AUTH_TYPES.has(entry.sourceType)
      ? imageAssignments
      : CHAT_AUTH_TYPES.has(entry.sourceType)
        ? chatAssignments
        : null;
    if (
      assignments
      && !assignments.unrestricted
      && !assignments.exactModelIds.has(key)
    ) {
      continue;
    }

    authorizedModelKeys.add(key);
    taskModelCatalog.push(entry.descriptor);
  }

  return {
    taskModelCatalog,
    authorizedModelKeys,
    effectiveModelTypes,
    modelAuthorizationMigration,
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
  if (!user || user.status === 'disabled') {
    throw new Error(`User ${userId} is not authorized for ${taskModelKey(providerId, modelId)}`);
  }

  const result = buildTaskModelCatalogResult(
    configuredModelsForProviders(providers),
    user,
    providers,
  );
  const key = taskModelKey(providerId, modelId);
  const migrationRequired = result.modelAuthorizationMigration.required.find(item => (
    item.legacyModelId === modelId && item.candidates.includes(key)
  ));
  if (!result.authorizedModelKeys.has(key)) {
    if (migrationRequired) {
      throw new Error(
        `Model authorization migration required for ${modelId}: ${migrationRequired.reason}`,
      );
    }
    throw new Error(`User ${userId} is not authorized for ${key}`);
  }

  const descriptor = result.taskModelCatalog.find(candidate => (
    candidate.providerId === providerId && candidate.modelId === modelId
  ));
  if (!descriptor) {
    throw new Error(`Task model ${taskModelKey(providerId, modelId)} is not supported`);
  }
  return descriptor;
}

export async function resolveTaskModelCatalog(
  models: ModelInfo[],
  user: User | null,
): Promise<TaskModelDescriptor[]> {
  return (await resolveTaskModelCatalogResult(models, user)).taskModelCatalog;
}

export async function resolveTaskModelCatalogResult(
  models: ModelInfo[],
  user: User | null,
): Promise<TaskModelCatalogResult> {
  const providers = await getApiProviders();
  return buildTaskModelCatalogResult(models, user, providers);
}
