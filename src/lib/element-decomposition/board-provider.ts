import { dbGetUserById } from '@/lib/db-storage';
import { isModelAssignedToUser } from '@/lib/model-defaults';
import { findProviderById } from '@/lib/server-api-config';
import type { ApiProvider } from '@/lib/universal-api-types';

type ElementBoardProviderErrorCode =
  | 'ELEMENT_BOARD_PROVIDER_REQUIRED'
  | 'ELEMENT_BOARD_PROVIDER_UNAVAILABLE'
  | 'ELEMENT_BOARD_MODEL_UNSUPPORTED'
  | 'ELEMENT_BOARD_MODEL_FORBIDDEN';

export class ElementBoardProviderError extends Error {
  readonly code: ElementBoardProviderErrorCode;

  constructor(code: ElementBoardProviderErrorCode, message: string) {
    super(message);
    this.name = 'ElementBoardProviderError';
    this.code = code;
  }
}

export interface ResolvedElementBoardProvider {
  provider: ApiProvider;
  modelId: string;
}

function configuredModelIds(provider: ApiProvider): string[] {
  if (provider.selectedModels?.length) return provider.selectedModels;
  return (provider.discoveredModels || []).map((model) => model.id);
}

export async function resolveElementBoardProvider(input: {
  userId: string;
  userRole: string;
  providerId?: string;
  modelId?: string;
}): Promise<ResolvedElementBoardProvider> {
  const providerId = input.providerId?.trim();
  const modelId = input.modelId?.trim();
  if (!providerId || !modelId) {
    throw new ElementBoardProviderError(
      'ELEMENT_BOARD_PROVIDER_REQUIRED',
      'Please select an image-edit provider and model for element board generation',
    );
  }

  const provider = await findProviderById(providerId);
  const providerType = provider?.modelType || provider?.type;
  if (
    !provider
    || !provider.isEnabled
    || !provider.apiKey
    || !new Set(['image', 'imageEdit', 'universal', 'general']).has(providerType || '')
  ) {
    throw new ElementBoardProviderError(
      'ELEMENT_BOARD_PROVIDER_UNAVAILABLE',
      'The selected element board provider is unavailable',
    );
  }

  if (!configuredModelIds(provider).includes(modelId)) {
    throw new ElementBoardProviderError(
      'ELEMENT_BOARD_MODEL_UNSUPPORTED',
      'The selected element board model is not configured on this provider',
    );
  }

  if (input.userRole !== 'admin') {
    const user = await dbGetUserById(input.userId);
    const stored = user as (typeof user & {
      apiPermissions?: Record<string, boolean>;
      api_permissions?: Record<string, boolean>;
      imageModels?: string[];
      image_models?: string[];
    }) | null;
    const permissions = stored?.apiPermissions || stored?.api_permissions;
    const imageModels = stored?.imageModels || stored?.image_models;
    const canEditImages = permissions?.imageEdit === true || permissions?.image === true;
    if (
      !stored
      || !canEditImages
      || !isModelAssignedToUser(imageModels, provider.id, modelId)
    ) {
      throw new ElementBoardProviderError(
        'ELEMENT_BOARD_MODEL_FORBIDDEN',
        'The selected element board model is not assigned to the current user',
      );
    }
  }

  return { provider, modelId };
}
