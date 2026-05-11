import { NextRequest, NextResponse } from 'next/server';
import {
  addApiProvider,
  deleteApiProvider,
  discoverModelsForCredentials,
  getApiProviders,
  getPublicApiProviders,
  refreshApiProvider,
  sanitizeProvider,
  updateApiProvider,
} from '@/lib/server-api-config';
import { requireAdminUser } from '@/lib/server-auth';
import type { ApiProvider } from '@/lib/universal-api-types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Admin session required' }, { status: 401 });
  }
  const providers = await getPublicApiProviders();
  return NextResponse.json({ success: true, providers });
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin session required' }, { status: 401 });
    }

    const body = await request.json();
    const action = body.action as string | undefined;

    if (action === 'discover') {
      const result = await discoverModelsForCredentials(body.baseUrl, body.apiKey, body.modelType || 'universal');
      return NextResponse.json(result);
    }

    if (action === 'delete') {
      const success = await deleteApiProvider(String(body.providerId || ''));
      return NextResponse.json({ success });
    }

    if (action === 'test') {
      // Return full API key for client-side connection testing (browser can reach APIs that sandbox cannot)
      const providers = await getApiProviders();
      const provider = providers.find((p: ApiProvider) => p.id === String(body.providerId || ''));
      if (!provider) {
        return NextResponse.json({ success: false, error: 'Provider not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, apiKey: provider.apiKey, baseUrl: provider.baseUrl });
    }

    if (action === 'update') {
      const updates = { ...(body.updates || {}) } as Partial<ApiProvider>;
      if (!updates.apiKey) delete updates.apiKey;
      const provider = await updateApiProvider(String(body.providerId || ''), updates);
      return NextResponse.json({ success: Boolean(provider), provider: provider ? sanitizeProvider(provider) : null });
    }

    if (action === 'refresh') {
      const provider = await refreshApiProvider(String(body.providerId || ''));
      return NextResponse.json({ success: Boolean(provider), provider: provider ? sanitizeProvider(provider) : null });
    }

    const provider = await addApiProvider({
      name: String(body.name || ''),
      baseUrl: String(body.baseUrl || ''),
      apiKey: String(body.apiKey || ''),
      modelType: body.modelType || 'image',
      requestStyle: body.requestStyle,
      selectedModels: Array.isArray(body.selectedModels) ? body.selectedModels : undefined,
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
