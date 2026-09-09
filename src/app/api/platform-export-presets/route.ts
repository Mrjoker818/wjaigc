import { NextRequest, NextResponse } from 'next/server';
import { listEnabledPlatformExportPresets } from '@/lib/multi-platform-export/presets';
import { getRuntimeSettings } from '@/lib/runtime-settings';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  void _request;
  const settings = await getRuntimeSettings();
  if (!settings.multiPlatformExportEnabled) {
    return NextResponse.json({ success: true, presets: [] });
  }
  const presets = await listEnabledPlatformExportPresets();
  return NextResponse.json({ success: true, presets });
}
