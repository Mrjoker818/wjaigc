'use client';

import { useState } from 'react';
import { Loader2, Square, Wand2 } from 'lucide-react';
import {
  autopilotDone, autopilotPlan, quoteTotal, type AutopilotChoices, type AutopilotQuote, type AutopilotStage,
} from '@/lib/drama/autopilot';
import { useDrama } from './drama-context';

const ALL_CHOSEN: AutopilotChoices = { bible: true, keyframes: true, voiceover: true, render: true };

interface StageRow {
  stage: AutopilotStage;
  label: string;
  unit: string;
  count: number;
  /** Credits; null for free stages. */
  credits: number | null | undefined;
  choice?: keyof AutopilotChoices;
}

function rows(quote: AutopilotQuote): StageRow[] {
  const { plan, credits } = quote;
  return [
    { stage: 'bible', label: '设定图', unit: '张', count: plan.bible.length, credits: credits.bible, choice: 'bible' },
    { stage: 'keyframes', label: '关键帧', unit: '张', count: plan.keyframes.length, credits: credits.keyframes, choice: 'keyframes' },
    { stage: 'shots', label: '镜头视频', unit: '个', count: plan.shots.length, credits: credits.shots },
    { stage: 'voiceover', label: '配音', unit: '句', count: plan.voiceovers.length, credits: null, choice: 'voiceover' },
    { stage: 'render', label: '渲染成片', unit: '', count: 1, credits: null, choice: 'render' },
  ];
}

const priceText = (row: StageRow) => (row.credits === null ? '不扣积分' : row.credits === undefined ? '估不出价格' : `约 ${row.credits} 积分`);

/** Final step panel: price everything the episode still lacks, then fill it in one run. */
export function DramaAutopilot() {
  const { doc, episode, autopilot, quoteAutopilot, runAutopilot, stopAutopilot, busyLabel, batchRunning, render } = useDrama();
  const [quote, setQuote] = useState<AutopilotQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [choices, setChoices] = useState<AutopilotChoices>(ALL_CHOSEN);
  if (!episode) return null;

  const running = autopilot !== null;
  const shown = running ? autopilot.quote : quote?.episodeId === episode.id ? quote : null;
  const busy = Boolean(busyLabel) || batchRunning || render.status === 'rendering';
  const done = shown ? autopilotDone(shown, autopilotPlan(doc, shown.episodeId)) : null;
  const active = running ? autopilot.choices : choices;
  const total = shown ? quoteTotal(shown, active) : undefined;
  const short = shown?.balance !== undefined && total !== undefined ? Math.max(0, total - shown.balance) : 0;
  const nothingToDo = shown ? shown.plan.bible.length + shown.plan.keyframes.length + shown.plan.shots.length + shown.plan.voiceovers.length === 0 : false;

  const ask = async () => {
    setQuoting(true);
    try {
      const next = await quoteAutopilot();
      if (next) { setQuote(next); setChoices(ALL_CHOSEN); }
    } finally {
      setQuoting(false);
    }
  };
  const start = async () => {
    if (!shown) return;
    await runAutopilot(shown, choices);
    setQuote(null);
  };

  return (
    <section className="drama-panel flex flex-col gap-4 p-4" aria-labelledby="drama-autopilot">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="drama-autopilot" className="font-serif text-base font-bold">一键成片</h2>
        <p className="drama-label">补齐这一集还缺的设定图、关键帧、镜头和配音，再渲染成片。已经做好的不会重做，也不会重复扣费。</p>
      </div>

      {shown ? (
        <ol className="flex flex-col divide-y divide-[var(--drama-line)] rounded-md border border-[var(--drama-line)]">
          {rows(shown).map(row => {
            const chosen = row.choice ? active[row.choice] : true;
            const current = running && autopilot.stage === row.stage;
            const finished = row.stage !== 'render' && done ? done[row.stage] : 0;
            const empty = row.stage !== 'render' && row.count === 0;
            return (
              <li key={row.stage} aria-current={current ? 'step' : undefined}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm ${!chosen || empty ? 'opacity-55' : ''}`}>
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${current
                  ? 'bg-[var(--drama-gold)] shadow-[0_0_8px_var(--drama-gold)] motion-safe:animate-pulse'
                  : !empty && finished >= row.count && row.stage !== 'render' ? 'bg-[var(--drama-green)]' : 'bg-[var(--drama-line)]'}`} />
                <span className="w-20 shrink-0">{row.label}</span>
                <span className="w-24 shrink-0 font-mono text-xs text-[var(--drama-muted)]">
                  {row.stage === 'render' ? '' : empty ? '已备齐' : running ? `${finished}/${row.count} ${row.unit}` : `${row.count} ${row.unit}`}
                </span>
                <span className={`flex-1 font-mono text-xs ${row.credits === undefined && !empty ? 'text-[var(--drama-red)]' : 'text-[var(--drama-muted)]'}`}>
                  {empty ? '' : priceText(row)}
                </span>
                {row.choice ? (
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={chosen} disabled={running || empty}
                      onChange={event => setChoices(previous => ({ ...previous, [row.choice!]: event.target.checked }))} />
                    {row.stage === 'render' ? '最后渲染' : '要做'}
                  </label>
                ) : <span className="drama-label text-xs">{empty ? '' : '必须'}</span>}
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <>
            <span role="status" className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{busyLabel ?? '一键成片进行中'}
              {autopilot.stage === 'render' && render.status === 'rendering' ? <span className="font-mono text-xs">{render.progress}%</span> : null}
            </span>
            <button type="button" className="drama-btn" onClick={stopAutopilot}><Square className="h-4 w-4" />停止</button>
            <span className="drama-label">已提交给供应商的镜头停止后仍会完成并扣费。</span>
          </>
        ) : shown && !nothingToDo ? (
          <>
            <button type="button" className="drama-btn drama-btn--primary" disabled={busy || short > 0} onClick={() => void start()}>
              <Wand2 className="h-4 w-4" />{total === undefined ? '开始，按实际价格扣费' : total ? `花约 ${total} 积分开始` : '开始，不扣积分'}
            </button>
            <span className={`font-mono text-xs ${short ? 'text-[var(--drama-red)]' : 'text-[var(--drama-muted)]'}`}>
              {shown.balance !== undefined ? `余额 ${shown.balance} 积分` : ''}{short ? `，还差 ${short}，充值后再开始` : ''}
            </span>
            <button type="button" className="drama-btn drama-btn--quiet" disabled={busy || quoting} onClick={() => void ask()}>重新估价</button>
          </>
        ) : (
          <>
            <button type="button" className="drama-btn drama-btn--primary" disabled={busy || quoting} onClick={() => void ask()}>
              {quoting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Wand2 className="h-4 w-4" />}
              {quoting ? '正在清点和估价' : '清点还缺什么'}
            </button>
            <span className="drama-label">
              {nothingToDo ? '这一集的设定图、镜头和配音都已备齐，可以直接渲染。' : '先列出要补的内容和积分，确认后才开始扣费。没有镜头的场次会先免费拆好分镜。'}
            </span>
          </>
        )}
      </div>
      {shown && total === undefined && !running && !nothingToDo ? (
        <p className="text-sm text-[var(--drama-red)]">有一项没能估出价格，可能是还没有可用的模型。开始后按实际价格扣费，也可以先去后台检查模型设置。</p>
      ) : null}
    </section>
  );
}
