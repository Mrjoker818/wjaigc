import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  retrySkillStep,
  SkillRunRequestError,
  skillRuntimeHttpError,
} from '@/lib/skill-runtime/service';
import { assertSkillRunFields, readBoundedSkillRunJson } from '../../http';

interface SkillRunRetryRouteContext {
  params: Promise<{ runId: string }>;
}

export async function POST(request: NextRequest, context: SkillRunRetryRouteContext): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await readBoundedSkillRunJson(request, 8_192);
    assertSkillRunFields(body, ['stepId']);
    if (typeof body.stepId !== 'string' || !body.stepId.trim()) {
      throw new SkillRunRequestError('stepId is invalid');
    }
    const { runId } = await context.params;
    return NextResponse.json(await retrySkillStep({
      actorUserId: auth.user.id,
      runId,
      stepId: body.stepId.trim(),
    }));
  } catch (error) {
    const response = skillRuntimeHttpError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
