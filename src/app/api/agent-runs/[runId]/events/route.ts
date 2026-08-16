import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  AgentRunRequestError,
  agentRuntimeHttpError,
  listAgentRunEvents,
} from '@/lib/agent-runtime/service';

interface AgentRunEventRouteContext {
  params: Promise<{ runId: string }>;
}

function parseAfter(value: string | null): number {
  if (value === null) return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AgentRunRequestError('after must be a non-negative integer');
  }
  return parsed;
}

export async function GET(
  request: NextRequest,
  context: AgentRunEventRouteContext,
): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { runId } = await context.params;
    const events = await listAgentRunEvents({
      actorUserId: auth.userId,
      runId,
      afterSequence: parseAfter(request.nextUrl.searchParams.get('after')),
    });
    return NextResponse.json({ events });
  } catch (error) {
    const response = agentRuntimeHttpError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
