'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FileText, Loader2, X } from 'lucide-react';
import { DIRECTOR_STYLE_LIST, type DirectorStyle } from '@/lib/video-director/director-styles';
import { parseDramaProject } from '@/lib/drama/schema';
import { createDramaProject, DramaCreationUnknownError } from '@/lib/drama/workbench-client';
import type { DramaProjectRecord, DramaProjectV1 } from '@/lib/drama/types';
import { DRAMA_RATIOS } from './drama-idea-form';

// Conservative browser limits; the server also checks expanded DOCX contents.
const MAX_TEXT = 100_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const REQUEST_MS = 30_000;
type Preview = { doc: DramaProjectV1; warnings: string[]; stats: { episodes: number; scenes: number; characters: number; dialogues: number } };
type Job = { controller: AbortController; timer?: ReturnType<typeof setTimeout> };

function readPreview(value: unknown): Preview {
  const data = value as Partial<Preview> & { success?: boolean };
  if (!data || data.success !== true || !data.doc || !Array.isArray(data.warnings)
    || !data.warnings.every(item => typeof item === 'string') || !data.stats
    || !['episodes', 'scenes', 'characters', 'dialogues'].every(key => Number.isSafeInteger(data.stats?.[key as keyof Preview['stats']]) && data.stats![key as keyof Preview['stats']] >= 0)
    || typeof data.doc.sourceScript?.originalText !== 'string' || !data.doc.episodes?.length) {
    throw new Error('解析结果不完整，请重新解析预览');
  }
  try { parseDramaProject(data.doc); } catch { throw new Error('解析结果无效，请重新解析预览'); }
  return { doc: data.doc, warnings: data.warnings, stats: data.stats };
}

/** Parse without creating a project. Only the reviewed document can be explicitly saved. */
export function DramaSourceForm({ busy, onBusyChange, onCreated, projectId, onRefreshProjects }: {
  busy: string | null;
  onBusyChange: (label: string | null) => void;
  onCreated: (record: DramaProjectRecord) => void;
  projectId?: string;
  onRefreshProjects: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState<DirectorStyle>('cinematic');
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phase, setPhase] = useState<'idle' | 'parse' | 'create'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [saveUnknown, setSaveUnknown] = useState(false);
  const active = useRef<Job | null>(null);
  const entry = useRef<HTMLButtonElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const externalBusy = Boolean(busy) && phase === 'idle';
  const saving = phase === 'create';
  const valid = file ? file.size > 0 && file.size <= MAX_FILE_BYTES : Boolean(text.trim()) && text.length <= MAX_TEXT;

  useEffect(() => () => {
    const pending = active.current;
    active.current?.controller.abort();
    clearTimeout(active.current?.timer);
    active.current = null;
    if (pending) onBusyChange(null);
  }, [onBusyChange]);

  const cancel = () => {
    if (!active.current) return;
    active.current.controller.abort();
    clearTimeout(active.current.timer);
    active.current = null;
    setPhase('idle');
    onBusyChange(null);
  };
  const invalidate = () => { cancel(); setPreview(null); setError(null); };
  const close = () => {
    if (saving) return;
    invalidate(); setOpen(false); setFile(null); setText(''); setSaveUnknown(false);
    entry.current?.focus();
  };
  // A timeout settles even if a transport fails to reject on abort. No automatic retries.
  const bounded = <T,>(job: Job, task: Promise<T>, message: string): Promise<T> => Promise.race([
    task,
    new Promise<never>((_, reject) => {
      job.timer = setTimeout(() => { job.controller.abort(); reject(new Error(message)); }, REQUEST_MS);
    }),
  ]);
  const finish = (job: Job) => {
    clearTimeout(job.timer);
    if (active.current !== job) return;
    active.current = null; setPhase('idle'); onBusyChange(null);
  };

  const parse = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || saving || externalBusy || active.current || saveUnknown) return;
    setPreview(null); setError(null);
    const job: Job = { controller: new AbortController() };
    active.current = job; setPhase('parse'); onBusyChange('解析已有剧本');
    try {
      let body: BodyInit;
      let headers: HeadersInit | undefined;
      if (file) {
        const form = new FormData();
        form.set('file', file); form.set('title', title); form.set('style', style); form.set('aspectRatio', aspectRatio);
        body = form;
      } else {
        body = JSON.stringify({ text, ...(title.trim() ? { title: title.trim() } : {}), style, aspectRatio, format: 'text' });
        headers = { 'Content-Type': 'application/json' };
      }
      const result = await bounded(job, (async () => {
        const response = await fetch('/api/drama/import-script', { method: 'POST', body, headers, signal: job.controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '剧本解析失败，请检查文件后重试');
        return readPreview(data);
      })(), '剧本解析超时，请重试或缩小文件');
      if (active.current !== job) return;
      setPreview(result);
    } catch (err) {
      if (active.current === job) setError(err instanceof Error ? err.message : '剧本解析失败，请稍后重试');
    } finally { finish(job); }
  };

  useEffect(() => { if (preview) previewHeading.current?.focus(); }, [preview]);

  const create = async () => {
    if (!preview || active.current || externalBusy || saveUnknown) return;
    const job: Job = { controller: new AbortController() };
    active.current = job; setPhase('create'); setError(null); onBusyChange('创建已有剧本');
    try {
      const record = await bounded(job, createDramaProject(preview.doc, projectId, (url, init) => fetch(url, { ...init, signal: job.controller.signal })),
        '创建结果未确认，请先返回短剧列表核对，避免重复创建');
      if (active.current === job) onCreated(record);
    } catch (err) {
      if (active.current === job) {
        // An interrupted save can have reached the server; do not offer an automatic duplicate.
        const unknown = job.controller.signal.aborted || err instanceof TypeError || err instanceof SyntaxError || err instanceof DramaCreationUnknownError;
        setSaveUnknown(unknown);
        setError(unknown ? '创建结果未确认，请先返回短剧列表核对，避免重复创建' : err instanceof Error ? err.message : '创建失败，请重试');
      }
    } finally { finish(job); }
  };

  return (
    <section aria-labelledby="drama-source-title" className="drama-panel min-w-0 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="drama-source-title" className="flex items-center gap-2 text-base font-semibold"><FileText className="h-4 w-4" aria-hidden="true" />已有剧本</h2>
        <button ref={entry} type="button" className="drama-btn" aria-expanded={open} aria-controls="drama-source-body" disabled={externalBusy || saving}
          onClick={() => open ? close() : setOpen(true)}>
          {open ? <><X className="h-4 w-4" aria-hidden="true" />关闭已有剧本</> : '导入已有剧本'}
        </button>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--drama-muted)]">保留剧本原文，识别分集、分场、角色和台词。先检查解析结果，再创建短剧，不调用生成模型、不扣积分。</p>
      {open ? <form id="drama-source-body" onSubmit={event => void parse(event)} className="mt-5 flex min-w-0 flex-col gap-4">
        <fieldset disabled={saving || externalBusy || saveUnknown} className="flex min-w-0 flex-col gap-4">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="drama-label">剧本原文</span>
            <textarea className="drama-input min-h-48 resize-y leading-relaxed" value={text} maxLength={MAX_TEXT} disabled={Boolean(file)}
              aria-describedby="drama-source-limits" placeholder={'粘贴已有剧本，例如：\n第1集 雨夜\n第1场 咖啡馆 内 夜\n林夏：你还在等我？'}
              onChange={event => { invalidate(); setText(event.target.value); }} />
          </label>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="drama-label">或上传剧本文件</span>
              <input type="file" aria-label="剧本文件" accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="drama-input min-w-0 max-w-full text-sm file:mr-3 file:cursor-pointer file:border-0 file:bg-transparent file:text-[var(--drama-gold)]" onChange={event => {
                  const selected = event.target.files?.[0]; event.target.value = '';
                  if (!selected) return;
                  invalidate(); setFile(null);
                  if (!/\.(txt|docx)$/i.test(selected.name)) { setError('仅支持 UTF-8 TXT 或 DOCX 文件'); return; }
                  if (!selected.size || selected.size > MAX_FILE_BYTES) { setError('文件为空或超过 5 MB，请缩小文件后重试'); return; }
                  setFile(selected);
                }} />
            </label>
            {file ? <button type="button" className="drama-btn mt-5" onClick={() => { invalidate(); setFile(null); }}>移除文件</button> : null}
          </div>
          {file ? <p className="break-all text-sm">已选择：{file.name}</p> : null}
          <p id="drama-source-limits" className="drama-label tabular-nums">粘贴最多 100,000 字；TXT / DOCX 最大 5 MB。{!file ? `已输入 ${text.length.toLocaleString('zh-CN')} 字。` : '使用文件内容解析，粘贴内容暂不参与。'}</p>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1.5"><span className="drama-label">剧本片名</span>
              <input className="drama-input" maxLength={200} placeholder="可不填" value={title} onChange={event => { invalidate(); setTitle(event.target.value); }} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5"><span className="drama-label">剧本视觉风格</span>
              <select className="drama-input" value={style} onChange={event => { invalidate(); setStyle(event.target.value as DirectorStyle); }}>
                {DIRECTOR_STYLE_LIST.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </div>
          <fieldset><legend className="drama-label mb-2">剧本画面比例</legend><div className="flex flex-wrap gap-2">
            {DRAMA_RATIOS.map(ratio => <button key={ratio} type="button" className="drama-btn tabular-nums" aria-pressed={aspectRatio === ratio}
              onClick={() => { invalidate(); setAspectRatio(ratio); }}>{ratio}</button>)}
          </div></fieldset>
        </fieldset>
        {error ? <p role="alert" className="break-words text-sm text-[var(--drama-red)]">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="drama-btn" disabled={!valid || phase !== 'idle' || externalBusy || saveUnknown}>
            {phase === 'parse' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {phase === 'parse' ? '正在解析' : '解析预览'}
          </button>
          {phase === 'parse' ? <><span role="status" className="drama-label">正在读取剧本并识别结构…</span><button type="button" className="drama-btn" onClick={cancel}>取消解析</button></> : null}
          {saveUnknown ? <button type="button" className="drama-btn" onClick={() => { onRefreshProjects(); close(); }}>返回短剧列表</button> : null}
        </div>
        {preview ? <section aria-labelledby="drama-source-preview" className="flex min-w-0 flex-col gap-4 border-t border-[var(--drama-line)] pt-5">
          <h3 ref={previewHeading} tabIndex={-1} id="drama-source-preview" className="break-words font-semibold">解析预览 · {preview.doc.title}</h3>
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm tabular-nums">
            {(['episodes', 'scenes', 'characters', 'dialogues'] as const).map((key, i) => <div key={key} className="flex gap-2"><dt className="text-[var(--drama-muted)]">{['分集', '分场', '角色', '台词'][i]}</dt><dd>{preview.stats[key]}</dd></div>)}
          </dl>
          <div className="text-sm leading-relaxed"><h4 className="font-semibold">复核提示</h4>
            {preview.warnings.length ? <ul className="mt-2 list-disc space-y-1 break-words pl-5">{preview.warnings.map((warning, i) => <li key={i}>{warning.replace(/^DRAMA_[A-Z0-9_]+:\s*/u, '')}</li>)}</ul>
              : <p className="mt-1 text-[var(--drama-muted)]">未发现结构警告，仍请核对场次和台词。</p>}
          </div>
          <details><summary className="cursor-pointer py-2 text-sm text-[var(--drama-gold)]">查看导入原文</summary>
            <pre aria-label="导入原文" tabIndex={0} className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--drama-ink)] p-3 font-sans text-sm leading-relaxed">{preview.doc.sourceScript?.originalText}</pre>
          </details>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="drama-btn drama-btn--primary" disabled={phase !== 'idle' || externalBusy || saveUnknown} onClick={() => void create()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}{saving ? '正在创建短剧' : '确认创建短剧'}
            </button>
            <span className="drama-label" role={saving ? 'status' : undefined}>{saving ? '正在保存项目，请稍候。' : '创建后可逐场校对，原始导入文本会保留。'}</span>
          </div>
        </section> : null}
      </form> : null}
    </section>
  );
}
