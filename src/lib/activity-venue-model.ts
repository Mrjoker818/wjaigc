import type { ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';
import { getConfiguredModelsForProvider } from '@/lib/model-type-classification';
import { resolveTaskModelFromProviders } from '@/lib/task-core/model-catalog';
import { ModelCapabilityError } from '@/lib/task-core/model-capability-contract';

type VenueModelSelection =
  | { ok: true; provider: ApiProvider; modelId: string }
  | { ok: false; status: 400 | 403; error: string };

export function selectActivityVenueModel(
  providers: ApiProvider[], user: User, providerId: unknown, model: unknown,
): VenueModelSelection {
  if ((providerId !== undefined && typeof providerId !== 'string') || (model !== undefined && typeof model !== 'string')) {
    return { ok: false, status: 400, error: '供应商或模型参数无效' };
  }
  const requestedProviderId = typeof providerId === 'string' ? providerId.trim() : '';
  const requestedModel = typeof model === 'string' ? model.trim() : '';
  const available = providers.filter(p => p.isEnabled && p.baseUrl && p.apiKey
    && ['chat', 'vlm', 'universal', 'general'].includes(p.modelType || p.type));
  const explicitProvider = requestedProviderId ? available.find(p => p.id === requestedProviderId) : undefined;
  if (requestedProviderId && !explicitProvider) return { ok: false, status: 400, error: '未找到所选供应商' };
  const ordered = explicitProvider ? [explicitProvider] : [
    ...available.filter(p => p.isDefault),
    ...available.filter(p => !p.isDefault),
  ];
  if (ordered.length === 0) return { ok: false, status: 400, error: '未找到可用的模型，请在管理员后台配置' };

  const authorized: Array<{ provider: ApiProvider; modelId: string }> = [];
  for (const provider of ordered) {
    const candidates = requestedModel ? [requestedModel] : getConfiguredModelsForProvider(provider).map(item => item.id);
    for (const candidate of candidates) {
      try {
        const descriptor = resolveTaskModelFromProviders(providers, provider.id, candidate, user);
        if (descriptor.kind === 'chat') authorized.push({ provider, modelId: descriptor.modelId });
      } catch (error) {
        if (!(error instanceof ModelCapabilityError)) throw error;
      }
    }
  }
  if (authorized.length === 0) return { ok: false, status: 403, error: '所选模型不可用或未获得授权' };
  if (requestedModel && !explicitProvider && authorized.length > 1) {
    return { ok: false, status: 400, error: '存在同名模型，请指定供应商' };
  }
  return { ok: true, ...authorized[0] };
}
