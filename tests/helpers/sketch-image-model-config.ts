import type { ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';
import { getConfiguredModelsForProviders } from '@/lib/model-type-classification';
import { resolveTaskModelCatalogResultFromSnapshot } from '@/lib/task-core/model-catalog';
import { createConfiguredSketchImageDependencies } from '@/lib/sketch-to-code/configured-image-dependencies';
import type { SketchImageRouting } from '@/lib/sketch-to-code/image-execution';

/** Synthetic selected-model configuration, never an external service or authorization stub. */
export function sketchImageModelConfig(visionModelId: string, imageModelId: string): {
  providers: ApiProvider[]; rows: Record<string, unknown>[];
} {
  const providers: ApiProvider[] = (['vision', 'image'] as const).map((role, index) => {
    const modelId = role === 'vision' ? visionModelId : imageModelId;
    return {
      id: `${role}-provider`, name: `${role} fixture`, displayName: `${role} fixture`,
      baseUrl: `https://${role}.example.invalid/v1`, apiKey: `synthetic-${role}-key`, isEnabled: true,
      type: role === 'vision' ? 'chat' : 'image', modelType: role === 'vision' ? 'chat' : 'image',
      requestStyle: role === 'vision' ? 'chat-completions' : 'images-generations', selectedModels: [modelId],
      advancedParams: { compatProfile: 'openai', taskModelCapabilities: JSON.stringify({ version: 1, models: {
        [modelId]: role === 'vision'
          ? { protocol: 'chat-completions', executionMode: 'sync', supportsVision: true }
          : { protocol: 'openai', executionMode: 'async', allowedRatios: ['1:1', '4:3'],
            supportsReferenceImages: true, maxReferenceImages: 1, maxOutputs: 1,
            supportedOperations: ['image-to-image'], outputKinds: ['image'] },
      } }) },
      isDefault: false, createdAt: 1, updatedAt: 1, discoveredModels: [], sortOrder: index,
      balanceUsername: '', balancePassword: '',
    };
  });
  const rows = providers.map(provider => ({
    id: provider.id, name: provider.name, display_name: provider.displayName, base_url: provider.baseUrl,
    api_key: provider.apiKey, is_enabled: provider.isEnabled, type: provider.type, model_type: provider.modelType,
    request_style: provider.requestStyle, selected_models: provider.selectedModels, advanced_params: provider.advancedParams,
    is_default: provider.isDefault, created_at: provider.createdAt, updated_at: provider.updatedAt,
    connection_status: null, discovered_models: [], sort_order: provider.sortOrder, balance_username: '', balance_password: '',
  }));
  return { providers, rows };
}

/** Freeze a genuine configured factory baseline; no analysis, generation or fetch is invoked. */
export async function sketchImageFixtureRouting(providers: ApiProvider[]): Promise<Readonly<SketchImageRouting>> {
  const user: User = { id: 'actor', name: 'Actor', status: 'active', role: 'user', createdAt: 1, updatedAt: 1 };
  const models = resolveTaskModelCatalogResultFromSnapshot(getConfiguredModelsForProviders(providers), user, providers).taskModelCatalog;
  const configured = createConfiguredSketchImageDependencies({
    authorizeProject: async () => ({ kind: 'personal', actorUserId: 'actor', ownerId: 'actor', projectId: 'project' }),
    resolveTaskModel: async (providerId, modelId) => {
      const model = models.find(item => item.providerId === providerId && item.modelId === modelId);
      if (!model) throw new Error('FIXTURE_MODEL_NOT_CONFIGURED');
      return model;
    },
    findProviderById: async id => providers.find(provider => provider.id === id) || null,
    transport: async () => { throw new Error('FIXTURE_NETWORK_FORBIDDEN'); }, requestId: 'model-fixture',
  });
  await configured.generation.authorizeProject('actor', 'project');
  for (const provider of providers) await configured.generation.resolveTaskModel(provider.id, provider.selectedModels![0], 'actor');
  return configured.routing();
}
