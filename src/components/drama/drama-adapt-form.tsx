'use client';

import { useState, type FormEvent } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import { ADAPT_CHUNK_CHARS, ADAPT_MAX_CHARS, ADAPT_MIN_CHARS } from '@/lib/drama/adapt';
import type { AdaptRequest } from '@/lib/drama/workbench-client';
import { DIRECTOR_STYLE_LIST, type DirectorStyle } from '@/lib/video-director/director-styles';
import { useTaskModelCatalog } from '@/hooks/use-task-model-catalog';
import { DRAMA_RATIOS } from './drama-idea-form';

/** Paste a novel or a long story; the server adapts it into one episode per part. */
export function DramaAdaptForm({ busy, progress, onAdapt }: {
  busy: string | null;
  progress: { value: number; label?: string } | null;
  onAdapt: (input: AdaptRequest) => void;
}) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState<DirectorStyle>('cinematic');
  const [aspectRatio, setAspectRatio] = useState<string>('9:16');
  const { models, loading, error } = useTaskModelCatalog('chat');
  const [modelKey, setModelKey] = useState('');
  const model = models.find(item => `${item.providerId}::${item.id}` === modelKey);
  const missingModel = Boolean(modelKey && !model);
  const modelReady = !loading && !error && Boolean(model);
  const length = text.trim().length;
  const episodes = Math.max(1, Math.ceil(length / ADAPT_CHUNK_CHARS));
  const valid = length >= ADAPT_MIN_CHARS && length <= ADAPT_MAX_CHARS;
  const adapting = busy === '改编小说';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid && !busy && modelReady && model) onAdapt({ text: text.trim(), ...(title.trim() ? { title: title.trim() } : {}), style, aspectRatio, episodeDurationSec: 60,
      planner: { providerId: model.providerId, modelId: model.id } });
  };

  return (
    <form onSubmit={submit} className="drama-panel flex flex-col gap-4 p-4" aria-labelledby="drama-adapt-title">
      <div className="flex flex-col gap-1">
        <h2 id="drama-adapt-title" className="flex items-center gap-2 text-sm font-semibold"><BookOpen className="h-4 w-4" />改编小说或长文</h2>
        <p className="drama-label">粘贴原文，按段改编成连续的分集，角色和场景在各集之间沿用。</p>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="drama-label">原文</span>
        <textarea className="drama-input min-h-40 resize-y leading-relaxed" maxLength={ADAPT_MAX_CHARS} value={text}
          onChange={event => setText(event.target.value)} placeholder="粘贴小说章节或故事全文" />
      </label>
      <p className="drama-label tabular-nums" aria-live="polite">
        {length.toLocaleString('zh-CN')} / {ADAPT_MAX_CHARS.toLocaleString('zh-CN')} 字
        {length >= ADAPT_MIN_CHARS ? ` · 约改编成 ${episodes} 集，每集约 1 分钟写完` : ` · 至少 ${ADAPT_MIN_CHARS} 字`}
      </p>
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="drama-label">改编模型</span>
        <select className="drama-input min-w-0 max-w-full" value={modelKey} aria-invalid={missingModel || undefined}
          disabled={loading || Boolean(error) || Boolean(busy)} onChange={event => setModelKey(event.target.value)}>
          <option value="">{loading ? '正在读取授权模型…' : '请选择已授权的编剧模型'}</option>
          {missingModel ? <option value={modelKey} disabled>原模型已不可用，请重新选择</option> : null}
          {models.map(item => <option key={`${item.providerId}::${item.id}`} value={`${item.providerId}::${item.id}`}>
            {item.displayName || item.name || item.id} · {item.providerName || item.providerId}
          </option>)}
        </select>
      </label>
      {error || missingModel || (!loading && models.length === 0) ? <p role="status" className="text-xs text-[var(--drama-red)]">
        {error ? '模型目录读取失败，请刷新后重试' : missingModel ? '原模型已不可用，请重新选择；不会自动切换供应商或模型' : '还没有可用的授权对话模型，请联系管理员配置'}
      </p> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="drama-label">片名（可不填）</span>
          <input className="drama-input" maxLength={200} value={title} onChange={event => setTitle(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="drama-label">视觉风格</span>
          <select className="drama-input" value={style} onChange={event => setStyle(event.target.value as DirectorStyle)}>
            {DIRECTOR_STYLE_LIST.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="drama-label mb-1.5">画面比例</legend>
          <div className="flex gap-2">
            {DRAMA_RATIOS.map(ratio => (
              <button key={ratio} type="button" className="drama-btn tabular-nums" aria-pressed={aspectRatio === ratio} onClick={() => setAspectRatio(ratio)}>{ratio}</button>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="drama-btn drama-btn--primary" disabled={!valid || Boolean(busy) || !modelReady}>
          {adapting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <BookOpen className="h-4 w-4" />}
          {adapting ? `正在改编 ${progress?.value ?? 0}%` : '开始改编'}
        </button>
        <span className="drama-label">{adapting && progress?.label ? progress.label : '改编不扣积分；可以离开页面，完成后剧本会出现在下面的列表里。'}</span>
      </div>
    </form>
  );
}
