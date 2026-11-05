'use client';

import NextImage from 'next/image';
import React, { useId, useMemo, useState } from 'react';
import { Search, Image as ImageIcon } from 'lucide-react';
import type { PromptTemplate } from '@/lib/prompt-templates';

export type WorkflowLibraryTab = 'material' | 'prompts' | 'presets';
interface LibraryImage { id: string; url: string; name: string; description: string }
interface LibraryPreset { id: string; name: string; description: string; tags: string[]; nodeCount: number }
interface WorkflowLibraryContentProps {
  tab: WorkflowLibraryTab;
  images: readonly LibraryImage[];
  prompts: readonly PromptTemplate[];
  presets: readonly LibraryPreset[];
  onUseImage: (id: string) => void;
  onUsePrompt: (id: string) => void;
  onUsePreset: (id: string) => void;
}
const ACTION = 'flex min-h-11 w-full items-center justify-center rounded-md border border-border bg-muted px-3 py-2 text-sm font-medium text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

// Display only: callers retain asset validation, workflow transactions and storage.
export function WorkflowLibraryContent({ tab, images, prompts, presets, onUseImage, onUsePrompt, onUsePreset }: WorkflowLibraryContentProps): React.ReactElement {
  const searchId = useId();
  const [queries, setQueries] = useState<Record<WorkflowLibraryTab, string>>({ material: '', prompts: '', presets: '' });
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const query = queries[tab].trim().toLocaleLowerCase();
  const visibleImages = useMemo(() => images.filter(item => [item.name, item.description].some(value => value.toLocaleLowerCase().includes(query))), [images, query]);
  const visiblePrompts = useMemo(() => prompts.filter(item => [item.name, item.content, item.category, ...item.tags].some(value => value.toLocaleLowerCase().includes(query))), [prompts, query]);
  const visiblePresets = useMemo(() => presets.filter(item => [item.name, item.description, ...item.tags].some(value => value.toLocaleLowerCase().includes(query))), [presets, query]);
  const count = tab === 'material' ? visibleImages.length : tab === 'prompts' ? visiblePrompts.length : visiblePresets.length;
  const name = tab === 'material' ? '素材' : tab === 'prompts' ? '提示词' : '预设';
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 border-b border-border/20 p-3">
      <label htmlFor={searchId} className="sr-only">搜索{name}</label>
      <div className="relative">
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground" />
        <input id={searchId} value={queries[tab]} onChange={event => setQueries(previous => ({ ...previous, [tab]: event.target.value }))}
          placeholder={`搜索${name}...`} className="min-h-11 w-full min-w-0 rounded-md border border-border bg-muted py-2 pl-10 pr-3 text-base text-foreground placeholder:text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
      </div>
    </div>
    <div data-workflow-library-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
      <p className="mb-4 text-xs leading-5 text-foreground">{tab === 'material' ? '当前项目图片；插入时核对权限与版本。' : tab === 'prompts' ? '来自统一提示词库；使用后添加文本节点。' : '加载预设不会执行模型；已有内容时先确认替换。'}</p>
      {count === 0 ? <p role="status" className="py-6 text-center text-sm text-foreground">没有匹配的内容</p> : <div className="space-y-4">
        {tab === 'material' && visibleImages.map(image => <article key={image.id} className="min-w-0 space-y-2 border-b border-border/20 pb-4">
          {failedImages.has(image.id) ? <div className="flex h-28 items-center justify-center gap-2 rounded-md bg-muted text-sm text-foreground"><ImageIcon size={20} aria-hidden="true" />预览不可用</div>
            : <NextImage unoptimized width={256} height={112} src={image.url} alt={image.description || image.name} onError={() => setFailedImages(previous => new Set([...previous, image.id]))} className="h-28 w-full rounded-md bg-muted object-contain" />}
          <h3 className="break-words text-sm font-semibold leading-6 text-foreground">{image.description || image.name}</h3>
          <button type="button" aria-label={`添加素材 ${image.description || image.name}`} onClick={() => onUseImage(image.id)} className={ACTION}>添加为图片节点</button>
        </article>)}
        {tab === 'prompts' && visiblePrompts.map(prompt => <article key={prompt.id} className="min-w-0 space-y-2 border-b border-border/20 pb-4">
          <h3 className="break-words text-sm font-semibold leading-6 text-foreground">{prompt.name}</h3>
          <p className="line-clamp-3 break-words text-sm leading-6 text-foreground">{prompt.content}</p>
          <p className="break-words text-xs leading-5 text-foreground">{prompt.category}{prompt.tags.length ? ` · ${prompt.tags.join(' / ')}` : ''}</p>
          <button type="button" aria-label={`使用提示词 ${prompt.name}`} onClick={() => onUsePrompt(prompt.id)} className={ACTION}>添加为文本节点</button>
        </article>)}
        {tab === 'presets' && visiblePresets.map(preset => <article key={preset.id} className="min-w-0 space-y-2 border-b border-border/20 pb-4">
          <h3 className="break-words text-sm font-semibold leading-6 text-foreground">{preset.name}</h3>
          <p className="break-words text-sm leading-6 text-foreground">{preset.description}</p>
          <p className="text-xs leading-5 text-foreground">{preset.nodeCount} 个节点 · {preset.tags.join(' / ')}</p>
          <button type="button" aria-label={`加载预设 ${preset.name}`} onClick={() => onUsePreset(preset.id)} className={ACTION}>加载预设</button>
        </article>)}
      </div>}
    </div>
  </div>;
}
