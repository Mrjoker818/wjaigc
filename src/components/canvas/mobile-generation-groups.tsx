'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactPortal } from 'react';
import { createPortal } from 'react-dom';
import { Layers, Minus, PanelTopOpen, X } from 'lucide-react';

export interface MobileGenerationGroupSlots {
  title: HTMLDivElement;
  sources: HTMLDivElement;
  preview: HTMLDivElement;
  toolbar: HTMLDivElement;
}

interface GroupTargetProps {
  id: string;
  toolbar: 'generation-group';
  register: (id: string, slots: MobileGenerationGroupSlots | null) => void;
}

function GroupTarget({ id, toolbar, register }: GroupTargetProps): ReactElement {
  const title = useRef<HTMLDivElement>(null);
  const sources = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useLayoutEffect((): (() => void) => {
    if (title.current && sources.current && preview.current && toolbarRef.current) register(id, { title: title.current, sources: sources.current, preview: preview.current, toolbar: toolbarRef.current });
    return (): void => register(id, null);
  }, [id, register]);
  return (
    <section data-toolbar={toolbar} className="relative flex min-w-0 flex-col gap-3 overflow-visible rounded-xl border border-current/15 p-2">
      <div ref={title} className="min-w-0 [&:empty]:hidden" />
      <div ref={sources} className="flex min-w-0 flex-col gap-3 [&:empty]:hidden" />
      <div ref={preview} className="min-w-0 [&:empty]:hidden" />
      <div ref={toolbarRef} className="min-w-0 [&:empty]:hidden" />
    </section>
  );
}

interface MobileGenerationGroupHostProps {
  'data-toolbar': 'generation-group';
  groupIds: string[];
  isMonochrome: boolean;
  register: (id: string, slots: MobileGenerationGroupSlots | null) => void;
}

export function MobileGenerationGroupHost({ 'data-toolbar': toolbar, groupIds, isMonochrome, register }: MobileGenerationGroupHostProps): ReactPortal | null {
  const [mode, setMode] = useState<'minimized' | 'expanded' | 'closed'>('minimized');
  const opener = useRef<HTMLButtonElement>(null);
  const previousMode = useRef(mode);
  useLayoutEffect((): void => {
    if (previousMode.current !== mode && mode !== 'expanded') opener.current?.focus();
    previousMode.current = mode;
  }, [mode]);
  useEffect((): (() => void) | undefined => {
    if (mode !== 'expanded') return undefined;
    const keydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setMode('minimized');
    };
    document.addEventListener('keydown', keydown, true);
    return (): void => document.removeEventListener('keydown', keydown, true);
  }, [mode]);
  if (typeof document === 'undefined') return null;
  const surface = isMonochrome ? 'border-gray-200 bg-white text-gray-800 shadow-lg' : 'border-white/15 bg-[#171717] text-gray-100 shadow-xl';
  const button = isMonochrome ? 'hover:bg-gray-100 focus-visible:outline-blue-600' : 'hover:bg-white/10 focus-visible:outline-gold';
  return createPortal(
    <aside
      data-floating-panel="generation-group-settings"
      className={`fixed z-[79] flex min-h-0 flex-col overflow-hidden rounded-xl border ${surface} ${mode === 'expanded' ? 'inset-x-2 top-2 bottom-[calc(72px+env(safe-area-inset-bottom))]' : mode === 'closed' ? 'top-16 right-2 max-w-[calc(100vw-96px)]' : 'top-16 right-2 left-[88px]'}`}
      onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
    >
      {mode === 'closed' ? (
        <button ref={opener} type="button" aria-label="打开生成组设置" className={`flex min-h-11 items-center gap-2 px-3 text-sm ${button}`} onClick={() => setMode('expanded')}>
          <Layers className="h-4 w-4" />生成组 ({groupIds.length})
        </button>
      ) : (
        <header className="flex shrink-0 items-center gap-1 border-b border-current/15 px-2 py-1">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">生成组 ({groupIds.length})</span>
          <button ref={opener} type="button" aria-label={mode === 'expanded' ? '最小化生成组设置' : '打开生成组设置'} aria-expanded={mode === 'expanded'} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${button}`} onClick={() => setMode(current => current === 'expanded' ? 'minimized' : 'expanded')}>
            {mode === 'expanded' ? <Minus className="h-5 w-5" /> : <PanelTopOpen className="h-5 w-5" />}
          </button>
          <button type="button" aria-label="关闭生成组设置" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${button}`} onClick={() => setMode('closed')}><X className="h-5 w-5" /></button>
        </header>
      )}
      <div hidden={mode !== 'expanded'} data-mobile-generation-scroll className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-2 [touch-action:pan-y] [&_button]:scroll-my-2 [&_textarea]:scroll-my-2 [&_input]:scroll-my-2">
        {groupIds.map(id => <GroupTarget key={id} id={id} toolbar={toolbar} register={register} />)}
      </div>
    </aside>,
    document.body,
  );
}

interface ResponsiveGenerationGroupSlotProps {
  mobile: boolean;
  host: MobileGenerationGroupSlots | null;
  slot: keyof MobileGenerationGroupSlots;
  children: ReactElement;
}

export function ResponsiveGenerationGroupSlot({ mobile, host, slot, children }: ResponsiveGenerationGroupSlotProps): ReactElement | ReactPortal | null {
  if (!mobile) return children;
  return host ? createPortal(children, host[slot]) : null;
}
