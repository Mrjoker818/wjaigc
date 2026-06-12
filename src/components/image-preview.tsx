'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Download, Copy, X, ZoomIn, ZoomOut, Check, FileImage, FileCode, Loader2, FileJson, Box, Eye, RotateCcw, Pencil } from 'lucide-react';
import { exportAsPSD } from '@/lib/psd-export';
import { downloadSVG } from '@/lib/svg-export';
import type { CanvasImage } from './infinite-canvas';

type ViewMode = '2d' | '3d';
type ThreeDMode = 'cube' | 'sphere';

interface ImagePreviewProps {
  image: CanvasImage | null;
  onClose: () => void;
  themeStyle?: 'gold' | 'monochrome';
  onEditImage?: (image: CanvasImage) => void;
}

export function ImagePreview({ image, onClose, themeStyle = 'gold', onEditImage }: ImagePreviewProps) {
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [threeDMode, setThreeDMode] = useState<ThreeDMode>('cube');

  // 3D viewer state
  const [rotX, setRotX] = useState(-15);
  const [rotY, setRotY] = useState(25);
  const [isDragging3D, setIsDragging3D] = useState(false);
  const [autoRotate3D, setAutoRotate3D] = useState(true);
  const lastPos3D = useRef({ x: 0, y: 0 });
  const animRef3D = useRef<number>(0);
  const rotRef3D = useRef({ x: -15, y: 25 });
  const sphereCanvasRef = useRef<HTMLCanvasElement>(null);
  const imgDataRef = useRef<{ data: Uint8ClampedArray; w: number; h: number } | null>(null);

  // Preload image pixel data for sphere rendering
  useEffect(() => {
    if (viewMode !== '3d' || !image) return;
    imgDataRef.current = null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        const maxDim = 400;
        const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        imgDataRef.current = { data, w, h };
      } catch {
        // CORS fallback
        fetch('/api/cache-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: image!.url }),
        })
          .then(r => r.text())
          .then(dataUrl => {
            const img2 = new Image();
            img2.onload = () => {
              const c = document.createElement('canvas');
              const maxDim = 400;
              const scale = Math.min(maxDim / img2.width, maxDim / img2.height, 1);
              const w = Math.round(img2.width * scale);
              const h = Math.round(img2.height * scale);
              c.width = w;
              c.height = h;
              const ctx = c.getContext('2d');
              if (!ctx) return;
              ctx.drawImage(img2, 0, 0, w, h);
              const data = ctx.getImageData(0, 0, w, h).data;
              imgDataRef.current = { data, w, h };
            };
            img2.src = dataUrl;
          })
          .catch(() => {});
      }
    };
    img.onerror = () => {
      fetch('/api/cache-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: image!.url }),
      })
        .then(r => r.text())
        .then(dataUrl => {
          const img2 = new Image();
          img2.onload = () => {
            const c = document.createElement('canvas');
            const maxDim = 400;
            const scale = Math.min(maxDim / img2.width, maxDim / img2.height, 1);
            const w = Math.round(img2.width * scale);
            const h = Math.round(img2.height * scale);
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(img2, 0, 0, w, h);
            const data = ctx.getImageData(0, 0, w, h).data;
            imgDataRef.current = { data, w, h };
          };
          img2.src = dataUrl;
        })
        .catch(() => {});
    };
    img.src = image!.url;
  }, [viewMode, image?.url]);

  // Auto rotation
  useEffect(() => {
    if (viewMode !== '3d') return;
    if (!autoRotate3D || isDragging3D) {
      if (animRef3D.current) cancelAnimationFrame(animRef3D.current);
      return;
    }
    const animate = () => {
      rotRef3D.current.y += 0.3;
      setRotY(rotRef3D.current.y);
      animRef3D.current = requestAnimationFrame(animate);
    };
    animRef3D.current = requestAnimationFrame(animate);
    return () => {
      if (animRef3D.current) cancelAnimationFrame(animRef3D.current);
    };
  }, [viewMode, autoRotate3D, isDragging3D]);

  // Sphere canvas rendering
  useEffect(() => {
    if (viewMode !== '3d' || threeDMode !== 'sphere') return;
    const canvas = sphereCanvasRef.current;
    if (!canvas) return;
    const src = imgDataRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!src) {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#d4af37';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('加载图片中...', canvas.width / 2, canvas.height / 2);
      return;
    }

    const cw = canvas.width;
    const ch = canvas.height;
    const centerX = cw / 2;
    const centerY = ch / 2;
    const radius = Math.min(cw, ch) * 0.38;
    const imgW = src.w;
    const imgH = src.h;
    const srcData = src.data;

    // Lower resolution rendering for speed
    const rs = 0.4;
    const rw = Math.round(cw * rs);
    const rh = Math.round(ch * rs);
    const offCanvas = document.createElement('canvas');
    offCanvas.width = rw;
    offCanvas.height = rh;
    const offCtx = offCanvas.getContext('2d');
    if (!offCtx) return;
    const imageData = offCtx.createImageData(rw, rh);
    const data = imageData.data;
    const rcx = rw / 2;
    const rcy = rh / 2;
    const rr = radius * rs;

    const rotYRad = (rotRef3D.current.y * Math.PI) / 180;
    const rotXRad = (rotRef3D.current.x * Math.PI) / 180;
    const cosY = Math.cos(-rotYRad);
    const sinY = Math.sin(-rotYRad);
    const cosX = Math.cos(-rotXRad);
    const sinX = Math.sin(-rotXRad);

    for (let py = 0; py < rh; py++) {
      for (let px = 0; px < rw; px++) {
        const nx = (px - rcx) / rr;
        const ny = (py - rcy) / rr;
        const r2 = nx * nx + ny * ny;
        if (r2 > 1) continue;
        const nz = Math.sqrt(Math.max(0, 1 - r2));

        const rx = nx * cosY + nz * sinY;
        let rz = -nx * sinY + nz * cosY;
        let ry = ny;
        const ry2 = ry * cosX - rz * sinX;
        const rz2 = ry * sinX + rz * cosX;
        ry = ry2; rz = rz2;
        if (rz > 0) continue;

        const phi = Math.acos(Math.max(-1, Math.min(1, ry)));
        const theta = Math.atan2(rx, -rz);
        let u = (theta / Math.PI + 1) / 2;
        const v = phi / Math.PI;
        u = ((u % 1) + 1) % 1;

        const sx = Math.min(Math.floor(u * imgW), imgW - 1);
        const sy = Math.min(Math.floor(v * imgH), imgH - 1);
        const si = (sy * imgW + sx) * 4;
        const light = 0.35 + 0.65 * Math.max(0, nz);
        const di = (py * rw + px) * 4;
        data[di] = Math.round(srcData[si] * light);
        data[di + 1] = Math.round(srcData[si + 1] * light);
        data[di + 2] = Math.round(srcData[si + 2] * light);
        data[di + 3] = 255;
      }
    }

    offCtx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(offCanvas, 0, 0, cw, ch);

    // Grid
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(212,175,55,0.15)';
    ctx.lineWidth = 1;
    for (let lat = -60; lat <= 60; lat += 30) {
      const lr = (lat * Math.PI) / 180;
      const lR = radius * Math.cos(lr);
      const lY = centerY - radius * Math.sin(lr);
      ctx.beginPath();
      ctx.ellipse(centerX, lY, lR, lR * 0.15, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let lon = 0; lon < 180; lon += 30) {
      const lonRad = ((lon + rotRef3D.current.y) * Math.PI) / 180;
      ctx.beginPath();
      for (let t = 0; t <= Math.PI; t += 0.05) {
        const lx = centerX + radius * Math.sin(t) * Math.cos(lonRad);
        const ly = centerY - radius * Math.cos(t);
        if (t === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Camera indicator
    const ca = (rotRef3D.current.y * Math.PI) / 180;
    const cx2 = centerX + (radius + 30) * Math.cos(ca);
    const cy2 = centerY;
    ctx.beginPath(); ctx.arc(cx2, cy2, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#d4af37'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx2, cy2, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0a0a'; ctx.fill();
  }, [viewMode, threeDMode, rotX, rotY]);

  // 3D drag handlers
  const handle3DPointerDown = useCallback((e: React.PointerEvent) => {
    setIsDragging3D(true);
    setAutoRotate3D(false);
    lastPos3D.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handle3DPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging3D) return;
    const dx = e.clientX - lastPos3D.current.x;
    const dy = e.clientY - lastPos3D.current.y;
    lastPos3D.current = { x: e.clientX, y: e.clientY };
    rotRef3D.current = {
      x: Math.max(-90, Math.min(90, rotRef3D.current.x - dy * 0.5)),
      y: rotRef3D.current.y + dx * 0.5,
    };
    setRotX(rotRef3D.current.x);
    setRotY(rotRef3D.current.y);
  }, [isDragging3D]);

  const handle3DPointerUp = useCallback(() => {
    setIsDragging3D(false);
  }, []);

  // Early return after all hooks
  if (!image) return null;

  const getViewAngle = () => {
    const y = ((rotRef3D.current.y % 360) + 360) % 360;
    const x = rotRef3D.current.x;
    if (x < -45) return '俯视';
    if (x > 45) return '仰视';
    if (y < 45 || y > 315) return '正面';
    if (y >= 45 && y < 135) return '右侧';
    if (y >= 135 && y < 225) return '背面';
    return '左侧';
  };

  const handleDownload = async (format: 'png' | 'svg' | 'psd') => {
    setExporting(format);
    try {
      if (format === 'png') {
        const response = await fetch(image.url);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${image.prompt?.substring(0, 30) || 'image'}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else if (format === 'svg') {
        await downloadSVG(image.url, 'pro');
      } else if (format === 'psd') {
        const { downloadPSD } = await import('@/lib/psd-export');
        await downloadPSD(image.url, image.prompt?.substring(0, 30) || 'Image', 'pro');
      }
    } catch (error) {
      console.error(`Export as ${format} failed:`, error);
    } finally {
      setExporting(null);
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(image.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  const isMonochrome = themeStyle === 'monochrome';
  const textColor = isMonochrome ? 'text-gray-900' : 'text-white';
  const textMutedColor = isMonochrome ? 'text-gray-500' : 'text-white/80';
  const borderColor = isMonochrome ? 'border-gray-200' : 'border-gray-700';
  const bgColor = isMonochrome ? 'bg-white' : 'bg-[#0a0a0a]';
  const accentColor = isMonochrome ? 'text-blue-600' : 'text-[#d4af37]';
  const accentBg = isMonochrome ? 'bg-blue-50' : 'bg-[#d4af37]/10';
  const accentBorder = isMonochrome ? 'border-blue-300' : 'border-[#d4af37]/30';
  const btnBg = isMonochrome ? 'bg-gray-50 hover:bg-gray-100' : 'bg-[#141414] hover:bg-[#1a1a1a]';
  const btnText = isMonochrome ? 'text-gray-700' : 'text-white/80';
  const overlayBg = isMonochrome ? 'from-white/90 to-white/60' : 'from-black/80 to-transparent';

  // Cube dimensions
  const cubeSize = 200;
  const half = cubeSize / 2;

  const cubeFace = (transform: string, content: React.ReactNode, extra: React.CSSProperties = {}): React.ReactNode => (
    <div
      key={transform}
      style={{
        position: 'absolute',
        width: cubeSize,
        height: cubeSize,
        backfaceVisibility: 'hidden',
        transform,
        borderRadius: '4px',
        overflow: 'hidden',
        ...extra,
      }}
    >
      {content}
    </div>
  );

  const sideContent = (label: string): React.ReactNode => (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #1a1a1a, #0d0d0d)',
        border: '2px solid #333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '4px',
      }}
    >
      <span style={{ color: '#555', fontSize: '14px' }}>{label}</span>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className={`relative ${viewMode === '3d' ? 'w-[700px] h-[600px]' : 'max-w-[95vw] max-h-[95vh]'} ${bgColor} ${borderColor} border rounded-xl overflow-hidden shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-3 bg-gradient-to-b ${overlayBg}`}>
          {/* Left: View mode + Zoom */}
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-0.5 p-0.5 rounded-lg ${isMonochrome ? 'bg-gray-100' : 'bg-[#1a1a1a]'} border ${borderColor}`}>
              <button
                onClick={() => setViewMode('2d')}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                  viewMode === '2d' ? `${accentBg} ${accentColor}` : `${btnText} hover:${textColor}`
                }`}
              >
                <Eye className="h-3 w-3" />
                2D
              </button>
              <button
                onClick={() => setViewMode('3d')}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                  viewMode === '3d' ? `${accentBg} ${accentColor}` : `${btnText} hover:${textColor}`
                }`}
              >
                <Box className="h-3 w-3" />
                3D
              </button>
            </div>

            {viewMode === '2d' && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setZoom(z => Math.min(3, z + 0.25))}
                  className={`p-1.5 ${btnText} hover:${textColor} ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/10'} rounded-lg transition-all`}
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <span className={`${accentColor} text-xs font-mono min-w-[40px] text-center`}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}
                  className={`p-1.5 ${btnText} hover:${textColor} ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/10'} rounded-lg transition-all`}
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Right: Export + Close */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyUrl}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs ${btnText} hover:${textColor} ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/10'} rounded-lg transition-all`}
            >
              {copied ? <Check className={`h-3 w-3 ${accentColor}`} /> : <Copy className="h-3 w-3" />}
              {copied ? '已复制' : '复制链接'}
            </button>

            {onEditImage && image && (
              <button
                onClick={() => onEditImage(image)}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs ${isMonochrome ? 'text-blue-700 hover:bg-blue-50' : 'text-[#d4af37] hover:bg-[#d4af37]/10'} rounded-lg transition-all`}
              >
                <Pencil className="h-3 w-3" />
                语言修图
              </button>
            )}

            <div className={`h-4 w-px ${borderColor}`} />

            <div className="flex items-center gap-1">
              <span className={`text-xs ${textMutedColor} mr-1 uppercase tracking-wider`}>导出</span>
              <button onClick={() => handleDownload('png')} disabled={exporting !== null} className={`flex items-center gap-1 px-2 py-1 text-xs ${btnBg} ${btnText} hover:${textColor} ${borderColor} border rounded-md transition-all disabled:opacity-50`}>
                {exporting === 'png' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileImage className="h-3 w-3" />}
                PNG
              </button>
              <button onClick={() => handleDownload('svg')} disabled={exporting !== null} className={`flex items-center gap-1 px-2 py-1 text-xs ${btnBg} ${btnText} hover:${textColor} ${borderColor} border rounded-md transition-all disabled:opacity-50`}>
                {exporting === 'svg' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileCode className="h-3 w-3" />}
                SVG
              </button>
              <button onClick={() => handleDownload('psd')} disabled={exporting !== null} className={`flex items-center gap-1 px-2 py-1 text-xs ${isMonochrome ? 'bg-blue-50 border-blue-200 hover:bg-blue-100' : 'bg-[#d4af37]/10 border-[#d4af37]/30 hover:bg-[#d4af37]/20'} ${isMonochrome ? 'text-blue-700' : 'text-[#d4af37]'} border rounded-md transition-all disabled:opacity-50`}>
                {exporting === 'psd' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileJson className="h-3 w-3" />}
                PSD
              </button>
            </div>

            <div className={`h-4 w-px ${borderColor}`} />

            <button
              onClick={onClose}
              className={`p-1.5 ${btnText} hover:${textColor} ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/10'} rounded-lg transition-all`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 2D View */}
        {viewMode === '2d' && (
          <>
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                <div className={`animate-spin w-8 h-8 border-2 ${accentBorder} ${isMonochrome ? 'border-blue-600' : 'border-[#d4af37]'} border-t-transparent rounded-full`} />
              </div>
            )}
            <div className="overflow-auto pt-14 pb-16" style={{ maxHeight: '95vh' }}>
              <div
                style={{ transform: `scale(${zoom})`, transformOrigin: 'center center', transition: 'transform 0.2s ease' }}
                className="flex items-center justify-center min-h-[60vh]"
              >
                <img
                  src={image.url}
                  alt={image.prompt}
                  className="max-w-full max-h-[80vh] object-contain"
                  onLoad={() => setIsLoading(false)}
                  onError={() => setIsLoading(false)}
                  draggable={false}
                />
              </div>
            </div>
          </>
        )}

        {/* 3D View - INLINED, no dynamic import */}
        {viewMode === '3d' && (
          <div
            className="absolute inset-0 pt-12 pb-3 select-none"
            onPointerDown={handle3DPointerDown}
            onPointerMove={handle3DPointerMove}
            onPointerUp={handle3DPointerUp}
            onPointerLeave={handle3DPointerUp}
            style={{ cursor: isDragging3D ? 'grabbing' : 'grab' }}
          >
            {/* Mode switcher overlay */}
            <div className="absolute top-14 left-3 right-3 z-10 flex items-center gap-2">
              <div className="flex bg-black/60 backdrop-blur-sm rounded-lg p-0.5 border border-[#333]">
                <button
                  onClick={(e) => { e.stopPropagation(); setThreeDMode('cube'); }}
                  className={`px-3 py-1 text-xs rounded-md transition-all ${
                    threeDMode === 'cube' ? 'bg-[#d4af37] text-black font-semibold' : 'text-[#999] hover:text-white'
                  }`}
                >
                  主体
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setThreeDMode('sphere'); }}
                  className={`px-3 py-1 text-xs rounded-md transition-all ${
                    threeDMode === 'sphere' ? 'bg-[#d4af37] text-black font-semibold' : 'text-[#999] hover:text-white'
                  }`}
                >
                  摄像头
                </button>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  rotRef3D.current = { x: -15, y: 25 };
                  setRotX(-15);
                  setRotY(25);
                  setAutoRotate3D(true);
                }}
                className="p-1.5 rounded-md bg-black/60 backdrop-blur-sm border border-[#333] text-[#999] hover:text-[#d4af37] transition-colors"
                title="重置视角"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>

              <div className="ml-auto px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-[#333] text-xs text-[#d4af37]">
                {getViewAngle()}
              </div>
            </div>

            {/* 3D Content */}
            <div className="w-full h-full flex items-center justify-center">
              {threeDMode === 'cube' ? (
                /* CSS 3D Cube */
                <div style={{ perspective: '800px', perspectiveOrigin: '50% 50%' }}>
                  <div
                    style={{
                      width: cubeSize,
                      height: cubeSize,
                      position: 'relative',
                      transformStyle: 'preserve-3d',
                      transform: `rotateX(${rotX}deg) rotateY(${rotY}deg)`,
                      transition: isDragging3D ? 'none' : 'transform 0.1s ease-out',
                    }}
                  >
                    {/* Front - main image */}
                    {cubeFace(`translateZ(${half}px)`,
                      <img src={image.url} alt="front" crossOrigin="anonymous" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />,
                      { border: '2px solid #d4af37' }
                    )}
                    {/* Back */}
                    {cubeFace(`rotateY(180deg) translateZ(${half}px)`, sideContent('背面'))}
                    {/* Right */}
                    {cubeFace(`rotateY(90deg) translateZ(${half}px)`, sideContent('右侧'))}
                    {/* Left */}
                    {cubeFace(`rotateY(-90deg) translateZ(${half}px)`, sideContent('左侧'))}
                    {/* Top */}
                    {cubeFace(`rotateX(90deg) translateZ(${half}px)`, sideContent('顶部'))}
                    {/* Bottom */}
                    {cubeFace(`rotateX(-90deg) translateZ(${half}px)`, sideContent('底部'))}
                  </div>
                </div>
              ) : (
                /* Sphere - Canvas 2D */
                <canvas
                  ref={sphereCanvasRef}
                  width={660}
                  height={520}
                  style={{ maxWidth: '100%', maxHeight: '100%' }}
                />
              )}
            </div>

            {/* Bottom hint */}
            <div className="absolute bottom-3 left-3 right-3 z-10 text-center">
              <p className="text-xs text-[#666]">
                {threeDMode === 'cube'
                  ? '左键拖动旋转立方体，查看主体各角度'
                  : '左键拖动调整摄像头环绕角度'}
              </p>
            </div>

            {isDragging3D && (
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-[#d4af37]/20 border border-[#d4af37]/40 text-xs text-[#d4af37]">
                旋转中...
              </div>
            )}
          </div>
        )}

        {/* Footer (only in 2D mode) */}
        {viewMode === '2d' && (
          <div className={`absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t ${overlayBg}`}>
            <p className={`${textMutedColor} text-xs line-clamp-2 leading-relaxed`}>{image.prompt}</p>
            <div className={`flex items-center justify-between mt-1.5 text-xs ${isMonochrome ? 'text-gray-400' : 'text-white/40'} font-mono`}>
              <span>{image.createdAt ? new Date(image.createdAt).toLocaleString('zh-CN') : ''}</span>
              <span>{Math.round(image.width)} x {Math.round(image.height)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
