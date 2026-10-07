import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { resolveSkillRunAssets, SkillAssetScopeError } from '@/lib/skill-runtime/document-assets';

export async function GET(request: NextRequest, context: {params: Promise<{runId: string}>}): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const query = request.nextUrl.searchParams;
  const projectId = query.get('projectId');
  const assetVersionIds = query.getAll('assetVersionId');
  if (!projectId || query.getAll('projectId').length !== 1
    || [...query.keys()].some(key => key !== 'projectId' && key !== 'assetVersionId')
    || !assetVersionIds.length || assetVersionIds.length > 100
    || new Set(assetVersionIds).size !== assetVersionIds.length) {
    return NextResponse.json({error: 'SKILL_ASSET_REQUEST_INVALID'}, {status: 400});
  }
  try {
    const {runId} = await context.params;
    return NextResponse.json(await resolveSkillRunAssets({actorUserId: auth.user.id,
      projectId,runId,assetVersionIds,signal: request.signal}));
  } catch (error) {
    return NextResponse.json({error: 'SKILL_ASSET_SCOPE_REJECTED'}, {status: error instanceof SkillAssetScopeError ? 403 : 503});
  }
}
