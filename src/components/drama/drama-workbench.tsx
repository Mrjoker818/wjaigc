'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Clapperboard, FileArchive, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createEmptyDramaProject, type DramaProjectRecord } from '@/lib/drama/types';
import type { SimpleChatWorkspaceHandoffIntent } from '@/lib/simple-chat-workspace-handoff';
import {
  createDramaFromChat, createDramaProject, listDramaProjects, loadDramaProject, planDramaScript, startAdaptation, waitForAdaptation,
  type AdaptRequest, type DramaProjectSummary, type ScriptRequest,
} from '@/lib/drama/workbench-client';
import { importDramaPackage } from '@/lib/drama/import-client';
import { blankEpisodeDoc } from '@/lib/drama/workbench-state';
import { DramaAdaptForm } from './drama-adapt-form';
import { DramaIdeaForm } from './drama-idea-form';
import { DramaShell } from './drama-shell';
import type { DramaWorkbenchApi } from './drama-context';

export interface DramaWorkbenchProps {
  /** Drama project to open; null shows the project list and the "start from one sentence" form. */
  dramaId: string | null;
  /** Canvas project the drama belongs to. */
  projectId?: string;
  onDramaIdChange: (id: string | null) => void;
  /** Called when the opened drama belongs to a canvas project but none is loaded, e.g. from a `/video?dramaId=` link. */
  onOpenDramaProject?: (projectId: string) => void;
  onExit: () => void;
  /** Platform switcher shown in place of the back button. */
  switcher?: ReactNode;
  onPlaceOnCanvas?: DramaWorkbenchApi['onPlaceOnCanvas'];
  onPlaceImageOnCanvas?: DramaWorkbenchApi['onPlaceImageOnCanvas'];
  /** The project's canvas pictures, offered when picking a reference image. */
  canvasMedia?: DramaWorkbenchApi['canvasMedia'];
  onOpenCredits?: () => void;
  onContinueInChat?: DramaWorkbenchApi['onContinueInChat'];
  /** A message sent from simple chat; it is written into a new script draft once, then `onChatHandoffDone` clears it. */
  chatHandoff?: SimpleChatWorkspaceHandoffIntent | null;
  onChatHandoffDone?: () => void;
  /** Idea typed on the canvas; it fills the "start from one sentence" form. */
  initialIdea?: string;
}

type LoadState = { status: 'loading' } | { status: 'ready'; record: DramaProjectRecord } | { status: 'error'; message: string };

export default function DramaWorkbench(props: DramaWorkbenchProps) {
  const { dramaId, projectId, onDramaIdChange, onOpenDramaProject } = props;
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const dramaProjectId = state.status === 'ready' ? state.record.projectId : null;

  useEffect(() => {
    if (dramaProjectId && !projectId) onOpenDramaProject?.(dramaProjectId);
  }, [dramaProjectId, projectId, onOpenDramaProject]);

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
        key={state.record.id} record={state.record} projectId={projectId} onExit={props.onExit} switcher={props.switcher}
        onPlaceOnCanvas={props.onPlaceOnCanvas} onPlaceImageOnCanvas={props.onPlaceImageOnCanvas} canvasMedia={props.canvasMedia}
        onOpenCredits={props.onOpenCredits} onContinueInChat={props.onContinueInChat}
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
function DramaStart({ projectId, onDramaIdChange, onExit, switcher, chatHandoff, onChatHandoffDone, initialIdea }: DramaWorkbenchProps) {
  const [projects, setProjects] = useState<DramaProjectSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adaptProgress, setAdaptProgress] = useState<{ value: number; label?: string } | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const packagePicker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    listDramaProjects(projectId).then(
      list => { if (live) setProjects(list); },
      err => { if (live) setListError(err instanceof Error ? err.message : '剧本列表读取失败'); },
    );
    return () => { live = false; };
  }, [projectId]);

  /** Runs one creation job; `save` resolves to the stored record, which is then opened. */
  const create = useCallback(async (label: string, save: () => Promise<DramaProjectRecord>) => {
    setBusy(label);
    setError(null);
    try {
      const record = await save();
      onDramaIdChange(record.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label}失败，请稍后重试`);
    } finally {
      setBusy(null);
    }
  }, [onDramaIdChange]);

  // The ref outlives StrictMode's second effect run, so one chat message never becomes two drafts.
  const startedHandoff = useRef<SimpleChatWorkspaceHandoffIntent | null>(null);
  useEffect(() => {
    if (!chatHandoff || startedHandoff.current === chatHandoff) return;
    startedHandoff.current = chatHandoff;
    onChatHandoffDone?.();
    void create('从对话写剧本', () => createDramaFromChat(chatHandoff));
  }, [chatHandoff, onChatHandoffDone, create]);

  const generate = (input: ScriptRequest) => create('生成剧本', async () => createDramaProject(await planDramaScript(input), projectId));
  const adapt = (input: AdaptRequest) => create('改编小说', async () => {
    setAdaptProgress({ value: 2 });
    try {
      const { taskId } = await startAdaptation({ ...input, ...(projectId ? { projectId } : {}) });
      const result = await waitForAdaptation(taskId, { onProgress: (value, label) => setAdaptProgress({ value, label }) });
      if (result.adaptedParts < result.totalParts) {
        toast.error(`改编了 ${result.adaptedParts}/${result.totalParts} 段`, { description: '后面的部分剧本助手没有写出来，可以在剧本步骤里接着写。' });
      }
      return await loadDramaProject(result.dramaId);
    } finally {
      setAdaptProgress(null);
    }
  });
  // Import errors show beside the import button, not in the idea form above it.
  const importPackage = async (file: File) => {
    setBusy('导入制作包');
    setImportError(null);
    setImportProgress({ done: 0, total: 0 });
    try {
      const result = await importDramaPackage(file, { ...(projectId ? { projectId } : {}), onProgress: (done, total) => setImportProgress({ done, total }) });
      if (result.failed.length) {
        toast.error(`${result.failed.length} 个文件没有导入`, { description: `${result.failed.slice(0, 3).join('、')}${result.failed.length > 3 ? ' 等' : ''}仍指向原地址，可以在工作台里重新上传或生成。` });
      } else toast.success('制作包已导入');
      onDramaIdChange(result.record.id);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : '制作包导入失败，请稍后重试');
    } finally {
      setImportProgress(null);
      setBusy(null);
    }
  };
  const blank = (input: ScriptRequest) => create('新建剧本', () => createDramaProject(blankEpisodeDoc(
    createEmptyDramaProject({ title: input.title || input.idea.slice(0, 24), genre: input.genre, style: input.style as never, aspectRatio: input.aspectRatio }),
    input.idea,
  ), projectId));

  return (
    // A fixed height, not min-h: the page body does not scroll, so this element has to.
    <div className="drama-root h-dvh overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-[var(--drama-line)] px-4 py-3">
        {switcher ?? <button type="button" className="drama-btn drama-btn--quiet" onClick={onExit}><ArrowLeft className="h-4 w-4" />返回画布</button>}
        <span className="flex items-center gap-2 text-sm text-[var(--drama-muted)]"><Clapperboard className="h-4 w-4" />短剧工作台</span>
      </header>
      <div role="main" className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-10 sm:py-16">
        {busy === '从对话写剧本' ? (
          <p role="status" className="drama-panel flex items-center gap-2 px-4 py-3 text-sm">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />正在把对话内容写成分场剧本，约需 1 分钟
          </p>
        ) : null}
        <DramaIdeaForm key={initialIdea} busy={busy} error={error} initialIdea={initialIdea} onGenerate={generate} onBlank={blank} />
        <DramaAdaptForm busy={busy} progress={adaptProgress} onAdapt={adapt} />
        <section aria-labelledby="drama-import" className="drama-panel flex flex-col gap-3 p-4">
          <h2 id="drama-import" className="flex items-center gap-2 text-sm font-semibold"><FileArchive className="h-4 w-4" />导入制作包</h2>
          <p className="drama-label">选择在成片步骤导出的「制作包 ZIP」，剧本、镜头、定妆图、视频和配音会变成一部新短剧，原来那部不受影响。导入不扣积分，单个视频最大 48MB。</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="drama-btn" disabled={Boolean(busy)} onClick={() => packagePicker.current?.click()}>
              {importProgress ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <FileArchive className="h-4 w-4" />}
              {importProgress ? `正在导入 ${importProgress.done}/${importProgress.total || '…'}` : '选择制作包'}
            </button>
          </div>
          {importError ? <p role="alert" className="text-sm text-[var(--drama-red)]">{importError}</p> : null}
          <input ref={packagePicker} type="file" accept=".zip,application/zip" className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importPackage(file);
            }} />
        </section>
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
                          <span className="font-semibold">{item.title || '未命名短剧'}</span>
                          <span className="drama-label tabular-nums">{new Date(item.updatedAt).toLocaleString('zh-CN')} 更新</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
        </section>
      </div>
    </div>
  );
}
