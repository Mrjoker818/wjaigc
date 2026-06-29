import 'server-only';

import crypto from 'crypto';
import { getApiProviders } from './server-api-config';
import { authenticateUser, listManagedUsers } from './server-auth';
import type { User } from './user-types';
import type { ApiProvider } from './universal-api-types';
import { dbAddAuditLog, dbGetSystemSetting, dbSetSystemSetting } from './db-storage';
import { execSql } from './db-client';

export const UPDATE_CONFIG_CATEGORY = 'desktop-update-config';
export const UPDATE_FILE_CATEGORY = 'desktop-update-file';

export interface DesktopAuth {
  user: User;
  token: string;
}

export interface CloudResource {
  id: string;
  type: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  thumbnailUrl: string;
  content: string;
  payload: Record<string, unknown>;
  enabled: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface CloudBackup {
  id: string;
  userId: string;
  deviceId?: string;
  category: string;
  filename: string;
  originalFilename: string;
  contentType: string;
  size: number;
  storageKey: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  downloadPath: string;
}

export interface DesktopUpdateConfig {
  enabled: boolean;
  version: string;
  packageUrl: string;
  fileBackupId?: string;
  sha256?: string;
  size?: number;
  mandatory?: boolean;
  notes?: string;
  publishedAt: number;
}

// ========= 安全大小限制常量 =========
export const SIZE_LIMITS = {
  BACKUP_BYTES: 50 * 1024 * 1024, // 备份最大 50MB (文件字节)
  BACKUP_BASE64_LEN: 50 * 1024 * 1024 * 4 / 3 + 1024, // base64 字符数上限 ≈ 66MB 字符串
  THUMBNAIL_BYTES: 1024 * 1024, // 缩略图 1MB
  THUMBNAIL_BASE64_LEN: 1024 * 1024 * 4 / 3 + 1024,
  PARAMS_JSON_LEN: 32 * 1024, // params JSON 32KB
};

function tokenSecret(): string {
  const secret = process.env.WUJIE_DESKTOP_TOKEN_SECRET
    || process.env.WUJIE_AUTH_SECRET
    || process.env.NEXTAUTH_SECRET
    || process.env.DESKTOP_TOKEN_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production' || process.env.COZE_PROJECT_ENV === 'PROD') {
      throw new Error('DESKTOP_TOKEN_SECRET is required in production, please set WUJIE_DESKTOP_TOKEN_SECRET env');
    }
    console.warn('[desktop-cloud] ⚠️  WUJIE_DESKTOP_TOKEN_SECRET not set, using dev-only fallback. This is INSECURE for production!');
    return 'dev-only-insecure-secret-change-me';
  }
  return secret;
}

function encodeToken(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', tokenSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function decodeToken(token: string): { sub: string; role: 'admin' | 'user'; name: string; exp: number } | null {
  const [encoded, sig] = String(token || '').split('.');
  if (!encoded || !sig) return null;
  const expected = crypto.createHmac('sha256', tokenSecret()).update(encoded).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { sub?: string; role?: string; name?: string; exp?: number };
    if (!payload.sub || !payload.exp || payload.exp < Date.now()) return null;
    return {
      sub: payload.sub,
      role: payload.role === 'admin' ? 'admin' : 'user',
      name: String(payload.name || ''),
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export function tokenFromHeader(header: string | null, fallback = ''): string {
  const value = header || '';
  return value.startsWith('Bearer ') ? value.slice(7) : fallback;
}

export async function desktopLogin(input: { username: string; password: string; appId?: string; deviceId?: string }): Promise<DesktopAuth | null> {
  const user = await authenticateUser({ name: input.username, password: input.password });
  if (!user || user.status === 'disabled') return null;
  const token = encodeToken({
    sub: user.id,
    role: user.role === 'admin' ? 'admin' : 'user',
    name: user.name,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  await upsertDesktopDevice({
    userId: user.id,
    appId: input.appId || '',
    deviceId: input.deviceId || '',
    status: 'online',
  });
  await audit(user, 'desktop_login', { appId: input.appId || '', deviceId: input.deviceId || '' });
  return { user, token };
}

export async function getDesktopAuth(token: string): Promise<DesktopAuth | null> {
  const payload = decodeToken(token);
  if (!payload) return null;
  const users = await listManagedUsers();
  const user = users.find(item => item.id === payload.sub);
  if (!user || user.status === 'disabled') return null;
  return { user, token };
}

export function publicProvider(provider: ApiProvider, includeKey: boolean): Record<string, unknown> {
  const selectedModels = provider.selectedModels || [];
  return {
    id: provider.id,
    name: provider.name,
    displayName: provider.displayName || provider.name,
    baseUrl: provider.baseUrl,
    apiKey: includeKey ? provider.apiKey : '',
    apiKeyPreview: provider.apiKey ? `${provider.apiKey.slice(0, 6)}...${provider.apiKey.slice(-4)}` : '',
    isEnabled: provider.isEnabled !== false,
    type: provider.type || provider.modelType || 'universal',
    modelType: provider.modelType || 'universal',
    requestStyle: provider.requestStyle || 'auto',
    selectedModels,
    selectedModel: provider.selectedModel || selectedModels[0] || '',
    discoveredModels: provider.discoveredModels || [],
    advancedParams: provider.advancedParams || {},
    isDefault: Boolean(provider.isDefault),
    createdAt: provider.createdAt || Date.now(),
    updatedAt: provider.updatedAt || Date.now(),
    sortOrder: provider.sortOrder || 0,
  };
}

export async function desktopConfigFor(user: User): Promise<Record<string, unknown>> {
  const [providers, resources] = await Promise.all([
    getApiProviders(),
    listResources({ enabledOnly: true }),
  ]);
  return {
    success: true,
    user,
    modelProviders: providers.filter(p => p.isEnabled !== false).map(p => publicProvider(p, true)),
    resources,
    configVersion: Date.now(),
  };
}

export async function ensureDesktopTables(): Promise<void> {
  await execSql(`
    CREATE TABLE IF NOT EXISTS wujie_resources (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'material',
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT '',
      tags JSONB DEFAULT '[]'::jsonb,
      thumbnail_url TEXT DEFAULT '',
      content TEXT DEFAULT '',
      payload JSONB DEFAULT '{}'::jsonb,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await execSql(`
    CREATE TABLE IF NOT EXISTS wujie_backups (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT '',
      device_id TEXT DEFAULT '',
      category TEXT DEFAULT '',
      filename TEXT NOT NULL,
      original_filename TEXT DEFAULT '',
      content_type TEXT DEFAULT 'application/octet-stream',
      size BIGINT NOT NULL DEFAULT 0,
      storage_key TEXT DEFAULT '',
      file_data TEXT DEFAULT '',
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await execSql(`
    CREATE TABLE IF NOT EXISTS wujie_desktop_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT '',
      app_id TEXT DEFAULT '',
      device_id TEXT DEFAULT '',
      device_name TEXT DEFAULT '',
      platform TEXT DEFAULT '',
      arch TEXT DEFAULT '',
      version TEXT DEFAULT '',
      status TEXT DEFAULT 'online',
      last_seen_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await execSql(`
    CREATE TABLE IF NOT EXISTS wujie_local_generation_records (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT '',
      device_id TEXT DEFAULT '',
      thumbnail_url TEXT DEFAULT '',
      prompt TEXT DEFAULT '',
      negative_prompt TEXT DEFAULT '',
      model TEXT DEFAULT '',
      provider_id TEXT DEFAULT '',
      provider_name TEXT DEFAULT '',
      params JSONB DEFAULT '{}'::jsonb,
      source TEXT DEFAULT 'generated',
      created_at BIGINT NOT NULL
    )
  `);
}

function asTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return value.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch { return {}; }
  }
  return {};
}

function rowToResource(row: Record<string, unknown>): CloudResource {
  return {
    id: String(row.id || ''),
    type: String(row.type || 'material'),
    name: String(row.name || ''),
    description: String(row.description || ''),
    category: String(row.category || ''),
    tags: asTags(row.tags),
    thumbnailUrl: String(row.thumbnail_url || row.thumbnailUrl || ''),
    content: String(row.content || ''),
    payload: asObject(row.payload),
    enabled: row.enabled !== false,
    sortOrder: Number(row.sort_order || row.sortOrder || 0),
    createdAt: Number(row.created_at || row.createdAt || 0),
    updatedAt: Number(row.updated_at || row.updatedAt || 0),
  };
}

function rowToBackup(row: Record<string, unknown>): CloudBackup {
  const id = String(row.id || '');
  return {
    id,
    userId: String(row.user_id || row.userId || ''),
    deviceId: String(row.device_id || row.deviceId || ''),
    category: String(row.category || ''),
    filename: String(row.filename || ''),
    originalFilename: String(row.original_filename || row.originalFilename || row.filename || ''),
    contentType: String(row.content_type || row.contentType || 'application/octet-stream'),
    size: Number(row.size || 0),
    storageKey: String(row.storage_key || row.storageKey || ''),
    metadata: asObject(row.metadata),
    createdAt: Number(row.created_at || row.createdAt || 0),
    updatedAt: Number(row.updated_at || row.updatedAt || 0),
    downloadPath: `/api/desktop/backup/download/${encodeURIComponent(id)}`,
  };
}

export async function listResources(options?: { type?: string; enabledOnly?: boolean }): Promise<CloudResource[]> {
  await ensureDesktopTables();
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (options?.type) {
    params.push(options.type);
    clauses.push(`type = $${params.length}`);
  }
  if (options?.enabledOnly) clauses.push('enabled = TRUE');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await execSql(`SELECT * FROM wujie_resources ${where} ORDER BY sort_order ASC, updated_at DESC`, params);
  return result.rows.map(rowToResource);
}

export async function saveResource(input: Partial<CloudResource> & { id?: string; name: string }): Promise<CloudResource> {
  await ensureDesktopTables();
  const now = Date.now();
  const id = input.id || `resource_${now}_${Math.random().toString(36).slice(2, 8)}`;
  await execSql(`
    INSERT INTO wujie_resources (id, type, name, description, category, tags, thumbnail_url, content, payload, enabled, sort_order, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (id) DO UPDATE SET
      type = EXCLUDED.type,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      tags = EXCLUDED.tags,
      thumbnail_url = EXCLUDED.thumbnail_url,
      content = EXCLUDED.content,
      payload = EXCLUDED.payload,
      enabled = EXCLUDED.enabled,
      sort_order = EXCLUDED.sort_order,
      updated_at = EXCLUDED.updated_at
  `, [
    id, input.type || 'material', input.name, input.description || '', input.category || '',
    JSON.stringify(input.tags || []), input.thumbnailUrl || '', input.content || '',
    JSON.stringify(input.payload || {}), input.enabled !== false, input.sortOrder || 0,
    input.createdAt || now, now,
  ]);
  const saved = await execSql('SELECT * FROM wujie_resources WHERE id = $1', [id]);
  return rowToResource(saved.rows[0]);
}

export async function deleteResource(id: string): Promise<boolean> {
  await ensureDesktopTables();
  const result = await execSql('DELETE FROM wujie_resources WHERE id = $1', [id]);
  return result.rowCount > 0;
}

export async function createBackup(input: {
  userId: string;
  deviceId?: string;
  category: string;
  filename: string;
  contentType: string;
  dataBase64: string;
  metadata?: Record<string, unknown>;
}): Promise<CloudBackup> {
  await ensureDesktopTables();
  if (!input.dataBase64 || typeof input.dataBase64 !== 'string') {
    throw new Error('备份数据不能为空');
  }
  if (input.dataBase64.length > SIZE_LIMITS.BACKUP_BASE64_LEN) {
    throw new Error(`备份文件过大（上限 ${Math.round(SIZE_LIMITS.BACKUP_BYTES / 1024 / 1024)}MB）`);
  }
  const now = Date.now();
  const id = `backup_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const size = Buffer.from(input.dataBase64, 'base64').length;
  if (size > SIZE_LIMITS.BACKUP_BYTES) {
    throw new Error(`备份文件过大（上限 ${Math.round(SIZE_LIMITS.BACKUP_BYTES / 1024 / 1024)}MB）`);
  }
  const filename = safeFilename(`${now}_${input.filename || 'backup.bin'}`);
  await execSql(`
    INSERT INTO wujie_backups (id, user_id, device_id, category, filename, original_filename, content_type, size, storage_key, file_data, metadata, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  `, [
    id, input.userId, input.deviceId || '', safeSegment(input.category || 'images'), filename,
    safeFilename(input.filename || 'backup.bin'), input.contentType || 'application/octet-stream',
    size, '', input.dataBase64, JSON.stringify(input.metadata || {}), now, now,
  ]);
  const saved = await execSql('SELECT * FROM wujie_backups WHERE id = $1', [id]);
  return rowToBackup(saved.rows[0]);
}

export async function listBackups(options?: { userId?: string; category?: string; limit?: number; admin?: boolean }): Promise<CloudBackup[]> {
  await ensureDesktopTables();
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (options?.userId) {
    params.push(options.userId);
    clauses.push(`user_id = $${params.length}`);
  }
  if (options?.category) {
    params.push(options.category);
    clauses.push(`category = $${params.length}`);
  }
  const limit = Math.max(1, Math.min(Number(options?.limit || 100), 1000));
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await execSql(`SELECT * FROM wujie_backups ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
  return result.rows.map(rowToBackup);
}

export async function findBackup(id: string): Promise<(CloudBackup & { fileData: string }) | null> {
  await ensureDesktopTables();
  const result = await execSql('SELECT * FROM wujie_backups WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) return null;
  return { ...rowToBackup(row), fileData: String(row.file_data || '') };
}

export async function deleteBackup(id: string): Promise<boolean> {
  await ensureDesktopTables();
  const result = await execSql('DELETE FROM wujie_backups WHERE id = $1', [id]);
  return result.rowCount > 0;
}

export function emptyDesktopUpdateConfig(): DesktopUpdateConfig {
  return { enabled: false, version: '', packageUrl: '', sha256: '', size: 0, mandatory: false, notes: '', publishedAt: 0 };
}

export async function readDesktopUpdateConfig(): Promise<DesktopUpdateConfig> {
  const raw = await dbGetSystemSetting('desktop_update_config');
  const config = asObject(raw);
  return {
    ...emptyDesktopUpdateConfig(),
    ...config,
    enabled: config.enabled === true,
    version: String(config.version || ''),
    packageUrl: String(config.packageUrl || ''),
    fileBackupId: config.fileBackupId ? String(config.fileBackupId) : undefined,
    sha256: config.sha256 ? String(config.sha256) : undefined,
    size: Number(config.size || 0),
    mandatory: config.mandatory === true,
    notes: String(config.notes || ''),
    publishedAt: Number(config.publishedAt || 0),
  };
}

export async function saveDesktopUpdateConfig(input: Partial<DesktopUpdateConfig> & { fileName?: string; fileDataUrl?: string }): Promise<DesktopUpdateConfig> {
  const now = Date.now();
  let packageUrl = String(input.packageUrl || '').trim();
  let fileBackupId = String(input.fileBackupId || '');
  let size = Number(input.size || 0);
  const decoded = parseDataUrl(String(input.fileDataUrl || ''));
  if (decoded) {
    const backup = await createBackup({
      userId: 'admin',
      category: UPDATE_FILE_CATEGORY,
      filename: input.fileName || `wujie-desktop-${input.version || now}.exe`,
      contentType: decoded.contentType,
      dataBase64: decoded.base64,
      metadata: { version: input.version || '', source: 'admin-upload' },
    });
    fileBackupId = backup.id;
    packageUrl = `/api/desktop/update/download/${backup.id}`;
    size = backup.size;
  }
  const config: DesktopUpdateConfig = {
    enabled: input.enabled === true,
    version: String(input.version || '').trim(),
    packageUrl,
    fileBackupId,
    sha256: String(input.sha256 || '').trim(),
    size,
    mandatory: input.mandatory === true,
    notes: String(input.notes || '').trim(),
    publishedAt: now,
  };
  if (config.enabled && (!config.version || !config.packageUrl)) {
    throw new Error('启用桌面更新前必须填写版本号和更新包地址');
  }
  await dbSetSystemSetting('desktop_update_config', config);
  return config;
}

export async function listDesktopUpdateFiles(): Promise<CloudBackup[]> {
  return listBackups({ category: UPDATE_FILE_CATEGORY, limit: 1000, admin: true });
}

export function isNewerVersion(remote: string, current: string): boolean {
  const parse = (version: string) => String(version || '').replace(/^v/i, '').split(/[^\d]+/).filter(Boolean).map(Number);
  const a = parse(remote);
  const b = parse(current);
  const len = Math.max(a.length, b.length, 3);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export async function upsertDesktopDevice(input: {
  userId: string;
  appId?: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  arch?: string;
  version?: string;
  status?: string;
}): Promise<void> {
  await ensureDesktopTables();
  const now = Date.now();
  const deviceId = input.deviceId || 'unknown-device';
  const id = `${input.userId}_${deviceId}`.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 180);
  await execSql(`
    INSERT INTO wujie_desktop_devices (id, user_id, app_id, device_id, device_name, platform, arch, version, status, last_seen_at, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (id) DO UPDATE SET
      app_id = EXCLUDED.app_id,
      device_name = EXCLUDED.device_name,
      platform = EXCLUDED.platform,
      arch = EXCLUDED.arch,
      version = EXCLUDED.version,
      status = EXCLUDED.status,
      last_seen_at = EXCLUDED.last_seen_at,
      updated_at = EXCLUDED.updated_at
  `, [
    id, input.userId, input.appId || '', deviceId, input.deviceName || '',
    input.platform || '', input.arch || '', input.version || '', input.status || 'online',
    now, now, now,
  ]);
}

export async function listDesktopDevices(): Promise<Record<string, unknown>[]> {
  await ensureDesktopTables();
  const result = await execSql('SELECT * FROM wujie_desktop_devices ORDER BY last_seen_at DESC LIMIT 1000');
  return result.rows;
}

export async function addGenerationRecord(input: {
  userId: string;
  deviceId?: string;
  thumbnailUrl?: string;
  prompt?: string;
  negativePrompt?: string;
  model?: string;
  providerId?: string;
  providerName?: string;
  params?: Record<string, unknown>;
  source?: string;
  createdAt?: number;
}): Promise<string> {
  await ensureDesktopTables();
  // 长度安全校验
  if (input.thumbnailUrl && input.thumbnailUrl.length > SIZE_LIMITS.THUMBNAIL_BASE64_LEN) {
    throw new Error(`缩略图过大（上限 ${Math.round(SIZE_LIMITS.THUMBNAIL_BYTES / 1024)}KB），请压缩后重试`);
  }
  const paramsStr = JSON.stringify(input.params || {});
  if (paramsStr.length > SIZE_LIMITS.PARAMS_JSON_LEN) {
    throw new Error(`参数过长（上限 ${Math.round(SIZE_LIMITS.PARAMS_JSON_LEN / 1024)}KB）`);
  }
  if (input.prompt && input.prompt.length > 8000) {
    throw new Error('提示词过长（上限 8000 字符）');
  }
  const now = Date.now();
  const id = `local_gen_${now}_${Math.random().toString(36).slice(2, 8)}`;
  await execSql(`
    INSERT INTO wujie_local_generation_records (id, user_id, device_id, thumbnail_url, prompt, negative_prompt, model, provider_id, provider_name, params, source, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [
    id, input.userId, input.deviceId || '', input.thumbnailUrl || '', (input.prompt || '').slice(0, 8000),
    (input.negativePrompt || '').slice(0, 2000), (input.model || '').slice(0, 200), (input.providerId || '').slice(0, 200),
    (input.providerName || '').slice(0, 200), paramsStr, (input.source || 'generated').slice(0, 64), input.createdAt || now,
  ]);
  return id;
}

export async function listGenerationRecords(options?: { userId?: string; limit?: number }): Promise<Record<string, unknown>[]> {
  await ensureDesktopTables();
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (options?.userId) {
    params.push(options.userId);
    clauses.push(`user_id = $${params.length}`);
  }
  const limit = Math.max(1, Math.min(Number(options?.limit || 200), 1000));
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await execSql(`SELECT * FROM wujie_local_generation_records ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
  return result.rows;
}

export async function audit(user: Pick<User, 'id' | 'name'>, action: string, detail: Record<string, unknown>): Promise<void> {
  await dbAddAuditLog({
    user_id: user.id,
    user_name: user.name,
    action,
    target_type: 'desktop',
    target_id: '',
    detail: JSON.stringify(detail),
    ip_address: null,
    created_at: Date.now(),
  });
}

export function safeFilename(name: string): string {
  return String(name || 'backup.bin').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 180) || 'backup.bin';
}

export function safeSegment(value: string): string {
  return String(value || 'default').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'default';
}

function parseDataUrl(input: string): { contentType: string; base64: string } | null {
  const match = String(input || '').match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/);
  if (!match) return null;
  return { contentType: match[1] || 'application/octet-stream', base64: match[2] };
}
