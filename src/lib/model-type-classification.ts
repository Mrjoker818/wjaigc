import {
  get302UpscaleModelsForProvider,
  is302AiUpscaleBaseUrl,
  resolve302UpscaleModelId,
  resolve302UpscaleModelSelection,
} from './302-upscale-models';
import type { ApiKind, ApiProvider, ModelInfo } from './universal-api-types';

export type ModelAuthorizationNamespace = 'image' | 'chat';

type InferableModelType = Exclude<ApiKind, 'general' | 'universal' | 'imageEdit'>;

export function modelTypeForProvider(provider: ApiProvider): InferableModelType {
  if (provider.modelType === 'chat') return 'chat';
  if (provider.modelType === '3d') return '3d';
  if (provider.modelType === 'vectorize') return 'vectorize';
  if (provider.modelType === 'layer') return 'layer';
  if (provider.modelType === 'video') return 'video';
  if (provider.modelType === 'audio') return 'audio';
  if (provider.modelType === 'upscaler') return 'upscaler';
  if (provider.modelType === 'removebg') return 'removebg';
  if (provider.modelType === 'vlm') return 'vlm';
  if (provider.modelType === 'universal' || provider.modelType === 'general') return 'chat';
  return 'image';
}

export function inferModelType(
  modelId: string,
  fallback: InferableModelType,
): InferableModelType {
  const id = modelId.toLowerCase();
  if (
    id.includes('tts')
    || id.includes('speech')
    || (id.includes('audio') && !id.includes('audio-output'))
    || id.includes('voice-generation')
    || id.includes('voice-gen')
    || id.includes('text-to-speech')
    || id.includes('fish-speech')
    || id.includes('cosyvoice')
    || id.includes('chat-tts')
    || id.includes('bark-')
    || id.includes('elevenlabs')
  ) {
    return 'audio';
  }
  if (
    id.includes('video')
    || id.includes('seedance')
    || id.includes('kling')
    || id.includes('hailuo')
    || id.includes('vidu')
    || (id.includes('sora') && !id.includes('sorafenib'))
    || id.includes('veo')
    || id.includes('pika')
    || id.includes('ray2')
    || id.includes('ray3')
    || id.includes('gen-3')
    || id.includes('gen-4')
    || id.includes('gen-2')
    || id.includes('cogvideo')
    || id.includes('cog-video')
    || id.includes('wan-')
    || id.includes('wan2.')
    || id.includes('wan2-')
    || id.includes('runway')
    || id.includes('luma')
    || id.includes('mochi')
    || id.includes('ltx')
    || id.includes('doubao-video')
    || id.includes('bytedance-video')
    || id.includes('minimax-video')
    || id.includes('deforum')
    || id.includes('text2video')
    || id.includes('t2v')
    || id.includes('image2video')
    || id.includes('i2v')
    || id.includes('pyramid-flow')
  ) {
    return 'video';
  }
  if (
    id.includes('embed')
    || id.includes('rerank')
    || id.includes('retrieval')
    || id.includes('moderation')
    || id.includes('stt')
    || id.includes('whisper')
    || id.includes('transcrib')
  ) {
    return 'chat';
  }
  if (
    id.includes('vectorize')
    || id.includes('vector')
    || id.includes('vtracer')
    || id.includes('starvector')
    || id.includes('svg-convert')
    || id.includes('svgconvert')
    || id.includes('recraft')
  ) {
    return 'vectorize';
  }
  if (
    id.includes('qwen-vl')
    || id.includes('qwen2.5-vl')
    || id.includes('qwen2-vl')
    || id.includes('qwen3-vl')
    || id.includes('qwen2.7-vl')
    || id.includes('qvq')
    || id.includes('glm-4v')
    || id.includes('glm-5v')
    || id.includes('glm-4.1v')
    || id.includes('glm-4v-plus')
    || id.includes('gemini-vision')
    || id.includes('internvl')
    || id.includes('intern-vl')
    || id.includes('moondream')
    || id.includes('llava')
    || id.includes('cogvlm')
    || id.includes('idefics')
    || id.includes('kosmos')
    || id.includes('florence')
    || id.includes('qwen3.6-vl')
    || (id.includes('qwen') && id.includes('vl'))
  ) {
    return 'vlm';
  }
  if (
    id.includes('seedvr')
    || id.includes('seed-vr')
    || id.includes('upscaler')
    || id.includes('upscale')
    || id.includes('real-esrgan')
    || id.includes('realesrgan')
    || id.includes('swinir')
    || id.includes('scunet')
    || (id.includes('hat') && id.includes('super'))
    || id.includes('gfpgan')
    || id.includes('codeformer')
    || id.includes('remacri')
    || id.includes('ultramix')
    || id.includes('4x-anime')
    || id.includes('4x-ultrasharp')
  ) {
    return 'upscaler';
  }
  if (
    id.includes('removebg')
    || id.includes('remove-bg')
    || id.includes('rmbg')
    || id.includes('birefnet')
    || id.includes('u2net')
    || id.includes('isnet')
    || id.includes('background-remover')
    || id.includes('cutout')
    || id.includes('matting')
    || id.includes('background-remove')
    || id.includes('remove-background')
    || id.includes('transparent-bg')
  ) {
    return 'removebg';
  }
  if (
    id.includes('qwen-image-layered')
    || id.includes('layer')
    || id.includes('segment')
    || id.includes('sam')
    || id.includes('detection')
    || id.includes('yolo')
  ) {
    return 'layer';
  }
  if (
    id.includes('3d')
    || id.includes('tripo')
    || id.includes('meshy')
    || id.includes('hunyuan-3d')
    || id.includes('hunyuan3d')
  ) {
    return '3d';
  }
  if (
    id.includes('image')
    || id.includes('dall-e')
    || id.includes('dalle')
    || id.includes('flux')
    || id.includes('stable')
    || id.includes('sdxl')
    || id.includes('midjourney')
    || id.includes('imagen')
    || id.includes('seedream')
    || id.includes('ideogram')
    || id.includes('recraft')
    || id.includes('playground')
    || id.includes('kandinsky')
    || id.includes('pixart')
    || id.includes('deepfloyd')
    || id.includes('wuerstchen')
    || id.includes('openjourney')
    || id.includes('dreamshaper')
    || id.includes('realistic-vision')
    || id.includes('deliberate')
    || id.includes('anything-v')
    || id.includes('counterfeit')
    || id.includes('meinamix')
    || id.includes('novelai')
    || id.includes('nai-diffusion')
    || id.includes('cogview')
    || id.includes('minimax-image')
  ) {
    return 'image';
  }
  if (
    id.includes('embed')
    || id.includes('rerank')
    || id.includes('retrieval')
    || id.includes('moderation')
    || id.includes('tts')
    || id.includes('stt')
    || id.includes('whisper')
    || id.includes('speech')
    || id.includes('audio')
    || id.includes('transcrib')
  ) {
    return 'chat';
  }
  if (
    id.includes('gpt')
    || id.includes('claude')
    || id.includes('gemini')
    || id.includes('qwen')
    || id.includes('deepseek')
    || id.includes('llama')
    || id.includes('glm')
    || id.includes('mistral')
    || id.includes('codestral')
    || id.includes('yi-')
    || id.includes('chatglm')
    || id.includes('command')
    || id.includes('phi')
    || id.includes('grok')
    || id.includes('o1')
    || id.includes('o3')
    || id.includes('o4')
  ) {
    return 'chat';
  }
  return fallback;
}

export function resolveEffectiveModelType(
  provider: ApiProvider,
  model: ModelInfo,
): ApiKind {
  const providerType = provider.modelType || provider.type;
  if (providerType !== 'general' && providerType !== 'universal') {
    return providerType;
  }

  const discoveredType = model.type;
  const fallback = discoveredType === 'general' || discoveredType === 'universal'
    ? modelTypeForProvider(provider)
    : discoveredType === 'imageEdit'
      ? 'image'
      : discoveredType;
  return inferModelType(model.id, fallback);
}

export function resolveModelAuthorizationNamespace(
  effectiveType: ApiKind,
): ModelAuthorizationNamespace | null {
  switch (effectiveType) {
    case 'image':
    case 'vectorize':
    case 'layer':
    case 'imageEdit':
    case 'upscaler':
    case 'removebg':
      return 'image';
    case 'chat':
    case 'vlm':
      return 'chat';
    default:
      return null;
  }
}

export function canonicalizeConfiguredModelId(
  provider: ApiProvider,
  modelId: string,
): string {
  const trimmed = modelId.trim();
  if (
    (provider.modelType || provider.type) === 'upscaler'
    && is302AiUpscaleBaseUrl(provider.baseUrl)
  ) {
    return resolve302UpscaleModelId(trimmed) || trimmed;
  }
  return trimmed;
}

export function getConfiguredModelsForProvider(provider: ApiProvider): ModelInfo[] {
  const selectedModels = provider.selectedModels || [];
  const normalized302Selection = (provider.modelType || provider.type) === 'upscaler'
    ? resolve302UpscaleModelSelection(provider.baseUrl, selectedModels)
    : null;
  const configuredIds = normalized302Selection
    ?? (selectedModels.length > 0
      ? selectedModels.map(modelId => canonicalizeConfiguredModelId(provider, modelId))
      : (provider.discoveredModels || []).map(model => (
          canonicalizeConfiguredModelId(provider, model.id)
        )));
  const discovered = provider.discoveredModels || [];
  const known302Models = get302UpscaleModelsForProvider(provider.baseUrl, 'upscaler');

  return [...new Set(configuredIds)].map(modelId => {
    const discoveredModel = discovered.find(model => (
      canonicalizeConfiguredModelId(provider, model.id) === modelId
    ));
    const known302Model = known302Models.find(model => model.id === modelId);
    const model = discoveredModel || known302Model || {
      id: modelId,
      name: modelId,
      providerId: provider.id,
      type: modelTypeForProvider(provider),
    };
    const normalizedModel = {
      ...model,
      id: modelId,
      providerId: provider.id,
    };
    return {
      ...normalizedModel,
      type: resolveEffectiveModelType(provider, normalizedModel),
    };
  });
}

export function getConfiguredModelsForProviders(providers: ApiProvider[]): ModelInfo[] {
  return providers.flatMap(provider => getConfiguredModelsForProvider(provider));
}
