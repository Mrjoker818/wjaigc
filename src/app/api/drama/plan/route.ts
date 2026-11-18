import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  buildDramaScriptPrompt, buildDramaShotMessages, callDramaLlm, DramaPlannerError, parseDramaScriptResponse, parseDramaShotResponse,
  type DramaLlmConfig,
} from '@/lib/drama/planner';
import { DramaDocumentError, parseDramaProject } from '@/lib/drama/schema';
import { findProviderForFeature } from '@/lib/server-api-config';
import { normalizeDirectorStyle } from '@/lib/video-director/director-styles';

export const dynamic = 'force-dynamic';
// One planner call may take 90s and is retried once when the reply cannot be parsed.
export const maxDuration = 200;

const ASPECT_RATIOS = new Set(['9:16', '16:9', '1:1', '4:3', '3:4', '21:9']);
const MAX_IDEA_CHARS = 4000;

/** The planner uses the same chat provider as the video director's shot planning. Like shot planning it is not billed. */
async function plannerConfig(signal: AbortSignal): Promise<DramaLlmConfig | null> {
  const provider = await findProviderForFeature('chat') as unknown as Record<string, unknown> | null;
  if (!provider) return null;
  const models = Array.isArray(provider.selectedModels) ? provider.selectedModels : [];
  const modelId = String(models[0] || provider.defaultChatModel || '');
  const baseUrl = String(provider.baseUrl || provider.base_url || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const apiKey = String(provider.apiKey || provider.api_key || '');
  return baseUrl && apiKey && modelId ? { baseUrl, apiKey, modelId, signal } : null;
}

async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DramaPlannerError && error.code === 'DRAMA_PLAN_INVALID' && error.retryable) return run();
    throw error;
  }
}

function plannerError(error: unknown): NextResponse {
  if (error instanceof DramaDocumentError) {
    return NextResponse.json({ error: '剧本项目格式不正确，请刷新后重试', code: error.code }, { status: 400 });
  }
  if (error instanceof DramaPlannerError) {
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
 */
export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || (body.action !== 'script' && body.action !== 'shots')) {
    return NextResponse.json({ error: '请求内容不正确，请刷新后重试' }, { status: 400 });
  }
  const config = await plannerConfig(request.signal);
  if (!config) {
    return NextResponse.json({
      error: '还没有可用的对话模型。请在后台供应商设置里启用一个对话模型后再生成剧本。', code: 'DRAMA_PLANNER_NOT_CONFIGURED',
    }, { status: 503 });
  }
  try {
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
      const prompt = buildDramaScriptPrompt(input);
      const doc = await withRetry(async () => parseDramaScriptResponse(await callDramaLlm(config, [{ role: 'user', content: prompt }]), input));
      return NextResponse.json({ success: true, doc: parseDramaProject(doc) });
    }

    const input = {
      doc: parseDramaProject(body.doc),
      episodeId: typeof body.episodeId === 'string' ? body.episodeId : '',
      sceneId: typeof body.sceneId === 'string' ? body.sceneId : '',
      shotDurationSec: Number(body.shotDurationSec) || undefined,
    };
    const shotCount = Number(body.shotCount) || undefined;
    const messages = buildDramaShotMessages({ ...input, shotCount });
    const shots = await withRetry(async () => parseDramaShotResponse(await callDramaLlm(config, messages), input));
    return NextResponse.json({ success: true, shots });
  } catch (error) {
    return plannerError(error);
  }
}
