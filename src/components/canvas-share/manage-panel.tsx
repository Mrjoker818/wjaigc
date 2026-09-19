'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  RefreshCw,
  ShieldOff,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  listCanvasShares,
  patchCanvasSharePolicy,
  revokeCanvasShare,
  type CanvasShareCreatedAccess,
  type CanvasShareOwnerRecord,
} from './share-api-client';

interface CanvasShareManagePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  createdShareAccess?: CanvasShareCreatedAccess;
  returnFocusRef?: RefObject<HTMLElement | null>;
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

const SAFE_ERRORS: Readonly<Record<string, string>> = {
  CANVAS_SHARE_DISABLED: '画布分享暂未开放。',
  AUTHENTICATION_REQUIRED: '登录状态已失效，请重新登录。',
  CANVAS_SHARE_POLICY_CONFLICT: '分享策略已更新，请取消后刷新列表，再重新编辑。',
  CANVAS_SHARE_NOT_FOUND: '分享不存在或已失效，请取消后刷新列表。',
  CANVAS_SHARE_RESPONSE_INVALID: '服务器返回的数据无法确认，请刷新后重试。',
};

function safeError(error: unknown): string {
  const code = error !== null && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : 'CANVAS_SHARE_REQUEST_FAILED';
  return SAFE_ERRORS[code] ?? '操作未完成，请稍后重试。';
}

function isAbortError(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'name' in error
    && error.name === 'AbortError';
}

function operationScopeKey(open: boolean, projectId: string): string {
  return JSON.stringify([open, projectId]);
}

function formatDate(value: string | null): string {
  if (!value) return '永久有效';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function statusLabel(status: CanvasShareOwnerRecord['status']): string {
  if (status === 'revoked') return '已撤销';
  if (status === 'expired') return '已过期';
  return '有效';
}

function statusClass(status: CanvasShareOwnerRecord['status']): string {
  if (status === 'active') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  return 'bg-muted text-muted-foreground';
}

function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

function toExpiryIso(value: string): string | null {
  return value ? new Date(`${value}T23:59:59.999Z`).toISOString() : null;
}

export function CanvasShareManagePanel({
  open,
  onOpenChange,
  projectId,
  projectName,
  createdShareAccess,
  returnFocusRef,
}: CanvasShareManagePanelProps) {
  const scopeKey = operationScopeKey(open, projectId);
  const [shares, setShares] = useState<CanvasShareOwnerRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<CanvasShareOwnerRecord | null>(null);
  const [editExpiry, setEditExpiry] = useState('');
  const [editDownload, setEditDownload] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState<CanvasShareOwnerRecord | null>(null);
  const [revokePending, setRevokePending] = useState(false);
  const [manualCopyUrl, setManualCopyUrl] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [policyError, setPolicyError] = useState('');
  const [revokeError, setRevokeError] = useState('');
  const [stateScopeKey, setStateScopeKey] = useState(scopeKey);
  const manualCopyRef = useRef<HTMLInputElement>(null);
  const committedScopeRef = useRef(scopeKey);
  const operationRef = useRef<OperationState>({
    generation: 0,
    controller: null,
    scopeKey,
  });

  useLayoutEffect(() => {
    committedScopeRef.current = scopeKey;
  }, [scopeKey]);

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
    setShares([]);
    setLoading(false);
    setError('');
    setEditing(null);
    setEditExpiry('');
    setEditDownload(false);
    setSaving(false);
    setRevoking(null);
    setRevokePending(false);
    setManualCopyUrl(null);
    setPopupBlocked(false);
    setPolicyError('');
    setRevokeError('');
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const operation = beginOperation();
    setStateScopeKey(operation.scopeKey);
    setLoading(true);
    setError('');
    try {
      const records = await listCanvasShares(projectId, operation.signal);
      if (!isCurrentOperation(operation)) return;
      setShares([...records].sort((a, b) => (
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )));
    } catch (requestError) {
      if (!isCurrentOperation(operation) || isAbortError(requestError)) return;
      setShares([]);
      setError(safeError(requestError));
    } finally {
      if (isCurrentOperation(operation)) setLoading(false);
    }
  }, [beginOperation, isCurrentOperation, projectId]);

  useEffect(() => {
    invalidateOperation();
    clearState();
    if (open) void refresh();
    return invalidateOperation;
  }, [clearState, invalidateOperation, open, projectId, refresh]);

  useEffect(() => {
    if (stateScopeKey === scopeKey && manualCopyUrl) {
      manualCopyRef.current?.focus();
      manualCopyRef.current?.select();
    }
  }, [manualCopyUrl, scopeKey, stateScopeKey]);

  const stateIsCurrent = stateScopeKey === scopeKey;
  const visibleShares = stateIsCurrent ? shares : [];
  const visibleLoading = open && (!stateIsCurrent || loading);
  const visibleError = stateIsCurrent ? error : '';
  const visibleEditing = stateIsCurrent ? editing : null;
  const visibleSaving = stateIsCurrent && saving;
  const visibleRevoking = stateIsCurrent ? revoking : null;
  const visibleRevokePending = stateIsCurrent && revokePending;
  const visibleManualCopyUrl = stateIsCurrent ? manualCopyUrl : null;
  const visiblePopupBlocked = stateIsCurrent && popupBlocked;
  const visiblePolicyError = stateIsCurrent ? policyError : '';
  const visibleRevokeError = stateIsCurrent ? revokeError : '';

  const replaceShare = (record: CanvasShareOwnerRecord): void => {
    setShares(current => current.map(share => (
      share.shareId === record.shareId ? record : share
    )));
  };

  const beginEdit = (share: CanvasShareOwnerRecord): void => {
    setEditing(share);
    setEditExpiry(toDateInput(share.expiresAt));
    setEditDownload(share.allowDownload);
    setError('');
    setPolicyError('');
  };

  const savePolicy = async (): Promise<void> => {
    if (!visibleEditing || visibleSaving) return;
    const operation = beginOperation();
    const shareId = visibleEditing.shareId;
    setSaving(true);
    setPolicyError('');
    try {
      const updated = await patchCanvasSharePolicy(shareId, {
        expiresAt: toExpiryIso(editExpiry),
        allowDownload: editDownload,
      }, operation.signal);
      if (!isCurrentOperation(operation)) return;
      replaceShare(updated);
      setEditing(null);
      toast.success('分享策略已更新');
    } catch (requestError) {
      if (!isCurrentOperation(operation) || isAbortError(requestError)) return;
      setPolicyError(safeError(requestError));
    } finally {
      if (isCurrentOperation(operation)) setSaving(false);
    }
  };

  const confirmRevoke = async (): Promise<void> => {
    if (!visibleRevoking || visibleRevokePending) return;
    const operation = beginOperation();
    const shareId = visibleRevoking.shareId;
    setRevokePending(true);
    setRevokeError('');
    try {
      const updated = await revokeCanvasShare(shareId, operation.signal);
      if (!isCurrentOperation(operation)) return;
      replaceShare(updated);
      setRevoking(null);
      toast.success('分享已撤销');
    } catch (requestError) {
      if (!isCurrentOperation(operation) || isAbortError(requestError)) return;
      setRevokeError(safeError(requestError));
    } finally {
      if (isCurrentOperation(operation)) setRevokePending(false);
    }
  };

  const copyShare = async (url: string): Promise<void> => {
    const operation = beginOperation();
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(url);
      if (!isCurrentOperation(operation)) return;
      toast.success('分享链接已复制');
    } catch (copyError) {
      if (!isCurrentOperation(operation) || isAbortError(copyError)) return;
      setManualCopyUrl(url);
    }
  };

  const openShare = (url: string): void => {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (opened === null) {
      setPopupBlocked(true);
      setManualCopyUrl(url);
    }
  };

  const handlePanelOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      invalidateOperation();
      clearState();
    }
    onOpenChange(nextOpen);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handlePanelOpenChange}>
        <DialogContent
          className="max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] overflow-y-auto p-0 sm:max-w-2xl [&_[data-slot=dialog-close]]:flex [&_[data-slot=dialog-close]]:size-11 [&_[data-slot=dialog-close]]:items-center [&_[data-slot=dialog-close]]:justify-center"
          data-modal="true"
          onCloseAutoFocus={event => {
            if (!returnFocusRef?.current) return;
            event.preventDefault();
            returnFocusRef.current.focus();
          }}
        >
          <DialogHeader className="border-b px-4 pb-4 pt-5 pr-12 sm:px-6 sm:pt-6">
            <DialogTitle>管理画布分享</DialogTitle>
            <DialogDescription className="truncate">
              {projectName} · 这里的策略修改不会改变已创建的快照内容。
            </DialogDescription>
          </DialogHeader>

          <div className="px-4 py-4 sm:px-6">
            {visibleLoading && (
              <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground" role="status" aria-label="正在加载画布分享">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                正在加载分享…
              </div>
            )}

            {!visibleLoading && visibleError && (
              <div role="alert" className="space-y-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <p>{visibleError}</p>
                <Button className="min-h-11" type="button" size="sm" variant="outline" onClick={() => void refresh()}>
                  <RefreshCw aria-hidden="true" />刷新列表
                </Button>
              </div>
            )}

            {!visibleLoading && !visibleError && visibleShares.length === 0 && (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                当前项目还没有分享。
              </div>
            )}

            {!visibleLoading && visibleShares.length > 0 && (
              <div className="space-y-3">
                {visibleShares.map(share => {
                  const access = createdShareAccess?.shareId === share.shareId
                    ? createdShareAccess
                    : null;
                  return (
                    <article
                      key={share.shareId}
                      data-testid="canvas-share-row"
                      className="rounded-xl border bg-card p-4 shadow-xs"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-foreground">{share.title}</h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            修订 {share.projectRevision} · {share.itemCount} 个素材
                          </p>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(share.status)}`}>
                          {statusLabel(share.status)}
                        </span>
                      </div>

                      <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                        <div><dt className="inline">有效期：</dt><dd className="inline">{formatDate(share.expiresAt)}</dd></div>
                        <div><dt className="inline">下载：</dt><dd className="inline">{share.allowDownload ? '允许下载' : '禁止下载'}</dd></div>
                        <div><dt className="inline">访问：</dt><dd className="inline">{share.viewCount} 次查看</dd></div>
                        <div><dt className="inline">最近访问：</dt><dd className="inline">{share.lastViewedAt ? formatDate(share.lastViewedAt) : '暂无'}</dd></div>
                      </dl>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {access && share.status === 'active' && (
                          <>
                            <Button
                              className="min-h-11"
                              type="button"
                              size="sm"
                              variant="outline"
                              aria-label={`复制链接 ${share.title}`}
                              onClick={() => void copyShare(access.shareUrl)}
                            >
                              <Copy aria-hidden="true" />复制链接
                            </Button>
                            <Button
                              className="min-h-11"
                              type="button"
                              size="sm"
                              variant="outline"
                              aria-label={`打开查看器 ${share.title}`}
                              onClick={() => openShare(access.shareUrl)}
                            >
                              <ExternalLink aria-hidden="true" />打开查看器
                            </Button>
                          </>
                        )}
                        <Button
                          className="min-h-11"
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={share.status !== 'active'}
                          aria-label={`编辑策略 ${share.title}`}
                          onClick={() => beginEdit(share)}
                        >
                          <Pencil aria-hidden="true" />编辑策略
                        </Button>
                        <Button
                          className="min-h-11 text-destructive hover:text-destructive"
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={share.status !== 'active'}
                          aria-label={`撤销分享 ${share.title}`}
                          onClick={() => {
                            setRevokeError('');
                            setRevoking(share);
                          }}
                        >
                          <ShieldOff aria-hidden="true" />撤销
                        </Button>
                      </div>
                      {!access && share.status === 'active' && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          出于安全原因，完整链接仅在创建成功时显示。
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {visiblePopupBlocked && (
              <p role="alert" className="mt-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                浏览器阻止了新窗口，请手动复制链接后打开。
              </p>
            )}

            {visibleManualCopyUrl && (
              <div className="mt-4 space-y-2 rounded-lg border p-3" role="status">
                <label htmlFor="canvas-share-manual-manage-copy" className="text-sm font-medium">
                  手动复制完整链接
                </label>
                <Input
                  ref={manualCopyRef}
                  id="canvas-share-manual-manage-copy"
                  className="h-11"
                  readOnly
                  value={visibleManualCopyUrl}
                  onFocus={event => event.currentTarget.select()}
                />
                <p className="text-xs text-muted-foreground">剪贴板不可用，链接已选中。</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {visibleEditing && (
        <Dialog open onOpenChange={next => {
          if (!next && !visibleSaving) {
            setEditing(null);
            setPolicyError('');
          }
        }}>
          <DialogContent
            className="max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] overflow-y-auto sm:max-w-md [&_[data-slot=dialog-close]]:flex [&_[data-slot=dialog-close]]:size-11 [&_[data-slot=dialog-close]]:items-center [&_[data-slot=dialog-close]]:justify-center"
            data-modal="true"
          >
          <DialogHeader>
            <DialogTitle>编辑分享策略</DialogTitle>
            <DialogDescription>只可修改有效期和下载权限，快照内容保持不变。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="canvas-share-policy-expiry" className="text-sm font-medium">有效期</label>
              <Input
                id="canvas-share-policy-expiry"
                className="h-11"
                type="date"
                value={editExpiry}
                onChange={event => setEditExpiry(event.target.value)}
              />
            </div>
            <label htmlFor="canvas-share-policy-download" className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-lg border px-3 py-2">
              <span className="text-sm font-medium">允许访问者下载</span>
              <span className="flex size-11 items-center justify-center">
                <Switch
                  id="canvas-share-policy-download"
                  aria-label="允许访问者下载"
                  checked={editDownload}
                  onCheckedChange={setEditDownload}
                />
              </span>
            </label>
          </div>
          {visiblePolicyError && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {visiblePolicyError}
            </p>
          )}
          <DialogFooter>
            <Button className="min-h-11" type="button" variant="outline" disabled={visibleSaving} onClick={() => setEditing(null)}>取消</Button>
            <Button className="min-h-11" type="button" disabled={visibleSaving} onClick={() => void savePolicy()}>
              {visibleSaving && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {visibleSaving ? '保存中…' : '保存策略'}
            </Button>
          </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {visibleRevoking && (
        <AlertDialog open onOpenChange={next => {
          if (!next && !visibleRevokePending) {
            setRevoking(null);
            setRevokeError('');
          }
        }}>
          <AlertDialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>确认撤销分享</AlertDialogTitle>
            <AlertDialogDescription>
              撤销后无法恢复。“{visibleRevoking?.title}”的原链接将立即失效，此操作不会删除项目。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {visibleRevokeError && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {visibleRevokeError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={visibleRevokePending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-destructive text-white hover:bg-destructive/90"
              disabled={visibleRevokePending}
              onClick={event => {
                event.preventDefault();
                void confirmRevoke();
              }}
            >
              {visibleRevokePending && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {visibleRevokePending ? '撤销中…' : '确认撤销'}
            </AlertDialogAction>
          </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
