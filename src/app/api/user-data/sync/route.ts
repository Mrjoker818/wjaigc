import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { dbGetUserData, dbSetUserData } from '@/lib/db-storage';
import { execSql } from '@/lib/db-client';
import { persistResultImage } from '@/lib/persist-result-image';
import { resolveAssetGraphMode } from '@/lib/asset-core/mode';
import { getAssetGraphReadStrategy, shouldWriteAssetShadow } from '@/lib/asset-core/canvas-adapter';
import {
  CanvasProjectSyncConflictError,
  executeCanvasProjectSync,
  executeLegacyCanvasProjectSync,
  readCanvasProjectRevision,
  readAssetV3Projects,
  type AssetGraphMappings,
} from '@/lib/asset-core/canvas-project-sync';
import type { Project } from '@/lib/user-types';
import type { AssetGraphMode } from '@/lib/asset-core/types';
import type { LegacyMediaPersistenceInput, LegacyMediaPersistenceResult } from '@/lib/asset-core/legacy-migration';
import { resolveCanvasKernelMode } from '@/lib/canvas-kernel/mode';

export const dynamic = 'force-dynamic';

// Allowed key prefixes for user data sync (prevent overwriting system data)
const ALLOWED_KEY_PREFIXES = ['projects', 'favorites', 'brand_', 'font_', 'canvas_', 'workflow_', 'settings_', 'theme_', 'custom_', 'chat_'];

function isKeyAllowed(key: string): boolean {
  return ALLOWED_KEY_PREFIXES.some(prefix => key.startsWith(prefix));
}

interface CanvasAssetGraphUpdate {
  assetId: string;
  versionId: string;
  placementId: string;
  url: string;
  sourceUrl: string | null;
  thumbnailUrl: string | null;
  mediaAvailability: Project['canvasImages'][number]['mediaAvailability'];
  mediaErrorCode: string | null;
  originalWidth: number;
  originalHeight: number;
}

function buildAssetGraphUpdates(
  projects: Project[],
  mappings: AssetGraphMappings,
): Record<string, Record<string, CanvasAssetGraphUpdate>> {
  const updates: Record<string, Record<string, CanvasAssetGraphUpdate>> = {};
  for (const project of projects) {
    const projectMappings = mappings[project.id];
    if (!projectMappings) continue;
    for (const image of project.canvasImages) {
      const mapping = projectMappings[image.id];
      if (!mapping) continue;
      (updates[project.id] ??= {})[image.id] = {
        assetId: mapping.assetId,
        versionId: mapping.versionId,
        placementId: mapping.placementId,
        url: image.url,
        sourceUrl: image.sourceUrl ?? null,
        thumbnailUrl: image.thumbnailUrl ?? null,
        mediaAvailability: image.mediaAvailability ?? 'ready',
        mediaErrorCode: image.mediaErrorCode ?? null,
        originalWidth: image.originalWidth,
        originalHeight: image.originalHeight,
      };
    }
  }
  return updates;
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

async function persistCanvasDataUrl(
  input: LegacyMediaPersistenceInput,
): Promise<LegacyMediaPersistenceResult> {
  if (!input.dataUrl.startsWith('data:image/')) {
    throw new Error('LEGACY_MEDIA_PERSIST_FAILED');
  }
  const url = await persistResultImage(input.dataUrl);
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) {
    throw new Error('LEGACY_MEDIA_PERSIST_FAILED');
  }
  return { url };
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

    let assetGraphMode: AssetGraphMode | undefined;
    const canvasKernelMode = resolveCanvasKernelMode(process.env.WUJIE_CANVAS_KERNEL_MODE);
    // Read the revision first: a concurrent commit between these reads yields
    // an older revision with newer data, which CAS rejects safely on write.
    const projectRevision = key === 'projects'
      ? await readCanvasProjectRevision(sessionUser.id)
      : undefined;
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
      assetGraphMode = resolveAssetGraphMode(process.env.WUJIE_ASSET_GRAPH_MODE);
      if (getAssetGraphReadStrategy(assetGraphMode) === 'asset-authoritative') {
        value = await readAssetV3Projects(sessionUser.id, value as Project[]);
      }
    }

    return NextResponse.json({
      success: true,
      key,
      value,
      canvasKernelMode,
      ...(assetGraphMode ? { assetGraphMode } : {}),
      ...(projectRevision === undefined ? {} : { projectRevision }),
    });
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

    const body = await request.json() as { key?: string; value?: unknown; projectRevision?: unknown };
    const key = body.key;
    if (!key) {
      return NextResponse.json({ success: false, error: 'Missing key parameter' }, { status: 400 });
    }
    if (!isKeyAllowed(key)) {
      return NextResponse.json({ success: false, error: 'Key not allowed' }, { status: 403 });
    }

    let value: unknown = body.value ?? null;
    const projectIdMap: Record<string, string> = {};
    let assetGraphMappings: AssetGraphMappings = {};
    let assetGraphUpdates: Record<string, Record<string, CanvasAssetGraphUpdate>> = {};
    let projectRevision: number | undefined;

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

      // 3. 强制设置所有项目的 userId 为当前会话用户（确保数据一致性）
      for (const p of (value as Record<string, unknown>[])) {
        p.userId = sessionUser.id;
      }
    }

    const assetGraphMode = resolveAssetGraphMode(process.env.WUJIE_ASSET_GRAPH_MODE);
    if (key === 'projects' && Array.isArray(value)) {
      if (!Number.isSafeInteger(body.projectRevision) || Number(body.projectRevision) < 0) {
        return NextResponse.json({
          success: false,
          error: 'Canvas project revision is required',
          currentRevision: await readCanvasProjectRevision(sessionUser.id),
        }, { status: 409 });
      }
      const syncProjectSnapshot = shouldWriteAssetShadow(assetGraphMode)
        ? executeCanvasProjectSync
        : executeLegacyCanvasProjectSync;
      const result = await syncProjectSnapshot({
        actorUserId: sessionUser.id,
        projects: value as Project[],
        expectedRevision: Number(body.projectRevision),
        persistMedia: persistCanvasDataUrl,
      });
      value = result.projects;
      if (shouldWriteAssetShadow(assetGraphMode)) {
        assetGraphMappings = result.mappings;
        assetGraphUpdates = buildAssetGraphUpdates(result.projects, result.mappings);
      }
      projectRevision = result.revision;
    } else if (!await dbSetUserData(sessionUser.id, key, value)) {
      throw new Error('Failed to write user data');
    }
    return NextResponse.json({
      success: true,
      key,
      projectIdMap,
      assetGraphMappings,
      assetGraphUpdates,
      ...(projectRevision === undefined ? {} : { projectRevision }),
    });
  } catch (error) {
    if (error instanceof CanvasProjectSyncConflictError) {
      return NextResponse.json({
        success: false,
        error: error.message,
        currentRevision: error.currentRevision,
      }, { status: 409 });
    }
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to write user data',
    }, { status: 500 });
  }
}
