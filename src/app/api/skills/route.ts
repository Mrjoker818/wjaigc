import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  copySkillForUser,
  createConversationSkillForUser,
  loadUserSkillCatalog,
} from '@/lib/skill-runtime/storage';
import type { SkillSurface } from '@/lib/skill-runtime/types';
import {
  assertOnlyFields,
  parseBoundedString,
  readStrictJsonObject,
  SkillRequestError,
  skillHttpError,
} from './http';

export const runtime = 'nodejs';

const SURFACES: readonly SkillSurface[] = ['canvas', 'workflow', 'simple-chat'];
const CREATE_SKILL_MAX_BODY_LENGTH = 128 * 1_024;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;

  const surface = request.nextUrl.searchParams.get('surface');
  if (!surface || !SURFACES.includes(surface as SkillSurface)) {
    return NextResponse.json(
      { code: 'INVALID_SKILL_SURFACE', error: 'surface must be canvas, workflow, or simple-chat' },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json({
      skills: await loadUserSkillCatalog(auth.userId, surface as SkillSurface),
    });
  } catch (error) {
    return skillHttpError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await readStrictJsonObject(request, CREATE_SKILL_MAX_BODY_LENGTH);
    if ('sourceSkillId' in body) {
      assertOnlyFields(body, ['sourceSkillId']);
      const sourceSkillId = parseBoundedString(body.sourceSkillId, 'sourceSkillId', 128);
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(sourceSkillId)) {
        throw new SkillRequestError('INVALID_REQUEST_BODY', 400, 'sourceSkillId is invalid');
      }
      const skill = await copySkillForUser(auth.userId, sourceSkillId);
      return NextResponse.json({ skill }, { status: 201 });
    }
    assertOnlyFields(body, ['name', 'description', 'category', 'systemPrompt', 'conversation']);
    const skill = await createConversationSkillForUser(auth.userId, {
      name: parseBoundedString(body.name, 'name', 120),
      description: parseBoundedString(body.description, 'description', 2_000),
      category: parseBoundedString(body.category, 'category', 64),
      systemPrompt: parseBoundedString(body.systemPrompt, 'systemPrompt', 32_768),
      conversation: parseBoundedString(body.conversation, 'conversation', 6_000),
    });
    return NextResponse.json({ skill }, { status: 201 });
  } catch (error) {
    return skillHttpError(error);
  }
}
