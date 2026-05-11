'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';

interface ThreeDViewerProps {
  imageUrl: string;
  mode: 'cube' | 'sphere';
  onModeChange: (mode: 'cube' | 'sphere') => void;
  className?: string;
}

export default function ThreeDViewer({ imageUrl, mode, onModeChange, className }: ThreeDViewerProps) {
  const [rotateX, setRotateX] = useState(-15);
  const [rotateY, setRotateY] = useState(25);
  const [isDragging, setIsDragging] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [autoRotate, setAutoRotate] = useState(true);
  const animationRef = useRef<number>(0);
  const rotRef = useRef({ x: -15, y: 25 });
  const sphereCanvasRef = useRef<HTMLCanvasElement>(null);
  const imgDataRef = useRef<{ img: HTMLImageElement; canvas: HTMLCanvasElement; data: Uint8ClampedArray; w: number; h: number } | null>(null);

  // Preload image and cache pixel data for sphere rendering
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      // Downscale for performance
      const maxDim = 400;
      const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      tempCanvas.width = w;
      tempCanvas.height = h;
      const ctx = tempCanvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      imgDataRef.current = { img, canvas: tempCanvas, data, w, h };
    };
    img.onerror = () => {
      fetch('/api/cache-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      })
        .then(r => r.text())
        .then(dataUrl => {
          const img2 = new Image();
          img2.onload = () => {
            const tempCanvas = document.createElement('canvas');
            const maxDim = 400;
            const scale = Math.min(maxDim / img2.width, maxDim / img2.height, 1);
            const w = Math.round(img2.width * scale);
            const h = Math.round(img2.height * scale);
            tempCanvas.width = w;
            tempCanvas.height = h;
            const ctx = tempCanvas.getContext('2d')!;
            ctx.drawImage(img2, 0, 0, w, h);
            const data = ctx.getImageData(0, 0, w, h).data;
            imgDataRef.current = { img: img2, canvas: tempCanvas, data, w, h };
          };
          img2.src = dataUrl;
        })
        .catch(() => {});
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Auto rotation
  useEffect(() => {
    if (!autoRotate || isDragging) {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      return;
    }
    const animate = () => {
      rotRef.current = {
        x: rotRef.current.x,
        y: rotRef.current.y + 0.3,
      };
      setRotateY(rotRef.current.y);
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [autoRotate, isDragging]);

  // Sphere rendering with lower resolution for speed
  useEffect(() => {
    if (mode !== 'sphere') return;
    const canvas = sphereCanvasRef.current;
    if (!canvas) return;
    const src = imgDataRef.current;
    if (!src) {
      // Image not loaded yet - draw placeholder
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#d4af37';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('加载中...', canvas.width / 2, canvas.height / 2);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const centerX = cw / 2;
    const centerY = ch / 2;
    const radius = Math.min(cw, ch) * 0.38;
    const imgW = src.w;
    const imgH = src.h;
    const srcData = src.data;

    // Use offscreen canvas at lower resolution for speed
    const renderScale = 0.5;
    const rw = Math.round(cw * renderScale);
    const rh = Math.round(ch * renderScale);
    const offCanvas = document.createElement('canvas');
    offCanvas.width = rw;
    offCanvas.height = rh;
    const offCtx = offCanvas.getContext('2d')!;
    const imageData = offCtx.createImageData(rw, rh);
    const data = imageData.data;

    const rCenterX = rw / 2;
    const rCenterY = rh / 2;
    const rRadius = radius * renderScale;

    const rotYRad = (rotRef.current.y * Math.PI) / 180;
    const rotXRad = (rotRef.current.x * Math.PI) / 180;
    const cosY = Math.cos(-rotYRad);
    const sinY = Math.sin(-rotYRad);
    const cosX = Math.cos(-rotXRad);
    const sinX = Math.sin(-rotXRad);

    for (let py = 0; py < rh; py++) {
      for (let px = 0; px < rw; px++) {
        const nx = (px - rCenterX) / rRadius;
        const ny = (py - rCenterY) / rRadius;
        const r2 = nx * nx + ny * ny;

        if (r2 > 1) continue;

        const nz = Math.sqrt(Math.max(0, 1 - r2));

        // Rotate around Y then X
        let rx = nx * cosY + nz * sinY;
        let rz = -nx * sinY + nz * cosY;
        let ry = ny;

        const ry2 = ry * cosX - rz * sinX;
        const rz2 = ry * sinX + rz * cosX;
        ry = ry2;
        rz = rz2;

        if (rz > 0) continue; // back face

        // Spherical coordinates
        const phi = Math.acos(Math.max(-1, Math.min(1, ry)));
        const theta = Math.atan2(rx, -rz);

        let u = (theta / Math.PI + 1) / 2;
        const v = phi / Math.PI;
        u = ((u % 1) + 1) % 1;

        const sx = Math.min(Math.floor(u * imgW), imgW - 1);
        const sy = Math.min(Math.floor(v * imgH), imgH - 1);
        const srcIdx = (sy * imgW + sx) * 4;

        // Diffuse lighting
        const light = 0.35 + 0.65 * Math.max(0, nz);

        const dstIdx = (py * rw + px) * 4;
        data[dstIdx] = Math.round(srcData[srcIdx] * light);
        data[dstIdx + 1] = Math.round(srcData[srcIdx + 1] * light);
        data[dstIdx + 2] = Math.round(srcData[srcIdx + 2] * light);
        data[dstIdx + 3] = 255;
      }
    }

    offCtx.putImageData(imageData, 0, 0);

    // Draw to main canvas scaled up
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(offCanvas, 0, 0, cw, ch);

    // Sphere outline
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Latitude/longitude grid
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.clip();

    ctx.strokeStyle = 'rgba(212,175,55,0.15)';
    ctx.lineWidth = 1;

    // Latitude lines
    for (let lat = -60; lat <= 60; lat += 30) {
      const latRad = (lat * Math.PI) / 180;
      const latR = radius * Math.cos(latRad);
      const latCY = centerY - radius * Math.sin(latRad);
      ctx.beginPath();
      ctx.ellipse(centerX, latCY, latR, latR * 0.15, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Longitude lines
    for (let lon = 0; lon < 180; lon += 30) {
      const lonRad = ((lon + rotRef.current.y) * Math.PI) / 180;
      ctx.beginPath();
      for (let t = 0; t <= Math.PI; t += 0.05) {
        const lx = centerX + radius * Math.sin(t) * Math.cos(lonRad);
        const ly = centerY - radius * Math.cos(t);
        if (t === 0) ctx.moveTo(lx, ly);
        else ctx.lineTo(lx, ly);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Camera indicator
    const camAngle = (rotRef.current.y * Math.PI) / 180;
    const camDist = radius + 35;
    const camX = centerX + camDist * Math.cos(camAngle);
    const camY = centerY - 5 * Math.sin(camAngle);
    
    // Camera FOV lines
    ctx.beginPath();
    ctx.moveTo(camX, camY);
    ctx.lineTo(centerX + radius * Math.cos(camAngle - 0.3), centerY - radius * 0.3);
    ctx.moveTo(camX, camY);
    ctx.lineTo(centerX + radius * Math.cos(camAngle + 0.3), centerY + radius * 0.3);
    ctx.strokeStyle = 'rgba(212,175,55,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Camera dot
    ctx.beginPath();
    ctx.arc(camX, camY, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#d4af37';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(camX, camY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0a0a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(camX, camY, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#d4af37';
    ctx.fill();

  }, [mode, rotateX, rotateY]);

  // Mouse handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setIsDragging(true);
    setAutoRotate(false);
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };

    rotRef.current = {
      x: Math.max(-90, Math.min(90, rotRef.current.x - dy * 0.5)),
      y: rotRef.current.y + dx * 0.5,
    };
    setRotateX(rotRef.current.x);
    setRotateY(rotRef.current.y);
  }, [isDragging]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // View angle label
  const getViewAngle = () => {
    const y = ((rotRef.current.y % 360) + 360) % 360;
    const x = rotRef.current.x;
    if (x < -45) return '俯视';
    if (x > 45) return '仰视';
    if (y < 45 || y > 315) return '正面';
    if (y >= 45 && y < 135) return '右侧';
    if (y >= 135 && y < 225) return '背面';
    return '左侧';
  };

  const cubeSize = 180;
  const halfCube = cubeSize / 2;

  const faceStyle = (transform: string): React.CSSProperties => ({
    position: 'absolute',
    width: cubeSize,
    height: cubeSize,
    backfaceVisibility: 'hidden',
    transform,
    borderRadius: '4px',
    overflow: 'hidden',
  });

  const sideFaceStyle = (transform: string, label: string): React.CSSProperties => ({
    ...faceStyle(transform),
    background: 'linear-gradient(135deg, #1a1a1a, #0d0d0d)',
    border: '2px solid #333',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  return (
    <div className={`relative w-full h-full select-none ${className || ''}`}>
      {/* Mode switcher */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-2">
        <div className="flex bg-black/60 backdrop-blur-sm rounded-lg p-0.5 border border-[#333]">
          <button
            onClick={() => onModeChange('cube')}
            className={`px-3 py-1 text-xs rounded-md transition-all ${
              mode === 'cube'
                ? 'bg-[#d4af37] text-black font-semibold'
                : 'text-[#999] hover:text-white'
            }`}
          >
            主体
          </button>
          <button
            onClick={() => onModeChange('sphere')}
            className={`px-3 py-1 text-xs rounded-md transition-all ${
              mode === 'sphere'
                ? 'bg-[#d4af37] text-black font-semibold'
                : 'text-[#999] hover:text-white'
            }`}
          >
            摄像头
          </button>
        </div>

        <button
          onClick={() => {
            rotRef.current = { x: -15, y: 25 };
            setRotateX(-15);
            setRotateY(25);
            setAutoRotate(true);
          }}
          className="ml-auto p-1.5 rounded-md bg-black/60 backdrop-blur-sm border border-[#333] text-[#999] hover:text-[#d4af37] transition-colors"
          title="重置视角"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      </div>

      {/* View angle indicator */}
      <div className="absolute top-3 right-16 z-10 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-[#333] text-xs text-[#d4af37]">
        {getViewAngle()}
      </div>

      {/* 3D Content */}
      <div
        className="w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {mode === 'cube' ? (
          /* CSS 3D Cube */
          <div style={{ perspective: '800px', perspectiveOrigin: '50% 50%' }}>
            <div
              style={{
                width: cubeSize,
                height: cubeSize,
                position: 'relative',
                transformStyle: 'preserve-3d',
                transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
              }}
            >
              {/* Front - main image */}
              <div style={{ ...faceStyle(`translateZ(${halfCube}px)`), border: '2px solid #d4af37' }}>
                <img
                  src={imageUrl}
                  alt="front"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  crossOrigin="anonymous"
                />
              </div>

              {/* Back */}
              <div style={sideFaceStyle(`rotateY(180deg) translateZ(${halfCube}px)`, '背面')}>
                <span style={{ color: '#555', fontSize: '12px' }}>背面</span>
              </div>

              {/* Right */}
              <div style={sideFaceStyle(`rotateY(90deg) translateZ(${halfCube}px)`, '右侧')}>
                <span style={{ color: '#555', fontSize: '12px' }}>右侧</span>
              </div>

              {/* Left */}
              <div style={sideFaceStyle(`rotateY(-90deg) translateZ(${halfCube}px)`, '左侧')}>
                <span style={{ color: '#555', fontSize: '12px' }}>左侧</span>
              </div>

              {/* Top */}
              <div style={sideFaceStyle(`rotateX(90deg) translateZ(${halfCube}px)`, '顶部')}>
                <span style={{ color: '#555', fontSize: '12px' }}>顶部</span>
              </div>

              {/* Bottom */}
              <div style={sideFaceStyle(`rotateX(-90deg) translateZ(${halfCube}px)`, '底部')}>
                <span style={{ color: '#555', fontSize: '12px' }}>底部</span>
              </div>

              {/* Front face glow border */}
              <div style={{
                position: 'absolute',
                width: cubeSize,
                height: cubeSize,
                transform: `translateZ(${halfCube + 1}px)`,
                border: '1px solid rgba(212,175,55,0.3)',
                borderRadius: '4px',
                boxShadow: '0 0 20px rgba(212,175,55,0.1)',
                pointerEvents: 'none',
              }} />
            </div>
          </div>
        ) : (
          /* Sphere - Canvas 2D */
          <canvas
            ref={sphereCanvasRef}
            width={560}
            height={460}
            style={{ maxWidth: '100%', maxHeight: '100%' }}
          />
        )}
      </div>

      {/* Bottom hint */}
      <div className="absolute bottom-3 left-3 right-3 z-10 text-center">
        <p className="text-xs text-[#888]">
          {mode === 'cube'
            ? '左键拖动旋转立方体，查看主体各角度'
            : '左键拖动调整摄像头环绕角度'}
        </p>
      </div>

      {/* Drag indicator */}
      {isDragging && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-[#d4af37]/20 border border-[#d4af37]/40 text-xs text-[#d4af37]">
          旋转中...
        </div>
      )}
    </div>
  );
}
