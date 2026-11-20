import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { videoForbidden } from '@/lib/drama/access';
import { dramaPlannerConfig, DramaPlannerSelectionError, withPlanRetry, writeDramaScript } from '@/lib/drama/draft';
import { buildDramaShotMessages, callDramaLlm, DramaPlannerError, parseDramaShotResponse } from '@/lib/drama/planner';
import { buildPolishMessages, parsePolishResponse } from '@/lib/drama/polish';
import { DramaDocumentError, parseDramaProject } from '@/lib/drama/schema';
import { DIRECTOR_STYLES, normalizeDirectorStyle } from '@/lib/video-director/director-styles';

export const dynamic = 'force-dynamic';
// One planner call may take 90s and is retried once when the reply cannot be parsed.
export const maxDuration = 200;

const ASPECT_RATIOS = new Set(['9:16', '16:9', '1:1', '4:3', '3:4', '21:9']);
const MAX_IDEA_CHARS = 4000;

function plannerError(error: unknown): NextResponse {
  if (error instanceof DramaPlannerSelectionError) return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
  if (error instanceof DramaDocumentError) {
    return NextResponse.json({ error: '剧本项目格式不正确，请刷新后重试', code: error.code }, { status: 400 });
  }
  if (error instanceof DramaPlannerError) {
    if (error.code === 'DRAMA_SOURCE_STALE') return NextResponse.json({ error: '正文已修改，请先在剧本步骤更新分场，再拆解分镜', code: error.code }, { status: 409 });
    if (error.code === 'DRAMA_PLANNER_UNAVAILABLE') {
      return NextResponse.json({ error: '剧本助手暂时连不上对话模型，请稍后重试', code: error.code }, { status: 503 });
    }
    return error.retryable
      ? NextResponse.json({ error: 'AI 返回的内容无法整理成剧本，请再试一次', code: error.code }, { status: 502 })
      : NextResponse.json({ error: '找不到这一场，或这一集已达到 120 个镜头上限', code: error.code }, { status: 400 });
  }
  console.error({ code: 'DRAMA_PLAN_FAILED', error });
  return NextResponse.json({ error: '剧本助手出错了，请稍后重试' }, { status: 500 });
}

/**
 * POST /api/drama/plan
 * { action: 'script', idea, title?, genre?, style?, aspectRatio?, episodeCount?, episodeDurationSec? } → { doc }
 * { action: 'shots', doc, episodeId, sceneId, shotCount?, shotDurationSec? } → { shots }
 * { action: 'polish', doc, shotId } → { shot: { prompt, shotSize?, cameraMotion?, lighting?, audioCues? } }
 */
export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const denied = videoForbidden(auth.user);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || (body.action !== 'script' && body.action !== 'shots' && body.action !== 'polish')) {
    return NextResponse.json({ error: '请求内容不正确，请刷新后重试' }, { status: 400 });
  }
  try {
  const documentSelection = body.doc && typeof body.doc === 'object' ? (body.doc as Record<string, unknown>).planner : undefined;
  const rawSelection = body.planner ?? documentSelection;
  if (rawSelection !== undefined && (!rawSelection || typeof rawSelection !== 'object' || Array.isArray(rawSelection)
    || typeof (rawSelection as Record<string, unknown>).providerId !== 'string' || !(rawSelection as Record<string, unknown>).providerId
    || typeof (rawSelection as Record<string, unknown>).modelId !== 'string' || !(rawSelection as Record<string, unknown>).modelId)) {
    return NextResponse.json({ error: '请选择完整的编剧供应商和模型', code: 'DRAMA_PLANNER_INVALID_SELECTION' }, { status: 400 });
  }
  const selection = rawSelection && typeof rawSelection === 'object' ? rawSelection as Record<string, unknown> : {};
  const config = await dramaPlannerConfig(request.signal, {
    user: auth.user,
    ...(typeof selection.providerId === 'string' ? { providerId: selection.providerId } : {}),
    ...(typeof selection.modelId === 'string' ? { modelId: selection.modelId } : {}),
  });
  if (!config) {
    return NextResponse.json({
      error: '还没有可用的对话模型。请在后台供应商设置里启用一个对话模型后再生成剧本。', code: 'DRAMA_PLANNER_NOT_CONFIGURED',
    }, { status: 503 });
  }
    if (body.action === 'script') {
      const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
      if (!idea) return NextResponse.json({ error: '先写一句话说明这部短剧讲什么' }, { status: 400 });
      if (idea.length > MAX_IDEA_CHARS) return NextResponse.json({ error: `创意最多 ${MAX_IDEA_CHARS} 字，请精简后再生成` }, { status: 400 });
      const input = {
        idea,
        title: typeof body.title === 'string' ? body.title.slice(0, 200) : undefined,
        genre: typeof body.genre === 'string' ? body.genre.slice(0, 100) : undefined,
        style: normalizeDirectorStyle(body.style),
        aspectRatio: typeof body.aspectRatio === 'string' && ASPECT_RATIOS.has(body.aspectRatio) ? body.aspectRatio : '9:16',
        episodeCount: Number(body.episodeCount) || 1,
        episodeDurationSec: Number(body.episodeDurationSec) || 60,
      };
      return NextResponse.json({ success: true, doc: await writeDramaScript(config, input) });
    }

    if (body.action === 'polish') {
      const doc = parseDramaProject(body.doc);
      const messages = buildPolishMessages(doc, typeof body.shotId === 'string' ? body.shotId : '');
      const temperature = DIRECTOR_STYLES[normalizeDirectorStyle(doc.style)].temperature;
      const shot = await withPlanRetry(async () => parsePolishResponse(await callDramaLlm(config, messages, temperature)));
      return NextResponse.json({ success: true, shot });
    }

    const input = {
      doc: parseDramaProject(body.doc),
      episodeId: typeof body.episodeId === 'string' ? body.episodeId : '',
      sceneId: typeof body.sceneId === 'string' ? body.sceneId : '',
      shotDurationSec: Number(body.shotDurationSec) || undefined,
      allowedDurations: Array.isArray(body.allowedDurations) ? body.allowedDurations.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 2 && n <= 60).slice(0, 30) : undefined,
    };
    const shotCount = Number(body.shotCount) || undefined;
    const messages = buildDramaShotMessages({ ...input, shotCount });
    const shots = await withPlanRetry(async () => parseDramaShotResponse(await callDramaLlm(config, messages), input));
    return NextResponse.json({ success: true, shots });
  } catch (error) {
    return plannerError(error);
  }
}
