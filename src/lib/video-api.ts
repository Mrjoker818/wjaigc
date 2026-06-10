/**
 * 视频生成 API 通用调用层
 * 支持 6 种协议适配：dashscope / volcengine-ark / minimax / vidu / openai-video / fal-video / rest-generic / custom
 * 所有视频 API 统一采用"异步提交 + 轮询结果"模式
 */

// ==================== Types ====================

export type VideoCompatProfile =
  | 'dashscope'       // 阿里云百炼 (可灵等)
  | 'volcengine-ark'  // 火山引擎方舟 (Seedance等)
  | 'minimax'         // MiniMax自有协议 (海螺等)
  | 'vidu'            // Vidu自有协议
  | 'openai-video'    // OpenAI /v1/videos (Sora等)
  | 'fal-video'       // fal.ai托管 (Pika等)
  | 'rest-generic'    // 通用REST (Runway/Luma/Google等)
  | 'custom';         // 管理员自定义

export interface VideoModelFeatures {
  firstLastFrame: boolean;    // 是否支持首尾帧
  multiReference: boolean;    // 是否支持多参考图
  videoEdit: boolean;         // 是否支持视频编辑
  videoExtend: boolean;       // 是否支持视频延长
  audio: boolean;             // 是否支持音效生成
  maxDuration: number;        // 最大时长(秒)
  ratios: string[];           // 支持的画面比例
  resolutions: string[];      // 支持的分辨率
  region: 'cn' | 'global';   // 国内/海外
}

export interface VideoModelInfo {
  profile: VideoCompatProfile;
  name: string;
  short: string;
  provider: string;
  features: VideoModelFeatures;
}

export interface VideoGenerateParams {
  prompt: string;
  model: string;
  imageUrl?: string;             // 首帧图片 URL (图生视频)
  lastFrameImageUrl?: string;   // 尾帧图片 URL (首尾帧模式)
  referenceImages?: string[];   // 多参考图 (可灵/Seedance/Vidu/Pika)
  aspectRatio?: string;         // 画面比例 (如 "16:9")
  duration?: number;            // 视频时长(秒)
  mode?: 'std' | 'pro';        // 生成模式 (标准/高品质)
  generateAudio?: boolean;      // 是否生成音效
  action?: 'generate' | 'extend' | 'edit'; // 操作类型: 生成/延长/编辑
  videoUrl?: string;            // 延长/编辑源视频 URL
  extendDuration?: number;      // 延长时长(秒)
  negativePrompt?: string;      // 反向提示词
  seed?: number;                // 随机种子
  providerId?: string;          // 提供商ID
  apiKey?: string;              // API密钥
  baseUrl?: string;             // API基础URL
}

export interface VideoTaskSubmitResult {
  taskId: string;
  status: 'queued' | 'submitted';
  estimatedTime?: number;  // 预估完成时间(秒)
}

export interface VideoTaskPollResult {
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress?: number;       // 0-100
  videoUrl?: string;       // 视频文件URL
  thumbnailUrl?: string;   // 封面帧URL
  watermarkVideoUrl?: string; // 带水印视频URL (可灵)
  duration?: number;       // 实际视频时长
  resolution?: string;     // 实际分辨率
  error?: string;
}

// ==================== Model Registry ====================

const VIDEO_MODEL_REGISTRY: Record<string, VideoModelInfo> = {
  // === 国内模型 ===
  'kling-v3-video-generation': {
    profile: 'dashscope', name: '可灵 V3 视频', short: 'Kling V3', provider: 'Kuaishou',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, maxDuration: 10, ratios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'], region: 'cn' },
  },
  'kling-v3-omni-video-generation': {
    profile: 'dashscope', name: '可灵 V3 Omni 视频', short: 'Kling V3 Omni', provider: 'Kuaishou',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, maxDuration: 10, ratios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'], region: 'cn' },
  },
  'doubao-seedance-2-0': {
    profile: 'volcengine-ark', name: 'Seedance 2.0', short: 'SD 2.0', provider: 'ByteDance',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, maxDuration: 10, ratios: ['1:1','4:3','3:4','16:9','9:16','21:9'], resolutions: ['480p','720p','1080p'], region: 'cn' },
  },
  'doubao-seedance-2-0-fast': {
    profile: 'volcengine-ark', name: 'Seedance 2.0 Fast', short: 'SD 2.0F', provider: 'ByteDance',
    features: { firstLastFrame: true, multiReference: true, videoEdit: false, videoExtend: true, audio: true, maxDuration: 10, ratios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['480p','720p','1080p'], region: 'cn' },
  },
  'doubao-seedance-2-3': {
    profile: 'volcengine-ark', name: 'Seedance 2.3', short: 'SD 2.3', provider: 'ByteDance',
    features: { firstLastFrame: true, multiReference: true, videoEdit: true, videoExtend: true, audio: true, maxDuration: 10, ratios: ['1:1','4:3','3:4','16:9','9:16','21:9'], resolutions: ['768p','1080p'], region: 'cn' },
  },
  'doubao-seedance-2-3-fast': {
    profile: 'volcengine-ark', name: 'Seedance 2.3 Fast', short: 'SD 2.3F', provider: 'ByteDance',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, maxDuration: 10, ratios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['768p','1080p'], region: 'cn' },
  },
  'doubao-seedance-1-0-lite': {
    profile: 'volcengine-ark', name: 'Seedance 1.0 Lite', short: 'SD 1.0L', provider: 'ByteDance',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, maxDuration: 10, ratios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['480p','720p'], region: 'cn' },
  },
  'hailuo-02': {
    profile: 'minimax', name: '海螺 Hailuo 02', short: 'Hailuo 02', provider: 'MiniMax',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: false, maxDuration: 10, ratios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['512p','768p','1080p'], region: 'cn' },
  },
  'hailuo-2.3': {
    profile: 'minimax', name: '海螺 Hailuo 2.3', short: 'Hailuo 2.3', provider: 'MiniMax',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, maxDuration: 10, ratios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['768p','1080p'], region: 'cn' },
  },
  'video-01': {
    profile: 'minimax', name: '海螺 Video-01', short: 'Video-01', provider: 'MiniMax',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, maxDuration: 5, ratios: ['1:1','4:3','3:4','16:9','9:16'], resolutions: ['720p'], region: 'cn' },
  },
  'vidu-q1': {
    profile: 'vidu', name: 'Vidu Q1', short: 'Vidu Q1', provider: 'ShengShu',
    features: { firstLastFrame: true, multiReference: true, videoEdit: false, videoExtend: true, audio: true, maxDuration: 8, ratios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'], region: 'cn' },
  },
  'vidu-q2': {
    profile: 'vidu', name: 'Vidu Q2', short: 'Vidu Q2', provider: 'ShengShu',
    features: { firstLastFrame: true, multiReference: true, videoEdit: false, videoExtend: true, audio: true, maxDuration: 8, ratios: ['1:1','4:3','16:9','9:16'], resolutions: ['720p','1080p'], region: 'cn' },
  },
  // === 海外模型 ===
  'gen-4': {
    profile: 'rest-generic', name: 'Runway Gen-4', short: 'Gen-4', provider: 'Runway',
    features: { firstLastFrame: true, multiReference: false, videoEdit: true, videoExtend: true, audio: false, maxDuration: 10, ratios: ['16:9','9:16','1:1','4:3','3:4'], resolutions: ['720p','1080p','4K'], region: 'global' },
  },
  'gen-3-alpha-turbo': {
    profile: 'rest-generic', name: 'Runway Gen-3 Turbo', short: 'Gen-3T', provider: 'Runway',
    features: { firstLastFrame: true, multiReference: false, videoEdit: true, videoExtend: true, audio: false, maxDuration: 10, ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'gen-3-alpha': {
    profile: 'rest-generic', name: 'Runway Gen-3', short: 'Gen-3', provider: 'Runway',
    features: { firstLastFrame: true, multiReference: false, videoEdit: true, videoExtend: true, audio: false, maxDuration: 10, ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'pika-2.2': {
    profile: 'fal-video', name: 'Pika 2.2', short: 'Pika 2.2', provider: 'Pika',
    features: { firstLastFrame: false, multiReference: true, videoEdit: true, videoExtend: false, audio: false, maxDuration: 10, ratios: ['16:9','9:16','1:1','4:5','5:4','3:2','2:3'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'pika-2.0': {
    profile: 'fal-video', name: 'Pika 2.0', short: 'Pika 2.0', provider: 'Pika',
    features: { firstLastFrame: false, multiReference: true, videoEdit: true, videoExtend: false, audio: false, maxDuration: 10, ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'pika-1.5': {
    profile: 'fal-video', name: 'Pika 1.5', short: 'Pika 1.5', provider: 'Pika',
    features: { firstLastFrame: false, multiReference: false, videoEdit: false, videoExtend: false, audio: false, maxDuration: 5, ratios: ['16:9','9:16','1:1'], resolutions: ['720p'], region: 'global' },
  },
  'ray3.14': {
    profile: 'rest-generic', name: 'Luma Ray3.14', short: 'Ray3.14', provider: 'Luma',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: true, audio: false, maxDuration: 10, ratios: ['16:9','9:16','1:1','4:3','3:4'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'ray3': {
    profile: 'rest-generic', name: 'Luma Ray3', short: 'Ray3', provider: 'Luma',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: true, audio: false, maxDuration: 10, ratios: ['16:9','9:16','1:1','4:3','3:4'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'ray2': {
    profile: 'rest-generic', name: 'Luma Ray2', short: 'Ray2', provider: 'Luma',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: true, audio: false, maxDuration: 5, ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'sora': {
    profile: 'openai-video', name: 'OpenAI Sora', short: 'Sora', provider: 'OpenAI',
    features: { firstLastFrame: false, multiReference: false, videoEdit: true, videoExtend: true, audio: true, maxDuration: 20, ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'veo-3': {
    profile: 'rest-generic', name: 'Google Veo 3', short: 'Veo 3', provider: 'Google',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: true, maxDuration: 8, ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
  'veo-2': {
    profile: 'rest-generic', name: 'Google Veo 2', short: 'Veo 2', provider: 'Google',
    features: { firstLastFrame: true, multiReference: false, videoEdit: false, videoExtend: false, audio: false, maxDuration: 8, ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], region: 'global' },
  },
};

/**
 * Get video model info by model ID.
 * Falls back to generic info if model is not in the registry.
 */
export function getVideoModelInfo(modelId: string): VideoModelInfo | null {
  if (!modelId) return null;
  // Exact match
  if (VIDEO_MODEL_REGISTRY[modelId]) return VIDEO_MODEL_REGISTRY[modelId];
  // Case-insensitive partial match
  const lower = modelId.toLowerCase();
  for (const [key, info] of Object.entries(VIDEO_MODEL_REGISTRY)) {
    if (lower.includes(key) || key.includes(lower)) return info;
  }
  // Keyword-based inference
  return inferVideoModelFromKeywords(modelId);
}

function inferVideoModelFromKeywords(modelId: string): VideoModelInfo | null {
  const lower = modelId.toLowerCase();
  let profile: VideoCompatProfile = 'rest-generic';
  let region: 'cn' | 'global' = 'global';

  if (lower.includes('kling') || lower.includes('dashscope') || lower.includes('qwen')) {
    profile = 'dashscope'; region = 'cn';
  } else if (lower.includes('seedance') || lower.includes('doubao') || lower.includes('volcengine') || lower.includes('ark')) {
    profile = 'volcengine-ark'; region = 'cn';
  } else if (lower.includes('minimax') || lower.includes('hailuo') || lower.includes('video-01')) {
    profile = 'minimax'; region = 'cn';
  } else if (lower.includes('vidu')) {
    profile = 'vidu'; region = 'cn';
  } else if (lower.includes('sora') || lower.includes('openai')) {
    profile = 'openai-video';
  } else if (lower.includes('pika') || lower.includes('fal')) {
    profile = 'fal-video';
  } else if (lower.includes('runway') || lower.includes('gen-')) {
    profile = 'rest-generic';
  } else if (lower.includes('luma') || lower.includes('ray')) {
    profile = 'rest-generic';
  } else if (lower.includes('veo') || lower.includes('google')) {
    profile = 'rest-generic';
  } else {
    // Unknown model, default to rest-generic
    if (lower.includes('ali') || lower.includes('baidu') || lower.includes('tencent')) {
      region = 'cn';
    }
  }

  return {
    profile,
    name: modelId,
    short: modelId,
    provider: 'Unknown',
    features: {
      firstLastFrame: false,
      multiReference: false,
      videoEdit: false,
      videoExtend: false,
      audio: false,
      maxDuration: 10,
      ratios: ['1:1', '4:3', '16:9', '9:16'],
      resolutions: ['720p', '1080p'],
      region,
    },
  };
}

/**
 * Resolve the video compat profile for a model ID and base URL.
 * Can be overridden by the provider's advancedParams.compatProfile.
 */
export function resolveVideoCompatProfile(
  modelId: string,
  compatProfileOverride?: string,
  baseUrl?: string,
): VideoCompatProfile {
  if (compatProfileOverride && compatProfileOverride !== 'auto') {
    return compatProfileOverride as VideoCompatProfile;
  }
  const info = getVideoModelInfo(modelId);
  if (info) return info.profile;
  // Fallback: infer from baseUrl
  if (baseUrl) {
    const urlLower = baseUrl.toLowerCase();
    if (urlLower.includes('dashscope') || urlLower.includes('aliyun')) return 'dashscope';
    if (urlLower.includes('volcengine') || urlLower.includes('ark')) return 'volcengine-ark';
    if (urlLower.includes('minimax') || urlLower.includes('hailuo')) return 'minimax';
    if (urlLower.includes('vidu')) return 'vidu';
    if (urlLower.includes('fal.run')) return 'fal-video';
    if (urlLower.includes('openai')) return 'openai-video';
  }
  return 'rest-generic';
}

// ==================== Protocol Adapters ====================

/**
 * Build the submit request for a video generation task.
 * Returns { url, headers, body } ready for fetch().
 */
export function buildVideoSubmitRequest(
  profile: VideoCompatProfile,
  params: VideoGenerateParams,
): { url: string; headers: Record<string, string>; body: string; method: string } {
  const baseUrl = (params.baseUrl || '').replace(/\/+$/, '');
  const apiKey = params.apiKey || '';

  switch (profile) {
    case 'dashscope':
      return buildDashscopeSubmit(baseUrl, apiKey, params);
    case 'volcengine-ark':
      return buildVolcengineSubmit(baseUrl, apiKey, params);
    case 'minimax':
      return buildMinimaxSubmit(baseUrl, apiKey, params);
    case 'vidu':
      return buildViduSubmit(baseUrl, apiKey, params);
    case 'openai-video':
      return buildOpenAIVideoSubmit(baseUrl, apiKey, params);
    case 'fal-video':
      return buildFalVideoSubmit(baseUrl, apiKey, params);
    case 'rest-generic':
    default:
      return buildRestGenericSubmit(baseUrl, apiKey, params);
  }
}

/**
 * Parse the submit response to extract the task ID.
 */
export function parseVideoSubmitResponse(
  profile: VideoCompatProfile,
  data: any,
): VideoTaskSubmitResult {
  switch (profile) {
    case 'dashscope':
      return {
        taskId: data?.output?.task_id || data?.request_id || '',
        status: 'submitted',
        estimatedTime: 120,
      };
    case 'volcengine-ark':
      return {
        taskId: data?.id || '',
        status: 'submitted',
        estimatedTime: 120,
      };
    case 'minimax':
      return {
        taskId: data?.task_id || '',
        status: 'submitted',
        estimatedTime: 90,
      };
    case 'vidu':
      return {
        taskId: data?.task_id || data?.id || '',
        status: 'submitted',
        estimatedTime: 90,
      };
    case 'openai-video':
      return {
        taskId: data?.id || '',
        status: 'submitted',
        estimatedTime: 120,
      };
    case 'fal-video':
      return {
        taskId: data?.request_id || data?.id || '',
        status: 'submitted',
        estimatedTime: 90,
      };
    case 'rest-generic':
    default:
      return {
        taskId: data?.task_id || data?.id || data?.request_id || '',
        status: 'submitted',
        estimatedTime: 120,
      };
  }
}

/**
 * Build the poll request for a video task.
 */
export function buildVideoPollRequest(
  profile: VideoCompatProfile,
  baseUrl: string,
  apiKey: string,
  taskId: string,
): { url: string; headers: Record<string, string>; method: string } {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');

  switch (profile) {
    case 'dashscope':
      return {
        url: `${cleanBaseUrl}/api/v1/tasks/${taskId}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        method: 'GET',
      };
    case 'volcengine-ark':
      return {
        url: `${cleanBaseUrl}/contents/generations/tasks/${taskId}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        method: 'GET',
      };
    case 'minimax':
      return {
        url: `${cleanBaseUrl}/v1/video_generation?task_id=${taskId}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        method: 'GET',
      };
    case 'vidu':
      return {
        url: `${cleanBaseUrl}/api/v1/video/tasks/${taskId}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        method: 'GET',
      };
    case 'openai-video':
      return {
        url: `${cleanBaseUrl}/v1/videos/${taskId}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        method: 'GET',
      };
    case 'fal-video':
      return {
        url: `${cleanBaseUrl}/requests/${taskId}/status`,
        headers: { 'Authorization': `Key ${apiKey}` },
        method: 'GET',
      };
    case 'rest-generic':
    default:
      return {
        url: `${cleanBaseUrl}/tasks/${taskId}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        method: 'GET',
      };
  }
}

/**
 * Parse the poll response to extract task status and video URL.
 */
export function parseVideoPollResponse(
  profile: VideoCompatProfile,
  data: any,
): VideoTaskPollResult {
  switch (profile) {
    case 'dashscope':
      return parseDashscopePoll(data);
    case 'volcengine-ark':
      return parseVolcenginePoll(data);
    case 'minimax':
      return parseMinimaxPoll(data);
    case 'vidu':
      return parseViduPoll(data);
    case 'openai-video':
      return parseOpenAIVideoPoll(data);
    case 'fal-video':
      return parseFalVideoPoll(data);
    case 'rest-generic':
    default:
      return parseRestGenericPoll(data);
  }
}

// ==================== Protocol-Specific Builders ====================

function buildDashscopeSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const media: Array<{ type: string; url: string; role?: string }> = [];
  if (params.imageUrl) {
    media.push({ type: 'image', url: params.imageUrl, role: 'first_frame' });
  }
  if (params.lastFrameImageUrl) {
    media.push({ type: 'image', url: params.lastFrameImageUrl, role: 'last_frame' });
  }
  if (params.referenceImages?.length) {
    params.referenceImages.forEach((url, i) => {
      media.push({ type: 'image', url, role: `reference_${i + 1}` });
    });
  }

  const body: Record<string, any> = {
    model: params.model,
    input: {
      prompt: params.prompt,
      ...(media.length > 0 ? { media } : {}),
      ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
    },
    parameters: {
      ...(params.mode ? { mode: params.mode } : { mode: 'std' }),
      ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
      ...(params.duration ? { duration: params.duration } : {}),
      ...(params.generateAudio ? { audio: true } : {}),
    },
  };

  return {
    url: `${baseUrl}/api/v1/services/aigc/video-generation/video-synthesis`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildVolcengineSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const content: Array<Record<string, any>> = [
    { type: 'text', text: params.prompt },
  ];
  if (params.imageUrl) {
    content.push({ type: 'image_url', image_url: { url: params.imageUrl, role: 'first_frame' } });
  }
  if (params.lastFrameImageUrl) {
    content.push({ type: 'image_url', image_url: { url: params.lastFrameImageUrl, role: 'last_frame' } });
  }
  if (params.referenceImages?.length) {
    params.referenceImages.forEach((url) => {
      content.push({ type: 'image_url', image_url: { url } });
    });
  }

  const body: Record<string, any> = {
    model: params.model,
    content,
    ...(params.aspectRatio ? { ratio: params.aspectRatio } : {}),
    ...(params.duration ? { duration: params.duration } : {}),
    ...(params.generateAudio ? { generate_audio: true } : {}),
  };

  return {
    url: `${baseUrl}/contents/generations/tasks`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildMinimaxSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt,
    ...(params.imageUrl ? { first_frame_image: params.imageUrl } : {}),
    ...(params.lastFrameImageUrl ? { last_frame_image: params.lastFrameImageUrl } : {}),
    ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
    ...(params.duration ? { duration: params.duration } : {}),
  };

  return {
    url: `${baseUrl}/v1/video_generation`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildViduSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const images: Array<{ url: string; role?: string }> = [];
  if (params.imageUrl) {
    images.push({ url: params.imageUrl, role: 'first_frame' });
  }
  if (params.lastFrameImageUrl) {
    images.push({ url: params.lastFrameImageUrl, role: 'last_frame' });
  }
  if (params.referenceImages?.length) {
    params.referenceImages.forEach((url, i) => {
      images.push({ url, role: `reference_${i + 1}` });
    });
  }

  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt,
    ...(images.length > 0 ? { images } : {}),
    ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
    ...(params.duration ? { duration: params.duration } : {}),
    ...(params.generateAudio ? { audio: true } : {}),
  };

  return {
    url: `${baseUrl}/api/v1/video/generate`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildOpenAIVideoSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt,
    ...(params.imageUrl ? { image_url: params.imageUrl } : {}),
    ...(params.aspectRatio ? { size: params.aspectRatio } : {}),
    ...(params.duration ? { duration: params.duration } : {}),
    n: 1,
  };

  return {
    url: `${baseUrl}/v1/videos`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildFalVideoSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  // fal.ai uses a queue-based pattern
  const body: Record<string, any> = {
    prompt: params.prompt,
    ...(params.imageUrl ? { image_url: params.imageUrl } : {}),
    ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
    ...(params.duration ? { duration: params.duration } : {}),
  };

  // fal.ai URLs are like: https://queue.fal.run/{model_id}
  const submitUrl = baseUrl.includes('fal.run')
    ? `${baseUrl}/${params.model}`
    : `${baseUrl}/queue/${params.model}`;

  return {
    url: submitUrl,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildRestGenericSubmit(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt,
    ...(params.imageUrl ? { image_url: params.imageUrl } : {}),
    ...(params.lastFrameImageUrl ? { last_frame_image_url: params.lastFrameImageUrl } : {}),
    ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
    ...(params.duration ? { duration: params.duration } : {}),
    ...(params.mode ? { mode: params.mode } : {}),
    ...(params.generateAudio ? { audio: true } : {}),
    ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
    ...(params.seed !== undefined ? { seed: params.seed } : {}),
  };

  return {
    url: `${baseUrl}/v1/video/generations`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

// ==================== Protocol-Specific Parsers ====================

function parseDashscopePoll(data: any): VideoTaskPollResult {
  const status = data?.output?.task_status || '';
  const videoResult = data?.output?.video_result?.[0];

  if (status === 'SUCCEEDED') {
    return {
      status: 'succeeded',
      progress: 100,
      videoUrl: videoResult?.video_url,
      watermarkVideoUrl: videoResult?.watermark_video_url,
      duration: videoResult?.duration,
    };
  } else if (status === 'FAILED') {
    return {
      status: 'failed',
      error: data?.output?.message || data?.message || 'Video generation failed',
    };
  } else if (status === 'RUNNING' || status === 'PENDING') {
    return {
      status: status === 'RUNNING' ? 'running' : 'pending',
      progress: status === 'RUNNING' ? 50 : 10,
    };
  }
  return { status: 'pending', progress: 0 };
}

function parseVolcenginePoll(data: any): VideoTaskPollResult {
  const status = data?.status || '';
  const content = data?.content;

  if (status === 'succeeded') {
    return {
      status: 'succeeded',
      progress: 100,
      videoUrl: content?.video_url,
      duration: content?.duration,
    };
  } else if (status === 'failed') {
    return {
      status: 'failed',
      error: data?.error?.message || data?.message || 'Video generation failed',
    };
  } else if (status === 'running' || status === 'queued') {
    return {
      status: status === 'running' ? 'running' : 'pending',
      progress: status === 'running' ? 50 : 10,
    };
  }
  return { status: 'pending', progress: 0 };
}

function parseMinimaxPoll(data: any): VideoTaskPollResult {
  const status = data?.status || data?.task_status || '';

  if (status === 'succeeded' || status === 'Success' || status === 'done') {
    return {
      status: 'succeeded',
      progress: 100,
      videoUrl: data?.video_url || data?.file_id,
      duration: data?.duration,
    };
  } else if (status === 'failed' || status === 'Fail' || status === 'error') {
    return {
      status: 'failed',
      error: data?.error?.message || data?.message || 'Video generation failed',
    };
  } else if (status === 'running' || status === 'processing' || status === 'Queueing') {
    return {
      status: status === 'Queueing' ? 'pending' : 'running',
      progress: status === 'Queueing' ? 10 : 50,
    };
  }
  return { status: 'pending', progress: 0 };
}

function parseViduPoll(data: any): VideoTaskPollResult {
  const status = data?.status || '';

  if (status === 'success' || status === 'succeeded') {
    return {
      status: 'succeeded',
      progress: 100,
      videoUrl: data?.video_url || data?.result?.video_url,
      duration: data?.duration,
    };
  } else if (status === 'failed' || status === 'error') {
    return {
      status: 'failed',
      error: data?.error || data?.message || 'Video generation failed',
    };
  } else if (status === 'processing' || status === 'running' || status === 'pending') {
    return {
      status: status === 'pending' ? 'pending' : 'running',
      progress: status === 'pending' ? 10 : 50,
    };
  }
  return { status: 'pending', progress: 0 };
}

function parseOpenAIVideoPoll(data: any): VideoTaskPollResult {
  const status = data?.status || '';

  if (status === 'completed' || status === 'succeeded') {
    const videoData = data?.data?.[0] || data;
    return {
      status: 'succeeded',
      progress: 100,
      videoUrl: videoData?.url || videoData?.video_url,
      duration: videoData?.duration,
    };
  } else if (status === 'failed' || status === 'error') {
    return {
      status: 'failed',
      error: data?.error?.message || data?.last_error?.message || 'Video generation failed',
    };
  } else if (status === 'processing' || status === 'running' || status === 'queued' || status === 'in_progress') {
    return {
      status: status === 'queued' || status === 'in_progress' ? 'pending' : 'running',
      progress: status === 'queued' ? 10 : 50,
    };
  }
  return { status: 'pending', progress: 0 };
}

function parseFalVideoPoll(data: any): VideoTaskPollResult {
  const status = data?.status || '';

  if (status === 'COMPLETED' || status === 'completed' || status === 'succeeded') {
    const output = data?.output || data;
    return {
      status: 'succeeded',
      progress: 100,
      videoUrl: output?.video_url || output?.url,
      duration: output?.duration,
    };
  } else if (status === 'FAILED' || status === 'failed') {
    return {
      status: 'failed',
      error: data?.error || data?.message || 'Video generation failed',
    };
  } else if (status === 'IN_PROGRESS' || status === 'in_progress' || status === 'running') {
    return {
      status: 'running',
      progress: data?.progress ? Math.round(data.progress * 100) : 50,
    };
  }
  return { status: 'pending', progress: 0 };
}

function parseRestGenericPoll(data: any): VideoTaskPollResult {
  const status = (data?.status || data?.task_status || '').toLowerCase();

  if (status === 'succeeded' || status === 'completed' || status === 'success' || status === 'done') {
    const result = data?.result || data?.output || data?.data?.[0] || data;
    return {
      status: 'succeeded',
      progress: 100,
      videoUrl: result?.video_url || result?.url || result?.content?.video_url,
      duration: result?.duration,
    };
  } else if (status === 'failed' || status === 'error') {
    return {
      status: 'failed',
      error: data?.error?.message || data?.message || 'Video generation failed',
    };
  } else if (status === 'running' || status === 'processing') {
    return {
      status: 'running',
      progress: data?.progress ? Math.round(data.progress * 100) : 50,
    };
  } else if (status === 'pending' || status === 'queued') {
    return { status: 'pending', progress: 10 };
  }
  return { status: 'pending', progress: 0 };
}

// ==================== Video Extend Protocol Adapters ====================

/**
 * Build the submit request for a video extend task.
 * Extends an existing video by generating additional frames.
 */
export function buildVideoExtendRequest(
  profile: VideoCompatProfile,
  params: VideoGenerateParams,
): { url: string; headers: Record<string, string>; body: string; method: string } {
  const baseUrl = (params.baseUrl || '').replace(/\/+$/, '');
  const apiKey = params.apiKey || '';

  switch (profile) {
    case 'dashscope':
      return buildDashscopeExtend(baseUrl, apiKey, params);
    case 'volcengine-ark':
      return buildVolcengineExtend(baseUrl, apiKey, params);
    case 'vidu':
      return buildViduExtend(baseUrl, apiKey, params);
    case 'openai-video':
      return buildOpenAIVideoExtend(baseUrl, apiKey, params);
    case 'fal-video':
      return buildFalVideoExtend(baseUrl, apiKey, params);
    case 'minimax':
    case 'rest-generic':
    default:
      return buildRestGenericExtend(baseUrl, apiKey, params);
  }
}

function buildDashscopeExtend(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const body: Record<string, any> = {
    model: params.model,
    input: {
      video_url: params.videoUrl,
      prompt: params.prompt || '请延长视频',
    },
    parameters: {
      ...(params.extendDuration ? { duration: params.extendDuration } : { duration: 5 }),
      ...(params.generateAudio ? { audio: true } : {}),
    },
  };

  return {
    url: `${baseUrl}/api/v1/services/aigc/video-generation/video-extension`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildVolcengineExtend(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const content: Array<Record<string, any>> = [
    { type: 'text', text: params.prompt || '请延长视频' },
  ];
  if (params.videoUrl) {
    content.push({ type: 'video_url', video_url: { url: params.videoUrl } });
  }

  const body: Record<string, any> = {
    model: params.model,
    content,
    action: 'extend',
    ...(params.extendDuration ? { duration: params.extendDuration } : { duration: 5 }),
    ...(params.generateAudio ? { generate_audio: true } : {}),
  };

  return {
    url: `${baseUrl}/contents/generations/tasks`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildViduExtend(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt || '请延长视频',
    video_url: params.videoUrl,
    ...(params.extendDuration ? { duration: params.extendDuration } : { duration: 4 }),
    ...(params.generateAudio ? { audio: true } : {}),
  };

  return {
    url: `${baseUrl}/api/v1/video/extend`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildOpenAIVideoExtend(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt || 'Extend this video',
    video_url: params.videoUrl,
    ...(params.extendDuration ? { duration: params.extendDuration } : {}),
    n: 1,
  };

  return {
    url: `${baseUrl}/v1/videos`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildFalVideoExtend(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const body: Record<string, any> = {
    prompt: params.prompt || 'Extend this video',
    video_url: params.videoUrl,
    ...(params.extendDuration ? { duration: params.extendDuration } : {}),
  };

  const submitUrl = baseUrl.includes('fal.run')
    ? `${baseUrl}/${params.model}`
    : `${baseUrl}/queue/${params.model}`;

  return {
    url: submitUrl,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

function buildRestGenericExtend(baseUrl: string, apiKey: string, params: VideoGenerateParams) {
  const body: Record<string, any> = {
    model: params.model,
    prompt: params.prompt || '请延长视频',
    video_url: params.videoUrl,
    action: 'extend',
    ...(params.extendDuration ? { duration: params.extendDuration } : { duration: 5 }),
    ...(params.generateAudio ? { audio: true } : {}),
  };

  return {
    url: `${baseUrl}/v1/video/extend`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    method: 'POST',
  };
}

// ==================== Utility Functions ====================

/**
 * Check if a model ID is likely a video model.
 */
export function isVideoModel(modelId: string): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  return lower.includes('video') ||
    lower.includes('seedance') ||
    lower.includes('kling-v3') ||
    lower.includes('hailuo') ||
    lower.includes('vidu') ||
    lower.includes('sora') ||
    lower.includes('veo') ||
    lower.includes('pika') ||
    lower.includes('ray2') ||
    lower.includes('ray3') ||
    lower.includes('gen-3') ||
    lower.includes('gen-4');
}

/**
 * Get the default aspect ratios for video generation.
 */
export function getDefaultVideoRatios(): string[] {
  return ['1:1', '4:3', '16:9', '9:16', '21:9'];
}

/**
 * Get the default durations for video generation.
 */
export function getDefaultVideoDurations(): number[] {
  return [5, 10];
}

/**
 * Map aspect ratio to approximate pixel dimensions for video.
 */
export function getVideoPixelSize(aspectRatio: string, resolution: string = '1080p'): { width: number; height: number } {
  const [w, h] = aspectRatio.split(':').map(Number);
  const baseHeight = resolution === '720p' ? 720 : resolution === '1080p' ? 1080 : resolution === '4K' ? 2160 : 1080;
  const baseWidth = Math.round(baseHeight * w / h);
  // Round to nearest multiple of 8
  return {
    width: Math.round(baseWidth / 8) * 8,
    height: Math.round(baseHeight / 8) * 8,
  };
}
