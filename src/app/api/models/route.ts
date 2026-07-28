import { NextRequest, NextResponse } from 'next/server';
import { getPublicApiProviders, getPublicModels } from '@/lib/server-api-config';
import type { ApiKind } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { getRuntimeSettings } from '@/lib/runtime-settings';
import { isModelAssignedToUser } from '@/lib/model-defaults';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type') as ApiKind | null;
  const [providers, models, user, runtimeSettings] = await Promise.all([
    getPublicApiProviders(),
    getPublicModels(type || undefined),
    getSessionUser(request),
    getRuntimeSettings(),
  ]);

  // 模型权限过滤：管理员看全部，普通用户只看显式授权的模型。
  // 同时兼容历史裸 modelId 和 providerId::modelId 两种授权格式。
  const isAdmin = user?.role === 'admin';
  let filteredModels = models;

  if (!isAdmin && user) {
    if (type === 'chat') {
      filteredModels = models.filter(model => (
        isModelAssignedToUser(user.chatModels, model.providerId, model.id)
      ));
    } else if (type === 'image' || type === 'vectorize') {
      filteredModels = models.filter(model => (
        isModelAssignedToUser(user.imageModels, model.providerId, model.id)
      ));
    }
  }

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
  const responseModels = filteredModels.map(model => ({
    ...model,
    isDefault: Boolean(configuredDefault && `${model.providerId}::${model.id}` === configuredDefault),
  }));
  const availableModelIds = new Set(responseModels.map(model => `${model.providerId}::${model.id}`));

  return NextResponse.json({
    success: true,
    providers,
    models: responseModels,
    quickCreatePolicy: {
      autoModelRouting: runtimeSettings.quickCreateAutoModelRouting,
      globalDefault: availableModelIds.has(configuredDefault) ? configuredDefault : '',
      quickCreateDefault: availableModelIds.has(quickCreateDefault) ? quickCreateDefault : '',
    },
  });
}
