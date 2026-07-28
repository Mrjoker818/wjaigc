import { dbGetUserById } from '@/lib/db-storage';
import { isModelAssignedToUser } from '@/lib/model-defaults';
import { findProviderById } from '@/lib/server-api-config';
import type { ApiProvider } from '@/lib/universal-api-types';

type LayerProviderErrorCode =
  | 'LAYER_PROVIDER_REQUIRED'
  | 'LAYER_PROVIDER_UNAVAILABLE'
  | 'LAYER_MODEL_UNSUPPORTED'
  | 'LAYER_MODEL_FORBIDDEN';

export class LayerProviderError extends Error {
  readonly code: LayerProviderErrorCode;

  constructor(code: LayerProviderErrorCode, message: string) {
    super(message);
    this.name = 'LayerProviderError';
    this.code = code;
  }
}

export interface ResolveLayerProviderInput {
  userId: string;
  userRole: string;
  providerId?: string;
  modelId?: string;
}

export interface ResolvedLayerProvider {
  provider: ApiProvider;
  configuredModelId: string;
  requestModelId: 'image-layered';
}

function normalizeLayerModelId(modelId: string): string {
  return modelId.trim().toLowerCase().replace(/_/g, '-');
}

function configuredModelIds(provider: ApiProvider): string[] {
  if (provider.selectedModels?.length) return provider.selectedModels;
  return (provider.discoveredModels || []).map((model) => model.id);
}

export async function resolveLayerProvider(
  input: ResolveLayerProviderInput,
): Promise<ResolvedLayerProvider> {
  const providerId = input.providerId?.trim();
  const configuredModelId = input.modelId?.trim();
  if (!providerId || !configuredModelId) {
    throw new LayerProviderError(
      'LAYER_PROVIDER_REQUIRED',
      '请选择明确的图片分层提供商和模型',
    );
  }

  const provider = await findProviderById(providerId);
  if (
    !provider
    || !provider.isEnabled
    || !provider.apiKey
    || (provider.modelType || provider.type) !== 'layer'
  ) {
    throw new LayerProviderError(
      'LAYER_PROVIDER_UNAVAILABLE',
      '所选图片分层提供商不可用',
    );
  }

  const normalizedRequestedModel = normalizeLayerModelId(configuredModelId);
  const matchedConfiguredModel = configuredModelIds(provider).find(
    (modelId) => normalizeLayerModelId(modelId) === normalizedRequestedModel,
  );
  if (!matchedConfiguredModel || normalizedRequestedModel !== 'image-layered') {
    throw new LayerProviderError(
      'LAYER_MODEL_UNSUPPORTED',
      '所选提供商未配置 Pear Image-Layered 模型',
    );
  }

  if (input.userRole !== 'admin') {
    const user = await dbGetUserById(input.userId);
    const storedUser = user as (typeof user & {
      apiPermissions?: Record<string, boolean>;
      imageModels?: string[];
      api_permissions?: Record<string, boolean>;
      image_models?: string[];
    }) | null;
    const apiPermissions = storedUser?.apiPermissions || storedUser?.api_permissions;
    const imageModels = storedUser?.imageModels || storedUser?.image_models;
    if (
      !storedUser
      || apiPermissions?.layer !== true
      || !isModelAssignedToUser(imageModels, provider.id, matchedConfiguredModel)
    ) {
      throw new LayerProviderError(
        'LAYER_MODEL_FORBIDDEN',
        '当前用户未获授权使用所选图片分层模型',
      );
    }
  }

  return {
    provider,
    configuredModelId: matchedConfiguredModel,
    requestModelId: 'image-layered',
  };
}
