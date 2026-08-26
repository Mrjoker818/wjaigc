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
import { resolveDeliveredWorkflowRendererMode } from '@/lib/workflow-renderer/mode';
import {
  SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES,
  validateSimpleChatProjects,
} from '@/lib/simple-chat-project-sync';
import {
  compareAndSetSimpleChatSnapshot,
  readSimpleChatSnapshot,
  SimpleChatSyncConflictError,
} from '@/lib/simple-chat-sync-server';
import type { SimpleChatProject } from '@/components/simple-chat/simple-chat-types';
import { errorResponse, getRequestId, withRequestId } from '@/lib/request-id';
import { logOperation } from '@/lib/op-log';

export const dynamic = 'force-dynamic';

// Allowed key prefixes for user data sync (prevent overwriting system data)
const ALLOWED_KEY_PREFIXES = ['projects', 'favorites', 'brand_', 'font_', 'canvas_', 'workflow_', 'settings_', 'theme_', 'custom_', 'chat_'];
const SIMPLE_CHAT_PROJECTS_KEY = 'chat_simple_projects';

interface UserDataSyncBody {
  key?: string;
  value?: unknown;
  projectRevision?: unknown;
  expectedRevision?: unknown;
}

class ChatSyncRequestError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly code: 'CHAT_SYNC_INVALID_REQUEST' | 'CHAT_SYNC_PAYLOAD_TOO_LARGE',
    message: string,
  ) {
    super(message);
  }
}

class DuplicateSyncKeyError extends Error {}

type SyncBodyKind = 'chat' | 'legacy' | 'ambiguous';

interface SyncBodyClassification {
  sizeGateKind?: SyncBodyKind;
  routingKind?: SyncBodyKind;
}

// Identify only the top-level key while retaining one copy of the raw stream.
// Fetch JSON parsing still owns the full parse after routing is known.
class SyncBodyKeySniffer {
  private depth = 0;
  private inString = false;
  private escaped = false;
  private stringRole: 'property' | 'key-value' | 'other' = 'other';
  private stringBytes: number[] = [];
  private stringOverflow = false;
  private expectProperty = false;
  private expectColon = false;
  private expectKeyValue = false;
  private pendingProperty: string | null = null;
  private keyCount = 0;
  private keyKind: Exclude<SyncBodyKind, 'ambiguous'> = 'legacy';
  private preambleState: 'start' | 'bom-ef' | 'bom-ef-bb' | 'done' = 'start';
  // Size gating may classify the first key early; routing waits for a duplicate-safe root close.
  private sizeGateKind: SyncBodyKind | undefined;
  private routingKind: SyncBodyKind | undefined;

  feed(chunk: Uint8Array): SyncBodyClassification {
    for (const byte of chunk) {
      if (this.routingKind) break;
      this.consume(byte);
    }
    return { sizeGateKind: this.sizeGateKind, routingKind: this.routingKind };
  }

  private consume(byte: number): void {
    if (this.depth === 0 && this.preambleState !== 'done' && this.consumePreamble(byte)) {
      return;
    }

    if (this.inString) {
      if (this.stringRole !== 'other' && !this.stringOverflow) {
        if (this.stringBytes.length < 128) this.stringBytes.push(byte);
        else this.stringOverflow = true;
      }
      if (this.escaped) {
        this.escaped = false;
      } else if (byte === 0x5c) {
        this.escaped = true;
      } else if (byte === 0x22) {
        this.closeString();
      }
      return;
    }

    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) return;

    if (this.depth === 0) {
      if (byte === 0x7b) {
        this.depth = 1;
        this.expectProperty = true;
      } else {
        this.routingKind = 'legacy';
      }
      return;
    }

    if (this.depth === 1 && this.expectProperty) {
      if (byte === 0x7d) {
        this.resolveKeyKind();
      } else if (byte === 0x22) {
        this.openString('property');
        this.expectProperty = false;
      } else {
        this.routingKind = 'legacy';
      }
      return;
    }

    if (this.depth === 1 && this.expectColon) {
      if (byte !== 0x3a) {
        this.routingKind = 'legacy';
        return;
      }
      this.expectColon = false;
      this.expectKeyValue = this.pendingProperty === 'key';
      return;
    }

    if (this.depth === 1 && this.expectKeyValue) {
      if (byte === 0x22) this.openString('key-value');
      else {
        this.keyKind = 'legacy';
        this.sizeGateKind = 'legacy';
      }
      this.expectKeyValue = false;
      return;
    }

    if (byte === 0x22) {
      this.openString('other');
    } else if (byte === 0x7b || byte === 0x5b) {
      this.depth++;
    } else if (byte === 0x7d || byte === 0x5d) {
      if (this.depth === 1) this.resolveKeyKind();
      else this.depth--;
    } else if (byte === 0x2c && this.depth === 1) {
      this.expectProperty = true;
      this.pendingProperty = null;
    }
  }

  private consumePreamble(byte: number): boolean {
    if (this.preambleState === 'start') {
      if (byte === 0xef) {
        this.preambleState = 'bom-ef';
        return true;
      }
      this.preambleState = 'done';
      return false;
    }
    if (this.preambleState === 'bom-ef' && byte === 0xbb) {
      this.preambleState = 'bom-ef-bb';
      return true;
    }
    if (this.preambleState === 'bom-ef-bb' && byte === 0xbf) {
      this.preambleState = 'done';
      return true;
    }
    this.routingKind = 'legacy';
    return true;
  }

  private resolveKeyKind(): void {
    this.routingKind = this.keyCount > 1 ? 'ambiguous' : this.keyKind;
  }

  private openString(role: 'property' | 'key-value' | 'other'): void {
    this.inString = true;
    this.escaped = false;
    this.stringRole = role;
    this.stringBytes = [];
    this.stringOverflow = false;
  }

  private closeString(): void {
    this.inString = false;
    if (this.stringRole === 'other') return;

    const rawBytes = this.stringBytes.slice(0, -1);
    let value: string | null = null;
    if (!this.stringOverflow) {
      try {
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(rawBytes));
        value = JSON.parse(`"${raw}"`) as string;
      } catch {
        value = null;
      }
    }

    if (this.stringRole === 'property') {
      this.pendingProperty = value;
      if (value === 'key') {
        this.keyCount++;
        if (this.keyCount > 1) {
          this.sizeGateKind = 'ambiguous';
          this.routingKind = 'ambiguous';
        }
      }
      this.expectColon = true;
    } else {
      this.keyKind = value === SIMPLE_CHAT_PROJECTS_KEY ? 'chat' : 'legacy';
      this.sizeGateKind = this.keyKind;
    }
  }
}

async function parseBufferedJson(chunks: Uint8Array[]): Promise<UserDataSyncBody> {
  let chunkIndex = 0;
  const replay = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[chunkIndex++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  return await new Response(replay).json() as UserDataSyncBody;
}

async function readSyncBody(request: NextRequest): Promise<UserDataSyncBody> {
  if (!request.body) {
    throw new ChatSyncRequestError(400, 'CHAT_SYNC_INVALID_REQUEST', 'Request body is required');
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  const keySniffer = new SyncBodyKeySniffer();
  let sizeGateKind: SyncBodyKind | undefined;
  let bodyKind: SyncBodyKind | undefined;
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      chunks.push(value);
      const classification = keySniffer.feed(value);
      sizeGateKind = classification.sizeGateKind;
      bodyKind = classification.routingKind;
      if (sizeGateKind === 'chat' && totalBytes > SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The payload result must not depend on stream cancellation support.
        }
        throw new ChatSyncRequestError(
          413,
          'CHAT_SYNC_PAYLOAD_TOO_LARGE',
          'Simple chat sync payload exceeds 20 MiB',
        );
      }
    }
  } catch (error) {
    if (error instanceof ChatSyncRequestError) throw error;
    if (bodyKind === 'legacy') throw error;
    throw new ChatSyncRequestError(400, 'CHAT_SYNC_INVALID_REQUEST', 'Unable to read request body');
  } finally {
    reader.releaseLock();
  }

  if (bodyKind === 'ambiguous') {
    throw new DuplicateSyncKeyError('Duplicate key parameter');
  }

  try {
    const parsed: unknown = await parseBufferedJson(chunks);
    if (bodyKind === 'legacy') return parsed as UserDataSyncBody;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Request body must be an object');
    }
    return parsed as UserDataSyncBody;
  } catch (error) {
    if (bodyKind === 'legacy') throw error;
    throw new ChatSyncRequestError(400, 'CHAT_SYNC_INVALID_REQUEST', 'Request body must be valid JSON');
  }
}

function auditSimpleChatSync(input: {
  userId: string;
  userName?: string;
  action: 'read' | 'write' | 'conflict';
  revision: number;
  operationCount: number;
  durationMs: number;
  responseStatus: number;
  status: 'success' | 'conflict' | 'error';
  errorCode?: string;
}): void {
  try {
    logOperation({
      userId: input.userId,
      userName: input.userName,
      action: `simple_chat_sync_${input.action}`,
      targetType: 'simple_chat_projects',
      level: input.status === 'success' ? 'info' : 'warn',
      responseStatus: input.responseStatus,
      durationMs: input.durationMs,
      requestData: {
        revision: input.revision,
        operationCount: input.operationCount,
        status: input.status,
        ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      },
    });
  } catch {
    // Auditing is best-effort and cannot change the sync result.
  }
}

function invalidChatSyncResponse(
  requestId: string,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return errorResponse(400, code, message, requestId, false, extra);
}

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

    if (key === SIMPLE_CHAT_PROJECTS_KEY) {
      const startedAt = Date.now();
      const requestId = getRequestId(request);
      let snapshot;
      try {
        snapshot = await readSimpleChatSnapshot(sessionUser.id);
      } catch {
        const errorCode = 'CHAT_SYNC_READ_FAILED';
        auditSimpleChatSync({
          userId: sessionUser.id,
          userName: sessionUser.name,
          action: 'read',
          revision: 0,
          operationCount: 0,
          durationMs: Math.max(0, Date.now() - startedAt),
          responseStatus: 500,
          status: 'error',
          errorCode,
        });
        return errorResponse(
          500,
          errorCode,
          'Failed to read simple chat projects',
          requestId,
          false,
        );
      }
      auditSimpleChatSync({
        userId: sessionUser.id,
        userName: sessionUser.name,
        action: 'read',
        revision: snapshot.revision,
        operationCount: 0,
        durationMs: Math.max(0, Date.now() - startedAt),
        responseStatus: 200,
        status: 'success',
      });
      return withRequestId(NextResponse.json({
        success: true,
        key,
        value: snapshot.projects,
        syncRevision: snapshot.revision,
      }), requestId);
    }

    let assetGraphMode: AssetGraphMode | undefined;
    const canvasKernelMode = resolveCanvasKernelMode(process.env.WUJIE_CANVAS_KERNEL_MODE);
    // Stage 4 Task 3 only rolls out the read-only shadow. React Flow v2 remains disabled.
    const workflowRendererMode = resolveDeliveredWorkflowRendererMode(process.env.WUJIE_WORKFLOW_RENDERER_MODE);
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
      workflowRendererMode,
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
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 });
    }

    let body: UserDataSyncBody;
    try {
      body = await readSyncBody(request);
    } catch (error) {
      if (error instanceof ChatSyncRequestError) {
        return errorResponse(error.status, error.code, error.message, requestId, false);
      }
      if (error instanceof DuplicateSyncKeyError) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
      }
      throw error;
    }
    const key = body.key;
    if (!key) {
      return NextResponse.json({ success: false, error: 'Missing key parameter' }, { status: 400 });
    }
    if (!isKeyAllowed(key)) {
      return NextResponse.json({ success: false, error: 'Key not allowed' }, { status: 403 });
    }

    if (key === SIMPLE_CHAT_PROJECTS_KEY) {
      const operationCount = Array.isArray(body.value) ? body.value.length : 0;
      if (
        !Number.isSafeInteger(body.expectedRevision)
        || Number(body.expectedRevision) < 0
        || Number(body.expectedRevision) >= Number.MAX_SAFE_INTEGER
      ) {
        return invalidChatSyncResponse(
          requestId,
          'CHAT_SYNC_INVALID_REVISION',
          'A safe non-negative expectedRevision is required',
        );
      }

      const validation = validateSimpleChatProjects(body.value as SimpleChatProject[]);
      if (!validation.success) {
        return invalidChatSyncResponse(
          requestId,
          validation.code,
          'Invalid simple chat projects',
          {
            field: validation.field,
            ...('limit' in validation && validation.limit !== undefined
              ? { limit: validation.limit }
              : {}),
            ...('actual' in validation && validation.actual !== undefined
              ? { actual: validation.actual }
              : {}),
          },
        );
      }

      try {
        const snapshot = await compareAndSetSimpleChatSnapshot({
          userId: sessionUser.id,
          expectedRevision: Number(body.expectedRevision),
          projects: body.value as SimpleChatProject[],
        });
        auditSimpleChatSync({
          userId: sessionUser.id,
          userName: sessionUser.name,
          action: 'write',
          revision: snapshot.revision,
          operationCount,
          durationMs: Math.max(0, Date.now() - startedAt),
          responseStatus: 200,
          status: 'success',
        });
        return withRequestId(NextResponse.json({
          success: true,
          key,
          syncRevision: snapshot.revision,
        }), requestId);
      } catch (error) {
        if (error instanceof SimpleChatSyncConflictError) {
          auditSimpleChatSync({
            userId: sessionUser.id,
            userName: sessionUser.name,
            action: 'conflict',
            revision: error.currentRevision,
            operationCount,
            durationMs: Math.max(0, Date.now() - startedAt),
            responseStatus: 409,
            status: 'conflict',
            errorCode: error.code,
          });
          return errorResponse(
            409,
            error.code,
            error.message,
            requestId,
            true,
            { currentRevision: error.currentRevision },
          );
        }
        const errorCode = 'CHAT_SYNC_WRITE_FAILED';
        auditSimpleChatSync({
          userId: sessionUser.id,
          userName: sessionUser.name,
          action: 'write',
          revision: Number(body.expectedRevision),
          operationCount,
          durationMs: Math.max(0, Date.now() - startedAt),
          responseStatus: 500,
          status: 'error',
          errorCode,
        });
        return errorResponse(
          500,
          errorCode,
          'Failed to write simple chat projects',
          requestId,
          false,
        );
      }
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
