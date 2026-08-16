import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  agentRuntimeHttpError,
  createAgentRun,
  listCurrentUserAgentRuns,
  parseAgentRunRequest,
} from '@/lib/agent-runtime/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const rawLimit = request.nextUrl.searchParams.get('limit');
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return NextResponse.json({
        error: {
          code: 'AGENT_RUN_REQUEST_INVALID',
          message: 'limit must be an integer between 1 and 100',
        },
      }, { status: 400 });
    }
    const runs = await listCurrentUserAgentRuns({
      actorUserId: auth.user.id,
      limit,
    });
    return NextResponse.json({ runs });
  } catch (error) {
    const response = agentRuntimeHttpError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const runRequest = parseAgentRunRequest(await request.json());
    const result = await createAgentRun({ actor: auth.user, request: runRequest });
    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    const response = agentRuntimeHttpError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
