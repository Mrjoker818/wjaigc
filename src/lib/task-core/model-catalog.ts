import { resolveProfileForModel } from '@/lib/api-compatibility';
import {
  getProviderAspectRatios,
  getQualityLevelOptions,
  getResolutionTierOptions,
} from '@/lib/canvas-generation-group';
import {
  getImageTaskCapabilityDefaults,
} from '@/lib/model-capabilities';
import {
  getApiProviders,
} from '@/lib/server-api-config';
import {
  canonicalizeConfiguredModelId,
  getConfiguredModelsForProvider,
  getConfiguredModelsForProviders,
  resolveEffectiveModelType,
  resolveModelAuthorizationNamespace,
} from '@/lib/model-type-classification';
import { listManagedUsers } from '@/lib/server-auth';
import type { ApiKind, ApiProvider, ModelInfo } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';
import { getVideoModelInfo, resolveVideoCompatProfile } from '@/lib/video-api';
import {
  CAPABILITY_FIELDS,
  ModelCapabilityError,
  taskModelKey,
  type CapabilityField,
  type CapabilityLayer,
  type SupportedOperation,
  type TaskModelDescriptor,
} from './model-capability-contract';
import {
  mergeCapabilityLayers,
  readModelCapabilityOverride,
} from './model-capability-resolution';
import { resolveProviderCapabilityAdapter } from './provider-capability-adapters';

export {
  CAPABILITY_CATALOG_VERSION,
  createTaskModelCatalogIndex,
  taskModelKey,
} from './model-capability-contract';
export type {
  CapabilityField,
  CapabilityLayer,
  CapabilityOverrideV1,
  CapabilitySource,
  ProviderCapabilityOverridesV1,
  SupportedOperation,
  TaskModelDescriptor,
  TaskModelSelection,
} from './model-capability-contract';

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

export interface RedactedModelAuthorizationMigration {
  resolved: Array<{
    legacyModelId: string;
    reason: 'unique';
    count: number;
  }>;
  required: Array<{
    legacyModelId: string;
    reason: 'ambiguous' | 'not-visible';
    count: number;
  }>;
}

export type PublicModelAuthorizationMigration =
  | ModelAuthorizationMigration
  | RedactedModelAuthorizationMigration;

export interface TaskModelCatalogResult {
  taskModelCatalog: TaskModelDescriptor[];
  authorizedModelKeys: Set<string>;
  effectiveModelTypes: Map<string, ApiKind>;
  modelAuthorizationMigration: ModelAuthorizationMigration;
}

type TaskModelKind = TaskModelDescriptor['kind'];
type TaskModelOverride = CapabilityLayer;

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

export function matchesRequestedModelType(
  effectiveType: ApiKind | undefined,
  requestedType: string | null | undefined,
): boolean {
  if (
    !requestedType
    || requestedType === 'all'
    || requestedType === 'general'
    || requestedType === 'universal'
  ) {
    return true;
  }
  return effectiveType === requestedType;
}

export function serializeModelAuthorizationMigration(
  migration: ModelAuthorizationMigration,
  user: User | null,
): PublicModelAuthorizationMigration | ModelAuthorizationMigration {
  if (!user || user.role === 'admin') return migration;

  return {
    resolved: migration.resolved.map(item => ({
      legacyModelId: item.legacyModelId,
      reason: 'unique' as const,
      count: 1,
    })),
    required: migration.required.map(item => ({
      legacyModelId: item.legacyModelId,
      reason: item.reason,
      count: item.candidates.length,
    })),
  };
}

function findConfiguredModel(provider: ApiProvider, modelId: string): ModelInfo | null {
  if (
    !provider.isEnabled
    || !provider.baseUrl
    || !provider.apiKey
  ) {
    return null;
  }

  const canonicalModelId = canonicalizeConfiguredModelId(provider, modelId);
  return getConfiguredModelsForProvider(provider).find(model => (
    model.id === canonicalModelId
  )) || null;
}

function resolveSourceType(provider: ApiProvider, model: ModelInfo): ApiKind {
  return resolveEffectiveModelType(provider, model);
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

type DescriptorWithoutSources = Omit<TaskModelDescriptor, 'capabilitySources'>;

function withFallbackSources(descriptor: DescriptorWithoutSources): TaskModelDescriptor {
  const capabilitySources: Partial<Record<CapabilityField, 'fallback'>> = {};
  for (const field of CAPABILITY_FIELDS) {
    if (descriptor[field] !== undefined) capabilitySources[field] = 'fallback';
  }
  return { ...descriptor, capabilitySources };
}

function descriptorCapabilityLayer(descriptor: TaskModelDescriptor): CapabilityLayer {
  const result: CapabilityLayer = {};
  for (const field of CAPABILITY_FIELDS) {
    if (descriptor[field] === undefined) continue;
    Object.assign(result, {
      [field]: Array.isArray(descriptor[field])
        ? [...descriptor[field]]
        : descriptor[field],
    });
  }
  return result;
}

function createDiscoveryCapabilities(model: ModelInfo): CapabilityLayer {
  const layer: CapabilityLayer = {};
  if (Object.prototype.hasOwnProperty.call(model, 'supportedAspectRatios')) {
    layer.allowedRatios = [...(model.supportedAspectRatios || [])];
  }
  if (Object.prototype.hasOwnProperty.call(model, 'supportedQualities')) {
    layer.qualityOptions = [...(model.supportedQualities || [])];
  }
  if (Object.prototype.hasOwnProperty.call(model, 'maxImages') && model.maxImages !== undefined) {
    layer.maxOutputs = model.maxImages;
  }
  if (
    Object.prototype.hasOwnProperty.call(model, 'maxReferenceImages')
    && model.maxReferenceImages !== undefined
  ) {
    layer.maxReferenceImages = model.maxReferenceImages;
    layer.supportsReferenceImages = model.maxReferenceImages > 0;
  }
  if (Object.prototype.hasOwnProperty.call(model, 'allowedDurationsSeconds')) {
    layer.allowedDurationsSeconds = [...(model.allowedDurationsSeconds || [])];
  }
  if (
    Object.prototype.hasOwnProperty.call(model, 'maxDurationSeconds')
    && model.maxDurationSeconds !== undefined
  ) {
    layer.maxDurationSeconds = model.maxDurationSeconds;
  }
  if (Object.prototype.hasOwnProperty.call(model, 'supportedOperations')) {
    layer.supportedOperations = [...(model.supportedOperations || [])];
    if (model.supportedOperations?.some(operation => (
      operation === 'image-to-image'
      || operation === 'image-to-video'
      || operation === 'first-last-frame'
      || operation === 'multi-reference'
    ))) {
      layer.supportsReferenceImages = true;
    }
  }
  if (Object.prototype.hasOwnProperty.call(model, 'outputKinds')) {
    layer.outputKinds = [...(model.outputKinds || [])];
  }
  return layer;
}

function getVideoSupportedOperations(
  info: ReturnType<typeof getVideoModelInfo>,
): SupportedOperation[] {
  const operations: SupportedOperation[] = ['text-to-video'];
  if (info?.features.firstLastFrame || info?.features.multiReference) {
    operations.push('image-to-video');
  }
  if (info?.features.firstLastFrame) operations.push('first-last-frame');
  if (info?.features.multiReference) operations.push('multi-reference');
  if (info?.features.videoExtend) operations.push('video-extend');
  return operations;
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

  const supportsReferenceImages = kind === 'image'
    ? defaults.supportsReferenceImages
    : true;
  return withFallbackSources({
    providerId: provider.id,
    modelId: model.id,
    kind,
    sourceType,
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
    supportsReferenceImages,
    maxReferenceImages: supportsReferenceImages ? 1 : undefined,
    supportsMask: sourceType === 'imageEdit' || (kind === 'image' && defaults.supportsMask),
    supportedOperations: kind === 'image'
      ? [
          'text-to-image',
          ...(supportsReferenceImages ? ['image-to-image' as const] : []),
        ]
      : undefined,
    outputKinds: sourceType === 'vectorize'
      ? ['svg', 'png']
      : kind === 'upscale'
        ? ['png', 'jpeg', 'webp']
        : [...defaults.outputKinds],
  });
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
    const supportsReferenceImages = Boolean(
      info?.features.firstLastFrame || info?.features.multiReference,
    );
    return withFallbackSources({
      providerId: provider.id,
      modelId: model.id,
      kind,
      sourceType,
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
      allowedDurationsSeconds: [...(info?.features.durations || [])],
      supportsReferenceImages,
      maxReferenceImages: info?.features.multiReference
        ? 4
        : info?.features.firstLastFrame
          ? 2
          : undefined,
      supportsMask: false,
      supportedOperations: getVideoSupportedOperations(info),
      outputKinds: ['mp4'],
    });
  }

  const protocol = provider.requestStyle
    || provider.advancedParams?.compatProfile
    || (kind === 'chat' ? 'chat-completions' : sourceType);
  const shared = {
    providerId: provider.id,
    modelId: model.id,
    sourceType,
    protocol,
    allowedRatios: [] as string[],
    allowedSizes: [] as string[],
    qualityOptions: [] as string[],
    maxOutputs: model.maxImages ?? 1,
    supportsMask: false,
  };

  switch (kind) {
    case 'chat':
      return withFallbackSources({
        ...shared,
        kind,
        executionMode: 'sync',
        supportsVision: sourceType === 'vlm',
        supportsReferenceImages: sourceType === 'vlm',
        outputKinds: ['text'],
      });
    case 'layer':
      return withFallbackSources({
        ...shared,
        kind,
        executionMode: 'async',
        supportsReferenceImages: true,
        outputKinds: ['png', 'psd', 'json'],
      });
    case '3d':
      return withFallbackSources({
        ...shared,
        kind,
        executionMode: 'async',
        supportsReferenceImages: true,
        outputKinds: ['glb', 'obj', 'fbx', 'usdz', 'stl'],
      });
  }
}

function readTaskModelOverride(provider: ApiProvider, modelId: string): TaskModelOverride {
  if (
    !provider.advancedParams
    || !Object.prototype.hasOwnProperty.call(
      provider.advancedParams,
      'taskModelCapabilities',
    )
  ) {
    return {};
  }
  return readModelCapabilityOverride(
    provider.advancedParams.taskModelCapabilities,
    modelId,
  );
}

function describeConfiguredModel(
  provider: ApiProvider,
  model: ModelInfo,
): TaskModelDescriptor | null {
  const descriptor = createBaseDescriptor(provider, model);
  if (!descriptor) return null;

  const merged = mergeCapabilityLayers({
    fallback: descriptorCapabilityLayer(descriptor),
    discovery: createDiscoveryCapabilities(model),
    adapter: resolveProviderCapabilityAdapter(provider, model),
    admin: readTaskModelOverride(provider, model.id),
  });
  return {
    ...descriptor,
    ...merged.value,
    providerId: provider.id,
    modelId: model.id,
    capabilitySources: merged.sources,
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
  const exactModelIds = new Set<string>();
  const migration = emptyMigration();
  const seenAssignments = new Set<string>();
  for (const assignment of allowedModels) {
    if (typeof assignment !== 'string' || seenAssignments.has(assignment)) continue;
    seenAssignments.add(assignment);

    if (assignment.includes('::')) {
      const separatorIndex = assignment.indexOf('::');
      const providerId = assignment.slice(0, separatorIndex);
      const assignedModelId = assignment.slice(separatorIndex + 2);
      const provider = entries.find(entry => entry.provider.id === providerId)?.provider;
      const canonicalAssignment = provider
        ? taskModelKey(
            providerId,
            canonicalizeConfiguredModelId(provider, assignedModelId),
          )
        : assignment;
      if (visibleKeys.has(canonicalAssignment)) exactModelIds.add(canonicalAssignment);
      continue;
    }

    const candidates = entries.flatMap(entry => {
      const canonicalAssignment = canonicalizeConfiguredModelId(
        entry.provider,
        assignment,
      );
      return canonicalAssignment === entry.model.id
        ? [taskModelKey(entry.provider.id, entry.model.id)]
        : [];
    });
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
      authorizedModelKeys: new Set(entries.map(entry => (
        taskModelKey(entry.provider.id, entry.model.id)
      ))),
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
    hasRequiredPermission(user, entry.sourceType)
  ));
  const imageEntries = permissionEligibleEntries.filter(entry => (
    entry.descriptor
    && resolveModelAuthorizationNamespace(entry.sourceType) === 'image'
  ));
  const chatEntries = permissionEligibleEntries.filter(entry => (
    entry.descriptor
    && resolveModelAuthorizationNamespace(entry.sourceType) === 'chat'
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
    if (!hasRequiredPermission(user, entry.sourceType)) continue;

    const authorizationNamespace = resolveModelAuthorizationNamespace(entry.sourceType);
    const assignments = authorizationNamespace === 'image'
      ? imageAssignments
      : authorizationNamespace === 'chat'
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
    if (entry.descriptor) taskModelCatalog.push(entry.descriptor);
  }

  return {
    taskModelCatalog,
    authorizedModelKeys,
    effectiveModelTypes,
    modelAuthorizationMigration,
  };
}

export function resolveTaskModelFromProviders(
  providers: ApiProvider[],
  providerId: string,
  modelId: string,
  user: User,
): TaskModelDescriptor {
  const provider = providers.find(candidate => candidate.id === providerId);
  const canonicalModelId = provider
    ? canonicalizeConfiguredModelId(provider, modelId)
    : modelId;
  const model = provider ? findConfiguredModel(provider, canonicalModelId) : null;
  if (!provider || !model) {
    throw new ModelCapabilityError(
      'MODEL_NOT_CONFIGURED',
      `Task model ${taskModelKey(providerId, modelId)} is not configured`,
      { providerId, modelId },
    );
  }

  if (user.status === 'disabled') {
    throw new ModelCapabilityError(
      'MODEL_NOT_AUTHORIZED',
      `User ${user.id} is not authorized for ${taskModelKey(providerId, modelId)}`,
      { providerId, modelId, userId: user.id },
    );
  }

  const result = buildTaskModelCatalogResult(
    getConfiguredModelsForProviders(providers),
    user,
    providers,
  );
  const key = taskModelKey(providerId, canonicalModelId);
  const migrationRequired = result.modelAuthorizationMigration.required.find(item => (
    item.legacyModelId === canonicalModelId && item.candidates.includes(key)
  ));
  if (!result.authorizedModelKeys.has(key)) {
    if (migrationRequired) {
      throw new ModelCapabilityError(
        'MODEL_NOT_AUTHORIZED',
        `Model authorization migration required for ${canonicalModelId}: ${migrationRequired.reason}`,
        { providerId, modelId: canonicalModelId, reason: migrationRequired.reason },
      );
    }
    throw new ModelCapabilityError(
      'MODEL_NOT_AUTHORIZED',
      `User ${user.id} is not authorized for ${key}`,
      { providerId, modelId: canonicalModelId, userId: user.id },
    );
  }

  const descriptor = result.taskModelCatalog.find(candidate => (
    candidate.providerId === providerId && candidate.modelId === canonicalModelId
  ));
  if (!descriptor) {
    throw new ModelCapabilityError(
      'MODEL_CAPABILITY_UNAVAILABLE',
      `Task model ${taskModelKey(providerId, modelId)} is not supported`,
      { providerId, modelId: canonicalModelId },
    );
  }
  return descriptor;
}

export async function resolveTaskModelForUser(
  providerId: string,
  modelId: string,
  user: User,
): Promise<TaskModelDescriptor> {
  const providers = await getApiProviders();
  return resolveTaskModelFromProviders(providers, providerId, modelId, user);
}

export async function resolveTaskModel(
  providerId: string,
  modelId: string,
  userId: string,
): Promise<TaskModelDescriptor> {
  const [providers, users] = await Promise.all([getApiProviders(), listManagedUsers()]);
  const user = users.find(candidate => candidate.id === userId);
  if (!user) {
    throw new ModelCapabilityError(
      'MODEL_NOT_AUTHORIZED',
      `User ${userId} is not authorized for ${taskModelKey(providerId, modelId)}`,
      { providerId, modelId, userId },
    );
  }
  return resolveTaskModelFromProviders(providers, providerId, modelId, user);
}

export async function resolveTaskModelCatalog(
  models: ModelInfo[],
  user: User | null,
): Promise<TaskModelDescriptor[]> {
  return (await resolveTaskModelCatalogResult(models, user)).taskModelCatalog;
}

export function resolveTaskModelCatalogResultFromSnapshot(
  models: ModelInfo[],
  user: User | null,
  providers: ApiProvider[],
): TaskModelCatalogResult {
  return buildTaskModelCatalogResult(models, user, providers);
}

export async function resolveTaskModelCatalogResult(
  _models: ModelInfo[],
  user: User | null,
): Promise<TaskModelCatalogResult> {
  const providers = await getApiProviders();
  return buildTaskModelCatalogResult(
    getConfiguredModelsForProviders(providers),
    user,
    providers,
  );
}
