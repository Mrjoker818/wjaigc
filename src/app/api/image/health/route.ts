import { NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { checkLocalModels } from '@/lib/check-local-models';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.userRole !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await checkLocalModels(), { headers: { 'Cache-Control': 'no-store' } });
}
