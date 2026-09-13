'use client';

import { useMemo, useState } from 'react';
import { Hand, Menu, MousePointer2, Upload, X } from 'lucide-react';

import {
  buildMobileCanvasToolbar,
  type CanvasToolbarAction,
} from '@/lib/mobile-canvas-toolbar';

export interface MobileBottomToolbarProps {
  actions: readonly CanvasToolbarAction[];
  zoomLabel: string;
  isMonochrome?: boolean;
}

const primaryIcons = {
  select: <MousePointer2 className="h-4 w-4" />,
  pan: <Hand className="h-4 w-4" />,
  upload: <Upload className="h-4 w-4" />,
  'all-tools': <Menu className="h-4 w-4" />,
} as const;

export function MobileBottomToolbar({
  actions,
  zoomLabel,
  isMonochrome = false,
}: MobileBottomToolbarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const projection = useMemo(() => buildMobileCanvasToolbar(actions), [actions]);
  const actionById = useMemo(
    () => new Map(projection.drawer.map(action => [action.id, action])),
    [projection.drawer],
  );
  const groups = useMemo(() => {
    const result = new Map<string, CanvasToolbarAction[]>();
    projection.drawer.forEach(action => {
      const group = result.get(action.group) ?? [];
      group.push(action);
      result.set(action.group, group);
    });
    return [...result.entries()];
  }, [projection.drawer]);

  const surfaceClass = isMonochrome
    ? 'border-gray-200 bg-white/95 text-gray-700 shadow-lg'
    : 'border-white/10 bg-[#171717]/95 text-gray-200 shadow-2xl backdrop-blur-md';
  const buttonClass = isMonochrome
    ? 'text-gray-600 hover:bg-gray-100 active:bg-gray-200'
    : 'text-gray-300 hover:bg-white/10 active:bg-white/15';

  return (
    <>
      <div
        data-mobile-canvas-toolbar
        data-toolbar="mobile-bottom-toolbar"
        className={`fixed inset-x-2 bottom-[calc(8px+env(safe-area-inset-bottom))] z-[75] grid h-14 grid-cols-5 items-center rounded-lg border px-1 md:hidden ${surfaceClass}`}
        onPointerDown={event => event.stopPropagation()}
        onMouseDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
        onWheel={event => event.stopPropagation()}
      >
        {projection.primary.map(slot => {
          if (slot.id === 'zoom-status') {
            return (
              <div
                key={slot.id}
                data-mobile-toolbar-primary
                role="status"
                aria-label={`当前缩放 ${zoomLabel}`}
                className="flex min-h-10 min-w-10 flex-col items-center justify-center gap-0.5 text-[10px]"
              >
                <span className="font-semibold">{zoomLabel}</span>
                <span className="text-[9px] opacity-60">缩放</span>
              </div>
            );
          }

          const action = actionById.get(slot.id);
          const isAllTools = slot.id === 'all-tools';
          return (
            <button
              key={slot.id}
              type="button"
              data-mobile-toolbar-primary
              aria-label={slot.label}
              aria-pressed={!isAllTools && action ? action.active : undefined}
              aria-expanded={isAllTools ? drawerOpen : undefined}
              disabled={!isAllTools && (!action || action.disabled)}
              className={`flex min-h-10 min-w-10 flex-col items-center justify-center gap-0.5 rounded-md text-[9px] transition-colors ${
                action?.active ? (isMonochrome ? 'bg-gray-900 text-white' : 'bg-white/15 text-white') : buttonClass
              }`}
              onClick={() => {
                if (isAllTools) {
                  setDrawerOpen(open => !open);
                  return;
                }
                action?.onActivate();
              }}
            >
              {primaryIcons[slot.id as keyof typeof primaryIcons]}
              <span>{slot.label}</span>
            </button>
          );
        })}
      </div>

      {drawerOpen && (
        <div
          role="dialog"
          aria-label="全部工具"
          data-mobile-canvas-toolbar-drawer
          className={`fixed inset-x-2 bottom-[calc(72px+env(safe-area-inset-bottom))] z-[76] max-h-[calc(100dvh-96px-env(safe-area-inset-bottom))] overflow-y-auto rounded-lg border p-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:hidden ${surfaceClass}`}
          onPointerDown={event => event.stopPropagation()}
          onMouseDown={event => event.stopPropagation()}
          onWheel={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
        >
          <div className="mb-2 flex min-h-10 items-center justify-between px-1">
            <span className="text-sm font-semibold">全部工具</span>
            <button
              type="button"
              aria-label="关闭全部工具"
              className={`flex min-h-10 min-w-10 items-center justify-center rounded-md ${buttonClass}`}
              onClick={() => setDrawerOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3">
            {groups.map(([groupName, groupActions]) => (
              <section key={groupName} aria-label={groupName}>
                <h3 className="mb-1 px-1 text-[10px] font-semibold text-gray-400">{groupName}</h3>
                <div className="grid grid-cols-4 gap-1">
                  {groupActions.map(action => (
                    <button
                      key={action.id}
                      type="button"
                      aria-label={action.label}
                      disabled={action.disabled}
                      className={`flex min-h-10 min-w-10 flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-[10px] ${buttonClass}`}
                      onClick={() => {
                        action.onActivate();
                        setDrawerOpen(false);
                      }}
                    >
                      {action.icon}
                      <span className="max-w-full truncate">{action.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
