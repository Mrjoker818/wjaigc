'use client';

import React, { useCallback, useEffect, useState } from 'react';
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
    layer_split_service: '正在尝试高质量图层分离...',
    building_rgba_layers: '正在构建透明图层...',
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

  const canvasWidth = sceneResult?.width ?? 600;
  const canvasHeight = sceneResult?.height ?? 400;

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

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-neutral-200">
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-2 bg-gradient-to-b from-black/40 to-transparent pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <h2 className="text-sm font-medium text-white drop-shadow-sm">PSD 分层编辑器</h2>
          <span className="text-xs text-white/50 bg-white/10 px-2 py-0.5 rounded-full">
            {layers.length} 个图层
          </span>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            onClick={() => setShowLayerPanel(!showLayerPanel)}
            className={`p-1.5 rounded text-xs transition-colors ${showLayerPanel ? 'bg-amber-500/20 text-amber-400' : 'text-white/50 hover:text-white/80'}`}
            title="图层面板"
          >
            <span className="block w-4 text-center">层</span>
          </button>
          <button
            onClick={() => setShowInspector(!showInspector)}
            className={`p-1.5 rounded text-xs transition-colors ${showInspector ? 'bg-amber-500/20 text-amber-400' : 'text-white/50 hover:text-white/80'}`}
            title="属性面板"
          >
            <span className="block w-4 text-center">属</span>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            title="关闭"
          >
            <span className="block w-4 text-center">×</span>
          </button>
        </div>
      </div>

      {(stage === 'loading' || stage === 'exporting') && (
        <div className="absolute top-0 left-0 right-0 z-20 h-0.5">
          <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}

      <div className="absolute inset-0">
        {stage === 'loading' && (
          <div className="w-full h-full flex items-center justify-center bg-neutral-800/40">
            <div className="text-center bg-white rounded-xl p-6 shadow-xl">
              <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-neutral-600">{progressMessage || '正在分析图像...'}</p>
            </div>
          </div>
        )}

        {stage === 'error' && (
          <div className="w-full h-full flex items-center justify-center bg-neutral-800/40">
            <div className="text-center max-w-md bg-white rounded-xl p-6 shadow-xl">
              <p className="text-red-500 text-sm mb-4">{errorMessage}</p>
              <button onClick={onClose} className="px-4 py-2 bg-neutral-700 text-white rounded text-sm hover:bg-neutral-600">
                关闭
              </button>
            </div>
          </div>
        )}

        {stage === 'done' && (
          <div className="w-full h-full flex items-center justify-center bg-neutral-800/40">
            <div className="text-center bg-white rounded-xl p-6 shadow-xl">
              <p className="text-green-600 text-sm mb-4">PSD 文件已下载</p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => setStage('editing')} className="px-4 py-2 bg-neutral-700 text-white rounded text-sm hover:bg-neutral-600">
                  继续编辑
                </button>
                <button onClick={onClose} className="px-4 py-2 bg-neutral-700 text-white rounded text-sm hover:bg-neutral-600">
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

      {showLayerPanel && (stage === 'editing' || stage === 'exporting') && (
        <div className="absolute top-10 right-3 bottom-3 w-64 z-10 flex flex-col rounded-xl overflow-hidden bg-neutral-900/85 backdrop-blur-xl border border-white/10 shadow-2xl">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
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
          <div className="border-t border-white/10 p-2">
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

      {showInspector && selectedLayer && (stage === 'editing' || stage === 'exporting') && (
        <div className="absolute bottom-3 left-3 z-10 w-72 rounded-xl overflow-hidden bg-neutral-900/85 backdrop-blur-xl border border-white/10 shadow-2xl">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <span className="text-xs font-medium text-white/80">属性</span>
            <button onClick={() => setShowInspector(false)} className="text-white/40 hover:text-white/70 transition-colors">
              ×
            </button>
          </div>
          <div className="max-h-52 overflow-y-auto">
            <LayerInspector layer={selectedLayer} />
          </div>
        </div>
      )}
    </div>
  );
}
