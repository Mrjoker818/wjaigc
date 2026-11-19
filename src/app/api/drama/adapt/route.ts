/** Background adaptation of a novel or long text into a multi-episode drama: one planner call per part. Free of credits. */
import { after, NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { videoForbidden } from '@/lib/drama/access';
import { authorizeGenerationProject, GenerationProjectAccessError } from '@/lib/collaboration/generation-project-access';
import {
  ADAPT_MAX_CHARS, ADAPT_MIN_CHARS, buildAdaptChunkPrompt, mergeAdaptedChunk, splitSourceText, type AdaptSettings,
} from '@/lib/drama/adapt';
import { dramaPlannerConfig, withPlanRetry } from '@/lib/drama/draft';
import { callDramaLlm, parseDramaScriptResponse, type DramaLlmConfig } from '@/lib/drama/planner';
import { parseDramaProject } from '@/lib/drama/schema';
import { createDramaProject } from '@/lib/drama/store';
import type { DramaProjectV1 } from '@/lib/drama/types';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { normalizeDirectorStyle } from '@/lib/video-director/director-styles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ASPECT_RATIOS = new Set(['9:16', '16:9', '1:1', '4:3', '3:4', '21:9']);

/** One adaptation per user at a time; each runs several planner calls in a row. */
const activeAdaptations = new Map<string, string>();

interface AdaptJob {
  taskId: string;
  userId: string;
  projectId: string | null;
  chunks: string[];
  settings: AdaptSettings;
  config: DramaLlmConfig;
}

async function adapt(job: AdaptJob): Promise<void> {
  const total = job.chunks.length;
  let doc: DramaProjectV1 | null = null;
  let failure: unknown;
  try {
    for (let i = 0; i < total; i += 1) {
      updateTaskProgress(job.taskId, { progress: Math.round(3 + i / total * 90), label: `改编小说 · 第 ${i + 1}/${total} 段` });
      const prompt = buildAdaptChunkPrompt({
        ...job.settings, chunk: job.chunks[i], index: i, total,
        known: doc ?? { cast: [], locations: [], props: [] }, previous: doc?.episodes.at(-1)?.logline,
      });
      const input = { idea: job.chunks[i], ...job.settings, episodeCount: 1 };
      // Distinct timestamps keep episode and scene ids unique across parts.
      const now = Date.now() + i;
      try {
        const part = await withPlanRetry(async () => parseDramaScriptResponse(
          await callDramaLlm(job.config, [{ role: 'user', content: prompt }]), input, now,
        ));
        doc = mergeAdaptedChunk(doc, part);
      } catch (error) {
        // Keep the parts already adapted; the user can continue the rest by hand.
        failure = error;
        break;
      }
    }
    if (!doc) throw failure ?? new Error('DRAMA_ADAPT_EMPTY');
    if (job.settings.title) doc = { ...doc, title: job.settings.title };
    const record = await createDramaProject(job.userId, job.projectId, parseDramaProject(doc));
    const adaptedParts = doc.episodes.length;
    if (failure) console.error({ code: 'DRAMA_ADAPT_PARTIAL', taskId: job.taskId, adaptedParts, total, error: failure });
    updateTaskProgress(job.taskId, {
      status: 'completed', progress: 100, label: '改编完成',
      result: { dramaId: record.id, adaptedParts: failure ? adaptedParts : total, totalParts: total },
    });
  } catch (error) {
    console.error({ code: 'DRAMA_ADAPT_FAILED', taskId: job.taskId, error });
    updateTaskProgress(job.taskId, {
      status: 'failed', progress: 0,
      error: '小说改编失败：剧本助手没能写出第一集。请稍后重试，或把原文拆短一些再试。',
    });
  } finally {
    if (activeAdaptations.get(job.userId) === job.taskId) activeAdaptations.delete(job.userId);
  }
}

/**
 * POST /api/drama/adapt { text, title?, style?, aspectRatio?, episodeDurationSec?, projectId? } → 202 { taskId, parts }
 * Poll /api/poll-task; the completed result is { dramaId, adaptedParts, totalParts }.
 */
export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const denied = videoForbidden(auth.user);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (text.length < ADAPT_MIN_CHARS) return NextResponse.json({ error: `原文至少 ${ADAPT_MIN_CHARS} 字。短的创意请用「一句话开始」` }, { status: 400 });
  if (text.length > ADAPT_MAX_CHARS) {
    return NextResponse.json({ error: `原文最多 ${ADAPT_MAX_CHARS.toLocaleString('zh-CN')} 字，请分成几部分别改编` }, { status: 400 });
  }

  let projectId: string | null = null;
  try {
    if (body?.projectId) {
      const access = await authorizeGenerationProject({ actorUserId: auth.userId, projectId: body.projectId });
      projectId = access.kind === 'unscoped' ? null : access.projectId;
    }
  } catch (error) {
    if (error instanceof GenerationProjectAccessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
  // No request signal: the calls run after the response has been sent.
  const config = await dramaPlannerConfig();
  if (!config) {
    return NextResponse.json({
      error: '还没有可用的对话模型。请在后台供应商设置里启用一个对话模型后再改编。', code: 'DRAMA_PLANNER_NOT_CONFIGURED',
    }, { status: 503 });
  }
  const running = activeAdaptations.get(auth.userId);
  if (running) return NextResponse.json({ error: '已有一部小说在改编，请等它完成后再开始新的改编', taskId: running }, { status: 409 });

  const chunks = splitSourceText(text);
  const settings: AdaptSettings = {
    ...(typeof body?.title === 'string' && body.title.trim() ? { title: body.title.trim().slice(0, 200) } : {}),
    style: normalizeDirectorStyle(body?.style),
    aspectRatio: typeof body?.aspectRatio === 'string' && ASPECT_RATIOS.has(body.aspectRatio) ? body.aspectRatio : '9:16',
    episodeDurationSec: Number(body?.episodeDurationSec) || 60,
  };
  const taskId = `drama_adapt_${randomUUID()}`;
  activeAdaptations.set(auth.userId, taskId);
  registerTask(taskId, 'drama-adapt', `改编小说 · 共 ${chunks.length} 段`, auth.userId);
  updateTaskProgress(taskId, { status: 'processing', progress: 2, creditCost: 0 });
  after(() => adapt({ taskId, userId: auth.userId, projectId, chunks, settings, config }));
  return NextResponse.json({ success: true, taskId, parts: chunks.length, creditCost: 0 }, { status: 202 });
}
