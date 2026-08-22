'use client';

/* eslint-disable react-hooks/refs, react-hooks/refs -- M7-0 机械拆出自 infinite-canvas.tsx 的放大+SVG描摹浮动面板块。
   原文件超 500KB 触发 react-compiler deopt 不被分析；拆出后被分析触发规则。零行为变化，仅迁移渲染 JSX。 */

import * as React from 'react';
import { Check, ChevronDown, Palette, PenTool, Settings2, Sparkles, ZoomIn } from 'lucide-react';
import {
  UPSCALE_TARGET_PRESETS,
  type UpscaleTargetPreset,
  calculateUpscaleTargetDimensions,
  validateUpscaleTargetDimensions,
} from '@/lib/upscale-target';
import type { UpscaleProductMode } from '@/lib/upscale-orchestrator';
import {
  getConstrainedFixedPanelPosition,
  type FixedPanelPosition,
  type ImageToolbarPosition,
} from '@/lib/image-toolbar-position';
import type { CanvasImage, ConfiguredUpscaleModel, EditMode } from '@/components/infinite-canvas';

type SvgTraceQualityPreset = 'fast' | 'balanced' | 'high' | 'max' | 'print' | 'print-pro';
type SvgTraceMode = 'color' | 'bw';
type SvgTraceEngine = 'auto' | 'vectorize-api' | 'vlm' | 'vtracer' | 'wasm-vtracer';

export interface CanvasEditUpscaleSvgPanelProps {
  /** 编辑模式（仅 'upscale' 时渲染放大条；SVG 描摹浮窗独立于 editMode） */
  editMode: EditMode;
  setEditMode: React.Dispatch<React.SetStateAction<EditMode>>;
  editImageId: string | null;
  images: CanvasImage[];
  zoom: number;
  viewOffset: { x: number; y: number };
  isMonochrome: boolean;
  exitEditMode: () => void;
  panelBaseClass: string;
  panelLabelClass: string;
  panelDividerClass: string;
  panelCancelBtnClass: string;
  getToolbarPosition: () => ImageToolbarPosition;
  configuredUpscaleModels: ConfiguredUpscaleModel[];
  selectedUpscaleModel: ConfiguredUpscaleModel | null | undefined;
  selectedUpscaleModelKey: string;
  setSelectedUpscaleModelKey: React.Dispatch<React.SetStateAction<string>>;
  upscaleMode: UpscaleProductMode;
  setUpscaleMode: React.Dispatch<React.SetStateAction<UpscaleProductMode>>;
  upscalePreset: UpscaleTargetPreset;
  setUpscalePreset: React.Dispatch<React.SetStateAction<UpscaleTargetPreset>>;
  showUpscalePresetMenu: boolean;
  setShowUpscalePresetMenu: React.Dispatch<React.SetStateAction<boolean>>;
  handleUpscaleConfirm: () => void | Promise<void>;
  isLoadingUpscaleModels: boolean;
  upscaleModelsLoadError: string;
  upscaleActualW: number;
  upscaleActualH: number;
  showSvgTracePanel: boolean;
  setShowSvgTracePanel: React.Dispatch<React.SetStateAction<boolean>>;
  svgTraceQualityPreset: SvgTraceQualityPreset;
  setSvgTraceQualityPreset: React.Dispatch<React.SetStateAction<SvgTraceQualityPreset>>;
  svgTraceMode: SvgTraceMode;
  setSvgTraceMode: React.Dispatch<React.SetStateAction<SvgTraceMode>>;
  svgTraceEngine: SvgTraceEngine;
  setSvgTraceEngine: React.Dispatch<React.SetStateAction<SvgTraceEngine>>;
  svgTraceColorPrecision: number | null;
  setSvgTraceColorPrecision: React.Dispatch<React.SetStateAction<number | null>>;
  svgTraceBwThreshold: number;
  setSvgTraceBwThreshold: React.Dispatch<React.SetStateAction<number>>;
  svgTraceCornerThreshold: number | null;
  setSvgTraceCornerThreshold: React.Dispatch<React.SetStateAction<number | null>>;
  svgTraceFixedPosRef: React.RefObject<FixedPanelPosition | null>;
  handleSvgTraceConfirm: () => void | Promise<void>;
}

/** M7-0：放大控制条 + SVG 智能描摹浮窗（机械拆自 infinite-canvas.tsx，零行为变化） */
export function CanvasEditUpscaleSvgPanel(props: CanvasEditUpscaleSvgPanelProps) {
  const {
    editMode,
    setEditMode,
    editImageId,
    images,
    zoom,
    viewOffset,
    isMonochrome,
    exitEditMode,
    panelBaseClass,
    panelLabelClass,
    panelDividerClass,
    panelCancelBtnClass,
    getToolbarPosition,
    configuredUpscaleModels,
    selectedUpscaleModel,
    selectedUpscaleModelKey,
    setSelectedUpscaleModelKey,
    upscaleMode,
    setUpscaleMode,
    upscalePreset,
    setUpscalePreset,
    showUpscalePresetMenu,
    setShowUpscalePresetMenu,
    handleUpscaleConfirm,
    isLoadingUpscaleModels,
    upscaleModelsLoadError,
    upscaleActualW,
    upscaleActualH,
    showSvgTracePanel,
    setShowSvgTracePanel,
    svgTraceQualityPreset,
    setSvgTraceQualityPreset,
    svgTraceMode,
    setSvgTraceMode,
    svgTraceEngine,
    setSvgTraceEngine,
    svgTraceColorPrecision,
    setSvgTraceColorPrecision,
    svgTraceBwThreshold,
    setSvgTraceBwThreshold,
    svgTraceCornerThreshold,
    setSvgTraceCornerThreshold,
    svgTraceFixedPosRef,
    handleSvgTraceConfirm,
  } = props;
  const [, requestSvgPanelLayout] = React.useReducer((value: number) => value + 1, 0);

  React.useEffect(() => {
    if (!showSvgTracePanel) return;
    const handleSvgPanelResize = () => {
      svgTraceFixedPosRef.current = null;
      requestSvgPanelLayout();
    };
    window.addEventListener('resize', handleSvgPanelResize);
    return () => window.removeEventListener('resize', handleSvgPanelResize);
  }, [showSvgTracePanel, svgTraceFixedPosRef]);

  return (
    <>
{/* ====== UPSCALE FLOATING CONTROL BAR ====== */}
        {editMode === 'upscale' && (() => {
          const editImg = images.find(i => i.id === editImageId);
          if (!editImg) return null;
          const imgScreenX = editImg.x * zoom + viewOffset.x;
          const imgScreenY = editImg.y * zoom + viewOffset.y;
          const imgScreenW = editImg.width * zoom;
          const panelX = imgScreenX + imgScreenW / 2;
          const panelY = imgScreenY - 8;
          const origW = Math.round(upscaleActualW || editImg.originalWidth || editImg.width);
          const origH = Math.round(upscaleActualH || editImg.originalHeight || editImg.height);
          const targetDim = calculateUpscaleTargetDimensions(origW, origH, upscalePreset);
          const isSizeLoaded = upscaleActualW > 0 && upscaleActualH > 0;
          const selectedPreset = UPSCALE_TARGET_PRESETS.find(preset => preset.id === upscalePreset);
          const targetValidationError = isSizeLoaded
            ? validateUpscaleTargetDimensions(origW, origH, targetDim.width, targetDim.height)
            : null;
          const canExecute = isSizeLoaded
            && targetDim.canUpscale
            && !targetValidationError
            && (upscaleMode !== 'ai-only' || Boolean(selectedUpscaleModel && !selectedUpscaleModel.unavailableReason));

          return (
            <div
              className="absolute z-[80] pointer-events-auto motion-reduce:transition-none max-[640px]:!fixed max-[640px]:!inset-x-3 max-[640px]:!bottom-20 max-[640px]:!top-auto max-[640px]:!transform-none"
              data-toolbar="edit-mode"
              style={{ left: panelX, top: panelY, transform: 'translate(-50%, -100%)' }}
              onMouseDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <div className={`${panelBaseClass} gap-2 max-[640px]:w-full max-[640px]:flex-wrap max-[640px]:justify-center`} onMouseDown={(e) => e.stopPropagation()}>
                <ZoomIn size={14} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />
                <span className={panelLabelClass}>HD 高清放大</span>
                <div className={panelDividerClass} />
                {/* Original size display */}
                <span className={`text-xs tabular-nums ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`}>
                  {isSizeLoaded ? `${origW}×${origH}` : '...'}
                </span>
                <div className={panelDividerClass} />
                {/* Resolution preset dropdown */}
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowUpscalePresetMenu(!showUpscalePresetMenu); }}
                    className={`px-2.5 py-1 text-xs rounded-md transition-all flex items-center gap-1 font-semibold ${
                      isMonochrome ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-[#252525] text-text-bright hover:bg-[#282828]/85'
                    }`}
                  >
                    {selectedPreset?.shortLabel || upscalePreset.toUpperCase()}
                    <ChevronDown size={10} />
                  </button>
                  {showUpscalePresetMenu && (
                    <div className={`absolute top-full left-0 mt-1 py-1 rounded-lg border shadow-xl z-50 min-w-[190px] ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1e1e1e] border-[#444]'}`}>
                      {UPSCALE_TARGET_PRESETS.map(preset => {
                        const pTarget = calculateUpscaleTargetDimensions(origW, origH, preset.id);
                        const presetUnavailable = isSizeLoaded && (
                          !pTarget.canUpscale
                          || Boolean(validateUpscaleTargetDimensions(origW, origH, pTarget.width, pTarget.height))
                        );
                        return (
                          <button
                            key={preset.id}
                            disabled={presetUnavailable}
                            onClick={(e) => {
                              e.stopPropagation();
                              setUpscalePreset(preset.id);
                              setShowUpscalePresetMenu(false);
                            }}
                            className={`w-full px-3 py-1.5 text-xs text-left flex items-center justify-between gap-3 ${
                              presetUnavailable
                                ? 'cursor-not-allowed opacity-40'
                                : isMonochrome ? 'hover:bg-blue-50' : 'hover:bg-gold/10'
                            } ${
                              upscalePreset === preset.id
                                ? (isMonochrome ? 'text-blue-600' : 'text-gold')
                                : isMonochrome ? 'text-gray-600' : 'text-text-bright'
                            }`}
                          >
                            <span>{preset.label}</span>
                            <span className="flex items-center gap-2 whitespace-nowrap">
                              <span className="opacity-60">{pTarget.width}×{pTarget.height}</span>
                              {upscalePreset === preset.id && <span className={isMonochrome ? 'text-blue-500' : 'text-gold'}>✓</span>}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {upscaleMode === 'ai-only' && (
                  <div className="flex min-w-0 flex-col gap-1">
                    <select
                      aria-label="AI 放大模型"
                      value={selectedUpscaleModelKey}
                      disabled={isLoadingUpscaleModels || configuredUpscaleModels.length === 0}
                      onChange={(e) => setSelectedUpscaleModelKey(e.target.value)}
                      onPointerDown={(e) => e.stopPropagation()}
                      className={`h-7 max-w-64 border px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                        isMonochrome
                          ? 'border-gray-300 bg-white text-gray-700'
                          : 'border-[#454545] bg-[#252525] text-text-bright'
                      }`}
                      title="仅显示管理员已启用的放大模型"
                    >
                      {isLoadingUpscaleModels && <option value="">正在加载模型…</option>}
                      {!isLoadingUpscaleModels && configuredUpscaleModels.length === 0 && (
                        <option value="">暂无可用 AI 放大模型</option>
                      )}
                      {configuredUpscaleModels.map(model => (
                        <option
                          key={model.key}
                          value={model.key}
                          disabled={Boolean(model.unavailableReason)}
                        >
                          {model.label}{model.unavailableReason ? '（待协议验证）' : ''}
                        </option>
                      ))}
                    </select>
                    {(upscaleModelsLoadError || selectedUpscaleModel?.unavailableReason) && (
                      <span className={`max-w-64 text-[10px] leading-4 ${
                        isMonochrome ? 'text-amber-700' : 'text-amber-300'
                      }`}>
                        {selectedUpscaleModel?.unavailableReason || `模型读取失败：${upscaleModelsLoadError}`}
                      </span>
                    )}
                  </div>
                )}
                <div className={panelDividerClass} />
                {/* Upscale product mode selector */}
                <div className="flex items-center gap-0.5">
                  {([
                    { id: 'auto', label: '自动', title: '自动选择专用 AI 或保真引擎；发生降级时会明确说明原因' },
                    { id: 'ai-only', label: '仅 AI', title: '仅使用专用 AI 超分；失败时不会静默回退到 CPU 放大' },
                    { id: 'fidelity', label: '保真', title: '优先保持原始构图与像素特征，不使用生成式重绘' },
                  ] as const).map((mode, index, modes) => (
                    <button
                      key={mode.id}
                      onClick={(e) => { e.stopPropagation(); setUpscaleMode(mode.id); }}
                      className={`px-2 py-1 text-xs transition-all font-medium ${
                        index === 0 ? 'rounded-l-md' : index === modes.length - 1 ? 'rounded-r-md' : ''
                      } ${
                        upscaleMode === mode.id
                          ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-gold text-black'
                          : isMonochrome ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' : 'bg-[#252525] text-gold-muted hover:bg-[#333]'
                      }`}
                      title={mode.title}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
                <div className={panelDividerClass} />
                {/* Target dimensions */}
                <span
                  className={`text-xs tabular-nums font-semibold ${isMonochrome ? 'text-gray-700' : 'text-text-bright'}`}
                  title={targetValidationError || (targetDim.canUpscale ? '目标输出尺寸' : '原图已达到该分辨率')}
                >
                  {isSizeLoaded ? `${targetDim.width}×${targetDim.height}` : '...'}
                </span>
                <div className={panelDividerClass} />
                {/* Execute button */}
                <button
                  onClick={handleUpscaleConfirm}
                  disabled={!canExecute}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
                    !canExecute
                      ? isMonochrome ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#333] text-gold-muted/50 cursor-not-allowed'
                      : isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600 active:scale-95' : 'bg-gold text-black hover:bg-[#e5c047] active:scale-95'
                  }`}
                  title={targetValidationError || (targetDim.canUpscale ? '开始放大' : '原图已达到该分辨率')}
                >
                  <Sparkles size={14} />
                </button>
                <button onClick={exitEditMode} className={panelCancelBtnClass}>取消</button>
              </div>
              <div className="text-center mt-1">
                <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>Esc 退出</span>
              </div>
            </div>
          );
        })()}

        {/* ====== SVG智能描摹 FLOATING PANEL ====== */}
        {showSvgTracePanel && (() => {
          const editImg = images.find(i => i.id === editImageId);
          if (!editImg) return null;
          const imgOrigW = editImg.originalWidth || Math.round(editImg.width);
          const imgOrigH = editImg.originalHeight || Math.round(editImg.height);
          // 面板位置只在首次打开时计算，后续渲染使用固定位置，避免点击时跳动
          if (!svgTraceFixedPosRef.current) {
            const initPos = getToolbarPosition();
            svgTraceFixedPosRef.current = getConstrainedFixedPanelPosition({
              anchor: initPos,
              panel: { width: 320, height: 640 },
              viewport: { width: window.innerWidth, height: window.innerHeight },
            });
          }
          const pos = svgTraceFixedPosRef.current;
          return (
            <div
              data-floating-panel="svg-trace"
              className="motion-reduce:transition-none"
              style={{
                position: 'fixed',
                left: pos.left,
                top: pos.top,
                width: 'min(320px, calc(100vw - 32px))',
                maxHeight: 'min(640px, calc(100vh - 32px))',
                overflowY: 'auto',
                background: '#141414',
                border: '1px solid #333',
                borderRadius: 12,
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                zIndex: 60,
                padding: 16,
                color: '#ccc',
                fontSize: 13,
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ color: '#fff', fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Settings2 size={16} style={{ color: '#d4af37' }} />
                  SVG智能描摹
                </span>
                <span style={{ color: '#888', fontSize: 12 }}>Esc 退出</span>
              </div>

              {/* Mode selection */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {([
                  { key: 'color', label: '全彩矢量化', desc: 'AI识别分色', icon: <Palette size={14} style={{ color: '#d4af37' }} /> },
                  { key: 'bw', label: '黑白描摹', desc: '轮廓追踪', icon: <PenTool size={14} style={{ color: '#d4af37' }} /> },
                ] as const).map(m => (
                  <button
                    key={m.key}
                    onClick={() => setSvgTraceMode(m.key)}
                    style={{
                      flex: 1,
                      padding: '8px 6px',
                      borderRadius: 8,
                      border: svgTraceMode === m.key ? '1.5px solid #d4af37' : '1px solid #444',
                      background: svgTraceMode === m.key ? 'rgba(212,175,55,0.12)' : '#1e1e1e',
                      color: svgTraceMode === m.key ? '#d4af37' : '#aaa',
                      cursor: 'pointer',
                      textAlign: 'center',
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>{m.icon}</div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{m.label}</div>
                    <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>{m.desc}</div>
                  </button>
                ))}
              </div>

              {/* Original image info */}
              <div style={{ fontSize: 11, color: '#888', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Check size={12} style={{ color: '#4ade80' }} />
                原图 {imgOrigW}×{imgOrigH}
              </div>

              {/* Color mode settings */}
              {svgTraceMode === 'color' && (
                <>
                  {/* Engine */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ color: '#999', fontSize: 12 }}>矢量化引擎</span>
                      <span style={{ color: '#666', fontSize: 10 }}>自动选择最优</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {([
                        { key: 'auto', label: '自动' },
                        { key: 'wasm-vtracer', label: 'WASM' },
                        { key: 'vectorize-api', label: 'Vectorizer' },
                        { key: 'vlm', label: 'VLM' },
                        { key: 'vtracer', label: 'VTracer' },
                      ] as const).map(e => (
                        <button
                          key={e.key}
                          onClick={() => setSvgTraceEngine(e.key as typeof svgTraceEngine)}
                          style={{
                            flex: 1,
                            padding: '5px 4px',
                            borderRadius: 6,
                            border: svgTraceEngine === e.key ? '1.5px solid #d4af37' : '1px solid #444',
                            background: svgTraceEngine === e.key ? 'rgba(212,175,55,0.12)' : '#1e1e1e',
                            color: svgTraceEngine === e.key ? '#d4af37' : '#aaa',
                            cursor: 'pointer',
                            fontSize: 11,
                            fontWeight: svgTraceEngine === e.key ? 600 : 400,
                          }}
                        >
                          {e.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quality preset */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ color: '#999', fontSize: 12 }}>质量预设</span>
                      <span style={{ color: '#666', fontSize: 10 }}>调整后覆盖参数</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {[
                        { key: 'fast' as const, label: '快速' },
                        { key: 'balanced' as const, label: '均衡' },
                        { key: 'high' as const, label: '高清' },
                        { key: 'max' as const, label: '极致' },
                      ].map(q => (
                        <button
                          key={q.key}
                          onClick={() => setSvgTraceQualityPreset(q.key)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 6,
                            border: svgTraceQualityPreset === q.key ? '1.5px solid #d4af37' : '1px solid #444',
                            background: svgTraceQualityPreset === q.key ? 'rgba(212,175,55,0.12)' : '#1e1e1e',
                            color: svgTraceQualityPreset === q.key ? '#d4af37' : '#aaa',
                            cursor: 'pointer',
                            fontSize: 11,
                            fontWeight: svgTraceQualityPreset === q.key ? 600 : 400,
                          }}
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Fine-tuning sliders */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ color: '#999', fontSize: 12, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                      <span>精细调节</span>
                      <span style={{ color: '#666', fontSize: 10 }}>覆盖预设值</span>
                    </div>
                    {/* Color count */}
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 2 }}>
                        <span>颜色数</span>
                        <span>{svgTraceColorPrecision}色</span>
                      </div>
                      <input type="range" min={2} max={256} value={svgTraceColorPrecision ?? 5} onChange={e => setSvgTraceColorPrecision(Number(e.target.value))}
                        style={{ width: '100%', accentColor: '#d4af37' }} />
                    </div>
                    {/* Corner threshold */}
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 2 }}>
                        <span>角点阈值</span>
                        <span>{svgTraceCornerThreshold ?? '自动'}</span>
                      </div>
                      <input type="range" min={0} max={100} value={svgTraceCornerThreshold ?? 60} onChange={e => setSvgTraceCornerThreshold(Number(e.target.value))}
                        style={{ width: '100%', accentColor: '#d4af37' }} />
                    </div>
                  </div>
                </>
              )}

              {/* BW mode settings */}
              {svgTraceMode === 'bw' && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ color: '#999', fontSize: 12, marginBottom: 6 }}>黑白参数</div>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 2 }}>
                      <span>阈值</span>
                      <span>{svgTraceBwThreshold}</span>
                    </div>
                    <input type="range" min={0} max={255} value={svgTraceBwThreshold} onChange={e => setSvgTraceBwThreshold(Number(e.target.value))}
                      style={{ width: '100%', accentColor: '#d4af37' }} />
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  onClick={handleSvgTraceConfirm}
                  style={{
                    flex: 2,
                    padding: '10px 0',
                    borderRadius: 8,
                    border: 'none',
                    background: '#d4af37',
                    color: '#000',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  {svgTraceMode === 'color' ? '全彩矢量化' : '黑白描摹'}
                </button>
                <button
                  onClick={() => { setShowSvgTracePanel(false); setEditMode('none'); }}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1e1e1e',
                    color: '#aaa',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          );
        })()}
    </>
  );
}
