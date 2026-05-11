import type { SceneGraph } from '@/types/designGraph';
import { selectLayer } from '@/lib/design-graph';

interface DesignCanvasProps {
  scene: SceneGraph;
  onSceneChange: (scene: SceneGraph) => void;
}

export function DesignCanvas({ scene, onSceneChange }: DesignCanvasProps) {
  const selectedId = scene.selectedLayerIds[0];
  const layers = [...scene.layers].sort((a, b) => a.zIndex - b.zIndex);
  const scale = Math.min(1, 900 / Math.max(scene.width, scene.height, 1));

  return (
    <main className="flex-1 overflow-auto bg-[#050505] p-8 flex items-center justify-center">
      <div
        className="relative shadow-2xl border border-[#333]"
        style={{ width: scene.width * scale, height: scene.height * scale, background: scene.background }}
      >
        {layers.map(layer => {
          if (!layer.visible) return null;
          const isSelected = selectedId === layer.id;
          const commonStyle = {
            position: 'absolute' as const,
            left: layer.bbox.x * scale,
            top: layer.bbox.y * scale,
            width: layer.bbox.width * scale,
            height: layer.bbox.height * scale,
            opacity: layer.opacity,
            transform: `rotate(${layer.transform?.rotation || 0}deg)`,
            outline: isSelected ? '2px solid #d4af37' : '1px solid rgba(255,255,255,0.06)',
            cursor: layer.locked ? 'not-allowed' : 'pointer',
            overflow: 'hidden',
          };
          return (
            <div key={layer.id} style={commonStyle} onClick={(e) => { e.stopPropagation(); onSceneChange(selectLayer(scene, layer.id)); }} title={layer.name}>
              {layer.svg ? (
                <div className="w-full h-full" dangerouslySetInnerHTML={{ __html: layer.svg }} />
              ) : layer.imageUrl ? (
                <img src={layer.imageUrl} alt={layer.name} className="w-full h-full object-contain select-none pointer-events-none" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-white/50 bg-white/5">{layer.name}</div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
