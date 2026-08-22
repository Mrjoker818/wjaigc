'use client';

import * as React from 'react';
import { ChevronDown, Expand, Scissors } from 'lucide-react';
import type { CanvasImage, EditMode } from '@/components/infinite-canvas';

export interface ExpandPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CanvasEditExpandCropPanelProps {
  editMode: EditMode;
  images: CanvasImage[];
  editImageId: string | null;
  zoom: number;
  viewOffset: { x: number; y: number };
  isMonochrome: boolean;
  exitEditMode: () => void;
  cropRatio: string;
  setCropRatio: React.Dispatch<React.SetStateAction<string>>;
  cropRect: CropRect | null;
  setCropRect: React.Dispatch<React.SetStateAction<CropRect | null>>;
  expandPadding: ExpandPadding;
  setExpandPadding: React.Dispatch<React.SetStateAction<ExpandPadding>>;
  expandPaddingRef: React.RefObject<ExpandPadding>;
  showCropRatios: boolean;
  setShowCropRatios: React.Dispatch<React.SetStateAction<boolean>>;
  handleEditConfirm: () => void | Promise<void>;
  handleExpandEqualPadding: (pixels: number) => void;
  handleExpandToRatio: (ratioW: number, ratioH: number) => void;
  panelBaseClass: string;
  panelLabelClass: string;
  panelSmallLabelClass: string;
  panelDividerClass: string;
  panelBtnClass: string;
  panelCancelBtnClass: string;
  panelInputClass: string;
}

const ratioOptions = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'];

export function CanvasEditExpandCropPanel({
  editMode,
  images,
  editImageId,
  zoom,
  viewOffset,
  isMonochrome,
  exitEditMode,
  cropRatio,
  setCropRatio,
  cropRect,
  setCropRect,
  expandPadding,
  setExpandPadding,
  expandPaddingRef,
  showCropRatios,
  setShowCropRatios,
  handleEditConfirm,
  handleExpandEqualPadding,
  handleExpandToRatio,
  panelBaseClass,
  panelLabelClass,
  panelSmallLabelClass,
  panelDividerClass,
  panelBtnClass,
  panelCancelBtnClass,
  panelInputClass,
}: CanvasEditExpandCropPanelProps): React.ReactElement | null {
  return (
    <>
{/* ====== EXPAND PREVIEW OVERLAY + DRAG HANDLES ====== */}
        {editMode === 'expand' && (() => {
          const editImg = images.find(i => i.id === editImageId);
          if (!editImg) return null;
          const imgSX = editImg.x * zoom + viewOffset.x;
          const imgSY = editImg.y * zoom + viewOffset.y;
          const imgSW = editImg.width * zoom;
          const imgSH = editImg.height * zoom;

          // Scale factor: display pixels → original pixels
          const scaleX = (editImg.originalWidth || Math.round(editImg.width)) / editImg.width;
          const scaleY = (editImg.originalHeight || Math.round(editImg.height)) / editImg.height;

          // Padding in screen pixels
          const padTop = expandPadding.top * zoom / scaleY;
          const padRight = expandPadding.right * zoom / scaleX;
          const padBottom = expandPadding.bottom * zoom / scaleY;
          const padLeft = expandPadding.left * zoom / scaleX;

          // Total expanded area bounds (screen coords)
          const expX = imgSX - padLeft;
          const expY = imgSY - padTop;
          const expW = imgSW + padLeft + padRight;
          const expH = imgSH + padTop + padBottom;

          // Handle size
          const hs = 10;
          const hColor = '#d4af37';

          // Handle definitions: position, cursor, direction flags
          const handles = [
            { id: 'top',          cx: expX + expW / 2, cy: expY,            cursor: 'ns-resize',  dir: 'top' },
            { id: 'bottom',       cx: expX + expW / 2, cy: expY + expH,     cursor: 'ns-resize',  dir: 'bottom' },
            { id: 'left',         cx: expX,            cy: expY + expH / 2, cursor: 'ew-resize',  dir: 'left' },
            { id: 'right',        cx: expX + expW,     cy: expY + expH / 2, cursor: 'ew-resize',  dir: 'right' },
            { id: 'top-left',     cx: expX,            cy: expY,            cursor: 'nwse-resize', dir: 'top-left' },
            { id: 'top-right',    cx: expX + expW,     cy: expY,            cursor: 'nesw-resize', dir: 'top-right' },
            { id: 'bottom-left',  cx: expX,            cy: expY + expH,     cursor: 'nesw-resize', dir: 'bottom-left' },
            { id: 'bottom-right', cx: expX + expW,     cy: expY + expH,     cursor: 'nwse-resize', dir: 'bottom-right' },
          ];

          // Padding dimension label positions (midpoint of each padding edge)
          const dimLabels = [
            { key: 'top',   x: imgSX + imgSW / 2, y: imgSY - padTop / 2,  val: expandPadding.top,    show: expandPadding.top > 0 },
            { key: 'bottom',x: imgSX + imgSW / 2, y: imgSY + imgSH + padBottom / 2, val: expandPadding.bottom, show: expandPadding.bottom > 0 },
            { key: 'left',  x: imgSX - padLeft / 2, y: imgSY + imgSH / 2,  val: expandPadding.left,   show: expandPadding.left > 0 },
            { key: 'right', x: imgSX + imgSW + padRight / 2, y: imgSY + imgSH / 2, val: expandPadding.right,  show: expandPadding.right > 0 },
          ];

          return (
            <div className="absolute inset-0 pointer-events-none motion-reduce:transition-none" style={{ zIndex: 45 }}>
              {/* Semi-transparent padding areas */}
              {/* Top padding */}
              {expandPadding.top > 0 && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: expX, top: expY,
                    width: expW, height: padTop,
                    background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(212,175,55,0.12) 4px, rgba(212,175,55,0.12) 8px)',
                    border: '1px dashed rgba(212,175,55,0.5)',
                    borderBottom: 'none',
                  }}
                />
              )}
              {/* Bottom padding */}
              {expandPadding.bottom > 0 && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: expX, top: imgSY + imgSH,
                    width: expW, height: padBottom,
                    background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(212,175,55,0.12) 4px, rgba(212,175,55,0.12) 8px)',
                    border: '1px dashed rgba(212,175,55,0.5)',
                    borderTop: 'none',
                  }}
                />
              )}
              {/* Left padding */}
              {expandPadding.left > 0 && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: expX, top: expY,
                    width: padLeft, height: expH,
                    background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(212,175,55,0.12) 4px, rgba(212,175,55,0.12) 8px)',
                    border: '1px dashed rgba(212,175,55,0.5)',
                    borderRight: 'none',
                  }}
                />
              )}
              {/* Right padding */}
              {expandPadding.right > 0 && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: imgSX + imgSW, top: expY,
                    width: padRight, height: expH,
                    background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(212,175,55,0.12) 4px, rgba(212,175,55,0.12) 8px)',
                    border: '1px dashed rgba(212,175,55,0.5)',
                    borderLeft: 'none',
                  }}
                />
              )}

              {/* Outer border of expanded area */}
              <div
                className="absolute pointer-events-none"
                style={{
                  left: expX, top: expY,
                  width: expW, height: expH,
                  border: `2px solid ${hColor}`,
                }}
              />

              {/* Original image border highlight */}
              <div
                className="absolute pointer-events-none"
                style={{
                  left: imgSX, top: imgSY,
                  width: imgSW, height: imgSH,
                  border: '1.5px solid rgba(212,175,55,0.7)',
                }}
              />

              {/* Padding dimension labels */}
              {dimLabels.filter(d => d.show).map(d => (
                <div
                  key={d.key}
                  className="absolute pointer-events-none flex items-center justify-center"
                  style={{
                    left: d.x, top: d.y,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  <span
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(0,0,0,0.8)', color: hColor, whiteSpace: 'nowrap' }}
                  >
                    +{d.val}px
                  </span>
                </div>
              ))}

              {/* Drag handles */}
              {handles.map(h => (
                <div
                  key={h.id}
                  className="absolute pointer-events-auto"
                  style={{
                    left: h.cx - hs / 2,
                    top: h.cy - hs / 2,
                    width: hs,
                    height: hs,
                    cursor: h.cursor,
                    zIndex: 46,
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const startPad = { ...expandPaddingRef.current };

                    const onMove = (ev: MouseEvent) => {
                      ev.preventDefault();
                      const dx = ev.clientX - startX;
                      const dy = ev.clientY - startY;
                      // Convert screen pixels to original pixels
                      const origDx = Math.round(dx / zoom * scaleX);
                      const origDy = Math.round(dy / zoom * scaleY);
                      // Step to nearest 8px for cleaner values
                      const stepDx = Math.round(origDx / 8) * 8;
                      const stepDy = Math.round(origDy / 8) * 8;

                      const newPad = { ...startPad };
                      if (h.dir.includes('top'))    newPad.top    = Math.max(0, startPad.top    - stepDy);
                      if (h.dir.includes('bottom')) newPad.bottom = Math.max(0, startPad.bottom + stepDy);
                      if (h.dir.includes('left'))   newPad.left   = Math.max(0, startPad.left   - stepDx);
                      if (h.dir.includes('right'))  newPad.right  = Math.max(0, startPad.right  + stepDx);

                      // Clamp max total dimension to 4096
                      const ow = (editImg?.originalWidth || Math.round(editImg?.width || 512));
                      const oh = (editImg?.originalHeight || Math.round(editImg?.height || 512));
                      const maxDim = 4096;
                      newPad.right  = Math.min(newPad.right,  maxDim - ow - newPad.left);
                      newPad.bottom = Math.min(newPad.bottom, maxDim - oh - newPad.top);
                      newPad.left   = Math.min(newPad.left,   maxDim - ow - newPad.right);
                      newPad.top    = Math.min(newPad.top,    maxDim - oh - newPad.bottom);

                      expandPaddingRef.current = newPad;
                      setExpandPadding(newPad);
                    };
                    const onUp = () => {
                      document.removeEventListener('mousemove', onMove);
                      document.removeEventListener('mouseup', onUp);
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                  }}
                >
                  {/* Inner handle visual */}
                  <div
                    className="w-full h-full rounded-sm"
                    style={{
                      background: h.dir.includes('-')
                        ? `linear-gradient(135deg, ${hColor} 30%, rgba(212,175,55,0.6) 30%, rgba(212,175,55,0.6) 70%, ${hColor} 70%)`
                        : hColor,
                      boxShadow: '0 0 6px rgba(212,175,55,0.5)',
                      border: '1px solid rgba(255,255,255,0.3)',
                    }}
                  />
                </div>
              ))}

              {/* Edge drag zones (thin strips for easier edge dragging) */}
              {[
                { id: 'edge-top',    x: expX + hs, y: expY - 4,             w: expW - hs * 2, h: 8, cursor: 'ns-resize',  dir: 'top' },
                { id: 'edge-bottom', x: expX + hs, y: expY + expH - 4,      w: expW - hs * 2, h: 8, cursor: 'ns-resize',  dir: 'bottom' },
                { id: 'edge-left',   x: expX - 4,  y: expY + hs,            w: 8, h: expH - hs * 2, cursor: 'ew-resize', dir: 'left' },
                { id: 'edge-right',  x: expX + expW - 4, y: expY + hs,      w: 8, h: expH - hs * 2, cursor: 'ew-resize', dir: 'right' },
              ].map(edge => (
                <div
                  key={edge.id}
                  className="absolute pointer-events-auto"
                  style={{
                    left: edge.x, top: edge.y,
                    width: edge.w, height: edge.h,
                    cursor: edge.cursor,
                    zIndex: 45,
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const startPad = { ...expandPaddingRef.current };

                    const onMove = (ev: MouseEvent) => {
                      ev.preventDefault();
                      const dx = ev.clientX - startX;
                      const dy = ev.clientY - startY;
                      const origDx = Math.round(dx / zoom * scaleX);
                      const origDy = Math.round(dy / zoom * scaleY);
                      const stepDx = Math.round(origDx / 8) * 8;
                      const stepDy = Math.round(origDy / 8) * 8;

                      const newPad = { ...startPad };
                      if (edge.dir === 'top')    newPad.top    = Math.max(0, startPad.top    - stepDy);
                      if (edge.dir === 'bottom') newPad.bottom = Math.max(0, startPad.bottom + stepDy);
                      if (edge.dir === 'left')   newPad.left   = Math.max(0, startPad.left   - stepDx);
                      if (edge.dir === 'right')  newPad.right  = Math.max(0, startPad.right  + stepDx);

                      const ow = (editImg?.originalWidth || Math.round(editImg?.width || 512));
                      const oh = (editImg?.originalHeight || Math.round(editImg?.height || 512));
                      const maxDim = 4096;
                      if (edge.dir === 'top' || edge.dir === 'bottom') {
                        const maxPad = maxDim - oh;
                        if (edge.dir === 'top')    newPad.top    = Math.min(newPad.top, maxPad);
                        if (edge.dir === 'bottom') newPad.bottom = Math.min(newPad.bottom, maxPad);
                      } else {
                        const maxPad = maxDim - ow;
                        if (edge.dir === 'left')  newPad.left  = Math.min(newPad.left, maxPad);
                        if (edge.dir === 'right') newPad.right = Math.min(newPad.right, maxPad);
                      }

                      expandPaddingRef.current = newPad;
                      setExpandPadding(newPad);
                    };
                    const onUp = () => {
                      document.removeEventListener('mousemove', onMove);
                      document.removeEventListener('mouseup', onUp);
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                  }}
                />
              ))}
            </div>
          );
        })()}

        {/* ====== EXPAND/CROP FLOATING TOOLBARS ====== */}
        {(editMode === 'expand' || editMode === 'crop') && (() => {
          const editImg = images.find(i => i.id === editImageId);
          if (!editImg) return null;
          const imgScreenX = editImg.x * zoom + viewOffset.x;
          const imgScreenY = editImg.y * zoom + viewOffset.y;
          const imgScreenW = editImg.width * zoom;
          const panelX = imgScreenX + imgScreenW / 2;
          const panelY = imgScreenY - 8;

          return (
            <div
              data-floating-panel="multi-angle"
              className="absolute z-50 pointer-events-auto"
              data-toolbar="edit-mode"
              style={{ left: panelX, top: panelY, transform: 'translate(-50%, -100%)' }}
              onMouseDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              {editMode === 'expand' && (
                <div className={panelBaseClass} style={{ minWidth: 360 }} onMouseDown={(e) => e.stopPropagation()}>
                  <Expand size={14} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />
                  <span className={panelLabelClass}>扩图</span>
                  <div className={panelDividerClass} />
                  {/* 比例快捷按钮 */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {[
                      { label: '1:1', w: 1, h: 1 },
                      { label: '4:3', w: 4, h: 3 },
                      { label: '3:4', w: 3, h: 4 },
                      { label: '16:9', w: 16, h: 9 },
                      { label: '9:16', w: 9, h: 16 },
                      { label: '3:2', w: 3, h: 2 },
                      { label: '2:3', w: 2, h: 3 },
                      { label: '21:9', w: 21, h: 9 },
                    ].map(r => (
                      <button
                        key={r.label}
                        onClick={() => handleExpandToRatio(r.w, r.h)}
                        className={`px-2 py-1 text-xs rounded-md transition-all ${
                          isMonochrome ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <div className={panelDividerClass} />
                  {/* 快捷扩展按钮 */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleExpandEqualPadding(256)}
                      className={`px-2 py-1 text-xs rounded-md transition-all ${
                        isMonochrome ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                      }`}
                    >
                      +256
                    </button>
                    <button
                      onClick={() => handleExpandEqualPadding(512)}
                      className={`px-2 py-1 text-xs rounded-md transition-all ${
                        isMonochrome ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                      }`}
                    >
                      +512
                    </button>
                  </div>
                  <div className={panelDividerClass} />
                  {/* 扩展尺寸信息 */}
                  <span className="text-xs text-gold-muted whitespace-nowrap">
                    {(() => {
                      const editImg2 = images.find(i => i.id === editImageId);
                      if (!editImg2) return '';
                      const ow = editImg2.originalWidth || Math.round(editImg2.width);
                      const oh = editImg2.originalHeight || Math.round(editImg2.height);
                      const tw = ow + expandPadding.left + expandPadding.right;
                      const th = oh + expandPadding.top + expandPadding.bottom;
                      return `${ow}×${oh} → ${tw}×${th}`;
                    })()}
                  </span>
                  <div className={panelDividerClass} />
                  <button
                    onClick={handleEditConfirm}
                    disabled={expandPadding.top + expandPadding.right + expandPadding.bottom + expandPadding.left === 0}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      expandPadding.top + expandPadding.right + expandPadding.bottom + expandPadding.left === 0
                        ? isMonochrome ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#333] text-gold-muted/50 cursor-not-allowed'
                        : isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gold text-black hover:bg-[#e5c047]'
                    }`}
                  >
                    确认扩展
                  </button>
                  <button onClick={() => { setExpandPadding({ top: 0, right: 0, bottom: 0, left: 0 }); expandPaddingRef.current = { top: 0, right: 0, bottom: 0, left: 0 }; }} className={panelCancelBtnClass}>重置</button>
                  <button onClick={exitEditMode} className={panelCancelBtnClass}>取消</button>
                </div>
              )}

              {/* CROP toolbar */}
              {editMode === 'crop' && (
                <div className={panelBaseClass} style={{ minWidth: 480 }} onMouseDown={(e) => e.stopPropagation()}>
                  <Scissors size={14} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />
                  <span className={panelLabelClass}>裁切</span>
                  <div className={panelDividerClass} />
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCropRatio('free')}
                      className={`px-2 py-1 text-xs rounded-md transition-all ${
                        cropRatio === 'free'
                          ? isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-gold text-black font-medium'
                          : isMonochrome
                            ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                      }`}
                    >
                      自由
                    </button>
                    {ratioOptions.slice(0, 4).map(r => (
                      <button
                        key={r}
                        onClick={() => setCropRatio(r)}
                        className={`px-2 py-1 text-xs rounded-md transition-all ${
                          cropRatio === r
                            ? isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-gold text-black font-medium'
                            : isMonochrome
                              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                    <div className="relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowCropRatios(!showCropRatios); }}
                        className={`px-2 py-1 text-xs rounded-md transition-all ${isMonochrome ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'}`}
                      >
                        <ChevronDown size={10} />
                      </button>
                      {showCropRatios && (
                        <div className={`absolute top-full left-0 mt-1 py-1 rounded-lg border shadow-xl z-50 ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1e1e1e] border-[#444]'}`}>
                          {ratioOptions.slice(4).map(r => (
                            <button key={r} onClick={(e) => { e.stopPropagation(); setCropRatio(r); setShowCropRatios(false); }} className={`w-full px-3 py-1.5 text-xs text-left hover:bg-gold/10 ${cropRatio === r ? 'text-gold' : isMonochrome ? 'text-gray-600' : 'text-text-bright'}`}>
                              {r} {cropRatio === r && '✓'}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={panelDividerClass} />
                  <div className="flex items-center gap-1">
                    <span className={panelSmallLabelClass}>W</span>
                    <input
                      type="number"
                      value={Math.round(cropRect?.w || 0)}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (cropRect) setCropRect({ ...cropRect, w: val });
                      }}
                      className={panelInputClass}
                    />
                    <span className={panelSmallLabelClass}>H</span>
                    <input
                      type="number"
                      value={Math.round(cropRect?.h || 0)}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (cropRect) setCropRect({ ...cropRect, h: val });
                      }}
                      className={panelInputClass}
                    />
                  </div>
                  <div className={panelDividerClass} />
                  <button onClick={handleEditConfirm} className={panelBtnClass}>确认裁切</button>
                  <button onClick={exitEditMode} className={panelCancelBtnClass}>取消</button>
                </div>
              )}

              <div className={`text-center mt-1`}>
                <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>Esc 退出</span>
              </div>
            </div>
          );
        })()}
    </>
  );
}

