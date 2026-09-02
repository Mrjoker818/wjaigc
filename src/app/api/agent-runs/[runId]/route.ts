import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  AgentRunRequestError,
  agentRuntimeHttpError,
  cancelAgentRun,
  getAgentRunProjection,
  pauseAgentRun,
  resumeAgentRun,
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

export async function PATCH(
  request: NextRequest,
  context: AgentRunRouteContext,
): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AgentRunRequestError();
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new AgentRunRequestError();
    }
    const action = body as Record<string, unknown>;
    const { runId } = await context.params;
    if (action.action === 'pause') {
      if (typeof action.nextStepId !== 'string') {
        throw new AgentRunRequestError('nextStepId is required to pause');
      }
      return NextResponse.json(await pauseAgentRun({
        actorUserId: auth.userId,
        runId,
        nextStepId: action.nextStepId,
      }));
    }
    if (action.action === 'resume') {
      return NextResponse.json(await resumeAgentRun({
        actorUserId: auth.userId,
        runId,
      }));
    }
    throw new AgentRunRequestError('Unsupported Agent run action');
  } catch (error) {
    const response = agentRuntimeHttpError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
