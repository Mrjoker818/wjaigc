import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { dbGetSystemSetting, dbSetSystemSetting, dbAddAuditLog } from '@/lib/db-storage';

export const dynamic = 'force-dynamic';

const ALL_SETTING_KEYS = [
  'initialCredits', 'maxVideoDuration', 'imageMaxSizeMB', 'imageMaxEdge', 'defaultImageModel', 'defaultChatModel', 'defaultVideoModel',
  'quickCreateImageModel', 'quickCreateChatModel', 'quickCreateAutoModelRouting',
  'videoGenerationEnabled', '3dModelEnabled', 'announcementEnabled', 'announcementType', 'announcementExpiry', 'announcement',
];

const NUMBER_KEYS = new Set([
  'initialCredits', 'maxVideoDuration', 'imageMaxSizeMB', 'imageMaxEdge',
]);
const BOOLEAN_KEYS = new Set(['quickCreateAutoModelRouting', 'videoGenerationEnabled', '3dModelEnabled', 'announcementEnabled']);
const MODEL_SETTING_KEYS = new Set([
  'defaultImageModel', 'defaultChatModel', 'defaultVideoModel', 'quickCreateImageModel', 'quickCreateChatModel',
]);
const NUMBER_RANGES: Record<string, [number, number]> = {
  initialCredits: [0, 100_000],
  maxVideoDuration: [1, 15],
  imageMaxSizeMB: [1, 100],
  imageMaxEdge: [256, 8192],
};

function normalizeSetting(key: string, value: unknown): string {
  if (NUMBER_KEYS.has(key)) {
    const numeric = Number(value);
    const [min, max] = NUMBER_RANGES[key];
    if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
      throw new Error(`${key} must be an integer between ${min} and ${max}`);
    }
    return String(numeric);
  }
  if (BOOLEAN_KEYS.has(key)) {
    if (typeof value !== 'boolean') throw new Error(`${key} must be boolean`);
    return String(value);
  }
  if (MODEL_SETTING_KEYS.has(key)) {
    const modelValue = String(value).trim();
    if (modelValue.length > 300) throw new Error(`${key} is too long`);
    if (modelValue && !/^[^:\s]+::[^\s]+$/.test(modelValue)) {
      throw new Error(`${key} must use providerId::modelId format`);
    }
    return modelValue;
  }
  if (key === 'announcementType' && !['banner', 'popup', 'sidebar'].includes(String(value))) {
    throw new Error('announcementType is invalid');
  }
  if (key === 'announcement' && String(value).length > 500) {
    throw new Error('announcement is too long');
  }
  if (key === 'announcementExpiry' && String(value) && Number.isNaN(Date.parse(String(value)))) {
    throw new Error('announcementExpiry is invalid');
  }
  return String(value);
}

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
    const updatedKeys: string[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (ALL_SETTING_KEYS.includes(key) && value !== undefined) {
        let normalized: string;
        try {
          normalized = normalizeSetting(key, value);
        } catch (error) {
          return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Invalid setting value' }, { status: 400 });
        }
        saves.push(dbSetSystemSetting(key, normalized));
        updatedKeys.push(key);
      }
    }

    if (updatedKeys.length === 0) {
      return NextResponse.json({ success: false, error: 'No supported settings supplied' }, { status: 400 });
    }

    await Promise.all(saves);

    // Audit log
    try {
      await dbAddAuditLog({
        user_id: admin.id || 'system',
        user_name: admin.name || null,
        action: 'system_update',
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
