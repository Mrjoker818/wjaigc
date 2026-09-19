import { NextRequest, NextResponse } from 'next/server';

import {
  createCanvasShare,
  listCanvasShares,
} from '@/lib/canvas-share/service';
import {
  assertCanvasShareMutationRequest,
  canvasShareErrorResponse,
  canvasSharePublicOrigin,
  canvasShareSuccess,
  CanvasShareHttpError,
  isCanvasShareEnabled,
  parseCanvasShareCreateRequest,
  parseCanvasShareProjectId,
  projectCanvasShareForOwner,
  readCanvasShareJson,
} from '@/lib/canvas-share/request';
import { CanvasShareError } from '@/lib/canvas-share/errors';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

async function authorize(request: NextRequest): Promise<string> {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) throw new CanvasShareHttpError('AUTHENTICATION_REQUIRED');
  if (!isCanvasShareEnabled()) throw new CanvasShareError('CANVAS_SHARE_DISABLED');
  return sessionUser.id;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const actorUserId = await authorize(request);
    const projectId = parseCanvasShareProjectId(request.nextUrl.searchParams.get('projectId'));
    const shares = await listCanvasShares({ actorUserId, projectId });
    return canvasShareSuccess(request, {
      shares: shares.map(projectCanvasShareForOwner),
    });
  } catch (error) {
    return canvasShareErrorResponse(request, error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const actorUserId = await authorize(request);
    assertCanvasShareMutationRequest(request);
    const input = parseCanvasShareCreateRequest(await readCanvasShareJson(request));
    const result = await createCanvasShare({
      actorUserId,
      projectId: input.projectId,
      title: input.title,
      ...(input.requestedViewport === undefined
        ? {}
        : { requestedViewport: input.requestedViewport }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      allowDownload: input.allowDownload,
    });
    return canvasShareSuccess(request, {
      shareUrl: `${canvasSharePublicOrigin(request)}/shared/canvas/${result.token}`,
      shareId: result.share.id,
      expiresAt: result.share.expiresAt,
      allowDownload: result.share.allowDownload,
      snapshot: {
        title: result.share.title,
        status: result.share.status,
        projectRevision: result.share.projectRevision,
        itemCount: result.itemCount,
        createdAt: result.share.createdAt,
      },
    }, 201);
  } catch (error) {
    return canvasShareErrorResponse(request, error);
  }
}
