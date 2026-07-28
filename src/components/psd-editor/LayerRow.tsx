'use client';

import React, { useRef, useState } from 'react';
import type { DesignLayer } from '@/lib/psd-export';

interface LayerRowProps {
  layer: DesignLayer;
  isSelected: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onRename: (newName: string) => void;
}

function roleIcon(role: string): string {
  const map: Record<string, string> = {
    background: '背',
    subject: '主',
    shadow: '效',
    text: '文',
    deco: '饰',
    decoration: '饰',
    vector: '矢',
    original: '原',
  };
  return map[role] || '层';
}

export function LayerRow({ layer, isSelected, onSelect, onToggleVisibility, onToggleLock, onRename }: LayerRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [tempName, setTempName] = useState(layer.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = () => {
    setTempName(layer.name);
    setIsRenaming(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleRenameSubmit = () => {
    const trimmed = tempName.trim();
    if (trimmed && trimmed !== layer.name) onRename(trimmed);
    setIsRenaming(false);
  };

  return (
    <div
      data-layer-row={layer.id}
      onClick={onSelect}
      onDoubleClick={handleDoubleClick}
      className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors group ${
        isSelected ? 'bg-amber-500/15 border-l-2 border-amber-500' : 'hover:bg-neutral-800 border-l-2 border-transparent'
      } ${!layer.visible ? 'opacity-50' : ''}`}
    >
      <span className="text-xs text-neutral-400 w-5 text-center flex-shrink-0">
        {roleIcon(layer.role)}
      </span>

      {isRenaming ? (
        <input
          ref={inputRef}
          value={tempName}
          onChange={(e) => setTempName(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameSubmit();
            if (e.key === 'Escape') setIsRenaming(false);
            e.stopPropagation();
          }}
          className="flex-1 bg-neutral-700 text-white text-xs px-1 py-0.5 rounded outline-none min-w-0"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 text-xs text-white truncate min-w-0">
          {layer.name}
        </span>
      )}

      <button
        data-layer-action="visibility"
        onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
        className="w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
        title={layer.visible ? '隐藏' : '显示'}
      >
        {layer.visible ? '视' : '-'}
      </button>

      <button
        data-layer-action="lock"
        onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
        className={`w-5 h-5 flex items-center justify-center text-xs transition-opacity ${
          layer.locked ? 'opacity-100 text-amber-400' : 'opacity-0 group-hover:opacity-100'
        }`}
        title={layer.locked ? '解锁' : '锁定'}
      >
        {layer.locked ? '锁' : '开'}
      </button>
    </div>
  );
}
