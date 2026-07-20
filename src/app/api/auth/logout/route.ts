import { NextRequest, NextResponse } from 'next/server';
import { WUJIE_SESSION_COOKIE } from '@/lib/server-auth';

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  const isHttps = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  response.cookies.set(WUJIE_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: 0,
  });
  return response;
}
