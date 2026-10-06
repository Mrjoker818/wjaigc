'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UserManager } from '@/lib/user-manager';
import { isOwnerClientScopeCurrent, OwnerDocumentRequestError, readOwnerProjectStatus,
  requestOwnerDocument, saveAndEnableOwnerProject, type OwnerClientScope,
  type OwnerProjectStatus } from '@/lib/collaboration/document-owner-client';

export interface ProjectCollaborationDialogProps {
  open: boolean; userId: string; projectId: string; projectName: string;
  returnFocusTarget: HTMLButtonElement | null; onOpenChange: (open: boolean) => void;
}

interface Editor { userId: string; name: string; }
interface ViewState {
  key: string; status: OwnerProjectStatus | null; editors: Editor[];
  busy: string; error: string; message: string; memberName: string; refreshFailed: boolean;
}
interface Operation { scope: OwnerClientScope; key: string; controller: AbortController; }
function emptyState(key: string): ViewState {
  return { key, status: null, editors: [], busy: '', error: '', message: '', memberName: '', refreshFailed: false };
}
function safeError(error: unknown): string {
  if (error instanceof OwnerDocumentRequestError) {
    const messages: Record<string, string> = {
      AUTHENTICATION_REQUIRED: '登录状态已失效，请重新登录', DOCUMENT_FORBIDDEN: '无权管理此项目的协作',
      DOCUMENT_INVITEE_INVALID: '可邀请账号无效，请核对现有登录账号名称',
      DOCUMENT_PROJECT_REVISION_CONFLICT: '项目已更新，请核对最新项目后重试',
      DOCUMENT_AUTHORITY_CONFLICT: '项目协作记录不一致，请刷新后重试',
      DOCUMENT_PROJECT_NOT_ENABLED: '项目尚未启用协作', DOCUMENT_DISABLED: '协作功能暂未开放',
    };
    return messages[error.code] ?? '操作结果无法确认，请刷新状态后重试';
  }
  return '操作未完成，请稍后重试';
}

export function ProjectCollaborationDialog({ open, userId, projectId, projectName,
  returnFocusTarget, onOpenChange }: ProjectCollaborationDialogProps): ReactNode {
  const key = JSON.stringify([open, userId, projectId]);
  const committed = useRef({ key, open, userId, projectId });
  const operation = useRef<Operation | null>(null);
  const generation = useRef(0);
  const [state, setState] = useState<ViewState>(() => emptyState(key));
  const manager = UserManager.getInstance();
  const invalidate = useCallback((): void => {
    operation.current?.controller.abort(); operation.current = null; generation.current += 1;
  }, []);
  useLayoutEffect(() => {
    invalidate(); committed.current = { key, open, userId, projectId }; setState(emptyState(key));
    return invalidate;
  }, [key, open, userId, projectId, invalidate]);
  const currentScope = useCallback((): OwnerClientScope | null => {
    const active = operation.current;
    return active && committed.current.open && active.key === committed.current.key
      && manager.getCurrentUserId() === active.scope.userId && !active.controller.signal.aborted
      ? active.scope : null;
  }, [manager]);
  const current = useCallback((op: Operation): boolean => isOwnerClientScopeCurrent(op.scope, currentScope()), [currentScope]);
  const begin = useCallback((busy: string): Operation | null => {
    if (!committed.current.open || manager.getCurrentUserId() !== committed.current.userId) return null;
    invalidate();
    const op = { key: committed.current.key, controller: new AbortController(),
      scope: { userId: committed.current.userId, projectId: committed.current.projectId, generation: generation.current } };
    operation.current = op;
    setState(previous => ({ ...previous, key: op.key, busy, error: '', message: '' }));
    return op;
  }, [invalidate, manager]);
  const finish = useCallback((op: Operation): void => {
    if (current(op)) setState(previous => ({ ...previous, busy: '' }));
  }, [current]);
  const load = useCallback(async (op: Operation, id: string): Promise<OwnerProjectStatus | null> => {
    const status = await readOwnerProjectStatus(id, op.controller.signal);
    if (!current(op)) return null;
    setState(previous => ({ ...previous, status }));
    if (status.enabled && status.featureEnabled) {
      const result = await requestOwnerDocument(`/api/collaboration/editors?projectId=${encodeURIComponent(id)}`, { signal: op.controller.signal });
      if (!current(op)) return null;
      if (!Array.isArray(result.editors) || !result.editors.every((editor: unknown) => (
        typeof editor === 'object' && editor !== null && 'userId' in editor && typeof editor.userId === 'string'
        && 'name' in editor && typeof editor.name === 'string'
      ))) throw new OwnerDocumentRequestError('DOCUMENT_RESPONSE_INVALID', 200, false);
      setState(previous => ({ ...previous, editors: result.editors as Editor[] }));
    }
    return status;
  }, [current]);
  const refreshStatus = useCallback(async (id: string): Promise<void> => {
    const op = begin('status'); if (!op) return;
    try { await load(op, id); } catch (error) {
      if (current(op)) setState(previous => ({ ...previous, error: safeError(error) }));
    } finally { finish(op); }
  }, [begin, load, current, finish]);
  useEffect(() => { if (open) void refreshStatus(projectId); }, [key, open, projectId, refreshStatus]);

  const refreshProject = async (op: Operation): Promise<void> => {
    if (!current(op)) return;
    let refreshed = false;
    try { refreshed = await manager.loadProjectsFromServer(0, op.scope.userId); } catch { /* A read failure does not undo enable. */ }
    if (current(op)) setState(previous => ({ ...previous, refreshFailed: !refreshed }));
  };
  const enable = async (): Promise<void> => {
    const op = begin('enable'); if (!op) return;
    try {
      const saved = await saveAndEnableOwnerProject(op.scope, manager, currentScope, op.controller.signal);
      if (!current(op)) return;
      setState(previous => ({ ...previous, status: { projectId: saved.projectId, enabled: true,
        featureEnabled: true, currentRevision: saved.expectedRevision } }));
      await refreshProject(op);
      if (current(op)) await load(op, saved.projectId);
    } catch (error) {
      if (!current(op)) return;
      setState(previous => ({ ...previous, error: safeError(error) }));
      if (error instanceof OwnerDocumentRequestError && (error.uncertain || error.status === 409)) {
        try {
          const recovered = await load(op, error.projectId ?? projectId);
          if (current(op) && (recovered?.enabled || error.status === 409)) await refreshProject(op);
        } catch { /* Preserve failure; never replay uncertain enable. */ }
      }
    } finally { finish(op); }
  };
  const mutateMember = async (member?: Editor): Promise<void> => {
    const id = state.status?.projectId; if (!id) return;
    const op = begin(member ? `revoke:${member.userId}` : 'invite'); if (!op) return;
    try {
      await requestOwnerDocument('/api/collaboration/editors', {
        method: member ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, signal: op.controller.signal,
        body: JSON.stringify(member ? { projectId: id, memberUserId: member.userId } : { projectId: id, memberName: state.memberName.trim() }),
      });
      if (!current(op)) return;
      await load(op, id);
      if (current(op)) setState(previous => ({ ...previous, memberName: member ? previous.memberName : '',
        message: member ? '编辑权限已撤销' : '编辑者已邀请' }));
    } catch (error) {
      if (!current(op)) return;
      setState(previous => ({ ...previous, error: safeError(error) }));
      if (error instanceof OwnerDocumentRequestError && error.uncertain) {
        try { await load(op, id); } catch { /* Preserve uncertainty without repeating writes. */ }
      }
    } finally { finish(op); }
  };
  const visible = state.key === key ? state : emptyState(key);
  const link = visible.status?.enabled && typeof window !== 'undefined'
    ? `${window.location.origin}/?projectId=${encodeURIComponent(visible.status.projectId)}` : '';
  const copy = async (): Promise<void> => {
    const op = begin('copy'); if (!op) return;
    try {
      await navigator.clipboard.writeText(link);
      if (current(op)) setState(previous => ({ ...previous, message: '链接已复制' }));
    } catch {
      if (current(op)) setState(previous => ({ ...previous, error: '复制失败，请手动复制链接' }));
    } finally { finish(op); }
  };
  return <Dialog open={open} onOpenChange={next => { if (!next) invalidate(); onOpenChange(next); }}>
    <DialogContent showCloseButton={false} className="max-h-[85dvh] overflow-y-auto motion-reduce:animate-none"
      onCloseAutoFocus={event => { event.preventDefault(); returnFocusTarget?.focus(); }}>
      <DialogHeader><DialogTitle>管理协作 · {projectName}</DialogTitle>
        <DialogDescription>邀请已注册账号编辑同一项目；协作链接需要登录与授权，不是匿名分享。</DialogDescription></DialogHeader>
      {visible.busy === 'status' && <p role="status">正在读取协作状态…</p>}
      {visible.error && <p role="alert" className="break-words text-sm text-destructive">{visible.error}</p>}
      {visible.message && <p role="status" className="text-sm">{visible.message}</p>}
      {!visible.status && !visible.busy && <Button className="min-h-11" onClick={() => void refreshStatus(projectId)}>重试读取状态</Button>}
      {visible.status && <>
        {!visible.status.featureEnabled && <p>协作功能暂未开放</p>}
        {visible.status.enabled ? <>
          <p role="status">协作已启用</p>
          {visible.refreshFailed && <div className="space-y-2"><p role="alert">已启用，项目刷新失败</p>
            <Button className="min-h-11" variant="outline" disabled={!!visible.busy} onClick={() => {
              const op = begin('refresh'); if (op) void refreshProject(op).finally(() => finish(op));
            }}>重试项目刷新</Button></div>}
          {visible.status.featureEnabled && <>
            <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (!visible.busy && visible.memberName.trim()) void mutateMember(); }}>
              <label htmlFor="collaboration-account" className="text-sm font-medium">登录账号名称</label>
              <Input id="collaboration-account" className="min-h-11 text-base" autoComplete="off" value={visible.memberName}
                disabled={!!visible.busy} onChange={event => setState(previous => ({ ...previous, memberName: event.target.value }))} />
              <Button className="min-h-11" type="submit" disabled={!!visible.busy || !visible.memberName.trim()}>邀请编辑者</Button>
            </form>
            <ul className="space-y-2" aria-label="项目编辑者">{visible.editors.map(editor => <li key={editor.userId} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border p-2">
              <span className="min-w-0 break-all">{editor.name}</span><Button className="min-h-11" variant="outline" disabled={!!visible.busy}
                aria-label={`撤销 ${editor.name} 的编辑权限`} onClick={() => void mutateMember(editor)}>撤销</Button>
            </li>)}</ul>
            {visible.editors.length === 0 && <p className="text-sm text-muted-foreground">尚无编辑者</p>}
          </>}
          <label className="space-y-2 text-sm">协作访问链接<Input readOnly className="min-h-11" value={link} /></label>
          <Button className="min-h-11" variant="outline" disabled={!!visible.busy} onClick={() => void copy()}>复制协作链接</Button>
        </> : visible.status.featureEnabled && <Button className="min-h-11" disabled={!!visible.busy} onClick={() => void enable()}>
          {visible.busy === 'enable' ? '正在保存并启用…' : '启用协作'}
        </Button>}
      </>}
      {visible.status && <Button className="min-h-11" variant="outline" disabled={!!visible.busy}
        onClick={() => void refreshStatus(visible.status?.projectId ?? projectId)}>刷新协作状态</Button>}
      <Button className="min-h-11" variant="secondary" onClick={() => { invalidate(); onOpenChange(false); }}>关闭</Button>
    </DialogContent>
  </Dialog>;
}
