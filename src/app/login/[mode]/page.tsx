'use client';

import { use, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoginPanel } from '@/components/dashboard/login-panel';
import type { User } from '@/lib/user-types';

type LoginMode = 'canvas' | 'chat';

interface LoginPageProps {
  params: Promise<{ mode: string }>;
}

function resolveMode(mode: string): LoginMode | null {
  return mode === 'canvas' || mode === 'chat' ? mode : null;
}

export default function LoginPage({ params }: LoginPageProps) {
  const router = useRouter();
  const { mode } = use(params);
  const loginMode = resolveMode(mode);

  useEffect(() => {
    if (!loginMode) router.replace('/');
  }, [loginMode, router]);

  const handleLogin = useCallback((user: User, productType: string): void => {
    void user;
    router.replace(productType === 'chat' ? '/simple-chat' : '/');
  }, [router]);

  if (!loginMode) return null;

  return <LoginPanel initialMode={loginMode} onLogin={handleLogin} />;
}
