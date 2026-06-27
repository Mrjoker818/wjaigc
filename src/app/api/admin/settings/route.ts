import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { dbGetSystemSetting, dbSetSystemSetting, dbAddAuditLog } from '@/lib/db-storage';

export const dynamic = 'force-dynamic';

const ALL_SETTING_KEYS = [
  'platformName', 'openRegistration', 'initialCredits', 'defaultUserRole',
  'ipWhitelist', 'sessionTimeout', 'passwordExpiryDays',
  'storageQuotaMB', 'maxUploadMB', 'maxVideoDuration',
  'defaultImageModel', 'defaultChatModel', 'videoGenerationEnabled', '3dModelEnabled',
  'announcementEnabled', 'announcementType', 'announcementExpiry', 'announcement',
  'maxConcurrentTasks', 'imageMaxSizeMB',
];

const NUMBER_KEYS = new Set([
  'initialCredits', 'sessionTimeout', 'passwordExpiryDays',
  'storageQuotaMB', 'maxUploadMB', 'maxVideoDuration',
  'maxConcurrentTasks', 'imageMaxSizeMB',
]);

// GET: Read system settings
export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const settings: Record<string, string | number | null> = {};
    for (const key of ALL_SETTING_KEYS) {
      const val = await dbGetSystemSetting(key) as string | null;
      if (val !== null && val !== undefined) {
        settings[key] = NUMBER_KEYS.has(key) ? (parseInt(val) || 0) : val;
      }
    }
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('[admin/settings] GET error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// POST: Save system settings
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();

    const saves: Promise<unknown>[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (ALL_SETTING_KEYS.includes(key) && value !== undefined) {
        saves.push(dbSetSystemSetting(key, String(value)));
      }
    }

    await Promise.all(saves);

    // Audit log
    try {
      await dbAddAuditLog({
        user_id: admin.id || 'system',
        user_name: admin.name || null,
        action: 'settings_update',
        target_type: 'system',
        target_id: 'settings',
        detail: `更新系统设置: ${Object.keys(body).join(', ')}`,
        ip_address: null,
        created_at: Date.now(),
      });
    } catch { /* ignore */ }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[admin/settings] POST error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
