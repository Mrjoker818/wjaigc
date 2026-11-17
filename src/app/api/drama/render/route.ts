/** Background episode render: stitches the selected take of every shot, keeps audio, adds transitions and subtitles. Free of credits. */
import { after, NextRequest, NextResponse } from 'next/server';
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { isSafeVideoSource } from '@/lib/api-validator';
import { getServerDataRoot } from '@/lib/server-data-root';
import { buildRenderPlan, buildSrt, effectiveTransitionSec, timelineStarts, type DramaTransition } from '@/lib/drama/render';
import { getDramaProject } from '@/lib/drama/store';
import { collectEpisodeTimeline, dialogueCues } from '@/lib/drama/timeline';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { downloadToBuffer, probeRenderClip } from '@/lib/video-media-io';

const execFileAsync = promisify(execFile);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIDEO_URL_PREFIX = '/api/serve-upload/generated-videos';
const RENDER_TIMEOUT_MS = 20 * 60_000;
const SUBTITLE_FONT = { file: 'src/lib/pdf/fonts/WujiePdfSansSC-Regular.ttf', family: 'Wujie PDF Sans SC' };

/** One render per user at a time keeps a single account from saturating the server's ffmpeg. */
const activeRenders = new Map<string, string>();

function allowedSource(url: string): boolean {
  return isSafeVideoSource(url) && (url.startsWith('/') || url.startsWith('https://'));
}

async function fileExists(file: string): Promise<boolean> {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

interface RenderJob {
  taskId: string;
  userId: string;
  clips: Array<{ videoUrl: string; dialogue?: string }>;
  transition: DramaTransition;
  transitionSec: number;
  subtitles: boolean;
}

async function renderEpisode(job: RenderJob): Promise<void> {
  const videoDir = path.join(getServerDataRoot(), 'generated-videos');
  const workDir = await mkdtemp(path.join(tmpdir(), 'wujie-drama-'));
  const outputName = `drama_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`;
  const outputPath = path.join(videoDir, outputName);
  const thumbnailName = outputName.replace(/\.mp4$/i, '.jpg');
  try {
    await mkdir(videoDir, { recursive: true });
    const probed = [];
    for (let i = 0; i < job.clips.length; i += 1) {
      const name = `clip-${i}.mp4`;
      await writeFile(path.join(workDir, name), await downloadToBuffer(job.clips[i].videoUrl));
      const clip = await probeRenderClip(path.join(workDir, name));
      probed.push({ ...clip, path: name });
      updateTaskProgress(job.taskId, {
        progress: Math.round(5 + (i + 1) / job.clips.length * 45),
        label: `成片渲染 · 读取镜头 ${i + 1}/${job.clips.length}`,
      });
    }
    const renderClips = probed.map(({ path: clipPath, durationSec, hasAudio }) => ({ path: clipPath, durationSec, hasAudio }));
    const transitionSec = effectiveTransitionSec(renderClips, job.transition, job.transitionSec);
    const cues = job.subtitles
      ? dialogueCues(job.clips, timelineStarts(renderClips, transitionSec), renderClips.map(clip => clip.durationSec), transitionSec)
      : [];
    let subtitleFont: { dir: string; family: string } | undefined;
    if (cues.length) {
      await writeFile(path.join(workDir, 'subs.srt'), buildSrt(cues), 'utf8');
      const fontSource = path.join(process.cwd(), SUBTITLE_FONT.file);
      if (await fileExists(fontSource)) {
        await mkdir(path.join(workDir, 'fonts'));
        await copyFile(fontSource, path.join(workDir, 'fonts', 'subtitle.ttf'));
        subtitleFont = { dir: 'fonts', family: SUBTITLE_FONT.family };
      }
    }
    const plan = buildRenderPlan({
      clips: renderClips, width: probed[0].width, height: probed[0].height,
      transition: job.transition, transitionSec, outputPath,
      ...(cues.length ? { subtitleFile: 'subs.srt', ...(subtitleFont ? { subtitleFont } : {}) } : {}),
    });
    updateTaskProgress(job.taskId, { progress: 55, label: '成片渲染 · 合成中' });
    await execFileAsync('ffmpeg', plan.args, { cwd: workDir, timeout: RENDER_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
    await execFileAsync('ffmpeg', ['-ss', '0.2', '-i', outputPath, '-frames:v', '1', '-q:v', '2', '-y', path.join(videoDir, thumbnailName)],
      { timeout: 60_000, maxBuffer: 1024 * 1024 }).catch(() => undefined);
    updateTaskProgress(job.taskId, {
      status: 'completed', progress: 100, label: '成片渲染完成',
      result: {
        videoUrl: `${VIDEO_URL_PREFIX}/${outputName}`,
        videoThumbnailUrl: `${VIDEO_URL_PREFIX}/${thumbnailName}`,
        durationSec: plan.durationSec,
      },
    });
  } catch (error) {
    console.error({ code: 'DRAMA_RENDER_FAILED', taskId: job.taskId, error });
    const known = error instanceof Error && /[\u4e00-\u9fff]/u.test(error.message) ? error.message : '';
    updateTaskProgress(job.taskId, {
      status: 'failed', progress: 0,
      error: known || '成片渲染失败。请确认所有镜头视频都能正常播放后重试。',
    });
    await rm(outputPath, { force: true }).catch(() => undefined);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    if (activeRenders.get(job.userId) === job.taskId) activeRenders.delete(job.userId);
  }
}

/** POST /api/drama/render { dramaId, episodeId } → { taskId }; poll progress with /api/poll-task. */
export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const dramaId = typeof body?.dramaId === 'string' ? body.dramaId : '';
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId : '';
  if (!dramaId || !episodeId) return NextResponse.json({ error: '缺少剧本或分集参数' }, { status: 400 });

  let record;
  try {
    record = await getDramaProject(auth.userId, dramaId);
  } catch (error) {
    console.error({ code: 'DRAMA_RENDER_READ_FAILED', error });
    return NextResponse.json({ error: '剧本项目读取失败，请稍后重试' }, { status: 500 });
  }
  if (!record) return NextResponse.json({ error: '剧本项目不存在或已被删除' }, { status: 404 });
  const { doc } = record;
  if (!doc.episodes.some(episode => episode.id === episodeId)) {
    return NextResponse.json({ error: '这一集不存在，请刷新后重试' }, { status: 404 });
  }
  const timeline = collectEpisodeTimeline(doc, episodeId);
  if (timeline.missingShotIds.length) {
    return NextResponse.json({
      error: `还有 ${timeline.missingShotIds.length} 个镜头没有可用的视频。请先生成或选定这些镜头，再渲染成片。`,
      code: 'DRAMA_RENDER_SHOTS_MISSING', missingShotIds: timeline.missingShotIds,
    }, { status: 409 });
  }
  if (timeline.clips.length === 0) return NextResponse.json({ error: '这一集还没有镜头' }, { status: 409 });
  if (timeline.clips.some(clip => !allowedSource(clip.videoUrl))) {
    return NextResponse.json({ error: '镜头视频地址无效，请重新生成对应镜头' }, { status: 400 });
  }
  const running = activeRenders.get(auth.userId);
  if (running) {
    return NextResponse.json({ error: '已有一个成片在渲染，请等它完成后再开始新的渲染', taskId: running }, { status: 409 });
  }

  const taskId = `drama_render_${randomUUID()}`;
  activeRenders.set(auth.userId, taskId);
  registerTask(taskId, 'drama-render', '成片渲染 · 排队中', auth.userId);
  updateTaskProgress(taskId, { status: 'processing', progress: 2, creditCost: 0 });
  after(() => renderEpisode({
    taskId, userId: auth.userId, clips: timeline.clips,
    transition: doc.timeline.transition, transitionSec: doc.timeline.transitionSec, subtitles: doc.timeline.subtitles,
  }));
  return NextResponse.json({ success: true, taskId, creditCost: 0 }, { status: 202 });
}
