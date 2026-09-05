import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import { authorizeAgentContext } from '@/lib/agent-runtime/context-adapters';
import { resolveTaskModel } from '@/lib/task-core/model-catalog';
import { estimateSkillRunCost } from '@/lib/skill-runtime/cost-estimator';
import {
  buildSkillAgentRunRequest,
  authorizeAndFreezeBindings,
  SkillRunVersionError,
  type SkillRunRequest,
} from '@/lib/skill-runtime/run-request';
import { resolveExecutableSkillForUser } from '@/lib/skill-runtime/storage';
import type { SkillModelBinding, SkillSurface } from '@/lib/skill-runtime/types';
import {
  isPlainObject,
  parseBoundedString,
  readStrictJsonObject,
  SkillRequestError,
} from '@/app/api/skills/http';
import { errorResponse, getRequestId } from '@/lib/request-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const surfaces = new Set<SkillSurface>(['canvas', 'workflow', 'simple-chat']);
const roles = new Set<SkillModelBinding['role']>([
  'orchestrator', 'image', 'video', 'vision', 'edit', 'three-d',
]);

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new SkillRequestError('INVALID_REQUEST_BODY', 400, `${field} is invalid`);
  }
  return [...new Set(value.map(item => parseBoundedString(item, field, 256)))];
}

function parseModelBindings(value: unknown): SkillRunRequest['modelBindings'] {
  if (!isPlainObject(value)) {
    throw new SkillRequestError('INVALID_REQUEST_BODY', 400, 'modelBindings is invalid');
  }
  const bindings: SkillRunRequest['modelBindings'] = {};
  for (const [role, rawBinding] of Object.entries(value)) {
    if (!roles.has(role as SkillModelBinding['role']) || !isPlainObject(rawBinding)) {
      throw new SkillRequestError('INVALID_REQUEST_BODY', 400, 'modelBindings is invalid');
    }
    bindings[role as SkillModelBinding['role']] = {
      providerId: parseBoundedString(rawBinding.providerId, 'providerId', 256),
      modelId: parseBoundedString(rawBinding.modelId, 'modelId', 256),
    };
  }
  return bindings;
}

function parseEstimateRequest(body: Record<string, unknown>): SkillRunRequest {
  if (!Number.isSafeInteger(body.skillVersion) || Number(body.skillVersion) < 1) {
    throw new SkillRequestError('INVALID_REQUEST_BODY', 400, 'skillVersion is invalid');
  }
  if (!surfaces.has(body.surface as SkillSurface)) {
    throw new SkillRequestError('INVALID_REQUEST_BODY', 400, 'surface is invalid');
  }
  if (!isPlainObject(body.inputValues)) {
    throw new SkillRequestError('INVALID_REQUEST_BODY', 400, 'inputValues is invalid');
  }
  return {
    skillId: parseBoundedString(body.skillId, 'skillId', 128),
    skillVersion: Number(body.skillVersion),
    surface: body.surface as SkillSurface,
    projectId: parseBoundedString(body.projectId, 'projectId', 256),
    workspaceId: parseBoundedString(body.workspaceId, 'workspaceId', 256),
    inputValues: body.inputValues,
    sourceVersionIds: parseStringArray(body.sourceVersionIds, 'sourceVersionIds'),
    modelBindings: parseModelBindings(body.modelBindings),
    idempotencyKey: parseBoundedString(body.idempotencyKey, 'idempotencyKey', 256),
  };
}

function skillRunHttpError(error: unknown, requestId: string): NextResponse {
  if (error instanceof SkillRequestError) {
    return errorResponse(error.status, error.code, error.message, requestId);
  }
  const candidate = isPlainObject(error) ? error : {};
  const candidateCode = typeof candidate.code === 'string' ? candidate.code : '';
  const candidateStatus = typeof candidate.status === 'number'
    && Number.isInteger(candidate.status)
    && candidate.status >= 400
    && candidate.status <= 599
    ? candidate.status
    : null;
  let known = candidateStatus !== null && candidateCode.length > 0;
  let code = known ? candidateCode : 'SKILL_RUN_ERROR';
  let status = known ? candidateStatus! : 500;
  if (candidateCode.startsWith('SKILL_INPUT_') || candidateCode.startsWith('SKILL_PROMPT_')) {
    known = true;
    code = candidateCode;
    status = 400;
  } else if (candidateCode === 'MODEL_NOT_AUTHORIZED') {
    known = true;
    code = candidateCode;
    status = 403;
  } else if (candidateCode === 'MODEL_NOT_CONFIGURED') {
    known = true;
    code = candidateCode;
    status = 400;
  } else if (
    candidateCode === 'MODEL_CAPABILITY_UNAVAILABLE'
    || candidateCode === 'MODEL_CAPABILITY_MISMATCH'
  ) {
    known = true;
    code = candidateCode;
    status = 422;
  }
  return errorResponse(
    status,
    code,
    known && error instanceof Error ? error.message : 'Skill run request failed',
    requestId,
    !known,
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await readStrictJsonObject(request);
    const input = parseEstimateRequest(body);
    if (body.estimateScope !== undefined && (body.estimateScope !== 'workflow-node' || input.surface !== 'workflow')) {
      throw new SkillRequestError('INVALID_REQUEST_BODY', 400, 'estimateScope is invalid');
    }
    const skill = await resolveExecutableSkillForUser(auth.userId, input.skillId, input.surface);
    if (body.estimateScope === 'workflow-node') {
      if (skill.version !== input.skillVersion) throw new SkillRunVersionError();
      const bindings = await authorizeAndFreezeBindings(input.modelBindings, skill, {
        actorUserId: auth.userId, resolveTaskModel,
      });
      const orchestrator = bindings.orchestrator!;
      // Pricing depends on the frozen model roles, not on future upstream output.
      // This context is authorization-only and is never submitted as a run.
      await authorizeAgentContext({
        actorUserId: auth.userId,
        request: {
          projectId: input.projectId, workspace: 'workflow', workspaceId: input.workspaceId,
          mode: 'agent', providerId: orchestrator.providerId, modelId: orchestrator.modelId,
          prompt: '', sourceVersionIds: input.sourceVersionIds, allowedToolIds: [],
          idempotencyKey: input.idempotencyKey,
          context: { selectedEntityIds: [], visibleVersionIds: input.sourceVersionIds, locale: 'zh-CN' },
        },
      });
      return NextResponse.json({
        ...await estimateSkillRunCost(skill, bindings), modelBindings: bindings,
        inputValidation: 'deferred-to-execution',
      });
    }
    const agentRequest = await buildSkillAgentRunRequest(input, {
      actorUserId: auth.userId,
      resolveTaskModel,
    }, skill);
    await authorizeAgentContext({ actorUserId: auth.userId, request: agentRequest });
    const estimate = await estimateSkillRunCost(skill, agentRequest.skill!.modelBindings);
    return NextResponse.json({
      ...estimate,
      modelBindings: agentRequest.skill!.modelBindings,
    });
  } catch (error) {
    return skillRunHttpError(error, requestId);
  }
}
