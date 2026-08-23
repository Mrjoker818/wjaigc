import { NextRequest, NextResponse } from 'next/server';
import { getPublicModelCatalogSnapshot } from '@/lib/server-api-config';
import type { ApiKind } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import {
  CAPABILITY_CATALOG_VERSION,
  matchesRequestedModelType,
  resolveTaskModelCatalogResultFromSnapshot,
  serializeModelAuthorizationMigration,
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
  const [snapshot, user] = await Promise.all([
    getPublicModelCatalogSnapshot(),
    getSessionUser(request),
  ]);
  const providerNames = new Map(snapshot.providers.map(provider => [
    provider.id,
    provider.displayName || provider.name || provider.id,
  ]));
  const catalogResult = resolveTaskModelCatalogResultFromSnapshot(
    snapshot.models,
    user,
    snapshot.configuredProviders,
  );
  const filteredModels = snapshot.models.filter(model => {
    const key = taskModelKey(model.providerId, model.id);
    return (
      catalogResult.authorizedModelKeys.has(key)
      && matchesRequestedModelType(
        catalogResult.effectiveModelTypes.get(key),
        modelType,
      )
    );
  });

  return NextResponse.json({
    success: true,
    capabilityCatalogVersion: CAPABILITY_CATALOG_VERSION,
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
    taskModelCatalog: catalogResult.taskModelCatalog.filter(model => {
      const key = taskModelKey(model.providerId, model.modelId);
      return matchesRequestedModelType(
        catalogResult.effectiveModelTypes.get(key),
        modelType,
      );
    }),
    modelAuthorizationMigration: serializeModelAuthorizationMigration(
      catalogResult.modelAuthorizationMigration,
      user,
    ),
  });
}
