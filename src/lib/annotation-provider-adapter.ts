import type { EditIntentBundle } from '@/features/annotations/annotation-types';
import type { CompiledAnnotationAssets } from '@/lib/annotation-mask';
import { getModelCapabilities } from '@/lib/model-capabilities';
import { dbGetUserById } from '@/lib/db-storage';
import { isModelAssignedToUser } from '@/lib/model-defaults';
import { findProviderById } from '@/lib/server-api-config';

export class AnnotationProviderError extends Error {
  readonly code:
    | 'ANNOTATION_MODEL_UNSUPPORTED'
    | 'ANNOTATION_MODEL_FORBIDDEN'
    | 'ANNOTATION_PROVIDER_REQUEST_INVALID';

  constructor(
    code:
      | 'ANNOTATION_MODEL_UNSUPPORTED'
      | 'ANNOTATION_MODEL_FORBIDDEN'
      | 'ANNOTATION_PROVIDER_REQUEST_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'AnnotationProviderError';
    this.code = code;
  }
}

export interface AnnotationProviderRequest {
  image: string;
  prompt: string;
  mask?: string;
  referenceImages: string[];
  model: string;
  providerId: string;
  annotationIds: string[];
  idempotencyKey: string;
  requestId: string;
  size: string;
  quality: string;
}

export interface BuildAnnotationProviderRequestInput {
  bundle: EditIntentBundle;
  imageUrl: string;
  assets: CompiledAnnotationAssets;
  requestId: string;
}

export interface ResolvedAnnotationProvider {
  providerId: string;
  modelId: string;
}

export async function resolveAnnotationProvider(
  providerId: string,
  modelId: string,
  identity?: { userId: string; userRole: string },
): Promise<ResolvedAnnotationProvider> {
  const embeddedProviderId = modelId.includes('::') ? modelId.split('::')[0] : '';
  const pureModelId = modelId.includes('::') ? modelId.split('::').pop()! : modelId;
  const effectiveProviderId = providerId || embeddedProviderId;
  if (!effectiveProviderId || !pureModelId) {
    throw new AnnotationProviderError(
      'ANNOTATION_PROVIDER_REQUEST_INVALID',
      '请选择批注修图模型和 API 提供商',
    );
  }

  const provider = await findProviderById(effectiveProviderId);
  const allowedTypes = new Set(['image', 'imageEdit', 'universal', 'general']);
  if (
    !provider
    || !provider.isEnabled
    || !provider.apiKey
    || !allowedTypes.has(provider.modelType || provider.type)
  ) {
    throw new AnnotationProviderError(
      'ANNOTATION_MODEL_UNSUPPORTED',
      '所选批注修图提供商不可用',
    );
  }

  const configuredModels = provider.selectedModels?.length
    ? provider.selectedModels
    : (provider.discoveredModels || []).map((model) => model.id);
  if (!configuredModels.includes(pureModelId)) {
    throw new AnnotationProviderError(
      'ANNOTATION_MODEL_UNSUPPORTED',
      '所选模型未配置在当前 API 提供商中',
    );
  }

  if (identity && identity.userRole !== 'admin') {
    const user = await dbGetUserById(identity.userId);
    const imageModels = (user as (typeof user & { image_models?: string[] }) | null)
      ?.image_models;
    if (
      !user
      || !isModelAssignedToUser(
        imageModels,
        effectiveProviderId,
        pureModelId,
      )
    ) {
      throw new AnnotationProviderError(
        'ANNOTATION_MODEL_FORBIDDEN',
        'The selected annotation model is not assigned to the current user',
      );
    }
  }

  return {
    providerId: effectiveProviderId,
    modelId: pureModelId,
  };
}

export function buildAnnotationProviderRequest({
  bundle,
  imageUrl,
  assets,
  requestId,
}: BuildAnnotationProviderRequestInput): AnnotationProviderRequest {
  const model = bundle.modelId.trim();
  const providerId = bundle.providerId.trim();
  if (!model || !providerId || !requestId.trim() || !bundle.idempotencyKey.trim()) {
    throw new AnnotationProviderError(
      'ANNOTATION_PROVIDER_REQUEST_INVALID',
      '批注执行缺少模型、提供商或请求标识',
    );
  }

  const capabilities = getModelCapabilities(model);
  if (assets.hasMask && !capabilities.supportsMask) {
    throw new AnnotationProviderError(
      'ANNOTATION_MODEL_UNSUPPORTED',
      '当前模型不支持空间批注编辑，请更换支持蒙版修图的模型',
    );
  }

  const prompt = [
    bundle.prompt.trim(),
    '必须逐条执行以下批注，不得忽略、合并或重解释任何批注 ID：',
    assets.instructionList,
    '参考图中的编号与上述批注 ID 一一对应。仅修改标记目标，保持未标记区域不变。',
  ].filter(Boolean).join('\n\n');

  return {
    image: imageUrl,
    prompt,
    ...(assets.hasMask ? { mask: assets.maskDataUrl } : {}),
    referenceImages: [assets.referenceImageDataUrl],
    model,
    providerId,
    annotationIds: [...bundle.annotationIds],
    idempotencyKey: bundle.idempotencyKey,
    requestId,
    size: `${assets.width}x${assets.height}`,
    quality: 'high',
  };
}
