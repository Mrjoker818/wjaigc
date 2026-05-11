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
  type: 'image' | 'chat' | '3d' | 'imageEdit' | 'vectorize' | 'layer';
  /** Optional provider/brand */
  provider?: string;
}

/**
 * Mapping rules: key is a lowercase substring to match against model ID.
 * First match wins, so more specific patterns should come first.
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
  { pattern: 'nano-banana-2', entry: { name: 'Nano Banana 2', short: 'NB2', type: 'image', provider: 'Google' } },
  { pattern: 'nano-banana-pro', entry: { name: 'Nano Banana Pro', short: 'NB Pro', type: 'image', provider: 'Google' } },
  { pattern: 'nano-banana', entry: { name: 'Nano Banana', short: 'NB', type: 'image', provider: 'Google' } },
  { pattern: 'nanobanana2', entry: { name: 'Nano Banana 2', short: 'NB2', type: 'image', provider: 'Google' } },
  { pattern: 'nanobananapro', entry: { name: 'Nano Banana Pro', short: 'NB Pro', type: 'image', provider: 'Google' } },
  { pattern: 'nanobanana', entry: { name: 'Nano Banana', short: 'NB', type: 'image', provider: 'Google' } },
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
  { pattern: 'gpt-image-2', entry: { name: 'GPT Image 2', type: 'image', provider: 'OpenAI' } },
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
  // Seedream (字节)
  { pattern: 'seedream-4', entry: { name: 'Seedream 4', type: 'image', provider: 'ByteDance' } },
  { pattern: 'seedream-3', entry: { name: 'Seedream 3', type: 'image', provider: 'ByteDance' } },
  { pattern: 'seedream', entry: { name: 'Seedream', type: 'image', provider: 'ByteDance' } },
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
  { pattern: 'kling-v3', entry: { name: '可灵 V3', type: 'image', provider: 'Kuaishou' } },
  { pattern: 'kling-v2', entry: { name: '可灵 V2', type: 'image', provider: 'Kuaishou' } },
  { pattern: 'kling', entry: { name: '可灵', type: 'image', provider: 'Kuaishou' } },
  // HiDream
  { pattern: 'hidream', entry: { name: 'HiDream', type: 'image', provider: 'HiDream AI' } },
  // Picsart
  { pattern: 'picsart', entry: { name: 'Picsart', type: 'image', provider: 'Picsart' } },
  // Recraft
  { pattern: 'recraft-realism', entry: { name: 'Recraft Realism', type: 'image', provider: 'Recraft' } },
  { pattern: 'recraft-v3', entry: { name: 'Recraft V3', type: 'image', provider: 'Recraft' } },
  { pattern: 'recraft', entry: { name: 'Recraft', type: 'image', provider: 'Recraft' } },
  // Playground
  { pattern: 'playground-v3', entry: { name: 'Playground V3', type: 'image', provider: 'Playground' } },
  { pattern: 'playground-v2', entry: { name: 'Playground V2', type: 'image', provider: 'Playground' } },
  { pattern: 'playground', entry: { name: 'Playground', type: 'image', provider: 'Playground' } },
  // Leonardo
  { pattern: 'leonardo', entry: { name: 'Leonardo', type: 'image', provider: 'Leonardo' } },
  // Luma Photon
  { pattern: 'luma-photon', entry: { name: 'Luma Photon', type: 'image', provider: 'Luma' } },
  // Kolors (快手)
  { pattern: 'kolors', entry: { name: 'Kolors', type: 'image', provider: 'Kuaishou' } },
  // Bagel
  { pattern: 'bagel-image', entry: { name: 'Bagel Image', type: 'image', provider: 'Bagel' } },
  // StepFun Image
  { pattern: 'stepfun-image', entry: { name: '阶跃图像', type: 'image', provider: 'StepFun' } },
  // Grok Imagine
  { pattern: 'grok-imagine', entry: { name: 'Grok Imagine', type: 'image', provider: 'xAI' } },
  // Sora
  { pattern: 'sora-2-pro', entry: { name: 'Sora 2 Pro', type: 'image', provider: 'OpenAI' } },
  { pattern: 'sora-2', entry: { name: 'Sora 2', type: 'image', provider: 'OpenAI' } },
  { pattern: 'sora', entry: { name: 'Sora', type: 'image', provider: 'OpenAI' } },
  // 通义万相 Image
  { pattern: 'qwen-image-2', entry: { name: '通义万相 2.0', type: 'image', provider: 'Alibaba' } },
  { pattern: 'qwen-image', entry: { name: '通义万相', type: 'image', provider: 'Alibaba' } },
  // Wan (阿里万相视频)
  { pattern: 'wan2.7-image-pro', entry: { name: '万相 2.7 Pro', type: 'image', provider: 'Alibaba' } },
  { pattern: 'wan2.7-image', entry: { name: '万相 2.7', type: 'image', provider: 'Alibaba' } },
  { pattern: 'wan2.7', entry: { name: '万相 2.7', type: 'image', provider: 'Alibaba' } },
  // Seedance (字节)
  { pattern: 'seedance', entry: { name: 'Seedance', type: 'image', provider: 'ByteDance' } },
  // Seedream (字节)
  { pattern: 'seedream-5', entry: { name: 'Seedream 5', type: 'image', provider: 'ByteDance' } },
  { pattern: 'seedream-4', entry: { name: 'Seedream 4', type: 'image', provider: 'ByteDance' } },
  { pattern: 'seedream-3', entry: { name: 'Seedream 3', type: 'image', provider: 'ByteDance' } },
  { pattern: 'seedream', entry: { name: 'Seedream', type: 'image', provider: 'ByteDance' } },
  // Veo (Google视频)
  { pattern: 'veo3.1', entry: { name: 'Veo 3.1', type: 'image', provider: 'Google' } },
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
  // OpenAI GPT
  { pattern: 'gpt-5.4', entry: { name: 'GPT-5.4', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-5.3', entry: { name: 'GPT-5.3', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-5.2', entry: { name: 'GPT-5.2', type: 'chat', provider: 'OpenAI' } },
  { pattern: 'gpt-5.1', entry: { name: 'GPT-5.1', type: 'chat', provider: 'OpenAI' } },
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
  { pattern: 'grok-4', entry: { name: 'Grok 4', type: 'chat', provider: 'xAI' } },
  { pattern: 'grok-3', entry: { name: 'Grok 3', type: 'chat', provider: 'xAI' } },
  { pattern: 'grok-2', entry: { name: 'Grok 2', type: 'chat', provider: 'xAI' } },
  { pattern: 'grok', entry: { name: 'Grok', type: 'chat', provider: 'xAI' } },
  // Command (Cohere)
  { pattern: 'command-r-plus', entry: { name: 'Command R+', type: 'chat', provider: 'Cohere' } },
  { pattern: 'command-r', entry: { name: 'Command R', type: 'chat', provider: 'Cohere' } },
  { pattern: 'command', entry: { name: 'Command', type: 'chat', provider: 'Cohere' } },
  // Phi (Microsoft)
  { pattern: 'phi-4', entry: { name: 'Phi-4', type: 'chat', provider: 'Microsoft' } },
  { pattern: 'phi-3', entry: { name: 'Phi-3', type: 'chat', provider: 'Microsoft' } },
  { pattern: 'phi', entry: { name: 'Phi', type: 'chat', provider: 'Microsoft' } },
  // Gemma (Google)
  { pattern: 'gemma-2', entry: { name: 'Gemma 2', type: 'chat', provider: 'Google' } },
  { pattern: 'gemma', entry: { name: 'Gemma', type: 'chat', provider: 'Google' } },
  // Pixtral (Mistral)
  { pattern: 'pixtral', entry: { name: 'Pixtral', type: 'chat', provider: 'Mistral' } },
  // InternLM (上海AI实验室)
  { pattern: 'internlm', entry: { name: 'InternLM', type: 'chat', provider: 'Shanghai AI Lab' } },
  // StepFun (阶跃星辰)
  { pattern: 'step-2', entry: { name: '阶跃 Step-2', type: 'chat', provider: 'StepFun' } },
  { pattern: 'step-1', entry: { name: '阶跃 Step-1', type: 'chat', provider: 'StepFun' } },
  // StarCoder
  { pattern: 'starcoder', entry: { name: 'StarCoder', type: 'chat', provider: 'BigCode' } },
  // CodeLlama
  { pattern: 'codellama', entry: { name: 'Code Llama', type: 'chat', provider: 'Meta' } },
  // Spark (讯飞星火)
  { pattern: 'spark-4', entry: { name: '星火 4.0', type: 'chat', provider: 'iFLYTEK' } },
  { pattern: 'spark', entry: { name: '星火', type: 'chat', provider: 'iFLYTEK' } },
  // Ernie (文心一言)
  { pattern: 'ernie-4', entry: { name: '文心 4.0', type: 'chat', provider: 'Baidu' } },
  { pattern: 'ernie', entry: { name: '文心', type: 'chat', provider: 'Baidu' } },

  // ===== 3D Models =====
  { pattern: 'hunyuan3d', entry: { name: '混元3D', type: '3d', provider: 'Tencent' } },
  { pattern: 'tripo', entry: { name: 'Tripo', type: '3d', provider: 'Tripo' } },
  { pattern: 'meshy', entry: { name: 'Meshy', type: '3d', provider: 'Meshy' } },

  // ===== Image Edit Models =====
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

  // ===== Layer Models =====
  { pattern: 'sam2', entry: { name: 'SAM 2', type: 'layer', provider: 'Meta' } },
  { pattern: 'segment-anything', entry: { name: 'SAM', type: 'layer', provider: 'Meta' } },
  { pattern: 'yolo', entry: { name: 'YOLO', type: 'layer' } },
];

/**
 * Get the market common name for a model ID.
 * Returns the original ID if no mapping is found.
 */
export function getModelDisplayName(modelId: string): string {
  if (!modelId) return modelId;
  const lower = modelId.toLowerCase();
  for (const { pattern, entry } of MODEL_NAME_MAP) {
    if (lower.includes(pattern)) {
      return entry.name;
    }
  }
  return modelId;
}

/**
 * Get the short alias for a model ID.
 * Returns the market name if no short alias exists, or the original ID if no mapping.
 */
export function getModelShortName(modelId: string): string {
  if (!modelId) return modelId;
  const lower = modelId.toLowerCase();
  for (const { pattern, entry } of MODEL_NAME_MAP) {
    if (lower.includes(pattern)) {
      return entry.short || entry.name;
    }
  }
  return modelId;
}

/**
 * Get the provider/brand name for a model ID.
 */
export function getModelProvider(modelId: string): string | undefined {
  if (!modelId) return undefined;
  const lower = modelId.toLowerCase();
  for (const { pattern, entry } of MODEL_NAME_MAP) {
    if (lower.includes(pattern)) {
      return entry.provider;
    }
  }
  return undefined;
}

/**
 * Get full model info including name, provider, and type.
 */
export function getModelInfo(modelId: string): { name: string; short: string; provider?: string; type: string } {
  if (!modelId) return { name: modelId, short: modelId, type: 'unknown' };
  const lower = modelId.toLowerCase();
  for (const { pattern, entry } of MODEL_NAME_MAP) {
    if (lower.includes(pattern)) {
      return {
        name: entry.name,
        short: entry.short || entry.name,
        provider: entry.provider,
        type: entry.type,
      };
    }
  }
  return { name: modelId, short: modelId, type: 'unknown' };
}
