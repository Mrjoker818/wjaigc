import { normalizeModelForApi } from '@/lib/model-capabilities';

interface DiscoveredModel {
  id: string;
}

export interface ProviderModelSelectionInput {
  requestedModelId: string;
  selectedModels?: string[];
  discoveredModels?: DiscoveredModel[];
}

export interface ProviderModelSelection {
  modelId: string;
  availableModelIds: string[];
  matched: boolean;
}

export function normalizeProviderModelSelection(
  input: ProviderModelSelectionInput,
): ProviderModelSelection {
  const selectedModels = (input.selectedModels || []).filter(
    (modelId): modelId is string => typeof modelId === 'string' && Boolean(modelId),
  );
  const availableModelIds = selectedModels.length > 0
    ? selectedModels
    : (input.discoveredModels || [])
      .map(model => model.id)
      .filter((modelId): modelId is string => typeof modelId === 'string' && Boolean(modelId));
  const normalized = normalizeModelForApi(input.requestedModelId, {
    providerModels: availableModelIds,
  });
  const canonical = availableModelIds.find(modelId => {
    const candidate = modelId.toLowerCase();
    return candidate === input.requestedModelId.toLowerCase()
      || candidate === normalized.apiModelName.toLowerCase();
  });

  return {
    modelId: canonical || normalized.apiModelName,
    availableModelIds,
    matched: Boolean(canonical),
  };
}
