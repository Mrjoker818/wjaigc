/**
 * Model Name Mapping - Technical IDs → Market Common Names
 * Maps API model identifiers to user-friendly market names.
 */

interface ModelNameEntry {
  /** Market common name */
  name: string;
  /** Short alias for compact display */
  short?: string;
  /** Model type category */
  type: 'image' | 'chat' | '3d' | 'imageEdit' | 'vectorize' | 'layer' | 'video';
  /** Optional provider/brand */
  provider?: string;
}

/**
 * Mapping rules: key is a lowercase substring to match against model ID.
 * The longest matching pattern wins; ties preserve declaration order.
 */
const MODEL_NAME_MAP: Array<{ pattern: string; entry: ModelNameEntry }> = [
  // ===== Image Models =====
  // Google Gemini Image / Nano Banana series
  { pattern: 'gemini-3.1-flash-image', entry: { name: 'Nano Banana 2', short: 'NB2', type: 'image', provider: 'Google' } },
  { pattern: 'gemini-3-pro-image', entry: { name: 'Nano Banana 2 Pro', short: 'NB2 Pro', type: 'image', provider: 'Google' } },
  { pattern: 'gemini-3-flash-image', entry: { name: 'Nano Banana 2 Flash', short: 'NB2F', type: 'image', provider: 'Google' } },
  { pattern: 'gemini-2.5-flash-image', entry: { name: 'Nano Banana', short: 'NB', type: 'image', provider: 'Google' } },
  { pattern: 'gemini-2.5-pro-image', entry: { name: 'Nano Banana Pro', short: 'NB Pro', type: 'image', provider: 'Google' } },
  { pattern: 'gemini-flash-image', entry: { name: 'Nano Banana', short: 'NB', type: 'image', provider: 'Google' } },
  { pattern: 'gemini-pro-image', entry: { name: 'Nano Banana Pro', short: 'NB Pro', type: 'image', provider: 'Google' } },
  // PearAPI nano-banana models (display names per PearAPI website convention)
  { pattern: 'nano-banana-pro-4k', entry: { name: 'Nano Banana Pro 4K', short: 'NB Pro 4K', type: 'image', provider: 'PearAPI' } },
  { pattern: 'nano-banana-2-4k', entry: { name: 'Nano Banana 2 4K', short: 'NB2 4K', type: 'image', provider: 'PearAPI' } },
  { pattern: 'nano-banana-2-lite', entry: { name: 'Nano Banana 2 Lite', short: 'NB2 Lite', type: 'image', provider: 'PearAPI' } },
  { pattern: 'nano-banana-pro', entry: { name: 'Nano Banana Pro', short: 'NB Pro', type: 'image', provider: 'PearAPI' } },
  { pattern: 'nano-banana-2', entry: { name: 'Nano Banana 2', short: 'NB2', type: 'image', provider: 'PearAPI' } },
  { pattern: 'nano-banana', entry: { name: 'Nano Banana', short: 'NB', type: 'image', provider: 'PearAPI' } },
  { pattern: 'nanobananapro4k', entry: { name: 'Nano Banana Pro 4K', short: 'NB Pro 4K', type: 'image', provider: 'PearAPI' } },
  { pattern: 'nanobanana24k', entry: { name: 'Nano Banana 2 4K', short: 'NB2 4K', type: 'image', provider: 'PearAPI' } },
  { pattern: 'nanobanana2pro', entry: { name: 'Nano Banana 2 Pro', short: 'NB2 Pro', type: 'image', provider: 'PearAPI' } },
  { pattern: 'nanobananapro', entry: { name: 'Nano Banana Pro', short: 'NB Pro', type: 'image', provider: 'PearAPI' } },
  { pattern: 'nanobanana2', entry: { name: 'Nano Banana 2', short: 'NB2', type: 'image', provider: 'PearAPI' } },
  { pattern: 'nanobanana', entry: { name: 'Nano Banana', short: 'NB', type: 'image', provider: 'PearAPI' } },
  // Google Imagen series
  { pattern: 'imagen-4-ultra', entry: { name: 'Imagen 4 Ultra', type: 'image', provider: 'Google' } },
  { pattern: 'imagen-4', entry: { name: 'Imagen 4', type: 'image', provider: 'Google' } },
  { pattern: 'imagen-3', entry: { name: 'Imagen 3', type: 'image', provider: 'Google' } },
  { pattern: 'imagen', entry: { name: 'Imagen', type: 'image', provider: 'Google' } },
  // OpenAI DALL-E series
  { pattern: 'dall-e-3', entry: { name: 'DALL-E 3', type: 'image', provider: 'OpenAI' } },
  { pattern: 'dall-e-2', entry: { name: 'DALL-E 2', type: 'image', provider: 'OpenAI' } },
  { pattern: 'dalle-3', entry: { name: 'DALL-E 3', type: 'image', provider: 'OpenAI' } },
  { pattern: 'dalle-2', entry: { name: 'DALL-E 2', type: 'image', provider: 'OpenAI' } },
  { pattern: 'gpt-4o-image', entry: { name: 'GPT-4o 图像', type: 'image', provider: 'OpenAI' } },
  // OpenAI GPT-image
  { pattern: 'gpt-image-2-c', entry: { name: 'GPT Image 2 Chat', type: 'image', provider: 'OpenAI' } },
  { pattern: 'gpt-image-2-4k', entry: { name: 'GPT Image 2 4K', short: 'GPT Image 2 4K', type: 'image', provider: 'OpenAI' } },
  { pattern: 'gpt-image-2-2k', entry: { name: 'GPT Image 2 2K', short: 'GPT Image 2 2K', type: 'image', provider: 'OpenAI' } },
  { pattern: 'gpt-image-2', entry: { name: 'GPT Image 2', type: 'image', provider: 'OpenAI' } },
  { pattern: 'gpt-image-1.5', entry: { name: 'GPT Image 1.5', type: 'image', provider: 'OpenAI' } },
  { pattern: 'gpt-image-1', entry: { name: 'GPT Image 1', type: 'image', provider: 'OpenAI' } },
  { pattern: 'gpt-image', entry: { name: 'GPT Image', type: 'image', provider: 'OpenAI' } },
  // Midjourney
  { pattern: 'midjourney-v7', entry: { name: 'Midjourney V7', short: 'MJ V7', type: 'image', provider: 'Midjourney' } },
  { pattern: 'midjourney-v6', entry: { name: 'Midjourney V6', short: 'MJ V6', type: 'image', provider: 'Midjourney' } },
  { pattern: 'midjourney-v5', entry: { name: 'Midjourney V5', short: 'MJ V5', type: 'image', provider: 'Midjourney' } },
  { pattern: 'midjourney', entry: { name: 'Midjourney', short: 'MJ', type: 'image', provider: 'Midjourney' } },
  { pattern: 'mj-v7', entry: { name: 'Midjourney V7', short: 'MJ V7', type: 'image', provider: 'Midjourney' } },
  { pattern: 'mj-v6', entry: { name: 'Midjourney V6', short: 'MJ V6', type: 'image', provider: 'Midjourney' } },
  { pattern: 'mj-v5', entry: { name: 'Midjourney V5', short: 'MJ V5', type: 'image', provider: 'Midjourney' } },
  // Stable Diffusion
  { pattern: 'stable-diffusion-3.5', entry: { name: 'SD 3.5', type: 'image', provider: 'Stability AI' } },
  { pattern: 'stable-diffusion-3', entry: { name: 'SD 3', type: 'image', provider: 'Stability AI' } },
  { pattern: 'stable-diffusion-xl', entry: { name: 'SDXL', type: 'image', provider: 'Stability AI' } },
  { pattern: 'sd-3.5', entry: { name: 'SD 3.5', type: 'image', provider: 'Stability AI' } },
  { pattern: 'sd-3', entry: { name: 'SD 3', type: 'image', provider: 'Stability AI' } },
  { pattern: 'sdxl', entry: { name: 'SDXL', type: 'image', provider: 'Stability AI' } },
  { pattern: 'stable-diffusion', entry: { name: 'Stable Diffusion', short: 'SD', type: 'image', provider: 'Stability AI' } },
  // FLUX
  { pattern: 'flux2-klein', entry: { name: 'FLUX 2 Klein', short: 'FLUX 2 Klein', type: 'image', provider: 'Black Forest Labs' } },
  { pattern: 'flux-2-pro', entry: { name: 'FLUX 2 Pro', type: 'image', provider: 'Black Forest Labs' } },
  { pattern: 'flux-2-flex', entry: { name: 'FLUX 2 Flex', type: 'image', provider: 'Black Forest Labs' } },
  { pattern: 'flux-kontext-max', entry: { name: 'FLUX Kontext Max', type: 'image', provider: 'Black Forest Labs' } },
  { pattern: 'flux-kontext-pro', entry: { name: 'FLUX Kontext Pro', type: 'image', provider: 'Black Forest Labs' } },
  { pattern: 'flux-pro', entry: { name: 'FLUX Pro', type: 'image', provider: 'Black Forest Labs' } },
  { pattern: 'flux-dev', entry: { name: 'FLUX Dev', type: 'image', provider: 'Black Forest Labs' } },
  { pattern: 'flux-schnell', entry: { name: 'FLUX Schnell', type: 'image', provider: 'Black Forest Labs' } },
  { pattern: 'flux-1.1', entry: { name: 'FLUX 1.1', type: 'image', provider: 'Black Forest Labs' } },
  { pattern: 'flux', entry: { name: 'FLUX', type: 'image', provider: 'Black Forest Labs' } },
  // Adobe Firefly
  { pattern: 'firefly-3', entry: { name: 'Firefly 3', type: 'image', provider: 'Adobe' } },
  { pattern: 'firefly', entry: { name: 'Firefly', type: 'image', provider: 'Adobe' } },
  // Ideogram
  { pattern: 'ideogram-3', entry: { name: 'Ideogram 3', type: 'image', provider: 'Ideogram' } },
  { pattern: 'ideogram-2', entry: { name: 'Ideogram 2', type: 'image', provider: 'Ideogram' } },
  { pattern: 'ideogram', entry: { name: 'Ideogram', type: 'image', provider: 'Ideogram' } },
  // 混元图像
  { pattern: 'hunyuan-image', entry: { name: '混元图像', type: 'image', provider: 'Tencent' } },
  // 通义万相
  { pattern: 'wanx', entry: { name: '通义万相', type: 'image', provider: 'Alibaba' } },
  { pattern: 'tongyi-wanxiang', entry: { name: '通义万相', type: 'image', provider: 'Alibaba' } },
  // 即梦
  { pattern: 'dreamina', entry: { name: '即梦', type: 'image', provider: 'ByteDance' } },
  // Jimeng
  { pattern: 'jimeng', entry: { name: '即梦', type: 'image', provider: 'ByteDance' } },
  // 可灵
  { pattern: 'kling-v3-omni', entry: { name: '可灵 V3 Omni 视频', short: 'Kling V3 Omni', type: 'video', provider: 'Kuaishou' } },
  { pattern: 'kling-v3', entry: { name: '可灵 V3', type: 'image', provider: 'Kuaishou' } },
  { pattern: 'kling-v2', entry: { name: '可灵 V2', type: 'image', provider: 'Kuaishou' } },
  { pattern: 'kling', entry: { name: '可灵', type: 'image', provider: 'Kuaishou' } },
  // HiDream
  { pattern: 'hidream', entry: { name: 'HiDream', type: 'image', provider: 'HiDream AI' } },
  // Grok Imagine
  { pattern: 'grok-imagine-video-1.5', entry: { name: 'Grok Imagine Video 1.5', short: 'GIV 1.5', type: 'video', provider: 'xAI' } },
  { pattern: 'grok-imagine-1.5-video', entry: { name: 'Grok Imagine Video 1.5', short: 'GIV 1.5', type: 'video', provider: 'xAI' } },
  { pattern: 'grok-imagine-video', entry: { name: 'Grok Imagine Video', short: 'GIV', type: 'video', provider: 'xAI' } },
  { pattern: 'grok-imagine-image', entry: { name: 'Grok Imagine Image', short: 'GII', type: 'image', provider: 'xAI' } },
  { pattern: 'grok-imagine', entry: { name: 'Grok Imagine', type: 'image', provider: 'xAI' } },
  { pattern: 'happyhorse', entry: { name: 'HappyHorse', short: 'HappyHorse', type: 'video', provider: 'HappyHorse' } },
  { pattern: 'gemini-omni', entry: { name: 'Gemini Omni', short: 'Gemini Omni', type: 'video', provider: 'Google' } },
  // Sora (视频模型为主，sora-2/sora-2-pro为新版本)
  { pattern: 'sora-2-pro', entry: { name: 'Sora 2 Pro', type: 'video', provider: 'OpenAI' } },
  { pattern: 'sora-2', entry: { name: 'Sora 2', type: 'video', provider: 'OpenAI' } },
  // 通义万相 Image
  { pattern: 'qwen-image-2', entry: { name: '通义万相 2.0', type: 'image', provider: 'Alibaba' } },
  { pattern: 'qwen-image', entry: { name: '通义万相', type: 'image', provider: 'Alibaba' } },
  // Wan (阿里万相视频)
  { pattern: 'wan2.7-image-pro', entry: { name: '万相 2.7 Pro', type: 'image', provider: 'Alibaba' } },
  { pattern: 'wan2.7-image', entry: { name: '万相 2.7', type: 'image', provider: 'Alibaba' } },
  { pattern: 'wan2.7', entry: { name: '万相 2.7', type: 'image', provider: 'Alibaba' } },
  // Seedance (字节视频)
  { pattern: 'seedance-2-5', entry: { name: 'Seedance 2.5', short: 'Seedance 2.5', type: 'video', provider: 'ByteDance' } },
  { pattern: 'seedance-2.5', entry: { name: 'Seedance 2.5', short: 'Seedance 2.5', type: 'video', provider: 'ByteDance' } },
  { pattern: 'seedance-1.5', entry: { name: 'Seedance 1.5 Pro', short: 'Seedance 1.5 Pro', type: 'video', provider: 'ByteDance' } },
  { pattern: 'seedance-1.0', entry: { name: 'Seedance 1.0 Pro', short: 'Seedance 1.0 Pro', type: 'video', provider: 'ByteDance' } },
  { pattern: 'seedance', entry: { name: 'Seedance', type: 'video', provider: 'ByteDance' } },
  // Seedream (字节)
  { pattern: 'seedream-5', entry: { name: 'Seedream 5', type: 'image', provider: 'ByteDance' } },
  { pattern: 'seedream-4-5', entry: { name: 'Seedream 4.5', short: 'Seedream 4.5', type: 'image', provider: 'ByteDance' } },
  { pattern: 'seedream-4-0', entry: { name: 'Seedream 4.0', short: 'Seedream 4.0', type: 'image', provider: 'ByteDance' } },
  // Veo (Google视频)
  { pattern: 'veo3.1', entry: { name: 'Veo 3.1', type: 'video', provider: 'Google' } },
  // Imagen 4
  { pattern: 'imagen-4', entry: { name: 'Imagen 4', type: 'image', provider: 'Google' } },
  // Z-Image
  { pattern: 'z-image', entry: { name: 'Z Image', type: 'image', provider: 'Zhipu' } },
  // MiniMax Hailuo
  { pattern: 'minimax-hailuo', entry: { name: 'Hailuo', type: 'image', provider: 'MiniMax' } },
  { pattern: 'hailuo', entry: { name: 'Hailuo', type: 'image', provider: 'MiniMax' } },

  // ===== Chat Models =====
  // Google Gemini
  { pattern: 'gemini-3.1-flash', entry: { name: 'Gemini 3.1 Flash', short: 'GF 3.1F', type: 'chat', provider: 'Google' } },
  { pattern: 'gemini-3.1-pro', entry: { name: 'Gemini 3.1 Pro', short: 'GF 3.1P', type: 'chat', provider: 'Google' } },
  { pattern: 'gemini-3-flash', entry: { name: 'Gemini 3 Flash', short: 'GF 3F', type: 'chat', provider: 'Google' } },
  { pattern: 'gemini-3-pro', entry: { name: 'Gemini 3 Pro', short: 'GF 3P', type: 'chat', provider: 'Google' } },
  { pattern: 'gemini-2.5-flash', entry: { name: 'Gemini 2.5 Flash', short: 'GF 2.5F', type: 'chat', provider: 'Google' } },
  { pattern: 'gemini-2.5-pro', entry: { name: 'Gemini 2.5 Pro', short: 'GF 2.5P', type: 'chat', provider: 'Google' } },
  { pattern: 'gemini-2.0-flash', entry: { name: 'Gemini 2.0 Flash', short: 'GF 2.0F', type: 'chat', provider: 'Google' } },
  { pattern: 'gemini-2.0-pro', entry: { name: 'Gemini 2.0 Pro', short: 'GF 2.0P', type: 'chat', provider: 'Google' } },
  { pattern: 'gemini-1.5-flash', entry: { name: 'Gemini 1.5 Flash', short: 'GF 1.5F', type: 'chat', provider: 'Google' } },
  { pattern: 'gemini-1.5-pro', entry: { name: 'Gemini 1.5 Pro', short: 'GF 1.5P', type: 'chat', provider: 'Google' } },
  { pattern: 'gemini-pro', entry: { name: 'Gemini Pro', type: 'chat', provider: 'Google' } },
  { pattern: 'gemini-flash', entry: { name: 'Gemini Flash', type: 'chat', provider: 'Google' } },
  // OpenAI GPT (more specific patterns first)
  { pattern: 'gpt-5.5', entry: { name: 'GPT-5.5', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-5.4', entry: { name: 'GPT-5.4', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-5.3', entry: { name: 'GPT-5.3', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-5.2', entry: { name: 'GPT-5.2', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-5.1', entry: { name: 'GPT-5.1', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-5-pro', entry: { name: 'GPT-5 Pro', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-5-mini', entry: { name: 'GPT-5 Mini', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-5-nano', entry: { name: 'GPT-5 Nano', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-5', entry: { name: 'GPT-5', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-4.1-nano', entry: { name: 'GPT-4.1 nano', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-4.1-mini', entry: { name: 'GPT-4.1 mini', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-4.1', entry: { name: 'GPT-4.1', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-4o-mini', entry: { name: 'GPT-4o mini', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-4o', entry: { name: 'GPT-4o', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-4-turbo', entry: { name: 'GPT-4 Turbo', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-4', entry: { name: 'GPT-4', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'o3-mini', entry: { name: 'o3-mini', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'o3', entry: { name: 'o3', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'o4-mini', entry: { name: 'o4-mini', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'o1-mini', entry: { name: 'o1-mini', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'o1', entry: { name: 'o1', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-3.5-turbo', entry: { name: 'GPT-3.5', type: 'chat', provider: 'OpenAI' } },
  // Claude
  { pattern: 'claude-opus-4-7', entry: { name: 'Claude 4.7 Opus', short: 'C4.7O', type: 'chat', provider: 'Anthropic' } },
  { pattern: 'claude-opus-4-6', entry: { name: 'Claude 4.6 Opus', short: 'C4.6O', type: 'chat', provider: 'Anthropic' } },
  { pattern: 'claude-opus-4-5', entry: { name: 'Claude 4.5 Opus', short: 'C4.5O', type: 'chat', provider: 'Anthropic' } },
  { pattern: 'claude-sonnet-4-6', entry: { name: 'Claude 4.6 Sonnet', short: 'C4.6S', type: 'chat', provider: 'Anthropic' } },
  { pattern: 'claude-sonnet-4-5', entry: { name: 'Claude 4.5 Sonnet', short: 'C4.5S', type: 'chat', provider: 'Anthropic' } },
  { pattern: 'claude-haiku-4-5', entry: { name: 'Claude 4.5 Haiku', short: 'C4.5H', type: 'chat', provider: 'Anthropic' } },
  { pattern: 'claude-4-sonnet', entry: { name: 'Claude 4 Sonnet', short: 'C4S', type: 'chat', provider: 'Anthropic' } },
  { pattern: 'claude-4-opus', entry: { name: 'Claude 4 Opus', short: 'C4O', type: 'chat', provider: 'Anthropic' } },
  { pattern: 'claude-3.7-sonnet', entry: { name: 'Claude 3.7 Sonnet', short: 'C3.7S', type: 'chat', provider: 'Anthropic' } },
  { pattern: 'claude-3.5-sonnet', entry: { name: 'Claude 3.5 Sonnet', short: 'C3.5S', type: 'chat', provider: 'Anthropic' } },
  { pattern: 'claude-3-opus', entry: { name: 'Claude 3 Opus', short: 'C3O', type: 'chat', provider: 'Anthropic' } },
  { pattern: 'claude-3-haiku', entry: { name: 'Claude 3 Haiku', short: 'C3H', type: 'chat', provider: 'Anthropic' } },
  // DeepSeek
  { pattern: 'deepseek-r1', entry: { name: 'DeepSeek R1', type: 'chat', provider: 'DeepSeek' } },
  { pattern: 'deepseek-v4-pro', entry: { name: 'DeepSeek V4 Pro', type: 'chat', provider: 'DeepSeek' } },
  { pattern: 'deepseek-v4-flash', entry: { name: 'DeepSeek V4 Flash', type: 'chat', provider: 'DeepSeek' } },
  { pattern: 'deepseek-v4', entry: { name: 'DeepSeek V4', type: 'chat', provider: 'DeepSeek' } },
  { pattern: 'deepseek-v3', entry: { name: 'DeepSeek V3', type: 'chat', provider: 'DeepSeek' } },
  { pattern: 'deepseek-chat', entry: { name: 'DeepSeek Chat', type: 'chat', provider: 'DeepSeek' } },
  { pattern: 'deepseek', entry: { name: 'DeepSeek', type: 'chat', provider: 'DeepSeek' } },
  // 通义千问
  { pattern: 'qwen3', entry: { name: '通义千问 3', short: 'Qwen3', type: 'chat', provider: 'Alibaba' } },
  { pattern: 'qwen2.5', entry: { name: '通义千问 2.5', short: 'Qwen2.5', type: 'chat', provider: 'Alibaba' } },
  { pattern: 'qwen2', entry: { name: '通义千问 2', short: 'Qwen2', type: 'chat', provider: 'Alibaba' } },
  { pattern: 'qwen', entry: { name: '通义千问', short: 'Qwen', type: 'chat', provider: 'Alibaba' } },
  // GLM / 智谱
  { pattern: 'glm-5.1', entry: { name: 'ChatGLM 5.1', type: 'chat', provider: 'Zhipu' } },
  { pattern: 'glm-5', entry: { name: 'ChatGLM 5', type: 'chat', provider: 'Zhipu' } },
  { pattern: 'glm-4.7', entry: { name: 'ChatGLM 4.7', type: 'chat', provider: 'Zhipu' } },
  { pattern: 'glm-4.6', entry: { name: 'ChatGLM 4.6', type: 'chat', provider: 'Zhipu' } },
  { pattern: 'glm-4', entry: { name: 'ChatGLM 4', type: 'chat', provider: 'Zhipu' } },
  { pattern: 'glm', entry: { name: 'ChatGLM', type: 'chat', provider: 'Zhipu' } },
  // 混元
  { pattern: 'hunyuan-turbos', entry: { name: '混元 Turbo S', type: 'chat', provider: 'Tencent' } },
  { pattern: 'hunyuan-turbo', entry: { name: '混元 Turbo', type: 'chat', provider: 'Tencent' } },
  { pattern: 'hunyuan-pro', entry: { name: '混元 Pro', type: 'chat', provider: 'Tencent' } },
  { pattern: 'hunyuan-lite', entry: { name: '混元 Lite', type: 'chat', provider: 'Tencent' } },
  { pattern: 'hunyuan', entry: { name: '混元', type: 'chat', provider: 'Tencent' } },
  // 豆包
  { pattern: 'doubao-1.5-pro', entry: { name: '豆包 1.5 Pro', type: 'chat', provider: 'ByteDance' } },
  { pattern: 'doubao-1.5-lite', entry: { name: '豆包 1.5 Lite', type: 'chat', provider: 'ByteDance' } },
  { pattern: 'doubao-pro', entry: { name: '豆包 Pro', type: 'chat', provider: 'ByteDance' } },
  { pattern: 'doubao-lite', entry: { name: '豆包 Lite', type: 'chat', provider: 'ByteDance' } },
  { pattern: 'doubao', entry: { name: '豆包', type: 'chat', provider: 'ByteDance' } },
  // Llama
  { pattern: 'llama-4-maverick', entry: { name: 'Llama 4 Maverick', type: 'chat', provider: 'Meta' } },
  { pattern: 'llama-4-scout', entry: { name: 'Llama 4 Scout', type: 'chat', provider: 'Meta' } },
  { pattern: 'llama-4', entry: { name: 'Llama 4', type: 'chat', provider: 'Meta' } },
  { pattern: 'llama-3.3', entry: { name: 'Llama 3.3', type: 'chat', provider: 'Meta' } },
  { pattern: 'llama-3.1', entry: { name: 'Llama 3.1', type: 'chat', provider: 'Meta' } },
  { pattern: 'llama-3', entry: { name: 'Llama 3', type: 'chat', provider: 'Meta' } },
  { pattern: 'llama', entry: { name: 'Llama', type: 'chat', provider: 'Meta' } },
  // Mistral
  { pattern: 'mistral-large', entry: { name: 'Mistral Large', type: 'chat', provider: 'Mistral' } },
  { pattern: 'mistral-medium', entry: { name: 'Mistral Medium', type: 'chat', provider: 'Mistral' } },
  { pattern: 'mistral-small', entry: { name: 'Mistral Small', type: 'chat', provider: 'Mistral' } },
  { pattern: 'mistral', entry: { name: 'Mistral', type: 'chat', provider: 'Mistral' } },
  // Kimi / Moonshot
  { pattern: 'kimi-k2', entry: { name: 'Kimi K2', type: 'chat', provider: 'Moonshot' } },
  { pattern: 'kimi-k3', entry: { name: 'Kimi K3', type: 'chat', provider: 'Moonshot' } },
  { pattern: 'moonshot', entry: { name: 'Kimi', type: 'chat', provider: 'Moonshot' } },
  { pattern: 'kimi', entry: { name: 'Kimi', type: 'chat', provider: 'Moonshot' } },
  // Yi / 零一万物
  { pattern: 'yi-lightning', entry: { name: 'Yi Lightning', type: 'chat', provider: '01.AI' } },
  { pattern: 'yi-large', entry: { name: 'Yi Large', type: 'chat', provider: '01.AI' } },
  { pattern: 'yi-medium', entry: { name: 'Yi Medium', type: 'chat', provider: '01.AI' } },
  { pattern: 'yi', entry: { name: 'Yi', type: 'chat', provider: '01.AI' } },
  // MiniMax
  { pattern: 'minimax-m2', entry: { name: 'MiniMax M2', type: 'chat', provider: 'MiniMax' } },
  { pattern: 'minimax', entry: { name: 'MiniMax', type: 'chat', provider: 'MiniMax' } },
  // Grok (xAI)
  { pattern: 'grok-4.3', entry: { name: 'Grok 4.3', type: 'chat', provider: 'xAI' } },
  { pattern: 'grok-4.20', entry: { name: 'Grok 4.20', type: 'chat', provider: 'xAI' } },
  { pattern: 'grok-4.1', entry: { name: 'Grok 4.1', type: 'chat', provider: 'xAI' } },
  { pattern: 'grok-4', entry: { name: 'Grok 4', type: 'chat', provider: 'xAI' } },
  { pattern: 'grok-3-mini', entry: { name: 'Grok 3 Mini', type: 'chat', provider: 'xAI' } },
  { pattern: 'grok-3', entry: { name: 'Grok 3', type: 'chat', provider: 'xAI' } },
  { pattern: 'grok-2-mini', entry: { name: 'Grok 2 Mini', type: 'chat', provider: 'xAI' } },
  { pattern: 'grok-2', entry: { name: 'Grok 2', type: 'chat', provider: 'xAI' } },

  // ===== 3D Models =====
  { pattern: 'hunyuan3d', entry: { name: '混元3D', type: '3d', provider: 'Tencent' } },
  { pattern: 'tripo', entry: { name: 'Tripo', type: '3d', provider: 'Tripo' } },
  { pattern: 'meshy', entry: { name: 'Meshy', type: '3d', provider: 'Meshy' } },

  // ===== Image Edit Models =====
  { pattern: 'seedvr2-upscaler', entry: { name: 'SeedVR2 Upscaler', short: 'SeedVR2 Upscaler', type: 'image', provider: 'ByteDance' } },
  { pattern: 'seedvr2', entry: { name: 'SeedVR2 Upscaler', short: 'SeedVR2 Upscaler', type: 'image', provider: 'ByteDance' } },
  { pattern: 'seedvr-upscaler', entry: { name: 'SeedVR', short: 'SeedVR', type: 'image', provider: 'ByteDance' } },
  { pattern: 'seedvr', entry: { name: 'SeedVR', short: 'SeedVR', type: 'image', provider: 'ByteDance' } },
  { pattern: 'real-esrgan', entry: { name: 'Real-ESRGAN', short: 'Real-ESRGAN', type: 'image', provider: 'AI' } },
  { pattern: 'inpainting', entry: { name: '图像修复', type: 'imageEdit' } },
  { pattern: 'outpainting', entry: { name: '图像扩展', type: 'imageEdit' } },
  { pattern: 'upscale', entry: { name: '图像放大', type: 'imageEdit' } },
  { pattern: 'rembg', entry: { name: '背景移除', type: 'imageEdit' } },
  { pattern: 'iopaint', entry: { name: 'IOPaint', type: 'imageEdit' } },
  { pattern: 'lama', entry: { name: 'LaMa', type: 'imageEdit' } },

  // ===== Vectorize Models =====
  { pattern: 'vtracer', entry: { name: 'VTracer', type: 'vectorize' } },
  { pattern: 'starvector', entry: { name: 'StarVector', type: 'vectorize' } },
  { pattern: 'vectorize', entry: { name: '矢量化', type: 'vectorize' } },

  // ===== Video Models (国内) =====
  { pattern: 'kling-v3-omni-video-generation', entry: { name: '可灵 V3 Omni 视频', short: 'Kling V3 Omni', type: 'video', provider: 'Kuaishou' } },
  { pattern: 'kling-v3-video-generation', entry: { name: '可灵 V3 视频', short: 'Kling V3', type: 'video', provider: 'Kuaishou' } },
  { pattern: 'doubao-seedance-2-3-fast', entry: { name: 'Seedance 2.3 Fast', short: 'SD 2.3F', type: 'video', provider: 'ByteDance' } },
  { pattern: 'doubao-seedance-2-3', entry: { name: 'Seedance 2.3', short: 'SD 2.3', type: 'video', provider: 'ByteDance' } },
  { pattern: 'doubao-seedance-2-0-fast', entry: { name: 'Seedance 2.0 Fast', short: 'SD 2.0F', type: 'video', provider: 'ByteDance' } },
  { pattern: 'doubao-seedance-2-0', entry: { name: 'Seedance 2.0', short: 'SD 2.0', type: 'video', provider: 'ByteDance' } },
  { pattern: 'doubao-seedance-1-0-lite', entry: { name: 'Seedance 1.0 Lite', short: 'SD 1.0L', type: 'video', provider: 'ByteDance' } },
  { pattern: 'hailuo-2.3', entry: { name: '海螺 Hailuo 2.3', short: 'Hailuo 2.3', type: 'video', provider: 'MiniMax' } },
  { pattern: 'hailuo-02', entry: { name: '海螺 Hailuo 02', short: 'Hailuo 02', type: 'video', provider: 'MiniMax' } },
  { pattern: 'video-01', entry: { name: '海螺 Video-01', short: 'Video-01', type: 'video', provider: 'MiniMax' } },
  { pattern: 'vidu-q2', entry: { name: 'Vidu Q2', short: 'Vidu Q2', type: 'video', provider: 'ShengShu' } },
  { pattern: 'vidu-q1', entry: { name: 'Vidu Q1', short: 'Vidu Q1', type: 'video', provider: 'ShengShu' } },

  // ===== Video Models (海外) =====
  { pattern: 'gen-4', entry: { name: 'Runway Gen-4', short: 'Gen-4', type: 'video', provider: 'Runway' } },
  { pattern: 'gen-3-alpha-turbo', entry: { name: 'Runway Gen-3 Turbo', short: 'Gen-3T', type: 'video', provider: 'Runway' } },
  { pattern: 'gen-3-alpha', entry: { name: 'Runway Gen-3', short: 'Gen-3', type: 'video', provider: 'Runway' } },
  { pattern: 'pika-2.2', entry: { name: 'Pika 2.2', short: 'Pika 2.2', type: 'video', provider: 'Pika' } },
  { pattern: 'pika-2.0', entry: { name: 'Pika 2.0', short: 'Pika 2.0', type: 'video', provider: 'Pika' } },
  { pattern: 'pika-1.5', entry: { name: 'Pika 1.5', short: 'Pika 1.5', type: 'video', provider: 'Pika' } },
  { pattern: 'ray3.14', entry: { name: 'Luma Ray3.14', short: 'Ray3.14', type: 'video', provider: 'Luma' } },
  { pattern: 'ray3', entry: { name: 'Luma Ray3', short: 'Ray3', type: 'video', provider: 'Luma' } },
  { pattern: 'ray2', entry: { name: 'Luma Ray2', short: 'Ray2', type: 'video', provider: 'Luma' } },
  { pattern: 'sora', entry: { name: 'OpenAI Sora', short: 'Sora', type: 'video', provider: 'OpenAI' } },
  { pattern: 'veo-3', entry: { name: 'Google Veo 3', short: 'Veo 3', type: 'video', provider: 'Google' } },
  { pattern: 'veo-2', entry: { name: 'Google Veo 2', short: 'Veo 2', type: 'video', provider: 'Google' } },

  // ===== Layer Models =====
  { pattern: 'sam2', entry: { name: 'SAM 2', type: 'layer', provider: 'Meta' } },
  { pattern: 'segment-anything', entry: { name: 'SAM', type: 'layer', provider: 'Meta' } },
  { pattern: 'yolo', entry: { name: 'YOLO', type: 'layer' } },
];

function findModelNameEntry(modelId: string): ModelNameEntry | undefined {
  const lower = modelId.toLowerCase();
  let bestMatch: { patternLength: number; entry: ModelNameEntry } | undefined;

  for (const { pattern, entry } of MODEL_NAME_MAP) {
    if (lower.includes(pattern) && pattern.length > (bestMatch?.patternLength ?? -1)) {
      bestMatch = { patternLength: pattern.length, entry };
    }
  }

  return bestMatch?.entry;
}

/**
 * Get the market common name for a model ID.
 * Returns the original ID if no mapping is found.
 */
export function getModelDisplayName(modelId: string): string {
  if (!modelId) return modelId;
  return findModelNameEntry(modelId)?.name ?? modelId;
}

/**
 * Get the short alias for a model ID.
 * Returns the market name if no short alias exists, or the original ID if no mapping.
 */
export function getModelShortName(modelId: string): string {
  if (!modelId) return modelId;
  const entry = findModelNameEntry(modelId);
  return entry?.short ?? entry?.name ?? modelId;
}

/**
 * Get the provider/brand name for a model ID.
 */
export function getModelProvider(modelId: string): string | undefined {
  if (!modelId) return undefined;
  return findModelNameEntry(modelId)?.provider;
}

/**
 * Get full model info including name, provider, and type.
 */
export function getModelInfo(modelId: string): { name: string; short: string; provider?: string; type: string } {
  if (!modelId) return { name: modelId, short: modelId, type: 'unknown' };
  const entry = findModelNameEntry(modelId);
  if (entry) {
    return {
      name: entry.name,
      short: entry.short || entry.name,
      provider: entry.provider,
      type: entry.type,
    };
  }
  return { name: modelId, short: modelId, type: 'unknown' };
}
