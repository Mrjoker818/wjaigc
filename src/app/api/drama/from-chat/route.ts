import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { authorizeGenerationProject, GenerationProjectAccessError } from '@/lib/collaboration/generation-project-access';
import { dramaPlannerConfig, writeDramaScript } from '@/lib/drama/draft';
import { DramaPlannerError } from '@/lib/drama/planner';
import { createDramaProject } from '@/lib/drama/store';
import { parseSimpleChatWorkspaceHandoffBody } from '@/lib/simple-chat-workspace-handoff';
import { resolveSimpleChatWorkspaceHandoff, SimpleChatWorkspaceHandoffError } from '@/lib/simple-chat-workspace-handoff-server';

export const dynamic = 'force-dynamic';
// One planner call may take 90s and is retried once when the reply cannot be parsed.
export const maxDuration = 200;

const MAX_IDEA_CHARS = 4000;

const HANDOFF_ERRORS: Record<SimpleChatWorkspaceHandoffError['code'], string> = {
  FORBIDDEN: '无权读取这条对话，或无权写入目标画布项目',
  HANDOFF_SOURCE_NOT_FOUND: '原对话消息已不存在，请返回对话重新发送',
  NO_MANAGED_MEDIA: '这条消息没有文字，写不成剧本。请发送一条描述故事的消息',
};

/**
 * POST /api/drama/from-chat { targetProjectId, chatProjectId, chatTaskId, chatMessageId } → { project }
 * Writes a script draft from a simple chat message. The text is read from the user's own chat history, never from the request.
 */
export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const intent = parseSimpleChatWorkspaceHandoffBody(await request.json().catch(() => null));
  if (!intent) return NextResponse.json({ error: '对话发送信息不完整，请返回对话重新发送', code: 'INVALID_HANDOFF' }, { status: 400 });
  try {
    const handoff = await resolveSimpleChatWorkspaceHandoff({ actorUserId: auth.userId, ...intent });
    if (!handoff.text) {
      return NextResponse.json({ error: HANDOFF_ERRORS.NO_MANAGED_MEDIA, code: 'DRAMA_HANDOFF_NO_TEXT' }, { status: 422 });
    }
    const access = await authorizeGenerationProject({ actorUserId: auth.userId, projectId: intent.targetProjectId });
    const config = await dramaPlannerConfig(request.signal);
    if (!config) {
      return NextResponse.json({
        error: '还没有可用的对话模型。请在后台供应商设置里启用一个对话模型后再生成剧本。', code: 'DRAMA_PLANNER_NOT_CONFIGURED',
      }, { status: 503 });
    }
    const doc = await writeDramaScript(config, { idea: handoff.text.slice(0, MAX_IDEA_CHARS) });
    const record = await createDramaProject(auth.userId, access.kind === 'unscoped' ? null : access.projectId, doc);
    return NextResponse.json({ success: true, project: record }, { status: 201 });
  } catch (error) {
    if (error instanceof SimpleChatWorkspaceHandoffError) {
      return NextResponse.json({ error: HANDOFF_ERRORS[error.code], code: error.code }, { status: error.status });
    }
    if (error instanceof GenerationProjectAccessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof DramaPlannerError) {
      return error.code === 'DRAMA_PLANNER_UNAVAILABLE'
        ? NextResponse.json({ error: '剧本助手暂时连不上对话模型，请稍后重试', code: error.code }, { status: 503 })
        : NextResponse.json({ error: 'AI 返回的内容无法整理成剧本，请再试一次', code: error.code }, { status: 502 });
    }
    console.error({ code: 'DRAMA_FROM_CHAT_FAILED', error });
    return NextResponse.json({ error: '剧本草稿保存失败，请稍后重试' }, { status: 500 });
  }
}
