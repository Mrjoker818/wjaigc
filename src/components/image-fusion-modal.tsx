'use client';

import { useState, useEffect } from 'react';
import { X, Sparkles } from 'lucide-react';

interface ImageFusionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (params: { 
    prompt: string; 
    aspectRatio: string; 
    quality: string; 
    count: number;
    referenceImages: string[];
  }) => void;
  selectedImages: { id: string; url: string }[];
  isGenerating?: boolean;
}

const ASPECT_RATIO_OPTIONS = [
  { value: '1:1', label: '1:1 正方形' },
  { value: '4:3', label: '4:3 横向' },
  { value: '3:4', label: '3:4 竖向' },
  { value: '16:9', label: '16:9 宽屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '3:2', label: '3:2 标准' },
  { value: '2:3', label: '2:3 竖版' },
];

const QUALITY_OPTIONS = [
  { value: 'standard', label: '标准' },
  { value: 'hd', label: '高清' },
  { value: 'ultra', label: '超清' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
];

export function ImageFusionModal({
  isOpen,
  onClose,
  onConfirm,
  selectedImages,
  isGenerating = false,
}: ImageFusionModalProps) {
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [quality, setQuality] = useState('hd');
  const [count, setCount] = useState(1);

  // 重置状态
  useEffect(() => {
    if (isOpen) {
      setPrompt('');
      setAspectRatio('1:1');
      setQuality('hd');
      setCount(1);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm({
      prompt,
      aspectRatio,
      quality,
      count,
      referenceImages: selectedImages.map(img => img.url),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a] bg-gradient-to-r from-[#1a1a1a] to-[#141414]">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#d4af37]" />
            图片融合
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#2a2a2a] transition-colors"
          >
            <X className="h-5 w-5 text-[#888]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* Selected Images Info */}
          <div className="flex items-center gap-2 text-sm text-[#888]">
            <span className="px-2 py-1 bg-[#d4af37]/20 text-[#d4af37] rounded">
              已选中 {selectedImages.length} 张图片
            </span>
          </div>

          {/* Prompt Input */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-[#d4af37] uppercase tracking-wider">
              融合描述
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="请输入图片融合的描述词..."
              className="w-full h-24 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-3 text-sm text-white placeholder:text-[#555] focus:border-[#d4af37] focus:outline-none resize-none transition-colors"
            />
          </div>

          {/* Aspect Ratio */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-[#d4af37] uppercase tracking-wider">
              图片比例
            </label>
            <div className="grid grid-cols-4 gap-2">
              {ASPECT_RATIO_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setAspectRatio(opt.value)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    aspectRatio === opt.value
                      ? 'bg-gradient-to-r from-[#d4af37] to-[#b8860b] text-black border border-[#d4af37]'
                      : 'bg-[#1a1a1a] text-[#888] border border-[#2a2a2a] hover:border-[#d4af37] hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quality */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-[#d4af37] uppercase tracking-wider">
              画质
            </label>
            <div className="flex gap-2">
              {QUALITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setQuality(opt.value)}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    quality === opt.value
                      ? 'bg-gradient-to-r from-[#d4af37] to-[#b8860b] text-black border border-[#d4af37]'
                      : 'bg-[#1a1a1a] text-[#888] border border-[#2a2a2a] hover:border-[#d4af37] hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Count */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-[#d4af37] uppercase tracking-wider">
              生图数量
            </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map(num => (
                <button
                  key={num}
                  onClick={() => setCount(num)}
                  className={`flex-1 px-3 py-3 rounded-lg text-sm font-bold transition-all ${
                    count === num
                      ? 'bg-gradient-to-r from-[#d4af37] to-[#b8860b] text-black border border-[#d4af37]'
                      : 'bg-[#1a1a1a] text-[#888] border border-[#2a2a2a] hover:border-[#d4af37] hover:text-white'
                  }`}
                >
                  {num}张
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-[#2a2a2a] bg-[#1a1a1a]">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg border border-[#2a2a2a] text-[#888] text-sm font-medium hover:bg-[#2a2a2a] hover:text-white transition-all"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={isGenerating}
            className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[#d4af37] to-[#b8860b] text-black text-sm font-semibold hover:from-[#daa520] hover:to-[#cd9b1d] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <span className="animate-spin">⟳</span>
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                开始融合
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
