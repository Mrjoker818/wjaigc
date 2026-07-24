import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, updateManagedUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/user/change-password
 * 用户修改自己的密码（需要登录）
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const body = await request.json() as { newPassword?: string };
    const newPassword = String(body.newPassword || '').trim();

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json({ success: false, error: '密码至少需要6个字符' }, { status: 400 });
    }

    // 更新用户密码（自动哈希处理）
    const updated = await updateManagedUser(user.id, { password: newPassword });

    if (!updated) {
      return NextResponse.json({ success: false, error: '密码修改失败' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: '密码修改成功' });
  } catch (error) {
    console.error('[user/change-password] Error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误，请稍后重试' },
      { status: 500 }
    );
  }
}
