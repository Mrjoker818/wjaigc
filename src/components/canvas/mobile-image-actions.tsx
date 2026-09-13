'use client';

import { useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal, X } from 'lucide-react';

export interface MobileImageAction {
  id: string;
  label: string;
  icon: ReactNode;
  description?: string;
  disabled?: boolean;
  onActivate: () => void;
}

export interface MobileImageActionsProps {
  actions: readonly MobileImageAction[];
  viewportWidth?: number;
  isMonochrome?: boolean;
}

const fixedActionIds = ['preview', 'download', 'delete'] as const;

export function MobileImageActions({
  actions,
  viewportWidth,
  isMonochrome = false,
}: MobileImageActionsProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const fixedActions = fixedActionIds
    .map(id => actions.find(action => action.id === id))
    .filter((action): action is MobileImageAction => Boolean(action));
  const surfaceClass = isMonochrome
    ? 'border-gray-200 bg-white/95 text-gray-700 shadow-lg'
    : 'border-white/10 bg-[#171717]/95 text-gray-200 shadow-2xl backdrop-blur-md';
  const idleClass = isMonochrome
    ? 'hover:bg-gray-100 active:bg-gray-200'
    : 'hover:bg-white/10 active:bg-white/15';

  const closeDrawer = (): void => {
    moreButtonRef.current?.focus();
    setDrawerOpen(false);
  };

  return (
    <>
      <div
        data-mobile-image-actions
        data-toolbar="mobile-image-actions"
        className={`fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-1/2 z-[74] flex h-12 max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-1 rounded-lg border px-1 md:hidden ${surfaceClass}`}
        style={viewportWidth ? { width: Math.min(viewportWidth - 16, 240) } : undefined}
        onPointerDown={event => event.stopPropagation()}
        onMouseDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
        onWheel={event => event.stopPropagation()}
      >
        {fixedActions.map(action => (
          <button
            key={action.id}
            type="button"
            aria-label={action.label}
            disabled={action.disabled}
            className={`flex min-h-10 min-w-10 flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-[9px] transition-colors ${
              action.id === 'delete' ? 'text-red-400 hover:bg-red-500/10' : idleClass
            }`}
            onClick={action.onActivate}
          >
            {action.icon}
            <span className="max-w-full truncate">{action.label}</span>
          </button>
        ))}
        <button
          ref={moreButtonRef}
          type="button"
          aria-label="更多"
          aria-expanded={drawerOpen}
          className={`flex min-h-10 min-w-10 flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-[9px] transition-colors ${idleClass}`}
          onClick={() => setDrawerOpen(open => !open)}
        >
          <MoreHorizontal className="h-4 w-4" />
          <span>更多</span>
        </button>
      </div>

      {drawerOpen && (
        <div
          role="dialog"
          aria-label="图片工具"
          data-mobile-image-actions-drawer
          className={`fixed inset-x-2 bottom-[calc(128px+env(safe-area-inset-bottom))] z-[76] max-h-[calc(100dvh-152px-env(safe-area-inset-bottom))] overflow-y-auto rounded-lg border p-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:hidden ${surfaceClass}`}
          onPointerDown={event => event.stopPropagation()}
          onMouseDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
          onWheel={event => event.stopPropagation()}
        >
          <div className="mb-2 flex min-h-10 items-center justify-between px-1">
            <span className="text-sm font-semibold">图片工具</span>
            <button
              type="button"
              aria-label="关闭图片工具"
              className={`flex min-h-10 min-w-10 items-center justify-center rounded-md ${idleClass}`}
              onClick={closeDrawer}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {actions.map(action => (
              <button
                key={action.id}
                type="button"
                data-mobile-image-action={action.id}
                aria-label={action.label}
                title={action.description || action.label}
                disabled={action.disabled}
                className={`flex min-h-10 min-w-10 flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-[10px] ${
                  action.id === 'delete' ? 'text-red-400 hover:bg-red-500/10' : idleClass
                }`}
                onClick={() => {
                  action.onActivate();
                  closeDrawer();
                }}
              >
                {action.icon}
                <span className="max-w-full truncate">{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
