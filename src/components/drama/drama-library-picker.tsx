'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { canvasLibraryItems, dramaLibraryItems, mergeLibrary, type LibraryItem, type LibrarySource } from '@/lib/drama/library';
import { listDramaProjects, loadDramaProject } from '@/lib/drama/workbench-client';
import { useDrama } from './drama-context';

/** Other dramas read for the library; each is one request, so the list stops here. */
const MAX_OTHER_DRAMAS = 8;

const FILTERS: Array<{ id: LibrarySource | 'all'; label: string }> = [
  { id: 'all', label: '全部' }, { id: 'canvas', label: '画布' }, { id: 'drama', label: '短剧' }, { id: 'chat', label: '对话' },
];
const SOURCE_LABEL: Record<LibrarySource, string> = { canvas: '画布', drama: '短剧', chat: '对话' };
const EMPTY_TEXT: Record<LibrarySource | 'all', string> = {
  all: '这个项目里还没有图片。在画布上生成或上传，或者在设定和镜头步骤里画几张，就能在这里选。',
  canvas: '这个项目的画布上还没有图片。在画布上生成或上传后，这里就能选。',
  drama: '这部和同项目其他短剧的设定图、关键帧会出现在这里。',
  chat: '从对话发来剧本时附带的图片会出现在这里。',
};

/**
 * Picks an image the project already has: canvas pictures, other dramas' bible images and keyframes, images sent from chat.
 * Picking costs nothing; the chosen address is used as is.
 */
export function DramaLibraryPicker({ open, onOpenChange, title, onPick }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onPick: (item: LibraryItem) => void;
}) {
  const { doc, dramaId, projectId, canvasMedia } = useDrama();
  const [filter, setFilter] = useState<LibrarySource | 'all'>('all');
  const [cache, setCache] = useState<{ projectId?: string; dramaId: string; items: LibraryItem[] } | null>(null);
  // Scope changes must hide old choices in this render, before the next read's effect runs.
  const others = cache?.projectId === projectId && cache?.dramaId === dramaId ? cache.items : null;

  useEffect(() => {
    if (!open) return;
    let live = true;
    (async () => {
      const list = (await listDramaProjects(projectId)).filter(item => item.id !== dramaId).slice(0, MAX_OTHER_DRAMAS);
      const records = await Promise.all(list.map(item => loadDramaProject(item.id).catch(() => null)));
      return records.flatMap(record => (record ? dramaLibraryItems(record.doc, record.title || record.doc.title) : []));
    })().then(
      items => { if (live) setCache({ projectId, dramaId, items }); },
      // The current drama and the canvas still fill the list when other dramas cannot be read.
      () => { if (live) setCache({ projectId, dramaId, items: [] }); },
    );
    return () => { live = false; };
  }, [open, projectId, dramaId]);

  const images = useMemo(() => mergeLibrary(
    canvasLibraryItems(canvasMedia ?? []), dramaLibraryItems(doc, '本片'), others ?? [],
  ).filter(item => item.kind === 'image'), [canvasMedia, doc, others]);
  const shown = filter === 'all' ? images : images.filter(item => item.source === filter);
  const count = (id: LibrarySource | 'all') => (id === 'all' ? images.length : images.filter(item => item.source === id).length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="drama-root flex max-h-[85dvh] flex-col gap-3 border-[var(--drama-line)] p-4 motion-reduce:animate-none sm:max-w-2xl">
        <DialogTitle className="pr-8 font-serif text-base">{title}</DialogTitle>
        <DialogDescription className="drama-label">选中的图直接拿来用，不扣积分。</DialogDescription>
        <div className="flex flex-wrap gap-1" role="group" aria-label="素材来源">
          {FILTERS.map(item => (
            <button key={item.id} type="button" className="drama-btn min-h-8 px-2 text-xs" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
              {item.label} <span className="font-mono opacity-70">{count(item.id)}</span>
            </button>
          ))}
          {others === null ? (
            <span role="status" className="drama-label ml-auto flex items-center gap-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />正在读取同项目的其他短剧
            </span>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length ? (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {shown.map(item => (
                <li key={item.url}>
                  <button type="button" className="group flex w-full flex-col gap-1 rounded-md text-left" aria-label={`选用 ${item.name}`}
                    onClick={() => { onPick(item); onOpenChange(false); }}>
                    <span className="relative block aspect-square w-full overflow-hidden rounded-md border border-[var(--drama-line)] bg-[var(--drama-ink)] group-hover:border-[var(--drama-gold)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                      <span className="absolute left-1 top-1 rounded bg-black/65 px-1 font-mono text-[10px]">{SOURCE_LABEL[item.source]}</span>
                    </span>
                    <span className="truncate text-xs text-[var(--drama-muted)] group-hover:text-[var(--drama-paper)]">{item.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="drama-label py-8 text-center">{others === null && filter === 'drama' ? '正在读取' : EMPTY_TEXT[filter]}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
