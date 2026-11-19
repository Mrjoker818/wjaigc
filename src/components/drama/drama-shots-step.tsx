'use client';

import { ImagePlus, Loader2, Play, RotateCcw, Square, X } from 'lucide-react';
import { activeTake, shotSource } from '@/lib/drama/types';
import { failedShots, pendingShots, selectTake, updateShot } from '@/lib/drama/workbench-state';
import { useDrama } from './drama-context';
import { ShotReadinessBadge } from './drama-readiness';
import { DramaSlate } from './drama-slate';

/** Step 4: the generation grid. Each cell keeps every take; the selected one is what renders. */
export function DramaShotsStep() {
  const {
    doc, episode, update, models, modelsLoading, defaultModel, setDefaultModelKey, generateAudio, setGenerateAudio,
    runningShotIds, batchRunning, generateShots, stopGeneration, estimate, selectedShotId, selectShot, setStep,
    imageModels, imageModel, setImageModelKey, keyframeShotIds, generateKeyframes, keyframeEstimate,
  } = useDrama();
  if (!episode) return <p className="drama-label">先在剧本步骤写好分集。</p>;
  const waiting = pendingShots(episode);
  const failed = failedShots(episode);
  const allShots = episode.scenes.flatMap(scene => scene.shots);
  const withoutKeyframe = allShots.filter(shot => !shot.firstFrameUrl);
  const drawingKeyframes = keyframeShotIds.size > 0;

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
            <>
            {failed.length ? (
              <button type="button" className="drama-btn" disabled={!defaultModel}
                onClick={() => void generateShots(failed.map(shot => shot.id))}>
                <RotateCcw className="h-4 w-4" />重试失败的 {failed.length} 个镜头
              </button>
            ) : null}
            <button type="button" className="drama-btn drama-btn--primary" disabled={waiting.length === 0 || !defaultModel}
              onClick={() => void generateShots(waiting.map(shot => shot.id))}>
              <Play className="h-4 w-4" />{waiting.length ? `按顺序生成 ${waiting.length} 个待拍镜头` : '所有镜头都已有可用视频'}
            </button>
            </>
          )}
        </div>
      </div>
      <div className="drama-panel flex flex-wrap items-end gap-3 p-3" aria-label="关键帧">
        <label className="flex min-w-56 flex-col gap-1">
          <span className="drama-label">关键帧图像模型</span>
          <select className="drama-input" value={imageModel?.key ?? ''} disabled={imageModels.length === 0}
            onChange={event => setImageModelKey(event.target.value)}>
            {imageModels.length === 0 ? <option value="">使用后台默认图像模型</option> : null}
            {imageModels.map(model => <option key={model.key} value={model.key}>{model.name} · {model.providerName}</option>)}
          </select>
        </label>
        <p className="drama-label max-w-md">先用图像模型画出每一镜的第一帧，确认构图后再拍视频。已锁定的角色和场景图会作为参考{imageModel && imageModel.maxReferenceImages === 0 ? '（这个模型不接受参考图，只按文字画）' : ''}。</p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {keyframeEstimate && withoutKeyframe.length ? <span className="font-mono text-xs text-[var(--drama-muted)]">{withoutKeyframe.length} 张约 {keyframeEstimate.total} 积分</span> : null}
          <button type="button" className="drama-btn" disabled={withoutKeyframe.length === 0 || drawingKeyframes}
            onClick={() => void generateKeyframes(withoutKeyframe.map(shot => shot.id))}>
            {drawingKeyframes ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ImagePlus className="h-4 w-4" />}
            {withoutKeyframe.length ? `为 ${withoutKeyframe.length} 个镜头生成关键帧` : '所有镜头都有关键帧'}
          </button>
        </div>
      </div>
      <p className="drama-label">镜头按顺序逐个生成。有关键帧的镜头从关键帧开始；没有时，开启「接上一镜头」的镜头会用上一镜头的最后一帧做首帧。生成中可以继续编辑其他镜头。</p>

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
              const still = shotSource(shot)?.kind === 'still';
              const latest = shot.takes.at(-1);
              const selected = selectedShotId === shot.id;
              const drawing = keyframeShotIds.has(shot.id);
              return (
                <li key={shot.id} className={`drama-panel flex flex-col overflow-hidden ${selected ? 'ring-2 ring-[var(--drama-gold)]' : ''}`}>
                  <button type="button" className="text-left" aria-pressed={selected} aria-label={`选中镜头 ${shotNumber}`} onClick={() => selectShot(shot.id)}>
                    <DramaSlate sceneNumber={sceneIndex + 1} shotNumber={shotNumber} shot={shot} running={running} durationSec={shot.durationSec} />
                  </button>
                  <div className="relative bg-[var(--drama-ink)]" style={{ aspectRatio: doc.aspectRatio.replace(':', ' / ') }}>
                    {take?.videoUrl && !still ? (
                      <video src={take.videoUrl} poster={take.thumbnailUrl ?? shot.firstFrameUrl} controls preload="metadata" className="h-full w-full object-contain" />
                    ) : shot.firstFrameUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={shot.firstFrameUrl} alt={`镜头 ${shotNumber} 关键帧`} className="h-full w-full object-contain" />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-[var(--drama-muted)]">
                        {running ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />正在生成</> : latest?.status === 'failed' ? latest.error || '生成失败' : '还没有生成'}
                      </span>
                    )}
                    {shot.firstFrameUrl && (still || !take?.videoUrl) ? (
                      <span className="absolute left-1.5 top-1.5 rounded bg-[var(--drama-gold)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--drama-ink)]">{still ? '静帧镜头' : '关键帧'}</span>
                    ) : null}
                    {drawing ? (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-xs" role="status">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />正在画关键帧
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2 p-3">
                    <ShotReadinessBadge episodeId={episode.id} shot={shot} />
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
                    <div className="flex gap-2">
                      <button type="button" className="drama-btn flex-1 text-xs" disabled={drawing}
                        onClick={() => void generateKeyframes([shot.id])}>
                        <ImagePlus className="h-3.5 w-3.5" />{shot.firstFrameUrl ? '重画关键帧' : '画关键帧'}
                        {keyframeEstimate?.perShot[shot.id] ? <span className="font-mono opacity-70">{keyframeEstimate.perShot[shot.id]} 积分</span> : null}
                      </button>
                      {shot.firstFrameUrl ? (
                        <button type="button" className="drama-btn px-2" aria-label={`清除镜头 ${shotNumber} 的关键帧`} disabled={drawing}
                          onClick={() => update(current => updateShot(current, shot.id, { firstFrameUrl: undefined, still: undefined }))}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
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
