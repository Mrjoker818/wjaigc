'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

import {
  createCanvasShare,
  preflightCanvasShare,
  type CanvasShareCreatedAccess,
  type CanvasShareCreateResult,
  type CanvasSharePreflightResult,
  type CanvasShareViewport,
} from './share-api-client';

interface CanvasShareCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  requestedViewport?: Partial<CanvasShareViewport> | null;
  onOpenManagement: (access?: CanvasShareCreatedAccess) => void;
}

interface OperationState {
  generation: number;
  controller: AbortController | null;
  scopeKey: string;
}

interface ActiveOperation {
  generation: number;
  signal: AbortSignal;
  scopeKey: string;
}

const ERROR_ACTIONS: Readonly<Record<string, string>> = {
  CANVAS_SHARE_PROJECT_CONFLICT: '项目已更新，请重新检查后再创建。',
  CANVAS_SHARE_MEDIA_NOT_READY: '请等待媒体处理完成后重新检查。',
  CANVAS_SHARE_UNSUPPORTED_ELEMENT: '请移除暂不支持的元素后重试。',
  CANVAS_SHARE_DISABLED: '画布分享暂未开放，请稍后再试。',
  AUTHENTICATION_REQUIRED: '登录状态已失效，请重新登录后再试。',
  CANVAS_SHARE_RESPONSE_INVALID: '服务器返回的数据无法确认，请刷新后重试。',
};

function errorCode(error: unknown): string {
  return error !== null && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : 'CANVAS_SHARE_REQUEST_FAILED';
}

function safeErrorAction(error: unknown): string {
  return ERROR_ACTIONS[errorCode(error)] ?? '操作未完成，请稍后重试。';
}

function isAbortError(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'name' in error
    && error.name === 'AbortError';
}

function operationScopeKey(open: boolean, projectId: string): string {
  return JSON.stringify([open, projectId]);
}

function localCalendarDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultExpiryDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return localCalendarDate(date);
}

function expiryIso(value: string): string | null {
  if (!value) return null;
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part))) return null;
  const [year, month, day] = parts;
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

export function CanvasShareCreateDialog({
  open,
  onOpenChange,
  projectId,
  requestedViewport,
  onOpenManagement,
}: CanvasShareCreateDialogProps) {
  const scopeKey = operationScopeKey(open, projectId);
  const [preflight, setPreflight] = useState<CanvasSharePreflightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [expiresOn, setExpiresOn] = useState(defaultExpiryDate);
  const [allowDownload, setAllowDownload] = useState(false);
  const [created, setCreated] = useState<CanvasShareCreateResult | null>(null);
  const [manualCopy, setManualCopy] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [stateScopeKey, setStateScopeKey] = useState(scopeKey);
  const copyInputRef = useRef<HTMLInputElement>(null);
  const requestedViewportRef = useRef(requestedViewport);
  const committedScopeRef = useRef(scopeKey);
  const operationRef = useRef<OperationState>({
    generation: 0,
    controller: null,
    scopeKey,
  });

  useLayoutEffect(() => {
    committedScopeRef.current = scopeKey;
    requestedViewportRef.current = requestedViewport;
  }, [requestedViewport, scopeKey]);

  const invalidateOperation = useCallback((): void => {
    operationRef.current.controller?.abort();
    operationRef.current = {
      generation: operationRef.current.generation + 1,
      controller: null,
      scopeKey: committedScopeRef.current,
    };
  }, []);

  const beginOperation = useCallback((): ActiveOperation => {
    operationRef.current.controller?.abort();
    const controller = new AbortController();
    const generation = operationRef.current.generation + 1;
    const currentScopeKey = committedScopeRef.current;
    operationRef.current = { generation, controller, scopeKey: currentScopeKey };
    return { generation, signal: controller.signal, scopeKey: currentScopeKey };
  }, []);

  const isCurrentOperation = useCallback((operation: ActiveOperation): boolean => (
    operationRef.current.generation === operation.generation
    && operation.scopeKey === committedScopeRef.current
    && operationRef.current.scopeKey === operation.scopeKey
    && !operation.signal.aborted
    && operationRef.current.controller?.signal.aborted === false
  ), []);

  const clearState = useCallback((): void => {
    setStateScopeKey(committedScopeRef.current);
    setPreflight(null);
    setLoading(false);
    setSubmitting(false);
    setError('');
    setTitle('');
    setExpiresOn(defaultExpiryDate());
    setAllowDownload(false);
    setCreated(null);
    setManualCopy(false);
    setPopupBlocked(false);
  }, []);

  const runPreflight = useCallback(async (): Promise<void> => {
    const operation = beginOperation();
    setStateScopeKey(operation.scopeKey);
    setLoading(true);
    setError('');
    setPreflight(null);
    try {
      const result = await preflightCanvasShare({
        projectId,
        ...(requestedViewportRef.current === undefined
          ? {}
          : { requestedViewport: requestedViewportRef.current }),
      }, operation.signal);
      if (!isCurrentOperation(operation)) return;
      setPreflight(result);
      setTitle(`${result.projectName} 分享`);
    } catch (requestError) {
      if (!isCurrentOperation(operation) || isAbortError(requestError)) return;
      setError(safeErrorAction(requestError));
    } finally {
      if (isCurrentOperation(operation)) setLoading(false);
    }
  }, [beginOperation, isCurrentOperation, projectId]);

  useEffect(() => {
    invalidateOperation();
    clearState();
    if (open) void runPreflight();
    return invalidateOperation;
  }, [clearState, invalidateOperation, open, projectId, runPreflight]);

  useEffect(() => {
    if (stateScopeKey === scopeKey && manualCopy) {
      copyInputRef.current?.focus();
      copyInputRef.current?.select();
    }
  }, [manualCopy, scopeKey, stateScopeKey]);

  const stateIsCurrent = stateScopeKey === scopeKey;
  const visiblePreflight = stateIsCurrent ? preflight : null;
  const visibleCreated = stateIsCurrent ? created : null;
  const visibleLoading = open && (!stateIsCurrent || loading);
  const visibleSubmitting = stateIsCurrent && submitting;
  const visibleError = stateIsCurrent ? error : '';
  const visibleManualCopy = stateIsCurrent && manualCopy;
  const visiblePopupBlocked = stateIsCurrent && popupBlocked;

  const handleCreate = async (): Promise<void> => {
    if (visibleSubmitting || !visiblePreflight?.readiness.ready || !title.trim()) return;
    const operation = beginOperation();
    setSubmitting(true);
    setError('');
    try {
      const result = await createCanvasShare({
        projectId,
        title: title.trim(),
        ...(requestedViewportRef.current === undefined
          ? {}
          : { requestedViewport: requestedViewportRef.current }),
        expiresAt: expiryIso(expiresOn),
        allowDownload,
      }, operation.signal);
      if (!isCurrentOperation(operation)) return;
      setCreated(result);
    } catch (requestError) {
      if (!isCurrentOperation(operation) || isAbortError(requestError)) return;
      setError(safeErrorAction(requestError));
    } finally {
      if (isCurrentOperation(operation)) setSubmitting(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!visibleCreated) return;
    const operation = beginOperation();
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(visibleCreated.shareUrl);
      if (!isCurrentOperation(operation)) return;
      toast.success('分享链接已复制');
    } catch (copyError) {
      if (!isCurrentOperation(operation) || isAbortError(copyError)) return;
      setManualCopy(true);
    }
  };

  const handleOpen = (): void => {
    if (!visibleCreated) return;
    const opened = window.open(visibleCreated.shareUrl, '_blank', 'noopener,noreferrer');
    if (opened === null) {
      setPopupBlocked(true);
      setManualCopy(true);
    }
  };

  const closeAndClear = (): void => {
    invalidateOperation();
    clearState();
    onOpenChange(false);
  };

  const handleOpenManagement = (): void => {
    const access = visibleCreated
      ? { shareId: visibleCreated.shareId, shareUrl: visibleCreated.shareUrl }
      : undefined;
    closeAndClear();
    onOpenManagement(access);
  };

  const readinessFailure = visiblePreflight?.readiness.failures[0];

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) {
          closeAndClear();
          return;
        }
        onOpenChange(true);
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] overflow-y-auto p-4 pr-12 sm:max-w-lg sm:p-6 sm:pr-12 [&_[data-slot=dialog-close]]:flex [&_[data-slot=dialog-close]]:size-11 [&_[data-slot=dialog-close]]:items-center [&_[data-slot=dialog-close]]:justify-center"
        data-modal="true"
      >
        {visibleCreated ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-emerald-500" aria-hidden="true" />
                分享已创建
              </DialogTitle>
              <DialogDescription>
                完整链接只在本次创建流程中保留。关闭后请通过新链接重新分享。
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-medium text-foreground">{visibleCreated.snapshot.title}</p>
              <p className="mt-1 text-muted-foreground">
                修订 {visibleCreated.snapshot.projectRevision} · {visibleCreated.snapshot.itemCount} 个素材
              </p>
            </div>
            {visiblePopupBlocked && (
              <p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                浏览器阻止了新窗口，请手动复制链接后打开。
              </p>
            )}
            {visibleManualCopy && (
              <div className="min-w-0 space-y-2" role="status">
                <label htmlFor="canvas-share-manual-copy" className="text-sm font-medium">
                  手动复制完整链接
                </label>
                <Input
                  ref={copyInputRef}
                  id="canvas-share-manual-copy"
                  className="h-11"
                  readOnly
                  value={visibleCreated.shareUrl}
                  onFocus={event => event.currentTarget.select()}
                />
                <p className="text-xs text-muted-foreground">链接已选中，可使用系统复制命令。</p>
              </div>
            )}
            <DialogFooter className="grid grid-cols-1 sm:grid-cols-3">
              <Button className="min-h-11" type="button" variant="outline" onClick={() => void handleCopy()}>
                <Copy aria-hidden="true" />复制完整链接
              </Button>
              <Button className="min-h-11" type="button" variant="outline" onClick={handleOpen}>
                <ExternalLink aria-hidden="true" />打开查看器
              </Button>
              <Button className="min-h-11" type="button" onClick={handleOpenManagement}>前往管理</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>分享画布</DialogTitle>
              <DialogDescription>
                创建当前项目的只读快照，供他人通过链接查看。
              </DialogDescription>
            </DialogHeader>

            {visibleLoading && (
              <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground" role="status" aria-label="正在检查画布分享条件">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                正在检查项目与媒体状态…
              </div>
            )}

            {!visibleLoading && visiblePreflight && (
              <div className="space-y-4">
                <section className="rounded-lg border bg-muted/30 p-3" aria-label="分享快照检查结果">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-foreground">{visiblePreflight.projectName}</p>
                      <p className="mt-1 flex flex-wrap gap-x-1 text-xs text-muted-foreground">
                        <span>修订 {visiblePreflight.projectRevision}</span>
                        <span aria-hidden="true">·</span>
                        <span>{visiblePreflight.itemCount} 个素材</span>
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${visiblePreflight.readiness.ready ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
                      {visiblePreflight.readiness.ready ? '媒体已就绪' : '媒体未就绪'}
                    </span>
                  </div>
                  {readinessFailure && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                      {readinessFailure.display?.label || `第 ${readinessFailure.itemIndex + 1} 个素材`}：
                      {ERROR_ACTIONS[readinessFailure.code] || '请处理后重新检查。'}
                    </p>
                  )}
                </section>

                <div className="space-y-2">
                  <label htmlFor="canvas-share-title" className="text-sm font-medium">分享标题</label>
                  <Input
                    id="canvas-share-title"
                    className="h-11"
                    value={title}
                    maxLength={200}
                    onChange={event => setTitle(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="canvas-share-expiry" className="text-sm font-medium">有效期</label>
                  <Input
                    id="canvas-share-expiry"
                    className="h-11"
                    type="date"
                    min={localCalendarDate(new Date())}
                    value={expiresOn}
                    onChange={event => setExpiresOn(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">默认 30 天，可在分享管理中修改。</p>
                </div>

                <label htmlFor="canvas-share-download" className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-lg border px-3 py-2">
                  <span className="text-sm font-medium">允许访问者下载</span>
                  <span className="flex size-11 items-center justify-center">
                    <Switch
                      id="canvas-share-download"
                      aria-label="允许访问者下载"
                      checked={allowDownload}
                      onCheckedChange={setAllowDownload}
                    />
                  </span>
                </label>

                <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <p>创建后将绑定当前修订和素材快照，后续编辑不会改变此分享。</p>
                </div>
              </div>
            )}

            {visibleError && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{visibleError}</p>}

            <DialogFooter>
              <Button className="min-h-11" type="button" variant="outline" onClick={handleOpenManagement}>
                管理已有分享
              </Button>
              {(!visiblePreflight || !visiblePreflight.readiness.ready) && !visibleLoading && (
                <Button className="min-h-11" type="button" variant="outline" onClick={() => void runPreflight()}>
                  重新检查
                </Button>
              )}
              <Button
                className="min-h-11"
                type="button"
                disabled={visibleLoading || visibleSubmitting || !visiblePreflight?.readiness.ready || !title.trim()}
                onClick={() => void handleCreate()}
              >
                {visibleSubmitting && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {visibleSubmitting ? '创建中…' : '创建分享'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
