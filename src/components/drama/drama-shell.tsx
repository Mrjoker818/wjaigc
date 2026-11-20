'use client';

import type { ReactNode } from 'react';
import { ArrowLeft, Clapperboard, Coins, FolderOpen } from 'lucide-react';
import type { DramaProjectRecord } from '@/lib/drama/types';
import { DramaWorkbenchContext, DRAMA_STEPS, type DramaWorkbenchApi, type SaveState } from './drama-context';
import { useDramaWorkbench } from './use-drama-workbench';
import { DramaScriptStep } from './drama-script-step';
import { DramaBibleStep } from './drama-bible-step';
import { DramaBoardStep } from './drama-board-step';
import { DramaShotsStep } from './drama-shots-step';
import { DramaFinalStep } from './drama-final-step';
import { DramaInspector } from './drama-inspector';
import { DramaTaskPanel } from './drama-task-panel';
import { DramaTimeline } from './drama-timeline';

const SAVE_TEXT: Record<SaveState, string> = {
  saved: '已保存', dirty: '有改动', saving: '正在保存', error: '保存失败，将自动重试', conflict: '已在其他窗口修改',
};

export function DramaShell({
  record, projectId, onExit, switcher, onCloseProject, onPlaceOnCanvas, onPlaceImageOnCanvas, canvasMedia, onOpenCredits, onContinueInChat,
}: {
  record: DramaProjectRecord;
  projectId?: string;
  onExit: () => void;
  /** Platform switcher shown in place of the back button. */
  switcher?: ReactNode;
  onCloseProject: () => void;
  onPlaceOnCanvas?: DramaWorkbenchApi['onPlaceOnCanvas'];
  onPlaceImageOnCanvas?: DramaWorkbenchApi['onPlaceImageOnCanvas'];
  canvasMedia?: DramaWorkbenchApi['canvasMedia'];
  onOpenCredits?: () => void;
  onContinueInChat?: DramaWorkbenchApi['onContinueInChat'];
}) {
  const api = useDramaWorkbench({ record, projectId, onPlaceOnCanvas, onPlaceImageOnCanvas, canvasMedia, onOpenCredits, onContinueInChat });
  const { doc, episode, step, setStep, saveState, estimate } = api;
  const short = estimate ? Math.max(0, estimate.total - estimate.balance) : 0;

  return (
    <DramaWorkbenchContext.Provider value={api}>
      <div className="drama-root flex h-dvh flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--drama-line)] px-3 py-2">
          {switcher ?? <button type="button" className="drama-btn drama-btn--quiet" onClick={onExit} aria-label="返回画布"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">画布</span></button>}
          <Clapperboard className="hidden h-4 w-4 text-[var(--drama-gold)] sm:block" aria-hidden="true" />
          <input
            className="min-w-0 flex-1 basis-40 bg-transparent font-serif text-lg font-bold outline-none sm:flex-none sm:basis-auto sm:w-56"
            aria-label="片名" maxLength={200} value={doc.title}
            onChange={event => api.update(current => ({ ...current, title: event.target.value }))}
          />
          {doc.episodes.length > 1 ? (
            <select className="drama-input w-auto" aria-label="分集" value={episode?.id ?? ''} onChange={event => api.setEpisodeId(event.target.value)}>
              {doc.episodes.map((item, i) => <option key={item.id} value={item.id}>第 {i + 1} 集 · {item.title}</option>)}
            </select>
          ) : null}
          <span className="font-mono text-xs text-[var(--drama-muted)]">{doc.aspectRatio}</span>
          <span role="status" aria-live="polite" className={`text-xs ${saveState === 'conflict' || saveState === 'error' ? 'text-[var(--drama-red)]' : 'text-[var(--drama-muted)]'}`}>
            {SAVE_TEXT[saveState]}
          </span>
          {saveState === 'conflict' ? (
            <button type="button" className="drama-btn" onClick={() => window.location.reload()}>载入最新版本</button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <DramaTaskPanel />
            {estimate ? (
              <span className={`flex items-center gap-1 font-mono text-xs ${short ? 'text-[var(--drama-red)]' : 'text-[var(--drama-muted)]'}`}
                title={`余额 ${estimate.balance} 积分`}>
                <Coins className="h-3.5 w-3.5" aria-hidden="true" />待拍镜头约 {estimate.total} 积分{short ? `，还差 ${short}` : ''}
              </span>
            ) : null}
            {short && onOpenCredits ? <button type="button" className="drama-btn" onClick={onOpenCredits}>充值</button> : null}
            <button type="button" className="drama-btn drama-btn--quiet" onClick={async () => { await api.flushSave(); onCloseProject(); }} aria-label="打开其他短剧">
              <FolderOpen className="h-4 w-4" />
            </button>
            <button type="button" className="drama-btn drama-btn--primary" onClick={() => setStep('final')}>去成片</button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <nav aria-label="制作步骤" className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--drama-line)] p-2 lg:w-44 lg:flex-col lg:border-b-0 lg:border-r">
            {DRAMA_STEPS.map((item, i) => (
              <button
                key={item.id} type="button" aria-current={step === item.id ? 'step' : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${step === item.id ? 'bg-[var(--drama-panel)] text-[var(--drama-gold)]' : 'text-[var(--drama-muted)] hover:text-[var(--drama-paper)]'}`}
                onClick={() => setStep(item.id)}
              >
                <span className="font-mono text-xs">{i + 1}</span>
                <span className="flex flex-col">
                  <span>{item.label}</span>
                  <span className="hidden text-[11px] opacity-70 lg:block">{item.hint}</span>
                </span>
              </button>
            ))}
          </nav>
          <div role="main" className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {step === 'script' ? <DramaScriptStep />
              : step === 'bible' ? <DramaBibleStep />
                : step === 'board' ? <DramaBoardStep />
                  : step === 'shots' ? <DramaShotsStep />
                    : <DramaFinalStep />}
          </div>
          <DramaInspector />
        </div>
        <DramaTimeline />
      </div>
    </DramaWorkbenchContext.Provider>
  );
}
