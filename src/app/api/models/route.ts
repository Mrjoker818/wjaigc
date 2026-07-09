import { NextRequest, NextResponse } from 'next/server';
import { getPublicApiProviders, getPublicModels } from '@/lib/server-api-config';
import type { ApiKind } from '@/lib/server-api-config';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type') as ApiKind | null;
  const [providers, models, user] = await Promise.all([
    getPublicApiProviders(),
    getPublicModels(type || undefined),
    getSessionUser(request),
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

  return NextResponse.json({ success: true, providers, models: filteredModels });
}
