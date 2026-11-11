'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
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
  const nameRef = useRef<HTMLButtonElement>(null);
  const restoreNameFocus = useRef(false);

  useLayoutEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
    } else if (restoreNameFocus.current) {
      restoreNameFocus.current = false;
      nameRef.current?.focus({ preventScroll: true });
    }
  }, [isRenaming]);

  const startRename = () => {
    setTempName(layer.name);
    setIsRenaming(true);
  };

  const handleRenameSubmit = () => {
    const trimmed = tempName.trim();
    if (trimmed && trimmed !== layer.name) onRename(trimmed);
    setIsRenaming(false);
  };

  return (
    <div
      data-layer-row={layer.id}
      data-layer-selected={isSelected ? 'true' : 'false'}
      onClick={onSelect}
      onDoubleClick={event => {
        if (event.target instanceof Element && event.target.closest('[data-layer-action], input')) return;
        startRename();
      }}
      className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer text-white transition-colors group ${
        isSelected ? 'bg-amber-500/15 border-l-2 border-amber-500' : 'hover:bg-neutral-800 border-l-2 border-transparent'
      } ${!layer.visible ? 'opacity-50' : ''}`}
    >
      <span className="text-xs text-neutral-400 w-5 text-center flex-shrink-0">
        {roleIcon(layer.role)}
      </span>

      {isRenaming ? (
        <input
          ref={inputRef}
          aria-label="重命名图层"
          value={tempName}
          onChange={(e) => setTempName(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing || (e.key !== 'Enter' && e.key !== 'Escape')) return;
            e.preventDefault();
            restoreNameFocus.current = true;
            if (e.key === 'Enter') handleRenameSubmit();
            else setIsRenaming(false);
          }}
          className="flex-1 bg-neutral-700 text-white text-xs px-1 py-0.5 rounded outline-none min-w-0"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <button
          ref={nameRef}
          type="button"
          aria-pressed={isSelected}
          aria-keyshortcuts="F2"
          onClick={event => { event.stopPropagation(); onSelect(); }}
          onKeyDown={event => {
            if (event.key !== 'F2' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            startRename();
          }}
          className="min-w-0 flex-1 self-stretch truncate rounded text-left text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400"
        >
          {layer.name}
        </button>
      )}

      <button
        type="button"
        data-layer-action="visibility"
        data-layer-visible={layer.visible ? 'true' : 'false'}
        aria-label={`图层可见性：${layer.name}`}
        aria-pressed={layer.visible}
        onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
        className="flex h-11 w-11 shrink-0 items-center justify-center text-xs opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 md:[@media(hover:hover)_and_(pointer:fine)]:h-5 md:[@media(hover:hover)_and_(pointer:fine)]:w-5 md:[@media(hover:hover)_and_(pointer:fine)]:opacity-0 md:[@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 md:[@media(hover:hover)_and_(pointer:fine)]:focus-visible:opacity-100"
        title={layer.visible ? '隐藏' : '显示'}
      >
        {layer.visible ? '视' : '-'}
      </button>

      <button
        type="button"
        data-layer-action="lock"
        aria-label={`图层锁定：${layer.name}`}
        aria-pressed={layer.locked === true}
        onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
        className={`flex h-11 w-11 shrink-0 items-center justify-center text-xs opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 md:[@media(hover:hover)_and_(pointer:fine)]:h-5 md:[@media(hover:hover)_and_(pointer:fine)]:w-5 ${
          layer.locked ? 'text-amber-400' : 'md:[@media(hover:hover)_and_(pointer:fine)]:opacity-0 md:[@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 md:[@media(hover:hover)_and_(pointer:fine)]:focus-visible:opacity-100'
        }`}
        title={layer.locked ? '解锁' : '锁定'}
      >
        {layer.locked ? '锁' : '开'}
      </button>
    </div>
  );
}
