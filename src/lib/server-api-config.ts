import 'server-only';

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { ApiBalanceInfo, ApiProvider, ModelInfo } from './universal-api-types';
import { getModelDisplayName } from './model-name-map';
import { getServerSystemDir } from './server-data-root';

const SYSTEM_DIR = getServerSystemDir();
const CONFIG_PATH = path.join(SYSTEM_DIR, 'api-providers.json');
const DISCOVERY_TIMEOUT_MS = 8000;

/**
 * Normalize API base URL to always end with /v1
 * - If URL already ends with /v1, keep as-is
 * - If URL doesn't end with /v1, append /v1
 * - This ensures all API routes can consistently append paths like /images/generations
 */
export function normalizeApiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1')) return trimmed;
  if (trimmed.endsWith('/v2') || trimmed.endsWith('/v3')) return trimmed;
  return `${trimmed}/v1`;
}

type ApiKind = 'image' | 'chat' | '3d' | 'imageEdit' | 'universal' | 'vectorize' | 'layer';

interface StoredApiConfig {
  providers: ApiProvider[];
  updatedAt: number;
}

interface AddProviderInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  modelType: ApiKind;
  requestStyle?: 'chat-completions' | 'images-generations' | 'custom';
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
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function modelTypeForProvider(provider: ApiProvider): 'image' | 'chat' | '3d' | 'vectorize' | 'layer' {
  if (provider.modelType === 'chat') return 'chat';
  if (provider.modelType === '3d') return '3d';
  if (provider.modelType === 'vectorize') return 'vectorize';
  if (provider.modelType === 'layer') return 'layer';
  if (provider.modelType === 'universal') return 'image'; // fallback for universal, actual type is per-model
  return 'image';
}

function inferModelType(modelId: string, fallback: 'image' | 'chat' | '3d' | 'vectorize' | 'layer'): 'image' | 'chat' | '3d' | 'vectorize' | 'layer' {
  const id = modelId.toLowerCase();

  // ── 3D models (check first - rare but specific) ──
  if (id.includes('3d') || id.includes('tripo') || id.includes('meshy') || id.includes('rodin') || id.includes('hyper3d') || id.includes('hunyuan3d') || id.includes('claydo')) return '3d';

  // ── Vectorize models ──
  if (id.includes('vector') || id.includes('vtracer') || id.includes('starvector') || id.includes('svg-')) return 'vectorize';

  // ── Segment / Layer models ──
  if (id.includes('layer') || id.includes('segment') || id.includes('sam2') || id.includes('yolo') || id.includes('rmbg') || id.includes('rembg') || id.includes('remove-bg') || id.includes('layered')) return 'layer';

  // ── Image generation models (extensive list for 302.ai etc.) ──
  const imageKeywords = [
    'dall-e', 'dall·e', 'dalle',
    'midjourney', 'mj-',
    'stable-diffusion', 'sdxl', 'sd3', 'stable-image',
    'flux', 'flux-',
    'imagen',
    'kandinsky',
    'cogview', 'cogviewx',
    'minimax-image', 'minimax-video',
    'kling-image', 'kling-v1-image', 'kling-v2-image',
    'jimeng', 'jimeng-2',
    'ideogram', 'ideogram-2', 'ideogram-3',
    'recraft', 'recraft-v3', 'recraft-realism',
    'leonardo',
    'playground', 'playground-v3', 'playground-v2',
    'luma-photon',
    'seedream', 'seedream-3', 'seedream-5',
    'wan2.7-image', 'wanx',
    'gpt-image', 'gpt-image-1', 'gpt-image-2',
    'nano-banana', 'gemini-3.1-flash-image', 'gemini-2.0-flash-image',
    'pixart', 'pixart-alpha', 'pixart-sigma',
    'deepfloyd', 'if-xl',
    'wuerstchen',
    'kolors',
    'hunyuan-image',
    'stepfun-image',
    'bagel-image',
    'dreamshaper',
    'realvisxl',
    'animagine',
    'sdxl-turbo', 'sd-turbo',
    'openjourney', 'open-dalle',
    'amused', 'ssd-1b', 'sana',
    'hidream-image',
    'picsart',
    'image-gen', 'image-generation', 'image-gen',
    'wan2.1-image', 'wan-image',
    'doubao-seedream',
    'grok-image',
    'chatgpt-4o-image',
  ];
  for (const kw of imageKeywords) {
    if (id.includes(kw)) return 'image';
  }

  // ── Chat / LLM models (extensive list for 302.ai etc.) ──
  const chatKeywords = [
    'gpt-4', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5', 'gpt-5',
    'chatgpt', 'chat-latest',
    'o1-', 'o3-', 'o4-',
    'claude', 'claude-3', 'claude-4', 'claude-opus', 'claude-sonnet',
    'gemini-1', 'gemini-2', 'gemini-3',
    'deepseek', 'deepseek-chat', 'deepseek-v', 'deepseek-r',
    'qwen', 'qwen2', 'qwen3', 'qwen-',
    'llama', 'llama-2', 'llama-3', 'llama-4',
    'mistral', 'mixtral', 'codestral', 'pixtral',
    'yi-', 'yi-lightning',
    'chatglm', 'glm-4', 'glm-5',
    'moonshot', 'kimi', 'kimi-k2',
    'spark', 'spark-4', 'spark-5',
    'ernie', 'ernie-4', 'ernie-5',
    'command', 'command-r',
    'phi-', 'phi-3', 'phi-4',
    'gemma', 'gemma-2',
    'grok', 'grok-2', 'grok-3', 'grok-4',
    'doubao-pro', 'doubao-lite', 'doubao-1.5', 'doubao-vision', 'doubao-1',
    'hunyuan-turbos',
    'minimax-abab', 'minimax-chat',
    'step-2', 'step-1',
    'internlm', 'internvl',
    'solar', 'falcon', 'starcoder', 'codellama',
    'wizardlm', 'vicuna', 'zephyr', 'openchat',
    'nous-hermes', 'dolphin', 'hermes',
    'granite', 'jamba', 'arctic',
    'tinyllama', 'orca',
    'qwen3-rerank', 'voyage', 'bge-',
    'paddleocr', 'glm-ocr',
  ];
  for (const kw of chatKeywords) {
    if (id.includes(kw)) return 'chat';
  }

  // ── Heuristic fallbacks ──
  if (/[-_](image|img|imgen|gen|paint|draw|art|photo)/.test(id)) return 'image';
  if (/[-_](chat|talk|instruct|assistant|dialog|conv)/.test(id)) return 'chat';
  if (/[a-z]+-\d+b/.test(id)) return 'chat';  // e.g. qwen3-6b, llama3-8b

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
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StoredApiConfig;
    return {
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      updatedAt: parsed.updatedAt || Date.now(),
    };
  } catch {
    return { providers: [], updatedAt: Date.now() };
  }
}

async function writeConfig(config: StoredApiConfig): Promise<void> {
  await mkdir(SYSTEM_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify({ ...config, updatedAt: Date.now() }, null, 2), 'utf8');
}

export async function getApiProviders(): Promise<ApiProvider[]> {
  return (await readConfig()).providers;
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
    type: modelType === 'chat' ? 'chat' : modelType === 'imageEdit' ? 'imageEdit' : modelType === 'image' ? 'image' : 'universal',
    modelType,
    createdAt: startedAt,
    updatedAt: startedAt,
  };

  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return { success: false, models: [], message: `${response.status} ${response.statusText}`, latencyMs };
    }

    const data = await response.json();
    const rawModels = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    const models = rawModels
      .map((m: Record<string, unknown>) => formatModel(m, probeProvider))
      .filter((m: ModelInfo) => m.id && (modelType === 'universal' || modelType === 'imageEdit' || m.type === modelType || (modelType === 'image' && m.type === 'image')));

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
  const root = base.replace(/\/v1$/, '');
  const candidates = [
    `${base}/dashboard/billing/credit_grants`,
    `${base}/billing/usage`,
    `${base}/user/balance`,
    `${base}/balance`,
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
    type: input.modelType === 'chat' ? 'chat' : input.modelType === 'imageEdit' ? 'imageEdit' : input.modelType === 'image' ? 'image' : 'universal',
    modelType: input.modelType,
    requestStyle: input.requestStyle || (input.modelType === 'chat' ? 'chat-completions' : 'images-generations'),
    selectedModels: input.selectedModels || [],
    advancedParams: input.advancedParams || {},
    isDefault: input.isDefault,
    createdAt: now,
    updatedAt: now,
    connectionStatus: 'untested',
  };

  const discovery = await discoverModelsForCredentials(provider.baseUrl, provider.apiKey, input.modelType);
  provider.discoveredModels = discovery.models.map(model => ({ ...model, providerId: id }));
  // For universal providers, don't auto-select all models (could be hundreds); for specific types, auto-select
  provider.selectedModels = input.selectedModels?.length ? input.selectedModels : (input.modelType === 'universal' ? [] : provider.discoveredModels.map(model => model.id));
  provider.selectedModel = provider.selectedModels[0];
  provider.connectionStatus = discovery.success ? 'success' : 'failed';
  provider.lastTestedAt = Date.now();
  provider.balance = await refreshProviderBalance(provider);

  const nextProviders = input.isDefault
    ? config.providers.map(p => (p.modelType === provider.modelType ? { ...p, isDefault: false } : p))
    : config.providers;

  nextProviders.unshift(provider);
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
  await writeConfig({ providers: next, updatedAt: Date.now() });
  return true;
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
  const exact = enabled.find(provider =>
    (!modelType || modelType === 'universal' || provider.modelType === modelType || provider.modelType === 'universal') &&
    (provider.selectedModels || []).includes(modelId),
  );
  if (exact) return exact;

  const byDefault = enabled.find(provider =>
    (!modelType || modelType === 'universal' || provider.modelType === modelType || provider.modelType === 'universal') &&
    provider.isDefault,
  );
  if (byDefault) return byDefault;

  return enabled.find(provider => !modelType || provider.modelType === modelType || provider.modelType === 'universal') || null;
}

/** 根据功能类型查找对应的 API 提供商（矢量化/分层/3D等） */
export async function findProviderForFeature(feature: 'vectorize' | 'layer' | '3d'): Promise<ApiProvider | null> {
  const kindMap: Record<string, ApiKind> = {
    vectorize: 'vectorize',
    layer: 'layer',
    '3d': '3d',
  };
  const kind = kindMap[feature];
  if (!kind) return null;
  const providers = await getApiProviders();
  const enabled = providers.filter(p => p.isEnabled && (p.modelType === kind || p.modelType === 'universal'));
  // 优先返回默认提供商
  const defaultProvider = enabled.find(p => p.isDefault);
  if (defaultProvider) return defaultProvider;
  return enabled[0] || null;
}

export async function getPublicModels(modelType?: ApiKind): Promise<ModelInfo[]> {
  const providers = await getApiProviders();
  return providers
    .filter(provider => provider.isEnabled && (!modelType || modelType === 'universal' || provider.modelType === modelType || provider.modelType === 'universal'))
    .flatMap(provider => {
      const selected = new Set(provider.selectedModels || []);
      const discovered = provider.discoveredModels || [];
      // If admin has explicitly selected models, show only those
      if (selected.size > 0) {
        const visible = discovered.filter(model => selected.has(model.id));
        return (visible.length ? visible : Array.from(selected).map(id => ({
          id,
          name: getModelDisplayName(id),
          providerId: provider.id,
          type: provider.modelType === 'universal' ? inferModelType(id, 'image') : modelTypeForProvider(provider),
        } satisfies ModelInfo))).map(model => {
          const displayName = getModelDisplayName(model.id);
          // Use mapped name if it differs from ID (mapping found), otherwise keep original name
          const name = displayName !== model.id ? displayName : (model.name || displayName);
          return { ...model, providerId: provider.id, name };
        });
      }
      // If no models explicitly selected, show all discovered models
      // (admin hasn't filtered yet, so all are available)
      return discovered.map(model => {
        const displayName = getModelDisplayName(model.id);
        const name = displayName !== model.id ? displayName : (model.name || displayName);
        return { ...model, providerId: provider.id, name };
      });
    });
}
