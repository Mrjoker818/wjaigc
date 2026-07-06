import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/api-auth';
import { dbGetCredits, dbInitCredits } from '@/lib/db-storage';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) {
    return NextResponse.json({ success: false, error: '登录已失效，请重新登录' }, { status: 401 });
  }
  const credits = await dbGetCredits(auth.user.id) || await dbInitCredits(auth.user.id);
  return NextResponse.json({
    success: true,
    user: {
      id: auth.user.id,
      name: auth.user.name,
      role: auth.user.role,
      status: auth.user.status,
    },
    credits: {
      balance: Number(credits?.balance || 0),
      totalRecharged: Number(credits?.total_recharged || 0),
      totalUsed: Number(credits?.total_used || 0),
    },
    authSource: auth.source,
  });
}