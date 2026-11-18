'use client';

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { planSceneShots } from '@/lib/drama/workbench-client';
import { MAX_SHOTS_PER_EPISODE, type DramaSceneBlock } from '@/lib/drama/types';
import {
  addShot, moveShot, removeShot, setSceneShots, updateShot,
} from '@/lib/drama/workbench-state';
import { useDrama } from './drama-context';
import { DramaSlate } from './drama-slate';

/** Step 3: shots grouped by scene. The planner fills one scene at a time; ordering is by buttons so it stays keyboard accessible. */
export function DramaBoardStep() {
  const { doc, episode, update, runningShotIds, runJob, busyLabel, setStep, selectShot } = useDrama();
  if (!episode) return <p className="drama-label">先在剧本步骤写好分集。</p>;
  const total = episode.scenes.reduce((n, scene) => n + scene.shots.length, 0);

  const planScene = (scene: DramaSceneBlock) => void runJob(`拆解「${scene.heading}」`, async () => {
    const shots = await planSceneShots(doc, episode.id, scene.id);
    update(current => setSceneShots(current, scene.id, shots));
  });

  const planAll = () => void runJob('拆解分镜', async () => {
    const targets = episode.scenes.filter(scene => scene.shots.length === 0);
    for (const scene of targets) {
      const shots = await planSceneShots(doc, episode.id, scene.id);
      update(current => setSceneShots(current, scene.id, shots));
    }
  });

  // Shot numbers run across the whole episode; each scene starts after the shots before it.
  const sceneStarts = episode.scenes.map((_, i) => episode.scenes.slice(0, i).reduce((n, item) => n + item.shots.length, 0));
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">分镜（{total} 个镜头）</h2>
        <button type="button" className="drama-btn drama-btn--primary" disabled={Boolean(busyLabel) || episode.scenes.every(scene => scene.shots.length > 0)} onClick={planAll}>
          {busyLabel?.startsWith('拆解') ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Sparkles className="h-4 w-4" />}
          {busyLabel?.startsWith('拆解') ? busyLabel : '拆解还没有镜头的场次'}
        </button>
        <span className="drama-label">拆镜不扣积分。已有镜头的场次不会被覆盖，需要重拆时在那一场里单独操作。</span>
      </div>
      {episode.scenes.length === 0 ? <p className="drama-label">还没有场次。回到剧本步骤加一场。</p> : null}
      {episode.scenes.map((scene, sceneIndex) => (
        <section key={scene.id} aria-labelledby={`scene-${scene.id}`} className="flex flex-col gap-3">
          <header className="flex flex-wrap items-center gap-3">
            <h3 id={`scene-${scene.id}`} className="font-serif text-lg font-bold">
              <span className="mr-2 font-mono text-sm text-[var(--drama-gold)]">场 {String(sceneIndex + 1).padStart(2, '0')}</span>{scene.heading}
            </h3>
            <span className="drama-label">{doc.locations.find(item => item.id === scene.locationId)?.name ?? '未指定场景'}</span>
            <button type="button" className="drama-btn ml-auto" disabled={Boolean(busyLabel)}
              onClick={() => {
                if (scene.shots.length && !window.confirm(`重新拆解会替换「${scene.heading}」现有的 ${scene.shots.length} 个镜头。已生成的视频记录不会保留。确定继续？`)) return;
                planScene(scene);
              }}>
              <Sparkles className="h-4 w-4" />{scene.shots.length ? '重新拆解这一场' : '拆解这一场'}
            </button>
          </header>
          {scene.shots.length === 0 ? <p className="drama-label">这一场还没有镜头。</p> : null}
          <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {scene.shots.map((shot, shotIndex) => {
              const number = sceneStarts[sceneIndex] + shotIndex + 1;
              return (
                <li key={shot.id} className="drama-panel flex flex-col">
                  <DramaSlate sceneNumber={sceneIndex + 1} shotNumber={number} shot={shot} running={runningShotIds.has(shot.id)} durationSec={shot.durationSec} />
                  <div className="flex flex-col gap-2 p-3">
                    <ShotText label="画面" value={shot.prompt} onChange={value => update(current => updateShot(current, shot.id, { prompt: value }))} />
                    <ShotText label="台词（会烧成字幕）" value={shot.dialogue ?? ''} placeholder="没有台词就留空" onChange={value => update(current => updateShot(current, shot.id, { dialogue: value }))} />
                    <div className="flex items-center gap-1">
                      <label className="flex items-center gap-1 text-xs text-[var(--drama-muted)]">
                        <span>时长</span>
                        <input className="drama-input w-16 font-mono" type="number" min={1} max={60} value={shot.durationSec}
                          onChange={event => update(current => updateShot(current, shot.id, { durationSec: Math.max(1, Math.min(60, Number(event.target.value) || 1)) }))} />
                        <span>秒</span>
                      </label>
                      <div className="ml-auto flex gap-1">
                        <MoveButton label="上移镜头" disabled={number === 1} onClick={() => update(current => moveShot(current, shot.id, -1))}><ArrowUp className="h-4 w-4" /></MoveButton>
                        <MoveButton label="下移镜头" disabled={number === total} onClick={() => update(current => moveShot(current, shot.id, 1))}><ArrowDown className="h-4 w-4" /></MoveButton>
                        <MoveButton label="删除镜头" onClick={() => { if (window.confirm('删除这个镜头？已生成的视频记录也会去掉。')) update(current => removeShot(current, shot.id)); }}><Trash2 className="h-4 w-4" /></MoveButton>
                      </div>
                    </div>
                    <button type="button" className="drama-btn drama-btn--quiet self-start" onClick={() => { selectShot(shot.id); setStep('shots'); }}>在镜头步骤打开</button>
                  </div>
                </li>
              );
            })}
          </ol>
          <button type="button" className="drama-btn self-start" onClick={() => {
            const added = addShot(doc, scene.id);
            if (!added) { toast.error(`这一集已达到 ${MAX_SHOTS_PER_EPISODE} 个镜头上限`); return; }
            update(current => addShot(current, scene.id)?.doc ?? current);
          }}>
            <Plus className="h-4 w-4" />在这一场加一个镜头
          </button>
        </section>
      ))}
      <div>
        <button type="button" className="drama-btn drama-btn--primary" disabled={total === 0} onClick={() => setStep('shots')}>下一步：生成镜头</button>
      </div>
    </div>
  );
}

function ShotText({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="drama-label">{label}</span>
      <textarea className="drama-input min-h-14 resize-y" maxLength={4000} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
    </label>
  );
}

function MoveButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="drama-btn px-2" aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>;
}
