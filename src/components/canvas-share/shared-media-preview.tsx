'use client';

import { useEffect, useRef } from 'react';
import { Download, X } from 'lucide-react';

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
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const focusTarget = returnFocusTo ?? document.activeElement;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (focusTarget instanceof HTMLElement) focusTarget.focus();
    };
  }, [onClose, returnFocusTo]);

  return (
    <div
      className="fixed inset-0 z-50 grid min-h-[100dvh] place-items-center bg-black/80 p-3 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-reduce:animate-none sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="媒体预览"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="关闭媒体预览背景"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-dialog sm:max-h-[calc(100dvh-3rem)]">
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-3 sm:px-4">
          <p className="min-w-0 truncate text-sm font-medium text-card-foreground">
            {item.display.label ?? '共享画布内容'}
          </p>
          <div className="flex items-center gap-2">
            {downloadPath ? (
              <a
                href={downloadPath}
                className="inline-flex h-11 min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-foreground outline-none transition-colors hover:bg-toolbar-hover focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                aria-label="下载预览内容"
                title="下载预览内容"
              >
                <Download className="h-5 w-5" aria-hidden="true" />
              </a>
            ) : null}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="inline-flex h-11 min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-foreground outline-none transition-colors hover:bg-toolbar-hover focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              aria-label="关闭预览"
              title="关闭预览"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
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
      </div>
    </div>
  );
}
