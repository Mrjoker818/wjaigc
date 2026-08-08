import { NextRequest, NextResponse } from 'next/server';
import { getPublicModelCatalogSnapshot } from '@/lib/server-api-config';
import type { ApiKind } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { getRuntimeSettings } from '@/lib/runtime-settings';
import {
  matchesRequestedModelType,
  resolveTaskModelCatalogResultFromSnapshot,
  serializeModelAuthorizationMigration,
  taskModelKey,
} from '@/lib/task-core/model-catalog';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestedType = request.nextUrl.searchParams.get('type');
  const type = requestedType && requestedType !== 'all'
    ? requestedType as ApiKind
    : null;
  const [snapshot, user, runtimeSettings] = await Promise.all([
    getPublicModelCatalogSnapshot(),
    getSessionUser(request),
    getRuntimeSettings(),
  ]);

  const catalogResult = resolveTaskModelCatalogResultFromSnapshot(
    snapshot.models,
    user,
    snapshot.configuredProviders,
  );
  const filteredModels = snapshot.models.filter(model => {
    const key = taskModelKey(model.providerId, model.id);
    return (
      catalogResult.authorizedModelKeys.has(key)
      && matchesRequestedModelType(catalogResult.effectiveModelTypes.get(key), requestedType)
    );
  });

  const configuredDefault = type === 'image'
    ? runtimeSettings.defaultImageModel
    : type === 'chat'
      ? runtimeSettings.defaultChatModel
      : type === 'video'
        ? runtimeSettings.defaultVideoModel
        : '';
  const quickCreateDefault = type === 'image'
    ? runtimeSettings.quickCreateImageModel
    : type === 'chat'
      ? runtimeSettings.quickCreateChatModel
      : '';
  const responseModels = filteredModels.map(model => {
    const key = taskModelKey(model.providerId, model.id);
    const effectiveType = catalogResult.effectiveModelTypes.get(key);
    return {
      ...model,
      ...(model.type && effectiveType && model.type !== effectiveType
        ? { type: effectiveType }
        : {}),
      isDefault: Boolean(configuredDefault && key === configuredDefault),
    };
  });
  const availableModelIds = new Set(responseModels.map(model => `${model.providerId}::${model.id}`));

  return NextResponse.json({
    success: true,
    providers: snapshot.providers,
    models: responseModels,
    taskModelCatalog: catalogResult.taskModelCatalog.filter(model => {
      const key = taskModelKey(model.providerId, model.modelId);
      return matchesRequestedModelType(
        catalogResult.effectiveModelTypes.get(key),
        requestedType,
      );
    }),
    modelAuthorizationMigration: serializeModelAuthorizationMigration(
      catalogResult.modelAuthorizationMigration,
      user,
    ),
    quickCreatePolicy: {
      autoModelRouting: runtimeSettings.quickCreateAutoModelRouting,
      globalDefault: availableModelIds.has(configuredDefault) ? configuredDefault : '',
      quickCreateDefault: availableModelIds.has(quickCreateDefault) ? quickCreateDefault : '',
    },
  });
}
