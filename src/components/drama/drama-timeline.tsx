'use client';

import { buildTimeline } from '@/lib/drama/timeline';
import { formatTimecode } from '@/lib/drama/workbench-state';
import { useDrama } from './drama-context';

const PX_PER_SEC = 14;
const MIN_BLOCK_PX = 44;

/** Bottom strip: one block per shot, width proportional to its length, with the subtitle track underneath. */
export function DramaTimeline() {
  const { doc, episode, selectedShotId, selectShot, runningShotIds } = useDrama();
  if (!episode) return null;
  const blocks = buildTimeline(doc, episode.id);
  const totalSec = blocks.at(-1)?.endSec ?? 0;
  const transitionMark = doc.timeline.transition === 'cut' ? null : doc.timeline.transition === 'fade' ? '◇' : '✦';

  return (
    <footer aria-label="时间线" className="shrink-0 border-t border-[var(--drama-line)] bg-[var(--drama-ink)] px-3 py-2">
      <div className="mb-1.5 flex items-center gap-3 font-mono text-xs text-[var(--drama-muted)]">
        <span className="text-[var(--drama-paper)]">{formatTimecode(totalSec)}</span>
        <span>{blocks.length} 个镜头</span>
        <span>{blocks.filter(block => block.hasTake).length} 个已有视频</span>
        {blocks.some(block => block.still) ? <span>其中 {blocks.filter(block => block.still).length} 个是静帧</span> : null}
      </div>
      {blocks.length === 0 ? (
        <p className="drama-label py-2">镜头会按顺序排在这里。</p>
      ) : (
        <div className="overflow-x-auto pb-1">
          <ol className="flex items-stretch gap-0.5" style={{ minWidth: 'max-content' }}>
            {blocks.map((block, i) => {
              const selected = block.shotId === selectedShotId;
              const running = runningShotIds.has(block.shotId);
              return (
                <li key={block.shotId} className="flex items-stretch">
                  {i > 0 && transitionMark ? <span aria-hidden="true" className="flex items-center px-0.5 text-[10px] text-[var(--drama-gold)]">{transitionMark}</span> : null}
                  <div className="flex flex-col gap-0.5" style={{ width: Math.max(MIN_BLOCK_PX, block.durationSec * PX_PER_SEC) }}>
                    <button
                      type="button" aria-pressed={selected}
                      aria-label={`镜头 ${block.shotNumber}，场 ${block.sceneNumber}，${Number(block.durationSec.toFixed(1))} 秒${block.still ? '，静帧' : block.hasTake ? '，已有视频' : running ? '，生成中' : '，待拍'}`}
                      onClick={() => selectShot(block.shotId)}
                      className={`relative h-9 overflow-hidden rounded-sm border text-left font-mono text-[10px] ${selected ? 'border-[var(--drama-gold)]' : 'border-transparent'} ${block.hasTake ? 'bg-[var(--drama-panel)]' : 'bg-[var(--drama-graphite)]'}`}
                    >
                      {block.thumbnailUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={block.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
                        : null}
                      <span className={`absolute inset-x-0 bottom-0 h-0.5 ${running ? 'bg-[var(--drama-red)]' : block.hasTake ? 'bg-[var(--drama-green)]' : 'bg-transparent'}`} />
                      <span className="relative px-1 text-[var(--drama-paper)]">{block.shotNumber}</span>
                    </button>
                    {doc.timeline.subtitles ? (
                      <span className={`h-1.5 rounded-sm ${block.subtitle ? 'bg-[var(--drama-paper)]/60' : 'bg-transparent'}`} title={block.subtitle} />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </footer>
  );
}
