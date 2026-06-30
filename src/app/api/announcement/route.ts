import { NextResponse } from 'next/server';
import { dbGetSystemSetting } from '@/lib/db-storage';

export const dynamic = 'force-dynamic';

// GET: Public announcement (no auth required)
export async function GET() {
  try {
    const enabled = String(await dbGetSystemSetting('announcementEnabled') || 'false');
    if (enabled !== 'true') {
      return NextResponse.json({ enabled: false });
    }

    const type = String(await dbGetSystemSetting('announcementType') || 'banner');
    const content = String(await dbGetSystemSetting('announcement') || '');
    const expiry = String(await dbGetSystemSetting('announcementExpiry') || '');

    // Check expiry
    if (expiry) {
      const expiryDate = new Date(expiry);
      if (!isNaN(expiryDate.getTime()) && new Date() > expiryDate) {
        return NextResponse.json({ enabled: false });
      }
    }

    return NextResponse.json({
      success: true,
      announcement: {
        enabled: true,
        type,
        text: content,
      },
    });
  } catch {
    return NextResponse.json({ enabled: false });
  }
}
