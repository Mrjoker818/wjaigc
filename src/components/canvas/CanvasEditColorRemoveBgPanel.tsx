'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Eraser, Loader2, Palette, X } from 'lucide-react';
import NextImage from 'next/image';
import type { CanvasImage, EditMode } from '@/components/infinite-canvas';
import { getCanvasEditImageSource } from '@/lib/canvas-edit-image-source';

function subscribeColorViewport(notify: () => void): () => void {
  window.addEventListener('resize', notify);
  return () => window.removeEventListener('resize', notify);
}
function getColorViewportSnapshot(): number {
  return window.innerWidth;
}
function getServerColorViewportSnapshot(): number {
  return 0;
}

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
  documentMetadataMode: boolean;
  removeBgQuote: { total: number } | null;
  isRemoveBgQuoteLoading: boolean;
  isRemoveBgSubmitting: boolean;
  removeBgDedicatedLoaded: boolean;
  removeBgDedicatedName: string;
  addRemoveBgMaskToCanvas: boolean;
  setAddRemoveBgMaskToCanvas: React.Dispatch<React.SetStateAction<boolean>>;
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
  documentMetadataMode,
  removeBgQuote,
  isRemoveBgQuoteLoading,
  isRemoveBgSubmitting,
  removeBgDedicatedLoaded,
  removeBgDedicatedName,
  addRemoveBgMaskToCanvas,
  setAddRemoveBgMaskToCanvas,
  handleRemoveBackground,
}: CanvasEditColorRemoveBgPanelProps): React.ReactElement | null {
  const viewportWidth = React.useSyncExternalStore(
    subscribeColorViewport, getColorViewportSnapshot, getServerColorViewportSnapshot,
  );
  const isMobilePanel = viewportWidth > 0 && viewportWidth < 768;
  const panel = (
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
              style={{
                top: isMobilePanel ? 'max(12px, env(safe-area-inset-top))' : '120px',
                right: isMobilePanel ? 'max(12px, env(safe-area-inset-right))' : 'max(24px, env(safe-area-inset-right))',
                width: isMobilePanel ? 'calc(100vw - max(12px, env(safe-area-inset-left)) - max(12px, env(safe-area-inset-right)))' : 'min(360px, calc(100vw - 48px))',
                height: isMobilePanel ? 'calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom))' : undefined,
                touchAction: isMobilePanel ? 'pan-y' : undefined,
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between px-5 py-3 border-b border-[#333] bg-[#111]">
                <div className="flex items-center gap-2">
                  <Palette size={18} className="text-[#d4af37]" />
                  <h3 className="font-semibold text-sm">参数调色</h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#888]">Esc 退出</span>
                  <button onClick={exitEditMode} aria-label="关闭参数调色" className="text-[#888] hover:text-white transition-colors" style={isMobilePanel ? { minWidth: 44, minHeight: 44 } : undefined}>
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="min-h-0 p-4 overflow-y-auto overscroll-contain flex flex-col gap-4" style={{ maxHeight: isMobilePanel ? undefined : '60vh', flex: isMobilePanel ? '1 1 0%' : undefined, touchAction: isMobilePanel ? 'pan-y' : undefined }}>
                {/* 实时预览 - 使用CSS filter即时反馈 */}
                <div className="w-full shrink-0 aspect-video rounded-lg overflow-hidden bg-black/40 flex items-center justify-center border border-[#333] relative">
                  <NextImage unoptimized fill
                    src={getCanvasEditImageSource(editImg.url)}
                    alt="预览"
                    className="object-contain transition-all duration-100"
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
                <div className="grid shrink-0 grid-cols-1 gap-3">
                  {/* 亮度 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#aaa]">亮度</span>
                      <span className="text-xs text-[#d4af37] font-mono">{colorBrightness > 0 ? '+' : ''}{colorBrightness}</span>
                    </div>
                    <input type="range" aria-label="亮度" min={-100} max={100} value={colorBrightness} onChange={e => setColorBrightness(Number(e.target.value))} className="w-full accent-[#d4af37]" style={isMobilePanel ? { height: 44, minHeight: 44, touchAction: 'pan-y' } : undefined} />
                  </div>
                  {/* 对比度 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#aaa]">对比度</span>
                      <span className="text-xs text-[#d4af37] font-mono">{colorContrast > 0 ? '+' : ''}{colorContrast}</span>
                    </div>
                    <input type="range" aria-label="对比度" min={-100} max={100} value={colorContrast} onChange={e => setColorContrast(Number(e.target.value))} className="w-full accent-[#d4af37]" style={isMobilePanel ? { height: 44, minHeight: 44, touchAction: 'pan-y' } : undefined} />
                  </div>
                  {/* 饱和度 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#aaa]">饱和度</span>
                      <span className="text-xs text-[#d4af37] font-mono">{colorSaturation > 0 ? '+' : ''}{colorSaturation}</span>
                    </div>
                    <input type="range" aria-label="饱和度" min={-100} max={100} value={colorSaturation} onChange={e => setColorSaturation(Number(e.target.value))} className="w-full accent-[#d4af37]" style={isMobilePanel ? { height: 44, minHeight: 44, touchAction: 'pan-y' } : undefined} />
                  </div>
                  {/* 色温 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#aaa]">色温</span>
                      <span className="text-xs text-[#d4af37] font-mono">{colorTemperature > 0 ? '+' : ''}{colorTemperature}</span>
                    </div>
                    <input type="range" aria-label="色温" min={-100} max={100} value={colorTemperature} onChange={e => setColorTemperature(Number(e.target.value))} className="w-full accent-[#d4af37]" style={isMobilePanel ? { height: 44, minHeight: 44, touchAction: 'pan-y' } : undefined} />
                  </div>
                  {/* 色相 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#aaa]">色相</span>
                      <span className="text-xs text-[#d4af37] font-mono">{colorHue > 0 ? '+' : ''}{colorHue}</span>
                    </div>
                    <input type="range" aria-label="色相" min={-180} max={180} value={colorHue} onChange={e => setColorHue(Number(e.target.value))} className="w-full accent-[#d4af37]" style={isMobilePanel ? { height: 44, minHeight: 44, touchAction: 'pan-y' } : undefined} />
                  </div>
                </div>

                {/* 重置按钮 */}
                <button
                  onClick={() => { setColorBrightness(0); setColorContrast(0); setColorSaturation(0); setColorTemperature(0); setColorHue(0); }}
                  className="shrink-0 text-xs text-[#888] hover:text-white py-1 transition-colors"
                  style={isMobilePanel ? { minHeight: 44 } : undefined}
                >
                  ↺ 重置所有参数
                </button>
              </div>

              <div className="shrink-0 p-4 border-t border-[#333] bg-[#111]">
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

        {/* ====== REMOVE BACKGROUND PICKER（本地模型已移除，云端引擎直连）====== */}
        {showRemoveBgPicker && (() => {
          return (
            <div data-floating-panel="remove-bg" className="fixed inset-0 z-[200] flex items-center justify-center" onMouseDown={(e) => e.stopPropagation()}>
              <div className="absolute inset-0 bg-black/40" onClick={() => setShowRemoveBgPicker(false)} />
              <div className={`relative rounded-2xl border shadow-2xl overflow-hidden motion-reduce:transition-none ${isMonochrome ? 'bg-gray-100 border-gray-300' : 'bg-[#1a1a1a] border-[#444]'}`} style={{ width: isMobilePanel ? 'min(420px, calc(100vw - 24px))' : 420, maxHeight: isMobilePanel ? 'calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom))' : '80vh', display: isMobilePanel ? 'flex' : undefined, flexDirection: isMobilePanel ? 'column' : undefined, touchAction: isMobilePanel ? 'pan-y' : undefined }}>
                {/* Title */}
                <div className={`flex shrink-0 items-center justify-between px-4 py-3 border-b ${isMonochrome ? 'border-gray-200 bg-white' : 'border-[#444] bg-[#222]'}`}>
                  <div className="flex items-center gap-2">
                    <Eraser size={14} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />
                    <span className={`text-sm font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>去背景</span>
                  </div>
                  <button onClick={() => setShowRemoveBgPicker(false)} aria-label="关闭去背景" style={isMobilePanel ? { minWidth: 44, minHeight: 44 } : undefined} className={`p-1 rounded-lg transition-colors ${isMonochrome ? 'text-blue-500 hover:text-blue-700 hover:bg-blue-50' : 'text-gold-muted/70 hover:text-white hover:bg-[#282828]/85'}`}>
                    <X size={16} />
                  </button>
                </div>
                <div style={isMobilePanel ? { minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', touchAction: 'pan-y' } : undefined}>
                {/* 引擎状态区（云端专用引擎） */}
                <div className={`px-3 py-2.5 border-b ${isMonochrome ? 'border-gray-200 bg-gray-50' : 'border-[#444] bg-[#1f1f1f]'}`}>
                  <div className={`flex items-start gap-1.5 text-[11px] leading-snug ${isMonochrome ? 'text-gray-600' : 'text-gray-300'}`}>
                    {removeBgDedicatedName ? (
                      <>
                        <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${isMonochrome ? 'bg-green-600' : 'bg-green-400'}`} />
                        <span>专用 <span className={isMonochrome ? 'text-green-700 font-medium' : 'text-green-400 font-medium'}>{removeBgDedicatedName}</span> 已启用，将优先调用云端抠图 API</span>
                      </>
                    ) : removeBgDedicatedLoaded ? (
                      <>
                        <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${isMonochrome ? 'bg-amber-500' : 'bg-amber-400/80'}`} />
                        <span>专用抠图引擎未配置，可在管理员面板添加「抠图」类型提供商启用（当前走通用 AI）</span>
                      </>
                    ) : (
                      <span>正在检测专用引擎…</span>
                    )}
                  </div>
                </div>
                {/* Footer with confirm */}
                <div className={`px-4 py-3 border-t ${isMonochrome ? 'border-gray-200 bg-white' : 'border-[#444] bg-[#222]'}`}>
                  {documentMetadataMode && <p className={`mb-2 text-xs ${isMonochrome ? 'text-gray-600' : 'text-[#bbb]'}`}>
                    协作文档去背景完成后，主体图与黑白蒙版将一起发布到文档。
                  </p>}
                  {removeBgQuote && documentMetadataMode && <p className={`mb-2 text-sm font-semibold ${isMonochrome ? 'text-blue-700' : 'text-gold'}`}>
                    本次报价：{removeBgQuote.total} 积分
                  </p>}
                  {!documentMetadataMode && <label style={isMobilePanel ? { minHeight: 44 } : undefined} className={`mb-3 flex cursor-pointer items-center gap-2 text-xs ${isMonochrome ? 'text-gray-600' : 'text-[#bbb]'}`}>
                    <input
                      type="checkbox"
                      aria-label="同时将黑白蒙版加入画布"
                      checked={addRemoveBgMaskToCanvas}
                      onChange={(event) => setAddRemoveBgMaskToCanvas(event.target.checked)}
                      className="h-4 w-4 accent-[#d4af37]"
                    />
                    同时将黑白蒙版加入画布
                  </label>}
                  <button
                    onClick={() => { void handleRemoveBackground(); }}
                    disabled={isRemoveBgQuoteLoading || isRemoveBgSubmitting}
                    aria-busy={isRemoveBgQuoteLoading || isRemoveBgSubmitting}
                    style={isMobilePanel ? { minHeight: 44 } : undefined}
                    className={`w-full py-2.5 text-sm font-semibold rounded-xl active:scale-[0.98] transition-all disabled:opacity-50 ${isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gold text-black hover:bg-[#e5c047]'}`}
                  >
                    {isRemoveBgQuoteLoading ? '正在获取报价…' : isRemoveBgSubmitting ? '正在提交去背景…'
                      : documentMetadataMode && removeBgQuote ? '确认报价并开始去背景'
                        : documentMetadataMode ? '查看去背景报价' : '开始去背景'}
                  </button>
                </div>
                </div>
              </div>
            </div>
          );
        })()}
    </>
  );
  return isMobilePanel ? createPortal(panel, document.body) : panel;
}
