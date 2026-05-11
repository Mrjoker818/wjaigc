'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';

export default function Test3DPage() {
  const [mode, setMode] = useState<'cube' | 'sphere'>('cube');
  const [rotateX, setRotateX] = useState(-15);
  const [rotateY, setRotateY] = useState(25);
  const [isDragging, setIsDragging] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [imageUrl, setImageUrl] = useState('https://picsum.photos/400/400');
  const [customUrl, setCustomUrl] = useState('');
  const lastPos = useRef({ x: 0, y: 0 });
  const animationRef = useRef<number>(0);
  const rotRef = useRef({ x: -15, y: 25 });
  const sphereCanvasRef = useRef<HTMLCanvasElement>(null);
  const imgDataRef = useRef<{ data: Uint8ClampedArray; w: number; h: number } | null>(null);
  const [imgDataSummary, setImgDataSummary] = useState('null');
  const [imgLoaded, setImgLoaded] = useState(false);
  const [error, setError] = useState('');

  // Preload image pixel data
  useEffect(() => {
    setImgLoaded(false);
    setError('');
    imgDataRef.current = null;
    setImgDataSummary('null');
    
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
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        imgDataRef.current = { data, w, h };
        setImgDataSummary(`${w}x${h}`);
        setImgLoaded(true);
      } catch (e: unknown) {
        setError('图片像素读取失败 (CORS): ' + (e instanceof Error ? e.message : String(e)));
      }
    };
    img.onerror = () => {
      setError('图片加载失败');
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
      rotRef.current.y += 0.3;
      setRotateY(rotRef.current.y);
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [autoRotate, isDragging]);

  // Sphere rendering
  useEffect(() => {
    if (mode !== 'sphere') return;
    const canvas = sphereCanvasRef.current;
    if (!canvas) return;
    const src = imgDataRef.current;
    if (!src) {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#d4af37';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(imgLoaded ? '渲染中...' : '图片加载中...', canvas.width / 2, canvas.height / 2);
      return;
    }

    const ctx = canvas.getContext('2d')!;
    const cw = canvas.width;
    const ch = canvas.height;
    const centerX = cw / 2;
    const centerY = ch / 2;
    const radius = Math.min(cw, ch) * 0.38;

    const renderScale = 0.4;
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

        const sx = Math.min(Math.floor(u * src.w), src.w - 1);
        const sy = Math.min(Math.floor(v * src.h), src.h - 1);
        const srcIdx = (sy * src.w + sx) * 4;
        const light = 0.35 + 0.65 * Math.max(0, nz);
        const dstIdx = (py * rw + px) * 4;
        data[dstIdx] = Math.round(src.data[srcIdx] * light);
        data[dstIdx + 1] = Math.round(src.data[srcIdx + 1] * light);
        data[dstIdx + 2] = Math.round(src.data[srcIdx + 2] * light);
        data[dstIdx + 3] = 255;
      }
    }

    offCtx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(offCanvas, 0, 0, cw, ch);

    // Grid + camera
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
      const latRad = (lat * Math.PI) / 180;
      const latR = radius * Math.cos(latRad);
      const latCY = centerY - radius * Math.sin(latRad);
      ctx.beginPath();
      ctx.ellipse(centerX, latCY, latR, latR * 0.15, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let lon = 0; lon < 180; lon += 30) {
      const lonRad = ((lon + rotRef.current.y) * Math.PI) / 180;
      ctx.beginPath();
      for (let t = 0; t <= Math.PI; t += 0.05) {
        const lx = centerX + radius * Math.sin(t) * Math.cos(lonRad);
        const ly = centerY - radius * Math.cos(t);
        if (t === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
      }
      ctx.stroke();
    }
    ctx.restore();

    const camAngle = (rotRef.current.y * Math.PI) / 180;
    const camX = centerX + (radius + 35) * Math.cos(camAngle);
    const camY = centerY;
    ctx.beginPath(); ctx.arc(camX, camY, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#d4af37'; ctx.fill();
    ctx.beginPath(); ctx.arc(camX, camY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0a0a'; ctx.fill();
  }, [mode, rotateX, rotateY, imgLoaded]);

  // Pointer handlers
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

  const getViewAngle = (x: number, yValue: number) => {
    const y = ((yValue % 360) + 360) % 360;
    if (x < -45) return '俯视';
    if (x > 45) return '仰视';
    if (y < 45 || y > 315) return '正面';
    if (y >= 45 && y < 135) return '右侧';
    if (y >= 135 && y < 225) return '背面';
    return '左侧';
  };

  const cubeSize = 200;
  const half = cubeSize / 2;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-6">
      <h1 className="text-2xl font-bold text-[#d4af37] mb-2">3D 查看器测试页</h1>
      <p className="text-sm text-[#888] mb-4">验证立方体和球体是否正常渲染</p>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div className="flex bg-[#1a1a1a] rounded-lg p-0.5 border border-[#333]">
          <button
            onClick={() => setMode('cube')}
            className={`px-4 py-1.5 text-sm rounded-md transition-all ${mode === 'cube' ? 'bg-[#d4af37] text-black font-semibold' : 'text-[#999] hover:text-white'}`}
          >
            立方体模式
          </button>
          <button
            onClick={() => setMode('sphere')}
            className={`px-4 py-1.5 text-sm rounded-md transition-all ${mode === 'sphere' ? 'bg-[#d4af37] text-black font-semibold' : 'text-[#999] hover:text-white'}`}
          >
            球体模式
          </button>
        </div>
        <button
          onClick={() => { rotRef.current = { x: -15, y: 25 }; setRotateX(-15); setRotateY(25); setAutoRotate(true); }}
          className="px-3 py-1.5 text-sm rounded-md bg-[#1a1a1a] border border-[#333] text-[#999] hover:text-[#d4af37]"
        >
          重置视角
        </button>
        <div className="px-3 py-1 text-xs rounded bg-[#1a1a1a] border border-[#333] text-[#d4af37]">
          视角：{getViewAngle(rotateX, rotateY)} | 横向：{rotateX.toFixed(0)}° 纵向：{rotateY.toFixed(0)}°
        </div>
        <label className="flex items-center gap-2 text-sm text-[#999]">
          <input type="checkbox" checked={autoRotate} onChange={e => setAutoRotate(e.target.checked)} />
          自动旋转
        </label>
      </div>

      {/* Image URL input */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={customUrl}
          onChange={e => setCustomUrl(e.target.value)}
          placeholder="输入图片URL测试..."
          className="flex-1 px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded-lg text-sm text-white placeholder-[#555]"
        />
        <button
          onClick={() => customUrl && setImageUrl(customUrl)}
          className="px-4 py-2 text-sm rounded-lg bg-[#d4af37] text-black font-semibold"
        >
          加载
        </button>
      </div>

      {error && <div className="mb-4 p-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-400">{error}</div>}

      {/* Status */}
      <div className="mb-4 text-xs text-[#555]">
        模式：{mode} | 图片：{imgLoaded ? '✅ 已加载' : '⏳ 加载中'} | 拖拽：{isDragging ? '是' : '否'} | 自动旋转：{autoRotate ? '是' : '否'}
      </div>

      {/* 3D Viewer */}
      <div
        className="relative w-[600px] h-[500px] bg-[#111] border-2 border-[#333] rounded-xl overflow-hidden"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        {mode === 'cube' ? (
          <div className="w-full h-full flex items-center justify-center" style={{ perspective: '800px' }}>
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
              {/* Front */}
              <div style={{
                position: 'absolute', width: cubeSize, height: cubeSize,
                backfaceVisibility: 'hidden', transform: `translateZ(${half}px)`,
                border: '2px solid #d4af37', borderRadius: '4px', overflow: 'hidden',
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="front" crossOrigin="anonymous"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              {/* Back */}
              <div style={{
                position: 'absolute', width: cubeSize, height: cubeSize,
                backfaceVisibility: 'hidden', transform: `rotateY(180deg) translateZ(${half}px)`,
                background: 'linear-gradient(135deg, #1a1a1a, #0d0d0d)', border: '2px solid #333',
                borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ color: '#555', fontSize: '14px' }}>背面</span>
              </div>
              {/* Right */}
              <div style={{
                position: 'absolute', width: cubeSize, height: cubeSize,
                backfaceVisibility: 'hidden', transform: `rotateY(90deg) translateZ(${half}px)`,
                background: 'linear-gradient(135deg, #151515, #0a0a0a)', border: '2px solid #333',
                borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ color: '#555', fontSize: '14px' }}>右侧</span>
              </div>
              {/* Left */}
              <div style={{
                position: 'absolute', width: cubeSize, height: cubeSize,
                backfaceVisibility: 'hidden', transform: `rotateY(-90deg) translateZ(${half}px)`,
                background: 'linear-gradient(135deg, #151515, #0a0a0a)', border: '2px solid #333',
                borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ color: '#555', fontSize: '14px' }}>左侧</span>
              </div>
              {/* Top */}
              <div style={{
                position: 'absolute', width: cubeSize, height: cubeSize,
                backfaceVisibility: 'hidden', transform: `rotateX(90deg) translateZ(${half}px)`,
                background: 'linear-gradient(135deg, #1a1a1a, #0f0f0f)', border: '2px solid #333',
                borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ color: '#555', fontSize: '14px' }}>顶部</span>
              </div>
              {/* Bottom */}
              <div style={{
                position: 'absolute', width: cubeSize, height: cubeSize,
                backfaceVisibility: 'hidden', transform: `rotateX(-90deg) translateZ(${half}px)`,
                background: 'linear-gradient(135deg, #111, #080808)', border: '2px solid #333',
                borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ color: '#555', fontSize: '14px' }}>底部</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <canvas ref={sphereCanvasRef} width={580} height={480} />
          </div>
        )}

        {/* Mode label */}
        <div className="absolute bottom-3 left-3 text-xs text-[#888]">
          {mode === 'cube' ? 'CSS 3D 立方体 - 拖拽旋转' : 'Canvas 2D 球体 - 拖拽旋转'}
        </div>
      </div>

      {/* Debug info */}
      <div className="mt-4 p-3 bg-[#1a1a1a] border border-[#333] rounded-lg text-xs text-[#666] font-mono">
        <div>横向旋转：{rotateX.toFixed(2)} | 纵向旋转：{rotateY.toFixed(2)}</div>
        <div>图片数据：{imgDataSummary}</div>
        <div>模式：{mode} | 拖拽中：{isDragging.toString()} | 自动旋转：{autoRotate.toString()}</div>
      </div>
    </div>
  );
}
