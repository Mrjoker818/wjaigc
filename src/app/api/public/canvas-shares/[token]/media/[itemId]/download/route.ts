import { NextRequest, NextResponse } from 'next/server';

import { CanvasShareError } from '@/lib/canvas-share/errors';
import {
  parseCanvasSharePublicItemRef,
  parseCanvasSharePublicToken,
} from '@/lib/canvas-share/public-projection';
import {
  enforceCanvasSharePublicRateLimit,
  getCanvasShareRequestIp,
} from '@/lib/canvas-share/public-rate-limit';
import {
  applyCanvasSharePublicHeaders,
  canvasSharePublicErrorResponse,
  isCanvasShareEnabled,
} from '@/lib/canvas-share/request';
import { readPublicCanvasShareMedia } from '@/lib/canvas-share/service';
import { hashCanvasShareToken } from '@/lib/canvas-share/token';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ token: string; itemId: string }>;
}

function encodeDispositionFileName(fileName: string): string {
  return encodeURIComponent(fileName).replace(/[!'()*]/gu, character => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}

async function handleDownloadRequest(
  request: NextRequest,
  context: RouteContext,
  headOnly: boolean,
): Promise<NextResponse> {
  try {
    if (!isCanvasShareEnabled()) throw new CanvasShareError('CANVAS_SHARE_NOT_FOUND');
    const params = await context.params;
    const token = parseCanvasSharePublicToken(params.token);
    const itemRef = parseCanvasSharePublicItemRef(params.itemId);
    const tokenDigest = hashCanvasShareToken(token);
    const media = await readPublicCanvasShareMedia({
      token,
      itemRef,
      download: true,
      rangeHeader: request.headers.get('range'),
      headOnly,
      onAuthorized: () => enforceCanvasSharePublicRateLimit({
        tokenDigest,
        itemScope: itemRef,
        ipAddress: getCanvasShareRequestIp(request.headers),
        routeBucket: 'download',
      }),
    });
    if (!headOnly && media.bytes === null) {
      throw new CanvasShareError('CANVAS_SHARE_MEDIA_UNAVAILABLE');
    }
    const encodedName = encodeDispositionFileName(media.fileName);
    const response = new NextResponse(
      headOnly || media.bytes === null ? null : new Uint8Array(media.bytes),
      {
        status: media.range ? 206 : 200,
        headers: {
          'Content-Type': media.mimeType,
          'Content-Length': String(media.contentLength),
          'Content-Disposition': `attachment; filename="${media.fileName}"; filename*=UTF-8''${encodedName}`,
          ...(media.range ? {
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${media.range.start}-${media.range.end}/${media.totalBytes}`,
          } : {}),
        },
      },
    );
    return applyCanvasSharePublicHeaders(response);
  } catch (error) {
    return canvasSharePublicErrorResponse(request, error);
  }
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  return handleDownloadRequest(request, context, false);
}

export async function HEAD(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  return handleDownloadRequest(request, context, true);
}
