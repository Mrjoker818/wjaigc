'use client';

import { useRef, useState } from 'react';
import { Download, FileArchive, FileSpreadsheet, Film, ImageDown, Loader2, Mic, Music, Subtitles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { episodeSrt, shotListCsv } from '@/lib/drama/export';
import { buildEpisodePackage, buildProjectPackage, downloadBlob, downloadText, exportFileName } from '@/lib/drama/export-client';
import type { PackageMediaMode } from '@/lib/drama/package';
import { isFilmCurrent, isVoiceoverCurrent } from '@/lib/drama/production-version';
import { DRAMA_TRANSITIONS as TRANSITIONS, type DramaTransition } from '@/lib/drama/render';
import { buildTimeline } from '@/lib/drama/timeline';
import type { DramaMusic } from '@/lib/drama/types';
import { uploadDramaMusic } from '@/lib/drama/workbench-client';
import { pendingShots } from '@/lib/drama/workbench-state';
import { DramaAutopilot } from './drama-autopilot';
import { VOICE_MODEL_MISSING } from './drama-models';
import { useDrama } from './drama-context';
import { EpisodeReadiness } from './drama-readiness';

const TRANSITION_LABEL: Record<DramaTransition, string> = { cut: '硬切', fade: '淡入淡出', flash: '闪白' };

/** Step 5: transition and subtitle choices, then the rendered film. Rendering itself runs in the background and costs no credits. */
export function DramaFinalStep() {
  const { doc, episode, update, render, renderEpisode, onPlaceOnCanvas, voiceoverShotIds, generateVoiceovers, voiceAvailable } = useDrama();
  if (!episode) return <p className="drama-label">先在剧本步骤写好分集。</p>;
  const missing = pendingShots(episode, doc).length;
  const blocks = buildTimeline(doc, episode.id);
  const totalSec = blocks.at(-1)?.endSec ?? 0;
  const last = doc.timeline.lastRender;
  const hasFilm = last?.status === 'completed' && last.videoUrl && (last.episodeId === undefined || last.episodeId === episode.id);
  const ready = isFilmCurrent(doc, episode.id);
  const shots = episode.scenes.flatMap(scene => scene.shots);
  const spoken = shots.filter(shot => shot.dialogue?.trim());
  const voiced = spoken.filter(shot => isVoiceoverCurrent(doc, shot)).length;
  const unvoiced = spoken.filter(shot => !isVoiceoverCurrent(doc, shot));
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
            <button type="button" className="drama-btn" disabled={recording || unvoiced.length === 0 || !voiceAvailable}
              onClick={() => void generateVoiceovers(unvoiced.map(shot => shot.id))}>
              {recording ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Mic className="h-4 w-4" />}
              {recording ? '正在生成配音' : unvoiced.length ? `为 ${unvoiced.length} 句台词生成配音` : '台词都已配音'}
            </button>
            {voiceAvailable
              ? <span className="drama-label font-mono">已配音 {voiced}/{spoken.length} · 不扣积分，渲染时混进成片</span>
              : <span className="text-xs text-[var(--drama-red)]">{VOICE_MODEL_MISSING}</span>}
          </div>
        ) : null}
        <MusicSettings />
        {doc.timeline.subtitles ? (
          <div className="drama-paper flex min-h-16 items-end justify-center rounded-md px-6 pb-3 text-center font-serif text-sm leading-snug">
            {blocks.find(block => block.subtitle)?.subtitle ?? '（镜头里还没有台词）'}
          </div>
        ) : null}
        <EpisodeReadiness episode={episode} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="drama-btn drama-btn--primary" disabled={missing > 0 || render.status === 'rendering'} onClick={() => void renderEpisode()}>
            {render.status === 'rendering' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Film className="h-4 w-4" />}
            {render.status === 'rendering' ? `正在渲染 ${render.progress}%` : hasFilm ? '重新渲染成片' : '渲染成片'}
          </button>
          <span className="drama-label font-mono">约 {Math.round(totalSec)} 秒 · 渲染不扣积分，只在本机拼接</span>
        </div>
        {missing ? <div className="text-sm text-[var(--drama-red)]"><p>还有 {missing} 个镜头没有可用的视频，先在镜头步骤里生成。</p><p className="mt-1 text-xs">参数或剧本发生变化的旧视频也需要更新，历史素材仍保留。</p></div> : null}
        {render.status === 'failed' ? <p role="alert" className="text-sm text-[var(--drama-red)]">{render.error ?? '成片渲染失败'}</p> : null}
      </section>

      {hasFilm && last?.videoUrl ? (
        <section className="drama-panel flex flex-col gap-3 p-4" aria-labelledby="drama-film">
          <h2 id="drama-film" className="text-sm font-semibold">{ready ? '成片' : '旧版成片'}</h2>
          {!ready ? <p role="status" className="text-sm text-[var(--drama-red)]">旧版成片，参数已修改，请重渲染</p> : null}
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

const DEFAULT_MUSIC_VOLUME = 0.3;

/** Background music under the whole episode: upload, level and ducking. Mixed at render time, free of credits. */
function MusicSettings() {
  const { doc, update } = useDrama();
  const picker = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const music = doc.timeline.music;
  const setMusic = (next: DramaMusic | undefined) => update(current => {
    const timeline = { ...current.timeline, music: next };
    if (!next) delete timeline.music;
    return { ...current, timeline };
  });
  const pick = async (file: File) => {
    setUploading(true);
    try {
      const stored = await uploadDramaMusic(file);
      setMusic({ url: stored.url, name: stored.name, volume: music?.volume ?? DEFAULT_MUSIC_VOLUME, ducking: music?.ducking ?? true });
      toast.success('背景音乐已添加', { description: '渲染时会循环铺满整集，开头结尾淡入淡出。' });
    } catch (error) {
      toast.error('音乐上传失败', { description: error instanceof Error && error.message ? error.message : '请稍后重试' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="drama-label mb-1.5">背景音乐</legend>
      <input ref={picker} type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,.mp3,.wav" className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void pick(file); }} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="drama-btn" disabled={uploading} onClick={() => picker.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Music className="h-4 w-4" />}
          {uploading ? '正在上传音乐' : music ? '换一首' : '上传背景音乐'}
        </button>
        {music ? (
          <>
            <span className="min-w-0 max-w-56 truncate text-sm" title={music.name}>{music.name}</span>
            <button type="button" className="drama-btn drama-btn--quiet" aria-label="去掉背景音乐" onClick={() => setMusic(undefined)}><Trash2 className="h-4 w-4" /></button>
          </>
        ) : <span className="drama-label">MP3 或 WAV，最大 25MB，不扣积分</span>}
      </div>
      {music ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <audio src={music.url} controls preload="none" className="h-8 max-w-full" />
          <label className="flex items-center gap-2 text-sm">
            <span className="drama-label">音量</span>
            <input type="range" min={0} max={100} step={5} value={Math.round(music.volume * 100)} aria-label="背景音乐音量"
              onChange={event => setMusic({ ...music, volume: Number(event.target.value) / 100 })} />
            <span className="w-10 font-mono text-xs text-[var(--drama-muted)]">{Math.round(music.volume * 100)}%</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={music.ducking} onChange={event => setMusic({ ...music, ducking: event.target.checked })} />
            有台词和原声时自动压低音乐
          </label>
        </div>
      ) : null}
    </fieldset>
  );
}

/** Subtitles, shot list and a ZIP of everything made for this episode, for editing outside the workbench. */
export function ExportPanel() {
  const { doc, episode } = useDrama();
  const [packing, setPacking] = useState<{ done: number; total: number } | null>(null);
  const [scope, setScope] = useState<'episode' | 'project'>('episode');
  const [mode, setMode] = useState<PackageMediaMode>('selected');
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  if (!episode) return null;
  const srt = episodeSrt(doc, episode.id);

  const pack = async () => {
    setPacking({ done: 0, total: 0 });
    setNotice(null);
    try {
      const onProgress = (done: number, total: number) => setPacking({ done, total });
      const result = scope === 'project'
        ? await buildProjectPackage(doc, { mediaMode: mode, onProgress })
        : await buildEpisodePackage(doc, episode.id, { onProgress });
      downloadBlob(result.blob, result.fileName);
      if (result.missing.length) {
        const text = `制作包不完整，${result.missing.length} 个文件缺失。已下载的包内有缺失清单，请补齐后重新导出。`;
        setNotice({ error: true, text });
        toast.error('制作包不完整', { description: text });
      } else {
        setNotice({ error: false, text: '制作包已下载。' });
        toast.success('制作包已下载');
      }
    } catch (error) {
      const text = error instanceof Error && error.message ? error.message : '请稍后重试';
      setNotice({ error: true, text });
      toast.error('制作包打包失败', { description: text });
    } finally {
      setPacking(null);
    }
  };

  return (
    <section className="drama-panel flex flex-col gap-3 p-4" aria-labelledby="drama-export">
      <h2 id="drama-export" className="text-sm font-semibold">导出</h2>
      <div className="flex flex-wrap gap-x-4 gap-y-3">
        <label className="flex min-w-0 flex-col gap-1.5 text-sm">
          制作包范围
          <select className="drama-input min-h-10 max-w-full" value={scope} disabled={packing !== null}
            onChange={event => { setScope(event.target.value as 'episode' | 'project'); setNotice(null); }} aria-describedby="drama-package-help">
            <option value="episode">当前集（兼容原制作包）</option>
            <option value="project">整项目（全部 {doc.episodes.length} 集）</option>
          </select>
        </label>
        {scope === 'project' ? (
          <label className="flex min-w-0 flex-col gap-1.5 text-sm">
            素材模式
            <select className="drama-input min-h-10 max-w-full" value={mode} disabled={packing !== null}
              onChange={event => setMode(event.target.value as PackageMediaMode)} aria-describedby="drama-package-help">
              <option value="selected">选用素材</option>
              <option value="history">含历史素材</option>
            </select>
          </label>
        ) : null}
      </div>
      <p id="drama-package-help" className="drama-label">
        {scope === 'project'
          ? mode === 'history'
            ? '保存全部分集、原始剧本、设定与镜头历史、参考素材和来源清单。'
            : '保存全部分集与原始剧本、当前设定和选用镜头，移除未选镜次与旧设定图历史。'
          : '保存当前集，沿用原制作包格式。字幕与镜头表单独导出时仍为当前集。'}
        {scope === 'project' ? ' 不携带运行中的任务。缺失素材会明确列出；不完整的整项目包需补齐后才能恢复。浏览器打包上限 256MB。' : ''}
      </p>
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
      {packing ? <p role="status" className="drama-label">正在打包 {packing.done}/{packing.total || '…'} 个素材，请保持页面打开。</p> : null}
      {notice ? <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'text-sm text-[var(--drama-red)]' : 'drama-label'}>{notice.text}</p> : null}
      <p className="drama-label">
        {srt ? '字幕按计划时长排时间，渲染后的成片可能差零点几秒。' : '镜头里还没有台词，暂时没有字幕可导出。'}
        制作包含剧本、镜头表、字幕、成片、每镜视频和关键帧、配音、定妆图。
      </p>
    </section>
  );
}
