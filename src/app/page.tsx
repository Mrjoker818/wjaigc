'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { User } from '@/lib/user-types';
import { fetchSessionPayload } from '@/lib/auth-session';
import { LoginPanel } from '@/components/dashboard/login-panel';
import { Toaster } from '@/components/ui/sonner';
import { UserManager as UserManagerCore } from '@/lib/user-manager';

const CanvasWorkspace = dynamic(
  () => import('@/components/canvas-workspace').then(m => m.CanvasWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0a0a0a]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
          <p className="text-white/60 text-sm">正在加载工作台...</p>
        </div>
      </div>
    ),
  }
);

export default function Home() {
  const [authChecked, setAuthChecked] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Check session on mount
  useEffect(() => {
    let cancelled = false;
    const checkSession = async () => {
      try {
        const data = await fetchSessionPayload();
        if (!cancelled && data.success && data.user) {
          setCurrentUser(data.user);
        }
      } catch {
        // No session - stay on login
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    };
    checkSession();
    return () => { cancelled = true; };
  }, []);

  const handleLogin = useCallback(async (user: User, productType?: string) => {
    // Chat mode: redirect to /simple-chat
    if (productType === 'chat') {
      setCurrentUser(user);
      window.location.href = '/simple-chat';
      return;
    }

    // Canvas mode: load projects then enter workspace
    try {
      await UserManagerCore.getInstance().loadProjectsFromServer();
    } catch { /* non-blocking */ }
    setCurrentUser(user);
  }, []);

  // Show loading while checking session
  if (!authChecked) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0a0a0a]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
          <p className="text-white/60 text-sm">正在验证身份...</p>
        </div>
      </div>
    );
  }

  // Not authenticated: render LoginPanel (lightweight, fast hydration!)
  if (!currentUser) {
    return (
      <>
        <LoginPanel onLogin={handleLogin} />
        <Toaster
          position="top-center"
          toastOptions={{
            className: 'bg-[#1a1a1a] border border-[#2a2a2a] text-white shadow-lg shadow-black/30',
            style: { borderRadius: '12px', fontSize: '13px' },
          }}
        />
      </>
    );
  }

  // Authenticated: dynamically load the heavy canvas workspace
  return <CanvasWorkspace initialUser={currentUser} />;
}
