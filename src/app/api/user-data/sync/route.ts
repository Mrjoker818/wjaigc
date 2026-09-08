import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { dbGetUserData, dbSetUserData, dbSetProjectsWithDeletionTombstones } from '@/lib/db-storage';
import { execSql } from '@/lib/db-client';

export const dynamic = 'force-dynamic';

// Allowed key prefixes for user data sync (prevent overwriting system data)
const ALLOWED_KEY_PREFIXES = ['projects', 'favorites', 'brand_', 'font_', 'canvas_', 'workflow_', 'settings_', 'theme_', 'custom_', 'chat_'];

// 删除墓碑的数据键（与 projects 键同库存储，服务端持久防线）
const TOMBSTONE_PROJECT_KEY = 'deletedProjectIds';
const TOMBSTONE_IMAGE_KEY = 'deletedImageIds';

function isKeyAllowed(key: string): boolean {
  return ALLOWED_KEY_PREFIXES.some(prefix => key.startsWith(prefix));
}

/** 解析墓碑键为合法的 ID 数组 */
function parseTombstoneIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
}

/** 读取当前用户的删除墓碑（projects + images），读取失败不阻塞主流程 */
async function readDeletionTombstones(userId: string): Promise<{ projectIds: string[]; imageIds: string[] }> {
  try {
    const [projectRaw, imageRaw] = await Promise.all([
      dbGetUserData(userId, TOMBSTONE_PROJECT_KEY),
      dbGetUserData(userId, TOMBSTONE_IMAGE_KEY),
    ]);
    return {
      projectIds: parseTombstoneIds(projectRaw),
      imageIds: parseTombstoneIds(imageRaw),
    };
  } catch (error) {
    console.warn('[Sync] readDeletionTombstones failed (non-blocking):', error);
    return { projectIds: [], imageIds: [] };
  }
}

/** 按墓碑过滤项目列表（过滤已删项目 + 项目内已删图片），不回写数据库 */
function applyTombstoneFilter(
  projects: unknown[],
  tombstones: { projectIds: string[]; imageIds: string[] },
): unknown[] {
  if (tombstones.projectIds.length === 0 && tombstones.imageIds.length === 0) return projects;
  const deletedProjectSet = new Set(tombstones.projectIds);
  const deletedImageSet = new Set(tombstones.imageIds);
  const filterImages = (images: unknown): unknown => Array.isArray(images)
    ? images.filter((image) => !deletedImageSet.has(String((image as Record<string, unknown>)?.id)))
    : images;
  return projects
    .filter((p) => !deletedProjectSet.has(String((p as Record<string, unknown>).id)))
    .map((p) => {
      const record = p as Record<string, unknown>;
      // canvasImages 是当前主字段，images 是历史兼容字段
      if ('canvasImages' in record) record.canvasImages = filterImages(record.canvasImages);
      if ('images' in record) record.images = filterImages(record.images);
      return record;
    });
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
    // 注意：GET 请求只过滤响应数据，不回写数据库，避免永久删除用户数据
    if (key === 'projects' && Array.isArray(value)) {
      const before = (value as unknown[]).length;
      value = filterProjectsForUser(value, sessionUser.id);

      // 【跨用户项目ID冲突检测】仅记录警告，不删除数据
      // 如果项目 ID 同时存在于其他用户记录中，可能是历史迁移导致，
      // 不应在 GET 请求中永久删除数据。冲突将在 POST 同步时由客户端覆盖解决。
      const projectIds = (value as unknown[]).map((p) => String((p as Record<string, unknown>).id));
      const conflictingIds = await findProjectIdsOwnedByOtherUsers(projectIds, sessionUser.id);
      if (conflictingIds.size > 0) {
        console.warn(`[Sync] GET projects: detected ${conflictingIds.size} cross-user project ID conflicts (${[...conflictingIds].join(', ')}) for user ${sessionUser.id} — skipping, not deleting`);
      }

      const removed = before - (value as unknown[]).length;
      if (removed > 0) {
        console.warn(`[Sync] GET projects: filtered out ${removed} cross-user projects for user ${sessionUser.id} (response only, not persisted)`);
      }

      // ★ 服务端删除墓碑防线：过滤已删除的项目和图片（跨设备/刷新后旧数据不得复活），
      // 并把墓碑返回给客户端，用于其本地过滤与合并
      const tombstones = await readDeletionTombstones(sessionUser.id);
      const beforeTombstone = (value as unknown[]).length;
      value = applyTombstoneFilter(value as unknown[], tombstones);
      if ((value as unknown[]).length < beforeTombstone) {
        console.warn(`[Sync] GET projects: filtered out ${beforeTombstone - (value as unknown[]).length} tombstoned projects for user ${sessionUser.id} (response only)`);
      }
      return NextResponse.json({
        success: true,
        key,
        value,
        deletedProjectIds: tombstones.projectIds,
        deletedImageIds: tombstones.imageIds,
      });
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

    const body = await request.json() as {
      key?: string;
      value?: unknown;
      deletedProjectIds?: unknown;
      deletedImageIds?: unknown;
    };
    const key = body.key;
    if (!key) {
      return NextResponse.json({ success: false, error: 'Missing key parameter' }, { status: 400 });
    }
    if (!isKeyAllowed(key)) {
      return NextResponse.json({ success: false, error: 'Key not allowed' }, { status: 403 });
    }

    let value: unknown = body.value ?? null;
    const projectIdMap: Record<string, string> = {};

    // 【数据隔离】对 projects 类型数据做服务端验证和清洗
    // 1. 强制过滤只保留属于当前会话用户的项目
    if (key === 'projects' && Array.isArray(value)) {
      const before = (value as unknown[]).length;
      value = filterProjectsForUser(value, sessionUser.id);
      const removed = before - (value as unknown[]).length;
      if (removed > 0) {
        console.warn(`[Sync] POST projects: rejected ${removed} cross-user projects for user ${sessionUser.id}`);
      }

      // 2. 跨用户项目ID冲突检测：重新分配冲突项目的 ID，而不是删除
      // 同一项目 ID 可能因历史迁移出现在多个用户下，重新分配 ID 保留数据
      const projectIds = (value as unknown[]).map((p) => String((p as Record<string, unknown>).id));
      const conflictingIds = await findProjectIdsOwnedByOtherUsers(projectIds, sessionUser.id);
      if (conflictingIds.size > 0) {
        let reassigned = 0;
        const reassignmentNonce = Date.now();
        for (const [index, p] of (value as Record<string, unknown>[]).entries()) {
          const id = String(p.id);
          if (conflictingIds.has(id)) {
            // 重新分配项目 ID：添加当前用户 ID 后缀避免冲突，并把最终映射返回客户端。
            const oldId = id;
            const newId = `${id}__${sessionUser.id}_${reassignmentNonce}_${index}`;
            p.id = newId;
            if (p.groupId === oldId) p.groupId = newId;
            projectIdMap[oldId] = newId;
            reassigned++;
          }
        }
        if (reassigned > 0) {
          console.warn(`[Sync] POST projects: reassigned ${reassigned} conflicting project IDs for user ${sessionUser.id} (was: ${[...conflictingIds].join(', ')})`);
        }
      }

      // 3. 对删除墓碑执行服务端原子过滤。删除 ID 会和数据库已保存的墓碑合并，
      // 然后在同一个事务中更新项目列表，防止旧标签页或乱序请求重新写回已删除内容。
      const deletedProjectIds = Array.isArray(body.deletedProjectIds)
        ? body.deletedProjectIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
      const deletedImageIds = Array.isArray(body.deletedImageIds)
        ? body.deletedImageIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];

      const persisted = await dbSetProjectsWithDeletionTombstones(
        sessionUser.id,
        value,
        deletedProjectIds,
        deletedImageIds,
      );
      return NextResponse.json({
        success: true,
        key,
        value: persisted.projects,
        projectIdMap,
        deletionTombstones: {
          projectIds: persisted.projectTombstones,
          imageIds: persisted.imageTombstones,
        },
      });
    }

    await dbSetUserData(sessionUser.id, key, value);
    return NextResponse.json({ success: true, key, projectIdMap });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to write user data',
    }, { status: 500 });
  }
}
