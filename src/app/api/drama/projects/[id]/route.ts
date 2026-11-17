import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { DramaDocumentError, parseDramaProject } from '@/lib/drama/schema';
import { deleteDramaProject, DramaVersionConflictError, getDramaProject, saveDramaProject } from '@/lib/drama/store';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const NOT_FOUND = { error: '剧本项目不存在或已被删除' };

function validId(id: string): boolean {
  return /^drama_[0-9a-f-]{36}$/.test(id);
}

export async function GET(request: NextRequest, context: Context) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!validId(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  try {
    const record = await getDramaProject(auth.userId, id);
    return record
      ? NextResponse.json({ success: true, project: record })
      : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (error) {
    console.error({ code: 'DRAMA_PROJECT_READ_FAILED', error });
    return NextResponse.json({ error: '剧本项目读取失败，请稍后重试' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: Context) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!validId(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const version = Number(body?.version);
    if (!body || !Number.isInteger(version) || version < 1) {
      return NextResponse.json({ error: '缺少当前版本号，请刷新后重试' }, { status: 400 });
    }
    const record = await saveDramaProject(auth.userId, id, version, parseDramaProject(body.doc));
    return record
      ? NextResponse.json({ success: true, project: record })
      : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (error) {
    if (error instanceof DramaVersionConflictError) {
      return NextResponse.json({
        error: '这个剧本已在其他窗口修改过。请刷新载入最新版本，再重新编辑。',
        code: 'DRAMA_VERSION_CONFLICT',
        currentVersion: error.currentVersion,
      }, { status: 409 });
    }
    if (error instanceof DramaDocumentError) {
      return NextResponse.json({
        error: error.code === 'DRAMA_DOC_TOO_LARGE'
          ? '剧本项目超过 2MB，请删减不用的镜头或分集后再保存'
          : '剧本项目格式不正确，请刷新后重试',
        code: error.code,
      }, { status: 400 });
    }
    console.error({ code: 'DRAMA_PROJECT_SAVE_FAILED', error });
    return NextResponse.json({ error: '剧本项目保存失败，请稍后重试' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!validId(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  try {
    return await deleteDramaProject(auth.userId, id)
      ? NextResponse.json({ success: true })
      : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (error) {
    console.error({ code: 'DRAMA_PROJECT_DELETE_FAILED', error });
    return NextResponse.json({ error: '剧本项目删除失败，请稍后重试' }, { status: 500 });
  }
}
