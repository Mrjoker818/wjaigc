import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import { authorizeAgentContext } from '@/lib/agent-runtime/context-adapters';
import { resolveTaskModel } from '@/lib/task-core/model-catalog';
import { estimateSkillRunCost } from '@/lib/skill-runtime/cost-estimator';
import {
  buildSkillAgentRunRequest,
  type SkillRunRequest,
} from '@/lib/skill-runtime/run-request';
import { requireSkillForSurface } from '@/lib/skill-runtime/catalog';
import type { SkillModelBinding, SkillSurface } from '@/lib/skill-runtime/types';
import {
  isPlainObject,
  parseBoundedString,
  readStrictJsonObject,
  SkillRequestError,
  skillHttpError,
} from '@/app/api/skills/http';

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

function skillRunHttpError(error: unknown): NextResponse {
  if (error instanceof SkillRequestError) return skillHttpError(error);
  const candidate = isPlainObject(error) ? error : {};
  const code = typeof candidate.code === 'string' ? candidate.code : 'SKILL_RUN_ERROR';
  let status = typeof candidate.status === 'number' ? candidate.status : 500;
  if (code === 'MODEL_NOT_AUTHORIZED') status = 403;
  if (code === 'MODEL_NOT_CONFIGURED') status = 400;
  if (code === 'MODEL_CAPABILITY_UNAVAILABLE' || code === 'MODEL_CAPABILITY_MISMATCH') status = 422;
  const message = error instanceof Error ? error.message : 'Skill run request failed';
  return NextResponse.json({ code, error: message }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const input = parseEstimateRequest(await readStrictJsonObject(request));
    const agentRequest = await buildSkillAgentRunRequest(input, {
      actorUserId: auth.userId,
      resolveTaskModel,
    });
    await authorizeAgentContext({ actorUserId: auth.userId, request: agentRequest });
    const skill = requireSkillForSurface(input.skillId, input.surface);
    const estimate = await estimateSkillRunCost(skill, agentRequest.skill!.modelBindings);
    return NextResponse.json({
      ...estimate,
      modelBindings: agentRequest.skill!.modelBindings,
    });
  } catch (error) {
    return skillRunHttpError(error);
  }
}
