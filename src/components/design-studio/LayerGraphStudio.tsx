'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Download, Upload, Layers3, RefreshCw } from 'lucide-react';
import { createDesignDocumentFromCanvasImages } from '@/lib/design-graph';
import { exportDesignDocument, importWujieDocument } from '@/lib/design-export';
import type { DesignDocument, SceneGraph } from '@/types/designGraph';
import { LayerPanel } from './LayerPanel';
import { DesignCanvas } from './DesignCanvas';
import { PropertiesPanel } from './PropertiesPanel';

type CanvasLikeImage = {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  originalWidth?: number;
  originalHeight?: number;
  prompt?: string;
  model?: string;
  createdAt?: number;
};

interface LayerGraphStudioProps {
  open: boolean;
  images: CanvasLikeImage[];
  onClose: () => void;
}

export function LayerGraphStudio({ open, images, onClose }: LayerGraphStudioProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const initialDoc = useMemo(() => createDesignDocumentFromCanvasImages(images, '无界AI 分层图谱'), [images]);
  const [document, setDocument] = useState<DesignDocument>(initialDoc);

  useEffect(() => {
    if (open) setDocument(createDesignDocumentFromCanvasImages(images, '无界AI 分层图谱'));
  }, [open, images]);

  if (!open) return null;

  const setScene = (scene: SceneGraph) => {
    setDocument(prev => ({ ...prev, scene, metadata: { ...prev.metadata, updatedAt: Date.now() } }));
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    const imported = await importWujieDocument(file);
    setDocument(imported);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center">
      <section className="w-[96vw] h-[92vh] rounded-2xl border border-[#2a2a2a] bg-[#090909] shadow-2xl overflow-hidden flex flex-col">
        <header className="h-14 border-b border-[#252525] flex items-center justify-between px-4 bg-[#111]">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-[#d4af37]/15 border border-[#d4af37]/30 flex items-center justify-center">
              <Layers3 className="w-5 h-5 text-[#d4af37]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">无界AI 分层图谱工作室</h2>
              <p className="text-xs text-[#777]">将生图结果升级为可编辑设计工程 · .wujie / SVG / 图层运行时</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setDocument(createDesignDocumentFromCanvasImages(images, '无界AI 分层图谱'))} className="rounded-lg border border-[#2a2a2a] px-3 py-2 text-xs text-[#ddd] hover:border-[#d4af37]/60 flex items-center gap-2"><RefreshCw className="w-4 h-4" />从画布重建</button>
            <button onClick={() => inputRef.current?.click()} className="rounded-lg border border-[#2a2a2a] px-3 py-2 text-xs text-[#ddd] hover:border-[#d4af37]/60 flex items-center gap-2"><Upload className="w-4 h-4" />导入 .wujie</button>
            <button onClick={() => exportDesignDocument(document)} className="rounded-lg bg-[#d4af37] px-3 py-2 text-xs font-semibold text-black hover:bg-[#e2c45a] flex items-center gap-2"><Download className="w-4 h-4" />导出工程</button>
            <button onClick={onClose} className="rounded-lg border border-[#2a2a2a] p-2 text-[#aaa] hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <input ref={inputRef} type="file" accept=".wujie,application/json,text/html" className="hidden" onChange={(e) => void handleImport(e.target.files?.[0])} />
        </header>
        <div className="flex-1 flex min-h-0">
          <LayerPanel scene={document.scene} onSceneChange={setScene} />
          <DesignCanvas scene={document.scene} onSceneChange={setScene} />
          <PropertiesPanel scene={document.scene} onSceneChange={setScene} />
        </div>
      </section>
    </div>
  );
}
