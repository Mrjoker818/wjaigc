// 第三方模型管理器
import { fetchWithV1Retry } from './api-helpers';
import { encryptValue, decryptValue } from './client-crypto';
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
        // Decrypt apiKey for each provider (async, but we handle it)
        this.decryptProviderKeys();
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

  private decryptedKeys: Map<string, string> = new Map(); // id -> decrypted apiKey
  private decryptionPromises: Map<string, Promise<void>> = new Map(); // id → 解密进行中

  /** Decrypt API keys for all providers (handles migration from unencrypted storage) */
  private decryptProviderKeys(): void {
    for (const provider of this.providers) {
      if (provider.apiKey && provider.apiKey.startsWith('__enc__')) {
        const encryptedPart = provider.apiKey.slice(7);
        // ★ 追踪解密 Promise，防止竞态
        if (!this.decryptionPromises.has(provider.id)) {
          const promise = decryptValue(encryptedPart).then(decrypted => {
            this.decryptedKeys.set(provider.id, decrypted);
            this.decryptionPromises.delete(provider.id);
          }).catch(() => {
            // If decryption fails, keep the raw value (might be legacy unencrypted)
            this.decryptionPromises.delete(provider.id);
          });
          this.decryptionPromises.set(provider.id, promise);
        }
      } else if (provider.apiKey) {
        // Unencrypted (legacy or __plain__ prefix)
        this.decryptedKeys.set(provider.id, provider.apiKey.replace(/^__plain__/, ''));
      }
    }
  }

  /** ★ 确保指定 provider 的 API Key 已解密完成（解决异步竞态） */
  async ensureDecrypted(providerId: string): Promise<string> {
    // 等待正在进行的解密
    const pending = this.decryptionPromises.get(providerId);
    if (pending) await pending;
    return this.getDecryptedKey(providerId);
  }

  /** Get decrypted API key for a provider */
  private getDecryptedKey(providerId: string): string {
    return this.decryptedKeys.get(providerId) || 
           this.providers.find(p => p.id === providerId)?.apiKey?.replace(/^__enc__/, '').replace(/^__plain__/, '') || 
           '';
  }

  private saveData(): void {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return;
      }
      
      // Encrypt API keys before saving (async with fire-and-forget for simplicity)
      this._saveEncryptedData();
    } catch (error) {
      console.error('Failed to save universal API data:', error);
    }
  }

  private async _saveEncryptedData(): Promise<void> {
    try {
      const encryptedProviders = await Promise.all(
        this.providers.map(async (p) => {
          // Use decrypted key if available, otherwise use raw apiKey (strip any __enc__/__plain__ prefix)
          const rawKey = this.decryptedKeys.get(p.id) || 
                         p.apiKey?.replace(/^__enc__/, '').replace(/^__plain__/, '') || '';
          return {
            ...p,
            apiKey: rawKey ? `__enc__${await encryptValue(rawKey)}` : '',
          };
        })
      );
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(encryptedProviders));
      localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(this.modelsCache));
    } catch (error) {
      // Fallback: save unencrypted if encryption fails
      console.warn('[universal-api] Encryption failed, saving unencrypted:', error);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.providers));
      localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(this.modelsCache));
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
      const apiKey = await this.ensureDecrypted(provider.id);
      const baseUrl = provider.baseUrl.replace(/\/+$/, '');
      
      const response = await fetchWithV1Retry(baseUrl, '/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
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
    type: 'image' | 'chat' | 'universal' | 'video' = 'universal',
    options?: {
      displayName?: string;
      modelType?: 'image' | 'chat' | '3d' | 'video';
      providerPreset?: string;
      requestStyle?: 'chat-completions' | 'images-generations' | 'auto';
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
      modelType: options?.modelType || (type === 'chat' ? 'chat' : type === 'image' ? 'image' : type === 'video' ? 'video' : 'universal'),
      providerPreset: options?.providerPreset,
      requestStyle: options?.requestStyle,
      selectedModel: options?.selectedModel,
      selectedModels: options?.selectedModels || (options?.selectedModel ? [options.selectedModel] : []),
      advancedParams: options?.advancedParams || {},
      isRelay: options?.isRelay,
      connectionStatus: 'untested',
    };

    this.providers.unshift(provider);
    // Cache the decrypted key
    this.decryptedKeys.set(provider.id, apiKey);
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
    return this.providers.filter(p => p.isEnabled && (p.modelType === 'image' || p.type === 'image' || p.type === 'universal' || p.type === 'general' || p.modelType === 'general'));
  }

  getChatProviders(): ApiProvider[] {
    return this.providers.filter(p => p.isEnabled && (p.modelType === 'chat' || p.type === 'chat' || p.type === 'universal' || p.type === 'general' || p.modelType === 'general'));
  }

  get3DProviders(): ApiProvider[] {
    return this.providers.filter(p => p.isEnabled && (p.modelType === '3d' || p.type === 'universal' || p.type === 'general' || p.modelType === 'general'));
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

    // Update decrypted keys cache if apiKey is being updated
    if (updates.apiKey) {
      const rawKey = updates.apiKey.replace(/^__enc__/, '').replace(/^__plain__/, '');
      this.decryptedKeys.set(providerId, rawKey);
    }

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
      const apiKey = await this.ensureDecrypted(provider.id);
      const baseUrl = provider.baseUrl.replace(/\/+$/, '');
      
      const response = await fetchWithV1Retry(baseUrl, '/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
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
      
      const response = await fetchWithV1Retry(url, '/models', {
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

    const decryptedKey = await this.ensureDecrypted(provider.id);
    if (config.authType === 'bearer') {
      headers['Authorization'] = `Bearer ${decryptedKey}`;
    } else if (config.authType === 'header' && config.apiKeyHeader) {
      headers[config.apiKeyHeader] = decryptedKey;
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

    const decryptedKey = await this.ensureDecrypted(provider.id);
    if (config.authType === 'bearer') {
      headers['Authorization'] = `Bearer ${decryptedKey}`;
    } else if (config.authType === 'header' && config.apiKeyHeader) {
      headers[config.apiKeyHeader] = decryptedKey;
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
