import { NextRequest, NextResponse } from 'next/server';
import { getPublicApiProviders, getPublicModels } from '@/lib/server-api-config';
import type { ApiKind } from '@/lib/server-api-config';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type') as ApiKind | null;
  const [providers, models] = await Promise.all([
    getPublicApiProviders(),
    getPublicModels(type || undefined),
  ]);

  return NextResponse.json({ success: true, providers, models });
}
