'use client';

import { useState } from 'react';
import { User } from '@/lib/user-types';
import { UserManager as UserManagerCore } from '@/lib/user-manager';

interface LoginPanelProps {
  onLogin: (user: User) => void;
}

export function LoginPanel({ onLogin }: LoginPanelProps) {
  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const userManager = UserManagerCore.getInstance();

  const submitLogin = async (name: string, password: string) => {
    setIsLoading(true);
    setLoginError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, password }),
      });

      if (!response.ok) {
        setLoginError('登录失败，或该用户已被禁用');
        return;
      }

      const data = await response.json() as { user?: User };
      if (!data.user) {
        setLoginError('登录失败，或该用户已被禁用');
        return;
      }

      const loggedIn = await userManager.upsertUserFromServer(data.user);
      onLogin(loggedIn);
    } catch {
      setLoginError('登录失败，或该用户已被禁用');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginName.trim() && loginPassword.trim()) {
      submitLogin(loginName.trim(), loginPassword.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-black">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/3 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md px-6">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">无界 AI</h1>
          <p className="text-gray-400 text-sm">AI 图像生成与协作平台</p>
        </div>

        {/* Login Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-xl font-semibold text-white mb-6">用户登录</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">用户名</label>
              <input
                type="text"
                value={loginName}
                onChange={e => setLoginName(e.target.value)}
                className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
                placeholder="请输入用户名"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">密码</label>
              <input
                type="password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
                placeholder="请输入密码"
              />
            </div>

            {loginError && (
              <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !loginName.trim() || !loginPassword.trim()}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? '登录中...' : '登录'}
            </button>
          </form>

          <p className="text-gray-500 text-xs text-center mt-6">
            请联系管理员创建新账户
          </p>
        </div>
      </div>
    </div>
  );
}
