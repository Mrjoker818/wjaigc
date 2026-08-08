import { NextRequest, NextResponse } from 'next/server';
import { getPublicApiProviders, getPublicModels } from '@/lib/server-api-config';
import type { ApiKind } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import {
  resolveTaskModelCatalogResult,
  taskModelKey,
} from '@/lib/task-core/model-catalog';

export const dynamic = 'force-dynamic';

const WORKFLOW_MODEL_TYPES = new Set<ApiKind>([
  'image', 'chat', 'universal', 'general', '3d', 'vectorize', 'layer',
  'video', 'vlm', 'imageEdit', 'upscaler', 'removebg', 'audio',
]);

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
  const catalogResult = await resolveTaskModelCatalogResult(models, user);
  const filteredModels = models.filter(model => (
    catalogResult.authorizedModelKeys.has(taskModelKey(model.providerId, model.id))
  ));

  return NextResponse.json({
    success: true,
    models: filteredModels.map(model => {
      const key = taskModelKey(model.providerId, model.id);
      const effectiveType = catalogResult.effectiveModelTypes.get(key);
      return {
        ...model,
        ...(model.type && effectiveType && model.type !== effectiveType
          ? { type: effectiveType }
          : {}),
        provider: providerNames.get(model.providerId) || model.providerId,
      };
    }),
    taskModelCatalog: catalogResult.taskModelCatalog,
    modelAuthorizationMigration: catalogResult.modelAuthorizationMigration,
  });
}
