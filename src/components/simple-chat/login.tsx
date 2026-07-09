'use client';

import React, { useState, useMemo } from 'react';
import { User } from '@/lib/user-types';
import { UserManager } from '@/lib/user-manager';
import { Eye, EyeOff, Sparkles } from 'lucide-react';

interface SimpleChatLoginProps {
  onLogin: (user: User) => void;
}

export function SimpleChatLogin({ onLogin }: SimpleChatLoginProps) {
  const userManager = useMemo(() => UserManager.getInstance(), []);
  const [loginName, setLoginName] = useState('Mr.joker');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!loginName.trim() || !loginPassword) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: loginName.trim(), password: loginPassword }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json() as { user?: User };
      if (!data.user) throw new Error();
      const loggedIn = await userManager.upsertUserFromServer(data.user);
      onLogin(loggedIn);
    } catch {
      setError('登录失败，或该用户已被禁用');
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex min-h-screen bg-[#0A0A0F]">
      {/* 左侧品牌展示区 */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col justify-between p-12 xl:p-16"
           style={{ background: 'linear-gradient(135deg, #0E0E16 0%, #151520 40%, #1A1A28 70%, #0E0E16 100%)' }}>
        {/* 光效背景 */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute -top-24 -left-24 w-80 h-80 rounded-full opacity-20"
               style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.3) 0%, transparent 70%)' }} />
          <div className="absolute bottom-20 right-10 w-96 h-96 rounded-full opacity-10"
               style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.25) 0%, transparent 70%)' }} />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <Sparkles className="w-8 h-8" style={{ color: '#d4af37' }} />
            <span className="text-2xl font-bold text-white">无界AI</span>
          </div>
          <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight mb-4">
            简洁聊天
          </h1>
          <p className="text-lg" style={{ color: '#9CA3AF' }}>
            AI 对话 + 生图的全新独立体验
          </p>
        </div>

        <div className="relative z-10 space-y-3" style={{ color: '#6B7280' }}>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#d4af37' }} />
            <span>支持 ChatGPT / Gemini / DeepSeek 对话</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#d4af37' }} />
            <span>对话框内直接 AI 生图</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#d4af37' }} />
            <span>会话管理 & Agent 模式</span>
          </div>
        </div>
      </div>

      {/* 右侧登录表单 */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <Sparkles className="w-7 h-7" style={{ color: '#d4af37' }} />
            <span className="text-xl font-bold text-white">无界AI 简洁聊天</span>
          </div>

          <h2 className="text-2xl font-semibold text-white mb-1">欢迎回来</h2>
          <p className="text-sm mb-8" style={{ color: '#6B7280' }}>登录以继续使用</p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#9CA3AF' }}>
                用户名
              </label>
              <input
                type="text"
                value={loginName}
                onChange={e => { setLoginName(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                className="w-full px-4 py-3 rounded-lg border text-white placeholder-gray-500 focus:outline-none focus:ring-2 transition-all"
                style={{
                  background: '#1A1A24',
                  borderColor: '#2A2A3A',
                  '--tw-ring-color': 'rgba(212,175,55,0.3)',
                } as React.CSSProperties}
                placeholder="输入用户名"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#9CA3AF' }}>
                密码
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={loginPassword}
                  onChange={e => { setLoginPassword(e.target.value); setError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  className="w-full px-4 py-3 pr-12 rounded-lg border text-white placeholder-gray-500 focus:outline-none focus:ring-2 transition-all"
                  style={{
                    background: '#1A1A24',
                    borderColor: '#2A2A3A',
                    '--tw-ring-color': 'rgba(212,175,55,0.3)',
                  } as React.CSSProperties}
                  placeholder="输入密码"
                />
                <button
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:opacity-80 transition-opacity"
                  style={{ color: '#6B7280' }}
                  type="button"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm" style={{ color: '#EF4444' }}>{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full py-3 rounded-lg font-medium text-sm transition-all duration-200 disabled:opacity-50"
              style={{
                background: loading ? '#3A3A4A' : '#d4af37',
                color: loading ? '#6B7280' : '#0A0A0F',
              }}
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
