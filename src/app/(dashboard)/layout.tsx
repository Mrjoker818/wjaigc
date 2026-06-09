'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { DashboardSidebar } from '@/components/dashboard/sidebar';
import { UserManager } from '@/lib/user-manager';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const um = UserManager.getInstance();
    const currentUser = um.getUser();
    if (currentUser) {
      setIsAuthenticated(true);
    }
    setAuthChecked(true);
  }, []);

  // Listen for storage changes (logout from another tab etc.)
  useEffect(() => {
    const handleStorage = () => {
      const um = UserManager.getInstance();
      const currentUser = um.getUser();
      setIsAuthenticated(!!currentUser);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  if (!authChecked) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground text-sm">正在验证身份...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-[#0a0a0a] via-[#111] to-[#0d0d0d]">
        <div className="flex flex-col items-center gap-8">
          <div className="relative">
            <div className="absolute -inset-4 bg-primary/10 rounded-3xl blur-2xl" />
            <h1 className="relative text-3xl font-bold text-foreground tracking-wide">无界 AI</h1>
          </div>
          <p className="text-muted-foreground text-sm tracking-wider">请先登录以访问工作台</p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowLogin(true)}
              className="px-8 py-3 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground font-semibold rounded-xl hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all cursor-pointer"
            >
              登录 / 注册
            </button>
            <button
              onClick={() => router.push('/')}
              className="px-8 py-3 bg-muted text-foreground font-semibold rounded-xl hover:bg-muted/80 transition-all cursor-pointer"
            >
              返回首页
            </button>
          </div>

          {showLogin && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="bg-card rounded-xl shadow-float p-6 w-full max-w-sm border border-border">
                <h2 className="text-lg font-semibold text-foreground mb-4">登录</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  请在主页面完成登录后，再访问工作台。
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => router.push('/')}
                    className="flex-1 h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer"
                  >
                    前往主页登录
                  </button>
                  <button
                    onClick={() => setShowLogin(false)}
                    className="flex-1 h-10 rounded-md bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <DashboardSidebar />
      <main className="flex-1 min-w-0 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
