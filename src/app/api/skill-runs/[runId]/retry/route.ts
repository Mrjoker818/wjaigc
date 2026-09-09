import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  dispatchSkillRunExecution,
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
    const result = await retrySkillStep({
      actorUserId: auth.user.id,
      runId,
      stepId: body.stepId.trim(),
    });
    if ('newAttempt' in result && result.newAttempt) {
      const execution = await dispatchSkillRunExecution({
        actorUserId: auth.user.id,
        runId: result.runId,
        recoveryOnly: result.reused,
      });
      if (execution.completion) {
        void execution.completion.catch(error => {
          console.error('[skill-runtime] controlled retry dispatch completion failed', {
            runId: result.runId,
            code: error instanceof Error ? error.name : 'UNKNOWN',
          });
        });
      }
      return NextResponse.json({
        ...result,
        startedStepIds: execution.started ? result.scheduledStepIds.slice(0, 1) : [],
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    const response = skillRuntimeHttpError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
