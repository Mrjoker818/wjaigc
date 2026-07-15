import { NextRequest, NextResponse } from 'next/server';
import {
  addApiProvider,
  deleteApiProvider,
  discoverModelsForCredentials,
  getPublicApiProviders,
  refreshApiProvider,
  reorderProviders,
  sanitizeProvider,
  updateApiProvider,
} from '@/lib/server-api-config';
import { requireAdminUser } from '@/lib/server-auth';
import type { ApiKind, ApiProvider } from '@/lib/universal-api-types';

export const dynamic = 'force-dynamic';

const API_KINDS: ApiKind[] = ['image', 'chat', 'universal', 'general', '3d', 'vectorize', 'layer', 'video', 'vlm', 'imageEdit', 'upscaler', 'removebg', 'audio'];

function resolveApiKind(value: unknown): ApiKind {
  return typeof value === 'string' && API_KINDS.includes(value as ApiKind)
    ? value as ApiKind
    : 'image';
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin session required' }, { status: 401 });
    }
    const providers = await getPublicApiProviders();
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
            existing.modelType || 'image',
          );
          return NextResponse.json(result);
        }
        return NextResponse.json({ success: false, error: 'Provider not found' });
      }
      // discover action: use provided credentials
      const result = await discoverModelsForCredentials(
        String(body.baseUrl || ''),
        String(body.apiKey || ''),
        resolveApiKind(body.modelType),
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
      const provider = await updateApiProvider(String(body.providerId || ''), updates as Partial<ApiProvider>);
      return NextResponse.json({ success: Boolean(provider), provider: provider ? sanitizeProvider(provider) : null });
    }

    if (action === 'refresh') {
      const provider = await refreshApiProvider(String(body.providerId || ''));
      return NextResponse.json({ success: Boolean(provider), provider: provider ? sanitizeProvider(provider) : null });
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
    const provider = await addApiProvider({
      name,
      displayName: body.displayName ? String(body.displayName).trim() : undefined,
      baseUrl,
      apiKey,
      modelType: body.modelType || 'image',
      requestStyle: body.requestStyle,
      selectedModels: Array.isArray(body.selectedModels) ? body.selectedModels : undefined,
      discoveredModels: Array.isArray(body.discoveredModels) ? body.discoveredModels : undefined,
      advancedParams: body.advancedParams,
      isDefault: Boolean(body.isDefault),
    });

    return NextResponse.json({ success: true, provider: sanitizeProvider(provider) });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'API config failed',
    }, { status: 500 });
  }
}
