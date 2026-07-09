'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User } from '@/lib/user-types';
import { UserManager } from '@/lib/user-manager';
import type { ChatSession, ChatMessage } from '@/types/simple-chat';
import { SimpleChatSidebar } from '@/components/simple-chat/sidebar';
import ChatArea from '@/components/simple-chat/chat-area';
import { SimpleChatLogin } from '@/components/simple-chat/login';

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

  const handleLogin = useCallback((u: User) => {
    setUser(u);
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

  // 未登录
  if (!user) {
    return <SimpleChatLogin onLogin={handleLogin} />;
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
