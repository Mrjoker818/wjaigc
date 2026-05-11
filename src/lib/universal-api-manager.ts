// 第三方模型管理器
import { 
  ApiProvider, 
  ModelInfo, 
  ApiProviderConfig, 
  PRESET_PROVIDERS,
  PROVIDER_PRESETS,
  ImageGenerateParams,
  ChatGenerateParams
} from './universal-api-types';

const STORAGE_KEY = 'unbounded_ai_universal_apis';
const MODELS_CACHE_KEY = 'unbounded_ai_models_cache';

export class UniversalApiManager {
  private static instance: UniversalApiManager;
  private providers: ApiProvider[] = [];
  private models: ModelInfo[] = [];
  private modelsCache: Record<string, { models: ModelInfo[]; timestamp: number }> = {};
  private CACHE_DURATION = 24 * 60 * 60 * 1000; // 24小时

  private constructor() {
    this.loadData();
  }

  static getInstance(): UniversalApiManager {
    if (!UniversalApiManager.instance) {
      UniversalApiManager.instance = new UniversalApiManager();
    }
    return UniversalApiManager.instance;
  }

  private loadData(): void {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return;
      }

      const storedProviders = localStorage.getItem(STORAGE_KEY);
      if (storedProviders) {
        this.providers = JSON.parse(storedProviders);
      }

      const storedCache = localStorage.getItem(MODELS_CACHE_KEY);
      if (storedCache) {
        this.modelsCache = JSON.parse(storedCache);
      }

      this.loadAllModels();
    } catch (error) {
      console.error('Failed to load universal API data:', error);
    }
  }

  private saveData(): void {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return;
      }
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.providers));
      localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(this.modelsCache));
    } catch (error) {
      console.error('Failed to save universal API data:', error);
    }
  }

  private async loadAllModels(): Promise<void> {
    this.models = [];
    const now = Date.now();

    for (const provider of this.providers) {
      if (!provider.isEnabled) continue;

      // 检查缓存
      const cached = this.modelsCache[provider.id];
      if (cached && (now - cached.timestamp) < this.CACHE_DURATION) {
        this.models.push(...cached.models);
        continue;
      }

      // 尝试从API获取模型
      try {
        const providerModels = await this.discoverModels(provider);
        this.models.push(...providerModels);
        
        this.modelsCache[provider.id] = {
          models: providerModels,
          timestamp: now
        };
      } catch (error) {
        console.error(`Failed to discover models for ${provider.name}:`, error);
        this.models.push(...this.getDefaultModels(provider));
      }
    }

    this.saveData();
  }

  private getDefaultModels(provider: ApiProvider): ModelInfo[] {
    const defaults: Record<string, ModelInfo[]> = {
      openai: [
        {
          id: 'dall-e-3',
          name: 'DALL·E 3',
          providerId: provider.id,
          type: 'image',
          supportedAspectRatios: ['1:1', '16:9', '9:16'],
          supportedQualities: ['standard', 'hd'],
          maxImages: 1
        },
        {
          id: 'gpt-4o',
          name: 'GPT-4o',
          providerId: provider.id,
          type: 'chat',
          capabilities: ['text-generation', 'image-input']
        }
      ],
      stabilityai: [
        {
          id: 'stable-diffusion-xl',
          name: 'Stable Diffusion XL',
          providerId: provider.id,
          type: 'image',
          supportedAspectRatios: ['1:1', '16:9', '9:16', '3:2', '2:3'],
          supportedQualities: ['standard', 'high'],
          maxImages: 4
        }
      ]
    };

    return defaults[provider.id] || [
      {
        id: provider.selectedModel || 'default',
        name: provider.selectedModel || provider.displayName || provider.name,
        providerId: provider.id,
        type: provider.modelType || (provider.type === 'chat' ? 'chat' : 'image'),
        supportedAspectRatios: ['1:1'],
        supportedQualities: ['standard'],
        maxImages: 1
      }
    ];
  }

  private async discoverModels(provider: ApiProvider): Promise<ModelInfo[]> {
    try {
      const baseUrl = provider.baseUrl.replace(/\/+$/, '');
      const normalizedUrl = baseUrl.includes('/v1') ? baseUrl : `${baseUrl}/v1`;
      
      const response = await fetch(`${normalizedUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return this.getDefaultModels(provider);
      }

      const data = await response.json();
      const rawModels = data.data || data.models || [];
      
      return rawModels.map((m: Record<string, unknown>) => ({
        id: m.id as string,
        name: (m.id as string).replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        providerId: provider.id,
        type: provider.modelType || 'image',
        owned_by: (m.owned_by as string) || 'unknown',
      }));
    } catch {
      return this.getDefaultModels(provider);
    }
  }

  // API提供商管理
  addProvider(
    name: string,
    baseUrl: string,
    apiKey: string,
    type: 'image' | 'chat' | 'universal' = 'universal',
    options?: {
      displayName?: string;
      modelType?: 'image' | 'chat' | '3d';
      providerPreset?: string;
      requestStyle?: 'chat-completions' | 'images-generations';
      selectedModel?: string;
      selectedModels?: string[];
      advancedParams?: Record<string, string>;
      isRelay?: boolean;
    }
  ): ApiProvider {
    const provider: ApiProvider = {
      id: `api_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      baseUrl,
      apiKey,
      isEnabled: true,
      type,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      displayName: options?.displayName || name,
      modelType: options?.modelType || (type === 'chat' ? 'chat' : type === 'image' ? 'image' : 'universal'),
      providerPreset: options?.providerPreset,
      requestStyle: options?.requestStyle,
      selectedModel: options?.selectedModel,
      selectedModels: options?.selectedModels || (options?.selectedModel ? [options.selectedModel] : []),
      advancedParams: options?.advancedParams || {},
      isRelay: options?.isRelay,
      connectionStatus: 'untested',
    };

    this.providers.unshift(provider);
    this.saveData();
    this.loadAllModels();

    return provider;
  }

  getProviders(): ApiProvider[] {
    return this.providers;
  }

  getProvider(providerId: string): ApiProvider | null {
    return this.providers.find(p => p.id === providerId) || null;
  }

  getImageProviders(): ApiProvider[] {
    return this.providers.filter(p => p.isEnabled && (p.modelType === 'image' || p.type === 'image' || p.type === 'universal'));
  }

  getChatProviders(): ApiProvider[] {
    return this.providers.filter(p => p.isEnabled && (p.modelType === 'chat' || p.type === 'chat' || p.type === 'universal'));
  }

  get3DProviders(): ApiProvider[] {
    return this.providers.filter(p => p.isEnabled && (p.modelType === '3d' || p.type === 'universal'));
  }

  getEnabledProviders(): ApiProvider[] {
    return this.providers.filter(p => p.isEnabled);
  }

  updateProvider(providerId: string, updates: Partial<ApiProvider>): ApiProvider | null {
    const index = this.providers.findIndex(p => p.id === providerId);
    if (index === -1) return null;

    this.providers[index] = {
      ...this.providers[index],
      ...updates,
      updatedAt: Date.now(),
    };

    this.saveData();
    
    if (updates.isEnabled !== undefined || updates.baseUrl || updates.apiKey) {
      this.loadAllModels();
    }

    return this.providers[index];
  }

  deleteProvider(providerId: string): boolean {
    const initialLength = this.providers.length;
    this.providers = this.providers.filter(p => p.id !== providerId);
    
    if (this.providers.length < initialLength) {
      delete this.modelsCache[providerId];
      this.saveData();
      this.loadAllModels();
      return true;
    }

    return false;
  }

  // 模型管理
  getModels(type?: 'image' | 'chat' | '3d'): ModelInfo[] {
    if (type) {
      return this.models.filter(m => m.type === type);
    }
    return this.models;
  }

  getModel(modelId: string): ModelInfo | null {
    return this.models.find(m => m.id === modelId) || null;
  }

  getModelsByProvider(providerId: string): ModelInfo[] {
    return this.models.filter(m => m.providerId === providerId);
  }

  async refreshModels(): Promise<void> {
    this.modelsCache = {};
    await this.loadAllModels();
  }

  getAspectRatiosForModel(modelId: string): string[] {
    const model = this.getModel(modelId);
    return model?.supportedAspectRatios || ['1:1'];
  }

  getQualitiesForModel(modelId: string): string[] {
    const model = this.getModel(modelId);
    return model?.supportedQualities || ['standard'];
  }

  getMaxImagesForModel(modelId: string): number {
    const model = this.getModel(modelId);
    return model?.maxImages || 1;
  }

  // 连接测试
  async testConnection(providerId: string): Promise<{ success: boolean; message: string; models?: string[] }> {
    const provider = this.providers.find(p => p.id === providerId);
    if (!provider) {
      return { success: false, message: '未找到该提供商配置' };
    }

    try {
      const baseUrl = provider.baseUrl.replace(/\/+$/, '');
      const normalizedUrl = baseUrl.includes('/v1') ? baseUrl : `${baseUrl}/v1`;
      
      const response = await fetch(`${normalizedUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const statusText = response.statusText || 'Unknown Error';
        this.updateProvider(providerId, { connectionStatus: 'failed', lastTestedAt: Date.now() });
        return { success: false, message: `连接失败: ${response.status} ${statusText}` };
      }

      const data = await response.json();
      const rawModels = data.data || data.models || [];
      const modelNames = rawModels.map((m: Record<string, unknown>) => m.id as string).slice(0, 10);
      
      this.updateProvider(providerId, { connectionStatus: 'success', lastTestedAt: Date.now() });
      return { 
        success: true, 
        message: `连接成功! 发现 ${rawModels.length} 个模型`,
        models: modelNames
      };
    } catch (error) {
      this.updateProvider(providerId, { connectionStatus: 'failed', lastTestedAt: Date.now() });
      return { 
        success: false, 
        message: `连接失败: ${error instanceof Error ? error.message : '未知错误'}` 
      };
    }
  }

  // 快速测试API连接（不依赖已保存的provider）
  static async quickTestConnection(baseUrl: string, apiKey: string): Promise<{ success: boolean; message: string; models?: string[] }> {
    try {
      const url = baseUrl.replace(/\/+$/, '');
      const normalizedUrl = url.includes('/v1') ? url : `${url}/v1`;
      
      const response = await fetch(`${normalizedUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return { success: false, message: `连接失败: ${response.status} ${response.statusText}` };
      }

      const data = await response.json();
      const rawModels = data.data || data.models || [];
      const modelNames = rawModels.map((m: Record<string, unknown>) => m.id as string);
      
      return { 
        success: true, 
        message: `连接成功! 发现 ${rawModels.length} 个模型`,
        models: modelNames
      };
    } catch (error) {
      return { 
        success: false, 
        message: `连接失败: ${error instanceof Error ? error.message : '网络错误'}` 
      };
    }
  }

  // 图像生成
  async generateImages(
    providerId: string,
    params: ImageGenerateParams
  ): Promise<string[]> {
    const provider = this.providers.find(p => p.id === providerId);
    if (!provider) {
      throw new Error('Provider not found');
    }

    const config = this.getProviderConfig(provider);
    
    if (!config.imageGenerateEndpoint) {
      throw new Error('Image generation not supported for this provider');
    }

    const url = `${provider.baseUrl}${config.imageGenerateEndpoint}`;
    const method = config.imageGenerateMethod || 'POST';
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.authType === 'bearer') {
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
    } else if (config.authType === 'header' && config.apiKeyHeader) {
      headers[config.apiKeyHeader] = provider.apiKey;
    }

    const body = config.imageGenerateBody 
      ? config.imageGenerateBody(params)
      : { prompt: params.prompt };

    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const data = await response.json() as Record<string, unknown>;
    
    return config.imageResponseParser 
      ? config.imageResponseParser(data)
      : (Array.isArray(data.data)
        ? data.data.map(item => (item as { url?: string }).url).filter((url): url is string => Boolean(url))
        : []);
  }

  // 聊天生成
  async generateChat(
    providerId: string,
    params: ChatGenerateParams
  ): Promise<string> {
    const provider = this.providers.find(p => p.id === providerId);
    if (!provider) {
      throw new Error('Provider not found');
    }

    const config = this.getProviderConfig(provider);
    
    if (!config.chatEndpoint) {
      throw new Error('Chat not supported for this provider');
    }

    const url = `${provider.baseUrl}${config.chatEndpoint}`;
    const method = config.chatMethod || 'POST';
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.authType === 'bearer') {
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
    } else if (config.authType === 'header' && config.apiKeyHeader) {
      headers[config.apiKeyHeader] = provider.apiKey;
    }

    const body = config.chatBody 
      ? config.chatBody(params)
      : { messages: params.messages };

    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const data = await response.json() as Record<string, unknown>;
    
    return config.chatResponseParser 
      ? config.chatResponseParser(data)
      : ((Array.isArray(data.choices)
        ? (data.choices[0] as { message?: { content?: string } } | undefined)?.message?.content
        : '') || '');
  }

  private getProviderConfig(provider: ApiProvider): ApiProviderConfig {
    // 尝试匹配预设
    const presetId = provider.providerPreset;
    if (presetId && PRESET_PROVIDERS[presetId]) {
      return PRESET_PROVIDERS[presetId];
    }

    for (const [id, presetConfig] of Object.entries(PRESET_PROVIDERS)) {
      if (provider.baseUrl.includes(id) || provider.name.toLowerCase().includes(id)) {
        return presetConfig;
      }
    }

    // 默认配置（OpenAI兼容格式）
    return {
      baseUrl: provider.baseUrl,
      apiKeyHeader: 'Authorization',
      authType: 'bearer',
      imageGenerateEndpoint: '/images/generations',
      imageGenerateMethod: 'POST',
      imageGenerateBody: (params) => ({
        prompt: params.prompt,
        n: params.count || 1,
        size: params.size || '1024x1024',
        model: params.model || provider.selectedModel
      }),
      imageResponseParser: (response) => {
        const items = Array.isArray(response.data) ? response.data : [];
        return items.map(item => (item as { url?: string }).url).filter((url): url is string => Boolean(url));
      },
      chatEndpoint: '/chat/completions',
      chatMethod: 'POST',
      chatBody: (params) => ({
        messages: params.messages,
        model: params.model || provider.selectedModel
      }),
      chatResponseParser: (response) => {
        const choices = Array.isArray(response.choices) ? response.choices : [];
        return (choices[0] as { message?: { content?: string } } | undefined)?.message?.content || '';
      }
    };
  }

  // 获取预设提供商列表
  getPresetProviders() {
    return PROVIDER_PRESETS;
  }

  // 清空所有数据
  clearAllData(): void {
    this.providers = [];
    this.models = [];
    this.modelsCache = {};
    
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(MODELS_CACHE_KEY);
    }
  }
}
