'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  canvasBridgeStorageKey, consumeCanvasBridgeJournal, migrateLegacyCanvasBridge, readCanvasBridgeJournal,
  type ConsumeCanvasBridgeInput,
} from '@/lib/simple-chat-canvas-bridge';
import type { resolveSimpleChatCanvasReference } from '@/components/simple-chat/simple-chat-types';

export interface SimpleChatBridgeReceptionProps {
  actorId: string;
  projectId: string;
  authority: 'document' | 'legacy' | 'unknown';
  ready: boolean;
  refreshMedia: ConsumeCanvasBridgeInput['refreshMedia'];
  resolveReference: typeof resolveSimpleChatCanvasReference;
  mergeLegacy: ConsumeCanvasBridgeInput['mergeLegacy'];
}

export function SimpleChatBridgeReception(props: SimpleChatBridgeReceptionProps): React.JSX.Element | null {
  const scope = useMemo(() => ({ actorId: props.actorId, projectId: props.projectId,
    authority: props.authority, ready: props.ready }), [props.actorId, props.projectId, props.authority, props.ready]);
  const scopeRef = useRef<typeof scope | null>(scope);
  const callbacksRef = useRef(props);
  useLayoutEffect(() => {
    scopeRef.current = scope;
    return () => { scopeRef.current = null; };
  }, [scope]);
  useLayoutEffect(() => { callbacksRef.current = props; });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<{ scope: typeof scope; kind: 'working' | 'error' | 'confirmed'; text: string } | null>(null);

  useEffect(() => {
    if (!scope.ready || scope.authority === 'unknown') return;
    let cancelled = false;
    const controller = new AbortController();
    const isCurrent = (): boolean => !cancelled && !controller.signal.aborted && scopeRef.current === scope;
    const callbacks = callbacksRef.current;
    const resolveReference: ConsumeCanvasBridgeInput['resolveReference'] = tuple => callbacks.resolveReference(tuple, undefined, {
      expectedActorUserId: scope.actorId, signal: controller.signal, isCurrent,
    });
    const run = async (): Promise<void> => {
      await Promise.resolve();
      if (!isCurrent()) return;
      try {
        const input = { actorId: scope.actorId, projectId: scope.projectId, storage: localStorage,
          locks: navigator.locks, isCurrent, resolveReference };
        const initial = readCanvasBridgeJournal(localStorage, scope);
        const hadPending = initial?.items.some(item => item.state === 'pending' || item.state === 'accepted');
        const hadLegacy = localStorage.getItem('wujie_canvas_bridge') !== null;
        if (!hadPending && !hadLegacy) return;
        setNotice({ scope, kind: 'working', text: '正在接收聊天素材…' });
        let legacyWaiting = false;
        try { legacyWaiting = await migrateLegacyCanvasBridge(input) === 'waiting'; }
        catch {
          if (!isCurrent()) return;
          legacyWaiting = true;
        }
        if (!isCurrent()) return;
        const result = await consumeCanvasBridgeJournal({ ...input, authority: scope.authority as 'document' | 'legacy',
          refreshMedia: callbacks.refreshMedia, mergeLegacy: callbacks.mergeLegacy });
        if (!isCurrent()) return;
        if (legacyWaiting) {
          setNotice({ scope, kind: 'error', text: '旧记录尚未确认，原记录已保留' });
        } else if (result.status === 'waiting') {
          setNotice({ scope, kind: 'error', text: '画布接收尚未确认，待办已保留' });
        } else {
          setNotice({ scope, kind: 'confirmed', text: '聊天素材接收已确认' });
        }
      } catch (error) {
        if (isCurrent()) setNotice({ scope, kind: 'error',
          text: error instanceof Error && error.message === 'CANVAS_BRIDGE_LOCK_UNAVAILABLE'
            ? '浏览器锁不可用，待办已保留；请使用支持 Web Locks 的安全页面后重试'
            : '画布接收失败，待办已保留' });
      }
    };
    void run();
    return () => { cancelled = true; controller.abort(); };
  }, [scope, attempt]);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === canvasBridgeStorageKey(scope) || event.key === 'wujie_canvas_bridge') {
        setAttempt(value => value + 1);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [scope]);

  if (!notice || notice.scope !== scope || !scope.ready) return null;
  return <div data-toolbar className="flex min-w-0 flex-wrap items-center gap-2 px-2 text-sm">
    <span role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</span>
    {notice.kind === 'error' && <button type="button" onClick={() => setAttempt(value => value + 1)}
      className="min-h-11 min-w-11 rounded-md border border-current px-3 focus-visible:outline-2 focus-visible:outline-offset-2 hover:opacity-80">
      重试接收
    </button>}
  </div>;
}
