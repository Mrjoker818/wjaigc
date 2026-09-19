import { NextRequest, NextResponse } from 'next/server';

import { CanvasShareError } from '@/lib/canvas-share/errors';
import {
  assertCanvasShareMutationRequest,
  canvasShareErrorResponse,
  canvasShareSuccess,
  CanvasShareHttpError,
  isCanvasShareEnabled,
  parseCanvasShareId,
  parseCanvasSharePatchRequest,
  projectCanvasShareForOwner,
  readCanvasShareJson,
} from '@/lib/canvas-share/request';
import { patchCanvasSharePolicy } from '@/lib/canvas-share/service';
import { getSessionUser } from '@/lib/server-auth';

interface RouteContext {
  params: Promise<{ shareId: string }>;
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) throw new CanvasShareHttpError('AUTHENTICATION_REQUIRED');
    if (!isCanvasShareEnabled()) throw new CanvasShareError('CANVAS_SHARE_DISABLED');
    assertCanvasShareMutationRequest(request);
    const { shareId: rawShareId } = await context.params;
    const shareId = parseCanvasShareId(rawShareId);
    const patch = parseCanvasSharePatchRequest(await readCanvasShareJson(request));
    const share = await patchCanvasSharePolicy({
      actorUserId: sessionUser.id,
      shareId,
      patch,
    });
    return canvasShareSuccess(request, {
      share: projectCanvasShareForOwner(share),
    });
  } catch (error) {
    return canvasShareErrorResponse(request, error);
  }
}
