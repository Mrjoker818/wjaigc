import 'server-only';
import { getApiProviders, normalizeApiBaseUrl } from '@/lib/server-api-config';
import { listManagedUsers } from '@/lib/server-auth';
import { canonicalizeConfiguredModelId, getConfiguredModelsForProviders } from '@/lib/model-type-classification';
import { resolveTaskModelCatalogResultFromSnapshot, taskModelKey } from './model-catalog';
import type { ApiKind, ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';

/** Request-local credentials; never serialize this plan into tasks or responses. */
export interface ImageEditModelCandidate {
  providerId: string;
  model: string;
  apiKey: string;
  apiBaseUrl: string;
  source: string;
  providerType: ApiKind;
  advancedParams?: Record<string, string>;
  provider: ApiProvider;
}
export interface ImageEditModelPlan {
  requestedModelId: string;
  requestedProviderId: string;
  explicit: boolean;
  candidates: ImageEditModelCandidate[];
  dedicatedRemoveBgCandidates: ImageEditModelCandidate[];
  visionCandidates: ImageEditModelCandidate[];
  enhancementCandidate?: ImageEditModelCandidate;
}
export class ImageEditModelPlanError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = 'ImageEditModelPlanError';
  }
}
function selection(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new ImageEditModelPlanError(400, 'IMAGE_EDIT_INVALID_MODEL_SELECTION');
  return value.trim();
}
function splitSelection(value: string): { providerId: string; model: string } {
  const parts = value.split('::');
  if (parts.length === 1) return { providerId: '', model: value };
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    throw new ImageEditModelPlanError(400, 'IMAGE_EDIT_INVALID_MODEL_SELECTION');
  }
  return { providerId: parts[0].trim(), model: parts[1].trim() };
}

export async function prepareImageEditModelPlan(input: {
  action: string;
  model?: unknown;
  providerId?: unknown;
  upscaleModel?: unknown;
  enableQualityEnhance?: boolean;
  enhanceModel?: unknown;
  enhanceProviderId?: unknown;
  user: User;
  source: 'cookie' | 'desktop-token' | 'internal';
}): Promise<ImageEditModelPlan> {
  const model = selection(input.model);
  const providerId = selection(input.providerId);
  const upscaleModel = selection(input.upscaleModel);
  const chosen = splitSelection(input.action === 'upscale' && upscaleModel ? upscaleModel : model);
  if (chosen.providerId && providerId && chosen.providerId !== providerId) {
    throw new ImageEditModelPlanError(400, 'IMAGE_EDIT_MODEL_PROVIDER_MISMATCH');
  }
  const requestedProviderId = providerId || chosen.providerId;
  const enhanceModel = input.enableQualityEnhance ? selection(input.enhanceModel) : '';
  const enhanceProviderId = input.enableQualityEnhance ? selection(input.enhanceProviderId) : '';
  if (enhanceProviderId && !enhanceModel) {
    throw new ImageEditModelPlanError(400, 'IMAGE_EDIT_INVALID_ENHANCEMENT');
  }
  const enhanceChosen = splitSelection(enhanceModel || 'gpt-image-1');
  if (enhanceChosen.providerId && enhanceProviderId && enhanceChosen.providerId !== enhanceProviderId) {
    throw new ImageEditModelPlanError(400, 'IMAGE_EDIT_MODEL_PROVIDER_MISMATCH');
  }
  const requestedEnhanceProviderId = enhanceProviderId || enhanceChosen.providerId;
  let requestedModelId = chosen.model || 'gemini-2.5-flash-image-preview';
  const explicit = Boolean(requestedProviderId);
  try {
    // Clone immediately: downstream configuration edits cannot change this admission.
    const providers = structuredClone(await getApiProviders({ strict: true, migrateFileProviders: false }));
    const user = input.source === 'internal'
      ? (await listManagedUsers()).find(candidate => candidate.id === input.user.id)
      : input.user;
    if (!user || user.status === 'disabled') {
      throw new ImageEditModelPlanError(403, 'IMAGE_EDIT_MODEL_NOT_AUTHORIZED');
    }
    const requestedProvider = providers.find(p => p.id === requestedProviderId);
    if (requestedProvider) requestedModelId = canonicalizeConfiguredModelId(requestedProvider, requestedModelId);
    const models = getConfiguredModelsForProviders(providers);
    const catalog = resolveTaskModelCatalogResultFromSnapshot(models, user, providers);
    const removebg = input.action === 'removebg' || input.action === 'remove_background';
    const validActions = ['erase', 'mask', 'inpaint', 'extend', 'outpaint', 'upscale', 'removebg', 'remove_background', 'multi_angle', 'display_decompose'];
    const compatible = (type: ApiKind): boolean => validActions.includes(input.action) && (
      type === 'image' || type === 'imageEdit' || (input.action === 'upscale' && type === 'upscaler') || (removebg && type === 'removebg')
    );
    const candidates: ImageEditModelCandidate[] = [];
    const dedicatedRemoveBgCandidates: ImageEditModelCandidate[] = [];
    const visionCandidates: ImageEditModelCandidate[] = [];
    const seen = new Set<string>();
    let configuredMatch = false;
    let unauthorizedMatch = false;
    let configuredEnhancementMatch = false;
    let unauthorizedEnhancementMatch = false;
    let enhancementCandidate: ImageEditModelCandidate | undefined;
    for (const entry of models) {
      const provider = providers.find(p => p.id === entry.providerId);
      if (!provider || !provider.isEnabled || !provider.apiKey?.trim() || !provider.baseUrl?.trim()) continue;
      const key = taskModelKey(provider.id, entry.id);
      if (seen.has(key)) continue;
      seen.add(key);
      const type = catalog.effectiveModelTypes.get(key);
      if (!type) continue;
      const enhancementEligible = input.enableQualityEnhance && (type === 'image' || type === 'imageEdit')
        && (!requestedEnhanceProviderId || provider.id === requestedEnhanceProviderId)
        && entry.id === canonicalizeConfiguredModelId(provider, enhanceChosen.model);
      if (enhancementEligible) configuredEnhancementMatch = true;
      const selected = !explicit || (provider.id === requestedProviderId && entry.id === requestedModelId);
      const eligible = selected && compatible(type);
      if (eligible) configuredMatch = true;
      if (!catalog.authorizedModelKeys.has(key)) {
        if (eligible) unauthorizedMatch = true;
        if (enhancementEligible) unauthorizedEnhancementMatch = true;
        continue;
      }
      // Each candidate owns its own exact provider snapshot, including the selected model.
      const snapshot = structuredClone(provider);
      snapshot.selectedModel = entry.id;
      const candidate: ImageEditModelCandidate = {
        providerId: provider.id, model: entry.id, apiKey: snapshot.apiKey,
        apiBaseUrl: normalizeApiBaseUrl(snapshot.baseUrl), source: explicit ? 'specified-provider' : 'admin-auto',
        providerType: type, advancedParams: snapshot.advancedParams, provider: snapshot,
      };
      if (type === 'chat' || type === 'vlm') visionCandidates.push(candidate);
      if (enhancementEligible && !enhancementCandidate) enhancementCandidate = candidate;
      if (!eligible) continue;
      if (entry.id === 'SeedVR2-Upscaler') {
        if (explicit || requestedModelId === entry.id) throw new ImageEditModelPlanError(422, 'IMAGE_EDIT_MODEL_UNVERIFIED');
        continue;
      }
      if (type === 'removebg') dedicatedRemoveBgCandidates.push(candidate);
      else candidates.push(candidate);
    }
    if (!candidates.length && !dedicatedRemoveBgCandidates.length) {
      throw new ImageEditModelPlanError(configuredMatch && unauthorizedMatch ? 403 : 400,
        configuredMatch && unauthorizedMatch ? 'IMAGE_EDIT_MODEL_NOT_AUTHORIZED' : 'IMAGE_EDIT_MODEL_UNAVAILABLE');
    }
    if (input.enableQualityEnhance && enhanceModel && !enhancementCandidate) {
      throw new ImageEditModelPlanError(configuredEnhancementMatch && unauthorizedEnhancementMatch ? 403 : 400,
        configuredEnhancementMatch && unauthorizedEnhancementMatch
          ? 'IMAGE_EDIT_MODEL_NOT_AUTHORIZED' : 'IMAGE_EDIT_ENHANCEMENT_MODEL_UNAVAILABLE');
    }
    if (input.action === 'upscale' && upscaleModel && !explicit) {
      const requestedCandidate = candidates.find(candidate => candidate.model === canonicalizeConfiguredModelId(candidate.provider, requestedModelId));
      if (requestedCandidate) requestedModelId = requestedCandidate.model;
    }
    const priority = (candidate: ImageEditModelCandidate): number =>
      candidate.model === requestedModelId ? 0 : candidate.providerType === 'upscaler' ? 1 : 2;
    candidates.sort((a, b) => priority(a) - priority(b));
    dedicatedRemoveBgCandidates.sort((a, b) => priority(a) - priority(b));
    return { requestedModelId, requestedProviderId, explicit, candidates, dedicatedRemoveBgCandidates,
      visionCandidates, enhancementCandidate };
  } catch (error) {
    if (error instanceof ImageEditModelPlanError) throw error;
    throw new ImageEditModelPlanError(503, 'IMAGE_EDIT_MODEL_PLAN_UNAVAILABLE');
  }
}
