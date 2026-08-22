'use client';

/* eslint-disable @next/next/no-img-element -- the pixel-accurate mask editor must render the original media element without Next image transformation. */

/* M7-0 机械拆出自 infinite-canvas.tsx 的擦除/蒙版编辑面板块。零行为变化，仅迁移渲染 JSX。 */

import * as React from 'react';
import { Eraser, Maximize2, Minus, Paintbrush, Plus, RotateCcw, Trash2, Wand2, X } from 'lucide-react';
import type { CanvasImage, EditMode } from '@/components/infinite-canvas';
import { getCanvasEditImageSource } from '@/lib/canvas-edit-image-source';

/** 单个笔迹点（机械拆出，与原文件内联结构一致） */
export interface StrokePoint {
  x: number;
  y: number;
  reverse: boolean;
}

export interface CanvasEditEraseMaskPanelProps {
  editMode: EditMode;
  editImageId: string | null;
  images: CanvasImage[];
  isMonochrome: boolean;
  exitEditMode: () => void;
  brushSize: number;
  setBrushSize: React.Dispatch<React.SetStateAction<number>>;
  editBrushMode: 'brush' | 'eraser';
  setEditBrushMode: React.Dispatch<React.SetStateAction<'brush' | 'eraser'>>;
  maskKeyword: string;
  setMaskKeyword: React.Dispatch<React.SetStateAction<string>>;
  eraseModelId: string;
  setEraseModelId: React.Dispatch<React.SetStateAction<string>>;
  editStrokes: StrokePoint[][];
  setEditStrokes: React.Dispatch<React.SetStateAction<StrokePoint[][]>>;
  currentStroke: StrokePoint[];
  setCurrentStroke: React.Dispatch<React.SetStateAction<StrokePoint[]>>;
  currentStrokeRef: React.RefObject<StrokePoint[]>;
  isDrawingRef: React.RefObject<boolean>;
  isAltErasingRef: React.RefObject<boolean>;
  setStrokesVersion: React.Dispatch<React.SetStateAction<number>>;
  isEditProcessing: boolean;
  handleEditConfirm: () => void | Promise<void>;
  isEventFromOverlay: (e: Event) => boolean;
  editCanvasZoom: number;
  setEditCanvasZoom: React.Dispatch<React.SetStateAction<number>>;
  editCanvasPan: { x: number; y: number };
  setEditCanvasPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  editSourceLoadState: 'idle' | 'loading' | 'loaded' | 'error';
  setEditSourceLoadState: React.Dispatch<React.SetStateAction<'idle' | 'loading' | 'loaded' | 'error'>>;
  bindEditCanvasWheelElement: (element: HTMLDivElement | null) => void;
}

/** M7-0：擦除/蒙版编辑浮动窗口（机械拆自 infinite-canvas.tsx，零行为变化） */
export function CanvasEditEraseMaskPanel(props: CanvasEditEraseMaskPanelProps) {
  const {
    editMode,
    editImageId,
    images,
    isMonochrome,
    exitEditMode,
    brushSize,
    setBrushSize,
    editBrushMode,
    setEditBrushMode,
    maskKeyword,
    setMaskKeyword,
    eraseModelId,
    setEraseModelId,
    editStrokes,
    setEditStrokes,
    currentStroke,
    setCurrentStroke,
    currentStrokeRef,
    isDrawingRef,
    isAltErasingRef,
    setStrokesVersion,
    isEditProcessing,
    handleEditConfirm,
    isEventFromOverlay,
    editCanvasZoom,
    setEditCanvasZoom,
    editCanvasPan,
    setEditCanvasPan,
    editSourceLoadState,
    setEditSourceLoadState,
    bindEditCanvasWheelElement,
  } = props;
  return (
    <>
{/* ====== ERASE/MASK FLOATING WINDOW ====== */}
        {(editMode === 'erase' || editMode === 'mask') && (() => {
          const editImg = images.find(i => i.id === editImageId);
          if (!editImg) return null;
          const imgOrigW = editImg.originalWidth || Math.round(editImg.width);
          const imgOrigH = editImg.originalHeight || Math.round(editImg.height);
          const isErase = editMode === 'erase';
          // Window dimensions
          const winW = Math.min(900, typeof window !== 'undefined' ? window.innerWidth - 80 : 900);
          const winH = Math.min(600, typeof window !== 'undefined' ? window.innerHeight - 120 : 600);
          // Canvas area (left) takes ~70% of window
          const canvasAreaW = Math.round(winW * 0.7);
          const sidebarW = winW - canvasAreaW;
          // Calculate image fit in canvas area
          const fitScale = Math.min((canvasAreaW - 40) / imgOrigW, (winH - 80) / imgOrigH, 1) * editCanvasZoom;
          const displayW = imgOrigW * fitScale;
          const displayH = imgOrigH * fitScale;
          const canvasCenterX = (canvasAreaW - displayW) / 2 + editCanvasPan.x;
          const canvasCenterY = (winH - displayH) / 2 + editCanvasPan.y;

          return (
            <div
              data-floating-panel={isErase ? 'erase' : 'mask'}
              className="fixed inset-0 z-[200] flex items-center justify-center motion-reduce:transition-none"
              style={{ cursor: 'default' }}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseMove={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); }}
            >
              {/* Backdrop */}
              <div className="absolute inset-0 bg-black/40" onClick={exitEditMode} />
              {/* Window */}
              <div
                className={`relative rounded-2xl border shadow-2xl overflow-hidden ${isMonochrome ? 'bg-gray-100 border-gray-300' : 'bg-[#1a1a1a] border-[#444]'}`}
                style={{ width: winW, height: winH, cursor: 'default' }}
              >
                {/* Title bar */}
                <div className={`flex items-center justify-between px-4 py-2.5 border-b ${isMonochrome ? 'border-gray-200 bg-white' : 'border-[#444] bg-[#222]'}`}>
                  <div className="flex items-center gap-2">
                    {isErase ? <Paintbrush size={14} className={isMonochrome ? 'text-blue-500' : 'text-gold'} /> : <Wand2 size={14} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />}
                    <span className={`text-sm font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>
                      {isErase ? '擦除' : '蒙版修图'}
                    </span>
                    <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>
                      涂抹区域后点击&apos;开始修复&apos; · Shift+左键擦除涂抹
                    </span>
                  </div>
                  <button onClick={exitEditMode} className={`p-1 rounded-lg transition-colors ${isMonochrome ? 'text-blue-500 hover:text-blue-700 hover:bg-blue-50' : 'text-gold-muted/70 hover:text-white hover:bg-[#282828]/85'}`}>
                    <X size={16} />
                  </button>
                </div>

                <div className="flex" style={{ height: winH - 44 }}>
                  {/* Left: Canvas area with checkered bg */}
                  <div
                    className={`relative overflow-hidden ${isMonochrome ? 'bg-gray-200' : 'bg-[#0d0d0d]'}`}
                    style={{ width: canvasAreaW, cursor: 'default' }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    ref={bindEditCanvasWheelElement}
                  >
                    {/* Checkered background for image */}
                    <div
                      className="absolute"
                      style={{
                        left: canvasCenterX,
                        top: canvasCenterY,
                        width: displayW,
                        height: displayH,
                        backgroundImage: 'linear-gradient(45deg, #333 25%, transparent 25%, transparent 75%, #333 75%), linear-gradient(45deg, #333 25%, transparent 25%, transparent 75%, #333 75%)',
                        backgroundSize: '16px 16px',
                        backgroundPosition: '0 0, 8px 8px',
                        backgroundColor: '#222',
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      {/* Image */}
                      <img
                        src={getCanvasEditImageSource(editImg.url)}
                        alt="edit"
                        className="w-full h-full object-contain select-none"
                        draggable={false}
                        crossOrigin="anonymous"
                        referrerPolicy="no-referrer"
                        style={{ pointerEvents: 'none' }}
                        onLoad={() => setEditSourceLoadState('loaded')}
                        onError={() => setEditSourceLoadState('error')}
                      />
                      {editSourceLoadState !== 'loaded' && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/55 px-6 text-center text-xs text-white">
                          {editSourceLoadState === 'error' ? '图片加载失败，无法进行编辑' : '正在加载图片...'}
                        </div>
                      )}
                      {/* Stroke overlay SVG */}
                      <svg
                        className="absolute inset-0 w-full h-full"
                        viewBox={`0 0 ${imgOrigW} ${imgOrigH}`}
                        style={{ pointerEvents: 'none' }}
                      >
                        {/* Render completed strokes */}
                        {editStrokes.map((stroke, si) => {
                          const normalPoints = stroke.filter(p => !p.reverse);
                          const reversePoints = stroke.filter(p => p.reverse);
                          return (
                            <React.Fragment key={si}>
                              {normalPoints.length === 1 && (
                                <circle
                                  cx={normalPoints[0].x}
                                  cy={normalPoints[0].y}
                                  r={brushSize / 2 / fitScale}
                                  fill={isErase ? 'rgba(255,80,80,0.5)' : 'rgba(212,175,55,0.5)'}
                                />
                              )}
                              {normalPoints.length > 1 && (
                                <polyline
                                  points={normalPoints.map(p => `${p.x},${p.y}`).join(' ')}
                                  fill="none"
                                  stroke={isErase ? 'rgba(255,80,80,0.5)' : 'rgba(212,175,55,0.5)'}
                                  strokeWidth={brushSize / fitScale}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              )}
                              {reversePoints.length === 1 && (
                                <circle
                                  cx={reversePoints[0].x}
                                  cy={reversePoints[0].y}
                                  r={brushSize / 2 / fitScale}
                                  fill="rgba(0,200,100,0.5)"
                                />
                              )}
                              {reversePoints.length > 1 && (
                                <polyline
                                  points={reversePoints.map(p => `${p.x},${p.y}`).join(' ')}
                                  fill="none"
                                  stroke="rgba(0,200,100,0.5)"
                                  strokeWidth={brushSize / fitScale}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeDasharray="4 4"
                                />
                              )}
                            </React.Fragment>
                          );
                        })}
                        {/* Current stroke */}
                        {currentStroke.length === 1 && (
                          <circle
                            cx={currentStroke[0].x}
                            cy={currentStroke[0].y}
                            r={brushSize / 2 / fitScale}
                            fill={currentStroke[0]?.reverse ? 'rgba(0,200,100,0.5)' : (isErase ? 'rgba(255,80,80,0.5)' : 'rgba(212,175,55,0.5)')}
                          />
                        )}
                        {currentStroke.length > 1 && (
                          <polyline
                            points={currentStroke.map(p => `${p.x},${p.y}`).join(' ')}
                            fill="none"
                            stroke={currentStroke[0]?.reverse ? 'rgba(0,200,100,0.5)' : (isErase ? 'rgba(255,80,80,0.5)' : 'rgba(212,175,55,0.5)')}
                            strokeWidth={brushSize / fitScale}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeDasharray={currentStroke[0]?.reverse ? '4 4' : undefined}
                          />
                        )}
                      </svg>
                      {/* Drawing layer - captures mouse events for brush & pan */}
                      <div
                        className="absolute inset-0"
                        style={{
                          cursor: editSourceLoadState === 'loaded' ? 'crosshair' : 'not-allowed',
                          pointerEvents: editSourceLoadState === 'loaded' ? 'auto' : 'none',
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          // Middle/right button: canvas panning
                          if (e.button === 1 || e.button === 2) {
                            const startX = e.clientX;
                            const startY = e.clientY;
                            const startPan = { ...editCanvasPan };
                            const onMove = (ev: MouseEvent) => {
                              if (isEventFromOverlay(ev)) return;
                              setEditCanvasPan({
                                x: startPan.x + ev.clientX - startX,
                                y: startPan.y + ev.clientY - startY,
                              });
                            };
                            const onUp = () => {
                              window.removeEventListener('mousemove', onMove);
                              window.removeEventListener('mouseup', onUp);
                            };
                            window.addEventListener('mousemove', onMove);
                            window.addEventListener('mouseup', onUp);
                            return;
                          }
                          // Left button: draw
                          if (e.button !== 0) return;
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const x = (e.clientX - rect.left) / rect.width * imgOrigW;
                          const y = (e.clientY - rect.top) / rect.height * imgOrigH;
                          // Shift+click = erase (reverse) mode, otherwise use current brush mode
                          const isReverse = e.shiftKey || editBrushMode === 'eraser';
                          const firstPoint = { x, y, reverse: isReverse };
                          currentStrokeRef.current = [firstPoint];
                          setCurrentStroke([firstPoint]);
                          isDrawingRef.current = true;
                          isAltErasingRef.current = isReverse;
                        }}
                        onMouseMove={(e) => {
                          if (!isDrawingRef.current) return;
                          e.stopPropagation();
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const x = (e.clientX - rect.left) / rect.width * imgOrigW;
                          const y = (e.clientY - rect.top) / rect.height * imgOrigH;
                          // Shift held = erase, otherwise use current brush mode
                          const isReverse = e.shiftKey || editBrushMode === 'eraser';
                          const newPoint = { x, y, reverse: isReverse };
                          // Interpolate for smooth strokes
                          const prevPoints = currentStrokeRef.current;
                          if (prevPoints.length > 0) {
                            const last = prevPoints[prevPoints.length - 1];
                            const dist = Math.sqrt((x - last.x) ** 2 + (y - last.y) ** 2);
                            const step = Math.max(1, brushSize / fitScale / 4);
                            if (dist > step) {
                              const n = Math.ceil(dist / step);
                              for (let i = 1; i <= n; i++) {
                                const t = i / n;
                                currentStrokeRef.current.push({
                                  x: last.x + (x - last.x) * t,
                                  y: last.y + (y - last.y) * t,
                                  reverse: isReverse,
                                });
                              }
                            }
                          }
                          currentStrokeRef.current.push(newPoint);
                          setCurrentStroke([...currentStrokeRef.current]);
                        }}
                        onMouseUp={(e) => {
                          e.stopPropagation();
                          if (!isDrawingRef.current) return;
                          isDrawingRef.current = false;
                          const stroke = currentStrokeRef.current;
                          if (stroke.length > 0) {
                            setEditStrokes(prev => [...prev, stroke]);
                          }
                          currentStrokeRef.current = [];
                          setCurrentStroke([]);
                          setStrokesVersion(v => v + 1);
                        }}
                        onMouseLeave={() => {
                          if (!isDrawingRef.current) return;
                          isDrawingRef.current = false;
                          const stroke = currentStrokeRef.current;
                          if (stroke.length > 0) {
                            setEditStrokes(prev => [...prev, stroke]);
                          }
                          currentStrokeRef.current = [];
                          setCurrentStroke([]);
                        }}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      />
                    </div>
                    {/* Zoom controls overlay */}
                    <div className={`absolute bottom-3 left-3 flex items-center gap-1 px-2 py-1 rounded-lg text-xs ${isMonochrome ? 'bg-white/80 text-gray-600' : 'bg-[#2a2a2a] text-[#999]'}`} style={{ cursor: 'default' }}>
                      <button onClick={(e) => { e.stopPropagation(); setEditCanvasZoom(z => Math.max(0.25, z / 1.2)); }} className="p-0.5 hover:text-gold"><Minus size={12} /></button>
                      <span className="w-10 text-center tabular-nums">{Math.round(editCanvasZoom * 100)}%</span>
                      <button onClick={(e) => { e.stopPropagation(); setEditCanvasZoom(z => Math.min(5, z * 1.2)); }} className="p-0.5 hover:text-gold"><Plus size={12} /></button>
                      <button onClick={(e) => { e.stopPropagation(); setEditCanvasZoom(1); setEditCanvasPan({ x: 0, y: 0 }); }} className="p-0.5 hover:text-gold"><Maximize2 size={12} /></button>
                    </div>
                    </div>

                  {/* Right: Sidebar controls */}
                  <div className={`flex flex-col border-l ${isMonochrome ? 'border-gray-200 bg-white' : 'border-[#444] bg-[#1e1e1e]'}`} style={{ width: sidebarW }}>
                    {/* Brush mode toggle */}
                    <div className="px-3 pt-3 pb-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditBrushMode('brush')}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg transition-all ${
                            editBrushMode === 'brush'
                              ? isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-gold text-black font-medium'
                              : isMonochrome
                                ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                          }`}
                        >
                          <Paintbrush size={12} />
                          画笔
                        </button>
                        <button
                          onClick={() => setEditBrushMode('eraser')}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg transition-all ${
                            editBrushMode === 'eraser'
                              ? isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-gold text-black font-medium'
                              : isMonochrome
                                ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                          }`}
                        >
                          <Eraser size={12} />
                          橡皮擦
                        </button>
                      </div>
                    </div>

                    {/* Brush size slider */}
                    <div className="px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`}>画笔大小</span>
                        <span className={`text-xs tabular-nums ${isMonochrome ? 'text-gray-600' : 'text-text-bright'}`}>{brushSize}px</span>
                      </div>
                      <input
                        type="range"
                        min="5"
                        max="200"
                        value={brushSize}
                        onChange={(e) => setBrushSize(Number(e.target.value))}
                        className="w-full h-2 cursor-pointer accent-[#d4af37] rounded-lg"
                        style={{ minHeight: '20px' }}
                      />
                    </div>

                    {/* Erase model selector (only for erase mode) */}
                    {isErase && (
                      <div className="px-3 py-2">
                        <span className={`text-xs mb-1.5 block ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`}>擦除引擎</span>
                        <div className="flex flex-col gap-1.5">
                          {[
                            { id: 'lama', label: 'LaMa', desc: '通用擦除', recommended: true },
                            { id: 'zits', label: 'ZITS', desc: '结构保持', recommended: false },
                            { id: 'anime-lama', label: 'Anime', desc: '动漫专用', recommended: false },
                          ].map(m => (
                            <button
                              key={m.id}
                              onClick={() => setEraseModelId(m.id)}
                              className={`flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-all text-left ${
                                eraseModelId === m.id
                                  ? isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-gold text-black font-medium'
                                  : isMonochrome
                                    ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                              }`}
                            >
                              <span className="font-medium">{m.label}</span>
                              <span className={`text-[10px] ${eraseModelId === m.id ? 'text-black/60' : isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>{m.desc}</span>
                              {m.recommended && (
                                <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded-full ${
                                  eraseModelId === m.id
                                    ? 'bg-black/20 text-black/70'
                                    : isMonochrome
                                      ? 'bg-gray-200 text-gray-500'
                                      : 'bg-[#333] text-gold-muted'
                                }`}>推荐</span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Undo/Clear buttons */}
                    <div className="px-3 py-2 flex gap-2">
                      <button
                        onClick={() => {
                          setEditStrokes(prev => prev.slice(0, -1));
                          setStrokesVersion(v => v + 1);
                        }}
                        disabled={editStrokes.length === 0}
                        className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs rounded-lg transition-all ${
                          editStrokes.length === 0
                            ? 'opacity-40 cursor-not-allowed'
                            : isMonochrome
                              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                        }`}
                      >
                        <RotateCcw size={12} />
                        撤销
                      </button>
                      <button
                        onClick={() => {
                          setEditStrokes([]);
                          setCurrentStroke([]);
                          currentStrokeRef.current = [];
                          setStrokesVersion(v => v + 1);
                        }}
                        disabled={editStrokes.length === 0}
                        className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs rounded-lg transition-all ${
                          editStrokes.length === 0
                            ? 'opacity-40 cursor-not-allowed'
                            : isMonochrome
                              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                        }`}
                      >
                        <Trash2 size={12} />
                        清空
                      </button>
                    </div>

                    {/* Mask prompt (only for mask mode) */}
                    {!isErase && (
                      <div className="px-3 py-2">
                        <span className={`text-xs mb-1 block ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`}>修复提示词 (可选)</span>
                        <textarea
                          value={maskKeyword}
                          onChange={(e) => setMaskKeyword(e.target.value)}
                          placeholder="描述修复内容..."
                          rows={3}
                          className={`w-full px-2.5 py-2 text-xs rounded-xl border resize-none ${
                            isMonochrome
                              ? 'bg-gray-50 border-gray-200 text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gold/30'
                              : 'bg-background/90 border-border text-white placeholder:text-gold-muted/50 focus:outline-none focus:ring-2 focus:ring-gold/30'
                          }`}
                        />
                      </div>
                    )}

                    <div className="flex-1" />

                    {/* Confirm button */}
                    <div className="px-3 pb-3">
                      <button
                        onClick={handleEditConfirm}
                        disabled={editStrokes.length === 0 || isEditProcessing || editSourceLoadState !== 'loaded'}
                        className={`w-full py-2.5 text-sm font-semibold rounded-xl transition-all ${
                          editStrokes.length === 0 || isEditProcessing || editSourceLoadState !== 'loaded'
                            ? isMonochrome ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#333] text-gold-muted/50 cursor-not-allowed'
                            : isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600 active:scale-[0.98]' : 'bg-gold text-black hover:bg-[#e5c047] active:scale-[0.98]'
                        }`}
                      >
                        {isEditProcessing ? '处理中...' : (editMode === 'erase' ? '开始擦除' : '开始修复')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </>
  );
}
