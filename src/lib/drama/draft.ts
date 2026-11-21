/** Server-side script drafting shared by the planner route and the chat tool. */
import 'server-only';
import { findProviderForFeature, getApiProviders } from '@/lib/server-api-config';
import { isModelAssignedToUser } from '@/lib/model-defaults';
import { getConfiguredModelsForProviders } from '@/lib/model-type-classification';
import { resolveTaskModelCatalogResultFromSnapshot, taskModelKey } from '@/lib/task-core/model-catalog';
import type { User } from '@/lib/user-types';
import {
  buildDramaScriptPrompt, callDramaLlm, DramaPlannerError, parseDramaScriptResponse,
  type DramaLlmConfig, type DramaScriptInput,
} from './planner';
import { parseDramaProject } from './schema';
import type { DramaProjectV1 } from './types';

/** The planner uses the same chat provider as the video director's shot planning. Like shot planning it is not billed. */
export class DramaPlannerSelectionError extends Error {
  readonly code = 'DRAMA_PLANNER_SELECTION_FORBIDDEN';
  constructor() { super('所选编剧模型未启用或未授权，请重新选择供应商和模型'); }
}

export interface DramaPlannerSelection { user: User; providerId?: string; modelId?: string }

async function explicitPlannerProvider(selection: DramaPlannerSelection) {
  // Authorization needs the complete catalog to disambiguate legacy assignments.
  // Resolve the credentials from that same snapshot, before scheduling any work.
  const providers = await getApiProviders();
  const provider = providers.find(item => item.id === selection.providerId);
  const modelId = selection.modelId!;
  if (!provider || provider.isEnabled !== true || !provider.selectedModels?.includes(modelId)) throw new DramaPlannerSelectionError();
  if (!provider.baseUrl || !provider.apiKey) return null;
  const catalog = resolveTaskModelCatalogResultFromSnapshot(getConfiguredModelsForProviders(providers), selection.user, providers);
  const key = taskModelKey(provider.id, modelId);
  if (catalog.effectiveModelTypes.get(key) !== 'chat' || !catalog.authorizedModelKeys.has(key)) throw new DramaPlannerSelectionError();
  return provider;
}

export async function dramaPlannerConfig(signal?: AbortSignal, selection?: DramaPlannerSelection): Promise<DramaLlmConfig | null> {
  const explicit = Boolean(selection && ('providerId' in selection || 'modelId' in selection));
  if (explicit && (!selection?.providerId || !selection.modelId)) throw new DramaPlannerSelectionError();
  const provider = (explicit ? await explicitPlannerProvider(selection!) : await findProviderForFeature('chat')) as unknown as Record<string, unknown> | null;
  if (!provider) return null;
  const models = Array.isArray(provider.selectedModels) ? provider.selectedModels : [];
  const modelId = explicit ? selection!.modelId! : String(models[0] || provider.defaultChatModel || '');
  if (!explicit && selection && selection.user.role !== 'admin' && !isModelAssignedToUser(selection.user.chatModels, String(provider.id || ''), modelId)) return null;
  const baseUrl = String(provider.baseUrl || provider.base_url || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const apiKey = String(provider.apiKey || provider.api_key || '');
  return baseUrl && apiKey && modelId ? { baseUrl, apiKey, modelId, ...(signal ? { signal } : {}) } : null;
}

/** Runs a planner call again once when the reply could not be parsed. */
export async function withPlanRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DramaPlannerError && error.code === 'DRAMA_PLAN_INVALID' && error.retryable) return run();
    throw error;
  }
}

/** Writes a validated drama document from an idea. `retry: false` keeps one call inside tight time limits such as a chat tool's. */
export async function writeDramaScript(
  config: DramaLlmConfig, input: DramaScriptInput, options: { retry?: boolean } = {},
): Promise<DramaProjectV1> {
  const prompt = buildDramaScriptPrompt(input);
  const once = async () => parseDramaScriptResponse(await callDramaLlm(config, [{ role: 'user', content: prompt }]), input);
  return parseDramaProject(options.retry === false ? await once() : await withPlanRetry(once));
}
