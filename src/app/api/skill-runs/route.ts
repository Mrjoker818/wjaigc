import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  createSkillRun,
  listSkillRuns,
  parseSkillRunRequest,
  startSkillRunExecution,
  skillRuntimeHttpError,
} from '@/lib/skill-runtime/service';
import { assertSkillRunFields, readBoundedSkillRunJson } from './http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const rawLimit = request.nextUrl.searchParams.get('limit');
    const limit = rawLimit === null ? 20 : Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw Object.assign(new Error('limit must be an integer between 1 and 100'), {
        code: 'SKILL_RUN_REQUEST_INVALID', status: 400,
      });
    }
    return NextResponse.json({ runs: await listSkillRuns({ actorUserId: auth.user.id, limit }) });
  } catch (error) {
    const response = skillRuntimeHttpError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await readBoundedSkillRunJson(request);
    assertSkillRunFields(body, [
      'skillId', 'skillVersion', 'surface', 'projectId', 'workspaceId',
      'inputValues', 'sourceVersionIds', 'modelBindings', 'idempotencyKey',
    ]);
    const result = await createSkillRun({
      actor: auth.user,
      request: parseSkillRunRequest(body),
    });
    if (!result.reused) {
      const execution = startSkillRunExecution({ actor: auth.user, runId: result.runId });
      void execution.completion.catch(error => {
        console.error('[skill-runtime] background execution failed', {
          runId: result.runId,
          code: error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : 'SKILL_EXECUTION_FAILED',
        });
      });
    }
    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    const response = skillRuntimeHttpError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
