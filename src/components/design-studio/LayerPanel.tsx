import { Eye, EyeOff, Lock, Unlock, ArrowUp, ArrowDown } from 'lucide-react';
import type { LayerNode, SceneGraph } from '@/types/designGraph';
import { moveLayer, selectLayer, updateLayer } from '@/lib/design-graph';

interface LayerPanelProps {
  scene: SceneGraph;
  onSceneChange: (scene: SceneGraph) => void;
}

export function LayerPanel({ scene, onSceneChange }: LayerPanelProps) {
  const selectedId = scene.selectedLayerIds[0];
  const layers = [...scene.layers].sort((a, b) => b.zIndex - a.zIndex);

  const toggle = (layer: LayerNode, key: 'visible' | 'locked') => {
    onSceneChange(updateLayer(scene, layer.id, { [key]: !layer[key] }));
  };

  const layerTypeLabel = (type: LayerNode['type']) => ({
    image: '图片',
    vector: '矢量',
    text: '文字',
    shape: '形状',
    group: '分组',
    background: '背景',
    mask: '蒙版',
    effect: '效果',
  })[type] || '图层';

  return (
    <aside className="w-72 shrink-0 border-r border-[#252525] bg-[#0e0e0e] overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-[#252525]">
        <div className="text-sm font-semibold text-[#d4af37]">分层图谱</div>
        <div className="text-xs text-[#777] mt-1">可编辑图层结构</div>
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {layers.length === 0 && <div className="text-xs text-[#777] p-3">当前画布暂无图层</div>}
        {layers.map(layer => {
          const active = layer.id === selectedId;
          return (
            <div
              key={layer.id}
              onClick={() => onSceneChange(selectLayer(scene, layer.id))}
              className={`rounded-lg border px-2 py-2 cursor-pointer transition ${active ? 'border-[#d4af37] bg-[#d4af37]/10' : 'border-[#222] bg-[#141414] hover:bg-[#1b1b1b]'}`}
            >
              <div className="flex items-center gap-2">
                <button className="text-[#aaa] hover:text-white" onClick={(e) => { e.stopPropagation(); toggle(layer, 'visible'); }}>
                  {layer.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                <button className="text-[#aaa] hover:text-white" onClick={(e) => { e.stopPropagation(); toggle(layer, 'locked'); }}>
                  {layer.locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-white">{layer.name}</div>
                  <div className="text-xs text-[#777]">{layerTypeLabel(layer.type)} · 层级 {layer.zIndex}</div>
                </div>
                <div className="flex gap-1">
                  <button className="text-[#777] hover:text-[#d4af37]" onClick={(e) => { e.stopPropagation(); onSceneChange(moveLayer(scene, layer.id, 'up')); }}><ArrowUp className="w-3 h-3" /></button>
                  <button className="text-[#777] hover:text-[#d4af37]" onClick={(e) => { e.stopPropagation(); onSceneChange(moveLayer(scene, layer.id, 'down')); }}><ArrowDown className="w-3 h-3" /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
