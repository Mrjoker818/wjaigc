import 'server-only';
import type { ApiCompatProfile } from '@/lib/api-compatibility';
import type { ModelParamType } from '@/lib/canvas-generation-group';
import type { TaskModelDescriptor } from './model-capability-contract';
import { findProviderById, findProviderForModel, findAllProvidersForType, normalizeApiBaseUrl, type ApiProvider } from '@/lib/server-api-config';
import { resolveProfileForModel } from '@/lib/api-compatibility';
import { normalizeProviderModelSelection } from './exact-model-selection';
import { admitExactImageCandidate } from './candidate-model-admission';
import { resolveTaskModelForUser } from './model-catalog';
import { normalizeRequestedPixelSize } from './descriptor-image-request-fields';
import { normalizeImageOutputRequestBody } from '@/lib/image-generation-output';
import { calculateConfiguredCreditCost } from '@/lib/credits';
import { checkPromptSafety } from '@/lib/prompt-safety';
import type { User } from '@/lib/user-types';
import { CanvasOrdinaryAdmissionError, ordinaryReferenceUrls } from '@/lib/collaboration/canvas-ordinary-generation-admission';
import { shouldUseResponsesAPIForProvider } from '@/lib/model-capabilities';
import { freezeSubjectIdentificationTargets, type FrozenSubjectIdentificationTarget } from '@/lib/identify-subject';

export interface OrdinaryGenerationTarget {
  providerId: string; providerName: string; modelId: string; baseUrl: string;
  profile: ApiCompatProfile; modelConfig: ModelConfig; capability: TaskModelDescriptor;
  advancedParams: Record<string, string>;
  responsesApiEnabled: boolean;
}
export interface OrdinaryGenerationPlan {
  body: Record<string, unknown>; targets: OrdinaryGenerationTarget[];
  requestedModel: string; requestedProviderId: string; requestedCount: number; creditCost: number;
  identificationTargets: FrozenSubjectIdentificationTarget[];
}

function withoutRequestCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRequestCredentials);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/key|secret|token|password|authorization|credential/i.test(key))
    .map(([key, child]) => [key, withoutRequestCredentials(child)]));
  return value;
}

/** Configuration and capability admission only; never reads image bytes or calls a provider. */
export async function prepareOrdinaryGenerationRequest(body: Record<string, unknown>, user: User): Promise<OrdinaryGenerationPlan> {
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new CanvasOrdinaryAdmissionError(400, 'PROMPT_REQUIRED');
  if (checkPromptSafety(body.prompt).level === 'block') throw new CanvasOrdinaryAdmissionError(400, 'PROMPT_BLOCKED');
  const rawModel = typeof body.model === 'string' ? body.model : 'gemini-2.5-flash-image-preview';
  const composite = rawModel.includes('::') ? rawModel.split('::') : [];
  if (composite.length && body.providerId && body.providerId !== composite[0]) throw new CanvasOrdinaryAdmissionError(400, 'MODEL_PROVIDER_MISMATCH');
  const explicitId = typeof body.providerId === 'string' && body.providerId || composite[0] || '';
  const modelId = composite.length ? composite[composite.length - 1] : rawModel;
  const normalizedBody = normalizeImageOutputRequestBody(body, modelId);
  const references = ordinaryReferenceUrls(body.referenceImages);
  const count = body.outputCount ?? body.n;
  const selection = { operation: references.length ? 'image-to-image' as const : 'text-to-image' as const,
    aspectRatio: typeof body.aspectRatio === 'string' ? body.aspectRatio : '1:1',
    size: normalizeRequestedPixelSize(body.size), quality: typeof body.quality === 'string' ? body.quality : undefined,
    outputCount: count === undefined ? 1 : Number(count), referenceImageCount: references.length, usesMask: false };
  const targets: OrdinaryGenerationTarget[] = [];
  const admit = async (provider: ApiProvider, requestedModel: string, required: boolean): Promise<void> => {
    const normalized = normalizeProviderModelSelection({ requestedModelId: requestedModel,
      selectedModels: provider.selectedModels, discoveredModels: provider.discoveredModels });
    if (!normalized.matched || !['image', 'universal', 'general', 'imageEdit'].includes(provider.modelType || provider.type || '')) {
      if (required) throw new CanvasOrdinaryAdmissionError(400, 'MODEL_PROVIDER_MISMATCH');
      return;
    }
    const admitted = await admitExactImageCandidate({ providerId: provider.id, modelId: normalized.modelId, selection,
      resolveTaskModel: (id, model) => resolveTaskModelForUser(id, model, user) });
    if (!admitted.ok) {
      if (required) throw new CanvasOrdinaryAdmissionError(admitted.error.code === 'MODEL_NOT_AUTHORIZED' ? 403 : 400, admitted.error.code);
      return;
    }
    if (!provider.apiKey || !provider.baseUrl) {
      if (required) throw new CanvasOrdinaryAdmissionError(400, 'MODEL_PROVIDER_UNAVAILABLE');
      return;
    }
    const profile = resolveProfileForModel(normalized.modelId, provider);
    targets.push({ providerId: provider.id, providerName: provider.displayName || provider.name,
      modelId: normalized.modelId, baseUrl: normalizeApiBaseUrl(provider.baseUrl), profile,
      responsesApiEnabled: shouldUseResponsesAPIForProvider(normalized.modelId, normalizeApiBaseUrl(provider.baseUrl)),
      modelConfig: inferModelConfig(normalized.modelId, profile, provider.displayName, admitted.descriptor),
      capability: admitted.descriptor, advancedParams: Object.fromEntries(Object.entries(provider.advancedParams || {})
        .filter(([key]) => !/key|secret|token|password|authorization|credential/i.test(key))) });
  };
  const primary = explicitId ? await findProviderById(explicitId) : await findProviderForModel(modelId, 'image');
  if (explicitId && !primary) throw new CanvasOrdinaryAdmissionError(400, 'MODEL_PROVIDER_MISMATCH');
  if (primary) await admit(primary, modelId, Boolean(explicitId));
  if (!explicitId) {
    for (const item of await findAllProvidersForType('image')) {
      for (const model of item.models) {
        if (model !== modelId) await admit(item.provider, model, false);
      }
    }
  }
  if (!targets.length) throw new CanvasOrdinaryAdmissionError(400, 'MODEL_PROVIDER_UNAVAILABLE');
  const creditCost = await calculateConfiguredCreditCost('image_generate', primary
    ? normalizeProviderModelSelection({ requestedModelId: modelId, selectedModels: primary.selectedModels, discoveredModels: primary.discoveredModels }).modelId : modelId,
  { quality: typeof body.quality === 'string' ? body.quality : undefined,
    resolution: typeof body.resolution === 'string' ? body.resolution : undefined, providerId: explicitId || undefined });
  const frozenBody = withoutRequestCredentials({ ...normalizedBody, referenceImages: references }) as Record<string, unknown>;
  return { body: frozenBody, targets, requestedModel: modelId, requestedProviderId: explicitId,
    identificationTargets: references.length ? await freezeSubjectIdentificationTargets() : [],
    requestedCount: typeof count === 'number' && Number.isFinite(count) && count >= 1 ? Math.min(Math.floor(count), 10) : 1, creditCost };
}
export interface ModelConfig {
  name: string;
  modelId: string;
  // 参数类型: resolution=分辨率档位(1K/2K/4K), quality=质量级别(auto/low/medium/high), none=不支持
  paramType: ModelParamType;
  // 该模型支持的尺寸列表（空数组表示支持所有通用尺寸）
  supportedSizes: string[];
  qualityOptions: string[];
  resolutionOptions: string[];
  // 是否支持图生图
  supportsImageToImage: boolean;
  // 最大生成数量
  maxN: number;
  // 模型预估生成时间（秒），用于前端轮询策略
  estimatedTime: number;
}

// 通用支持的尺寸列表
/**
 * 根据模型ID和兼容性档案动态推断模型配置
 * - 不依赖任何硬编码的模型列表
 * - 根据模型名称关键词智能推断能力
 * - 所有管理员添加的 API 都可自动适配
 */
function modelParamTypeFromDescriptor(descriptor: TaskModelDescriptor | null): ModelParamType {
  const resolutionOptions = descriptor?.allowedSizes.filter(size => /^\d+K$/i.test(size)) || [];
  const hasQualityOptions = (descriptor?.qualityOptions.length || 0) > 0;
  if (resolutionOptions.length > 0 && hasQualityOptions) return 'both';
  if (resolutionOptions.length > 0) return 'resolution';
  if (hasQualityOptions) return 'quality';
  return 'none';
}

export function inferModelConfig(
  modelId: string,
  profile: ApiCompatProfile,
  providerName?: string,
  descriptor: TaskModelDescriptor | null = null,
): ModelConfig {
  const id = (modelId || '').toLowerCase();

  // ★ 使用核心配置中的模型列表判断参数类型（保持与 UI 一致）
  // 核心改进：不再简单依赖关键词匹配，而是使用规范化的模型能力表
  const paramType = modelParamTypeFromDescriptor(descriptor);

  // 根据模型名称推断是否支持图生图
  // 大多数现代图像模型都支持图生图，只有极少数纯文生图模型不支持
  const supportsImageToImage = descriptor
    ? descriptor.supportsReferenceImages
      || descriptor.supportedOperations?.includes('image-to-image') === true
    : !id.includes('text-only') && !id.includes('txt2img-only');

  // 根据模型名称推断预估时间
  let estimatedTime = 30; // 默认30秒
  if (id.includes('flash')) {
    estimatedTime = 15;
  } else if (id.includes('pro') || id.includes('gpt-image')) {
    estimatedTime = 90;
  } else if (id.includes('flux') && id.includes('schnell')) {
    estimatedTime = 10;
  } else if (id.includes('flux') && id.includes('dev')) {
    estimatedTime = 30;
  } else if (id.includes('dall-e-3') || id.includes('dall-e-4')) {
    estimatedTime = 60;
  }

  // 根据兼容性档案调整
  if (profile.responseMode === 'direct') {
    // 直接返回模式的API通常需要更长的单次请求时间
    estimatedTime = Math.max(estimatedTime, 60);
  }

  return {
    name: providerName || modelId,
    modelId,
    paramType,
    supportedSizes: descriptor?.allowedRatios || [],
    qualityOptions: descriptor?.qualityOptions || [],
    resolutionOptions: descriptor?.allowedSizes.filter(size => /^\d+K$/i.test(size)) || [],
    supportsImageToImage,
    maxN: descriptor?.maxOutputs || 4,
    estimatedTime,
  };
}
