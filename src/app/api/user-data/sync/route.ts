import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { dbGetUserData, dbSetUserData } from '@/lib/db-storage';

export const dynamic = 'force-dynamic';

// Allowed key prefixes for user data sync (prevent overwriting system data)
const ALLOWED_KEY_PREFIXES = ['projects', 'favorites', 'brand_', 'font_', 'canvas_', 'workflow_', 'settings_', 'theme_', 'custom_'];

function isKeyAllowed(key: string): boolean {
  return ALLOWED_KEY_PREFIXES.some(prefix => key.startsWith(prefix));
}

/**
 * Filter projects to only include those belonging to the specified userId.
 * Also force-set userId on projects that are missing it (historical data).
 * This is the server-side data isolation gate — the single source of truth.
 */
function filterProjectsForUser(projects: unknown[], userId: string): unknown[] {
  if (!Array.isArray(projects)) return [];
  return projects.filter((p): p is Record<string, unknown> => {
    if (!p || typeof p !== 'object') return false;
    const pUserId = (p as Record<string, unknown>).userId;
    // 严格隔离：只保留属于该用户的项目
    // - 有 userId 且匹配 → 保留
    // - 无 userId → 补上当前用户ID后保留（历史数据兼容）
    // - 有 userId 但不匹配 → 拒绝（跨用户数据泄露）
    if (!pUserId) {
      (p as Record<string, unknown>).userId = userId;
      return true;
    }
    return String(pUserId) === userId;
  });
}

/**
 * GET /api/user-data/sync?key=projects
 * Read user data from database (fallback to empty)
 */
export async function GET(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 });
    }

    const key = request.nextUrl.searchParams.get('key');
    if (!key) {
      return NextResponse.json({ success: false, error: 'Missing key parameter' }, { status: 400 });
    }
    if (!isKeyAllowed(key)) {
      return NextResponse.json({ success: false, error: 'Key not allowed' }, { status: 403 });
    }

    let value: unknown = await dbGetUserData(sessionUser.id, key);

    // 【数据隔离】对 projects 类型数据做服务端过滤，防止跨用户数据泄漏
    if (key === 'projects' && Array.isArray(value)) {
      const before = (value as unknown[]).length;
      value = filterProjectsForUser(value, sessionUser.id);
      const removed = before - (value as unknown[]).length;
      if (removed > 0) {
        console.warn(`[Sync] GET projects: filtered out ${removed} cross-user projects for user ${sessionUser.id}`);
        // 回写清理后的数据，避免下次再读到脏数据
        await dbSetUserData(sessionUser.id, key, value);
      }
    }

    return NextResponse.json({ success: true, key, value });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read user data',
    }, { status: 500 });
  }
}

/**
 * POST /api/user-data/sync
 * Write user data to database
 * Body: { key: string, value: any }
 */
export async function POST(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 });
    }

    const body = await request.json() as { key?: string; value?: unknown };
    const key = body.key;
    if (!key) {
      return NextResponse.json({ success: false, error: 'Missing key parameter' }, { status: 400 });
    }
    if (!isKeyAllowed(key)) {
      return NextResponse.json({ success: false, error: 'Key not allowed' }, { status: 403 });
    }

    let value: unknown = body.value ?? null;

    // 【数据隔离】对 projects 类型数据做服务端验证和清洗
    // 强制设置所有项目的 userId 为当前会话用户，拒绝非当前用户的项目
    if (key === 'projects' && Array.isArray(value)) {
      const before = (value as unknown[]).length;
      value = filterProjectsForUser(value, sessionUser.id);
      const removed = before - (value as unknown[]).length;
      if (removed > 0) {
        console.warn(`[Sync] POST projects: rejected ${removed} cross-user projects for user ${sessionUser.id}`);
      }
    }

    await dbSetUserData(sessionUser.id, key, value);
    return NextResponse.json({ success: true, key });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to write user data',
    }, { status: 500 });
  }
}
