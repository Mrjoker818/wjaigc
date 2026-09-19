import { NextRequest, NextResponse } from 'next/server';

import { CanvasShareError } from '@/lib/canvas-share/errors';
import {
  parseCanvasSharePublicToken,
} from '@/lib/canvas-share/public-projection';
import {
  enforceCanvasSharePublicRateLimit,
  getCanvasShareRequestIp,
} from '@/lib/canvas-share/public-rate-limit';
import {
  canvasSharePublicDataResponse,
  canvasSharePublicErrorResponse,
  isCanvasShareEnabled,
} from '@/lib/canvas-share/request';
import { readPublicCanvasShare } from '@/lib/canvas-share/service';
import { hashCanvasShareToken } from '@/lib/canvas-share/token';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    if (!isCanvasShareEnabled()) throw new CanvasShareError('CANVAS_SHARE_NOT_FOUND');
    const token = parseCanvasSharePublicToken((await context.params).token);
    const tokenDigest = hashCanvasShareToken(token);
    const document = await readPublicCanvasShare(token, {
      onAuthorized: database => enforceCanvasSharePublicRateLimit({
        tokenDigest,
        itemScope: 'metadata',
        ipAddress: getCanvasShareRequestIp(request.headers),
        routeBucket: 'metadata',
        database,
      }),
    });
    return canvasSharePublicDataResponse(document);
  } catch (error) {
    return canvasSharePublicErrorResponse(request, error);
  }
}
