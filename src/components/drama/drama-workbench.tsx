'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Clapperboard, Loader2 } from 'lucide-react';
import { createEmptyDramaProject, type DramaProjectRecord } from '@/lib/drama/types';
import {
  createDramaProject, listDramaProjects, loadDramaProject, planDramaScript, type DramaProjectSummary, type ScriptRequest,
} from '@/lib/drama/workbench-client';
import { blankEpisodeDoc } from '@/lib/drama/workbench-state';
import { DramaIdeaForm } from './drama-idea-form';
import { DramaShell } from './drama-shell';
import type { DramaWorkbenchApi } from './drama-context';

export interface DramaWorkbenchProps {
  /** Drama project to open; null shows the project list and the "start from one sentence" form. */
  dramaId: string | null;
  /** Canvas project the drama belongs to. */
  projectId?: string;
  onDramaIdChange: (id: string | null) => void;
  onExit: () => void;
  onPlaceOnCanvas?: DramaWorkbenchApi['onPlaceOnCanvas'];
  onOpenCredits?: () => void;
}

type LoadState = { status: 'loading' } | { status: 'ready'; record: DramaProjectRecord } | { status: 'error'; message: string };

export default function DramaWorkbench(props: DramaWorkbenchProps) {
  const { dramaId, projectId, onDramaIdChange } = props;
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!dramaId) return;
    let live = true;
    setState({ status: 'loading' });
    loadDramaProject(dramaId).then(
      record => { if (live) setState({ status: 'ready', record }); },
      error => { if (live) setState({ status: 'error', message: error instanceof Error ? error.message : '剧本项目读取失败' }); },
    );
    return () => { live = false; };
  }, [dramaId, attempt]);

  if (!dramaId) return <DramaStart {...props} />;
  if (state.status === 'ready' && state.record.id === dramaId) {
    return (
      <DramaShell
        key={state.record.id} record={state.record} projectId={projectId} onExit={props.onExit}
        onPlaceOnCanvas={props.onPlaceOnCanvas} onOpenCredits={props.onOpenCredits}
        onCloseProject={() => onDramaIdChange(null)}
      />
    );
  }
  return (
    <div className="drama-root flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      {state.status === 'error' ? (
        <>
          <p role="alert">{state.message}</p>
          <div className="flex gap-2">
            <button type="button" className="drama-btn drama-btn--primary" onClick={() => setAttempt(n => n + 1)}>重新载入</button>
            <button type="button" className="drama-btn" onClick={() => onDramaIdChange(null)}>打开其他短剧</button>
          </div>
        </>
      ) : (
        <p role="status" className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />正在载入剧本</p>
      )}
    </div>
  );
}

/** Empty state: start a new drama from one sentence, or reopen one of this canvas project's dramas. */
function DramaStart({ projectId, onDramaIdChange, onExit }: DramaWorkbenchProps) {
  const [projects, setProjects] = useState<DramaProjectSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listDramaProjects(projectId).then(
      list => { if (live) setProjects(list); },
      err => { if (live) setListError(err instanceof Error ? err.message : '剧本列表读取失败'); },
    );
    return () => { live = false; };
  }, [projectId]);

  const create = useCallback(async (label: string, build: () => Promise<Parameters<typeof createDramaProject>[0]>) => {
    setBusy(label);
    setError(null);
    try {
      const record = await createDramaProject(await build(), projectId);
      onDramaIdChange(record.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label}失败，请稍后重试`);
    } finally {
      setBusy(null);
    }
  }, [projectId, onDramaIdChange]);

  const generate = (input: ScriptRequest) => create('生成剧本', () => planDramaScript(input));
  const blank = (input: ScriptRequest) => create('新建剧本', async () => blankEpisodeDoc(
    createEmptyDramaProject({ title: input.title || input.idea.slice(0, 24), genre: input.genre, style: input.style as never, aspectRatio: input.aspectRatio }),
    input.idea,
  ));

  return (
    <div className="drama-root min-h-dvh overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-[var(--drama-line)] px-4 py-3">
        <button type="button" className="drama-btn drama-btn--quiet" onClick={onExit}><ArrowLeft className="h-4 w-4" />返回画布</button>
        <span className="flex items-center gap-2 text-sm text-[var(--drama-muted)]"><Clapperboard className="h-4 w-4" />短剧工作台</span>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-10 sm:py-16">
        <DramaIdeaForm busy={busy} error={error} onGenerate={generate} onBlank={blank} />
        <section aria-labelledby="drama-recent" className="flex flex-col gap-3">
          <h2 id="drama-recent" className="text-sm font-semibold">{projectId ? '这个项目里的短剧' : '我的短剧'}</h2>
          {listError ? <p role="alert" className="drama-label">{listError}</p>
            : !projects ? <p role="status" className="drama-label">正在读取</p>
              : projects.length === 0 ? <p className="drama-label">还没有短剧。写下第一句话，剧本助手会帮你拆成分场剧本。</p>
                : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {projects.map(item => (
                      <li key={item.id}>
                        <button type="button" className="drama-panel flex w-full flex-col items-start gap-1 px-4 py-3 text-left hover:border-[var(--drama-gold)]"
                          onClick={() => onDramaIdChange(item.id)}>
                          <span className="font-serif font-bold">{item.title || '未命名短剧'}</span>
                          <span className="drama-label font-mono">{new Date(item.updatedAt).toLocaleString('zh-CN')} 更新</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
        </section>
      </main>
    </div>
  );
}
