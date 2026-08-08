import { NextRequest, NextResponse } from 'next/server';
import { getPublicApiProviders, getPublicModels } from '@/lib/server-api-config';
import type { ApiKind } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { getRuntimeSettings } from '@/lib/runtime-settings';
import {
  resolveTaskModelCatalogResult,
  taskModelKey,
} from '@/lib/task-core/model-catalog';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type') as ApiKind | null;
  const [providers, models, user, runtimeSettings] = await Promise.all([
    getPublicApiProviders(),
    getPublicModels(type || undefined),
    getSessionUser(request),
    getRuntimeSettings(),
  ]);

  // Legacy bare IDs are accepted only when they resolve to one visible provider.
  const catalogResult = await resolveTaskModelCatalogResult(models, user);
  const filteredModels = models.filter(model => (
    catalogResult.authorizedModelKeys.has(taskModelKey(model.providerId, model.id))
  ));

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
    providers,
    models: responseModels,
    taskModelCatalog: catalogResult.taskModelCatalog,
    modelAuthorizationMigration: catalogResult.modelAuthorizationMigration,
    quickCreatePolicy: {
      autoModelRouting: runtimeSettings.quickCreateAutoModelRouting,
      globalDefault: availableModelIds.has(configuredDefault) ? configuredDefault : '',
      quickCreateDefault: availableModelIds.has(quickCreateDefault) ? quickCreateDefault : '',
    },
  });
}
