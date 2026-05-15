'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, ChevronDown, ChevronUp, ZoomIn, ZoomOut, RotateCcw, GripVertical, Hand } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CanvasImage {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  prompt?: string;
}

interface EditModelInfo {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  supportsMask: boolean;
}

interface LLMModelInfo {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
}

interface ImageEditorProps {
  image: CanvasImage;
  /** Screen-space rect of the source image (from getBoundingClientRect) */
  sourceRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  onConfirm: (imageId: string, resultUrl: string, resultPrompt?: string) => void;
  onClose: () => void;
}

// ─── Aspect ratio presets ────────────────────────────────────────────────────

const ASPECT_RATIOS = [
  { label: '1:1', w: 1, h: 1 },
  { label: '4:3', w: 4, h: 3 },
  { label: '3:4', w: 3, h: 4 },
  { label: '16:9', w: 16, h: 9 },
  { label: '9:16', w: 9, h: 16 },
];

const QUALITY_OPTIONS = [
  { label: '标准', value: 'standard' },
  { label: '高清', value: 'hd' },
];

const COUNT_OPTIONS = [
  { label: '1张', value: 1 },
  { label: '2张', value: 2 },
  { label: '3张', value: 3 },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function ImageEditor({ image, sourceRect, onConfirm, onClose }: ImageEditorProps) {
  // ── Models ──
  const [editModels, setEditModels] = useState<EditModelInfo[]>([]);
  const [llmModels, setLlmModels] = useState<LLMModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<EditModelInfo | null>(null);
  const [selectedLLM, setSelectedLLM] = useState<LLMModelInfo | null>(null);

  // ── Inputs ──
  const [prompt, setPrompt] = useState('');
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);

  // ── Params ──
  const [aspectRatio, setAspectRatio] = useState(ASPECT_RATIOS[0]);
  const [quality, setQuality] = useState('hd');
  const [count, setCount] = useState(1);

  // ── UI state ──
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultPrompt, setResultPrompt] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // ── Position (floating) ──
  const editorWidth = 340;
  const editorRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // ── Image zoom ──
  const [imgScale, setImgScale] = useState(1);
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // ── Result box size ──
  const resultBoxSize = { w: 160, h: Math.round(160 / (aspectRatio.w / aspectRatio.h)) };

  // ── Init position ──
  useEffect(() => {
    const x = sourceRect.right + 24;
    const y = Math.max(40, sourceRect.top);
    setPos({ x, y });
  }, [sourceRect]);

  // ── Load models ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/edit');
        const data = await res.json();
        if (data.models?.length) {
          setEditModels(data.models);
          setSelectedModel(data.models[0]);
        }
      } catch {}
      try {
        const res = await fetch('/api/models?type=chat');
        const data = await res.json();
        if (data.models?.length) {
          setLlmModels(data.models);
          setSelectedLLM(data.models[0]);
        }
      } catch {}
    })();
  }, []);

  // ── Drag handlers ──
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  }, [pos.x, pos.y]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  // ── Image zoom ──
  const handleImageWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setImgScale(s => Math.max(0.1, Math.min(5, s * delta)));
  }, []);

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, ox: imgOffset.x, oy: imgOffset.y };
  }, [imgOffset]);

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => setImgOffset({ x: panStart.current.ox + e.clientX - panStart.current.x, y: panStart.current.oy + e.clientY - panStart.current.y });
    const onUp = () => setIsPanning(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isPanning]);

  const resetZoom = () => { setImgScale(1); setImgOffset({ x: 0, y: 0 }); };

  // ── Stop propagation for wheel events ──
  const stopProp = (e: React.WheelEvent) => { e.stopPropagation(); e.preventDefault(); };

  // ── Submit ──
  const handleSubmit = async () => {
    if (!prompt.trim() || !selectedModel) return;
    setIsProcessing(true);
    setError(null);
    setProgress(0);
    setResultUrl(null);

    const interval = setInterval(() => setProgress(p => Math.min(p + Math.random() * 12, 90)), 600);

    try {
      const body: Record<string, unknown> = {
        image: image.url,
        prompt: prompt.trim(),
        model: selectedModel.id,
        providerId: selectedModel.providerId,
        size: `${aspectRatio.w * 1024 / Math.max(aspectRatio.w, aspectRatio.h)}x${aspectRatio.h * 1024 / Math.max(aspectRatio.w, aspectRatio.h)}`,
        quality,
        n: count,
      };
      if (maskDataUrl && selectedModel.supportsMask) body.mask = maskDataUrl;
      if (selectedLLM) {
        body.llmModel = selectedLLM.id;
        body.llmProviderId = selectedLLM.providerId;
      }

      const res = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '修图失败');
      if (data.url) {
        setResultUrl(data.url);
        setResultPrompt(data.revised_prompt || prompt);
        setProgress(100);
      } else {
        throw new Error('未返回图片结果');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '修图失败');
    } finally {
      clearInterval(interval);
      setIsProcessing(false);
    }
  };

  // ── Apply result ──
  const handleApply = () => {
    if (resultUrl) {
      onConfirm(image.id, resultUrl, resultPrompt || undefined);
      onClose();
    }
  };

  // ── SVG connection line ──
  const editorLeft = pos.x;
  const editorTop = pos.y + 36; // below title bar
  const editorRight = pos.x + editorWidth;
  const editorMidY = pos.y + 36 + 120; // middle of preview area

  const resultLeft = editorRight + 20;
  const resultTop = editorMidY - resultBoxSize.h / 2;

  // Source image connection point (right edge middle)
  const srcX = sourceRect.right;
  const srcY = sourceRect.top + sourceRect.height / 2;

  // SVG path: source → editor (bezier)
  const srcToEditor = `M${srcX},${srcY} C${srcX + 40},${srcY} ${editorLeft - 40},${editorMidY} ${editorLeft},${editorMidY}`;

  // SVG path: editor → result (bezier)
  const editorToResult = `M${editorRight},${editorMidY} C${editorRight + 8},${editorMidY} ${resultLeft - 8},${editorMidY} ${resultLeft},${editorMidY}`;

  const modelSupportsMask = selectedModel?.supportsMask ?? false;

  return (
    <>
      {/* SVG connection lines overlay */}
      <svg
        style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 9998 }}
      >
        {/* Source → Editor */}
        <path
          d={srcToEditor}
          fill="none"
          stroke="#d4af37"
          strokeWidth={2}
          strokeDasharray="6 4"
          opacity={0.7}
        />
        {/* Connection dot on source image */}
        <circle cx={srcX} cy={srcY} r={5} fill="#d4af37" />
        {/* Connection dot on editor left */}
        <circle cx={editorLeft} cy={editorMidY} r={4} fill="#d4af37" />

        {/* Editor → Result */}
        <path
          d={editorToResult}
          fill="none"
          stroke="#d4af37"
          strokeWidth={2}
          strokeDasharray="6 4"
          opacity={0.7}
        />
        {/* Connection dot on editor right */}
        <circle cx={editorRight} cy={editorMidY} r={4} fill="#d4af37" />
        {/* Connection dot on result left */}
        <circle cx={resultLeft} cy={resultTop + resultBoxSize.h / 2} r={4} fill="#d4af37" />
      </svg>

      {/* Result frame */}
      <div
        onWheel={stopProp}
        style={{
          position: 'fixed',
          left: resultLeft,
          top: resultTop,
          width: resultBoxSize.w,
          height: resultBoxSize.h,
          zIndex: 9999,
          pointerEvents: 'auto',
        }}
        className="bg-[#111] border border-[#d4af37]/30 rounded-lg overflow-hidden flex flex-col items-center justify-center"
      >
        {isProcessing && !resultUrl && (
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
            <span className="text-[#d4af37] text-xs">{Math.round(progress)}%</span>
          </div>
        )}
        {resultUrl && (
          <img src={resultUrl} alt="result" className="w-full h-full object-contain" />
        )}
        {!isProcessing && !resultUrl && (
          <span className="text-[#555] text-xs">结果预览</span>
        )}
        {resultUrl && (
          <button
            onClick={handleApply}
            className="absolute bottom-1 right-1 bg-[#d4af37] text-black text-[10px] px-2 py-0.5 rounded font-medium hover:bg-[#e5c349] transition-colors"
          >
            应用
          </button>
        )}
      </div>

      {/* Editor panel */}
      <div
        ref={editorRef}
        onWheel={stopProp}
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          width: editorWidth,
          zIndex: 9999,
        }}
        className="bg-[#1a1a1a] border border-[#d4af37]/40 rounded-xl shadow-2xl select-none"
      >
        {/* ── Title bar (draggable) ── */}
        <div
          onMouseDown={handleDragStart}
          className="flex items-center justify-between px-3 py-2.5 cursor-grab active:cursor-grabbing border-b border-[#333]"
        >
          <div className="flex items-center gap-2">
            <span className="text-[#d4af37]">✏️</span>
            <span className="text-white text-sm font-medium">语言修图</span>
          </div>
          <button onClick={onClose} className="text-[#888] hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* ── Image preview with zoom ── */}
        <div className="px-3 pt-3">
          <div
            className="relative bg-[#111] rounded-lg overflow-hidden border border-[#333]"
            style={{ height: 200 }}
            onWheel={handleImageWheel}
          >
            {/* Zoom / pan controls */}
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-black/60 rounded-md px-1.5 py-0.5">
              <button onClick={() => setImgScale(s => Math.min(5, s * 1.2))} className="text-white/70 hover:text-white p-0.5"><ZoomIn size={13} /></button>
              <button onClick={() => setImgScale(s => Math.max(0.1, s * 0.8))} className="text-white/70 hover:text-white p-0.5"><ZoomOut size={13} /></button>
              <button onClick={resetZoom} className="text-white/70 hover:text-white p-0.5"><RotateCcw size={13} /></button>
              <span className="text-[10px] text-[#d4af37] min-w-[32px] text-center">{Math.round(imgScale * 100)}%</span>
              {imgScale > 1 && (
                <button
                  onMouseDown={handlePanStart}
                  className="text-[#d4af37] hover:text-[#e5c349] p-0.5"
                  style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
                >
                  <Hand size={13} />
                </button>
              )}
            </div>

            {/* Image */}
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ cursor: imgScale > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default', overflow: 'hidden' }}
              onMouseDown={imgScale > 1 ? handlePanStart : undefined}
            >
              <img
                src={image.url}
                alt="edit source"
                draggable={false}
                style={{
                  transform: `scale(${imgScale}) translate(${imgOffset.x / imgScale}px, ${imgOffset.y / imgScale}px)`,
                  transition: isPanning ? 'none' : 'transform 0.15s ease',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  pointerEvents: 'none',
                }}
              />
            </div>

            {/* Gemini mask overlay */}
            {!modelSupportsMask && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="text-center">
                  <span className="text-[#888] text-lg">🔒</span>
                  <p className="text-[#d4af37] text-xs mt-1">文字描述即可智能修图</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Prompt input ── */}
        <div className="px-3 pt-3">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="描述修改内容，如：把背景换成日落..."
            rows={2}
            className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#555] resize-none focus:outline-none focus:border-[#d4af37]/50"
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
            }}
          />
          <div className="text-[10px] text-[#555] mt-0.5 text-right">Enter 提交 · Shift+Enter 换行</div>
        </div>

        {/* ── Edit model selector ── */}
        <div className="px-3 pt-3">
          <div className="text-[10px] text-[#888] mb-1">图片模型</div>
          <select
            value={selectedModel ? `${selectedModel.id}__${selectedModel.providerId}` : ''}
            onChange={e => {
              const [id, providerId] = e.target.value.split('__');
              const m = editModels.find(m => m.id === id && m.providerId === providerId);
              if (m) setSelectedModel(m);
            }}
            className="w-full bg-[#111] border border-[#333] rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#d4af37]/50 appearance-none"
          >
            {editModels.map(m => (
              <option key={`${m.id}__${m.providerId}`} value={`${m.id}__${m.providerId}`}>
                {m.name} ({m.providerName}){m.supportsMask ? ' · 支持涂抹' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* ── LLM model selector ── */}
        <div className="px-3 pt-2">
          <div className="text-[10px] text-[#888] mb-1">LLM 辅助模型</div>
          <select
            value={selectedLLM ? `${selectedLLM.id}__${selectedLLM.providerId}` : ''}
            onChange={e => {
              const [id, providerId] = e.target.value.split('__');
              const m = llmModels.find(m => m.id === id && m.providerId === providerId);
              if (m) setSelectedLLM(m);
            }}
            className="w-full bg-[#111] border border-[#333] rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#d4af37]/50 appearance-none"
          >
            {llmModels.map(m => (
              <option key={`${m.id}__${m.providerId}`} value={`${m.id}__${m.providerId}`}>
                {m.name} ({m.providerName})
              </option>
            ))}
          </select>
        </div>

        {/* ── Params row ── */}
        <div className="px-3 pt-3 flex gap-2">
          {/* Aspect ratio */}
          <div className="flex-1">
            <div className="text-[10px] text-[#888] mb-1">画面比例</div>
            <select
              value={aspectRatio.label}
              onChange={e => { const a = ASPECT_RATIOS.find(r => r.label === e.target.value); if (a) setAspectRatio(a); }}
              className="w-full bg-[#111] border border-[#333] rounded-md px-1.5 py-1 text-[11px] text-white focus:outline-none focus:border-[#d4af37]/50 appearance-none"
            >
              {ASPECT_RATIOS.map(r => <option key={r.label} value={r.label}>{r.label}</option>)}
            </select>
          </div>
          {/* Quality */}
          <div className="flex-1">
            <div className="text-[10px] text-[#888] mb-1">图片质量</div>
            <select
              value={quality}
              onChange={e => setQuality(e.target.value)}
              className="w-full bg-[#111] border border-[#333] rounded-md px-1.5 py-1 text-[11px] text-white focus:outline-none focus:border-[#d4af37]/50 appearance-none"
            >
              {QUALITY_OPTIONS.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
            </select>
          </div>
          {/* Count */}
          <div className="flex-1">
            <div className="text-[10px] text-[#888] mb-1">生图数量</div>
            <select
              value={count}
              onChange={e => setCount(Number(e.target.value))}
              className="w-full bg-[#111] border border-[#333] rounded-md px-1.5 py-1 text-[11px] text-white focus:outline-none focus:border-[#d4af37]/50 appearance-none"
            >
              {COUNT_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="px-3 pt-2">
            <div className="bg-red-900/30 border border-red-700/40 rounded-md px-2 py-1 text-[11px] text-red-300">{error}</div>
          </div>
        )}

        {/* ── Submit button ── */}
        <div className="px-3 pt-3 pb-3">
          <button
            onClick={handleSubmit}
            disabled={isProcessing || !prompt.trim() || !selectedModel}
            className="w-full bg-[#d4af37] text-black font-semibold text-sm py-2 rounded-lg hover:bg-[#e5c349] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                处理中 {Math.round(progress)}%
              </>
            ) : (
              <>✨ 开始修改</>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
