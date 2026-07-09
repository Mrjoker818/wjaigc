'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User } from '@/lib/user-types';
import { UserManager } from '@/lib/user-manager';
import type { ChatSession } from '@/types/simple-chat';
import { SimpleChatSidebar } from '@/components/simple-chat/sidebar';
import ChatArea from '@/components/simple-chat/chat-area';

export default function SimpleChatPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const initRef = useRef(false);

  // 登录态检查
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        const data = await res.json();
        if (data.success && data.user) {
          const um = UserManager.getInstance();
          const loggedIn = await um.upsertUserFromServer(data.user);
          setUser(loggedIn);
        }
      } catch {
        // ignore
      }
      setAuthChecked(true);
    };
    checkAuth();
  }, []);

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    setSessions([]);
    setActiveSessionId(null);
  }, []);

  const handleSessionsChange = useCallback((s: ChatSession[]) => {
    setSessions(s);
  }, []);

  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const handleNewSession = useCallback((session: ChatSession) => {
    setSessions(prev => [session, ...prev]);
    setActiveSessionId(session.id);
  }, []);

  const handleDeleteSession = useCallback((id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      setActiveSessionId(remaining[0]?.id ?? null);
    }
  }, [activeSessionId, sessions]);

  // 登录检查中
  if (!authChecked) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0A0A0F]">
        <div className="w-8 h-8 border-2 border-[#d4af37]/30 border-t-[#d4af37] rounded-full animate-spin" />
      </div>
    );
  }

  // 未登录 — 重定向到主页面进行双模式登录
  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0A0A0F]">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">请先登录</p>
          <button
            onClick={() => { window.location.href = '/'; }}
            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-md text-sm font-semibold hover:brightness-110 transition-all"
          >
            前往登录
          </button>
        </div>
      </div>
    );
  }

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null;

  return (
    <div className="flex h-screen bg-[#0A0A0F] text-white overflow-hidden">
      {/* 侧边栏 */}
      <SimpleChatSidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(v => !v)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onNewSession={handleNewSession}
        onSessionsChange={handleSessionsChange}
        userName={user.name ?? 'User'}
        onLogout={handleLogout}
      />

      {/* 主聊天区域 */}
      <ChatArea
        onBackToWorkspace={() => window.location.href = '/'}
        session={activeSession ?? null}
        onNewSession={handleNewSession}
        onUpdateSession={(s: ChatSession) => {
          setSessions(prev => prev.map(x => x.id === s.id ? s : x));
        }}
        sidebarOpen={sidebarOpen}
      />
    </div>
  );
}
