'use client';

import { useState, type FormEvent } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { DIRECTOR_STYLE_LIST, type DirectorStyle } from '@/lib/video-director/director-styles';
import type { ScriptRequest } from '@/lib/drama/workbench-client';

export const DRAMA_RATIOS = ['9:16', '16:9', '1:1'] as const;
const LENGTHS = [30, 60, 90, 180];

/** "Start a drama from one sentence": the empty state of the workbench. */
export function DramaIdeaForm({ busy, error, initialIdea, onGenerate, onBlank }: {
  busy: string | null;
  error: string | null;
  /** Idea carried over from the canvas. */
  initialIdea?: string;
  onGenerate: (input: ScriptRequest) => void;
  onBlank: (input: ScriptRequest) => void;
}) {
  const [idea, setIdea] = useState(initialIdea ?? '');
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState<DirectorStyle>('cinematic');
  const [aspectRatio, setAspectRatio] = useState<string>('9:16');
  const [length, setLength] = useState(60);
  const input = (): ScriptRequest => ({
    idea: idea.trim(), ...(title.trim() ? { title: title.trim() } : {}), style, aspectRatio, episodeCount: 1, episodeDurationSec: length,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (idea.trim() && !busy) onGenerate(input());
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" aria-labelledby="drama-start-title">
      <div className="flex flex-col gap-2">
        <h1 id="drama-start-title" className="text-2xl font-bold sm:text-3xl">用一句话开始一部短剧</h1>
        <p className="text-sm text-[var(--drama-muted)]">剧本助手会写出分场剧本、角色和场景，之后你可以逐场拆镜头、生成和重拍。</p>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="drama-label">这部短剧讲什么</span>
        <textarea
          className="drama-input min-h-28 resize-y leading-relaxed" maxLength={4000} required value={idea}
          onChange={event => setIdea(event.target.value)}
          placeholder="例如：外卖员在暴雨夜送错一份餐，却因此救下了被困在电梯里的前女友"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
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
      </div>
      <div className="flex flex-wrap gap-6">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="drama-label mb-1.5">画面比例</legend>
          <div className="flex gap-2">
            {DRAMA_RATIOS.map(ratio => (
              <button key={ratio} type="button" className="drama-btn tabular-nums" aria-pressed={aspectRatio === ratio} onClick={() => setAspectRatio(ratio)}>{ratio}</button>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="drama-label mb-1.5">单集时长</legend>
          <div className="flex gap-2">
            {LENGTHS.map(value => (
              <button key={value} type="button" className="drama-btn tabular-nums" aria-pressed={length === value} onClick={() => setLength(value)}>{value}s</button>
            ))}
          </div>
        </fieldset>
      </div>
      {error ? <p role="alert" className="text-sm text-[var(--drama-red)]">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="drama-btn drama-btn--primary" disabled={!idea.trim() || Boolean(busy)}>
          {busy === '生成剧本' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Sparkles className="h-4 w-4" />}
          {busy === '生成剧本' ? '正在写剧本，约需 1 分钟' : '生成剧本'}
        </button>
        <button type="button" className="drama-btn" disabled={!idea.trim() || Boolean(busy)} onClick={() => onBlank(input())}>自己写剧本</button>
        <span className="drama-label">生成剧本不扣积分；生成定妆图和镜头时按模型价格扣费。</span>
      </div>
    </form>
  );
}
