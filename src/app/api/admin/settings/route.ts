import { NextResponse } from 'next/server';
import { dbGetSystemSetting, dbSetSystemSetting, dbAddAuditLog } from '@/lib/db-storage';

export const dynamic = 'force-dynamic';

// GET: Read system settings
export async function GET() {
  try {
    const keys = ['defaultImageModel', 'defaultChatModel', 'maxConcurrentTasks', 'imageMaxSizeMB', 'announcement'];
    const settings: Record<string, string | number | null> = {};
    for (const key of keys) {
      const val = await dbGetSystemSetting(key) as string | null;
      if (val !== null && val !== undefined) {
        // Try parse number
        if (key === 'maxConcurrentTasks' || key === 'imageMaxSizeMB') {
          settings[key] = parseInt(val) || null;
        } else {
          settings[key] = val;
        }
      }
    }
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// POST: Save system settings
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { defaultImageModel, defaultChatModel, maxConcurrentTasks, imageMaxSizeMB, announcement } = body;

    const saves: Promise<unknown>[] = [];
    if (defaultImageModel !== undefined) saves.push(dbSetSystemSetting('defaultImageModel', String(defaultImageModel)));
    if (defaultChatModel !== undefined) saves.push(dbSetSystemSetting('defaultChatModel', String(defaultChatModel)));
    if (maxConcurrentTasks !== undefined) saves.push(dbSetSystemSetting('maxConcurrentTasks', String(maxConcurrentTasks)));
    if (imageMaxSizeMB !== undefined) saves.push(dbSetSystemSetting('imageMaxSizeMB', String(imageMaxSizeMB)));
    if (announcement !== undefined) saves.push(dbSetSystemSetting('announcement', String(announcement)));

    await Promise.all(saves);

    // Audit log
    try {
      await dbAddAuditLog({ user_id: 'system', user_name: null, action: 'settings_update', target_type: 'system', target_id: 'settings', detail: `更新系统设置: ${Object.keys(body).join(', ')}`, ip_address: null, created_at: Date.now() });
    } catch { /* ignore */ }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
