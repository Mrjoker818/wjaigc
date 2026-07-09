'use client';

import React, { useEffect, useCallback } from 'react';
import {
  PanelLeftClose, PanelLeft, Plus, Trash2, MessageSquare,
  Pin, PinOff, LogOut, Search
} from 'lucide-react';
import type { ChatSession, ChatMessage } from '@/types/simple-chat';

const STORAGE_KEY = 'wujie_simple_chat_sessions';

interface SimpleChatSidebarProps {
  open: boolean;
  onToggle: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onNewSession: (session: ChatSession) => void;
  onSessionsChange: (sessions: ChatSession[]) => void;
  userName: string;
  onLogout: () => void;
}

// localStorage 持久化
function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSessions(sessions: ChatSession[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch { /* ignore */ }
}

export function SimpleChatSidebar({
  open, onToggle, sessions, activeSessionId,
  onSelectSession, onDeleteSession, onNewSession, onSessionsChange,
  userName, onLogout,
}: SimpleChatSidebarProps) {
  // 初始化时从 localStorage 加载
  useEffect(() => {
    const saved = loadSessions();
    if (saved.length > 0 && sessions.length === 0) {
      onSessionsChange(saved);
    }
  }, []);

  // sessions 变化时持久化
  useEffect(() => {
    if (sessions.length > 0) {
      saveSessions(sessions);
    }
  }, [sessions]);

  const handleCreateSession = useCallback(() => {
    const id = `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session: ChatSession = {
      id,
      title: '新对话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: '',
      providerId: '',
      messages: [],
    };
    onNewSession(session);
  }, [onNewSession]);

  const handleDelete = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteSession(id);
  }, [onDeleteSession]);

  const handleTogglePin = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSessionsChange(sessions.map(s =>
      s.id === id ? { ...s, pinned: !s.pinned } : s
    ));
  }, [sessions, onSessionsChange]);

  if (!open) {
    return (
      <div className="flex flex-col items-center py-3 w-14 border-r" style={{ background: '#0E0E16', borderColor: '#1F1F2E' }}>
        <button
          onClick={onToggle}
          className="p-2 rounded-lg hover:bg-white/5 transition-colors"
          style={{ color: '#6B7280' }}
          title="展开侧边栏"
        >
          <PanelLeft className="w-5 h-5" />
        </button>
      </div>
    );
  }

  const sortedSessions = [...sessions].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

  return (
    <div className="flex flex-col w-72 border-r h-full" style={{ background: '#0E0E16', borderColor: '#1F1F2E' }}>
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#1F1F2E' }}>
        <span className="text-sm font-semibold text-white">对话列表</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCreateSession}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            style={{ color: '#d4af37' }}
            title="新建对话"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            style={{ color: '#6B7280' }}
            title="收起侧边栏"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 搜索框 */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm" style={{ background: '#1A1A24', color: '#6B7280' }}>
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span className="text-xs">搜索对话...</span>
        </div>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {sortedSessions.length === 0 ? (
          <div className="text-center py-8" style={{ color: '#4B5563' }}>
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">暂无对话</p>
            <button
              onClick={handleCreateSession}
              className="mt-3 text-xs px-3 py-1.5 rounded-lg transition-colors hover:bg-white/5"
              style={{ color: '#d4af37', border: '1px solid rgba(212,175,55,0.3)' }}
            >
              开始新对话
            </button>
          </div>
        ) : (
          sortedSessions.map(session => (
            <div
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                activeSessionId === session.id ? '' : 'hover:bg-white/5'
              }`}
              style={activeSessionId === session.id ? { background: 'rgba(212,175,55,0.1)', color: '#d4af37' } : { color: '#9CA3AF' }}
            >
              <MessageSquare className="w-4 h-4 shrink-0" />
              <span className="flex-1 text-sm truncate">{session.title}</span>
              <div className="hidden group-hover:flex items-center gap-0.5">
                <button
                  onClick={(e) => handleTogglePin(session.id, e)}
                  className="p-1 rounded hover:bg-white/10 transition-colors"
                  title={session.pinned ? '取消置顶' : '置顶'}
                >
                  {session.pinned ? (
                    <Pin className="w-3 h-3" style={{ color: '#d4af37' }} />
                  ) : (
                    <PinOff className="w-3 h-3" style={{ color: '#6B7280' }} />
                  )}
                </button>
                <button
                  onClick={(e) => handleDelete(session.id, e)}
                  className="p-1 rounded hover:bg-white/10 transition-colors"
                  style={{ color: '#6B7280' }}
                  title="删除"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 底部用户信息 */}
      <div className="px-4 py-3 border-t flex items-center gap-3" style={{ borderColor: '#1F1F2E' }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
             style={{ background: 'linear-gradient(135deg, #d4af37, #b8960f)' }}>
          {userName.charAt(0).toUpperCase()}
        </div>
        <span className="flex-1 text-sm truncate" style={{ color: '#9CA3AF' }}>{userName}</span>
        <button
          onClick={onLogout}
          className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
          style={{ color: '#6B7280' }}
          title="退出登录"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
