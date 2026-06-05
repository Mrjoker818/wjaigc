import 'server-only';

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { ApiBalanceInfo, ApiProvider, ModelInfo } from './universal-api-types';
import { fetchWithV1Retry } from './api-helpers';
import { getModelDisplayName } from './model-name-map';
import { getServerSystemDir } from './server-data-root';
import { dbGetApiProviders, dbUpsertApiProvider, dbDeleteApiProvider } from './db-storage';

const SYSTEM_DIR = getServerSystemDir();
const CONFIG_PATH = path.join(SYSTEM_DIR, 'api-providers.json');
const DISCOVERY_TIMEOUT_MS = 30000;

/**
 * Normalize API base URL
 * - Only trims trailing slashes; does NOT auto-append /v1
 * - Users enter the complete base URL (e.g. https://api.openai.com/v1 or https://api.example.com)
 * - API routes append paths like /images/generations directly
 */
export function normalizeApiBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

type ApiKind = 'image' | 'chat' | '3d' | 'vectorize' | 'layer' | 'imageEdit' | 'universal' | 'general';

interface StoredApiConfig {
  providers: ApiProvider[];
  updatedAt: number;
}

interface AddProviderInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  modelType: ApiKind;
  requestStyle?: 'chat-completions' | 'images-generations' | 'custom' | 'auto';
  selectedModels?: string[];
  advancedParams?: Record<string, string>;
  isDefault?: boolean;
}

export type PublicApiProvider = Omit<ApiProvider, 'apiKey'> & {
  apiKey?: '';
  apiKeyPreview: string;
};

function maskKey(apiKey: string): string {
  if (!apiKey) return '';
  if (apiKey.length <= 10) return `${apiKey.slice(0, 2)}***`;
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}

export function sanitizeProvider(provider: ApiProvider): PublicApiProvider {
  const { apiKey: _apiKey, ...rest } = provider;
  return {
    ...rest,
    apiKey: '',
    apiKeyPreview: maskKey(_apiKey),
  };
}

export function sanitizeProviders(providers: ApiProvider[]): PublicApiProvider[] {
  return providers.map(sanitizeProvider);
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed;
}

function modelTypeForProvider(provider: ApiProvider): 'image' | 'chat' | '3d' | 'vectorize' | 'layer' {
  if (provider.modelType === 'chat') return 'chat';
  if (provider.modelType === '3d') return '3d';
  if (provider.modelType === 'vectorize') return 'vectorize';
  if (provider.modelType === 'layer') return 'layer';
  // General/universal: default to 'chat' since most models are chat
  // Individual model types from inferModelType override this in getPublicModels
  if (provider.modelType === 'imageEdit' || provider.modelType === 'universal' || provider.modelType === 'general') return 'chat';
  return 'image';
}

function inferModelType(modelId: string, fallback: 'image' | 'chat' | '3d' | 'vectorize' | 'layer'): 'image' | 'chat' | '3d' | 'vectorize' | 'layer' {
  const id = modelId.toLowerCase();
  // 矢量化模型关键词匹配
  if (id.includes('vectorize') || id.includes('vector') || id.includes('vtracer') || id.includes('starvector') || id.includes('svg-convert') || id.includes('svgconvert')) return 'vectorize';
  // 分层模型关键词匹配
  if (id.includes('qwen-image-layered') || id.includes('layer') || id.includes('segment') || id.includes('sam') || id.includes('detection') || id.includes('yolo')) return 'layer';
  // 3D模型关键词匹配
  if (id.includes('3d') || id.includes('tripo') || id.includes('meshy') || id.includes('hunyuan')) return '3d';
  // 图像模型关键词匹配 — 必须在 chat 之前检查，因为有些模型名同时包含 gpt+image
  if (
    id.includes('image') ||
    id.includes('dall-e') ||
    id.includes('dalle') ||
    id.includes('flux') ||
    id.includes('stable') ||
    id.includes('sdxl') ||
    id.includes('midjourney') ||
    id.includes('imagen') ||
    id.includes('seedream') ||
    id.includes('ideogram') ||
    id.includes('recraft') ||
    id.includes('playground') ||
    id.includes('kandinsky') ||
    id.includes('pixart') ||
    id.includes('deepfloyd') ||
    id.includes('wuerstchen') ||
    id.includes('openjourney') ||
    id.includes('dreamshaper') ||
    id.includes('realistic-vision') ||
    id.includes('deliberate') ||
    id.includes('anything-v') ||
    id.includes('counterfeit') ||
    id.includes('meinamix') ||
    id.includes('novelai') ||
    id.includes('nai-diffusion') ||
    id.includes('cogview') ||
    id.includes('cogvideox') ||
    id.includes('minimax-image') ||
    id.includes('minimax-video')
  ) return 'image';
  // Embedding/rerank 模型 — 既不是 chat 也不是 image，归类为 chat（对话面板不显示）
  // 但这些模型不应该出现在图像面板，所以先匹配它们并归入 chat
  if (
    id.includes('embed') ||
    id.includes('rerank') ||
    id.includes('retrieval') ||
    id.includes('moderation') ||
    id.includes('tts') ||
    id.includes('stt') ||
    id.includes('whisper') ||
    id.includes('speech') ||
    id.includes('audio') ||
    id.includes('transcrib')
  ) return 'chat';
  // LLM模型关键词匹配
  if (
    id.includes('gpt') ||
    id.includes('claude') ||
    id.includes('gemini') ||
    id.includes('qwen') ||
    id.includes('deepseek') ||
    id.includes('llama') ||
    id.includes('glm') ||
    id.includes('mistral') ||
    id.includes('codestral') ||
    id.includes('yi-') ||
    id.includes('chatglm') ||
    id.includes('command') ||
    id.includes('phi') ||
    id.includes('grok') ||
    id.includes('o1') ||
    id.includes('o3') ||
    id.includes('o4')
  ) return 'chat';
  return fallback;
}

function formatModel(model: Record<string, unknown>, provider: ApiProvider): ModelInfo {
  const id = String(model.id || model.name || '').trim();
  return {
    id,
    name: id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    providerId: provider.id,
    type: inferModelType(id, modelTypeForProvider(provider)),
    owned_by: typeof model.owned_by === 'string' ? model.owned_by : undefined,
  };
}

async function readConfig(): Promise<StoredApiConfig> {
  // Try database first (persistent across deployments)
  try {
    const dbProviderRows = await dbGetApiProviders();
    if (dbProviderRows && dbProviderRows.length > 0) {
      const providers: ApiProvider[] = dbProviderRows.map((p, i) => ({
        id: p.id,
        name: p.name,
        displayName: p.display_name || p.name,
        baseUrl: p.base_url,
        apiKey: p.api_key,
        isEnabled: p.is_enabled,
        type: p.type as ApiProvider['type'],
        modelType: p.model_type as ApiKind,
        requestStyle: p.request_style as ApiProvider['requestStyle'],
        selectedModels: Array.isArray(p.selected_models) ? p.selected_models : [],
        advancedParams: (p.advanced_params && typeof p.advanced_params === 'object') ? p.advanced_params as Record<string, string> : {},
        isDefault: p.is_default,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        connectionStatus: (['untested', 'success', 'failed'].includes(p.connection_status || '') ? p.connection_status as ApiProvider['connectionStatus'] : undefined),
        discoveredModels: Array.isArray(p.discovered_models) ? p.discovered_models.map((m: Record<string, unknown>) => ({
          id: (m.id as string) || (m as unknown as string),
          name: (m.name as string) || (typeof m === 'string' ? m : m.id as string),
          providerId: p.id,
          type: (m.type as string) || p.model_type,
        })) as ModelInfo[] : [],
        sortOrder: p.sort_order ?? i,
      }));
      return {
        providers,
        updatedAt: Date.now(),
      };
    }
  } catch {
    // DB not available, fall through to file
  }

  // Fallback to file system
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StoredApiConfig;
    const config = {
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      updatedAt: parsed.updatedAt || Date.now(),
    };
    // Migrate file data to database if DB is available
    if (config.providers.length > 0) {
      migrateProvidersToDb(config.providers).catch(() => {});
    }
    return config;
  } catch {
    return { providers: [], updatedAt: Date.now() };
  }
}

async function migrateProvidersToDb(providers: ApiProvider[]): Promise<void> {
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    await dbUpsertApiProvider({
      id: p.id,
      name: p.name,
      display_name: p.displayName || p.name,
      base_url: p.baseUrl,
      api_key: p.apiKey,
      is_enabled: p.isEnabled,
      type: p.type || 'image',
      model_type: p.modelType || 'image',
      request_style: p.requestStyle || 'images-generations',
      selected_models: p.selectedModels || [],
      advanced_params: p.advancedParams || {},
      is_default: p.isDefault ?? false,
      created_at: p.createdAt || Date.now(),
      updated_at: p.updatedAt || Date.now(),
      connection_status: p.connectionStatus,
      discovered_models: (p.discoveredModels || []) as unknown as Record<string, unknown>[],
      sort_order: p.sortOrder ?? i,
    });
  }
}

async function writeConfig(config: StoredApiConfig): Promise<void> {
  // Write to database (persistent across deployments)
  migrateProvidersToDb(config.providers).catch(() => {});

  // Also write to file system as backup
  await mkdir(SYSTEM_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify({ ...config, updatedAt: Date.now() }, null, 2), 'utf8');
}

export async function getApiProviders(): Promise<ApiProvider[]> {
  const providers = (await readConfig()).providers;
  // Ensure sortOrder is assigned and sort by it
  providers.forEach((p, i) => { if (p.sortOrder == null) p.sortOrder = i; });
  providers.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return providers;
}

export async function getApiProvider(id: string): Promise<ApiProvider | null> {
  const providers = await getApiProviders();
  return providers.find(p => p.id === id) || null;
}

export async function getPublicApiProviders(): Promise<PublicApiProvider[]> {
  return sanitizeProviders(await getApiProviders());
}

export async function discoverModelsForCredentials(
  baseUrl: string,
  apiKey: string,
  modelType: ApiKind,
): Promise<{ success: boolean; models: ModelInfo[]; message: string; latencyMs: number }> {
  const startedAt = Date.now();
  const probeProvider: ApiProvider = {
    id: 'probe',
    name: 'probe',
    baseUrl,
    apiKey,
    isEnabled: true,
    type: modelType === 'chat' ? 'chat' : modelType === 'vectorize' ? 'vectorize' : modelType === 'layer' ? 'layer' : modelType === '3d' ? '3d' : modelType === 'imageEdit' ? 'imageEdit' : (modelType === 'universal' || modelType === 'general') ? 'universal' : 'image',
    modelType,
    createdAt: startedAt,
    updatedAt: startedAt,
  };

  try {
    const response = await fetchWithV1Retry(
      normalizeBaseUrl(baseUrl),
      '/models',
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      }
    );

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      // Some API gateways return HTML error pages even for /v1/ paths
      // Try to parse JSON error, otherwise return a readable error
      try {
        const errorData = await response.json();
        const errorMsg = errorData?.error?.message || errorData?.message || `${response.status} ${response.statusText}`;
        return { success: false, models: [], message: errorMsg, latencyMs };
      } catch {
        return { success: false, models: [], message: `HTTP ${response.status}: API 返回了非 JSON 响应，请检查 Base URL 是否正确`, latencyMs };
      }
    }

    let data: Record<string, unknown>;
    try {
      data = await response.json();
    } catch {
      return { success: false, models: [], message: 'API 返回了非 JSON 响应，请检查 Base URL 是否正确（可能需要添加 /v1 路径）', latencyMs };
    }
    const rawModels = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    const models = rawModels
      .map((m: Record<string, unknown>) => formatModel(m, probeProvider))
      .filter((m: ModelInfo) => m.id && (
        // For general/universal/vectorize/layer: show all models (admin picks what they need)
        modelType === 'universal' ||
        modelType === 'general' ||
        modelType === 'vectorize' ||
        modelType === 'layer' ||
        modelType === 'imageEdit' ||
        // For image/chat/3d: also show other types so admin can pick cross-type models
        m.type === modelType
      ));

    return { success: true, models, message: `Found ${models.length} models`, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      success: false,
      models: [],
      message: error instanceof Error ? error.message : 'Model discovery failed',
      latencyMs,
    };
  }
}

function parseBalancePayload(payload: unknown): ApiBalanceInfo {
  const data = payload as Record<string, unknown>;
  const source = (data.data && typeof data.data === 'object' ? data.data : data) as Record<string, unknown>;
  const numberValue = (...keys: string[]) => {
    for (const key of keys) {
      const value = source[key] ?? data[key];
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Number(value);
    }
    return undefined;
  };

  const amount = numberValue('balance', 'amount', 'credit', 'credits', 'total_available', 'available');
  const used = numberValue('used', 'total_used', 'usage');
  const quota = numberValue('quota', 'limit', 'total_granted');
  const remaining = numberValue('remaining', 'remain', 'left') ?? amount;
  const currency = typeof source.currency === 'string' ? source.currency : typeof data.currency === 'string' ? data.currency : undefined;

  if (amount === undefined && used === undefined && quota === undefined && remaining === undefined) {
    return {
      status: 'unknown',
      raw: JSON.stringify(payload).slice(0, 500),
      message: 'Balance endpoint responded but no known balance field was found.',
      checkedAt: Date.now(),
    };
  }

  return {
    status: 'available',
    amount,
    currency,
    quota,
    used,
    remaining,
    checkedAt: Date.now(),
  };
}

export async function refreshProviderBalance(provider: ApiProvider): Promise<ApiBalanceInfo> {
  const base = normalizeBaseUrl(provider.baseUrl);
  // Try both the base URL and root (without version path) for balance endpoints
  const root = base.replace(/\/v\d+$/, '');
  const candidates = [
    `${base}/dashboard/billing/credit_grants`,
    `${base}/billing/usage`,
    `${base}/user/balance`,
    `${base}/balance`,
    `${root}/dashboard/billing/credit_grants`,
    `${root}/billing/usage`,
    `${root}/user/balance`,
    `${root}/balance`,
    `${root}/api/user/balance`,
  ];

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const parsed = parseBalancePayload(payload);
      return { ...parsed, message: parsed.message || `Synced from ${new URL(url).pathname}` };
    } catch {
      // Try the next known balance endpoint.
    }
  }

  return {
    status: 'unavailable',
    message: 'This provider did not expose a compatible balance endpoint.',
    checkedAt: Date.now(),
  };
}

export async function addApiProvider(input: AddProviderInput): Promise<ApiProvider> {
  const config = await readConfig();
  const now = Date.now();
  const id = `api_${now}_${Math.random().toString(36).slice(2, 9)}`;
  const provider: ApiProvider = {
    id,
    name: input.name.trim(),
    displayName: input.name.trim(),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    apiKey: input.apiKey.trim(),
    isEnabled: true,
    type: input.modelType === 'chat' ? 'chat' : input.modelType === 'vectorize' ? 'vectorize' : input.modelType === 'layer' ? 'layer' : input.modelType === '3d' ? '3d' : input.modelType === 'imageEdit' ? 'imageEdit' : (input.modelType === 'universal' || input.modelType === 'general') ? 'universal' : 'image',
    modelType: input.modelType,
    requestStyle: input.requestStyle === 'auto' ? 'auto' : (input.requestStyle || (input.modelType === 'chat' ? 'chat-completions' : 'images-generations')),
    selectedModels: input.selectedModels || [],
    advancedParams: input.advancedParams || {},
    isDefault: input.isDefault,
    createdAt: now,
    updatedAt: now,
    connectionStatus: 'untested',
    sortOrder: 0, // will be set after unshift
  };

  const discovery = await discoverModelsForCredentials(provider.baseUrl, provider.apiKey, input.modelType);
  provider.discoveredModels = discovery.models.map(model => ({ ...model, providerId: id }));

  // Auto-select matching models for vectorize/layer types
  if (input.selectedModels && input.selectedModels.length > 0) {
    provider.selectedModels = input.selectedModels;
  } else if (input.modelType === 'vectorize') {
    const matched = provider.discoveredModels.filter(m =>
      m.id.toLowerCase().includes('vectorize') ||
      m.id.toLowerCase().includes('vector') ||
      m.id.toLowerCase().includes('svg') ||
      m.id.toLowerCase().includes('tracer') ||
      m.id.toLowerCase().includes('starvector')
    );
    provider.selectedModels = matched.length > 0 ? matched.map(m => m.id) : provider.discoveredModels.map(model => model.id);
  } else if (input.modelType === 'layer') {
    const matched = provider.discoveredModels.filter(m =>
      m.id.toLowerCase().includes('qwen-image-layered') ||
      m.id.toLowerCase().includes('layer') ||
      m.id.toLowerCase().includes('segment') ||
      m.id.toLowerCase().includes('sam')
    );
    provider.selectedModels = matched.length > 0 ? matched.map(m => m.id) : provider.discoveredModels.map(model => model.id);
  } else {
    provider.selectedModels = input.selectedModels?.length ? input.selectedModels : provider.discoveredModels.map(model => model.id);
  }

  provider.selectedModel = provider.selectedModels[0];
  provider.connectionStatus = discovery.success ? 'success' : 'failed';
  provider.lastTestedAt = Date.now();
  provider.balance = await refreshProviderBalance(provider);

  const nextProviders = input.isDefault
    ? config.providers.map(p => (p.modelType === provider.modelType ? { ...p, isDefault: false } : p))
    : config.providers;

  nextProviders.unshift(provider);
  // Reassign sortOrder: new provider at position 0, rest shifted
  nextProviders.forEach((p, i) => { p.sortOrder = i; });
  await writeConfig({ providers: nextProviders, updatedAt: Date.now() });
  return provider;
}

export async function updateApiProvider(providerId: string, updates: Partial<ApiProvider>): Promise<ApiProvider | null> {
  const config = await readConfig();
  const index = config.providers.findIndex(provider => provider.id === providerId);
  if (index === -1) return null;

  const current = config.providers[index];
  const next: ApiProvider = {
    ...current,
    ...updates,
    apiKey: updates.apiKey || current.apiKey,
    baseUrl: updates.baseUrl ? normalizeBaseUrl(updates.baseUrl) : current.baseUrl,
    updatedAt: Date.now(),
  };

  if (updates.baseUrl || updates.apiKey) {
    const discovery = await discoverModelsForCredentials(next.baseUrl, next.apiKey, next.modelType || 'universal');
    next.discoveredModels = discovery.models.map(model => ({ ...model, providerId: next.id }));
    next.connectionStatus = discovery.success ? 'success' : 'failed';
    next.lastTestedAt = Date.now();
  }

  if (updates.isDefault) {
    config.providers = config.providers.map(provider =>
      provider.modelType === next.modelType ? { ...provider, isDefault: false } : provider,
    );
  }

  config.providers[index] = next;
  await writeConfig(config);
  return next;
}

export async function deleteApiProvider(providerId: string): Promise<boolean> {
  const config = await readConfig();
  const next = config.providers.filter(provider => provider.id !== providerId);
  if (next.length === config.providers.length) return false;
  // Delete from database explicitly
  dbDeleteApiProvider(providerId).catch(() => {});
  // Reassign sortOrder after deletion
  next.forEach((p, i) => { p.sortOrder = i; });
  await writeConfig({ providers: next, updatedAt: Date.now() });
  return true;
}

export async function reorderProviders(providerId: string, direction: 'up' | 'down'): Promise<ApiProvider[] | null> {
  const config = await readConfig();
  const providers = config.providers;

  // Ensure sortOrder is assigned
  providers.forEach((p, i) => {
    if (p.sortOrder == null) p.sortOrder = i;
  });
  // Sort by sortOrder
  providers.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const index = providers.findIndex(p => p.id === providerId);
  if (index === -1) return null;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= providers.length) return null;

  // Swap
  [providers[index], providers[targetIndex]] = [providers[targetIndex], providers[index]];
  // Reassign sortOrder
  providers.forEach((p, i) => { p.sortOrder = i; });

  await writeConfig({ providers, updatedAt: Date.now() });
  return providers;
}

export async function refreshApiProvider(providerId: string): Promise<ApiProvider | null> {
  const providers = await getApiProviders();
  const provider = providers.find(item => item.id === providerId);
  if (!provider) return null;
  const discovery = await discoverModelsForCredentials(provider.baseUrl, provider.apiKey, provider.modelType || 'universal');
  const balance = await refreshProviderBalance(provider);
  return updateApiProvider(providerId, {
    discoveredModels: discovery.models.map(model => ({ ...model, providerId })),
    connectionStatus: discovery.success ? 'success' : 'failed',
    lastTestedAt: Date.now(),
    balance,
  });
}

export async function findProviderForModel(modelId: string, modelType?: ApiKind): Promise<ApiProvider | null> {
  const providers = await getApiProviders();
  const enabled = providers.filter(provider => provider.isEnabled);
  const isFlexibleType = !modelType || modelType === 'universal' || modelType === 'general';
  const matchesType = (p: ApiProvider) => isFlexibleType || p.modelType === modelType || p.modelType === 'universal' || p.modelType === 'general';

  // 1. Exact match — 当多个提供商有同名模型时，记录警告
  const exactMatches = enabled.filter(provider =>
    matchesType(provider) &&
    (provider.selectedModels || []).includes(modelId),
  );
  if (exactMatches.length > 1) {
    console.warn(`[findProviderForModel] ⚠️ 模型 "${modelId}" 存在于 ${exactMatches.length} 个提供商中: [${exactMatches.map(p => `"${p.displayName || p.name}"`).join(', ')}]，将使用第一个: "${exactMatches[0].displayName || exactMatches[0].name}" (id=${exactMatches[0].id})。建议前端传递 providerId 精确指定。`);
  }
  if (exactMatches.length > 0) return exactMatches[0];

  // 2. Strip -thinking suffix and retry (e.g. gemini-2.5-flash-thinking → gemini-2.5-flash)
  if (modelId.endsWith('-thinking')) {
    const baseModelId = modelId.replace(/-thinking$/, '');
    const baseMatch = enabled.find(provider =>
      matchesType(provider) &&
      (provider.selectedModels || []).includes(baseModelId),
    );
    if (baseMatch) return baseMatch;
  }

  // 3. Default provider
  const byDefault = enabled.find(provider =>
    matchesType(provider) &&
    provider.isDefault,
  );
  if (byDefault) return byDefault;

  return enabled.find(provider => matchesType(provider)) || null;
}

/** 根据 providerId 直接查找 API 提供商 */
export async function findProviderById(providerId: string): Promise<ApiProvider | null> {
  const providers = await getApiProviders();
  return providers.find(p => p.id === providerId && p.isEnabled) || null;
}

/** 根据功能类型查找对应的 API 提供商（矢量化/分层/3D/聊天等） */
export async function findProviderForFeature(feature: 'vectorize' | 'layer' | '3d' | 'imageEdit' | 'chat'): Promise<ApiProvider | null> {
  const kindMap: Record<string, ApiKind> = {
    vectorize: 'vectorize',
    layer: 'layer',
    '3d': '3d',
    imageEdit: 'image',
    chat: 'chat',
  };
  const kind = kindMap[feature];
  if (!kind) return null;
  const providers = await getApiProviders();
  // For imageEdit, search image-type providers that have editing-capable models
  if (feature === 'imageEdit') {
    const imageProviders = providers.filter(p => p.isEnabled && (p.modelType === 'image'));
    const defaultProvider = imageProviders.find(p => p.isDefault);
    return defaultProvider || imageProviders[0] || null;
  }
  const enabled = providers.filter(p => p.isEnabled && (p.modelType === kind));
  // 优先返回默认提供商
  const defaultProvider = enabled.find(p => p.isDefault);
  if (defaultProvider) return defaultProvider;
  return enabled[0] || null;
}

/**
 * Get all enabled providers of a given type with their selected models.
 * Returns an array of { provider, models[] } sorted by: default first, then by order.
 * Used by image-edit route to auto-try multiple models.
 */
export async function findAllProvidersForType(modelType: ApiKind): Promise<Array<{
  provider: ApiProvider;
  models: string[];
}>> {
  const providers = await getApiProviders();
  // For imageEdit, include image-type providers
  const effectiveType = modelType === 'imageEdit' ? 'image' : modelType;
  const enabled = providers.filter(p => p.isEnabled && (p.modelType === effectiveType || p.modelType === 'universal' || p.modelType === 'general'));
  // Sort: default providers first
  enabled.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
  return enabled.map(provider => {
    const selected = provider.selectedModels || [];
    const discovered = provider.discoveredModels || [];
    // If admin has explicitly selected models, use only those
    const models = selected.length > 0
      ? selected
      : discovered.map(m => m.id);
    // Filter models by the requested type when provider is general/universal
    // This prevents chat models from being used for image operations
    const isGeneral = provider.modelType === 'universal' || provider.modelType === 'general';
    const filteredModels = isGeneral
      ? models.filter(modelId => {
          const discoveredModel = discovered.find(m => m.id === modelId);
          const modelType = discoveredModel?.type || inferModelType(modelId, modelTypeForProvider(provider));
          return modelType === effectiveType;
        })
      : models;
    return { provider, models: filteredModels };
  }).filter(entry => entry.models.length > 0);
}

export async function getPublicModels(modelType?: ApiKind): Promise<ModelInfo[]> {
  const providers = await getApiProviders();
  // Determine which provider types should be included for the requested modelType
  // - Exact type match: provider.modelType === modelType
  // - General/universal providers: include their models, but filter by model-level type
  const isGeneralQuery = !modelType || modelType === 'universal' || modelType === 'general';

  return providers
    .filter(provider => provider.isEnabled && (isGeneralQuery || provider.modelType === modelType || provider.modelType === 'universal' || provider.modelType === 'general'))
    .flatMap(provider => {
      const selected = new Set(provider.selectedModels || []);
      const discovered = provider.discoveredModels || [];
      // If admin has explicitly selected models, show only those
      if (selected.size > 0) {
        const visible = discovered.filter(model => selected.has(model.id));
        return (visible.length ? visible : Array.from(selected).map(id => ({
          id,
          name: '', // will be resolved below
          providerId: provider.id,
          type: modelTypeForProvider(provider),
        } satisfies ModelInfo))).map(model => {
          // 优先使用第三方 API 供应商提供的模型名称，回退到本地映射
          const providerName = (model as ModelInfo).name && (model as ModelInfo).name !== model.id ? (model as ModelInfo).name : '';
          const mappedName = getModelDisplayName(model.id);
          const name = providerName || mappedName;
          const apiDisplayName = providerName || mappedName; // 优先第三方供应商名称，回退到本地映射
          return { ...model, providerId: provider.id, name, apiDisplayName };
        });
      }
      // If no models explicitly selected, show all discovered models
      // (admin hasn't filtered yet, so all are available)
      return discovered.map(model => {
          const providerName = model.name && model.name !== model.id ? model.name : '';
          const mappedName = getModelDisplayName(model.id);
          const name = providerName || mappedName;
          const apiDisplayName = providerName || mappedName;
          return { ...model, providerId: provider.id, name, apiDisplayName };
        });
    })
    // Filter by model-level type for non-general queries
    // This prevents image models from appearing in chat panel and vice versa
    .filter(model => {
      if (isGeneralQuery) return true;
      return model.type === modelType;
    });
}
