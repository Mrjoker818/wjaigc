import 'server-only';

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { PoolClient } from 'pg';
import type { ApiBalanceInfo, ApiProvider, ModelInfo, ApiKind } from './universal-api-types';
export type { ApiProvider, ModelInfo, ApiBalanceInfo, ApiKind };
import { fetchWithV1Retry, shouldSkipV1Retry } from './api-helpers';
import { getModelDisplayName } from './model-name-map';
import { getServerSystemDir } from './server-data-root';
import { dbGetApiProviders, dbUpsertApiProvider, dbDeleteApiProvider } from './db-storage';
import { isDatabaseConfigured } from './db-client';
import {
  get302UpscaleModelsForProvider,
  resolve302UpscaleModelId,
  resolve302UpscaleModelSelection,
} from './302-upscale-models';
import {
  getConfiguredModelsForProvider,
  inferModelType,
  modelTypeForProvider,
  resolveEffectiveModelType,
} from './model-type-classification';
export { inferModelType, resolveEffectiveModelType } from './model-type-classification';

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

/**
 * Normalize advancedParams from DB storage format to Record<string, string>.
 * DB may store as:
 * - Record<string, string> (e.g. { "compatProfile": "apimart" })
 * - Array<{key: string, value: string}> (admin panel key-value pairs)
 * Returns a flat Record<string, string> in all cases.
 */
function normalizeAdvancedParams(raw: unknown): Record<string, string> {
  if (!raw) return {};
  // PostgreSQL may return JSONB as a string
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeAdvancedParams(parsed);
    } catch { return {}; }
  }
  if (Array.isArray(raw)) {
    const result: Record<string, string> = {};
    for (const item of raw) {
      if (item && typeof item === 'object' && 'key' in item && 'value' in item) {
        const key = String(item.key).trim();
        if (key) result[key] = String(item.value ?? '');
      }
    }
    return result;
  }
  if (typeof raw === 'object') {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const normalizedKey = key.trim();
      if (!normalizedKey) continue;
      if (typeof value === 'string') {
        result[normalizedKey] = value;
      } else if (value !== undefined) {
        try {
          result[normalizedKey] = JSON.stringify(value);
        } catch {
          // Ignore values that cannot cross the JSONB/string boundary safely.
        }
      }
    }
    return result;
  }
  return {};
}

interface StoredApiConfig {
  providers: ApiProvider[];
  updatedAt: number;
}

interface AddProviderInput {
  name: string;
  displayName?: string;
  baseUrl: string;
  apiKey: string;
  modelType: ApiKind;
  requestStyle?: 'chat-completions' | 'images-generations' | 'custom' | 'auto';
  selectedModels?: string[];
  discoveredModels?: ModelInfo[];
  advancedParams?: Record<string, string>;
  isDefault?: boolean;
}

export type PublicApiProvider = Omit<ApiProvider,
  'apiKey' | 'balanceUsername' | 'balancePassword' | 'advancedParams' | 'balance'
>;

export type AdminApiProvider = Omit<ApiProvider,
  'apiKey' | 'balanceUsername' | 'balancePassword' | 'balance'
>;

export function sanitizeProvider(provider: ApiProvider): PublicApiProvider {
  // This object is returned by unauthenticated model discovery endpoints.
  // An allow-list prevents future credential fields leaking through a rest spread.
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    isEnabled: provider.isEnabled,
    type: provider.type,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
    ...(provider.modelType ? { modelType: provider.modelType } : {}),
    ...(provider.displayName ? { displayName: provider.displayName } : {}),
    ...(provider.providerPreset ? { providerPreset: provider.providerPreset } : {}),
    ...(provider.requestStyle ? { requestStyle: provider.requestStyle } : {}),
    ...(provider.selectedModel ? { selectedModel: provider.selectedModel } : {}),
    ...(provider.selectedModels ? { selectedModels: provider.selectedModels } : {}),
    ...(provider.isRelay !== undefined ? { isRelay: provider.isRelay } : {}),
    ...(provider.connectionStatus ? { connectionStatus: provider.connectionStatus } : {}),
    ...(provider.lastTestedAt ? { lastTestedAt: provider.lastTestedAt } : {}),
    ...(provider.discoveredModels ? { discoveredModels: provider.discoveredModels } : {}),
    ...(provider.isDefault !== undefined ? { isDefault: provider.isDefault } : {}),
    ...(provider.sortOrder !== undefined ? { sortOrder: provider.sortOrder } : {}),
  };
}

export function sanitizeProviders(providers: ApiProvider[]): PublicApiProvider[] {
  return providers.map(sanitizeProvider);
}

export function sanitizeAdminProvider(provider: ApiProvider): AdminApiProvider {
  return {
    ...sanitizeProvider(provider),
    advancedParams: { ...(provider.advancedParams || {}) },
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed;
}

/** AI Link video API preset models (no /v1/models endpoint available) */
const AI_LINK_VIDEO_MODELS = [
  'kling-v3',
  'viduq3',
  'grok-video-3',
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
  'happyhorse-1.0',
];

/** Check if a base URL belongs to AI Link video API */
function isAiLinkBaseUrl(baseUrl: string): boolean {
  const lower = (baseUrl || '').toLowerCase();
  return lower.includes('ai-link.shop') || lower.includes('ailink.shop');
}

function formatModel(model: Record<string, unknown>, provider: ApiProvider): ModelInfo {
  const id = String(model.id || model.name || '').trim();
  const providerType = modelTypeForProvider(provider);
  // 对于 video/audio 类型提供商，未知模型不应回退为该类型（否则 LLM/图像模型会通过视频过滤）
  // 改为回退为 'chat'，这样只有被 inferModelType 明确识别为 video 的模型才会出现在列表中
  const fallback = (providerType === 'video' || providerType === 'audio') ? 'chat' : providerType;
  return {
    id,
    name: id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    providerId: provider.id,
    type: inferModelType(id, fallback),
    owned_by: typeof model.owned_by === 'string' ? model.owned_by : undefined,
  };
}

/** Normalize selected_models from DB: handle JSON string, comma-separated string, or array */
function normalizeSelectedModels(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((m): m is string => typeof m === 'string');
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return [];
    // Try JSON parse first (handles '["a","b"]' format from PostgreSQL)
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter((m): m is string => typeof m === 'string');
    } catch { /* not JSON */ }
    // Fallback: comma-separated string
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

/** Normalize discovered_models from DB: handle JSON string or array */
function normalizeDiscoveredModels(val: unknown, providerId: string, modelType: string): ModelInfo[] {
  const validTypes = ['image', 'chat', '3d', 'vectorize', 'layer', 'video', 'vlm', 'upscaler', 'removebg', 'general', 'universal', 'imageEdit', 'audio'] as const;
  type ModelType = typeof validTypes[number];
  const readStringList = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value) || value.length > 32) return undefined;
    const result: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      if (typeof item !== 'string') return undefined;
      const normalized = item.trim();
      if (!normalized || normalized.length > 128) return undefined;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(normalized);
      }
    }
    return result;
  };
  const readDurationList = (value: unknown): number[] | undefined => {
    if (!Array.isArray(value) || value.length > 32) return undefined;
    const result: number[] = [];
    const seen = new Set<number>();
    for (const item of value) {
      if (typeof item !== 'number' || !Number.isInteger(item) || item < 1 || item > 3600) {
        return undefined;
      }
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
    return result;
  };
  const readInteger = (value: unknown, minimum: number, maximum: number): number | undefined => (
    typeof value === 'number'
      && Number.isInteger(value)
      && value >= minimum
      && value <= maximum
      ? value
      : undefined
  );
  const resolveType = (t: unknown): ModelType => {
    if (typeof t === 'string' && validTypes.includes(t as ModelType)) return t as ModelType;
    if (validTypes.includes(modelType as ModelType)) return modelType as ModelType;
    return 'image';
  };
  let arr: unknown[] = [];
  if (Array.isArray(val)) {
    arr = val;
  } else if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) arr = parsed;
    } catch { /* not JSON */ }
  }
  return arr.map((m: unknown) => {
    if (m && typeof m === 'object' && !Array.isArray(m)) {
      const rec = m as Record<string, unknown>;
      const displayName = rec.displayName as string | undefined;
      const supportedAspectRatios = readStringList(rec.supportedAspectRatios);
      const supportedQualities = readStringList(rec.supportedQualities);
      const capabilities = readStringList(rec.capabilities);
      const outputKinds = readStringList(rec.outputKinds);
      const supportedOperations = readStringList(rec.supportedOperations)?.filter(operation => (
        [
          'text-to-image', 'image-to-image', 'text-to-video', 'image-to-video',
          'first-last-frame', 'multi-reference', 'video-extend',
        ].includes(operation)
      )) as ModelInfo['supportedOperations'] | undefined;
      const allowedDurationsSeconds = readDurationList(rec.allowedDurationsSeconds);
      const maxImages = readInteger(rec.maxImages, 1, 4);
      const maxReferenceImages = readInteger(rec.maxReferenceImages, 0, 16);
      const maxDurationSeconds = readInteger(rec.maxDurationSeconds, 1, 3600);
      return {
        id: (rec.id as string) || '',
        name: (rec.name as string) || (rec.id as string) || '',
        ...(displayName ? { displayName } : {}),
        providerId,
        type: resolveType(rec.type) as ModelInfo['type'],
        ...(rec.description ? { description: rec.description as string } : {}),
        ...(readInteger(rec.contextWindow, 1, 10_000_000) !== undefined
          ? { contextWindow: readInteger(rec.contextWindow, 1, 10_000_000) }
          : {}),
        ...(rec.owned_by ? { owned_by: rec.owned_by as string } : {}),
        ...(supportedAspectRatios !== undefined ? { supportedAspectRatios } : {}),
        ...(supportedQualities !== undefined ? { supportedQualities } : {}),
        ...(maxImages !== undefined ? { maxImages } : {}),
        ...(maxReferenceImages !== undefined ? { maxReferenceImages } : {}),
        ...(allowedDurationsSeconds !== undefined ? { allowedDurationsSeconds } : {}),
        ...(maxDurationSeconds !== undefined ? { maxDurationSeconds } : {}),
        ...(supportedOperations !== undefined ? { supportedOperations } : {}),
        ...(outputKinds !== undefined ? { outputKinds } : {}),
        ...(capabilities !== undefined ? { capabilities } : {}),
      } as ModelInfo;
    }
    if (typeof m === 'string') {
      return { id: m, name: m, providerId, type: resolveType(modelType) as ModelInfo['type'] } as ModelInfo;
    }
    return null;
  }).filter((m): m is ModelInfo => m !== null && m.id !== '');
}

interface ReadConfigOptions {
  migrateFileProviders?: boolean;
  strict?: boolean;
  client?: PoolClient;
}

async function readConfig(options: ReadConfigOptions = {}): Promise<StoredApiConfig> {
  // Try database first (persistent across deployments)
  try {
    const readDatabase = Boolean(options.client) || !options.strict || isDatabaseConfigured();
    const dbProviderRows = readDatabase
      ? await dbGetApiProviders(options.client ? { client: options.client, throwOnError: true } : options.strict ? { throwOnError: true } : undefined)
      : [];
    if (((options.strict || options.client) && readDatabase) || dbProviderRows.length > 0) {
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
        selectedModels: normalizeSelectedModels(p.selected_models),
        advancedParams: normalizeAdvancedParams(p.advanced_params),
        isDefault: p.is_default,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        connectionStatus: (['untested', 'success', 'failed'].includes(p.connection_status || '') ? p.connection_status as ApiProvider['connectionStatus'] : undefined),
        discoveredModels: normalizeDiscoveredModels(p.discovered_models, p.id, p.model_type),
        sortOrder: p.sort_order ?? i,
        balanceUsername: p.balance_username || '',
        balancePassword: p.balance_password || '',
      }));
      return {
        providers,
        updatedAt: Date.now(),
      };
    }
  } catch (error) {
    if (options.strict || options.client) throw error;
    // DB not available, fall through to file
  }

  // Fallback to file system
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StoredApiConfig;
    if (options.strict && (!parsed || !Array.isArray(parsed.providers))) {
      throw new Error('Invalid API provider configuration');
    }
    const config = {
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      updatedAt: parsed.updatedAt || Date.now(),
    };
    // Migrate file data to database if DB is available
    if (!options.strict && options.migrateFileProviders !== false && config.providers.length > 0) {
      migrateProvidersToDb(config.providers).catch(() => {});
    }
    return config;
  } catch (error) {
    if (options.strict && !(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
    return { providers: [], updatedAt: Date.now() };
  }
}

async function migrateProvidersToDb(providers: ApiProvider[]): Promise<void> {
  for (let i = 0; i < providers.length; i++) {
    await persistProviderToDb(providers[i], i);
  }
}

async function persistProviderToDb(provider: ApiProvider, fallbackSortOrder: number): Promise<void> {
  const persisted = await dbUpsertApiProvider({
    id: provider.id,
    name: provider.name,
    display_name: provider.displayName || provider.name,
    base_url: provider.baseUrl,
    api_key: provider.apiKey,
    is_enabled: provider.isEnabled,
    type: provider.type || 'image',
    model_type: provider.modelType || 'image',
    request_style: provider.requestStyle || 'images-generations',
    selected_models: provider.selectedModels || [],
    advanced_params: provider.advancedParams || {},
    is_default: provider.isDefault ?? false,
    created_at: provider.createdAt || Date.now(),
    updated_at: provider.updatedAt || Date.now(),
    connection_status: provider.connectionStatus,
    discovered_models: (provider.discoveredModels || []) as unknown as Record<string, unknown>[],
    sort_order: provider.sortOrder ?? fallbackSortOrder,
    balance_username: provider.balanceUsername || '',
    balance_password: provider.balancePassword || '',
  });
  if (!persisted) {
    throw new Error(`Failed to persist API provider ${provider.id}`);
  }
}

async function writeConfigBackup(config: StoredApiConfig): Promise<void> {
  await mkdir(SYSTEM_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify({ ...config, updatedAt: Date.now() }, null, 2), 'utf8');
}

async function writeConfig(config: StoredApiConfig): Promise<void> {
  // Write to database (persistent across deployments)
  // Use await to ensure DB is in sync, then clean up stale providers
  try {
    await migrateProvidersToDb(config.providers);
    // Clean up providers in DB that are no longer in the current config
    const currentIds = config.providers.map(p => p.id);
    const dbProviders = await dbGetApiProviders();
    for (const dbp of dbProviders) {
      if (!currentIds.includes(dbp.id)) {
        await dbDeleteApiProvider(dbp.id).catch(() => {});
      }
    }
  } catch {}

  // Also write to file system as backup
  await writeConfigBackup(config);
}

export async function getApiProviders(options: ReadConfigOptions = {}): Promise<ApiProvider[]> {
  const providers = (await readConfig(options)).providers;
  // Ensure sortOrder is assigned and sort by it
  providers.forEach((p, i) => { if (p.sortOrder == null) p.sortOrder = i; });
  providers.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return providers;
}

/** Same transaction only: no file fallback, migration, bootstrap or independent pool. */
export async function getApiProvidersWithClient(client: PoolClient): Promise<ApiProvider[]> {
  return getApiProviders({ client, strict: true, migrateFileProviders: false });
}

export async function getApiProvider(id: string): Promise<ApiProvider | null> {
  const providers = await getApiProviders();
  return providers.find(p => p.id === id) || null;
}

export async function getPublicApiProviders(): Promise<PublicApiProvider[]> {
  return sanitizeProviders(await getApiProviders({ migrateFileProviders: false }));
}

export async function discoverModelsForCredentials(
  baseUrl: string,
  apiKey: string,
  modelType: ApiKind,
): Promise<{ success: boolean; models: ModelInfo[]; message: string; latencyMs: number }> {
  const startedAt = Date.now();
  const known302UpscaleModels = get302UpscaleModelsForProvider(baseUrl, modelType);
  if (known302UpscaleModels.length > 0) {
    return {
      success: true,
      models: known302UpscaleModels,
      message: '302.AI 放大模型已加载：Super-Upscale V2、Upscale V6',
      latencyMs: Date.now() - startedAt,
    };
  }

  // AI Link video API has no /v1/models endpoint — return preset model list
  if (modelType === 'video' && isAiLinkBaseUrl(baseUrl)) {
    const aiLinkModels: ModelInfo[] = AI_LINK_VIDEO_MODELS.map(id => ({
      id,
      name: id,
      providerId: 'ai-link',
      type: 'video' as const,
    }));
    return {
      success: true,
      models: aiLinkModels,
      message: `AI Link 视频模型已加载：${aiLinkModels.length} 个模型`,
      latencyMs: Date.now() - startedAt,
    };
  }
  const probeProvider: ApiProvider = {
    id: 'probe',
    name: 'probe',
    baseUrl,
    apiKey,
    isEnabled: true,
    type: modelType as ApiProvider['type'],
    modelType,
    createdAt: startedAt,
    updatedAt: startedAt,
  };

  try {
    const normalizedBase = normalizeBaseUrl(baseUrl);
    const response = await fetchWithV1Retry(
      normalizedBase,
      '/models',
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
        skipV1Retry: shouldSkipV1Retry(normalizedBase),
      }
    );

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      // Some providers don't expose /models endpoint but their generation endpoints work fine
      // Return partial success: API is reachable but model list is unavailable
      const isReachable = response.status < 500; // 4xx = API reached, just denied/not found
      try {
        const errorData = await response.json();
        const errorMsg = errorData?.error?.message || errorData?.message || `${response.status} ${response.statusText}`;
        return {
          success: isReachable, // 4xx means API is reachable even if /models failed
          models: [],
          message: isReachable
            ? `API 可达但模型列表不可用（${errorMsg}），生成功能可能正常`
            : errorMsg,
          latencyMs
        };
      } catch {
        return {
          success: isReachable,
          models: [],
          message: isReachable
            ? `API 可达但模型列表不可用（HTTP ${response.status}），生成功能可能正常`
            : `HTTP ${response.status}: API 返回了非 JSON 响应，请检查 Base URL 是否正确`,
          latencyMs
        };
      }
    }

    let data: Record<string, unknown>;
    try {
      data = await response.json();
    } catch {
      // JSON parse failed — likely HTML response from a non-API URL
      return { success: false, models: [], message: 'API 返回了非 JSON 响应，请检查 Base URL 是否正确（可能需要添加或去掉 /v1 路径）', latencyMs };
    }
    const rawModels = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    const models = rawModels
      .map((m: Record<string, unknown>) => formatModel(m, probeProvider))
      .filter((m: ModelInfo) => m.id && (
        // For general/universal/vectorize/layer/upscaler/removebg: show all models (admin picks what they need)
        modelType === 'universal' ||
        modelType === 'general' ||
        modelType === 'vectorize' ||
        modelType === 'layer' ||
        modelType === 'upscaler' ||
        modelType === 'removebg' ||
        // For image/chat/3d/video/audio: only show models matching the selected type
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
    displayName: input.displayName?.trim() || input.name.trim(),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    apiKey: input.apiKey.trim(),
    isEnabled: true,
    type: input.modelType as ApiProvider['type'],
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

  // Use client-provided discoveredModels if available, otherwise auto-discover
  let discovery: { success: boolean; models: ModelInfo[]; message: string; latencyMs: number } | null = null;
  if (input.discoveredModels && input.discoveredModels.length > 0) {
    provider.discoveredModels = input.discoveredModels.map(model => ({ ...model, providerId: id }));
  } else {
    discovery = await discoverModelsForCredentials(provider.baseUrl, provider.apiKey, input.modelType);
    provider.discoveredModels = discovery.models.map(model => ({ ...model, providerId: id }));
  }

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
  } else if (input.modelType === 'upscaler') {
    const matched = provider.discoveredModels.filter(m => {
      const mid = m.id.toLowerCase();
      // 通用放大关键词
      const isUpscaler = mid.includes('upscaler') || mid.includes('upscale') ||
        mid.includes('real-esrgan') || mid.includes('realesrgan') ||
        mid.includes('seedvr') || mid.includes('swinir') ||
        mid.includes('gfpgan') || mid.includes('esrgan');
      // 302.AI 原生端点只允许两个已验证的模型。
      const is302Upscale = Boolean(resolve302UpscaleModelId(mid));
      return isUpscaler || is302Upscale;
    });
    // upscaler类型：只勾选匹配的模型，不要fallback到全部模型（避免勾选大量无关模型）
    provider.selectedModels = matched.length > 0 ? matched.map(m => m.id) : [];
  } else if (input.modelType === 'removebg') {
    const matched = provider.discoveredModels.filter(m => {
      const mid = m.id.toLowerCase();
      return mid.includes('removebg') || mid.includes('remove-bg') || mid.includes('rmbg') ||
        mid.includes('birefnet') || mid.includes('u2net') || mid.includes('isnet') ||
        mid.includes('background') || mid.includes('matting');
    });
    provider.selectedModels = matched.length > 0 ? matched.map(m => m.id) : provider.discoveredModels.map(model => model.id);
  } else {
    provider.selectedModels = input.selectedModels?.length ? input.selectedModels : provider.discoveredModels.map(model => model.id);
  }

  provider.selectedModel = provider.selectedModels[0];
  provider.connectionStatus = discovery?.success ? 'success' : (input.discoveredModels?.length ? 'success' : 'untested');
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

  // 只在 baseUrl 或 apiKey 实际发生变化时才重新发现模型
  const baseUrlChanged = updates.baseUrl && updates.baseUrl !== current.baseUrl;
  const apiKeyChanged = updates.apiKey && updates.apiKey !== current.apiKey;
  if (baseUrlChanged || apiKeyChanged) {
    const discovery = await discoverModelsForCredentials(next.baseUrl, next.apiKey, next.modelType || 'universal');
    // 合并：保留用户手动修改的 displayName
    const existingModelMap = new Map((current.discoveredModels || []).map(m => [m.id, m]));
    next.discoveredModels = discovery.models.map(model => {
      const existing = existingModelMap.get(model.id);
      return {
        ...model,
        providerId: next.id,
        // 如果用户手动修改过 displayName，保留用户的修改
        displayName: existing?.displayName || model.displayName,
      };
    });
    next.connectionStatus = discovery.success ? 'success' : 'failed';
    next.lastTestedAt = Date.now();
  } else if (updates.discoveredModels) {
    // 没有重新发现模型，但前端发送了更新后的 discoveredModels（含用户修改的 displayName）
    next.discoveredModels = updates.discoveredModels;
  }

  const providersToPersist = new Map<string, ApiProvider>();
  const previousProvidersById = new Map(config.providers.map(provider => [provider.id, provider]));
  if (updates.isDefault) {
    config.providers = config.providers.map(provider =>
      provider.modelType === next.modelType ? { ...provider, isDefault: false } : provider,
    );
    for (const provider of config.providers) {
      if (
        provider.id !== providerId
        && previousProvidersById.get(provider.id)?.isDefault !== provider.isDefault
      ) {
        providersToPersist.set(provider.id, provider);
      }
    }
  }

  config.providers[index] = next;
  providersToPersist.set(next.id, next);
  for (const provider of providersToPersist.values()) {
    await persistProviderToDb(provider, config.providers.indexOf(provider));
  }
  // The database is the authoritative source. Updating only changed rows avoids
  // stale whole-config snapshots overwriting concurrent edits to other providers.
  await writeConfigBackup(config);
  return next;
}

export async function deleteApiProvider(providerId: string): Promise<boolean> {
  const config = await readConfig();
  const next = config.providers.filter(provider => provider.id !== providerId);
  if (next.length === config.providers.length) return false;
  // Delete from database and wait for result to ensure consistency
  await dbDeleteApiProvider(providerId);
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

export async function findProviderForModel(modelId: string, modelType?: ApiKind, preferredProviderId?: string): Promise<ApiProvider | null> {
  const providers = await getApiProviders();
  const enabled = providers.filter(provider => provider.isEnabled && provider.baseUrl && provider.apiKey);
  const isFlexibleType = !modelType || modelType === 'universal' || modelType === 'general';
  const matchesType = (p: ApiProvider) => isFlexibleType || p.modelType === modelType || p.modelType === 'universal' || p.modelType === 'general';

  // 0. 如果指定了 preferredProviderId，优先精确匹配该提供商
  if (preferredProviderId) {
    const preferred = enabled.find(provider =>
      provider.id === preferredProviderId &&
      matchesType(provider) &&
      (provider.selectedModels || []).includes(modelId),
    );
    if (preferred) {
      return preferred;
    }
    // 即使该提供商不包含此模型，也尝试直接返回该提供商（可能别名模型只有该提供商有）
    const byIdOnly = enabled.find(provider => provider.id === preferredProviderId && matchesType(provider));
    if (byIdOnly) {
      console.log(`[findProviderForModel] 指定提供商 "${byIdOnly.displayName || byIdOnly.name}" 不包含模型 "${modelId}"，但仍使用该提供商`);
      return byIdOnly;
    }
    console.warn(`[findProviderForModel] ⚠️ preferredProviderId="${preferredProviderId}" 未找到匹配的提供商，回退到模型匹配`);
  }

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
export async function findProviderForFeature(feature: 'vectorize' | 'layer' | '3d' | 'imageEdit' | 'chat' | 'video' | 'vlm' | 'upscaler' | 'removebg' | 'audio' | 'image'): Promise<ApiProvider | null> {
  const kindMap: Record<string, ApiKind> = {
    vectorize: 'vectorize',
    layer: 'layer',
    '3d': '3d',
    imageEdit: 'image',
    image: 'image',
    chat: 'chat',
    video: 'video',
    vlm: 'vlm',
    upscaler: 'upscaler',
    removebg: 'removebg',
    audio: 'audio',
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
  // For legacy imageEdit, include image-type providers
  const effectiveType = modelType;
  const enabled = providers.filter(p => p.isEnabled && (p.modelType === effectiveType || p.modelType === 'universal' || p.modelType === 'general'));
  // Sort: default providers first
  enabled.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
  return enabled.map(provider => {
    const selected = provider.selectedModels || [];
    const discovered = provider.discoveredModels || [];
    const resolved302Models = effectiveType === 'upscaler'
      ? resolve302UpscaleModelSelection(provider.baseUrl, selected)
      : null;
    // If admin has explicitly selected models, use only those
    const models = resolved302Models ?? (selected.length > 0
      ? selected
      : discovered.map(m => m.id));
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

function decoratePublicModel(provider: ApiProvider, model: ModelInfo): ModelInfo {
  const effectiveModel = {
    ...model,
    providerId: provider.id,
    type: resolveEffectiveModelType(provider, model),
  };
  const adminDisplayName = effectiveModel.displayName || '';
  const providerName = effectiveModel.name && effectiveModel.name !== effectiveModel.id
    ? effectiveModel.name
    : '';
  const mappedName = getModelDisplayName(effectiveModel.id);
  const name = adminDisplayName || providerName || mappedName;
  const apiDisplayName = providerName || mappedName;
  return {
    ...effectiveModel,
    name,
    apiDisplayName,
    displayName: adminDisplayName || undefined,
  } as ModelInfo;
}

export function getPublicModelsFromProviders(
  providers: ApiProvider[],
  modelType?: ApiKind,
): ModelInfo[] {
  const isGeneralQuery = !modelType || modelType === 'universal' || modelType === 'general';

  return providers
    .filter(provider => provider.isEnabled && provider.baseUrl && provider.apiKey)
    .flatMap(provider => {
      return getConfiguredModelsForProvider(provider)
        .map(model => decoratePublicModel(provider, model));
    })
    .filter(model => isGeneralQuery || model.type === modelType);
}

export interface PublicModelCatalogSnapshot {
  configuredProviders: ApiProvider[];
  providers: PublicApiProvider[];
  models: ModelInfo[];
}

export async function getPublicModelCatalogSnapshot(): Promise<PublicModelCatalogSnapshot> {
  const configuredProviders = await getApiProviders({ migrateFileProviders: false });
  return {
    configuredProviders,
    providers: sanitizeProviders(configuredProviders),
    models: getPublicModelsFromProviders(configuredProviders),
  };
}

export async function getPublicModels(modelType?: ApiKind): Promise<ModelInfo[]> {
  return getPublicModelsFromProviders(
    await getApiProviders({ migrateFileProviders: false }),
    modelType,
  );
}
