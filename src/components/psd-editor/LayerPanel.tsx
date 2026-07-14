'use client';

import React from 'react';
import type { DesignLayer } from '@/lib/psd-export';
import { LayerRow } from './LayerRow';

interface LayerPanelProps {
  layers: DesignLayer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onRenameLayer: (id: string, newName: string) => void;
  onReorderLayers: (fromIndex: number, toIndex: number) => void;
}

export function LayerPanel({
  layers,
  selectedLayerId,
  onSelectLayer,
  onToggleVisibility,
  onToggleLock,
  onRenameLayer,
  onReorderLayers,
}: LayerPanelProps) {
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const reversedLayers = [...layers].reverse();

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      onReorderLayers(dragIndex, index);
      setDragIndex(index);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-2.5 py-2 border-b border-neutral-800">
        <h3 className="text-xs text-neutral-400 uppercase tracking-wider">图层</h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        {reversedLayers.map((layer, i) => {
          const originalIndex = layers.length - 1 - i;
          return (
            <div
              key={layer.id}
              draggable
              onDragStart={() => setDragIndex(originalIndex)}
              onDragOver={(e) => handleDragOver(e, originalIndex)}
              onDragEnd={() => setDragIndex(null)}
            >
              <LayerRow
                layer={layer}
                isSelected={selectedLayerId === layer.id}
                onSelect={() => onSelectLayer(layer.id)}
                onToggleVisibility={() => onToggleVisibility(layer.id)}
                onToggleLock={() => onToggleLock(layer.id)}
                onRename={(newName) => onRenameLayer(layer.id, newName)}
              />
            </div>
          );
        })}
        {layers.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-neutral-500">
            暂无图层
          </div>
        )}
      </div>
    </div>
  );
}
