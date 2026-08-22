'use client';

import * as React from 'react';
import { Check, Eraser, Loader2, Palette, X } from 'lucide-react';
import NextImage from 'next/image';
import type { CanvasImage, EditMode } from '@/components/infinite-canvas';

interface CanvasEditColorRemoveBgPanelProps {
  editMode: EditMode;
  images: CanvasImage[];
  editImageId: string | null;
  isMonochrome: boolean;
  exitEditMode: () => void;
  colorAdjustProcessing: boolean;
  handleConfirmColorAdjust: () => void | Promise<void>;
  colorBrightness: number;
  setColorBrightness: React.Dispatch<React.SetStateAction<number>>;
  colorContrast: number;
  setColorContrast: React.Dispatch<React.SetStateAction<number>>;
  colorSaturation: number;
  setColorSaturation: React.Dispatch<React.SetStateAction<number>>;
  colorHue: number;
  setColorHue: React.Dispatch<React.SetStateAction<number>>;
  colorTemperature: number;
  setColorTemperature: React.Dispatch<React.SetStateAction<number>>;
  showRemoveBgPicker: boolean;
  setShowRemoveBgPicker: React.Dispatch<React.SetStateAction<boolean>>;
  removeBgModelId: string;
  setRemoveBgModelId: React.Dispatch<React.SetStateAction<string>>;
  removeBgEngine: string;
  removeBgDedicatedLoaded: boolean;
  removeBgDedicatedName: string;
  setRemoveBgTargetImage: React.Dispatch<React.SetStateAction<CanvasImage | null>>;
  addRemoveBgMaskToCanvas: boolean;
  setAddRemoveBgMaskToCanvas: React.Dispatch<React.SetStateAction<boolean>>;
  setEngineDialog: React.Dispatch<React.SetStateAction<'upscale' | 'removebg' | 'segment' | 'svg' | null>>;
  handleRemoveBackground: () => void | Promise<void>;
}

export function CanvasEditColorRemoveBgPanel({
  editMode,
  images,
  editImageId,
  isMonochrome,
  exitEditMode,
  colorAdjustProcessing,
  handleConfirmColorAdjust,
  colorBrightness,
  setColorBrightness,
  colorContrast,
  setColorContrast,
  colorSaturation,
  setColorSaturation,
  colorHue,
  setColorHue,
  colorTemperature,
  setColorTemperature,
  showRemoveBgPicker,
  setShowRemoveBgPicker,
  removeBgModelId,
  setRemoveBgModelId,
  removeBgEngine,
  removeBgDedicatedLoaded,
  removeBgDedicatedName,
  setRemoveBgTargetImage,
  addRemoveBgMaskToCanvas,
  setAddRemoveBgMaskToCanvas,
  setEngineDialog,
  handleRemoveBackground,
}: CanvasEditColorRemoveBgPanelProps): React.ReactElement | null {
  return (
    <>
{/* ====== COLOR ADJUST PANEL (参数调色) ====== */}
        {editMode === 'colorAdjust' && (() => {
          const editImg = images.find(i => i.id === editImageId);
          if (!editImg) return null;
          const isProcessing = colorAdjustProcessing;
          return (
            <div
              data-floating-panel="color-adjust"
              className="fixed bg-[#1a1a1a] text-white rounded-2xl shadow-2xl overflow-hidden z-[180] border border-[#333] flex flex-col motion-reduce:transition-none"
              style={{ top: '120px', right: 'max(24px, env(safe-area-inset-right))', width: '360px' }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-3 border-b border-[#333] bg-[#111]">
                <div className="flex items-center gap-2">
                  <Palette size={18} className="text-[#d4af37]" />
                  <h3 className="font-semibold text-sm">参数调色</h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#888]">Esc 退出</span>
                  <button onClick={exitEditMode} className="text-[#888] hover:text-white transition-colors">
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="p-4 overflow-y-auto flex flex-col gap-4" style={{ maxHeight: '60vh' }}>
                {/* 实时预览 - 使用CSS filter即时反馈 */}
                <div className="w-full aspect-video rounded-lg overflow-hidden bg-black/40 flex items-center justify-center border border-[#333] relative">
                  <NextImage unoptimized width={1} height={1}                     src={editImg.url}
                    alt="预览"
                    className="max-w-full max-h-full object-contain transition-all duration-100"
                    crossOrigin="anonymous"
                    style={{
                      filter: `brightness(${1 + colorBrightness / 200}) contrast(${1 + colorContrast / 100}) saturate(${1 + colorSaturation / 100}) hue-rotate(${colorHue}deg)${colorTemperature > 0 ? ` sepia(${colorTemperature / 200}) saturate(${1 + colorTemperature / 300})` : colorTemperature < 0 ? ` hue-rotate(${-colorTemperature * 0.5}deg) saturate(${1 - colorTemperature / 500})` : ''}`,
                    }}
                  />
                  <div className="absolute bottom-2 left-2 text-[10px] text-white/70 bg-black/50 px-2 py-0.5 rounded">近似预览</div>
                  {isProcessing && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 className="animate-spin text-[#d4af37]" size={28} />
                    </div>
                  )}
                </div>

                {/* 滑杆区域 */}
                <div className="grid grid-cols-1 gap-3">
                  {/* 亮度 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#aaa]">亮度</span>
                      <span className="text-xs text-[#d4af37] font-mono">{colorBrightness > 0 ? '+' : ''}{colorBrightness}</span>
                    </div>
                    <input type="range" min={-100} max={100} value={colorBrightness} onChange={e => setColorBrightness(Number(e.target.value))} className="w-full accent-[#d4af37]" />
                  </div>
                  {/* 对比度 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#aaa]">对比度</span>
                      <span className="text-xs text-[#d4af37] font-mono">{colorContrast > 0 ? '+' : ''}{colorContrast}</span>
                    </div>
                    <input type="range" min={-100} max={100} value={colorContrast} onChange={e => setColorContrast(Number(e.target.value))} className="w-full accent-[#d4af37]" />
                  </div>
                  {/* 饱和度 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#aaa]">饱和度</span>
                      <span className="text-xs text-[#d4af37] font-mono">{colorSaturation > 0 ? '+' : ''}{colorSaturation}</span>
                    </div>
                    <input type="range" min={-100} max={100} value={colorSaturation} onChange={e => setColorSaturation(Number(e.target.value))} className="w-full accent-[#d4af37]" />
                  </div>
                  {/* 色温 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#aaa]">色温</span>
                      <span className="text-xs text-[#d4af37] font-mono">{colorTemperature > 0 ? '+' : ''}{colorTemperature}</span>
                    </div>
                    <input type="range" min={-100} max={100} value={colorTemperature} onChange={e => setColorTemperature(Number(e.target.value))} className="w-full accent-[#d4af37]" />
                  </div>
                  {/* 色相 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#aaa]">色相</span>
                      <span className="text-xs text-[#d4af37] font-mono">{colorHue > 0 ? '+' : ''}{colorHue}</span>
                    </div>
                    <input type="range" min={-180} max={180} value={colorHue} onChange={e => setColorHue(Number(e.target.value))} className="w-full accent-[#d4af37]" />
                  </div>
                </div>

                {/* 重置按钮 */}
                <button
                  onClick={() => { setColorBrightness(0); setColorContrast(0); setColorSaturation(0); setColorTemperature(0); setColorHue(0); }}
                  className="text-xs text-[#888] hover:text-white py-1 transition-colors"
                >
                  ↺ 重置所有参数
                </button>
              </div>

              <div className="p-4 border-t border-[#333] bg-[#111]">
                <button
                  onClick={handleConfirmColorAdjust}
                  disabled={colorAdjustProcessing}
                  className="w-full py-3 rounded-lg bg-[#d4af37] text-black font-semibold text-sm hover:bg-[#e5c048] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {colorAdjustProcessing ? (
                    <><Loader2 size={16} className="animate-spin" /> 调色处理中...</>
                  ) : (
                    '应用调色'
                  )}
                </button>
              </div>
            </div>
          );
        })()}

        {/* ====== REMOVE BACKGROUND MODEL PICKER ====== */}
        {showRemoveBgPicker && (() => {
          const removeBgModels: Array<{ id: string; label: string; description: string; size: string; recommended?: boolean }> = [
            { id: 'birefnet-general-lite', label: 'BiRefNet 通用 Lite', description: '轻量快速版，默认首选', size: '约 224MB', recommended: true },
            { id: 'birefnet-general', label: 'BiRefNet 通用', description: '完整通用模型，优先保留主体和细节', size: '约 1GB' },
            { id: 'birefnet-portrait', label: 'BiRefNet 人像', description: '针对头发和人物边缘优化', size: '约 1GB' },
            { id: 'birefnet-massive', label: 'BiRefNet Massive', description: '复杂主体优先，CPU 处理时间更长', size: '约 1GB+' },
          ];
          return (
            <div data-floating-panel="remove-bg" className="fixed inset-0 z-[200] flex items-center justify-center" onMouseDown={(e) => e.stopPropagation()}>
              <div className="absolute inset-0 bg-black/40" onClick={() => setShowRemoveBgPicker(false)} />
              <div className={`relative rounded-2xl border shadow-2xl overflow-hidden ${isMonochrome ? 'bg-gray-100 border-gray-300' : 'bg-[#1a1a1a] border-[#444]'}`} style={{ width: 420, maxHeight: '80vh' }}>
                {/* Title */}
                <div className={`flex items-center justify-between px-4 py-3 border-b ${isMonochrome ? 'border-gray-200 bg-white' : 'border-[#444] bg-[#222]'}`}>
                  <div className="flex items-center gap-2">
                    <Eraser size={14} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />
                    <span className={`text-sm font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>选择去背景模型</span>
                  </div>
                  <button onClick={() => setShowRemoveBgPicker(false)} className={`p-1 rounded-lg transition-colors ${isMonochrome ? 'text-blue-500 hover:text-blue-700 hover:bg-blue-50' : 'text-gold-muted/70 hover:text-white hover:bg-[#282828]/85'}`}>
                    <X size={16} />
                  </button>
                </div>
                {/* 引擎状态区（含 remove.bg 专用引擎体现） */}
                <div className={`px-3 py-2.5 border-b ${isMonochrome ? 'border-gray-200 bg-gray-50' : 'border-[#444] bg-[#1f1f1f]'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-[11px] font-medium ${isMonochrome ? 'text-gray-500' : 'text-gold-muted/80'}`}>处理引擎</span>
                    <button
                      onClick={() => setEngineDialog('removebg')}
                      className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md transition-colors ${
                        isMonochrome
                          ? 'bg-white border border-gray-300 text-blue-600 hover:bg-blue-50'
                          : 'bg-[#282828] border border-[#555] text-gold hover:bg-[#333]'
                      }`}
                    >
                      <span>引擎:</span>
                      <span className="font-semibold">
                        {removeBgEngine === 'auto' ? '智能自动' : removeBgEngine === 'ai' ? '云端 AI' : '本地算法'}
                      </span>
                    </button>
                  </div>
                  <div className={`flex items-start gap-1.5 text-[11px] leading-snug ${isMonochrome ? 'text-gray-600' : 'text-gray-300'}`}>
                    {removeBgDedicatedName ? (
                      <>
                        <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${isMonochrome ? 'bg-green-600' : 'bg-green-400'}`} />
                        <span>专用 <span className={isMonochrome ? 'text-green-700 font-medium' : 'text-green-400 font-medium'}>{removeBgDedicatedName}</span> 已启用，将优先调用云端抠图 API</span>
                      </>
                    ) : removeBgDedicatedLoaded ? (
                      <>
                        <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${isMonochrome ? 'bg-amber-500' : 'bg-amber-400/80'}`} />
                        <span>remove.bg 专用引擎未配置，可在管理员面板添加「抠图」类型提供商启用（当前走本地模型 / 通用 AI）</span>
                      </>
                    ) : (
                      <span>正在检测专用引擎…</span>
                    )}
                  </div>
                </div>
                {/* Model list */}
                <div className="p-3 space-y-2">
                  {removeBgModels.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setRemoveBgModelId(m.id)}
                      className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
                        removeBgModelId === m.id
                          ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-gold text-black'
                          : isMonochrome
                            ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{m.label}</span>
                          {'recommended' in m && m.recommended && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                              removeBgModelId === m.id
                                ? 'bg-black/20 text-black/70'
                                : isMonochrome
                                  ? 'bg-gray-200 text-gray-500'
                                  : 'bg-[#333] text-gold-muted'
                            }`}>推荐</span>
                          )}
                        </div>
                        <div className={`text-[11px] mt-0.5 ${removeBgModelId === m.id ? 'text-black/60' : isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>
                          {m.description} · {m.size}
                        </div>
                      </div>
                      {removeBgModelId === m.id && (
                        <Check size={16} className="flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
                {/* Footer with confirm */}
                <div className={`px-4 py-3 border-t ${isMonochrome ? 'border-gray-200 bg-white' : 'border-[#444] bg-[#222]'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`}>当前选择:</span>
                    <span className={`text-xs font-medium ${isMonochrome ? 'text-blue-600' : 'text-gold'}`}>
                      {removeBgModels.find(m => m.id === removeBgModelId)?.label || removeBgModelId}
                    </span>
                  </div>
                  <label className={`mb-3 flex cursor-pointer items-center gap-2 text-xs ${isMonochrome ? 'text-gray-600' : 'text-[#bbb]'}`}>
                    <input
                      type="checkbox"
                      aria-label="同时将黑白蒙版加入画布"
                      checked={addRemoveBgMaskToCanvas}
                      onChange={(event) => setAddRemoveBgMaskToCanvas(event.target.checked)}
                      className="h-4 w-4 accent-[#d4af37]"
                    />
                    同时将黑白蒙版加入画布
                  </label>
                  <button
                    onClick={() => {
                      setShowRemoveBgPicker(false);
                      handleRemoveBackground();
                      setRemoveBgTargetImage(null);
                    }}
                    className={`w-full py-2.5 text-sm font-semibold rounded-xl active:scale-[0.98] transition-all ${isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gold text-black hover:bg-[#e5c047]'}`}
                  >
                    开始去背景
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </>
  );
}
