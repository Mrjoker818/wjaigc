'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
}

const SAFE_ERRORS: Readonly<Record<string, string>> = {
  CANVAS_SHARE_DISABLED: '画布分享暂未开放。',
  AUTHENTICATION_REQUIRED: '登录状态已失效，请重新登录。',
  CANVAS_SHARE_POLICY_CONFLICT: '分享策略已更新，请刷新后重试。',
  CANVAS_SHARE_NOT_FOUND: '分享不存在或已失效，请刷新列表。',
  CANVAS_SHARE_RESPONSE_INVALID: '服务器返回的数据无法确认，请刷新后重试。',
};

function safeError(error: unknown): string {
  const code = error !== null && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : 'CANVAS_SHARE_REQUEST_FAILED';
  return SAFE_ERRORS[code] ?? '操作未完成，请稍后重试。';
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
}: CanvasShareManagePanelProps) {
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
  const manualCopyRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const records = await listCanvasShares(projectId);
      setShares([...records].sort((a, b) => (
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )));
    } catch (requestError) {
      setShares([]);
      setError(safeError(requestError));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) {
      setManualCopyUrl(null);
      setEditing(null);
      setRevoking(null);
      return;
    }
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (manualCopyUrl) {
      manualCopyRef.current?.focus();
      manualCopyRef.current?.select();
    }
  }, [manualCopyUrl]);

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
  };

  const savePolicy = async (): Promise<void> => {
    if (!editing || saving) return;
    setSaving(true);
    setError('');
    try {
      const updated = await patchCanvasSharePolicy(editing.shareId, {
        expiresAt: toExpiryIso(editExpiry),
        allowDownload: editDownload,
      });
      replaceShare(updated);
      setEditing(null);
      toast.success('分享策略已更新');
    } catch (requestError) {
      setError(safeError(requestError));
    } finally {
      setSaving(false);
    }
  };

  const confirmRevoke = async (): Promise<void> => {
    if (!revoking || revokePending) return;
    setRevokePending(true);
    setError('');
    try {
      replaceShare(await revokeCanvasShare(revoking.shareId));
      setRevoking(null);
      toast.success('分享已撤销');
    } catch (requestError) {
      setError(safeError(requestError));
    } finally {
      setRevokePending(false);
    }
  };

  const copyShare = async (url: string): Promise<void> => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(url);
      toast.success('分享链接已复制');
    } catch {
      setManualCopyUrl(url);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-h-[min(92vh,780px)] max-w-[calc(100%-1rem)] overflow-hidden p-0 sm:max-w-2xl"
          data-modal="true"
        >
          <DialogHeader className="border-b px-4 pb-4 pt-5 pr-12 sm:px-6 sm:pt-6">
            <DialogTitle>管理画布分享</DialogTitle>
            <DialogDescription className="truncate">
              {projectName} · 这里的策略修改不会改变已创建的快照内容。
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[calc(min(92vh,780px)-10rem)] overflow-y-auto px-4 py-4 sm:px-6">
            {loading && (
              <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground" role="status" aria-label="正在加载画布分享">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                正在加载分享…
              </div>
            )}

            {!loading && error && (
              <div role="alert" className="space-y-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <p>{error}</p>
                <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
                  <RefreshCw aria-hidden="true" />刷新列表
                </Button>
              </div>
            )}

            {!loading && !error && shares.length === 0 && (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                当前项目还没有分享。
              </div>
            )}

            {!loading && shares.length > 0 && (
              <div className="space-y-3">
                {shares.map(share => {
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
                              type="button"
                              size="sm"
                              variant="outline"
                              aria-label={`复制链接 ${share.title}`}
                              onClick={() => void copyShare(access.shareUrl)}
                            >
                              <Copy aria-hidden="true" />复制链接
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              aria-label={`打开查看器 ${share.title}`}
                              onClick={() => window.open(access.shareUrl, '_blank', 'noopener,noreferrer')}
                            >
                              <ExternalLink aria-hidden="true" />打开查看器
                            </Button>
                          </>
                        )}
                        <Button
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
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={share.status !== 'active'}
                          className="text-destructive hover:text-destructive"
                          aria-label={`撤销分享 ${share.title}`}
                          onClick={() => setRevoking(share)}
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

            {manualCopyUrl && (
              <div className="mt-4 space-y-2 rounded-lg border p-3" role="status">
                <label htmlFor="canvas-share-manual-manage-copy" className="text-sm font-medium">
                  手动复制完整链接
                </label>
                <Input
                  ref={manualCopyRef}
                  id="canvas-share-manual-manage-copy"
                  readOnly
                  value={manualCopyUrl}
                  onFocus={event => event.currentTarget.select()}
                />
                <p className="text-xs text-muted-foreground">剪贴板不可用，链接已选中。</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={next => { if (!next && !saving) setEditing(null); }}>
        <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-md" data-modal="true">
          <DialogHeader>
            <DialogTitle>编辑分享策略</DialogTitle>
            <DialogDescription>只可修改有效期和下载权限，快照内容保持不变。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="canvas-share-policy-expiry" className="text-sm font-medium">有效期</label>
              <Input
                id="canvas-share-policy-expiry"
                type="date"
                value={editExpiry}
                onChange={event => setEditExpiry(event.target.value)}
              />
            </div>
            <div className="flex min-h-11 items-center justify-between gap-4 rounded-lg border px-3 py-2">
              <label htmlFor="canvas-share-policy-download" className="text-sm font-medium">允许访问者下载</label>
              <Switch
                id="canvas-share-policy-download"
                aria-label="允许访问者下载"
                checked={editDownload}
                onCheckedChange={setEditDownload}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(null)}>取消</Button>
            <Button type="button" disabled={saving} onClick={() => void savePolicy()}>
              {saving && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {saving ? '保存中…' : '保存策略'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revoking !== null} onOpenChange={next => { if (!next && !revokePending) setRevoking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认撤销分享</AlertDialogTitle>
            <AlertDialogDescription>
              撤销后无法恢复。“{revoking?.title}”的原链接将立即失效，此操作不会删除项目。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokePending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={revokePending}
              onClick={event => {
                event.preventDefault();
                void confirmRevoke();
              }}
            >
              {revokePending && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {revokePending ? '撤销中…' : '确认撤销'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
