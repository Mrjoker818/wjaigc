import { NextRequest, NextResponse } from 'next/server';

import { CanvasShareError } from '@/lib/canvas-share/errors';
import {
  assertCanvasShareMutationRequest,
  canvasShareErrorResponse,
  canvasShareSuccess,
  CanvasShareHttpError,
  isCanvasShareEnabled,
  parseCanvasShareEmptyCommand,
  parseCanvasShareId,
  projectCanvasShareForOwner,
  readCanvasShareJson,
} from '@/lib/canvas-share/request';
import { revokeCanvasShare } from '@/lib/canvas-share/service';
import { dbAddAuditLog } from '@/lib/db-storage';
import { getSessionUser } from '@/lib/server-auth';

interface RouteContext {
  params: Promise<{ shareId: string }>;
}

export async function POST(
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
    parseCanvasShareEmptyCommand(await readCanvasShareJson(request));
    const share = await revokeCanvasShare({ actorUserId: sessionUser.id, shareId });
    await dbAddAuditLog({
      user_id: sessionUser.id,
      user_name: sessionUser.name,
      action: 'canvas_share_revoke',
      target_type: 'canvas_share',
      target_id: shareId,
      detail: JSON.stringify({ status: share.status, revokedAt: share.revokedAt }),
      ip_address: null,
      created_at: Date.now(),
    }).catch(() => undefined);
    return canvasShareSuccess(request, {
      share: projectCanvasShareForOwner(share),
    });
  } catch (error) {
    return canvasShareErrorResponse(request, error);
  }
}
