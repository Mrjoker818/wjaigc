/**
 * 操作日志中间件
 * 自动记录关键API操作（成功/失败）到 wujie_audit_log 表
 *
 * 使用方式：
 * 1. 在API路由中调用 withOpLog() 包装处理逻辑
 * 2. 或手动调用 logOperation() / logError() 记录
 */

import { dbAddAuditLog } from './db-storage';
import type { DbAuditLog } from './db-storage';

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export interface OpLogEntry {
  userId: string;
  userName?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: string;
  level?: DbAuditLog['level'];
  errorMessage?: string;
  stackTrace?: string;
  requestData?: Record<string, unknown>;
  responseStatus?: number;
  durationMs?: number;
  model?: string;
  providerId?: string;
}

// ─── 操作类型常量 ────────────────────────────────────────────────────────────

export const OP_ACTIONS = {
  // 图像操作
  IMAGE_GENERATE: 'image_generate',
  IMAGE_EDIT: 'image_edit',
  IMAGE_UPSCALE: 'image_upscale',
  IMAGE_REMOVE_BG: 'image_remove_bg',
  IMAGE_ERASE: 'image_erase',
  IMAGE_MASK: 'image_mask',
  IMAGE_EXTEND: 'image_extend',
  IMAGE_REFINE: 'image_refine',
  IMAGE_SEGMENT: 'image_segment',
  IMAGE_VECTORIZE: 'image_vectorize',
  IMAGE_SVG_TRACE: 'image_svg_trace',

  // 视频操作
  VIDEO_GENERATE: 'video_generate',
  VIDEO_EXTEND: 'video_extend',

  // 音频操作
  AUDIO_GENERATE: 'audio_generate',
  VIDEO_AUDIO_ADD: 'video_audio_add',
  VIDEO_EDIT: 'video_edit',

  // 3D操作
  MODEL_3D_GENERATE: '3d_generate',
  MODEL_3D_POST_PROCESS: '3d_post_process',

  // 聊天/LLM
  CHAT: 'chat',
  PROMPT_OPTIMIZE: 'prompt_optimize',
  VISION_ANALYZE: 'vision_analyze',

  // 编辑/修复
  LANG_EDIT: 'lang_edit',
  AGENT_EDIT: 'agent_edit',
  FONT_DESIGN: 'font_design',
  FONT_DESIGN_GENERATE: 'font_design_generate',

  // 品牌
  BRAND_FACTORY: 'brand_factory',
  BRAND_ECOMMERCE: 'brand_ecommerce',
  BRAND_PACKAGING: 'brand_packaging',

  // 工作流
  WORKFLOW_EXECUTE: 'workflow_execute',
  WORKFLOW_AI_BUILD: 'workflow_ai_build',

  // 用户操作
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  PROJECT_SAVE: 'project_save',
  EXPORT_PSD: 'export_psd',
  EXPORT_SVG: 'export_svg',

  // 管理员操作
  ADMIN_USER_CREATE: 'user_create',
  ADMIN_USER_UPDATE: 'user_update',
  ADMIN_USER_DELETE: 'user_delete',
  ADMIN_API_CREATE: 'api_create',
  ADMIN_API_UPDATE: 'api_update',
  ADMIN_API_DELETE: 'api_delete',
  ADMIN_SETTINGS: 'system_update',
} as const;

// ─── 核心函数 ────────────────────────────────────────────────────────────────

/**
 * 记录一条操作日志（异步，不阻塞主流程）
 */
export function logOperation(entry: OpLogEntry): void {
  // 异步执行，不等待结果
  dbAddAuditLog({
    user_id: entry.userId,
    user_name: entry.userName || null,
    action: entry.action,
    target_type: entry.targetType || null,
    target_id: entry.targetId || null,
    detail: entry.detail || null,
    ip_address: null,
    created_at: Date.now(),
    level: entry.level || 'info',
    error_message: entry.errorMessage || null,
    stack_trace: entry.stackTrace || null,
    request_data: entry.requestData || null,
    response_status: entry.responseStatus || 0,
    duration_ms: entry.durationMs || 0,
    model: entry.model || null,
    provider_id: entry.providerId || null,
    resolution_status: 'none',
    resolution_detail: null,
    resolved_at: null,
    resolved_by: null,
  }).catch(e => {
    // 日志记录失败不应影响主流程
    console.error('[op-log] Failed to log operation:', e);
  });
}

/**
 * 记录错误日志
 */
export function logError(
  action: string,
  error: unknown,
  context?: Partial<OpLogEntry>
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  logOperation({
    userId: context?.userId || 'system',
    userName: context?.userName,
    action,
    targetType: context?.targetType,
    targetId: context?.targetId,
    detail: context?.detail || err.message,
    level: 'error',
    errorMessage: err.message,
    stackTrace: err.stack || undefined,
    requestData: context?.requestData,
    responseStatus: context?.responseStatus || 500,
    durationMs: context?.durationMs,
    model: context?.model,
    providerId: context?.providerId,
  });
}

/**
 * 记录警告日志
 */
export function logWarning(
  action: string,
  message: string,
  context?: Partial<OpLogEntry>
): void {
  logOperation({
    userId: context?.userId || 'system',
    userName: context?.userName,
    action,
    targetType: context?.targetType,
    targetId: context?.targetId,
    detail: context?.detail || message,
    level: 'warn',
    errorMessage: message,
    requestData: context?.requestData,
    responseStatus: context?.responseStatus,
    durationMs: context?.durationMs,
    model: context?.model,
    providerId: context?.providerId,
  });
}

/**
 * 计时辅助：创建一个计时器，返回 { end } 函数，调用 end() 返回耗时ms
 */
export function startTimer(): { end: () => number } {
  const start = Date.now();
  return { end: () => Date.now() - start };
}

/**
 * 从请求中提取用户信息
 */
export async function extractUserFromRequest(request: Request): Promise<{ userId: string; userName: string }> {
  try {
    const { getSessionUser } = await import('./server-auth');
    const user = await getSessionUser(request as unknown as import('next/server').NextRequest);
    return {
      userId: user?.id || 'anonymous',
      userName: user?.name || '匿名用户',
    };
  } catch {
    return { userId: 'anonymous', userName: '匿名用户' };
  }
}

/**
 * 从请求体中安全提取可记录的数据（过滤敏感字段）
 */
export function sanitizeRequestData(data: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_KEYS = ['apiKey', 'api_key', 'password', 'token', 'secret', 'authorization'];
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
      sanitized[key] = '***REDACTED***';
    } else if (typeof value === 'string' && value.length > 500) {
      // 截断过长的字符串（如base64图片数据）
      sanitized[key] = value.substring(0, 200) + '...[truncated]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * 高阶函数：包装API处理器，自动记录操作日志
 *
 * @example
 * ```ts
 * // 在 route.ts 中使用
 * export const POST = withOpLog(
 *   'image_generate',
 *   async (request, { userId, userName, timer }) => {
 *     const body = await request.json();
 *     // ... 业务逻辑
 *     return NextResponse.json({ success: true, data: result });
 *   },
 *   { targetType: 'image' }
 * );
 * ```
 */
export function withOpLog(
  action: string,
  handler: (
    request: Request,
    ctx: { userId: string; userName: string; timer: { end: () => number } }
  ) => Promise<Response>,
  options?: { targetType?: string; defaultModel?: string }
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const timer = startTimer();
    const { userId, userName } = await extractUserFromRequest(request);

    try {
      const response = await handler(request, { userId, userName, timer });

      // 记录成功操作
      const durationMs = timer.end();
      logOperation({
        userId,
        userName,
        action,
        targetType: options?.targetType,
        level: response.ok ? 'info' : 'warn',
        responseStatus: response.status,
        durationMs,
        model: options?.defaultModel,
      });

      return response;
    } catch (error) {
      // 记录失败操作
      const durationMs = timer.end();
      logError(action, error, {
        userId,
        userName,
        targetType: options?.targetType,
        responseStatus: 500,
        durationMs,
        model: options?.defaultModel,
      });
      throw error;
    }
  };
}
