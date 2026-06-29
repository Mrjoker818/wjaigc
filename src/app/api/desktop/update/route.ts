import { NextRequest, NextResponse } from 'next/server';
import { getDesktopAuth, isNewerVersion, readDesktopUpdateConfig, tokenFromHeader } from '@/lib/desktop-cloud';

export const dynamic = 'force-dynamic';

async function handle(request: NextRequest, body?: Record<string, unknown>) {
  const token = tokenFromHeader(request.headers.get('authorization'), String(body?.token || ''));
  const auth = await getDesktopAuth(token);
  if (!auth) return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
  const currentVersion = request.nextUrl.searchParams.get('currentVersion') || String(body?.currentVersion || body?.version || '');
  const update = await readDesktopUpdateConfig();
  return NextResponse.json({
    success: true,
    currentVersion,
    hasUpdate: Boolean(update.enabled && update.version && update.packageUrl && isNewerVersion(update.version, currentVersion)),
    update: update.enabled ? update : null,
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  return handle(request, body);
}
