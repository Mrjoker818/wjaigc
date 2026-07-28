'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, Layers3, Play, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { buildSceneFromEditableLayerAssets, downloadEditedPSD } from '@/lib/psd-export';
import type { DesignLayer, PSDExportMode, SceneBuildResult } from '@/lib/psd-export';
import {
  cancelLayerDecomposition,
  getLayerPhasePresentation,
  runLayerDecomposition,
} from '@/lib/layer-decomposition-client';
import type { LayerEngineMode, LayerTaskPhase } from '@/lib/layer-decomposition/types';
import { PsdCanvas } from './PsdCanvas';
import { LayerPanel } from './LayerPanel';
import { LayerInspector } from './LayerInspector';
import { ExportToolbar } from './ExportToolbar';

interface PsdLayerEditorProps {
  imageUrl: string;
  prompt?: string;
  mode?: 'basic' | 'standard' | 'advanced' | 'studio';
  providerId?: string;
  modelId?: string;
  onClose: () => void;
}

type EditorStage = 'choosing' | 'loading' | 'cancelling' | 'editing' | 'exporting' | 'done' | 'error';

export function layerEditorPhaseLabel(phase?: LayerTaskPhase): string {
  return getLayerPhasePresentation(phase).label;
}

interface LayerModeControlProps {
  value: LayerEngineMode;
  disabled: boolean;
  onChange: (value: LayerEngineMode) => void;
}

const LAYER_MODES: Array<{ value: LayerEngineMode; label: string }> = [
  { value: 'smart', label: '智能' },
  { value: 'cloud', label: '云端' },
  { value: 'local', label: '本地' },
];

export function LayerModeControl({ value, disabled, onChange }: LayerModeControlProps) {
  return (
    <div className="inline-flex h-8 items-center rounded-lg bg-neutral-950 p-0.5" role="group" aria-label="图片分层引擎">
      {LAYER_MODES.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={value === item.value}
          disabled={disabled}
          onClick={() => onChange(item.value)}
          className={`h-7 min-w-14 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-50 ${
            value === item.value
              ? 'bg-amber-500 text-neutral-950'
              : 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function initialExportMode(mode: PsdLayerEditorProps['mode']): PSDExportMode {
  if (mode === 'basic') return 'basic';
  if (mode === 'studio') return 'studio';
  return 'pro';
}

export default function PsdLayerEditor({
  imageUrl,
  prompt = '图片',
  mode = 'standard',
  providerId,
  modelId,
  onClose,
}: PsdLayerEditorProps) {
  const [stage, setStage] = useState<EditorStage>('choosing');
  const [layerEngine, setLayerEngine] = useState<LayerEngineMode>(() => {
    if (typeof window === 'undefined') return 'smart';
    const stored = window.localStorage.getItem('wujie-layer-engine');
    return stored === 'smart' || stored === 'cloud' || stored === 'local'
      ? stored
      : 'smart';
  });
  const [sceneResult, setSceneResult] = useState<SceneBuildResult | null>(null);
  const [layers, setLayers] = useState<DesignLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [exportMode, setExportMode] = useState<PSDExportMode>(() => initialExportMode(mode));
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [qualityWarnings, setQualityWarnings] = useState<string[]>([]);
  const [showLayerPanel, setShowLayerPanel] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const taskIdRef = useRef<string | null>(null);
  const taskControllerRef = useRef<AbortController | null>(null);

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

  useEffect(() => {
    return () => taskControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    window.localStorage.setItem('wujie-layer-engine', layerEngine);
  }, [layerEngine]);

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

  const startLayering = useCallback(async () => {
    taskControllerRef.current?.abort();
    const controller = new AbortController();
    taskControllerRef.current = controller;
    taskIdRef.current = null;
    setStage('loading');
    setProgress(0);
    setProgressMessage('正在准备图片分层');
    setErrorMessage('');
    setQualityWarnings([]);
    try {
      const result = await runLayerDecomposition({
        imageUrl,
        engine: layerEngine,
        providerId,
        modelId,
        signal: controller.signal,
        onTaskId: (taskId) => { taskIdRef.current = taskId; },
        onProgress: (_task, presentation) => {
          setProgress(presentation.progress);
          setProgressMessage(presentation.label);
        },
      });
      if (controller.signal.aborted) return;
      const scene = buildSceneFromEditableLayerAssets(result);
      const editableLayers = scene.layers.map((layer) => ({
        ...layer,
        offsetX: layer.offsetX ?? 0,
        offsetY: layer.offsetY ?? 0,
      }));
      setSceneResult(scene);
      setLayers(editableLayers);
      setQualityWarnings(result.quality.warnings);
      setSelectedLayerId(
        editableLayers.find((layer) => layer.visible)?.id
        ?? editableLayers[0]?.id
        ?? null,
      );
      setStage('editing');
    } catch (error) {
      if (controller.signal.aborted) return;
      setErrorMessage(error instanceof Error ? error.message : '图像分层失败');
      setStage('error');
    } finally {
      if (taskControllerRef.current === controller) taskControllerRef.current = null;
    }
  }, [imageUrl, layerEngine, modelId, providerId]);

  const handleCancelLayering = useCallback(async () => {
    const taskId = taskIdRef.current;
    setStage('cancelling');
    taskControllerRef.current?.abort(new Error('用户取消图片分层'));
    try {
      if (taskId) await cancelLayerDecomposition(taskId);
      taskIdRef.current = null;
      setProgress(0);
      setProgressMessage('');
      setStage('choosing');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '取消图片分层任务失败');
      setStage('error');
    }
  }, []);

  const handleClose = useCallback(() => {
    const taskId = taskIdRef.current;
    taskControllerRef.current?.abort(new Error('图片分层窗口已关闭'));
    if (taskId) {
      void cancelLayerDecomposition(taskId).finally(onClose);
      return;
    }
    onClose();
  }, [onClose]);

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

  const panelWidth = 'min(85vw, 1200px)';
  const panelHeight = 'min(85vh, 800px)';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ pointerEvents: 'auto' }}
    >
      {/* Backdrop overlay */}
      <div className="absolute inset-0 bg-black/30" onClick={handleClose} />

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
            <Layers3 className="h-4 w-4 text-amber-400" aria-hidden="true" />
            <h2 className="text-sm font-medium text-white/90">PSD 分层编辑器</h2>
            {(stage === 'editing' || stage === 'exporting' || stage === 'done') && (
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-white/60">
                {layers.length} 个图层
              </span>
            )}
            {stage !== 'editing' && stage !== 'loading' && stage !== 'choosing' && (
              <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                {stage === 'exporting' ? '导出中...' : stage === 'done' ? '导出完成' : stage === 'cancelling' ? '取消中...' : stage === 'error' ? '错误' : ''}
              </span>
            )}
          </div>
          <LayerModeControl
            value={layerEngine}
            disabled={stage !== 'choosing' && stage !== 'error'}
            onChange={setLayerEngine}
          />
          <div className="flex items-center gap-1">
            {(stage === 'editing' || stage === 'exporting') && (
              <>
                <button
                  type="button"
                  onClick={() => setShowLayerPanel(!showLayerPanel)}
                  className={`rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${showLayerPanel ? 'bg-amber-500/20 text-amber-400' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}
                  title="图层面板"
                  aria-label="图层面板"
                >
                  <Layers3 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowInspector(!showInspector)}
                  className={`rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${showInspector ? 'bg-amber-500/20 text-amber-400' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}
                  title="属性面板"
                  aria-label="属性面板"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
                <div className="mx-1 h-4 w-px bg-white/10" />
              </>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              title="关闭 (Esc)"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {(stage === 'loading' || stage === 'cancelling' || stage === 'exporting') && (
          <div className="h-0.5 bg-neutral-800 shrink-0">
            <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        )}

        {/* Main content area - three-column layout */}
        <div className="flex-1 flex min-h-0 relative">
          {/* Left sidebar: Layer panel */}
          {showLayerPanel && (stage === 'editing' || stage === 'exporting') && (
            <div className="w-56 shrink-0 flex flex-col bg-neutral-900/95 border-r border-neutral-700 overflow-hidden">
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
            </div>
          )}

          {/* Center: Canvas area with checkerboard background */}
          <div className="flex-1 relative overflow-hidden"
            style={{
              background: `
                repeating-conic-gradient(#3a3a3a 0% 25%, #2e2e2e 0% 50%) 0 0 / 20px 20px
              `,
            }}
          >
            {stage === 'choosing' && (
              <div className="flex h-full w-full items-center justify-center bg-neutral-900">
                <div className="flex w-full max-w-sm flex-col items-center gap-5 px-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-800 text-amber-400">
                    <Layers3 className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">选择分层引擎</h3>
                    <p className="mt-1 text-sm text-neutral-400">当前模式：{LAYER_MODES.find((item) => item.value === layerEngine)?.label}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void startLayering()}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-amber-500 px-5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900"
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                    开始分层
                  </button>
                </div>
              </div>
            )}

            {(stage === 'loading' || stage === 'cancelling') && (
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-72 rounded-xl bg-neutral-800 p-6 text-center">
                  <div className="mx-auto mb-4 h-2 w-36 overflow-hidden rounded-full bg-neutral-700">
                    <div className="h-full rounded-full bg-amber-500 transition-[width] duration-200" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-sm font-medium text-white/80">
                    {stage === 'cancelling' ? '正在取消图片分层任务' : progressMessage || '正在分析图像...'}
                  </p>
                  <p className="mt-1 font-mono text-xs text-neutral-400">{Math.round(progress)}%</p>
                  {stage === 'loading' && (
                    <button
                      type="button"
                      onClick={() => void handleCancelLayering()}
                      className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-neutral-700 px-4 text-sm text-neutral-100 transition-colors hover:bg-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      <Ban className="h-4 w-4" aria-hidden="true" />
                      取消
                    </button>
                  )}
                </div>
              </div>
            )}

            {stage === 'error' && (
              <div className="w-full h-full flex items-center justify-center">
                <div className="max-w-sm rounded-xl bg-neutral-800 p-6 text-center">
                  <p className="mb-5 text-sm text-red-300">{errorMessage}</p>
                  <div className="flex justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => void startLayering()}
                      className="inline-flex h-9 items-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-neutral-950 hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      重试
                    </button>
                    <button type="button" onClick={handleClose} className="h-9 rounded-lg bg-neutral-700 px-4 text-sm text-white hover:bg-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
                      关闭
                    </button>
                  </div>
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
              <>
                {qualityWarnings.length > 0 && (
                  <div className="absolute left-1/2 top-3 z-10 max-w-[min(34rem,80%)] -translate-x-1/2 rounded-lg bg-amber-950 px-3 py-2 text-xs text-amber-100 shadow-md" role="status">
                    结果需复核：{qualityWarnings[0]}
                  </div>
                )}
                <PsdCanvas
                  layers={layers}
                  selectedLayerId={selectedLayerId}
                  onSelectLayer={setSelectedLayerId}
                  onLayerMove={handleLayerMove}
                  width={canvasWidth}
                  height={canvasHeight}
                />
              </>
            )}

            {/* Fallback export toolbar when inspector is hidden */}
            {!showInspector && (stage === 'editing' || stage === 'exporting') && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
                <div className="bg-neutral-800/90 rounded-lg border border-neutral-700 px-3 py-2 shadow-xl">
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

          {/* Right sidebar: Properties panel */}
          {showInspector && (stage === 'editing' || stage === 'exporting') && (
            <div className="w-60 shrink-0 flex flex-col bg-neutral-900/95 border-l border-neutral-700 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700 shrink-0">
                <span className="text-xs font-medium text-white/80">属性</span>
                <button onClick={() => setShowInspector(false)} className="text-white/40 hover:text-white/70 transition-colors">
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                {selectedLayer ? (
                  <LayerInspector layer={selectedLayer} />
                ) : (
                  <div className="px-3 py-6 text-center text-xs text-white/30">
                    选择一个图层查看属性
                  </div>
                )}
              </div>

              {/* Export toolbar at bottom of properties panel */}
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
