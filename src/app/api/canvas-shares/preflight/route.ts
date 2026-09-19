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
    return canvasShareSuccess(request, {
      projectRevision: result.projectRevision,
      itemCount: result.itemCount,
      viewport: {
        offsetX: result.viewport.offsetX,
        offsetY: result.viewport.offsetY,
        zoom: result.viewport.zoom,
      },
      readiness: {
        ready: result.readiness.ready,
        failures: result.readiness.failures.map(failure => ({
          itemIndex: failure.itemIndex,
          ...(failure.display === undefined ? {} : {
            display: {
              ...(failure.display.label === undefined
                ? {}
                : { label: failure.display.label }),
              ...(failure.display.altText === undefined
                ? {}
                : { altText: failure.display.altText }),
            },
          }),
          code: failure.code,
          message: failure.message,
        })),
      },
    });
  } catch (error) {
    return canvasShareErrorResponse(request, error);
  }
}
