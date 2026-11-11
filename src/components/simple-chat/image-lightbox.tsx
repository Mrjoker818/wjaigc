"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getSafeRasterImageExtension, inferSafeRasterImageType } from "@/lib/media-validation";

interface ImageLightboxProps {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

export function ImageLightbox({ images, initialIndex, onClose }: ImageLightboxProps) {
  const boundedIndex = (value: number): number => Math.max(0, Math.min(images.length - 1, Number.isFinite(value) ? Math.trunc(value) : 0));
  const [index, setIndex] = useState(() => boundedIndex(initialIndex));
  const currentIndex = boundedIndex(index);
  const [downloading, setDownloading] = useState(false);
  const [copying, setCopying] = useState(false);
  const downloadingRef = useRef(false);
  const copyingRef = useRef(false);
  const mountedRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const [zoom, setZoom] = useState(1);

  const prev = useCallback(() => {
    setIndex(i => (i > 0 ? i - 1 : images.length - 1));
    setZoom(1);
  }, [images.length]);

  const next = useCallback(() => {
    setIndex(i => (i < images.length - 1 ? i + 1 : 0));
    setZoom(1);
  }, [images.length]);

  useEffect(() => {
    if (images.length === 0) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, prev, next]);

  const handleDownload = async (): Promise<void> => {
    if (downloadingRef.current) return;
    downloadingRef.current = true;
    setDownloading(true);
    const url = images[currentIndex];
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("IMAGE_DOWNLOAD_FAILED");
      const blob = await res.blob();
      const signature = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
      const extension = inferSafeRasterImageType(signature)?.extension
        ?? getSafeRasterImageExtension(blob.type)
        ?? (blob.type === "image/svg+xml" ? "svg" : null);
      if (!mountedRef.current) return;
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `image-${currentIndex + 1}${extension ? "." + extension : ""}`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      if (mountedRef.current) toast.error("下载失败");
    } finally {
      downloadingRef.current = false;
      if (mountedRef.current) setDownloading(false);
    }
  };

  const handleCopyLink = async (): Promise<void> => {
    if (copyingRef.current) return;
    copyingRef.current = true;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(images[currentIndex]);
      if (mountedRef.current) toast.success("链接已复制");
    } catch {
      if (mountedRef.current) toast.error("复制失败");
    } finally {
      copyingRef.current = false;
      if (mountedRef.current) setCopying(false);
    }
  };

  if (images.length === 0) return null;

  const controlClass = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50";
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined}
        className="!fixed !inset-2 !z-[200] !flex !h-auto !w-auto !max-w-none !translate-x-0 !translate-y-0 flex-col gap-2 overflow-hidden border-white/15 bg-black/95 !p-2 text-white sm:!max-w-none"
        onOpenAutoFocus={() => { returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={event => { event.preventDefault(); const target = returnFocusRef.current; if (target?.isConnected && target.getClientRects().length > 0) target.focus(); }}>
        <DialogTitle className="sr-only">图片预览</DialogTitle>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1" aria-label="图片工具栏">
          <button type="button" onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} className={controlClass} title="缩小" aria-label="缩小"><ZoomOut size={18} /></button>
          <span className="min-w-10 text-center text-xs tabular-nums text-white/80">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom(z => Math.min(4, z + 0.25))} className={controlClass} title="放大" aria-label="放大"><ZoomIn size={18} /></button>
          <button type="button" onClick={handleDownload} disabled={downloading} aria-busy={downloading} className={controlClass} title="下载" aria-label="下载"><Download size={18} /></button>
          <button type="button" onClick={handleCopyLink} disabled={copying} aria-busy={copying} className={controlClass} title="复制链接" aria-label="复制链接"><Copy size={18} /></button>
          <button type="button" onClick={onClose} className={controlClass} title="关闭 (Esc)" aria-label="关闭图片预览"><X size={18} /></button>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={images[currentIndex]} alt={`图片 ${currentIndex + 1}`} className="max-h-full max-w-full object-contain motion-safe:transition-transform"
            style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }} />
        </div>
        {images.length > 1 && <div className="flex shrink-0 items-center justify-between gap-2">
          <button type="button" onClick={prev} className={controlClass} aria-label="上一张图片"><ChevronLeft size={22} /></button>
          <span className="text-xs tabular-nums text-white/80">{currentIndex + 1} / {images.length}</span>
          <button type="button" onClick={next} className={controlClass} aria-label="下一张图片"><ChevronRight size={22} /></button>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
