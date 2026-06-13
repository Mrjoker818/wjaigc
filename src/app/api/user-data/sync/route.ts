import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { dbGetUserData, dbSetUserData } from '@/lib/db-storage';
import { execSql } from '@/lib/db-client';

export const dynamic = 'force-dynamic';

// Allowed key prefixes for user data sync (prevent overwriting system data)
const ALLOWED_KEY_PREFIXES = ['projects', 'favorites', 'brand_', 'font_', 'canvas_', 'workflow_', 'settings_', 'theme_', 'custom_'];

function isKeyAllowed(key: string): boolean {
  return ALLOWED_KEY_PREFIXES.some(prefix => key.startsWith(prefix));
}

/**
 * Filter projects to only include those belonging to the specified userId.
 * Strict isolation: only keep projects where userId matches the session user.
 * Projects with missing userId are assigned the session user's ID (historical data compat).
 * Projects with a different userId are REJECTED (cross-user data leak).
 */
function filterProjectsForUser(projects: unknown[], userId: string): unknown[] {
  if (!Array.isArray(projects)) return [];
  return projects.filter((p): p is Record<string, unknown> => {
    if (!p || typeof p !== 'object') return false;
    const pUserId = (p as Record<string, unknown>).userId;
    if (!pUserId) {
      (p as Record<string, unknown>).userId = userId;
      return true;
    }
    return String(pUserId) === userId;
  });
}

/**
 * Detect project IDs that already exist under OTHER users' records.
 * This prevents a project from being duplicated across user accounts.
 * Returns a Set of project IDs that are owned by other users.
 */
async function findProjectIdsOwnedByOtherUsers(projectIds: string[], currentUserId: string): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();

  try {
    // Query all OTHER users' project data to find conflicting project IDs
    const result = await execSql(
      `SELECT user_id, data_value FROM wujie_user_data WHERE data_key = 'projects' AND user_id != $1`,
      [currentUserId]
    );

    const conflictingIds = new Set<string>();
    for (const row of result.rows) {
      try {
        // data_value is jsonb, so it's already parsed
        const projects = row.data_value;
        if (Array.isArray(projects)) {
          for (const p of projects) {
            if (p && typeof p === 'object' && p.id && projectIds.includes(String(p.id))) {
              conflictingIds.add(String(p.id));
            }
          }
        }
      } catch { /* skip malformed data */ }
    }
    return conflictingIds;
  } catch (error) {
    console.error('[Sync] Failed to check cross-user project conflicts:', error);
    // On error, don't block the sync — just log and continue
    return new Set();
  }
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

      // 【跨用户项目ID冲突检测】检查当前用户的项目是否也存在于其他用户记录中
      const projectIds = (value as unknown[]).map((p) => String((p as Record<string, unknown>).id));
      const conflictingIds = await findProjectIdsOwnedByOtherUsers(projectIds, sessionUser.id);
      if (conflictingIds.size > 0) {
        const beforeConflict = (value as unknown[]).length;
        // 移除与其他用户冲突的项目（这些项目可能是在数据隔离修复前被错误同步的）
        value = (value as unknown[]).filter((p) => {
          const id = String((p as Record<string, unknown>).id);
          return !conflictingIds.has(id);
        });
        const removedConflict = beforeConflict - (value as unknown[]).length;
        if (removedConflict > 0) {
          console.warn(`[Sync] GET projects: removed ${removedConflict} cross-user conflicting projects (${[...conflictingIds].join(', ')}) for user ${sessionUser.id}`);
          // 回写清理后的数据，避免下次再读到脏数据
          await dbSetUserData(sessionUser.id, key, value);
        }
      }

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
    // 1. 强制过滤只保留属于当前会话用户的项目
    if (key === 'projects' && Array.isArray(value)) {
      const before = (value as unknown[]).length;
      value = filterProjectsForUser(value, sessionUser.id);
      const removed = before - (value as unknown[]).length;
      if (removed > 0) {
        console.warn(`[Sync] POST projects: rejected ${removed} cross-user projects for user ${sessionUser.id}`);
      }

      // 2. 跨用户项目ID冲突检测：拒绝已存在于其他用户记录中的项目
      const projectIds = (value as unknown[]).map((p) => String((p as Record<string, unknown>).id));
      const conflictingIds = await findProjectIdsOwnedByOtherUsers(projectIds, sessionUser.id);
      if (conflictingIds.size > 0) {
        const beforeConflict = (value as unknown[]).length;
        value = (value as unknown[]).filter((p) => {
          const id = String((p as Record<string, unknown>).id);
          return !conflictingIds.has(id);
        });
        const removedConflict = beforeConflict - (value as unknown[]).length;
        if (removedConflict > 0) {
          console.warn(`[Sync] POST projects: rejected ${removedConflict} cross-user conflicting projects for user ${sessionUser.id}`);
        }
      }

      // 3. 强制设置所有项目的 userId 为当前会话用户（确保数据一致性）
      for (const p of (value as Record<string, unknown>[])) {
        p.userId = sessionUser.id;
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
