import type { LayerNode, SceneGraph } from '@/types/designGraph';
import { addVectorSvgToLayer, updateLayer } from '@/lib/design-graph';
import { exportSceneAsSvg } from '@/lib/design-export';
import { Download, Wand2 } from 'lucide-react';

interface PropertiesPanelProps {
  scene: SceneGraph;
  onSceneChange: (scene: SceneGraph) => void;
}

export function PropertiesPanel({ scene, onSceneChange }: PropertiesPanelProps) {
  const selected = scene.layers.find(layer => layer.id === scene.selectedLayerIds[0]);

  const patch = (layer: LayerNode, partial: Partial<LayerNode>) => {
    onSceneChange(updateLayer(scene, layer.id, partial));
  };

  const vectorize = async () => {
    if (!selected?.imageUrl) return;
    const response = await fetch('/api/design/vectorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: selected.imageUrl, mode: 'auto', layerId: selected.id }),
    });
    const data = await response.json();
    if (data?.success && data.svg) {
      onSceneChange(addVectorSvgToLayer(scene, selected.id, data.svg));
    }
  };

  return (
    <aside className="w-80 shrink-0 border-l border-[#252525] bg-[#0e0e0e] overflow-auto">
      <div className="px-4 py-3 border-b border-[#252525]">
        <div className="text-sm font-semibold text-[#d4af37]">属性 / 导出</div>
        <div className="text-xs text-[#777] mt-1">工程级设计运行时</div>
      </div>

      <div className="p-4 space-y-4">
        <button
          onClick={() => exportSceneAsSvg(scene)}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#d4af37] text-black text-sm font-semibold px-3 py-2 hover:bg-[#e2c45a]"
        >
          <Download className="w-4 h-4" /> 导出 SVG
        </button>

        {!selected ? (
          <div className="text-xs text-[#777]">请选择一个图层</div>
        ) : (
          <div className="space-y-3">
            <label className="block text-xs text-[#aaa]">图层名称</label>
            <input
              value={selected.name}
              onChange={(e) => patch(selected, { name: e.target.value })}
              className="w-full rounded-md bg-[#161616] border border-[#2a2a2a] px-3 py-2 text-sm text-white outline-none focus:border-[#d4af37]"
            />

            <label className="block text-xs text-[#aaa]">透明度：{Math.round((selected.opacity || 1) * 100)}%</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={selected.opacity ?? 1}
              onChange={(e) => patch(selected, { opacity: Number(e.target.value) })}
              className="w-full"
            />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-[#aaa] mb-1">横坐标</label>
                <input type="number" value={Math.round(selected.bbox.x)} onChange={(e) => patch(selected, { bbox: { ...selected.bbox, x: Number(e.target.value) } })} className="w-full rounded-md bg-[#161616] border border-[#2a2a2a] px-2 py-1 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-[#aaa] mb-1">纵坐标</label>
                <input type="number" value={Math.round(selected.bbox.y)} onChange={(e) => patch(selected, { bbox: { ...selected.bbox, y: Number(e.target.value) } })} className="w-full rounded-md bg-[#161616] border border-[#2a2a2a] px-2 py-1 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-[#aaa] mb-1">宽度</label>
                <input type="number" value={Math.round(selected.bbox.width)} onChange={(e) => patch(selected, { bbox: { ...selected.bbox, width: Number(e.target.value) } })} className="w-full rounded-md bg-[#161616] border border-[#2a2a2a] px-2 py-1 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-[#aaa] mb-1">高度</label>
                <input type="number" value={Math.round(selected.bbox.height)} onChange={(e) => patch(selected, { bbox: { ...selected.bbox, height: Number(e.target.value) } })} className="w-full rounded-md bg-[#161616] border border-[#2a2a2a] px-2 py-1 text-sm text-white" />
              </div>
            </div>

            <button
              disabled={!selected.imageUrl}
              onClick={vectorize}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-[#d4af37]/50 text-[#d4af37] text-sm font-medium px-3 py-2 hover:bg-[#d4af37]/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Wand2 className="w-4 h-4" /> 当前层矢量化
            </button>

            <div className="rounded-lg bg-[#141414] border border-[#252525] p-3 text-xs text-[#777] leading-relaxed">
              当前版本提供图层运行时与轻量矢量化占位接口。后续可接入更高精度的矢量化与语义分层服务，实现专业级分层矢量工程。
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
