import { NextRequest, NextResponse } from 'next/server';
import { desktopConfigFor, getDesktopAuth, tokenFromHeader } from '@/lib/desktop-cloud';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await getDesktopAuth(tokenFromHeader(request.headers.get('authorization')));
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
    }
    return NextResponse.json(await desktopConfigFor(auth.user));
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Desktop config failed' }, { status: 500 });
  }
}
