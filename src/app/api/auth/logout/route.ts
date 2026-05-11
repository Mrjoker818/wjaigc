import { NextRequest, NextResponse } from 'next/server';
import { WUJIE_SESSION_COOKIE } from '@/lib/server-auth';

export async function POST(_request: NextRequest) {
  const response = NextResponse.json({ success: true });
  response.cookies.set(WUJIE_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
