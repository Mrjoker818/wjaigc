'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, LoaderCircle, RefreshCw } from 'lucide-react';

import { SharedCanvasViewer } from '@/components/canvas-share/shared-canvas-viewer';
import { canvasSharePublicDocumentSchema } from '@/lib/canvas-share/schema';
import type { CanvasSharePublicDocument } from '@/lib/canvas-share/types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; document: CanvasSharePublicDocument }
  | { kind: 'invalid' }
  | { kind: 'error'; requestId?: string };

const SAFE_REQUEST_ID_PATTERN = /^req_[a-f0-9]{16}$/u;

function safeRequestId(response: Response, body: unknown): string | undefined {
  const headerValue = response.headers.get('x-request-id');
  if (headerValue && SAFE_REQUEST_ID_PATTERN.test(headerValue)) return headerValue;
  if (body !== null && typeof body === 'object' && 'requestId' in body) {
    const value = (body as { requestId?: unknown }).requestId;
    if (typeof value === 'string' && SAFE_REQUEST_ID_PATTERN.test(value)) return value;
  }
  return undefined;
}

function SharedCanvasLoading(): React.ReactElement {
  return (
    <main
      className="flex h-[100dvh] min-h-[100dvh] w-full flex-col bg-background text-foreground"
      aria-busy="true"
    >
      <div className="flex min-h-16 items-center gap-3 border-b border-border px-4 sm:px-6">
        <div className="h-8 w-8 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <div className="space-y-2">
          <div className="h-4 w-36 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-20 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center bg-canvas-bg">
        <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
          <LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <span>正在加载分享…</span>
        </div>
      </div>
    </main>
  );
}

function SharedCanvasMessage({
  kind,
  requestId,
  onRetry,
}: {
  kind: 'invalid' | 'error';
  requestId?: string;
  onRetry(): void;
}): React.ReactElement {
  const invalid = kind === 'invalid';
  return (
    <main className="grid h-[100dvh] min-h-[100dvh] w-full place-items-center bg-background px-5 text-foreground">
      <section
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-dialog sm:p-8"
        role={invalid ? 'status' : 'alert'}
      >
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold text-card-foreground">
          {invalid ? '分享不存在或已失效' : '暂时无法加载分享，请稍后重试'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {invalid ? '请检查链接是否完整，或联系分享者获取新的链接。' : '请检查网络连接，然后重新加载。'}
        </p>
        {requestId ? (
          <p className="mt-3 font-mono text-xs text-muted-foreground">请求标识：{requestId}</p>
        ) : null}
        {!invalid ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            重新加载
          </button>
        ) : null}
      </section>
    </main>
  );
}

export function SharedCanvasClient(): React.ReactElement {
  const params = useParams<{ token?: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const metadataEndpoint = useMemo(() => (
    token ? `/api/public/canvas-shares/${encodeURIComponent(token)}` : null
  ), [token]);
  const [retryCount, setRetryCount] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    if (!metadataEndpoint) {
      setState({ kind: 'invalid' });
      return undefined;
    }

    const controller = new AbortController();
    setState({ kind: 'loading' });

    void (async (): Promise<void> => {
      try {
        const response = await fetch(metadataEndpoint, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          setState({ kind: 'invalid' });
          return;
        }
        if (!response.ok) {
          setState({ kind: 'error', requestId: safeRequestId(response, body) });
          return;
        }
        const parsed = canvasSharePublicDocumentSchema.safeParse(body);
        if (!parsed.success) {
          setState({ kind: 'error', requestId: safeRequestId(response, body) });
          return;
        }
        setState({ kind: 'ready', document: parsed.data });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ kind: 'error' });
      }
    })();

    return () => controller.abort();
  }, [metadataEndpoint, retryCount]);

  const retry = useCallback((): void => setRetryCount(value => value + 1), []);

  if (state.kind === 'loading') return <SharedCanvasLoading />;
  if (state.kind === 'invalid') {
    return <SharedCanvasMessage kind="invalid" onRetry={retry} />;
  }
  if (state.kind === 'error') {
    return <SharedCanvasMessage kind="error" requestId={state.requestId} onRetry={retry} />;
  }
  return (
    <SharedCanvasViewer
      document={state.document}
      metadataEndpointBase={`${metadataEndpoint}/`}
    />
  );
}
