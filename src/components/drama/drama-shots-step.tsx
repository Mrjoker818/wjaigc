'use client';

import { Loader2, Play, RotateCcw, Square } from 'lucide-react';
import { activeTake } from '@/lib/drama/types';
import { pendingShots, selectTake } from '@/lib/drama/workbench-state';
import { useDrama } from './drama-context';
import { DramaSlate } from './drama-slate';

/** Step 4: the generation grid. Each cell keeps every take; the selected one is what renders. */
export function DramaShotsStep() {
  const {
    doc, episode, update, models, modelsLoading, defaultModel, setDefaultModelKey, generateAudio, setGenerateAudio,
    runningShotIds, batchRunning, generateShots, stopGeneration, estimate, selectedShotId, selectShot, setStep,
  } = useDrama();
  if (!episode) return <p className="drama-label">先在剧本步骤写好分集。</p>;
  const waiting = pendingShots(episode);
  const allShots = episode.scenes.flatMap(scene => scene.shots);

  // Shot numbers run across the whole episode; each scene starts after the shots before it.
  const sceneStarts = episode.scenes.map((_, i) => episode.scenes.slice(0, i).reduce((n, item) => n + item.shots.length, 0));
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="drama-panel flex flex-wrap items-end gap-3 p-3">
        <label className="flex min-w-56 flex-col gap-1">
          <span className="drama-label">默认视频模型</span>
          <select className="drama-input" value={defaultModel?.key ?? ''} disabled={modelsLoading || models.length === 0}
            onChange={event => setDefaultModelKey(event.target.value)}>
            {models.length === 0 ? <option value="">{modelsLoading ? '正在读取模型' : '没有可用的视频模型'}</option> : null}
            {models.map(model => <option key={model.key} value={model.key}>{model.name} · {model.providerName}</option>)}
          </select>
        </label>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={generateAudio} onChange={event => setGenerateAudio(event.target.checked)} />
          所有镜头生成音频
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {estimate && waiting.length ? <span className="font-mono text-xs text-[var(--drama-muted)]">{waiting.length} 个待拍镜头约 {estimate.total} 积分</span> : null}
          {batchRunning ? (
            <button type="button" className="drama-btn" onClick={stopGeneration}><Square className="h-4 w-4" />停止</button>
          ) : (
            <button type="button" className="drama-btn drama-btn--primary" disabled={waiting.length === 0 || !defaultModel}
              onClick={() => void generateShots(waiting.map(shot => shot.id))}>
              <Play className="h-4 w-4" />{waiting.length ? `按顺序生成 ${waiting.length} 个待拍镜头` : '所有镜头都已有可用视频'}
            </button>
          )}
        </div>
      </div>
      <p className="drama-label">镜头按顺序逐个生成，开启「接上一镜头」的镜头会用上一镜头的最后一帧做首帧。生成中可以继续编辑其他镜头。</p>

      {allShots.length === 0 ? (
        <p className="drama-label">还没有镜头。<button type="button" className="underline" onClick={() => setStep('board')}>去分镜步骤拆解</button></p>
      ) : null}

      {episode.scenes.map((scene, sceneIndex) => scene.shots.length === 0 ? null : (
        <section key={scene.id} aria-labelledby={`shots-${scene.id}`} className="flex flex-col gap-3">
          <h3 id={`shots-${scene.id}`} className="font-serif text-base font-bold">
            <span className="mr-2 font-mono text-sm text-[var(--drama-gold)]">场 {String(sceneIndex + 1).padStart(2, '0')}</span>{scene.heading}
          </h3>
          <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {scene.shots.map((shot, shotIndex) => {
              const shotNumber = sceneStarts[sceneIndex] + shotIndex + 1;
              const running = runningShotIds.has(shot.id);
              const take = activeTake(shot);
              const latest = shot.takes.at(-1);
              const selected = selectedShotId === shot.id;
              return (
                <li key={shot.id} className={`drama-panel flex flex-col overflow-hidden ${selected ? 'ring-2 ring-[var(--drama-gold)]' : ''}`}>
                  <button type="button" className="text-left" aria-pressed={selected} aria-label={`选中镜头 ${shotNumber}`} onClick={() => selectShot(shot.id)}>
                    <DramaSlate sceneNumber={sceneIndex + 1} shotNumber={shotNumber} shot={shot} running={running} durationSec={shot.durationSec} />
                  </button>
                  <div className="relative bg-[var(--drama-ink)]" style={{ aspectRatio: doc.aspectRatio.replace(':', ' / ') }}>
                    {take?.videoUrl ? (
                      <video src={take.videoUrl} poster={take.thumbnailUrl} controls preload="metadata" className="h-full w-full object-contain" />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-[var(--drama-muted)]">
                        {running ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />正在生成</> : latest?.status === 'failed' ? latest.error || '生成失败' : '还没有生成'}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 p-3">
                    <p className="line-clamp-2 text-sm">{shot.prompt || <span className="text-[var(--drama-muted)]">没有画面描述</span>}</p>
                    {shot.takes.length > 1 ? (
                      <div className="flex flex-wrap gap-1" role="group" aria-label="选用哪一次生成">
                        {shot.takes.map((item, i) => (
                          <button key={item.id} type="button" className="drama-btn min-h-8 px-2 font-mono text-xs"
                            aria-pressed={take?.id === item.id} disabled={item.status !== 'completed' || !item.videoUrl}
                            title={item.status === 'failed' ? item.error : undefined}
                            onClick={() => update(current => selectTake(current, shot.id, item.id))}>
                            次 {i + 1}{item.status === 'failed' ? ' ✕' : ''}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="flex gap-2">
                      <button type="button" className="drama-btn flex-1" disabled={running || batchRunning || !defaultModel}
                        onClick={() => void generateShots([shot.id])}>
                        {shot.takes.length ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        {shot.takes.length ? '重拍' : '生成'}
                        {estimate?.perShot[shot.id] ? <span className="font-mono text-xs opacity-70">{estimate.perShot[shot.id]} 积分</span> : null}
                      </button>
                      <button type="button" className="drama-btn" onClick={() => selectShot(shot.id)}>调整</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
