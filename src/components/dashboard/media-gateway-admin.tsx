'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  ShieldOff,
} from 'lucide-react';

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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface GatewayKeyView {
  id: string;
  userId: string;
  keyPrefix: string;
  label: string;
  requestsPerMinute: number;
  dailyQuota: number;
  todayUsage: number;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface KeyFormState {
  userId: string;
  label: string;
  requestsPerMinute: string;
  dailyQuota: string;
  enabled: boolean;
}

type DrawerMode = 'issue' | 'edit' | null;

const initialForm: KeyFormState = {
  userId: '',
  label: '',
  requestsPerMinute: '60',
  dailyQuota: '1000',
  enabled: true,
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const FULL_SECRET_PATTERN = /wmg_[A-Za-z0-9_-]{43,}/;
const SECRET_PATTERN = /^wmg_[A-Za-z0-9_-]{43}$/;

function safeText(value: unknown, maximum: number): string | null {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maximum
    && !FULL_SECRET_PATTERN.test(value)
    ? value
    : null;
}

function safeInteger(value: unknown, minimum: number, maximum: number): number | null {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : null;
}

function safeTimestamp(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || FULL_SECRET_PATTERN.test(value)) return null;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value ? value : null;
}

function parseKey(value: unknown): GatewayKeyView | null {
  const record = objectValue(value);
  if (!record) return null;
  const id = safeText(record.id, 100);
  const userId = safeText(record.userId, 200);
  const keyPrefix = safeText(record.keyPrefix, 12);
  const label = safeText(record.label, 100);
  const createdBy = safeText(record.createdBy, 200);
  const requestsPerMinute = safeInteger(record.requestsPerMinute, 1, 600);
  const dailyQuota = safeInteger(record.dailyQuota, 0, 100_000);
  const todayUsage = safeInteger(record.todayUsage, 0, Number.MAX_SAFE_INTEGER);
  const createdAt = safeTimestamp(record.createdAt);
  const lastUsedAt = safeTimestamp(record.lastUsedAt, true);
  const revokedAt = safeTimestamp(record.revokedAt, true);
  if (
    !id || !/^gwkey_[A-Za-z0-9_-]+$/.test(id)
    || !userId || !keyPrefix || !/^wmg_[A-Za-z0-9_-]{8}$/.test(keyPrefix)
    || !label || !createdBy
    || requestsPerMinute === null || dailyQuota === null || todayUsage === null
    || typeof record.enabled !== 'boolean'
    || createdAt === null
    || (record.lastUsedAt !== null && lastUsedAt === null)
    || (record.revokedAt !== null && revokedAt === null)
    || (revokedAt !== null && record.enabled)
  ) return null;
  return {
    id,
    userId,
    keyPrefix,
    label,
    requestsPerMinute,
    dailyQuota,
    todayUsage,
    enabled: record.enabled,
    createdBy,
    createdAt,
    lastUsedAt,
    revokedAt,
  };
}

function formatTimestamp(value: string | null): string {
  if (!value) return '从未使用';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN', { hour12: false });
}

function keyStatus(key: GatewayKeyView): { label: string; className: string } {
  if (key.revokedAt) return { label: '已吊销', className: 'bg-red-500/10 text-red-400' };
  if (!key.enabled) return { label: '已停用', className: 'bg-amber-500/10 text-amber-400' };
  return { label: '正常', className: 'bg-emerald-500/10 text-emerald-400' };
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null);
  return objectValue(value) ?? {};
}

export default function MediaGatewayAdmin() {
  const [keys, setKeys] = useState<GatewayKeyView[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [editingKey, setEditingKey] = useState<GatewayKeyView | null>(null);
  const [form, setForm] = useState<KeyFormState>(initialForm);
  const [saving, setSaving] = useState(false);
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [revokeKey, setRevokeKey] = useState<GatewayKeyView | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [mutationLocked, setMutationLocked] = useState(false);

  const loadKeys = useCallback(async (): Promise<void> => {
    setLoading(true);
    setListError(null);
    try {
      const response = await fetch('/api/admin/gateway/keys');
      const body = await responseBody(response);
      if (!response.ok || body.success !== true || !Array.isArray(body.keys)) {
        throw new Error('invalid response');
      }
      const parsedKeys = body.keys.map(parseKey);
      if (parsedKeys.some(key => key === null)) {
        setKeys([]);
        setListError('服务器响应不可信，未显示任何媒体网关密钥。');
        return;
      }
      setKeys(parsedKeys as GatewayKeyView[]);
    } catch {
      setKeys([]);
      setListError('加载媒体网关密钥失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const summary = useMemo(() => ({
    total: keys.length,
    active: keys.filter(key => key.enabled && !key.revokedAt).length,
    todayUsage: keys.reduce((total, key) => total + key.todayUsage, 0),
    dailyQuota: keys.reduce((total, key) => total + key.dailyQuota, 0),
  }), [keys]);

  const openIssueDrawer = (): void => {
    setEditingKey(null);
    setForm(initialForm);
    setSheetError(null);
    setDrawerMode('issue');
  };

  const openEditDrawer = (key: GatewayKeyView): void => {
    setEditingKey(key);
    setForm({
      userId: key.userId,
      label: key.label,
      requestsPerMinute: String(key.requestsPerMinute),
      dailyQuota: String(key.dailyQuota),
      enabled: key.enabled,
    });
    setSheetError(null);
    setDrawerMode('edit');
  };

  const closeSecretDialog = (): void => {
    setIssuedSecret(null);
    setSecretCopied(false);
    setSecretError(null);
  };

  const reconcileAmbiguousMutation = async (message: string): Promise<void> => {
    setMutationLocked(true);
    setSheetError(message);
    setRevokeError(message);
    await loadKeys();
  };

  const submitForm = async (): Promise<void> => {
    const requestsPerMinute = Number(form.requestsPerMinute);
    const dailyQuota = Number(form.dailyQuota);
    if (
      !form.userId.trim() || !form.label.trim()
      || !Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 600
      || !Number.isInteger(dailyQuota) || dailyQuota < 0 || dailyQuota > 100_000
    ) {
      setSheetError('请填写有效的用户、标签、RPM 和日配额。');
      return;
    }
    if (mutationLocked) return;
    setSaving(true);
    setSheetError(null);
    try {
      const isIssue = drawerMode === 'issue';
      const submittedLabel = form.label.trim();
      const submittedUserId = form.userId.trim();
      const response = await fetch(
        isIssue ? '/api/admin/gateway/keys' : `/api/admin/gateway/keys/${editingKey?.id ?? ''}`,
        {
          method: isIssue ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isIssue ? {
            userId: submittedUserId,
            label: submittedLabel,
            requestsPerMinute,
            dailyQuota,
          } : {
            label: submittedLabel,
            requestsPerMinute,
            dailyQuota,
            enabled: form.enabled,
          }),
        },
      );
      const body = await responseBody(response);
      if (!response.ok) throw new Error('request failed');
      const returnedKey = parseKey(body.key);
      const secret = isIssue && typeof body.secret === 'string' && SECRET_PATTERN.test(body.secret)
        ? body.secret
        : null;
      const keyMatchesRequest = returnedKey !== null
        && returnedKey.userId === submittedUserId
        && returnedKey.label === submittedLabel
        && returnedKey.requestsPerMinute === requestsPerMinute
        && returnedKey.dailyQuota === dailyQuota
        && (isIssue
          ? secret !== null
            && returnedKey.keyPrefix === secret.slice(0, 12)
            && returnedKey.todayUsage === 0
            && returnedKey.enabled
            && returnedKey.revokedAt === null
          : returnedKey.id === editingKey?.id
            && returnedKey.enabled === form.enabled);
      if (body.success !== true || !keyMatchesRequest || (isIssue && secret === null)) {
        await reconcileAmbiguousMutation(
          isIssue
            ? '签发结果无法确认。已锁定重复签发并重新加载权威列表。'
            : '保存结果无法确认。已锁定重复提交并重新加载权威列表。',
        );
        return;
      }

      setKeys(current => isIssue
        ? [returnedKey, ...current.filter(key => key.id !== returnedKey.id)]
        : current.map(key => key.id === returnedKey.id ? returnedKey : key));
      if (isIssue) {
        setIssuedSecret(secret);
        setSecretCopied(false);
        setSecretError(null);
      }
      setDrawerMode(null);
      setEditingKey(null);
    } catch {
      setSheetError(drawerMode === 'issue' ? '签发密钥失败，请重试。' : '保存密钥失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  const copyPrefix = async (key: GatewayKeyView): Promise<void> => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(key.keyPrefix);
      setCopiedKeyId(key.id);
      window.setTimeout(() => setCopiedKeyId(current => current === key.id ? null : current), 1500);
    } catch {
      setListError('复制前缀失败，请手动复制。');
    }
  };

  const copySecret = async (): Promise<void> => {
    if (!issuedSecret) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(issuedSecret);
      setSecretCopied(true);
      window.setTimeout(() => setSecretCopied(false), 1500);
    } catch {
      setSecretError('复制失败，请手动复制。');
    }
  };

  const confirmRevoke = async (): Promise<void> => {
    if (!revokeKey) return;
    if (mutationLocked) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      const response = await fetch(`/api/admin/gateway/keys/${revokeKey.id}`, { method: 'DELETE' });
      const body = await responseBody(response);
      if (!response.ok) throw new Error('request failed');
      const returnedKey = parseKey(body.key);
      if (
        body.success !== true
        || !returnedKey
        || returnedKey.id !== revokeKey.id
        || returnedKey.enabled
        || returnedKey.revokedAt === null
      ) {
        await reconcileAmbiguousMutation('吊销结果无法确认。已锁定重复提交并重新加载权威列表。');
        return;
      }
      setKeys(current => current.map(key => key.id === returnedKey.id ? returnedKey : key));
      setRevokeKey(null);
    } catch {
      setRevokeError('吊销密钥失败，请重试。');
    } finally {
      setRevoking(false);
    }
  };

  return (
    <section
      data-testid="media-gateway-admin"
      className="h-full max-w-full overflow-x-hidden overflow-y-auto bg-background p-4 text-foreground sm:p-6"
    >
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <KeyRound className="size-5 text-primary" />
              媒体网关
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">管理服务端媒体任务访问密钥与调用额度</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadKeys()} disabled={loading}>
              <RefreshCw className={loading ? 'animate-spin' : ''} />
              刷新
            </Button>
            <Button size="sm" onClick={openIssueDrawer} disabled={mutationLocked}>
              <Plus />
              签发密钥
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          {[
            ['密钥总数', summary.total],
            ['正常密钥', summary.active],
            ['今日使用', summary.todayUsage],
            ['日配额合计', summary.dailyQuota],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 font-mono text-lg font-semibold">{value.toLocaleString('zh-CN')}</p>
            </div>
          ))}
        </div>

        {listError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{listError}</span>
          </div>
        )}

        {loading ? (
          <div role="status" aria-label="正在加载媒体网关密钥" className="space-y-2">
            {[0, 1, 2].map(item => <div key={item} className="h-14 animate-pulse rounded-lg bg-muted" />)}
          </div>
        ) : keys.length === 0 ? (
          <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 text-center">
            <KeyRound className="mb-3 size-8 text-muted-foreground" />
            <h2 className="text-sm font-semibold">尚未签发媒体网关密钥</h2>
            <p className="mt-1 text-xs text-muted-foreground">签发后，Secret 仅会显示一次。</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card">
            <table data-testid="media-gateway-table" className="hidden w-full table-fixed text-left text-sm md:table">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="w-[16%] px-3 py-3 font-medium">标签</th>
                  <th className="w-[14%] px-3 py-3 font-medium">用户</th>
                  <th className="w-[14%] px-3 py-3 font-medium">前缀</th>
                  <th className="w-[10%] px-3 py-3 font-medium">状态</th>
                  <th className="w-[8%] px-3 py-3 font-medium">RPM</th>
                  <th className="w-[10%] px-3 py-3 font-medium">日配额</th>
                  <th className="w-[10%] px-3 py-3 font-medium">今日使用</th>
                  <th className="w-[12%] px-3 py-3 font-medium">最近使用</th>
                  <th className="w-[6%] px-3 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {keys.map(key => <KeyTableRow key={key.id} gatewayKey={key} copiedKeyId={copiedKeyId} onCopy={copyPrefix} onEdit={openEditDrawer} onRevoke={gatewayKey => { setRevokeError(null); setRevokeKey(gatewayKey); }} />)}
              </tbody>
            </table>
            <div data-testid="media-gateway-mobile-list" className="divide-y divide-border md:hidden">
              {keys.map(key => <KeyMobileRow key={key.id} gatewayKey={key} copiedKeyId={copiedKeyId} onCopy={copyPrefix} onEdit={openEditDrawer} onRevoke={gatewayKey => { setRevokeError(null); setRevokeKey(gatewayKey); }} />)}
            </div>
          </div>
        )}
      </div>

      <Sheet open={drawerMode !== null} onOpenChange={open => { if (!open && !saving) { setDrawerMode(null); setSheetError(null); } }}>
        <SheetContent className="w-[calc(100%-1rem)] max-w-md overflow-x-hidden overflow-y-auto border-border sm:w-full">
          <SheetHeader>
            <SheetTitle>{drawerMode === 'issue' ? '签发媒体网关密钥' : '编辑媒体网关密钥'}</SheetTitle>
            <SheetDescription>{drawerMode === 'issue' ? 'Secret 只在签发成功后显示一次。' : '用户与密钥前缀不可修改。'}</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4">
            <FormField label="用户 ID" htmlFor="gateway-user-id">
              <Input id="gateway-user-id" value={form.userId} disabled={drawerMode === 'edit'} onChange={event => setForm(current => ({ ...current, userId: event.target.value }))} />
            </FormField>
            <FormField label="标签" htmlFor="gateway-label">
              <Input id="gateway-label" value={form.label} maxLength={100} onChange={event => setForm(current => ({ ...current, label: event.target.value }))} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="每分钟请求数" htmlFor="gateway-rpm">
                <Input id="gateway-rpm" type="number" min={1} max={600} value={form.requestsPerMinute} onChange={event => setForm(current => ({ ...current, requestsPerMinute: event.target.value }))} />
              </FormField>
              <FormField label="日配额" htmlFor="gateway-daily-quota">
                <Input id="gateway-daily-quota" type="number" min={0} max={100000} value={form.dailyQuota} onChange={event => setForm(current => ({ ...current, dailyQuota: event.target.value }))} />
              </FormField>
            </div>
            {drawerMode === 'edit' && (
              <label className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-border px-3 text-sm">
                <span>启用密钥</span>
                <input type="checkbox" checked={form.enabled} onChange={event => setForm(current => ({ ...current, enabled: event.target.checked }))} className="size-4 accent-primary" />
              </label>
            )}
            {sheetError && <ContextError message={sheetError} />}
          </div>
          <SheetFooter>
            <Button onClick={() => void submitForm()} disabled={saving || mutationLocked}>
              {saving ? '提交中...' : drawerMode === 'issue' ? '确认签发' : '保存修改'}
            </Button>
            <Button variant="outline" onClick={() => setDrawerMode(null)} disabled={saving}>取消</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog open={issuedSecret !== null} onOpenChange={open => { if (!open) closeSecretDialog(); }}>
        <DialogContent showCloseButton={false} className="max-w-[calc(100%-1rem)] overflow-x-hidden border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle>密钥签发成功</DialogTitle>
            <DialogDescription>这是唯一一次显示完整 Secret。关闭后无法再次查看。</DialogDescription>
          </DialogHeader>
          {issuedSecret && (
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <code className="min-w-0 flex-1 break-all text-sm text-amber-200">{issuedSecret}</code>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="复制 Secret" onClick={() => void copySecret()}>
                    {secretCopied ? <Check /> : <Copy />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>复制 Secret</TooltipContent>
              </Tooltip>
            </div>
          )}
          {secretError && <ContextError message={secretError} />}
          <DialogFooter>
            <Button onClick={closeSecretDialog}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revokeKey !== null} onOpenChange={open => { if (!open && !revoking) setRevokeKey(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>吊销 {revokeKey?.label}</AlertDialogTitle>
            <AlertDialogDescription>吊销后无法恢复，使用该密钥的请求会立即被拒绝。</AlertDialogDescription>
          </AlertDialogHeader>
          {revokeError && <ContextError message={revokeError} />}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" disabled={revoking || mutationLocked} onClick={event => { event.preventDefault(); void confirmRevoke(); }}>
              {revoking ? '吊销中...' : '确认吊销'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

interface RowProps {
  gatewayKey: GatewayKeyView;
  copiedKeyId: string | null;
  onCopy: (key: GatewayKeyView) => Promise<void>;
  onEdit: (key: GatewayKeyView) => void;
  onRevoke: (key: GatewayKeyView) => void;
}

function PrefixCopy({ gatewayKey, copiedKeyId, onCopy }: Pick<RowProps, 'gatewayKey' | 'copiedKeyId' | 'onCopy'>) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <code className="truncate font-mono text-xs">{gatewayKey.keyPrefix}</code>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="复制前缀" onClick={() => void onCopy(gatewayKey)}>
            {copiedKeyId === gatewayKey.id ? <Check /> : <Copy />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>复制前缀</TooltipContent>
      </Tooltip>
    </span>
  );
}

function KeyActions({ gatewayKey, onEdit, onRevoke }: Pick<RowProps, 'gatewayKey' | 'onEdit' | 'onRevoke'>) {
  const revoked = Boolean(gatewayKey.revokedAt);
  return (
    <span className="inline-flex items-center justify-end gap-1">
      <Button size="icon-sm" variant="ghost" aria-label={`编辑 ${gatewayKey.label}`} onClick={() => onEdit(gatewayKey)} disabled={revoked}>
        <Pencil />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label={`吊销 ${gatewayKey.label}`} onClick={() => onRevoke(gatewayKey)} disabled={revoked} className="text-red-400 hover:bg-red-500/10 hover:text-red-300">
        <ShieldOff />
      </Button>
    </span>
  );
}

function KeyTableRow(props: RowProps) {
  const { gatewayKey } = props;
  const status = keyStatus(gatewayKey);
  return (
    <tr>
      <td className="truncate px-3 py-3 font-medium">{gatewayKey.label}</td>
      <td className="truncate px-3 py-3 text-muted-foreground">{gatewayKey.userId}</td>
      <td className="px-3 py-3"><PrefixCopy {...props} /></td>
      <td className="px-3 py-3"><span className={`rounded-md px-2 py-1 text-xs ${status.className}`}>{status.label}</span></td>
      <td className="px-3 py-3 font-mono">{gatewayKey.requestsPerMinute}</td>
      <td className="px-3 py-3 font-mono">{gatewayKey.dailyQuota.toLocaleString('zh-CN')}</td>
      <td className="px-3 py-3 font-mono">{gatewayKey.todayUsage.toLocaleString('zh-CN')}</td>
      <td className="px-3 py-3 text-xs text-muted-foreground">{formatTimestamp(gatewayKey.lastUsedAt)}</td>
      <td className="px-3 py-3 text-right"><KeyActions {...props} /></td>
    </tr>
  );
}

function KeyMobileRow(props: RowProps) {
  const { gatewayKey } = props;
  const status = keyStatus(gatewayKey);
  return (
    <article className="min-w-0 space-y-3 p-4">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{gatewayKey.label}</h2>
          <p className="truncate text-xs text-muted-foreground">{gatewayKey.userId}</p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-1 text-xs ${status.className}`}>{status.label}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div><p className="text-muted-foreground">RPM</p><p className="mt-1 font-mono">{gatewayKey.requestsPerMinute}</p></div>
        <div><p className="text-muted-foreground">今日使用</p><p className="mt-1 font-mono">{gatewayKey.todayUsage}</p></div>
        <div><p className="text-muted-foreground">日配额</p><p className="mt-1 font-mono">{gatewayKey.dailyQuota}</p></div>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2 border-t border-border pt-2">
        <div className="min-w-0"><PrefixCopy {...props} /><p className="truncate text-[11px] text-muted-foreground">{formatTimestamp(gatewayKey.lastUsedAt)}</p></div>
        <KeyActions {...props} />
      </div>
    </article>
  );
}

function FormField({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function ContextError({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}
