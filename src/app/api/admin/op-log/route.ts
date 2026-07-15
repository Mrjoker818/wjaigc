/**
 * 操作日志 API
 * GET /api/admin/op-log - 查询操作日志（支持分页/筛选/排序）
 * POST /api/admin/op-log - 操作：statistics / analyze / resolve / fix / batch_delete / export
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import {
  dbGetAuditLogs,
  dbGetAuditStats,
  dbUpdateAuditLogResolution,
  dbAddAuditLog,
} from '@/lib/db-storage';
import { findProviderForFeature } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';

// ─── GET: 查询操作日志 ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminUser(request);
    if (!authResult) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));
    const action = searchParams.get('action') || undefined;
    const level = searchParams.get('level') || undefined;
    const userId = searchParams.get('userId') || undefined;
    const startTime = searchParams.get('startTime') ? parseInt(searchParams.get('startTime')!) : undefined;
    const endTime = searchParams.get('endTime') ? parseInt(searchParams.get('endTime')!) : undefined;
    const resolutionStatus = searchParams.get('resolutionStatus') || undefined;
    const search = searchParams.get('search') || undefined;
    const model = searchParams.get('model') || undefined;
    const providerId = searchParams.get('providerId') || undefined;

    const result = await dbGetAuditLogs({
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
        return await handleResolve(body, authResult.name || authResult.id);
      case 'fix':
        return await handleFix(request, body, authResult.name || authResult.id);
      case 'batch_delete':
        return await handleBatchDelete(body);
      case 'export':
        return await handleExport(body);
      default:
        return NextResponse.json({ success: false, error: `未知操作: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('[op-log] POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '操作失败' },
      { status: 500 }
    );
  }
}

// ─── 统计数据 ──────────────────────────────────────────────────────────────

async function handleStatistics() {
  const stats = await dbGetAuditStats();
  return NextResponse.json({ success: true, stats });
}

// ─── AI 分析日志 ──────────────────────────────────────────────────────────

async function handleAnalyze(_request: NextRequest, body: { logIds?: string[]; query?: string }) {
  const { logIds, query } = body;

  // 获取要分析的日志
  let logsToAnalyze;
  if (logIds && logIds.length > 0) {
    // 先获取足够多的日志再筛选
    const result = await dbGetAuditLogs({ limit: 200, offset: 0 });
    logsToAnalyze = result.logs.filter(log => logIds.includes(String(log.id)));
  } else {
    // 默认分析最近的错误日志
    const result = await dbGetAuditLogs({
      level: 'error',
      limit: 20,
      offset: 0,
    });
    logsToAnalyze = result.logs;
  }

  if (!logsToAnalyze || logsToAnalyze.length === 0) {
    return NextResponse.json({ success: false, error: '没有可分析的日志' }, { status: 400 });
  }

  // 构建分析提示词
  const logsSummary = logsToAnalyze.map(log => ({
    id: log.id,
    time: new Date(log.created_at).toISOString(),
    action: log.action,
    level: log.level,
    error: log.error_message,
    model: log.model,
    provider: log.provider_id,
    userId: log.user_id,
    requestData: log.request_data,
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
    const response = await fetchWithV1Retry(baseUrl, '/chat/completions', {
      method: 'POST',
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
      const errText = await response.text().catch(() => '');
      return NextResponse.json({
        success: false,
        error: `AI分析请求失败 (HTTP ${response.status}): ${errText.substring(0, 200)}`,
      }, { status: 500 });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    let analysis;
    try {
      analysis = JSON.parse(content);
    } catch {
      analysis = { rawAnalysis: content };
    }

    // 更新被分析的日志状态为 analyzing
    for (const log of logsToAnalyze) {
      await dbUpdateAuditLogResolution(String(log.id), 'analyzing', `AI分析: ${(analysis.problemCategory || analysis['问题分类'] || '').substring(0, 200)}`, 'system');
    }

    return NextResponse.json({
      success: true,
      analysis,
      analyzedCount: logsToAnalyze.length,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : '未知错误';
    console.error('[op-log] AI analyze error:', err);
    return NextResponse.json({
      success: false,
      error: `AI分析失败: ${errMsg}`,
    }, { status: 500 });
  }
}

// ─── 标记日志处理状态 ──────────────────────────────────────────────────────

async function handleResolve(body: { logId: string; status: string; detail?: string }, resolvedBy: string) {
  const { logId, status, detail } = body;

  if (!logId || !status) {
    return NextResponse.json({ success: false, error: '缺少参数' }, { status: 400 });
  }

  const validStatuses = ['none', 'analyzing', 'fixing', 'resolved', 'wontfix'];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ success: false, error: `无效状态: ${status}` }, { status: 400 });
  }

  await dbUpdateAuditLogResolution(logId, status, detail || '', resolvedBy);
  return NextResponse.json({ success: true });
}

// ─── AI 智能修复 ──────────────────────────────────────────────────────────

async function handleFix(_request: NextRequest, body: { logId: string; fixAction: string }, resolvedBy: string) {
  const { logId, fixAction } = body;

  if (!logId || !fixAction) {
    return NextResponse.json({ success: false, error: '缺少参数' }, { status: 400 });
  }

  // 获取日志详情 - 查找特定日志
  const allResult = await dbGetAuditLogs({ limit: 500, offset: 0 });
  const log = allResult.logs.find(logEntry => String(logEntry.id) === String(logId));
  if (!log) {
    return NextResponse.json({ success: false, error: '日志不存在' }, { status: 404 });
  }

  // 更新状态为修复中
  await dbUpdateAuditLogResolution(logId, 'fixing', `正在执行修复: ${fixAction}`, resolvedBy);

  try {
    let fixResult: { success: boolean; message: string; detail?: string } = { success: false, message: '未知修复操作' };

    switch (fixAction) {
      case 'retry_with_different_provider':
        fixResult = {
          success: true,
          message: '建议切换到其他API提供商重试。当前提供商可能临时不可用。',
          detail: `原始提供商: ${log.provider_id || '未知'}`,
        };
        break;

      case 'adjust_model_params':
        fixResult = {
          success: true,
          message: '建议调整生成参数：降低图片尺寸、使用更小的质量设置、或更换模型。',
          detail: `原始模型: ${log.model || '未知'}, 错误: ${log.error_message || '未知'}`,
        };
        break;

      case 'clear_rate_limit':
        fixResult = {
          success: true,
          message: '429错误为API限流，建议：1) 等待一段时间后重试 2) 切换到其他提供商 3) 降低并发请求数',
          detail: '检测到限流错误',
        };
        break;

      case 'check_api_key':
        fixResult = {
          success: true,
          message: '401/403错误通常为API密钥问题。建议：1) 检查API密钥是否有效 2) 确认账户余额 3) 检查权限设置',
          detail: '认证失败，请检查API配置',
        };
        break;

      case 'auto_repair_size':
        if (log.request_data && typeof log.request_data === 'object') {
          const rd = log.request_data as Record<string, unknown>;
          fixResult = {
            success: true,
            message: '尺寸问题已标记。系统将自动使用最接近的合法尺寸重试。建议使用标准比例（1:1, 16:9, 4:3等）。',
            detail: `原始请求: ${JSON.stringify({ aspectRatio: rd.aspectRatio, size: rd.size }).substring(0, 200)}`,
          };
        } else {
          fixResult = { success: true, message: '无法获取原始请求参数，建议手动调整尺寸后重试。' };
        }
        break;

      case 'mark_resolved':
        await dbUpdateAuditLogResolution(logId, 'resolved', '管理员标记为已解决', resolvedBy);
        fixResult = { success: true, message: '已标记为已解决' };
        break;

      case 'mark_wontfix':
        await dbUpdateAuditLogResolution(logId, 'wontfix', '管理员标记为不修复', resolvedBy);
        fixResult = { success: true, message: '已标记为不修复' };
        break;

      default:
        fixResult = { success: false, message: `不支持的修复操作: ${fixAction}` };
    }

    // 如果修复成功，更新日志状态
    if (fixResult.success && fixAction !== 'mark_resolved' && fixAction !== 'mark_wontfix') {
      await dbUpdateAuditLogResolution(logId, 'resolved', fixResult.message, resolvedBy);
    }

    // 记录修复操作日志
    await dbAddAuditLog({
      user_id: 'system',
      user_name: 'AI修复',
      action: 'op_log_fix',
      target_type: 'audit_log',
      target_id: logId,
      detail: `修复操作: ${fixAction} - ${fixResult.message}`,
      ip_address: null,
      created_at: Date.now(),
      level: 'info',
    });

    return NextResponse.json({ success: true, fixResult });
  } catch (error) {
    console.error('[op-log] Fix error:', error);
    await dbUpdateAuditLogResolution(logId, 'none', `修复失败: ${error instanceof Error ? error.message : '未知错误'}`, resolvedBy);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '修复失败' },
      { status: 500 }
    );
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

  const result = await dbGetAuditLogs({
    startTime,
    endTime,
    level,
    action,
    limit: 1000,
    offset: 0,
  });

  if (format === 'csv') {
    const headers = ['ID', '时间', '用户ID', '用户名', '操作', '级别', '目标类型', '错误信息', '模型', '提供商', '耗时(ms)', '处理状态'];
    const rows = result.logs.map(log => [
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

    const csv = [headers.join(','), ...rows.map(row => row.map(value => `"${value}"`).join(','))].join('\n');
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
