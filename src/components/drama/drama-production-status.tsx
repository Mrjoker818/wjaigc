'use client';

import { pendingProductionImages } from '@/lib/drama/production-state';
import { useDrama } from './drama-context';

const stages = { bible: '设定图', keyframes: '关键帧', shots: '镜头视频', voiceover: '配音', render: '成片渲染' };
const states = { submitting: '提交回执待核对', generating: '生成中', retrieving: '产物回读或保存中', stored: '已保存，待放回项目', unknown: '原回执待核对', failed: '原任务未成功' };

export function DramaProductionStatus() {
  const { doc, autopilot, stopAutopilot, recoverProduction, recoveringProduction, setStep, setEpisodeId } = useDrama();
  const images = pendingProductionImages(doc);
  const takes = doc.episodes.flatMap(ep => ep.scenes.flatMap(scene => scene.shots.flatMap(shot => shot.takes.filter(take => take.status === 'submitted' || take.status === 'generating'))));
  const checkpoint = doc.productionRun;
  if (!autopilot && !images.length && !takes.length && (!checkpoint || checkpoint.status === 'completed')) return null;
  return (
    <section aria-label="制作恢复状态" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--drama-line)] px-3 py-2 text-xs">
      <p className="min-w-0 flex-1 break-words text-[var(--drama-muted)]">
        {autopilot ? `正在制作 · ${stages[autopilot.stage]}。制作期间暂时锁定编辑，避免已确认的参数变化。` : checkpoint ? `上次制作停在${stages[checkpoint.stage]}，已完成的内容保留。` : '有原生成任务待核对。'}
        {images.length || takes.length ? ` ${images.length} 张图片、${takes.length} 个视频原回执待处理。` : ''}
      </p>
      {autopilot ? <button type="button" className="drama-btn min-h-9" onClick={stopAutopilot}>停止后续制作</button>
        : images.length || takes.length ? <button type="button" className="drama-btn min-h-9" disabled={recoveringProduction} onClick={() => void recoverProduction()}>{recoveringProduction ? '正在核对原回执…' : '恢复原回执（不重新生成）'}</button>
          : <button type="button" className="drama-btn min-h-9" onClick={() => { if (checkpoint) setEpisodeId(checkpoint.episodeId); setStep('final'); }}>去成片，估算剩余制作</button>}
      {images.length ? <details className="basis-full"><summary className="cursor-pointer py-1">查看产物回读状态</summary><ul className="flex max-h-32 flex-col gap-1 overflow-y-auto py-2">{images.map(image => <li key={image.id} className="break-words">{states[image.state]}{image.error ? ` · ${image.error}` : ''}</li>)}</ul></details> : null}
    </section>
  );
}
