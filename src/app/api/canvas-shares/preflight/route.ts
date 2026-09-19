import { NextRequest, NextResponse } from 'next/server';

import { CanvasShareError } from '@/lib/canvas-share/errors';
import {
  assertCanvasShareMutationRequest,
  canvasShareErrorResponse,
  canvasShareSuccess,
  CanvasShareHttpError,
  isCanvasShareEnabled,
  parseCanvasSharePreflightRequest,
  readCanvasShareJson,
} from '@/lib/canvas-share/request';
import { preflightCanvasShare } from '@/lib/canvas-share/service';
import { getSessionUser } from '@/lib/server-auth';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) throw new CanvasShareHttpError('AUTHENTICATION_REQUIRED');
    if (!isCanvasShareEnabled()) throw new CanvasShareError('CANVAS_SHARE_DISABLED');
    assertCanvasShareMutationRequest(request);
    const input = parseCanvasSharePreflightRequest(await readCanvasShareJson(request));
    const result = await preflightCanvasShare({
      actorUserId: sessionUser.id,
      projectId: input.projectId,
      ...(input.requestedViewport === undefined
        ? {}
        : { requestedViewport: input.requestedViewport }),
    });
    return canvasShareSuccess(request, { ...result });
  } catch (error) {
    return canvasShareErrorResponse(request, error);
  }
}
