import { NextRequest, NextResponse } from 'next/server';
import { getPublicApiProviders, getPublicModels } from '@/lib/server-api-config';
import type { ApiKind } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';
import { getRuntimeSettings } from '@/lib/runtime-settings';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type') as ApiKind | null;
  const [providers, models, user, runtimeSettings] = await Promise.all([
    getPublicApiProviders(),
    getPublicModels(type || undefined),
    getSessionUser(request),
    getRuntimeSettings(),
  ]);

  // 模型权限过滤：管理员看全部，普通用户有授权列表时按列表过滤
  const isAdmin = user?.role === 'admin';
  let filteredModels = models;

  if (!isAdmin && user) {
    if (type === 'chat') {
      const allowed = user.chatModels;
      if (allowed && allowed.length > 0) {
        filteredModels = models.filter(m => allowed.includes(m.id));
      }
    } else if (type === 'image') {
      const allowed = user.imageModels;
      if (allowed && allowed.length > 0) {
        filteredModels = models.filter(m => allowed.includes(m.id));
      }
    }
  }

  const configuredDefault = type === 'image'
    ? runtimeSettings.defaultImageModel
    : type === 'chat'
      ? runtimeSettings.defaultChatModel
      : type === 'video'
        ? runtimeSettings.defaultVideoModel
        : '';
  const responseModels = filteredModels.map(model => ({
    ...model,
    isDefault: Boolean(configuredDefault && `${model.providerId}::${model.id}` === configuredDefault),
  }));

  return NextResponse.json({ success: true, providers, models: responseModels });
}
