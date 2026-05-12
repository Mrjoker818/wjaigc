'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Undo2, Trash2, Brush, Eraser, Loader2, Sparkles } from 'lucide-react';
import MaskBrushCanvas, { type MaskBrushCanvasRef } from './MaskBrushCanvas';

export interface ImageEditPanelProps {
  imageUrl: string;
  mode: 'erase' | 'mask';
  onClose: () => void;
  onSuccess: (resultImageUrl: string) => void;
}

export default function ImageEditPanel({ imageUrl, mode, onClose, onSuccess }: ImageEditPanelProps) {
  const [brushSize, setBrushSize] = useState(20);
  const [brushMode, setBrushMode] = useState<'brush' | 'eraser'>('brush');
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState({ width: 800, height: 600 });
  const [healthStatus, setHealthStatus] = useState<{ iopaintAvailable: boolean } | null>(null);
  const maskRef = useRef<MaskBrushCanvasRef>(null);

  // 检测 IOPaint 服务状态并自动启动
  useEffect(() => {
    fetch('/api/image/health')
      .then(r => r.json())
      .then(async (data) => {
        const iopaintAvailable = data.iopaint?.available ?? false;
        if (!iopaintAvailable) {
          // 尝试自动启动服务
          try {
            await fetch('/api/image/start-services', { method: 'POST' });
            // 重新检测
            const recheck = await fetch('/api/image/health').then(r => r.json());
            setHealthStatus({ iopaintAvailable: recheck.iopaint?.available ?? false });
          } catch {
            setHealthStatus({ iopaintAvailable: false });
          }
        } else {
          setHealthStatus({ iopaintAvailable: true });
        }
      })
      .catch(() => {
        setHealthStatus({ iopaintAvailable: false });
      });
  }, []);

  // 获取图片尺寸
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // 开始修复
  const handleRepair = useCallback(async () => {
    if (!maskRef.current) return;
    setIsProcessing(true);
    setError(null);

    try {
      const maskDataUrl = await maskRef.current.exportMask();

      const res = await fetch('/api/image/inpaint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl,
          maskDataUrl,
          prompt: mode === 'mask' && prompt.trim() ? prompt.trim() : undefined,
        }),
      });

      const data = await res.json();
      if (data.success && data.imageUrl) {
        onSuccess(data.imageUrl);
      } else {
        setError(data.error || '修复失败');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '处理出错';
      setError(message);
    } finally {
      setIsProcessing(false);
    }
  }, [imageUrl, mode, prompt, onSuccess]);

  const modeLabel = mode === 'erase' ? '擦除' : '蒙版修图';

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] border border-[#d4af37]/30 rounded-xl shadow-2xl w-[90vw] max-w-[1100px] h-[80vh] overflow-hidden flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-[#d4af37]/20 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#d4af37]" />
            <h3 className="text-lg font-semibold text-white">{modeLabel}</h3>
            <span className="text-xs text-gray-500 ml-2">涂抹白色区域后点击"开始修复"</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 主体区 */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* 左侧画布 */}
          <div className="flex-1 p-4 min-w-0">
            <MaskBrushCanvas
              ref={maskRef}
              imageUrl={imageUrl}
              imageWidth={imageSize.width}
              imageHeight={imageSize.height}
              brushSize={brushSize}
              brushMode={brushMode}
            />
          </div>

          {/* 右侧工具栏 */}
          <div className="w-64 border-l border-[#d4af37]/20 p-4 space-y-4 overflow-y-auto shrink-0">
            {/* IOPaint 状态 */}
            {healthStatus && !healthStatus.iopaintAvailable && (
              <div className="bg-yellow-900/30 border border-yellow-600/40 rounded-lg p-3 text-xs text-yellow-300">
                本地 LaMa 修图服务未启动，请先启动 IOPaint：
                <code className="block mt-1 bg-black/30 p-1 rounded text-[10px] break-all">
                  iopaint start --model=lama --device=cpu --port=8080
                </code>
              </div>
            )}

            {/* 画笔工具 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">画笔模式</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setBrushMode('brush')}
                  className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    brushMode === 'brush'
                      ? 'bg-[#d4af37] text-black'
                      : 'bg-[#2a2a2a] text-gray-300 border border-[#d4af37]/20 hover:bg-[#333]'
                  }`}
                >
                  <Brush className="w-4 h-4" />
                  画笔
                </button>
                <button
                  onClick={() => setBrushMode('eraser')}
                  className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    brushMode === 'eraser'
                      ? 'bg-[#d4af37] text-black'
                      : 'bg-[#2a2a2a] text-gray-300 border border-[#d4af37]/20 hover:bg-[#333]'
                  }`}
                >
                  <Eraser className="w-4 h-4" />
                  橡皮擦
                </button>
              </div>
            </div>

            {/* 画笔大小 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                画笔大小: {brushSize}px
              </label>
              <input
                type="range"
                min={2}
                max={100}
                value={brushSize}
                onChange={e => setBrushSize(Number(e.target.value))}
                className="w-full accent-[#d4af37]"
              />
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-2">
              <button
                onClick={() => maskRef.current?.undo()}
                className="flex-1 flex items-center justify-center gap-1 py-2 bg-[#2a2a2a] text-gray-300 rounded-lg text-sm border border-[#d4af37]/20 hover:bg-[#333] transition-colors"
              >
                <Undo2 className="w-4 h-4" />
                撤销
              </button>
              <button
                onClick={() => maskRef.current?.clear()}
                className="flex-1 flex items-center justify-center gap-1 py-2 bg-[#2a2a2a] text-gray-300 rounded-lg text-sm border border-[#d4af37]/20 hover:bg-[#333] transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                清空
              </button>
            </div>

            {/* 提示词（蒙版模式） */}
            {mode === 'mask' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">修复提示词（可选）</label>
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="描述修复内容..."
                  className="w-full bg-[#2a2a2a] border border-[#d4af37]/20 text-white rounded-lg px-3 py-2 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-[#d4af37]/40 placeholder:text-gray-500"
                />
              </div>
            )}

            {/* 错误信息 */}
            {error && (
              <div className="bg-red-900/30 border border-red-600/40 rounded-lg p-3 text-xs text-red-300">
                {error}
              </div>
            )}

            {/* 开始修复 */}
            <button
              onClick={handleRepair}
              disabled={isProcessing || (healthStatus !== null && !healthStatus.iopaintAvailable)}
              className="w-full py-3 bg-[#d4af37] text-black text-sm font-semibold rounded-lg hover:bg-[#e5c349] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  修复中...
                </>
              ) : (
                '开始修复'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
