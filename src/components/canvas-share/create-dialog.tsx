'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  projectName: string;
  requestedViewport?: Partial<CanvasShareViewport> | null;
  onOpenManagement: (access?: CanvasShareCreatedAccess) => void;
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

function defaultExpiryDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().slice(0, 10);
}

function expiryIso(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}T23:59:59.999Z`).toISOString();
}

export function CanvasShareCreateDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  requestedViewport,
  onOpenManagement,
}: CanvasShareCreateDialogProps) {
  const [preflight, setPreflight] = useState<CanvasSharePreflightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [expiresOn, setExpiresOn] = useState(defaultExpiryDate);
  const [allowDownload, setAllowDownload] = useState(false);
  const [created, setCreated] = useState<CanvasShareCreateResult | null>(null);
  const [manualCopy, setManualCopy] = useState(false);
  const copyInputRef = useRef<HTMLInputElement>(null);
  const preflightRequestRef = useRef(0);

  const preflightInput = useMemo(() => ({
    projectId,
    ...(requestedViewport === undefined ? {} : { requestedViewport }),
    displayContext: { projectName },
  }), [projectId, projectName, requestedViewport]);

  const runPreflight = async (): Promise<void> => {
    const requestSequence = ++preflightRequestRef.current;
    setLoading(true);
    setError('');
    setPreflight(null);
    try {
      const result = await preflightCanvasShare(preflightInput);
      if (requestSequence !== preflightRequestRef.current) return;
      setPreflight(result);
      if (result.projectName) {
        setTitle(current => current === `${projectName} 分享`
          ? `${result.projectName} 分享`
          : current);
      }
    } catch (requestError) {
      if (requestSequence !== preflightRequestRef.current) return;
      setError(safeErrorAction(requestError));
    } finally {
      if (requestSequence === preflightRequestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      preflightRequestRef.current += 1;
      setCreated(null);
      setManualCopy(false);
      return;
    }
    setTitle(`${projectName} 分享`);
    setExpiresOn(defaultExpiryDate());
    setAllowDownload(false);
    setCreated(null);
    setManualCopy(false);
    void runPreflight();
    // The input object represents the complete preflight request identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preflightInput]);

  useEffect(() => {
    if (manualCopy) {
      copyInputRef.current?.focus();
      copyInputRef.current?.select();
    }
  }, [manualCopy]);

  const handleCreate = async (): Promise<void> => {
    if (submitting || !preflight?.readiness.ready || !title.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await createCanvasShare({
        projectId,
        title: title.trim(),
        ...(requestedViewport === undefined ? {} : { requestedViewport }),
        expiresAt: expiryIso(expiresOn),
        allowDownload,
      });
      setCreated(result);
    } catch (requestError) {
      setError(safeErrorAction(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!created) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(created.shareUrl);
      toast.success('分享链接已复制');
    } catch {
      setManualCopy(true);
    }
  };

  const handleOpen = (): void => {
    if (!created) return;
    window.open(created.shareUrl, '_blank', 'noopener,noreferrer');
  };

  const handleOpenManagement = (): void => {
    const access = created
      ? { shareId: created.shareId, shareUrl: created.shareUrl }
      : undefined;
    onOpenChange(false);
    onOpenManagement(access);
  };

  const displayName = preflight?.projectName || projectName;
  const readinessFailure = preflight?.readiness.failures[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(90vh,720px)] max-w-[calc(100%-1rem)] overflow-y-auto p-4 sm:max-w-lg sm:p-6"
        data-modal="true"
      >
        {created ? (
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
              <p className="font-medium text-foreground">{created.snapshot.title}</p>
              <p className="mt-1 text-muted-foreground">
                修订 {created.snapshot.projectRevision} · {created.snapshot.itemCount} 个素材
              </p>
            </div>
            {manualCopy && (
              <div className="space-y-2" role="status">
                <label htmlFor="canvas-share-manual-copy" className="text-sm font-medium">
                  手动复制完整链接
                </label>
                <Input
                  ref={copyInputRef}
                  id="canvas-share-manual-copy"
                  readOnly
                  value={created.shareUrl}
                  onFocus={event => event.currentTarget.select()}
                />
                <p className="text-xs text-muted-foreground">剪贴板不可用，链接已选中。</p>
              </div>
            )}
            <DialogFooter className="grid grid-cols-1 sm:grid-cols-3">
              <Button type="button" variant="outline" onClick={() => void handleCopy()}>
                <Copy aria-hidden="true" />复制完整链接
              </Button>
              <Button type="button" variant="outline" onClick={handleOpen}>
                <ExternalLink aria-hidden="true" />打开查看器
              </Button>
              <Button type="button" onClick={handleOpenManagement}>前往管理</Button>
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

            {loading && (
              <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground" role="status" aria-label="正在检查画布分享条件">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                正在检查项目与媒体状态…
              </div>
            )}

            {!loading && preflight && (
              <div className="space-y-4">
                <section className="rounded-lg border bg-muted/30 p-3" aria-label="分享快照检查结果">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                      <p className="mt-1 flex flex-wrap gap-x-1 text-xs text-muted-foreground">
                        <span>修订 {preflight.projectRevision}</span>
                        <span aria-hidden="true">·</span>
                        <span>{preflight.itemCount} 个素材</span>
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${preflight.readiness.ready ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
                      {preflight.readiness.ready ? '媒体已就绪' : '媒体未就绪'}
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
                    min={new Date().toISOString().slice(0, 10)}
                    value={expiresOn}
                    onChange={event => setExpiresOn(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">默认 30 天，可在分享管理中修改。</p>
                </div>

                <div className="flex min-h-11 items-center justify-between gap-4 rounded-lg border px-3 py-2">
                  <label htmlFor="canvas-share-download" className="text-sm font-medium">允许访问者下载</label>
                  <Switch
                    id="canvas-share-download"
                    aria-label="允许访问者下载"
                    checked={allowDownload}
                    onCheckedChange={setAllowDownload}
                  />
                </div>

                <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <p>创建后将绑定当前修订和素材快照，后续编辑不会改变此分享。</p>
                </div>
              </div>
            )}

            {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleOpenManagement}>
                管理已有分享
              </Button>
              {(!preflight || !preflight.readiness.ready) && !loading && (
                <Button type="button" variant="outline" onClick={() => void runPreflight()}>
                  重新检查
                </Button>
              )}
              <Button
                type="button"
                disabled={loading || submitting || !preflight?.readiness.ready || !title.trim()}
                onClick={() => void handleCreate()}
              >
                {submitting && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {submitting ? '创建中…' : '创建分享'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
