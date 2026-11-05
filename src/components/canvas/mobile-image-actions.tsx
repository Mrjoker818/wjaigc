'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
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

interface ActionPointerIntent {
  button: HTMLButtonElement;
  actionId: string | null;
  pointerId: number;
  pointerType: string;
  epoch: number;
  released: boolean;
  cancelled: boolean;
  legacyMouseDown: boolean;
  legacyMouseUp: boolean;
}

function matchesLegacyMouseWitness(
  event: ReactMouseEvent<HTMLDivElement>, intent: ActionPointerIntent, epoch: number,
): boolean {
  const button = event.target instanceof Element ? event.target.closest('button') : null;
  return event.button === 0 && !intent.cancelled && intent.epoch === epoch
    && button === intent.button && event.currentTarget.contains(intent.button) && !intent.button.disabled
    && intent.actionId === intent.button.getAttribute('data-mobile-image-action');
}

export function MobileImageActions({
  actions,
  viewportWidth,
  isMonochrome = false,
}: MobileImageActionsProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const pointerIntentRef = useRef<ActionPointerIntent | null>(null);
  const activePointersRef = useRef(new Set<number>());
  const drawerEpochRef = useRef(0);
  const fixedActions = fixedActionIds
    .map(id => actions.find(action => action.id === id))
    .filter((action): action is MobileImageAction => Boolean(action));
  const surfaceClass = isMonochrome
    ? 'border-gray-200 bg-white/95 text-gray-700 shadow-lg'
    : 'border-white/10 bg-[#171717]/95 text-gray-200 shadow-2xl backdrop-blur-md';
  const idleClass = isMonochrome
    ? 'hover:bg-gray-100 active:bg-gray-200'
    : 'hover:bg-white/10 active:bg-white/15';

  const disabledReasons = [...new Set(actions.flatMap(action => action.disabled && action.description ? [action.description] : []))];

  const invalidatePointerIntent = useCallback((): void => {
    drawerEpochRef.current++;
    pointerIntentRef.current = null;
    activePointersRef.current.clear();
  }, []);
  const beginPointerIntent = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const active = activePointersRef.current;
    // A new press of the same pointer may follow a release outside this drawer.
    if (active.size === 1 && active.has(event.pointerId) && event.isPrimary !== false && event.button === 0) active.clear();
    if (active.size > 0 || event.isPrimary === false || event.button !== 0) {
      if (pointerIntentRef.current) pointerIntentRef.current.cancelled = true;
      active.add(event.pointerId);
      return;
    }
    active.add(event.pointerId);
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    pointerIntentRef.current = button instanceof HTMLButtonElement
      && event.currentTarget.contains(button) && !button.disabled
      ? {
        button, actionId: button.getAttribute('data-mobile-image-action'),
        pointerId: event.pointerId, pointerType: event.pointerType,
        epoch: drawerEpochRef.current, released: false, cancelled: false,
        legacyMouseDown: false, legacyMouseUp: false,
      } : null;
  }, []);
  const releasePointerIntent = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    activePointersRef.current.delete(event.pointerId);
    const intent = pointerIntentRef.current;
    if (intent?.pointerId === event.pointerId) intent.released = true;
  }, []);
  const cancelPointerIntent = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    activePointersRef.current.delete(event.pointerId);
    const intent = pointerIntentRef.current;
    if (intent?.pointerId === event.pointerId) intent.cancelled = true;
  }, []);
  const losePointerIntentCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const intent = pointerIntentRef.current;
    // Automatic release follows pointerup, before the delayed touch click.
    if (intent?.pointerId === event.pointerId && !intent.released) {
      intent.cancelled = true;
      activePointersRef.current.delete(event.pointerId);
    }
  }, []);
  const witnessLegacyMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    const intent = pointerIntentRef.current;
    if (!intent) return;
    // Mouse compatibility events may arrive together after pointerup.
    intent.legacyMouseDown = matchesLegacyMouseWitness(event, intent, drawerEpochRef.current);
    intent.legacyMouseUp = false;
  }, []);
  const witnessLegacyMouseUp = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    const intent = pointerIntentRef.current;
    if (!intent) return;
    intent.legacyMouseUp = intent.legacyMouseDown && intent.released && activePointersRef.current.size === 0
      && matchesLegacyMouseWitness(event, intent, drawerEpochRef.current);
  }, []);
  const validatePointerClick = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    const native = event.nativeEvent as MouseEvent & Partial<Pick<PointerEvent, 'pointerId' | 'pointerType'>>;
    const hasIdField = 'pointerId' in native;
    const hasTypeField = 'pointerType' in native;
    const completeIdentity = hasIdField && hasTypeField && typeof native.pointerId === 'number'
      && Number.isInteger(native.pointerId) && native.pointerId >= 0
      && typeof native.pointerType === 'string' && native.pointerType.length > 0;
    const nonPointerActivation = event.detail === 0 && ((!hasIdField && !hasTypeField)
      || (hasIdField && hasTypeField && native.pointerId === -1 && native.pointerType === ''));
    const legacyMouseClick = !hasIdField && !hasTypeField && event.detail > 0 && native instanceof MouseEvent;
    const reject = (): void => {
      if (pointerIntentRef.current) pointerIntentRef.current.cancelled = true;
      event.preventDefault();
      event.stopPropagation();
    };
    if (!(button instanceof HTMLButtonElement) || !event.currentTarget.contains(button) || button.disabled) {
      reject();
      return;
    }
    // Unassociated keyboard/assistive activation has no pointer gesture to match.
    // A touch-associated click still needs validation even when detail is zero.
    if (nonPointerActivation) {
      invalidatePointerIntent();
      return;
    }
    const intent = pointerIntentRef.current;
    if ((!completeIdentity && !legacyMouseClick) || !intent || intent.cancelled || !intent.released || activePointersRef.current.size > 0
      || intent.epoch !== drawerEpochRef.current || intent.button !== button
      || intent.actionId !== button.getAttribute('data-mobile-image-action')
      || !Number.isInteger(intent.pointerId) || intent.pointerId < 0
      || typeof intent.pointerType !== 'string' || intent.pointerType.length === 0
      || (completeIdentity && (intent.pointerId !== native.pointerId || intent.pointerType !== native.pointerType))
      || (legacyMouseClick && (!intent.legacyMouseDown || !intent.legacyMouseUp))) {
      reject();
      return;
    }
    pointerIntentRef.current = null;
  }, [invalidatePointerIntent]);

  const closeDrawer = useCallback((): void => {
    invalidatePointerIntent();
    moreButtonRef.current?.focus();
    setDrawerOpen(false);
  }, [invalidatePointerIntent]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeDrawer();
    };
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', invalidatePointerIntent);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', invalidatePointerIntent);
    };
  }, [drawerOpen, closeDrawer, invalidatePointerIntent]);

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
            className={`flex h-11 min-h-10 min-w-10 flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-[9px] transition-colors ${
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
          aria-controls="mobile-image-actions-drawer"
          className={`flex h-11 min-h-10 min-w-10 flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-[9px] transition-colors ${idleClass}`}
          onClick={() => { invalidatePointerIntent(); setDrawerOpen(open => !open); }}
        >
          <MoreHorizontal className="h-4 w-4" />
          <span>更多</span>
        </button>
      </div>

      {drawerOpen && (
        <div
          role="dialog"
          aria-label="图片工具"
          id="mobile-image-actions-drawer"
          data-mobile-image-actions-drawer
          className={`fixed inset-x-2 bottom-[calc(128px+env(safe-area-inset-bottom))] z-[76] max-h-[calc(100dvh-152px-env(safe-area-inset-bottom))] overflow-y-auto rounded-lg border p-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:hidden ${surfaceClass}`}
          onPointerDownCapture={beginPointerIntent}
          onPointerUpCapture={releasePointerIntent}
          onPointerCancelCapture={cancelPointerIntent}
          onLostPointerCaptureCapture={losePointerIntentCapture}
          onMouseDownCapture={witnessLegacyMouseDown}
          onMouseUpCapture={witnessLegacyMouseUp}
          onClickCapture={validatePointerClick}
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
              className={`flex h-11 w-11 min-h-10 min-w-10 items-center justify-center rounded-md ${idleClass}`}
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
          {disabledReasons.length > 0 && (
            <p role="status" className="mt-2 break-words px-1 text-sm leading-relaxed">{disabledReasons.join("；")}</p>
          )}
        </div>
      )}
    </>
  );
}
