import { NextRequest, NextResponse } from 'next/server';
import { getDesktopAuth, listResources, tokenFromHeader } from '@/lib/desktop-cloud';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await getDesktopAuth(tokenFromHeader(request.headers.get('authorization')));
    if (!auth) return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
    const type = request.nextUrl.searchParams.get('type') || undefined;
    const resources = await listResources({ type, enabledOnly: true });
    return NextResponse.json({ success: true, resources });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Resources failed', resources: [] }, { status: 500 });
  }
}
