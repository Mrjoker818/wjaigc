'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, ZoomIn } from 'lucide-react';
import type { UpscaleModel } from '@/types/image-tools';
import { UPSCALE_MODELS } from '@/types/image-tools';

export interface UpscaleDialogProps {
  imageUrl: string;
  onClose: () => void;
  onSuccess: (resultImageUrl: string) => void;
}

export default function UpscaleDialog({ imageUrl, onClose, onSuccess }: UpscaleDialogProps) {
  const [model, setModel] = useState<UpscaleModel>('remacri');
  const [scale, setScale] = useState<2 | 4>(2);
  const [outputFormat, setOutputFormat] = useState<'png' | 'jpg' | 'webp'>('png');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<{
    upscaylAvailable: boolean;
  } | null>(null);

  // 检测服务状态并自动启动
  useEffect(() => {
    fetch('/api/image/health')
      .then(r => r.json())
      .then(async (data) => {
        const upscaylAvailable = data.upscayl?.available ?? false;
        if (!upscaylAvailable) {
          // 尝试自动启动服务
          try {
            await fetch('/api/image/start-services', { method: 'POST' });
            // 重新检测
            const recheck = await fetch('/api/image/health').then(r => r.json());
            setHealthStatus({
              upscaylAvailable: recheck.upscayl?.available ?? false,
            });
          } catch {
            setHealthStatus({ upscaylAvailable: false });
          }
        } else {
          setHealthStatus({ upscaylAvailable: true });
        }
      })
      .catch(() => {
        setHealthStatus({ upscaylAvailable: false });
      });
  }, []);

  const handleUpscale = useCallback(async () => {
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

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] border border-[#d4af37]/30 rounded-xl shadow-2xl w-[480px] max-h-[80vh] overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#d4af37]/20">
          <div className="flex items-center gap-2">
            <ZoomIn className="w-5 h-5 text-[#d4af37]" />
            <h3 className="text-lg font-semibold text-white">无损放大</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="px-6 py-5 space-y-5">
          {/* 服务状态 */}
          {healthStatus && !healthStatus.upscaylAvailable && (
            <div className="bg-yellow-900/30 border border-yellow-600/40 rounded-lg p-3 text-sm text-yellow-300">
              本地无损放大引擎不可用，请检查 upscayl-node、Vulkan/Mesa 驱动或 upscayl-models 模型目录。
            </div>
          )}

          {/* 模型选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">放大模型</label>
            <select
              value={model}
              onChange={e => setModel(e.target.value as UpscaleModel)}
              className="w-full bg-[#2a2a2a] border border-[#d4af37]/20 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4af37]/40"
            >
              {UPSCALE_MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* 放大倍率 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">放大倍率</label>
            <div className="flex gap-3">
              {([2, 4] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setScale(s)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    scale === s
                      ? 'bg-[#d4af37] text-black'
                      : 'bg-[#2a2a2a] text-gray-300 border border-[#d4af37]/20 hover:bg-[#333]'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          {/* 输出格式 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">输出格式</label>
            <div className="flex gap-3">
              {(['png', 'jpg', 'webp'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setOutputFormat(f)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all uppercase ${
                    outputFormat === f
                      ? 'bg-[#d4af37] text-black'
                      : 'bg-[#2a2a2a] text-gray-300 border border-[#d4af37]/20 hover:bg-[#333]'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* 错误信息 */}
          {error && (
            <div className="bg-red-900/30 border border-red-600/40 rounded-lg p-3 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-[#d4af37]/20 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleUpscale}
            disabled={isProcessing || (healthStatus !== null && !healthStatus.upscaylAvailable)}
            className="px-6 py-2 bg-[#d4af37] text-black text-sm font-semibold rounded-lg hover:bg-[#e5c349] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
