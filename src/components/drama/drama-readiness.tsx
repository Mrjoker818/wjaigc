'use client';

import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { episodeShotNumbers, shotReadiness, summarizeReadiness, type ReadinessCheck } from '@/lib/drama/readiness';
import type { DramaEpisode, DramaShot } from '@/lib/drama/types';
import { DRAMA_STEPS, useDrama } from './drama-context';

const STEP_LABEL = Object.fromEntries(DRAMA_STEPS.map(item => [item.id, item.label]));

/** Checks for one shot, from the same model the next take would use. */
export function useShotReadiness(episodeId: string, shot: DramaShot): ReadinessCheck[] {
  const { doc, modelForShot } = useDrama();
  return shotReadiness(doc, episodeId, shot, modelForShot(shot));
}

function CheckIcon({ check }: { check: ReadinessCheck }) {
  if (check.ok) return <CircleCheck className="h-4 w-4 shrink-0 text-[var(--drama-green)]" aria-label="已就绪" />;
  return check.required
    ? <CircleAlert className="h-4 w-4 shrink-0 text-[var(--drama-red)]" aria-label="必须补上" />
    : <TriangleAlert className="h-4 w-4 shrink-0 text-[var(--drama-gold)]" aria-label="建议补上" />;
}

/** Inspector section: every check for the selected shot, with a jump to the step that fixes each open one. */
export function ShotReadinessList({ episodeId, shot }: { episodeId: string; shot: DramaShot }) {
  const { step, setStep } = useDrama();
  const checks = useShotReadiness(episodeId, shot);
  const summary = summarizeReadiness(checks);
  return (
    <section aria-labelledby="drama-readiness" className="flex flex-col gap-2">
      <h3 id="drama-readiness" className="drama-label flex items-center gap-2">
        就绪检查
        <span className={`font-mono ${summary.blocking ? 'text-[var(--drama-red)]' : summary.open ? 'text-[var(--drama-gold)]' : 'text-[var(--drama-green)]'}`}>
          {summary.blocking ? `${summary.blocking} 项必须补上` : summary.open ? `可进成片 · ${summary.open} 项建议补上` : '全部就绪'}
        </span>
      </h3>
      <ul className="flex flex-col gap-1.5">
        {checks.map(check => (
          <li key={check.key} className="flex items-start gap-2 text-sm">
            <CheckIcon check={check} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={check.ok ? 'text-[var(--drama-muted)]' : undefined}>{check.label}</span>
              {check.detail ? <span className="text-xs text-[var(--drama-muted)]">{check.detail}</span> : null}
            </span>
            {!check.ok && check.step !== step ? (
              <button type="button" className="drama-btn min-h-7 shrink-0 px-2 text-xs" onClick={() => setStep(check.step)}>去{STEP_LABEL[check.step]}</button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Shot-card marker: green when ready, red with the count of blocking items, gold for suggestions only. */
export function ShotReadinessBadge({ episodeId, shot }: { episodeId: string; shot: DramaShot }) {
  const checks = useShotReadiness(episodeId, shot);
  const summary = summarizeReadiness(checks);
  const open = checks.filter(check => !check.ok).map(check => check.label).join('、');
  const tone = summary.blocking ? 'text-[var(--drama-red)]' : summary.open ? 'text-[var(--drama-gold)]' : 'text-[var(--drama-green)]';
  const Icon = summary.blocking ? CircleAlert : summary.open ? TriangleAlert : CircleCheck;
  return (
    <span className={`flex items-center gap-1 text-xs ${tone}`} title={open ? `待补：${open}` : '全部就绪'}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {summary.blocking ? `缺 ${summary.blocking} 项` : summary.open ? `可拍 · ${summary.open} 项建议` : '就绪'}
    </span>
  );
}

/**
 * Final-step summary before rendering: the shots that still have open items, each one clickable.
 * Blocking items keep the render button disabled; suggestions only warn.
 */
export function EpisodeReadiness({ episode }: { episode: DramaEpisode }) {
  const { doc, modelForShot, selectShot } = useDrama();
  const numbers = episodeShotNumbers(episode);
  const rows = episode.scenes.flatMap(scene => scene.shots).map(shot => {
    const checks = shotReadiness(doc, episode.id, shot, modelForShot(shot));
    return { shot, checks: checks.filter(check => !check.ok), summary: summarizeReadiness(checks) };
  }).filter(row => row.checks.length);
  if (rows.length === 0) {
    return <p className="flex items-center gap-2 text-sm text-[var(--drama-green)]"><CircleCheck className="h-4 w-4" aria-hidden="true" />所有镜头都已就绪。</p>;
  }
  const blocking = rows.filter(row => row.summary.blocking).length;
  return (
    <details className="rounded-md border border-[var(--drama-line)] p-3" open={blocking > 0}>
      <summary className="cursor-pointer text-sm">
        {blocking ? <span className="text-[var(--drama-red)]">{blocking} 个镜头还不能进成片</span> : <span className="text-[var(--drama-gold)]">可以渲染</span>}
        <span className="drama-label">{` · ${rows.length} 个镜头有待补的项`}</span>
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {rows.map(({ shot, checks, summary }) => (
          <li key={shot.id}>
            <button type="button" className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-[var(--drama-graphite)]" onClick={() => selectShot(shot.id)}>
              <span className={`font-mono text-xs ${summary.blocking ? 'text-[var(--drama-red)]' : 'text-[var(--drama-gold)]'}`}>镜头 {String(numbers.get(shot.id) ?? 0).padStart(2, '0')}</span>
              <span className="min-w-0 flex-1 text-[var(--drama-muted)]">{checks.map(check => check.label).join('、')}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
