'use client';

import { forwardRef, useCallback, useLayoutEffect, useRef, useState, type VideoHTMLAttributes } from 'react';

interface CanvasVideoProps extends VideoHTMLAttributes<HTMLVideoElement> {
  src?: string;
  recoveryScope: string;
}

interface Recovery {
  active: boolean;
  attempts: number;
  busy: boolean;
  awaitingMetadata: boolean;
  stopped: boolean;
  timer?: ReturnType<typeof setTimeout>;
  controller?: AbortController;
}

function cancel(recovery: Recovery): void {
  if (recovery.timer) clearTimeout(recovery.timer);
  recovery.timer = undefined;
  recovery.controller?.abort();
  recovery.controller = undefined;
  recovery.busy = false;
  recovery.awaitingMetadata = false;
}

function managedVideo(src: string | undefined): boolean {
  if (!src) return false;
  try {
    const url = new URL(src, window.location.href);
    return url.origin === window.location.origin && !url.username && !url.password
      && !url.search && !url.hash
      && /^\/api\/serve-upload\/exports\/[a-zA-Z0-9._-]+\.(mp4|webm|mov|m4v)$/u.test(url.pathname);
  } catch { return false; }
}

function retryDelay(header: string | null): number | null {
  if (!header) return 1000;
  const seconds = /^\d+$/u.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  if (!Number.isFinite(seconds)) return 1000;
  // Never retry earlier than a valid Retry-After; long waits require explicit user retry.
  return seconds > 10_000 ? null : Math.max(1000, seconds);
}

/** Native video with bounded recovery for the existing managed-media 503 admission gate. */
export const CanvasVideo = forwardRef<HTMLVideoElement, CanvasVideoProps>(function CanvasVideo(
  { src, recoveryScope, onError, onLoadedMetadata, ...props }, forwardedRef,
): React.JSX.Element {
  const node = useRef<HTMLVideoElement | null>(null);
  const current = useRef<Recovery | null>(null);
  const [state, setState] = useState<'ready' | 'recovering' | 'failed'>('ready');
  const attach = useCallback((element: HTMLVideoElement | null): void => {
    node.current = element;
    if (typeof forwardedRef === 'function') forwardedRef(element);
    else if (forwardedRef) forwardedRef.current = element;
  }, [forwardedRef]);

  useLayoutEffect(() => {
    const recovery: Recovery = { active: true, attempts: 0, busy: false, awaitingMetadata: false, stopped: false };
    current.current = recovery;
    setState('ready');
    return () => { recovery.active = false; cancel(recovery); };
  }, [src, recoveryScope]);

  const recover = (recovery: Recovery): void => {
    const element = node.current;
    const valid = (): boolean => current.current === recovery && recovery.active && node.current === element;
    if (!valid() || !element || recovery.busy || recovery.timer || recovery.stopped) return;
    const fail = (): void => {
      if (!valid()) return;
      cancel(recovery); recovery.stopped = true; setState('failed');
    };
    if (recovery.attempts >= 3 || !managedVideo(src)) { fail(); return; }
    recovery.attempts++; recovery.busy = true; setState('recovering');
    const controller = new AbortController();
    recovery.controller = controller;
    recovery.timer = setTimeout(fail, 5000);
    void (async (): Promise<void> => {
      try {
        const response = await fetch(src!, { method: 'GET', headers: { Range: 'bytes=0-63' },
          credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
        // Do not buffer a whole file if a server ignores Range; cancellation also releases its admission slot.
        await response.body?.cancel();
        if (!valid() || controller.signal.aborted) return;
        cancel(recovery);
        if (response.status === 503) {
          const delay = retryDelay(response.headers.get('Retry-After'));
          if (recovery.attempts >= 3 || delay === null) { fail(); return; }
          recovery.timer = setTimeout(() => { recovery.timer = undefined; recover(recovery); }, delay);
        } else if ((response.status === 200 || response.status === 206)
          && /^video\//iu.test(response.headers.get('Content-Type') ?? '')) {
          // A successful probe is not successful decoding: metadata/error completes this attempt.
          recovery.awaitingMetadata = true;
          recovery.timer = setTimeout(fail, 5000);
          element.load();
        } else fail();
      } catch {
        // A manual retry can reuse this scope; the cancelled previous attempt must not abort it.
        if (!controller.signal.aborted) fail();
      }
    })();
  };

  return <>
    <video {...props} ref={attach} src={src}
      onError={event => {
        const recovery = current.current;
        if (recovery?.active) {
          // A native error after load() must not wait for the decoding watchdog.
          if (recovery.awaitingMetadata && recovery.timer) {
            clearTimeout(recovery.timer); recovery.timer = undefined;
            recovery.awaitingMetadata = false;
          }
          if (event.currentTarget.error?.code === 1 || event.currentTarget.error?.code === 3) {
            cancel(recovery); recovery.stopped = true; setState('failed');
          } else recover(recovery);
        }
        onError?.(event);
      }}
      onLoadedMetadata={event => {
        const recovery = current.current;
        if (recovery?.active && event.currentTarget.videoWidth > 0 && event.currentTarget.videoHeight > 0) {
          cancel(recovery); recovery.attempts = 0; recovery.stopped = false; setState('ready');
        }
        onLoadedMetadata?.(event);
      }} />
    {state !== 'ready' && <button type="button" aria-label="重新加载视频"
      disabled={state === 'recovering'} aria-live="polite" data-toolbar
      className="absolute inset-0 z-30 flex min-h-11 items-center justify-center bg-background/90 px-1 text-xs text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-wait"
      onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        const recovery = current.current;
        if (!recovery?.active || !node.current) return;
        cancel(recovery); recovery.attempts = 0; recovery.stopped = false;
        if (managedVideo(src)) recover(recovery);
        else { setState('ready'); node.current.load(); }
      }}>
      {state === 'recovering' ? '正在恢复视频…' : '重新加载视频'}
    </button>}
  </>;
});
