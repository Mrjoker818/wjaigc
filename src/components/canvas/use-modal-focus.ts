'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';

const openDialogs: HTMLElement[] = [];
const tabbableSelector = 'button, input, select, textarea, a[href], summary, [contenteditable="true"], [tabindex]';

function getTabStops(scope: HTMLElement): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(tabbableSelector)].filter(element =>
    element.tabIndex >= 0
    && !element.matches(':disabled')
    && !element.closest('[hidden], [inert]')
    && element.getClientRects().length > 0
    && getComputedStyle(element).visibility === 'visible',
  );
}

export function useModalFocus(
  dialogRef: RefObject<HTMLElement | null>,
  initialFocusRef: RefObject<HTMLElement | null>,
  onClose: (() => void) | undefined,
  open = true,
): void {
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const doc = dialog.ownerDocument;
    const opener = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const isTop = () => openDialogs.at(-1) === dialog;
    let lastFocused: HTMLElement | null = null;

    const focusInside = () => {
      if (lastFocused && dialog.contains(lastFocused)) lastFocused.focus({ preventScroll: true });
      if (!dialog.contains(doc.activeElement)) initialFocusRef.current?.focus({ preventScroll: true });
      if (!dialog.contains(doc.activeElement)) dialog.focus({ preventScroll: true });
    };
    const handleFocus = (event: FocusEvent) => {
      if (!isTop()) return;
      if (event.target instanceof HTMLElement && dialog.contains(event.target)) {
        lastFocused = event.target;
      } else {
        focusInside();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || !closeRef.current) return;
      // Let the browser exit fullscreen before Escape can dismiss the preview.
      if (doc.fullscreenElement && dialog.contains(doc.fullscreenElement)) return;
      event.preventDefault();
      closeRef.current();
    };
    const blockOutsideKey = (event: KeyboardEvent) => {
      if (!isTop() || (event.target instanceof Node && dialog.contains(event.target))) return;
      event.stopPropagation();
      focusInside();
      handleEscape(event);
      event.preventDefault();
    };
    const handleInsideKey = (event: KeyboardEvent) => {
      if (!isTop() || !(event.target instanceof Node) || !dialog.contains(event.target)) return;
      // Let dialog controls handle their keys first, then keep canvas shortcuts out.
      event.stopPropagation();
      handleEscape(event);
      if (event.key !== 'Tab' || event.defaultPrevented || event.isComposing
        || event.altKey || event.ctrlKey || event.metaKey) return;

      const fullscreen = doc.fullscreenElement;
      const scope = fullscreen instanceof HTMLElement && dialog.contains(fullscreen) ? fullscreen : dialog;
      const stops = getTabStops(scope);
      const first = stops[0];
      const last = stops.at(-1);
      const active = doc.activeElement;
      if (active instanceof HTMLElement && stops.includes(active)
        && active !== (event.shiftKey ? first : last)) return;
      event.preventDefault();
      (event.shiftKey ? last ?? dialog : first ?? dialog).focus({ preventScroll: true });
    };
    const containPaste = (event: ClipboardEvent) => {
      if (!isTop()) return;
      event.stopPropagation();
      if (!(event.target instanceof Node) || !dialog.contains(event.target)) event.preventDefault();
    };

    openDialogs.push(dialog);
    doc.addEventListener('focusin', handleFocus, true);
    doc.addEventListener('keydown', blockOutsideKey, true);
    doc.addEventListener('keydown', handleInsideKey);
    doc.addEventListener('paste', containPaste);
    initialFocusRef.current?.focus({ preventScroll: true });
    focusInside();

    // A control such as a play overlay can disappear while it has focus.
    const observer = new MutationObserver(() => {
      if (isTop() && !dialog.contains(doc.activeElement)) focusInside();
    });
    observer.observe(dialog, { childList: true, subtree: true });

    return () => {
      const wasTop = isTop();
      openDialogs.splice(openDialogs.indexOf(dialog), 1);
      observer.disconnect();
      doc.removeEventListener('focusin', handleFocus, true);
      doc.removeEventListener('keydown', blockOutsideKey, true);
      doc.removeEventListener('keydown', handleInsideKey);
      doc.removeEventListener('paste', containPaste);
      if (wasTop && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [dialogRef, initialFocusRef, open]);
}
