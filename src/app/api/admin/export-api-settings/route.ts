/**
 * 管理员 API 设置导出 / 导入 API
 *
 * GET  /api/admin/export-api-settings          导出全部 API 提供商配置（完整内容，含 api_key）
 *                                              + 模型绑定/功能开关系统设置，下载为 JSON 文件
 * GET  ...?preview=1                           只读预览（返回 JSON 而不下载文件）
 * POST /api/admin/export-api-settings          导入（默认 merge 模式：按 id 覆盖更新，不删除多余项）
 * POST body.mode = "replace"                   替换模式：额外删除导出文件中不存在的提供商
 *
 * 用途：将当前已部署版本的所有管理员 API 设置完整迁移到其他项目实例。
 *
 * 安全说明：导出内容包含明文 API Key 与余额查询凭据，因此本接口强制管理员鉴权；
 * 文件请妥善保管，不要公开分享。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import {
  dbGetApiProviders,
  dbUpsertApiProvider,
  dbDeleteStaleProviders,
  dbGetSystemSetting,
  dbSetSystemSetting,
  dbEnsureSortOrderColumn,
  dbEnsureBalanceColumns,
} from '@/lib/db-storage';

export const dynamic = 'force-dynamic';

/** 导出格式标识与版本（导入时校验，便于未来兼容扩展） */
const EXPORT_FORMAT = 'wujie-api-settings-export';
const EXPORT_VERSION = 1;

/** 与 API/模型配置相关的系统设置键（不含 auth_secret、payment_config 等敏感或不可移植项） */
const API_RELATED_SETTING_KEYS = [
  'defaultImageModel',
  'defaultChatModel',
  'defaultVideoModel',
  'quickCreateImageModel',
  'quickCreateChatModel',
  'quickCreateAutoModelRouting',
  'videoGenerationEnabled',
  '3dModelEnabled',
  'maxVideoDuration',
  'imageMaxSizeMB',
  'imageMaxEdge',
] as const;

async function collectExportPayload() {
  const providers = await dbGetApiProviders();

  const settingsEntries = await Promise.all(
    API_RELATED_SETTING_KEYS.map(async (key) => [key, await dbGetSystemSetting(key)] as const),
  );
  const systemSettings: Record<string, unknown> = {};
  for (const [key, value] of settingsEntries) {
    if (value !== null && value !== undefined) systemSettings[key] = value;
  }

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    counts: { providers: providers.length, settings: Object.keys(systemSettings).length },
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      displayName: p.display_name,
      baseUrl: p.base_url,
      apiKey: p.api_key,
      isEnabled: p.is_enabled,
      type: p.type,
      modelType: p.model_type,
      requestStyle: p.request_style,
      selectedModels: p.selected_models || [],
      advancedParams: p.advanced_params || {},
      isDefault: p.is_default,
      connectionStatus: p.connection_status || '',
      discoveredModels: p.discovered_models || [],
      sortOrder: p.sort_order ?? null,
      balanceUsername: p.balance_username || '',
      balancePassword: p.balance_password || '',
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    })),
    systemSettings,
  };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }

  const payload = await collectExportPayload();
  const { searchParams } = new URL(request.url);

  if (searchParams.get('preview') === '1') {
    return NextResponse.json({ success: true, ...payload });
  }

  const json = JSON.stringify(payload, null, 2);
  const filename = `wujie-api-settings-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(json, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求体必须是 JSON（直接提交导出文件内容）' }, { status: 400 });
  }

  const data = body as Record<string, unknown>;
  if (data?.format !== EXPORT_FORMAT) {
    return NextResponse.json(
      { success: false, error: `格式不正确：期望 format="${EXPORT_FORMAT}"` },
      { status: 400 },
    );
  }
  if (typeof data.version !== 'number' || data.version > EXPORT_VERSION) {
    return NextResponse.json(
      { success: false, error: `不支持的导出文件版本: ${String(data.version)}（当前支持 <= ${EXPORT_VERSION}）` },
      { status: 400 },
    );
  }

  const providers = Array.isArray(data.providers) ? data.providers : [];
  const mode = data.mode === 'replace' ? 'replace' : 'merge';
  const now = Date.now();

  // 确保目标库存在所需列（幂等）
  await dbEnsureSortOrderColumn();
  await dbEnsureBalanceColumns();

  const importedIds: string[] = [];
  const errors: Array<{ id?: string; name?: string; error: string }> = [];

  for (const raw of providers) {
    const p = raw as Record<string, unknown>;
    if (!p || typeof p !== 'object') continue;
    const id = String(p.id || '').trim();
    const name = String(p.name || '').trim();
    const baseUrl = String(p.baseUrl || '').trim();
    if (!id || !name || !baseUrl) {
      errors.push({ id: id || undefined, name: name || undefined, error: '缺少必填字段 id/name/baseUrl' });
      continue;
    }

    const ok = await dbUpsertApiProvider({
      id,
      name,
      display_name: String(p.displayName ?? ''),
      base_url: baseUrl,
      api_key: String(p.apiKey ?? ''),
      is_enabled: p.isEnabled !== false,
      type: String(p.type || 'image'),
      model_type: String(p.modelType || p.type || 'image'),
      request_style: String(p.requestStyle || 'images-generations'),
      selected_models: Array.isArray(p.selectedModels) ? p.selectedModels.map(String) : [],
      advanced_params: (p.advancedParams && typeof p.advancedParams === 'object' ? p.advancedParams : {}) as Record<string, string>,
      is_default: p.isDefault === true,
      created_at: typeof p.createdAt === 'number' ? p.createdAt : now,
      updated_at: now,
      connection_status: String(p.connectionStatus || ''),
      discovered_models: Array.isArray(p.discoveredModels) ? (p.discoveredModels as Record<string, unknown>[]) : [],
      sort_order: typeof p.sortOrder === 'number' ? p.sortOrder : undefined,
      balance_username: String(p.balanceUsername || ''),
      balance_password: String(p.balancePassword || ''),
    });

    if (ok) importedIds.push(id);
    else errors.push({ id, name, error: '数据库写入失败' });
  }

  // 替换模式：删除导出文件中不存在的提供商
  let deletedStale = 0;
  if (mode === 'replace' && importedIds.length > 0) {
    const before = (await dbGetApiProviders()).length;
    await dbDeleteStaleProviders(importedIds);
    const after = (await dbGetApiProviders()).length;
    deletedStale = Math.max(0, before - after);
  }

  // 恢复系统设置
  const systemSettings = (data.systemSettings && typeof data.systemSettings === 'object'
    ? data.systemSettings
    : {}) as Record<string, unknown>;
  const restoredSettings: string[] = [];
  for (const key of API_RELATED_SETTING_KEYS) {
    if (key in systemSettings) {
      const ok = await dbSetSystemSetting(key, systemSettings[key]);
      if (ok) restoredSettings.push(key);
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    mode,
    imported: importedIds.length,
    deletedStale,
    restoredSettings,
    errors: errors.length > 0 ? errors : undefined,
  });
}
