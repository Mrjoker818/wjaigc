'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { buildV4Scene, downloadEditedPSD } from '@/lib/psd-export';
import type { DesignLayer, PSDExportMode, SceneBuildResult } from '@/lib/psd-export';
import { PsdCanvas } from './PsdCanvas';
import { LayerPanel } from './LayerPanel';
import { LayerInspector } from './LayerInspector';
import { ExportToolbar } from './ExportToolbar';

interface PsdLayerEditorProps {
  imageUrl: string;
  prompt?: string;
  mode?: 'basic' | 'standard' | 'advanced' | 'studio';
  onClose: () => void;
}

type EditorStage = 'loading' | 'editing' | 'exporting' | 'done' | 'error';

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    loading_image: '正在读取图片...',
    layer_split_service: '正在使用 Qwen-Image-Layered 进行智能分层...',
    building_rgba_layers: '正在构建 RGBA 透明图层...',
    ai_analyzing: '正在分析语义结构...',
    detecting_background: '正在识别背景...',
    removing_background: '正在分离主体...',
    finding_components: '正在检测元素...',
    merging_fragments: '正在合并碎片...',
    classifying_layers: '正在整理图层...',
    building_layers: '正在生成图层...',
    generating_previews: '正在生成预览...',
  };
  return labels[stage] || stage;
}

function withEditorTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('图层分析超时，请稍后重试或配置高质量图层分离服务。')), ms);
    promise
      .then(value => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch(error => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function initialExportMode(mode: PsdLayerEditorProps['mode']): PSDExportMode {
  if (mode === 'basic') return 'basic';
  if (mode === 'studio') return 'studio';
  return 'pro';
}

export default function PsdLayerEditor({ imageUrl, prompt = '图片', mode = 'standard', onClose }: PsdLayerEditorProps) {
  const [stage, setStage] = useState<EditorStage>('loading');
  const [sceneResult, setSceneResult] = useState<SceneBuildResult | null>(null);
  const [layers, setLayers] = useState<DesignLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [exportMode, setExportMode] = useState<PSDExportMode>(() => initialExportMode(mode));
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showLayerPanel, setShowLayerPanel] = useState(true);
  const [showInspector, setShowInspector] = useState(true);

  // Drag state for floating panel
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const canvasWidth = sceneResult?.width ?? 600;
  const canvasHeight = sceneResult?.height ?? 400;

  // Center the panel on mount
  useEffect(() => {
    const pw = Math.min(window.innerWidth * 0.85, 1200);
    const ph = Math.min(window.innerHeight * 0.85, 800);
    setPanelPos({
      x: (window.innerWidth - pw) / 2,
      y: (window.innerHeight - ph) / 2,
    });
  }, []);

  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    dragOffsetRef.current = { x: e.clientX - panelPos.x, y: e.clientY - panelPos.y };
  }, [panelPos]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      setPanelPos({ x: e.clientX - dragOffsetRef.current.x, y: e.clientY - dragOffsetRef.current.y });
    };
    const handleUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setStage('loading');
        const result = await withEditorTimeout(buildV4Scene(imageUrl, prompt, initialExportMode(mode), (stageName, value) => {
          if (!cancelled) {
            setProgress(value);
            setProgressMessage(stageLabel(stageName));
          }
        }), 45000);

        if (cancelled) return;
        const editableLayers = result.layers.map(layer => ({ ...layer, offsetX: layer.offsetX ?? 0, offsetY: layer.offsetY ?? 0 }));
        setSceneResult(result);
        setLayers(editableLayers);
        setSelectedLayerId(editableLayers.find(layer => layer.visible)?.id ?? editableLayers[0]?.id ?? null);
        setStage('editing');
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : '图像分层失败');
          setStage('error');
        }
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [imageUrl, prompt, mode]);

  const handleLayerMove = useCallback((id: string, x: number, y: number) => {
    setLayers(prev => prev.map(layer => layer.id === id ? { ...layer, offsetX: x, offsetY: y } : layer));
  }, []);

  const toggleVisibility = useCallback((id: string) => {
    setLayers(prev => prev.map(layer => layer.id === id ? { ...layer, visible: !layer.visible } : layer));
  }, []);

  const toggleLock = useCallback((id: string) => {
    setLayers(prev => prev.map(layer => layer.id === id ? { ...layer, locked: !layer.locked } : layer));
  }, []);

  const renameLayer = useCallback((id: string, newName: string) => {
    setLayers(prev => prev.map(layer => layer.id === id ? { ...layer, name: newName } : layer));
  }, []);

  const reorderLayers = useCallback((fromIdx: number, toIdx: number) => {
    setLayers(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  const handleExport = useCallback(async () => {
    try {
      setStage('exporting');
      setProgress(15);
      setProgressMessage('正在写入当前编辑后的图层栈...');
      await downloadEditedPSD(layers, canvasWidth, canvasHeight, prompt, exportMode);
      setProgress(100);
      setProgressMessage('导出完成');
      setStage('done');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'PSD 导出失败');
      setStage('error');
    }
  }, [layers, canvasWidth, canvasHeight, prompt, exportMode]);

  const selectedLayer = layers.find(layer => layer.id === selectedLayerId) || null;

  const panelWidth = Math.min(window.innerWidth * 0.85, 1200);
  const panelHeight = Math.min(window.innerHeight * 0.85, 800);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ pointerEvents: 'auto' }}
    >
      {/* Backdrop overlay */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Floating panel */}
      <div
        className="absolute flex flex-col rounded-xl overflow-hidden shadow-2xl border border-neutral-700"
        style={{
          left: panelPos.x,
          top: panelPos.y,
          width: panelWidth,
          height: panelHeight,
          background: '#2a2a2a',
        }}
      >
        {/* Title bar - draggable */}
        <div
          className="flex items-center justify-between px-4 py-2.5 bg-neutral-800 border-b border-neutral-700 cursor-move select-none shrink-0"
          onMouseDown={handleTitleMouseDown}
        >
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-white/90">PSD 分层编辑器</h2>
            <span className="text-xs text-white/40 bg-white/10 px-2 py-0.5 rounded-full">
              {layers.length} 个图层
            </span>
            {stage !== 'editing' && stage !== 'loading' && (
              <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                {stage === 'exporting' ? '导出中...' : stage === 'done' ? '导出完成' : stage === 'error' ? '错误' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowLayerPanel(!showLayerPanel)}
              className={`p-1.5 rounded text-xs transition-colors ${showLayerPanel ? 'bg-amber-500/20 text-amber-400' : 'text-white/40 hover:text-white/70'}`}
              title="图层面板"
            >
              <span className="block w-4 text-center">层</span>
            </button>
            <button
              onClick={() => setShowInspector(!showInspector)}
              className={`p-1.5 rounded text-xs transition-colors ${showInspector ? 'bg-amber-500/20 text-amber-400' : 'text-white/40 hover:text-white/70'}`}
              title="属性面板"
            >
              <span className="block w-4 text-center">属</span>
            </button>
            <div className="w-px h-4 bg-white/10 mx-1" />
            <button
              onClick={onClose}
              className="p-1.5 rounded text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              title="关闭 (Esc)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mx-auto">
                <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {(stage === 'loading' || stage === 'exporting') && (
          <div className="h-0.5 bg-neutral-800 shrink-0">
            <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        )}

        {/* Main content area */}
        <div className="flex-1 flex min-h-0 relative">
          {/* Canvas area with checkerboard background */}
          <div className="flex-1 relative overflow-hidden"
            style={{
              background: `
                repeating-conic-gradient(#3a3a3a 0% 25%, #2e2e2e 0% 50%) 0 0 / 20px 20px
              `,
            }}
          >
            {stage === 'loading' && (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center bg-neutral-800/90 rounded-xl p-6 shadow-xl border border-neutral-700">
                  <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm text-white/70">{progressMessage || '正在分析图像...'}</p>
                  {progress > 0 && (
                    <div className="mt-3 w-48 h-1.5 bg-neutral-700 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500 transition-all duration-300 rounded-full" style={{ width: `${progress}%` }} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {stage === 'error' && (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center max-w-sm bg-neutral-800/90 rounded-xl p-6 shadow-xl border border-neutral-700">
                  <p className="text-red-400 text-sm mb-4">{errorMessage}</p>
                  <button onClick={onClose} className="px-4 py-2 bg-neutral-700 text-white rounded text-sm hover:bg-neutral-600 transition-colors">
                    关闭
                  </button>
                </div>
              </div>
            )}

            {stage === 'done' && (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center bg-neutral-800/90 rounded-xl p-6 shadow-xl border border-neutral-700">
                  <div className="w-10 h-10 mx-auto mb-3 flex items-center justify-center rounded-full bg-green-500/20">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M5 10L8.5 13.5L15 6.5" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="text-green-400 text-sm mb-4">PSD 文件已下载</p>
                  <div className="flex gap-3 justify-center">
                    <button onClick={() => setStage('editing')} className="px-4 py-2 bg-neutral-700 text-white rounded text-sm hover:bg-neutral-600 transition-colors">
                      继续编辑
                    </button>
                    <button onClick={onClose} className="px-4 py-2 bg-neutral-700 text-white rounded text-sm hover:bg-neutral-600 transition-colors">
                      关闭
                    </button>
                  </div>
                </div>
              </div>
            )}

            {(stage === 'editing' || stage === 'exporting') && (
              <PsdCanvas
                layers={layers}
                selectedLayerId={selectedLayerId}
                onSelectLayer={setSelectedLayerId}
                onLayerMove={handleLayerMove}
                width={canvasWidth}
                height={canvasHeight}
              />
            )}
          </div>

          {/* Right sidebar: Layer panel + Inspector */}
          {showLayerPanel && (stage === 'editing' || stage === 'exporting') && (
            <div className="w-60 shrink-0 flex flex-col bg-neutral-900/95 border-l border-neutral-700 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700 shrink-0">
                <span className="text-xs font-medium text-white/80">图层</span>
                <span className="text-xs text-white/40">{layers.length} 层</span>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                <LayerPanel
                  layers={layers}
                  selectedLayerId={selectedLayerId}
                  onSelectLayer={setSelectedLayerId}
                  onToggleVisibility={toggleVisibility}
                  onToggleLock={toggleLock}
                  onRenameLayer={renameLayer}
                  onReorderLayers={reorderLayers}
                />
              </div>

              {/* Inspector (inside right sidebar, below layers) */}
              {showInspector && selectedLayer && (
                <div className="border-t border-neutral-700 shrink-0">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700">
                    <span className="text-xs font-medium text-white/80">属性</span>
                    <button onClick={() => setShowInspector(false)} className="text-white/40 hover:text-white/70 transition-colors">
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                        <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    <LayerInspector layer={selectedLayer} />
                  </div>
                </div>
              )}

              {/* Export toolbar */}
              <div className="border-t border-neutral-700 p-2 shrink-0">
                <ExportToolbar
                  mode={exportMode}
                  onModeChange={setExportMode}
                  onExport={handleExport}
                  isExporting={stage === 'exporting'}
                  progress={progress}
                  progressMessage={progressMessage}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
