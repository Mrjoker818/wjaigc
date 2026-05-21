'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, ZoomIn } from 'lucide-react';

export interface UpscaleDialogProps {
  imageUrl: string;
  onClose: () => void;
  onSuccess: (resultImageUrl: string) => void;
  isMonochrome?: boolean;
}

export default function UpscaleDialog({ imageUrl, onClose, onSuccess, isMonochrome = false }: UpscaleDialogProps) {
  const [model, setModel] = useState('');
  const [scale, setScale] = useState<2 | 4>(2);
  const [outputFormat, setOutputFormat] = useState<'png' | 'jpg' | 'webp'>('png');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [serviceReady, setServiceReady] = useState(false);

  // Theme classes
  const panelBg = isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-[#d4af37]/30';
  const accentColor = isMonochrome ? 'text-blue-500' : 'text-[#d4af37]';
  const headerBorder = isMonochrome ? 'border-gray-200' : 'border-[#d4af37]/20';
  const footerBorder = isMonochrome ? 'border-gray-200' : 'border-[#d4af37]/20';
  const labelColor = isMonochrome ? 'text-gray-700' : 'text-gray-300';
  const titleColor = isMonochrome ? 'text-gray-900' : 'text-white';
  const inputBg = isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900 focus:ring-blue-300' : 'bg-[#2a2a2a] border-[#d4af37]/20 text-white focus:ring-[#d4af37]/40';
  const optionSelected = isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black';
  const optionUnselected = isMonochrome ? 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100' : 'bg-[#2a2a2a] text-gray-300 border border-[#d4af37]/20 hover:bg-[#333]';
  const confirmBtn = isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-[#d4af37] text-black hover:bg-[#e5c349]';
  const cancelBtn = isMonochrome ? 'text-gray-500 hover:text-gray-900' : 'text-gray-300 hover:text-white';
  const closeBtn = isMonochrome ? 'hover:bg-gray-100 text-gray-400 hover:text-gray-900' : 'hover:bg-white/10 text-gray-400 hover:text-white';

  // 检测服务状态并自动启动
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const healthRes = await fetch('/api/image/health');
        const health = await healthRes.json();
        let upscaylAvailable = health.upscayl?.available ?? false;

        if (!upscaylAvailable) {
          try {
            await fetch('/api/image/start-services', { method: 'POST' });
            const recheck = await fetch('/api/image/health').then(r => r.json());
            upscaylAvailable = recheck.upscayl?.available ?? false;
            if (!cancelled && upscaylAvailable) {
              setAvailableModels(recheck.upscayl?.models || []);
            }
          } catch {
            // 启动失败，忽略
          }
        } else {
          if (!cancelled) {
            setAvailableModels(health.upscayl?.models || []);
          }
        }

        if (!cancelled) {
          setServiceReady(upscaylAvailable);
          if (upscaylAvailable && health.upscayl?.models?.length > 0 && !model) {
            setModel(health.upscayl.models[0]);
          }
        }
      } catch {
        if (!cancelled) {
          setServiceReady(false);
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpscale = useCallback(async () => {
    if (!model) {
      setError('请选择放大模型');
      return;
    }
    setIsProcessing(true);
    setError(null);

    try {
      const res = await fetch('/api/image/upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl,
          model,
          scale,
          outputFormat,
        }),
      });

      const data = await res.json();
      if (data.success && data.imageUrl) {
        onSuccess(data.imageUrl);
      } else {
        setError(data.error || '放大失败');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '网络错误';
      setError(message);
    } finally {
      setIsProcessing(false);
    }
  }, [imageUrl, model, scale, outputFormat, onSuccess]);

  const getModelLabel = (id: string): string => {
    const labels: Record<string, string> = {
      'realesrgan-x4plus': 'RealESRGAN x4+ (写实高清)',
      'realesrgan-x4fast': 'RealESRGAN x4 Fast (快速)',
      'realesrgan-x4plus-anime': 'RealESRGAN x4+ Anime (动漫)',
      'remacri': 'Remacri (通用)',
      'ultramix-balanced': 'UltraMix Balanced (均衡)',
      'ultrasharp': 'UltraSharp (锐利)',
      '4x-UltraSharp': '4x UltraSharp (超清)',
    };
    return labels[id] || id;
  };

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      <div
        className={`border rounded-xl shadow-2xl w-[480px] max-h-[80vh] overflow-hidden ${panelBg}`}
        onClick={e => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${headerBorder}`}>
          <div className="flex items-center gap-2">
            <ZoomIn className={`w-5 h-5 ${accentColor}`} />
            <h3 className={`text-lg font-semibold ${titleColor}`}>无损放大</h3>
          </div>
          <button
            onClick={onClose}
            className={`p-1 rounded-lg transition-colors ${closeBtn}`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="px-6 py-5 space-y-5">
          {!serviceReady && (
            <div className="bg-yellow-900/30 border border-yellow-600/40 rounded-lg p-3 text-sm text-yellow-300">
              本地无损放大引擎不可用，请检查 upscayl-node、Vulkan/Mesa 驱动或 upscayl-models 模型目录。
            </div>
          )}

          {/* 模型选择 */}
          <div>
            <label className={`block text-sm font-medium ${labelColor} mb-2`}>放大模型</label>
            {availableModels.length > 0 ? (
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${inputBg}`}
              >
                {availableModels.map(m => (
                  <option key={m} value={m}>{getModelLabel(m)}</option>
                ))}
              </select>
            ) : (
              <div className={`w-full border rounded-lg px-3 py-2 text-sm ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-400' : 'bg-[#2a2a2a] border-[#d4af37]/20 text-gray-500'}`}>
                {serviceReady ? '正在加载模型...' : '无可用模型'}
              </div>
            )}
          </div>

          {/* 放大倍率 */}
          <div>
            <label className={`block text-sm font-medium ${labelColor} mb-2`}>放大倍率</label>
            <div className="flex gap-3">
              {([2, 4] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setScale(s)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    scale === s ? optionSelected : optionUnselected
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          {/* 输出格式 */}
          <div>
            <label className={`block text-sm font-medium ${labelColor} mb-2`}>输出格式</label>
            <div className="flex gap-3">
              {(['png', 'jpg', 'webp'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setOutputFormat(f)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all uppercase ${
                    outputFormat === f ? optionSelected : optionUnselected
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-600/40 rounded-lg p-3 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className={`px-6 py-4 border-t ${footerBorder} flex justify-end gap-3`}>
          <button
            onClick={onClose}
            className={`px-4 py-2 text-sm transition-colors ${cancelBtn}`}
          >
            取消
          </button>
          <button
            onClick={handleUpscale}
            disabled={isProcessing || !serviceReady || !model}
            className={`px-6 py-2 text-sm font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${confirmBtn}`}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                放大中...
              </>
            ) : (
              '开始放大'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
