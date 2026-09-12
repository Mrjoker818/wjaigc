import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  approveSkillRunPlan,
  cancelSkillRun,
  getSkillRun,
  pauseSkillRun,
  recoverLiveSkillRunExecution,
  resumeSkillRun,
  reviseSkillRunPlan,
  SkillRunRequestError,
  skillRuntimeHttpError,
} from '@/lib/skill-runtime/service';
import {
  parseSkillApprovalIdentity,
  parseSkillRevisionInstruction,
} from '@/lib/skill-runtime/approval';
import { assertSkillRunFields, readBoundedSkillRunJson } from '../http';

interface SkillRunRouteContext {
  params: Promise<{ runId: string }>;
}

export async function GET(request: NextRequest, context: SkillRunRouteContext): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { runId } = await context.params;
    const run = await getSkillRun({ actorUserId: auth.user.id, runId });
    if (request.nextUrl.searchParams.get('observeOnly') !== 'true') {
      await recoverLiveSkillRunExecution({
        actorUserId: auth.user.id,
        runId,
        recoveryOnly: true,
      });
    }
    return NextResponse.json({ run });
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
    const { runId } = await context.params;
    const input = { actorUserId: auth.user.id, runId };
    if (body.action === 'pause' || body.action === 'resume' || body.action === 'cancel') {
      assertSkillRunFields(body, ['action']);
      if (body.action === 'pause') return NextResponse.json(await pauseSkillRun(input));
      if (body.action === 'resume') return NextResponse.json(await resumeSkillRun(input));
      return NextResponse.json(await cancelSkillRun(input));
    }
    if (body.action === 'approve' || body.action === 'revise') {
      assertSkillRunFields(body, body.action === 'approve'
        ? ['action', 'revision', 'generation', 'planChecksum']
        : ['action', 'revision', 'generation', 'planChecksum', 'revisionInstruction']);
      let identity;
      try {
        identity = parseSkillApprovalIdentity(body);
      } catch {
        throw new SkillRunRequestError('approval identity is invalid');
      }
      if (body.action === 'approve') {
        return NextResponse.json(await approveSkillRunPlan({ ...input, ...identity }));
      }
      let revisionInstruction: string;
      try {
        revisionInstruction = parseSkillRevisionInstruction(body.revisionInstruction);
      } catch {
        throw new SkillRunRequestError('revision instruction is invalid');
      }
      return NextResponse.json(await reviseSkillRunPlan({
        ...input, ...identity, revisionInstruction,
      }));
    }
    throw new SkillRunRequestError('action is invalid');
  } catch (error) {
    const response = skillRuntimeHttpError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
