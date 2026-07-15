import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { listDesktopUpdateFiles, readDesktopUpdateConfig, saveDesktopUpdateConfig } from '@/lib/desktop-cloud';
import { dbAddAuditLog } from '@/lib/db-storage';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  const [config, files] = await Promise.all([readDesktopUpdateConfig(), listDesktopUpdateFiles()]);
  return NextResponse.json({ success: true, config, files });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求体格式错误，请检查JSON格式' }, { status: 400 });
  }
  const config = await saveDesktopUpdateConfig(body || {});
  const files = await listDesktopUpdateFiles();
  await dbAddAuditLog({ user_id: admin.id, user_name: admin.name, action: 'desktop_update_publish', target_type: 'desktop-update', target_id: config.version, detail: JSON.stringify({ enabled: config.enabled, packageUrl: config.packageUrl }), ip_address: null, created_at: Date.now() });
  return NextResponse.json({ success: true, config, files });
}
