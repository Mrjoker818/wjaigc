'use client';

import { CornerDownLeft, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface CanvasCommandItem {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  section?: string;
  keywords?: string;
  action: () => void;
}

export interface CanvasCommandPaletteProps {
  commands: CanvasCommandItem[];
  theme?: 'dark' | 'mono';
  onClose: () => void;
}

export interface CanvasCommandPaletteShortcutEvent {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  target: EventTarget | null;
}

export function shouldToggleCanvasCommandPalette(
  event: CanvasCommandPaletteShortcutEvent,
): boolean {
  if ((!event.ctrlKey && !event.metaKey) || event.code !== 'KeyK') return false;
  if (!(event.target instanceof Element)) return true;
  if (
    event.target instanceof HTMLElement
    && (event.target.isContentEditable || event.target.contentEditable === 'true')
  ) return false;

  return !event.target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-popup], [data-modal], [data-floating-panel], [role="dialog"]',
  );
}

export function filterCanvasCommands(
  commands: CanvasCommandItem[],
  query: string,
): CanvasCommandItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return commands;

  return commands.filter(command => [
    command.label,
    command.hint,
    command.section,
    command.keywords,
  ].some(value => value?.toLocaleLowerCase().includes(normalizedQuery)));
}

export function CanvasCommandPalette({
  commands,
  theme = 'dark',
  onClose,
}: CanvasCommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const filteredCommands = useMemo(
    () => filterCanvasCommands(commands, query),
    [commands, query],
  );
  const isMonochrome = theme === 'mono';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>(
      `[data-command-index="${selectedIndex}"]`,
    );
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const executeCommand = useCallback((index: number) => {
    const command = filteredCommands[index];
    if (!command) return;
    onClose();
    command.action();
  }, [filteredCommands, onClose]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex(index => filteredCommands.length === 0
        ? 0
        : (index + 1) % filteredCommands.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex(index => filteredCommands.length === 0
        ? 0
        : (index - 1 + filteredCommands.length) % filteredCommands.length);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      executeCommand(selectedIndex);
    }
  }, [executeCommand, filteredCommands.length, onClose, selectedIndex]);

  return (
    <div
      data-popup
      data-command-palette
      data-testid="canvas-command-palette-backdrop"
      className="fixed inset-0 z-[95] flex items-start justify-center bg-black/50 px-4 pt-[18vh]"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-command-palette-title"
        onKeyDown={handleKeyDown}
        className={`flex max-h-[52vh] w-[560px] max-w-full flex-col overflow-hidden rounded-lg border shadow-2xl ${
          isMonochrome
            ? 'border-gray-300 bg-white text-gray-900'
            : 'border-white/15 bg-[#161616] text-[#e8e8e8]'
        }`}
      >
        <div
          className={`flex items-center gap-2.5 border-b px-4 ${
            isMonochrome ? 'border-gray-200 bg-gray-50' : 'border-white/10 bg-[#1d1d1d]'
          }`}
        >
          <Search aria-hidden="true" className={`h-4 w-4 shrink-0 ${isMonochrome ? 'text-gray-500' : 'text-[#9a9a9a]'}`} />
          <span id="canvas-command-palette-title" className="sr-only">画布命令面板</span>
          <input
            ref={inputRef}
            type="search"
            aria-label="搜索画布命令"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索命令"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-gray-500"
          />
          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${
            isMonochrome ? 'border-gray-300 text-gray-500' : 'border-white/15 text-[#9a9a9a]'
          }`}>ESC</span>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5">
          {filteredCommands.length === 0 ? (
            <div className={`px-4 py-6 text-center text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#9a9a9a]'}`}>
              没有匹配的命令
            </div>
          ) : filteredCommands.map((command, index) => {
            const selected = index === selectedIndex;
            return (
              <button
                key={command.id}
                type="button"
                data-command-index={index}
                aria-current={selected ? 'true' : undefined}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => executeCommand(index)}
                className={`flex w-full items-center gap-3 border-l-2 px-4 py-2.5 text-left transition-colors ${
                  selected
                    ? isMonochrome
                      ? 'border-gray-900 bg-gray-100'
                      : 'border-[#d4af37] bg-[#d4af37]/10'
                    : 'border-transparent bg-transparent'
                }`}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{command.label}</span>
                  {command.hint ? (
                    <span className={`truncate text-[11px] ${isMonochrome ? 'text-gray-500' : 'text-[#9a9a9a]'}`}>
                      {command.hint}
                    </span>
                  ) : null}
                </span>
                {command.section ? (
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${
                    isMonochrome ? 'border-gray-300 text-gray-500' : 'border-white/15 text-[#9a9a9a]'
                  }`}>
                    {command.section}
                  </span>
                ) : null}
                {command.shortcut ? (
                  <span className={`shrink-0 text-[10px] ${isMonochrome ? 'text-gray-500' : 'text-[#9a9a9a]'}`}>
                    {command.shortcut}
                  </span>
                ) : null}
                {selected ? (
                  <CornerDownLeft aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${isMonochrome ? 'text-gray-900' : 'text-[#d4af37]'}`} />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className={`flex items-center gap-3 border-t px-4 py-2 text-[10px] ${
          isMonochrome ? 'border-gray-200 text-gray-500' : 'border-white/10 text-[#9a9a9a]'
        }`}>
          <span>上下键导航</span>
          <span>回车执行</span>
          <span>ESC 关闭</span>
        </div>
      </div>
    </div>
  );
}
