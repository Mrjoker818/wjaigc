import 'server-only';

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { ApiBalanceInfo, ApiProvider, ModelInfo } from './universal-api-types';
import { getModelDisplayName } from './model-name-map';
import { getServerSystemDir } from './server-data-root';
import { dbGetApiProviders, dbUpsertApiProvider, dbDeleteApiProvider } from './db-storage';

const SYSTEM_DIR = getServerSystemDir();
const CONFIG_PATH = path.join(SYSTEM_DIR, 'api-providers.json');
const DISCOVERY_TIMEOUT_MS = 8000;

/**
 * Normalize API base URL
 * - Only trims trailing slashes; does NOT auto-append /v1
 * - Users enter the complete base URL (e.g. https://api.openai.com/v1 or https://api.example.com)
 * - API routes append paths like /images/generations directly
 */
export function normalizeApiBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
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
  return 'image';
}

function inferModelType(modelId: string, fallback: 'image' | 'chat' | '3d' | 'vectorize' | 'layer'): 'image' | 'chat' | '3d' | 'vectorize' | 'layer' {
  const id = modelId.toLowerCase();
  if (id.includes('3d') || id.includes('tripo') || id.includes('meshy') || id.includes('hunyuan')) return '3d';
  if (id.includes('vector') || id.includes('vtracer') || id.includes('starvector') || id.includes('svg')) return 'vectorize';
  if (id.includes('layer') || id.includes('segment') || id.includes('sam') || id.includes('detection') || id.includes('yolo')) return 'layer';
  if (
    id.includes('image') ||
    id.includes('dall-e') ||
    id.includes('flux') ||
    id.includes('stable') ||
    id.includes('sd') ||
    id.includes('midjourney') ||
    id.includes('imagen') ||
    id.includes('seedream')
  ) return 'image';
  if (
    id.includes('gpt') ||
    id.includes('claude') ||
    id.includes('gemini') ||
    id.includes('qwen') ||
    id.includes('deepseek') ||
    id.includes('llama') ||
    id.includes('glm')
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
      const providers: ApiProvider[] = dbProviderRows.map(p => ({
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
  for (const p of providers) {
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
  return (await readConfig()).providers;
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
    type: input.modelType === 'chat' ? 'chat' : input.modelType === 'imageEdit' ? 'imageEdit' : input.modelType === 'image' ? 'image' : 'universal',
    modelType: input.modelType,
    requestStyle: input.requestStyle === 'auto' ? 'auto' : (input.requestStyle || (input.modelType === 'chat' ? 'chat-completions' : 'images-generations')),
    selectedModels: input.selectedModels || [],
    advancedParams: input.advancedParams || {},
    isDefault: input.isDefault,
    createdAt: now,
    updatedAt: now,
    connectionStatus: 'untested',
  };

  const discovery = await discoverModelsForCredentials(provider.baseUrl, provider.apiKey, input.modelType);
  provider.discoveredModels = discovery.models.map(model => ({ ...model, providerId: id }));
  provider.selectedModels = input.selectedModels?.length ? input.selectedModels : provider.discoveredModels.map(model => model.id);
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
  // Delete from database explicitly
  dbDeleteApiProvider(providerId).catch(() => {});
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
          type: modelTypeForProvider(provider),
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
