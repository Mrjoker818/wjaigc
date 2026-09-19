'use client';

import { Download, X } from 'lucide-react';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CanvasSharePublicItem } from '@/lib/canvas-share/types';

interface SharedCanvasMediaProps {
  item: CanvasSharePublicItem;
  source: string;
  onError(): void;
  className?: string;
  controls?: boolean;
}

function mediaAlt(item: CanvasSharePublicItem): string {
  return item.display.altText ?? item.display.label ?? '共享画布内容';
}

export function SharedCanvasMedia({
  item,
  source,
  onError,
  className,
  controls = false,
}: SharedCanvasMediaProps): React.ReactElement {
  if (item.assetKind === 'video') {
    return (
      <video
        src={source}
        className={className}
        playsInline
        muted
        controls={controls}
        preload="metadata"
        onError={onError}
        aria-label={mediaAlt(item)}
      />
    );
  }
  return (
    <img
      src={source}
      className={className}
      alt={mediaAlt(item)}
      draggable={false}
      decoding="async"
      onError={onError}
    />
  );
}

interface SharedMediaPreviewProps {
  item: CanvasSharePublicItem;
  source: string;
  downloadPath?: string;
  returnFocusTo: HTMLElement | null;
  onClose(): void;
  onError(): void;
}

export function SharedMediaPreview({
  item,
  source,
  downloadPath,
  returnFocusTo,
  onClose,
  onError,
}: SharedMediaPreviewProps): React.ReactElement {
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        aria-label="媒体预览"
        data-shared-preview-interactive
        onCloseAutoFocus={event => {
          event.preventDefault();
          returnFocusTo?.focus();
        }}
        className="flex max-h-[calc(100dvh-1.5rem)] max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden rounded-2xl border-border bg-card p-0 shadow-dialog motion-reduce:animate-none sm:max-h-[calc(100dvh-3rem)] sm:max-w-6xl"
      >
        <DialogTitle className="sr-only">媒体预览</DialogTitle>
        <DialogDescription className="sr-only">
          查看共享画布中的媒体内容，可使用 Escape 关闭预览。
        </DialogDescription>
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-3 sm:px-4">
          <p className="min-w-0 truncate text-sm font-medium text-card-foreground">
            {item.display.label ?? '共享画布内容'}
          </p>
          <div className="flex items-center gap-2">
            {downloadPath ? (
              <a
                href={downloadPath}
                data-shared-preview-interactive
                className="inline-flex h-11 min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-foreground outline-none transition-colors hover:bg-toolbar-hover focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                aria-label="下载预览内容"
                title="下载预览内容"
              >
                <Download className="h-5 w-5" aria-hidden="true" />
              </a>
            ) : null}
            <DialogClose asChild>
              <button
                type="button"
                data-shared-preview-interactive
                className="inline-flex h-11 min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-foreground outline-none transition-colors hover:bg-toolbar-hover focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                aria-label="关闭预览"
                title="关闭预览"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </DialogClose>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-black/40 p-3 sm:p-6">
          <SharedCanvasMedia
            item={item}
            source={source}
            onError={onError}
            controls={item.assetKind === 'video'}
            className="max-h-[calc(100dvh-8rem)] max-w-full object-contain sm:max-h-[calc(100dvh-10rem)]"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
