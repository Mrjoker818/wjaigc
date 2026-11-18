/** Server-side script drafting shared by the planner route and the chat tool. */
import 'server-only';
import { findProviderForFeature } from '@/lib/server-api-config';
import {
  buildDramaScriptPrompt, callDramaLlm, DramaPlannerError, parseDramaScriptResponse,
  type DramaLlmConfig, type DramaScriptInput,
} from './planner';
import { parseDramaProject } from './schema';
import type { DramaProjectV1 } from './types';

/** The planner uses the same chat provider as the video director's shot planning. Like shot planning it is not billed. */
export async function dramaPlannerConfig(signal?: AbortSignal): Promise<DramaLlmConfig | null> {
  const provider = await findProviderForFeature('chat') as unknown as Record<string, unknown> | null;
  if (!provider) return null;
  const models = Array.isArray(provider.selectedModels) ? provider.selectedModels : [];
  const modelId = String(models[0] || provider.defaultChatModel || '');
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
