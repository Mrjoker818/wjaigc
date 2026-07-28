import { NextRequest, NextResponse } from 'next/server';
import { getPublicApiProviders, getPublicModels } from '@/lib/server-api-config';
import type { ApiKind, ModelInfo } from '@/lib/server-api-config';
import { isModelAssignedToUser } from '@/lib/model-defaults';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const WORKFLOW_MODEL_TYPES = new Set<ApiKind>([
  'image', 'chat', 'universal', 'general', '3d', 'vectorize', 'layer',
  'video', 'vlm', 'imageEdit', 'upscaler', 'removebg', 'audio',
]);

function filterModelsForUser(models: ModelInfo[], user: Awaited<ReturnType<typeof getSessionUser>>): ModelInfo[] {
  if (user?.role === 'admin' || !user) return models;

  return models.filter(model => {
    if (model.type === 'image' && user.imageModels?.length) {
      return user.imageModels.includes(model.id);
    }
    if (model.type === 'chat' && user.chatModels?.length) {
      return user.chatModels.includes(model.id);
    }
    if (model.type === 'layer') {
      const apiPermissions = user.apiPermissions;
      if (apiPermissions?.layer !== true) return false;
      return isModelAssignedToUser(user.imageModels, model.providerId, model.id);
    }
    return true;
  });
}

export async function GET(request: NextRequest) {
  const requestedType = request.nextUrl.searchParams.get('type');
  const modelType = requestedType && requestedType !== 'all' && WORKFLOW_MODEL_TYPES.has(requestedType as ApiKind)
    ? requestedType as ApiKind
    : undefined;
  const [providers, models, user] = await Promise.all([
    getPublicApiProviders(),
    getPublicModels(modelType),
    getSessionUser(request),
  ]);
  const providerNames = new Map(providers.map(provider => [provider.id, provider.displayName || provider.name || provider.id]));

  return NextResponse.json({
    success: true,
    models: filterModelsForUser(models, user).map(model => ({
      ...model,
      provider: providerNames.get(model.providerId) || model.providerId,
    })),
  });
}
