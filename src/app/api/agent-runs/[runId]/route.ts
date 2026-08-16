import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  agentRuntimeHttpError,
  cancelAgentRun,
  getAgentRunProjection,
} from '@/lib/agent-runtime/service';

interface AgentRunRouteContext {
  params: Promise<{ runId: string }>;
}

export async function GET(
  request: NextRequest,
  context: AgentRunRouteContext,
): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { runId } = await context.params;
    const projection = await getAgentRunProjection({
      actorUserId: auth.userId,
      runId,
    });
    return NextResponse.json({ projection });
  } catch (error) {
    const response = agentRuntimeHttpError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
export async function DELETE(
  request: NextRequest,
  context: AgentRunRouteContext,
): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { runId } = await context.params;
    return NextResponse.json(await cancelAgentRun({
      actorUserId: auth.userId,
      runId,
    }));
  } catch (error) {
    const response = agentRuntimeHttpError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
