import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  cancelSkillRun,
  getSkillRun,
  pauseSkillRun,
  resumeSkillRun,
  SkillRunRequestError,
  skillRuntimeHttpError,
} from '@/lib/skill-runtime/service';
import { assertSkillRunFields, readBoundedSkillRunJson } from '../http';

interface SkillRunRouteContext {
  params: Promise<{ runId: string }>;
}

export async function GET(request: NextRequest, context: SkillRunRouteContext): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { runId } = await context.params;
    return NextResponse.json({ run: await getSkillRun({ actorUserId: auth.user.id, runId }) });
  } catch (error) {
    const response = skillRuntimeHttpError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PATCH(request: NextRequest, context: SkillRunRouteContext): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await readBoundedSkillRunJson(request, 8_192);
    assertSkillRunFields(body, ['action']);
    const { runId } = await context.params;
    const input = { actorUserId: auth.user.id, runId };
    if (body.action === 'pause') return NextResponse.json(await pauseSkillRun(input));
    if (body.action === 'resume') return NextResponse.json(await resumeSkillRun(input));
    if (body.action === 'cancel') return NextResponse.json(await cancelSkillRun(input));
    throw new SkillRunRequestError('action is invalid');
  } catch (error) {
    const response = skillRuntimeHttpError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
