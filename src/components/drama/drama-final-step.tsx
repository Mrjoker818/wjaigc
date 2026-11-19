'use client';

import { useState } from 'react';
import { Download, FileArchive, FileSpreadsheet, Film, ImageDown, Loader2, Mic, Subtitles } from 'lucide-react';
import { toast } from 'sonner';
import { episodeSrt, shotListCsv } from '@/lib/drama/export';
import { buildEpisodePackage, downloadBlob, downloadText, exportFileName } from '@/lib/drama/export-client';
import { DRAMA_TRANSITIONS as TRANSITIONS, type DramaTransition } from '@/lib/drama/render';
import { buildTimeline } from '@/lib/drama/timeline';
import { currentVoiceover, shotsNeedingVoiceover } from '@/lib/drama/voiceover';
import { pendingShots } from '@/lib/drama/workbench-state';
import { DramaAutopilot } from './drama-autopilot';
import { useDrama } from './drama-context';
import { EpisodeReadiness } from './drama-readiness';

const TRANSITION_LABEL: Record<DramaTransition, string> = { cut: '硬切', fade: '淡入淡出', flash: '闪白' };

/** Step 5: transition and subtitle choices, then the rendered film. Rendering itself runs in the background and costs no credits. */
export function DramaFinalStep() {
  const { doc, episode, update, render, renderEpisode, onPlaceOnCanvas, voiceoverShotIds, generateVoiceovers } = useDrama();
  if (!episode) return <p className="drama-label">先在剧本步骤写好分集。</p>;
  const missing = pendingShots(episode).length;
  const blocks = buildTimeline(doc, episode.id);
  const totalSec = blocks.at(-1)?.endSec ?? 0;
  const last = doc.timeline.lastRender;
  const ready = last?.status === 'completed' && last.videoUrl && last.episodeId === episode.id;
  const shots = episode.scenes.flatMap(scene => scene.shots);
  const spoken = shots.filter(shot => shot.dialogue?.trim());
  const voiced = spoken.filter(shot => currentVoiceover(shot)).length;
  const unvoiced = shotsNeedingVoiceover(shots);
  const recording = spoken.some(shot => voiceoverShotIds.has(shot.id));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <DramaAutopilot />
      <section className="drama-panel flex flex-col gap-4 p-4" aria-labelledby="drama-render-options">
        <h2 id="drama-render-options" className="text-sm font-semibold">成片设置</h2>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="drama-label mb-1.5">镜头之间的转场</legend>
          <div className="flex gap-2">
            {TRANSITIONS.map(value => (
              <button key={value} type="button" className="drama-btn" aria-pressed={doc.timeline.transition === value}
                onClick={() => update(current => ({ ...current, timeline: { ...current.timeline, transition: value } }))}>{TRANSITION_LABEL[value]}</button>
            ))}
          </div>
        </fieldset>
        {doc.timeline.transition !== 'cut' ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="drama-label">转场时长</span>
            <input className="drama-input w-20 font-mono" type="number" min={0.2} max={2} step={0.1} value={doc.timeline.transitionSec}
              onChange={event => update(current => ({ ...current, timeline: { ...current.timeline, transitionSec: Math.max(0.2, Math.min(2, Number(event.target.value) || 0.5)) } }))} />
            <span className="drama-label">秒</span>
          </label>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={doc.timeline.subtitles}
            onChange={event => update(current => ({ ...current, timeline: { ...current.timeline, subtitles: event.target.checked } }))} />
          把台词烧成字幕
        </label>
        {spoken.length ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="drama-btn" disabled={recording || unvoiced.length === 0}
              onClick={() => void generateVoiceovers(unvoiced.map(shot => shot.id))}>
              {recording ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Mic className="h-4 w-4" />}
              {recording ? '正在生成配音' : unvoiced.length ? `为 ${unvoiced.length} 句台词生成配音` : '台词都已配音'}
            </button>
            <span className="drama-label font-mono">已配音 {voiced}/{spoken.length} · 不扣积分，渲染时混进成片</span>
          </div>
        ) : null}
        {doc.timeline.subtitles ? (
          <div className="drama-paper flex min-h-16 items-end justify-center rounded-md px-6 pb-3 text-center font-serif text-sm leading-snug">
            {blocks.find(block => block.subtitle)?.subtitle ?? '（镜头里还没有台词）'}
          </div>
        ) : null}
        <EpisodeReadiness episode={episode} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="drama-btn drama-btn--primary" disabled={missing > 0 || render.status === 'rendering'} onClick={() => void renderEpisode()}>
            {render.status === 'rendering' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Film className="h-4 w-4" />}
            {render.status === 'rendering' ? `正在渲染 ${render.progress}%` : ready ? '重新渲染成片' : '渲染成片'}
          </button>
          <span className="drama-label font-mono">约 {Math.round(totalSec)} 秒 · 渲染不扣积分，只在本机拼接</span>
        </div>
        {missing ? <p className="text-sm text-[var(--drama-red)]">还有 {missing} 个镜头没有可用的视频，先在镜头步骤里生成。</p> : null}
        {render.status === 'failed' ? <p role="alert" className="text-sm text-[var(--drama-red)]">{render.error ?? '成片渲染失败'}</p> : null}
      </section>

      {ready && last.videoUrl ? (
        <section className="drama-panel flex flex-col gap-3 p-4" aria-labelledby="drama-film">
          <h2 id="drama-film" className="text-sm font-semibold">成片</h2>
          <video src={last.videoUrl} poster={last.thumbnailUrl} controls className="w-full rounded-md bg-[var(--drama-ink)]" style={{ aspectRatio: doc.aspectRatio.replace(':', ' / ') }} />
          <div className="flex flex-wrap gap-2">
            <a className="drama-btn" href={last.videoUrl} download><Download className="h-4 w-4" />下载成片</a>
            {onPlaceOnCanvas ? (
              <button type="button" className="drama-btn" onClick={() => onPlaceOnCanvas({
                videoUrl: last.videoUrl!, ...(last.thumbnailUrl ? { thumbnailUrl: last.thumbnailUrl } : {}),
                ...(last.durationSec ? { duration: last.durationSec } : {}), aspectRatio: doc.aspectRatio,
              })}><ImageDown className="h-4 w-4" />放回画布</button>
            ) : null}
          </div>
        </section>
      ) : null}

      <ExportPanel />
    </div>
  );
}

/** Subtitles, shot list and a ZIP of everything made for this episode, for editing outside the workbench. */
function ExportPanel() {
  const { doc, episode } = useDrama();
  const [packing, setPacking] = useState<{ done: number; total: number } | null>(null);
  if (!episode) return null;
  const srt = episodeSrt(doc, episode.id);

  const pack = async () => {
    setPacking({ done: 0, total: 0 });
    try {
      const result = await buildEpisodePackage(doc, episode.id, { onProgress: (done, total) => setPacking({ done, total }) });
      downloadBlob(result.blob, result.fileName);
      if (result.missing.length) toast.error(`制作包已下载，${result.missing.length} 个文件没下载成功`, { description: '压缩包里的「缺失文件.txt」列出了它们。' });
      else toast.success('制作包已下载');
    } catch (error) {
      toast.error('制作包打包失败', { description: error instanceof Error && error.message ? error.message : '请稍后重试' });
    } finally {
      setPacking(null);
    }
  };

  return (
    <section className="drama-panel flex flex-col gap-3 p-4" aria-labelledby="drama-export">
      <h2 id="drama-export" className="text-sm font-semibold">导出</h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="drama-btn" disabled={!srt}
          onClick={() => downloadText(srt, exportFileName(doc, episode.id, '字幕.srt'), 'application/x-subrip;charset=utf-8')}>
          <Subtitles className="h-4 w-4" />字幕 SRT
        </button>
        <button type="button" className="drama-btn"
          onClick={() => downloadText(shotListCsv(doc, episode.id), exportFileName(doc, episode.id, '镜头表.csv'), 'text/csv;charset=utf-8')}>
          <FileSpreadsheet className="h-4 w-4" />镜头表 CSV
        </button>
        <button type="button" className="drama-btn" disabled={packing !== null} onClick={() => void pack()}>
          {packing ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <FileArchive className="h-4 w-4" />}
          {packing ? `正在打包 ${packing.done}/${packing.total || '…'}` : '制作包 ZIP'}
        </button>
      </div>
      <p className="drama-label">
        {srt ? '字幕按计划时长排时间，渲染后的成片可能差零点几秒。' : '镜头里还没有台词，暂时没有字幕可导出。'}
        制作包含剧本、镜头表、字幕、成片、每镜视频和关键帧、配音、定妆图。
      </p>
    </section>
  );
}
