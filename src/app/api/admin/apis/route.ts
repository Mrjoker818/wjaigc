import { NextRequest, NextResponse } from 'next/server';
import {
  addApiProvider,
  deleteApiProvider,
  discoverModelsForCredentials,
  getApiProviders,
  refreshApiProvider,
  reorderProviders,
  sanitizeAdminProvider,
  sanitizeProvider,
  updateApiProvider,
} from '@/lib/server-api-config';
import { requireAdminUser } from '@/lib/server-auth';
import type { ApiKind, ApiProvider } from '@/lib/universal-api-types';
import {
  parseProviderCapabilityOverridesStrict,
  serializeProviderCapabilityOverrides,
} from '@/lib/task-core/model-capability-resolution';

export const dynamic = 'force-dynamic';

function normalizeAdvancedParams(value: unknown): Record<string, string> | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      return normalizeAdvancedParams(JSON.parse(trimmed) as unknown);
    } catch {
      return null;
    }
  }
  let sourceEntries: Array<readonly [string, string] | null>;
  if (Array.isArray(value)) {
    sourceEntries = value.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const entry = item as Record<string, unknown>;
      return typeof entry.key === 'string' && typeof entry.value === 'string'
        ? [entry.key, entry.value] as const
        : null;
    });
  } else if (value && typeof value === 'object') {
    sourceEntries = Object.entries(value as Record<string, unknown>).map(([key, item]) => (
      typeof item === 'string' ? [key, item] as const : null
    ));
  } else {
    return null;
  }
  if (sourceEntries.some(entry => entry === null)) return null;
  const result = Object.create(null) as Record<string, string>;
  for (const [key, item] of sourceEntries as Array<readonly [string, string]>) {
    const normalizedKey = key.trim();
    if (normalizedKey) Object.defineProperty(result, normalizedKey, {
      value: item,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function normalizeCapabilitiesOrError(
  value: unknown,
): { ok: true; value: Record<string, string> | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  const advancedParams = normalizeAdvancedParams(value);
  if (!advancedParams) return { ok: false, error: 'advancedParams must be string key-value entries' };
  const rawCapabilities = advancedParams.taskModelCapabilities;
  if (rawCapabilities === undefined) return { ok: true, value: advancedParams };
  const parsed = parseProviderCapabilityOverridesStrict(rawCapabilities);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    value: {
      ...advancedParams,
      taskModelCapabilities: serializeProviderCapabilityOverrides(parsed.value),
    },
  };
}

function invalidCapabilitiesResponse(error: string): NextResponse {
  return NextResponse.json({
    success: false,
    code: 'INVALID_MODEL_CAPABILITIES',
    error,
  }, { status: 400 });
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin session required' }, { status: 401 });
    }
    const providers = (await getApiProviders()).map(sanitizeAdminProvider);
    return NextResponse.json({ success: true, providers });
  } catch (error) {
    console.error('[admin/apis] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load API providers', providers: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin session required' }, { status: 401 });
    }

    const body = await request.json();
    const action = body.action as string | undefined;

    if (action === 'discover' || action === 'test') {
      // test action: use existing providerId to discover models
      if (action === 'test' && body.providerId) {
        const { getApiProvider } = await import('@/lib/server-api-config');
        const existing = await getApiProvider(String(body.providerId));
        if (existing) {
          const result = await discoverModelsForCredentials(
            existing.baseUrl,
            existing.apiKey,
            (body.modelType || existing.modelType || 'image') as ApiKind,
          );
          return NextResponse.json(result);
        }
        return NextResponse.json({ success: false, error: 'Provider not found' });
      }
      // discover action: use provided credentials
      const result = await discoverModelsForCredentials(
        String(body.baseUrl || ''),
        String(body.apiKey || ''),
        (body.modelType || 'image') as ApiKind,
      );
      return NextResponse.json(result);
    }

    if (action === 'delete') {
      const success = await deleteApiProvider(String(body.providerId || ''));
      return NextResponse.json({ success });
    }

    if (action === 'update') {
      const updates = { ...(body.updates || {}) } as Partial<ApiProvider> & { displayName?: string };
      if (!updates.apiKey) delete updates.apiKey;
      const normalized = normalizeCapabilitiesOrError(updates.advancedParams);
      if (!normalized.ok) return invalidCapabilitiesResponse(normalized.error);
      if (normalized.value === undefined) delete updates.advancedParams;
      else updates.advancedParams = normalized.value;
      const provider = await updateApiProvider(String(body.providerId || ''), updates as Partial<ApiProvider>);
      return NextResponse.json({ success: Boolean(provider), provider: provider ? sanitizeAdminProvider(provider) : null });
    }

    if (action === 'refresh') {
      const provider = await refreshApiProvider(String(body.providerId || ''));
      return NextResponse.json({ success: Boolean(provider), provider: provider ? sanitizeAdminProvider(provider) : null });
    }

    if (action === 'reorder') {
      const providers = await reorderProviders(String(body.providerId || ''), body.direction as 'up' | 'down');
      if (!providers) return NextResponse.json({ success: false, error: 'Cannot reorder' });
      return NextResponse.json({ success: true, providers: providers.map(sanitizeProvider) });
    }

    // Add new provider
    const name = String(body.name || '').trim();
    const baseUrl = String(body.baseUrl || '').trim();
    const apiKey = String(body.apiKey || '').trim();
    if (!name || !baseUrl || !apiKey) {
      return NextResponse.json({ success: false, error: '配置名称、BASE URL和API Key为必填项' }, { status: 400 });
    }
    const normalized = normalizeCapabilitiesOrError(body.advancedParams);
    if (!normalized.ok) return invalidCapabilitiesResponse(normalized.error);
    const provider = await addApiProvider({
      name,
      displayName: body.displayName ? String(body.displayName).trim() : undefined,
      baseUrl,
      apiKey,
      modelType: body.modelType || 'image',
      requestStyle: body.requestStyle,
      selectedModels: Array.isArray(body.selectedModels) ? body.selectedModels : undefined,
      discoveredModels: Array.isArray(body.discoveredModels) ? body.discoveredModels : undefined,
      advancedParams: normalized.value,
      isDefault: Boolean(body.isDefault),
    });

    return NextResponse.json({ success: true, provider: sanitizeAdminProvider(provider) });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'API config failed',
    }, { status: 500 });
  }
}
