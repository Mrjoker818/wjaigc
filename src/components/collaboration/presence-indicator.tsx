'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, Users, X } from 'lucide-react';

import { useProjectPresence } from '@/lib/collaboration/presence-client';

interface PresenceIndicatorProps {
  projectId: string;
  isOwner: boolean;
  themeStyle: 'gold' | 'monochrome';
}

interface PresenceMember {
  userId: string;
  name: string;
}

function readMembers(value: unknown): PresenceMember[] {
  if (typeof value !== 'object' || value === null || !('members' in value) || !Array.isArray(value.members)) return [];
  return value.members.filter((item): item is PresenceMember =>
    typeof item === 'object' && item !== null
    && 'userId' in item && typeof item.userId === 'string'
    && 'name' in item && typeof item.name === 'string');
}

export function PresenceIndicator({ projectId, isOwner, themeStyle }: PresenceIndicatorProps) {
  const { status, participants } = useProjectPresence(projectId);
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [memberUserId, setMemberUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const dark = themeStyle === 'gold';

  useEffect(() => {
    if (!open || !isOwner) return;
    const controller = new AbortController();
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/collaboration/members?projectId=${encodeURIComponent(projectId)}`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('members unavailable');
        const payload: unknown = await response.json();
        if (!controller.signal.aborted) setMembers(readMembers(payload));
      } catch {
        if (!controller.signal.aborted) setError('无法加载成员列表');
      }
    })();
    return () => controller.abort();
  }, [isOwner, open, projectId, refresh]);

  const mutate = async (method: 'POST' | 'DELETE', userId: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/collaboration/members', {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, memberUserId: userId }),
      });
      if (!response.ok) throw new Error('member mutation failed');
      if (method === 'POST') setMemberUserId('');
      setRefresh(value => value + 1);
    } catch {
      setError('无法完成成员操作，请确认用户 ID 与项目权限');
    } finally {
      setBusy(false);
    }
  };

  const label = status === 'online' ? `${participants.length} 人在线`
    : status === 'connecting' ? '连接中'
      : '在线状态暂不可用';

  if (status === 'disabled') return null;

  return (
    <div className="relative flex shrink-0 items-center gap-1" data-presence-indicator>
      <span
        role="status"
        aria-label="在线状态"
        aria-atomic="true"
        className={`flex min-h-11 items-center gap-1.5 rounded-lg px-1.5 text-xs font-medium ${dark ? 'text-white' : 'text-gray-800'}`}
      >
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${status === 'online' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-500' : 'bg-gray-500'}`} />
        <span className="sr-only">在线状态：</span>
        <span className="hidden sm:inline">{label}</span>
        <span className="sr-only sm:hidden">{label}</span>
        <span className="sm:hidden" aria-hidden="true">{status === 'online' ? participants.length : '—'}</span>
      </span>
      {status === 'online' && participants.length > 0 && (
        <div className="hidden items-center -space-x-1 sm:flex" aria-hidden="true">
          {participants.slice(0, 3).map(person => (
            <span key={person.userId} title={person.displayName} className={`flex size-6 items-center justify-center rounded-full border text-[11px] ${dark ? 'border-[#171717] bg-[#444] text-white' : 'border-white bg-gray-200 text-gray-800'}`}>
              {person.displayName.slice(0, 1) || '·'}
            </span>
          ))}
        </div>
      )}
      {isOwner && (
        <button
          type="button"
          aria-label="管理在线成员"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
          className={`flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${dark ? 'text-gray-200 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'}`}
        >
          <Users className="size-4" aria-hidden="true" />
        </button>
      )}
      {open && isOwner && createPortal(
        <div
          role="dialog"
          aria-label="项目在线成员"
          data-modal
          className={`fixed left-1/2 top-16 z-[100] w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border p-4 shadow-xl ${dark ? 'border-white/10 bg-[#1a1a1a] text-white' : 'border-gray-200 bg-white text-gray-900'}`}
          onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">在线成员资格</h2>
            <button type="button" aria-label="关闭在线成员面板" onClick={() => setOpen(false)} className="flex size-11 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" aria-hidden="true" /></button>
          </div>
          <p className={`mb-3 text-xs ${dark ? 'text-gray-300' : 'text-gray-600'}`}>仅授予在线状态资格，不授予画布查看或编辑权限。</p>
          <form onSubmit={event => {
            event.preventDefault();
            const id = memberUserId.trim();
            if (id) void mutate('POST', id);
          }}>
            <label htmlFor="presence-member-user-id" className="mb-1 block text-xs font-medium">成员用户 ID</label>
            <div className="flex gap-2">
              <input id="presence-member-user-id" value={memberUserId} maxLength={256} onChange={event => setMemberUserId(event.target.value)} className={`min-w-0 flex-1 rounded-lg border px-2 text-sm ${dark ? 'border-white/20 bg-[#252525]' : 'border-gray-300 bg-white'}`} />
              <button type="submit" disabled={busy || !memberUserId.trim()} aria-label="邀请成员" className="flex min-h-11 items-center gap-1 rounded-lg bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50"><UserPlus className="size-4" aria-hidden="true" /><span>邀请</span></button>
            </div>
          </form>
          {error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}
          <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto" aria-label="已邀请成员">
            {members.map(member => (
              <li key={member.userId} className="flex min-h-11 items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate" title={member.userId}>{member.name}</span>
                <button type="button" disabled={busy} aria-label={`撤销${member.name}的在线资格`} onClick={() => void mutate('DELETE', member.userId)} className="min-h-11 shrink-0 rounded-lg px-2 text-xs text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">撤销</button>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}
