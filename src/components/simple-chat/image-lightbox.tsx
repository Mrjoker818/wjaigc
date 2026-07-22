"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";

interface ImageLightboxProps {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

export function ImageLightbox({ images, initialIndex, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
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
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, prev, next]);

  const handleDownload = async () => {
    const url = images[index];
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `image-${index + 1}.png`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error("下载失败");
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(images[index]);
      toast.success("链接已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  if (images.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* 工具栏 */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
          className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"
          title="缩小"
        >
          <ZoomOut size={18} />
        </button>
        <span className="min-w-12 text-center text-xs text-white/80">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom(z => Math.min(4, z + 0.25))}
          className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"
          title="放大"
        >
          <ZoomIn size={18} />
        </button>
        <button onClick={handleDownload} className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20" title="下载">
          <Download size={18} />
        </button>
        <button onClick={handleCopyLink} className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20" title="复制链接">
          <Copy size={18} />
        </button>
        <button onClick={onClose} className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20" title="关闭 (Esc)">
          <X size={18} />
        </button>
      </div>

      {/* 计数 */}
      {images.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
          {index + 1} / {images.length}
        </div>
      )}

      {/* 左右切换 */}
      {images.length > 1 && (
        <>
          <button
            onClick={e => { e.stopPropagation(); prev(); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); next(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}

      {/* 图片 */}
      <div className="max-h-[85vh] max-w-[85vw] overflow-auto" onClick={e => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[index]}
          alt={`图片 ${index + 1}`}
          className="transition-transform"
          style={{ transform: `scale(${zoom})`, transformOrigin: "center center", maxWidth: "100%", maxHeight: "85vh" }}
        />
      </div>
    </div>
  );
}
