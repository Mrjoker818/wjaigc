// 第三方模型调用功能 - 类型定义

export interface ApiProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  isEnabled: boolean;
  type: 'image' | 'chat' | 'imageEdit' | 'imageProcessing' | 'universal' | '3d' | 'vectorize' | 'layer';
  createdAt: number;
  updatedAt: number;
  // 模型类型区分（用户可见的三大分类）
  modelType?: 'image' | 'chat' | 'imageProcessing' | '3d' | 'imageEdit' | 'universal' | 'vectorize' | 'layer';
  // 图像处理模型的功能子类型（根据模型名称自动匹配）
  featureSubtype?: 'vectorize' | '3d' | 'layer';
  // 新增：显示名称
  displayName?: string;
  // 新增：提供商预设ID
  providerPreset?: string;
  // 新增：请求风格
  requestStyle?: 'chat-completions' | 'images-generations' | 'image-processing' | 'custom';
  // 新增：选定的模型ID（支持多选）
  selectedModel?: string;
  selectedModels?: string[];
  // 新增：高级参数
  advancedParams?: Record<string, string>;
  // 新增：是否为中转站
  isRelay?: boolean;
  // 新增：连接测试状态
  connectionStatus?: 'untested' | 'success' | 'failed';
  lastTestedAt?: number;
  discoveredModels?: ModelInfo[];
  balance?: ApiBalanceInfo;
  isDefault?: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  providerId: string;
  type: 'image' | 'chat' | '3d' | 'vectorize' | 'layer' | 'imageProcessing';
  description?: string;
  supportedAspectRatios?: string[];
  supportedQualities?: string[];
  maxImages?: number;
  capabilities?: string[];
  owned_by?: string;
}

export interface ApiBalanceInfo {
  status: 'unknown' | 'available' | 'unavailable' | 'error';
  amount?: number;
  currency?: string;
  quota?: number;
  used?: number;
  remaining?: number;
  raw?: string;
  message?: string;
  checkedAt?: number;
}

export interface AspectRatioOption {
  value: string;
  label: string;
  width?: number;
  height?: number;
}

export interface QualityOption {
  value: string;
  label: string;
}

type ApiJson = Record<string, unknown>;

function getJsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getJsonString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export interface ApiProviderConfig {
  // 通用配置
  baseUrl: string;
  apiKeyHeader?: string;
  authType: 'bearer' | 'query' | 'header';
  
  // 模型发现配置
  modelsEndpoint?: string;
  modelsParser?: (response: ApiJson) => ModelInfo[];
  
  // 图像生成配置
  imageGenerateEndpoint?: string;
  imageGenerateMethod?: 'GET' | 'POST';
  imageGenerateBody?: (params: ImageGenerateParams) => ApiJson;
  imageResponseParser?: (response: ApiJson) => string[];
  
  // 聊天配置
  chatEndpoint?: string;
  chatMethod?: 'GET' | 'POST';
  chatBody?: (params: ChatGenerateParams) => ApiJson;
  chatResponseParser?: (response: ApiJson) => string;
}

export interface ImageGenerateParams {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  quality?: string;
  count?: number;
  size?: string;
  style?: string;
  referenceImages?: string[];
}

export interface ChatGenerateParams {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// 第三方模型添加表单数据
export interface ThirdPartyModelForm {
  // 基础配置
  displayName: string;
  isEnabled: boolean;
  // 提供商配置
  provider: string; // 'openai' | 'custom' | 'apimart' | etc.
  apiKey: string;
  baseUrl: string;
  requestStyle: 'chat-completions' | 'images-generations';
  // 模型配置
  selectedModel: string;
  selectedModels: string[];
  // 高级参数
  advancedParams: Record<string, string>;
  // 模型类型（用户可见的三大分类）
  modelType: 'image' | 'chat' | 'imageProcessing';
  // 图像处理模型的功能子类型（自动匹配）
  featureSubtype?: 'vectorize' | '3d' | 'layer';
}

// 图像处理模型子类型映射规则
export const IMAGE_PROCESSING_SUBTYPE_RULES: Array<{
  subtype: 'vectorize' | '3d' | 'layer';
  keywords: string[];
  label: string;
  description: string;
}> = [
  {
    subtype: 'vectorize',
    keywords: ['vectorizer', 'vector', 'vtracer', 'starvector', 'svg'],
    label: '矢量化',
    description: '对应画布工具栏的矢量化功能',
  },
  {
    subtype: '3d',
    keywords: ['hunyuan3d', 'hunyuan', 'tripo', 'meshy', 'rodin', 'deemos', '3d'],
    label: '图转3D',
    description: '对应一键转3D功能，自动出现在3D模型列表中',
  },
  {
    subtype: 'layer',
    keywords: ['qwen-image-layered', 'layered', 'segment', 'sam', 'layer'],
    label: '编辑元素',
    description: '对应编辑元素功能及PSD文件导出',
  },
];

/** 根据模型名称自动推断图像处理子类型 */
export function inferImageProcessingSubtype(modelId: string): 'vectorize' | '3d' | 'layer' | undefined {
  const id = modelId.toLowerCase();
  // 优先匹配更具体的规则（避免 '3d' 过早匹配）
  for (const rule of IMAGE_PROCESSING_SUBTYPE_RULES) {
    // Skip generic '3d' keyword for first pass - match specific ones first
    if (rule.subtype === '3d' && (id.includes('3d') && !id.includes('hunyuan') && !id.includes('tripo') && !id.includes('meshy') && !id.includes('rodin') && !id.includes('deemos'))) {
      continue;
    }
    for (const keyword of rule.keywords) {
      if (keyword === '3d' || keyword === 'svg' || keyword === 'layer') continue; // Skip too-generic single keywords in first pass
      if (id.includes(keyword)) return rule.subtype;
    }
  }
  // Second pass: check generic keywords
  for (const rule of IMAGE_PROCESSING_SUBTYPE_RULES) {
    for (const keyword of rule.keywords) {
      if (id.includes(keyword)) return rule.subtype;
    }
  }
  return undefined;
}

// 预设的API提供商配置模板
export const PRESET_PROVIDERS: Record<string, ApiProviderConfig> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKeyHeader: 'Authorization',
    authType: 'bearer',
    modelsEndpoint: '/models',
    imageGenerateEndpoint: '/images/generations',
    imageGenerateMethod: 'POST',
    imageGenerateBody: (params) => ({
      prompt: params.prompt,
      n: params.count || 1,
      size: params.size || '1024x1024',
      model: params.model || 'dall-e-3'
    }),
    imageResponseParser: (response) => {
      const items = getJsonArray(response.data);
      return items
        .map(item => (item && typeof item === 'object' ? getJsonString((item as Record<string, unknown>).url) : ''))
        .filter((url): url is string => Boolean(url));
    },
    chatEndpoint: '/chat/completions',
    chatMethod: 'POST',
    chatBody: (params) => ({
      messages: params.messages,
      model: params.model || 'gpt-4',
      temperature: params.temperature || 0.7
    }),
    chatResponseParser: (response) => {
      const choices = getJsonArray(response.choices);
      const firstChoice = choices[0];
      if (!firstChoice || typeof firstChoice !== 'object') return '';
      const message = (firstChoice as Record<string, unknown>).message;
      if (!message || typeof message !== 'object') return '';
      return getJsonString((message as Record<string, unknown>).content);
    }
  },
  stabilityai: {
    baseUrl: 'https://api.stability.ai/v1',
    apiKeyHeader: 'Authorization',
    authType: 'bearer',
    imageGenerateEndpoint: '/generation',
    imageGenerateMethod: 'POST',
    imageGenerateBody: (params) => ({
      text_prompts: [{ text: params.prompt }],
      cfg_scale: 7,
      height: 1024,
      width: 1024,
      steps: 30,
      samples: params.count || 1
    }),
    imageResponseParser: (response) => {
      const artifacts = getJsonArray(response.artifacts);
      return artifacts
        .map(item => (item && typeof item === 'object' ? getJsonString((item as Record<string, unknown>).base64) : ''))
        .filter((base64): base64 is string => Boolean(base64))
        .map(base64 => `data:image/png;base64,${base64}`);
    }
  }
};

// 提供商预设选项（用于下拉选择）
export const PROVIDER_PRESETS = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', description: '官方 OpenAI API 入口。如果你想接入自定义 Base URL、第三方兼容服务或本地模型，请选择"自定义API (OpenAI Compatible)"。' },
  { id: 'custom', name: '自定义API (OpenAI Compatible)', baseUrl: '', description: '支持任何 OpenAI 兼容的 API 服务，包括 API 中转站、本地模型等。' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', description: 'DeepSeek 官方 API，支持深度推理和代码生成。' },
  { id: 'zhipu', name: '智谱AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', description: '智谱AI GLM系列模型，支持中英双语。' },
  { id: 'moonshot', name: 'Moonshot AI', baseUrl: 'https://api.moonshot.cn/v1', description: 'Kimi 大模型 API，支持长文本。' },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', description: '阿里云通义千问模型，支持中英双语。' },
] as const;

// 请求风格选项
export const REQUEST_STYLES = [
  { id: 'chat-completions', name: 'Chat Completions', description: '对话补全接口，适用于文本对话模型' },
  { id: 'images-generations', name: 'Images Generations', description: '图像生成接口，适用于AI绘图模型' },
] as const;
