import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import { deleteUserSkill, updateUserSkill } from '@/lib/skill-runtime/storage';
import {
  assertOnlyFields,
  parseBoundedString,
  readStrictJsonObject,
  SkillRequestError,
  skillHttpError,
} from '../http';

export const runtime = 'nodejs';

interface SkillRouteContext {
  params: Promise<{ skillId: string }>;
}

async function skillIdFromContext(context: SkillRouteContext): Promise<string> {
  const { skillId: rawSkillId } = await context.params;
  const skillId = parseBoundedString(rawSkillId, 'skillId', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(skillId)) {
    throw new SkillRequestError('INVALID_REQUEST_BODY', 400, 'skillId is invalid');
  }
  return skillId;
}

export async function PATCH(
  request: NextRequest,
  context: SkillRouteContext,
): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const skillId = await skillIdFromContext(context);
    const body = await readStrictJsonObject(request);
    assertOnlyFields(body, ['enabled', 'name', 'description']);
    if (Object.keys(body).length === 0) {
      throw new SkillRequestError('INVALID_REQUEST_BODY', 400, 'At least one patch field is required');
    }
    const patch: { enabled?: boolean; name?: string; description?: string } = {};
    if ('enabled' in body) {
      if (typeof body.enabled !== 'boolean') {
        throw new SkillRequestError('INVALID_REQUEST_BODY', 400, 'enabled must be a boolean');
      }
      patch.enabled = body.enabled;
    }
    if ('name' in body) patch.name = parseBoundedString(body.name, 'name', 120);
    if ('description' in body) {
      patch.description = parseBoundedString(body.description, 'description', 2_000);
    }
    return NextResponse.json({ skill: await updateUserSkill(auth.userId, skillId, patch) });
  } catch (error) {
    return skillHttpError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: SkillRouteContext,
): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await deleteUserSkill(auth.userId, await skillIdFromContext(context));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return skillHttpError(error);
  }
}
