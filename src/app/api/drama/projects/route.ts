import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { authorizeGenerationProject, GenerationProjectAccessError } from '@/lib/collaboration/generation-project-access';
import { DramaDocumentError, parseDramaProject } from '@/lib/drama/schema';
import { createDramaProject, listDramaProjects } from '@/lib/drama/store';
import { createEmptyDramaProject } from '@/lib/drama/types';

export const dynamic = 'force-dynamic';

const DOC_ERRORS: Record<DramaDocumentError['code'], string> = {
  DRAMA_DOC_TOO_LARGE: '剧本项目超过 2MB，请删减不用的镜头或分集后再保存',
  DRAMA_DOC_INVALID: '剧本项目格式不正确，请刷新后重试',
};

/** Canvas project binding is optional; when given it must be a project the user may generate in. */
async function resolveProjectId(userId: string, projectId: unknown): Promise<string | null> {
  if (projectId === undefined || projectId === null || projectId === '') return null;
  const access = await authorizeGenerationProject({ actorUserId: userId, projectId });
  return access.kind === 'unscoped' ? null : access.projectId;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const projectId = request.nextUrl.searchParams.get('projectId') || undefined;
    return NextResponse.json({ success: true, projects: await listDramaProjects(auth.userId, projectId) });
  } catch (error) {
    console.error({ code: 'DRAMA_PROJECT_LIST_FAILED', error });
    return NextResponse.json({ error: '剧本项目列表读取失败，请稍后重试' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: '请求内容不是有效的 JSON' }, { status: 400 });
    const projectId = await resolveProjectId(auth.userId, body.projectId);
    const doc = body.doc === undefined
      ? createEmptyDramaProject({ title: typeof body.title === 'string' ? body.title : undefined })
      : parseDramaProject(body.doc);
    const record = await createDramaProject(auth.userId, projectId, doc);
    return NextResponse.json({ success: true, project: record }, { status: 201 });
  } catch (error) {
    if (error instanceof DramaDocumentError) {
      return NextResponse.json({ error: DOC_ERRORS[error.code], code: error.code }, { status: 400 });
    }
    if (error instanceof GenerationProjectAccessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error({ code: 'DRAMA_PROJECT_CREATE_FAILED', error });
    return NextResponse.json({ error: '剧本项目创建失败，请稍后重试' }, { status: 500 });
  }
}
