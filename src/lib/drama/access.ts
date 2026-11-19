import { NextResponse } from 'next/server';
import { platformsForUser } from '@/lib/platform-routes';

/** 403 for a user without the video platform, which the drama workbench belongs to; null when allowed. */
export function videoForbidden(user: { productType?: string | null; role?: string } | undefined): NextResponse | null {
  if (platformsForUser(user).includes('video')) return null;
  return NextResponse.json(
    { error: '当前账号未开通视频创作，请联系管理员开通', code: 'VIDEO_PLATFORM_FORBIDDEN' },
    { status: 403 },
  );
}
