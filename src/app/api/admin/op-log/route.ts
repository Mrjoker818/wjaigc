/**
 * 操作日志 API
 * GET /api/admin/op-log - 查询操作日志（支持分页/筛选/排序）
 * POST /api/admin/op-log - 操作：statistics / analyze / resolve / fix / batch_delete / export
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import {
  dbGetAuditLogById,
  dbGetAuditLogs,
  dbGetAuditStats,
  dbRecordAuditLogResolution,
  dbUpdateAuditLogResolution,
} from '@/lib/db-storage';
import type { DbAuditLog } from '@/lib/db-storage';
import type { User } from '@/lib/user-types';
import { findProviderForFeature } from '@/lib/server-api-config';
import { ensureVersionPath, fetchWithV1Retry, shouldSkipV1Retry } from '@/lib/api-helpers';

// ─── GET: 查询操作日志 ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminUser(request);
    if (!authResult) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '', 10) || 1);
    const size = searchParams.get('pageSize') ?? searchParams.get('limit') ?? '';
    const pageSize = Math.min(100, Math.max(1, parseInt(size, 10) || 20));
    const action = searchParams.get('action') || undefined;
    const level = searchParams.get('level') || undefined;
    const userId = searchParams.get('userId') || undefined;
    const startTime = searchParams.get('startTime') ? parseInt(searchParams.get('startTime')!) : undefined;
    const endTime = searchParams.get('endTime') ? parseInt(searchParams.get('endTime')!) : undefined;
    const resolutionStatus = searchParams.get('resolutionStatus') || undefined;
    const search = searchParams.get('search') || undefined;
    const model = searchParams.get('model') || undefined;
    const providerId = searchParams.get('providerId') || undefined;

    const result = await dbGetAuditLogs({ throwOnError: true,
      action,
      level,
      userId,
      startTime,
      endTime,
      resolutionStatus,
      search,
      model,
      providerId,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return NextResponse.json({
      success: true,
      logs: result.logs,
      total: result.total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('[op-log] GET error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '查询日志失败' },
      { status: 500 }
    );
  }
}

// ─── POST: 多种操作 ────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminUser(request);
    if (!authResult) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });

    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'statistics':
        return await handleStatistics();
      case 'analyze':
        return await handleAnalyze(request, body);
      case 'resolve':
        return await handleResolve(body, authResult);
      case 'fix':
        return await handleFix(body, authResult);
      case 'batch_delete':
        return await handleBatchDelete(body);
      case 'export':
        return await handleExport(body);
      default:
        return NextResponse.json({ success: false, error: `未知操作: ${action}` }, { status: 400 });
    }
  } catch {
    console.error('[op-log] operation failed');
    return NextResponse.json(
      { success: false, error: '操作失败' },
      { status: 500 }
    );
  }
}

// ─── 统计数据 ──────────────────────────────────────────────────────────────

async function handleStatistics() {
  const stats = await dbGetAuditStats({ throwOnError: true });
  return NextResponse.json({ success: true, stats });
}

// ─── AI 分析日志 ──────────────────────────────────────────────────────────

async function handleAnalyze(_request: NextRequest, body: { logIds?: string[]; query?: string }) {
  const { logIds, query } = body;
  if (logIds !== undefined && (!Array.isArray(logIds) || logIds.length > 20
    || logIds.some(id => typeof id !== 'string' || !id))) {
    return NextResponse.json({ success: false, error: '日志标识无效' }, { status: 400 });
  }

  // 获取要分析的日志
  const logsToAnalyze = logIds?.length
    ? (await Promise.all([...new Set(logIds)].map((logId) => dbGetAuditLogById(logId)))).filter((row): row is DbAuditLog => row !== null)
    : (await dbGetAuditLogs({ throwOnError: true, level: 'error', limit: 20, offset: 0 })).logs;

  if (!logsToAnalyze || logsToAnalyze.length === 0) {
    return NextResponse.json({ success: false, error: '没有可分析的日志' }, { status: 400 });
  }

  // 供应商只接收诊断所需的字段。
  const logsSummary = logsToAnalyze.map((log: DbAuditLog) => ({
    time: new Date(Number(log.created_at)).toISOString(),
    action: log.action,
    level: log.level,
    responseStatus: log.response_status,
    model: log.model,
    provider: log.provider_id,
    duration: log.duration_ms,
  }));

  const analysisPrompt = `你是一位专业的系统运维工程师，请分析以下操作日志，找出问题的根本原因，并给出具体的修复建议。

## 日志数据
${JSON.stringify(logsSummary, null, 2)}

${query ? `## 用户问题\n${query}` : ''}

## 请分析并返回
1. **问题分类**: 这些错误属于什么类型（API限流/模型错误/网络问题/参数错误/权限问题/其他）
2. **根本原因**: 导致这些错误的最可能原因
3. **影响范围**: 受影响的功能和用户范围
4. **修复建议**: 具体的修复步骤（如果涉及API配置，请说明需要调整哪些参数）
5. **预防措施**: 如何避免类似问题再次发生

请用JSON格式返回分析结果。`;

  // 查找可用的 LLM 提供商
  const provider = await findProviderForFeature('chat');
  if (!provider) {
    return NextResponse.json({
      success: false,
      error: '未配置LLM模型，无法进行AI分析。请在管理员后台添加LLM模型。',
    }, { status: 400 });
  }

  // 调用 LLM
  const baseUrl = provider.baseUrl?.replace(/\/+$/, '') || '';
  const apiKey = provider.apiKey || '';
  const chatModel = provider.selectedModels?.find((m: string) =>
    m.includes('gpt') || m.includes('gemini') || m.includes('claude') || m.includes('qwen') || m.includes('deepseek')
  ) || provider.selectedModels?.[0];

  if (!chatModel) {
    return NextResponse.json({
      success: false,
      error: 'LLM提供商未选择模型',
    }, { status: 400 });
  }

  try {
    const endpointBase = shouldSkipV1Retry(baseUrl) ? baseUrl : ensureVersionPath(baseUrl);
    const response = await fetchWithV1Retry(endpointBase, '/chat/completions', {
      method: 'POST',
      skipV1Retry: true,
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: chatModel,
        messages: [
          {
            role: 'system',
            content: '你是一位专业的系统运维工程师，擅长分析操作日志和诊断系统问题。请用中文回复，返回结构化的JSON分析结果。',
          },
          { role: 'user', content: analysisPrompt },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return NextResponse.json({
        success: false,
        error: `AI分析请求失败 (HTTP ${response.status})`,
      }, { status: 502 });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ success: false, error: 'AI分析未返回结果' }, { status: 502 });
    }

    let analysis;
    try {
      analysis = JSON.parse(content);
    } catch {
      analysis = { rawAnalysis: content };
    }

    const category = analysis?.problemCategory ?? analysis?.['问题分类'];
    for (const log of logsToAnalyze) {
      await dbUpdateAuditLogResolution(String(log.id), 'analyzing',
        typeof category === 'string' ? `AI分析：${category.slice(0, 200)}` : 'AI分析完成', 'system', 'none');
    }

    return NextResponse.json({
      success: true,
      analysis,
      analyzedCount: logsToAnalyze.length,
    });
  } catch {
    console.error('[op-log] analysis result unconfirmed');
    return NextResponse.json({
      success: false,
      error: 'AI分析结果尚未确认',
    }, { status: 502 });
  }
}

// ─── 标记日志处理状态 ──────────────────────────────────────────────────────

type AuditActor = Pick<User, 'id' | 'name'>;

async function handleResolve(body: { logId: string; status: string; detail?: string }, actor: AuditActor) {
  const { logId, status, detail } = body;
  if (typeof logId !== 'string' || !logId || !status || (detail !== undefined && typeof detail !== 'string')) {
    return NextResponse.json({ success: false, error: '缺少参数' }, { status: 400 });
  }

  const validStatuses = ['none', 'analyzing', 'fixing', 'resolved', 'wontfix'];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ success: false, error: '无效状态' }, { status: 400 });
  }

  return recordResolution({
    logId, actor, status, detail: detail ?? '',
    action: 'op_log_resolve', auditDetail: `更新日志处理状态为 ${status}`,
  }, { success: true });
}

async function handleFix(body: { logId: string; fixAction: string }, actor: AuditActor) {
  const { logId, fixAction } = body;
  if (typeof logId !== 'string' || !logId || typeof fixAction !== 'string' || !fixAction) {
    return NextResponse.json({ success: false, error: '缺少参数' }, { status: 400 });
  }

  const log = await dbGetAuditLogById(logId);
  if (!log) {
    return NextResponse.json({ success: false, error: '日志不存在' }, { status: 404 });
  }

  let status: string | null = null;
  let message: string;
  let detail: string | undefined;
  switch (fixAction) {
    case 'retry_with_different_provider':
      message = '可以切换到其他 API 提供商重试。';
      detail = `原始提供商：${log.provider_id || '未知'}`;
      break;
    case 'adjust_model_params':
      message = '建议降低图片尺寸，使用更小的质量设置或更换模型。';
      detail = `原始模型：${log.model || '未知'}`;
      break;
    case 'clear_rate_limit':
      message = '遇到 API 限流时，可以稍后重试、切换供应商或降低并发请求数。';
      break;
    case 'check_api_key':
      message = '遇到认证失败时，请检查 API 密钥、账户余额和权限。';
      break;
    case 'auto_repair_size':
      message = '请按模型支持的尺寸重新提交，例如 1:1、16:9 或 4:3。';
      break;
    case 'mark_resolved':
      status = 'resolved';
      message = '已标记为已解决';
      break;
    case 'mark_wontfix':
      status = 'wontfix';
      message = '已标记为不修复';
      break;
    default:
      return NextResponse.json({ success: false, error: '不支持的修复操作' }, { status: 400 });
  }
  return recordResolution({
    logId, actor, status, detail: message,
    action: 'op_log_fix', auditDetail: `${fixAction} · ${message}`,
  }, { success: true, fixResult: { success: true, message, detail } });
}

async function recordResolution(
  input: Parameters<typeof dbRecordAuditLogResolution>[0],
  successBody: { success: true; fixResult?: { success: true; message: string; detail?: string } },
) {
  try {
    if (await dbRecordAuditLogResolution(input)) return NextResponse.json(successBody);
    return NextResponse.json({ success: false, error: '日志不存在' }, { status: 404 });
  } catch {
    console.error('[op-log] unable to confirm resolution');
    return NextResponse.json({ success: false, error: '日志操作结果尚未确认' }, { status: 503 });
  }
}

// ─── 批量删除日志 ──────────────────────────────────────────────────────────

async function handleBatchDelete(body: { logIds?: string[]; beforeDate?: number; level?: string }) {
  const { logIds, beforeDate, level } = body;

  try {
    const { getPool } = await import('@/lib/db-client');
    const pool = getPool();
    if (!pool) {
      return NextResponse.json({ success: false, error: '数据库不可用' }, { status: 500 });
    }

    let deletedCount = 0;

    if (logIds && logIds.length > 0) {
      const result = await pool.query(
        `DELETE FROM wujie_audit_log WHERE id = ANY($1)`,
        [logIds]
      );
      deletedCount = result.rowCount || 0;
    } else if (beforeDate) {
      let query = `DELETE FROM wujie_audit_log WHERE created_at < $1`;
      const params: unknown[] = [beforeDate];
      if (level) {
        query += ` AND level = $2`;
        params.push(level);
      }
      const result = await pool.query(query, params);
      deletedCount = result.rowCount || 0;
    } else {
      return NextResponse.json({ success: false, error: '请指定要删除的日志' }, { status: 400 });
    }

    return NextResponse.json({ success: true, deletedCount });
  } catch (error) {
    console.error('[op-log] Batch delete error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '删除失败' },
      { status: 500 }
    );
  }
}

// ─── 导出日志 ──────────────────────────────────────────────────────────────

async function handleExport(body: { format?: string; startTime?: number; endTime?: number; level?: string; action?: string }) {
  const { format = 'json', startTime, endTime, level, action } = body;

  const result = await dbGetAuditLogs({ throwOnError: true,
    startTime,
    endTime,
    level,
    action,
    limit: 1000,
    offset: 0,
  });

  if (format === 'csv') {
    const headers = ['ID', '时间', '用户ID', '用户名', '操作', '级别', '目标类型', '错误信息', '模型', '提供商', '耗时(ms)', '处理状态'];
    const rows = result.logs.map((log: DbAuditLog) => [
      log.id,
      new Date(log.created_at).toISOString(),
      log.user_id,
      log.user_name || '',
      log.action,
      log.level || 'info',
      log.target_type || '',
      (log.error_message || '').replace(/"/g, '""'),
      log.model || '',
      log.provider_id || '',
      log.duration_ms || '',
      log.resolution_status || 'none',
    ]);

    const csv = [headers.join(','), ...rows.map((row) => row.map((cell) => `"${String(cell)}"`).join(','))].join('\n');
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="op-log-${Date.now()}.csv"`,
      },
    });
  }

  // 默认 JSON
  return NextResponse.json({
    success: true,
    logs: result.logs,
    total: result.total,
    exportedAt: Date.now(),
  });
}
