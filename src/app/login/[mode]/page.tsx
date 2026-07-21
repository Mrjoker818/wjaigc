import { redirect } from 'next/navigation';
import { LoginPanel } from '@/components/dashboard/login-panel';

type LoginMode = 'canvas' | 'chat';

interface LoginPageProps {
  params: Promise<{ mode: string }>;
}

function resolveMode(mode: string): LoginMode | null {
  return mode === 'canvas' || mode === 'chat' ? mode : null;
}

export default async function LoginPage({ params }: LoginPageProps) {
  const { mode } = await params;
  const loginMode = resolveMode(mode);

  if (!loginMode) redirect('/');

  return <LoginPanel initialMode={loginMode} />;
}
