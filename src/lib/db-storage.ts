/**
 * Database-backed persistent storage for Wujie AI
 * Uses PostgreSQL (Supabase) to persist data across deployments
 * Falls back to file-based storage if database is unavailable
 */

import { execSql, getPool } from './db-client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DbUser {
  id: string;
  name: string;
  password_hash: string;
  credential_hash: string | null;
  role: string;
  status: string;
  api_permissions: Record<string, boolean>;
  storage_folder: string;
  product_type?: string | null;
  group_id?: string | null;
  chat_models?: string[] | string | null;
  image_models?: string[] | string | null;
  daily_token_limit?: number | null;
  monthly_token_limit?: number | null;
  daily_image_limit?: number | null;
  avatar?: string | null;
  nickname?: string | null;
  email?: string | null;
  created_at: number;
  updated_at: number;
}

type DbUserUpsert = Omit<DbUser, 'credential_hash'> & {
  credential_hash?: string | null;
};

interface DbApiProvider {
  id: string;
  name: string;
  display_name: string;
  base_url: string;
  api_key: string;
  is_enabled: boolean;
  type: string;
  model_type: string;
  request_style: string;
  selected_models: string[];
  advanced_params: Record<string, string>;
  is_default: boolean;
  created_at: number;
  updated_at: number;
  connection_status?: string;
  discovered_models?: Record<string, unknown>[];
  sort_order?: number;
  balance_username?: string;
  balance_password?: string;
}

// ─── Core Tables Initialization (for new deployments) ─────────────────────────

let coreTablesInitialization: Promise<void> | null = null;

export function ensureCoreTables(): Promise<void> {
  if (!coreTablesInitialization) {
    coreTablesInitialization = initializeCoreTables().catch((error) => {
      coreTablesInitialization = null;
      throw error;
    });
  }
  return coreTablesInitialization;
}

async function initializeCoreTables(): Promise<void> {
  try {
    // 用户表
    await execSql(`
      CREATE TABLE IF NOT EXISTS wujie_users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        credential_hash TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'active',
        api_permissions JSONB DEFAULT '{}',
        storage_folder TEXT DEFAULT '',
        email TEXT DEFAULT '',
        credits INTEGER DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);

    // API提供商表
    await execSql(`
      CREATE TABLE IF NOT EXISTS wujie_api_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT DEFAULT '',
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        is_enabled BOOLEAN DEFAULT true,
        type TEXT NOT NULL DEFAULT 'image',
        model_type TEXT DEFAULT 'image',
        request_style TEXT DEFAULT 'images-generations',
        selected_models TEXT[] DEFAULT '{}',
        advanced_params JSONB DEFAULT '{}',
        is_default BOOLEAN DEFAULT false,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        connection_status TEXT DEFAULT 'unknown',
        discovered_models JSONB DEFAULT '[]',
        sort_order INTEGER DEFAULT 9999,
        balance_username TEXT DEFAULT '',
        balance_password TEXT DEFAULT ''
      )
    `);

    // 用户数据表（项目/图片/工作流等）
    await execSql(`
      CREATE TABLE IF NOT EXISTS wujie_user_data (
        user_id TEXT NOT NULL,
        data_key TEXT NOT NULL,
        data_value JSONB,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, data_key)
      )
    `);

    // 系统设置表
    await execSql(`
      CREATE TABLE IF NOT EXISTS wujie_system_settings (
        key TEXT PRIMARY KEY,
        value JSONB,
        updated_at BIGINT NOT NULL
      )
    `);

    // 电商模板表
    await execSql(`
      CREATE TABLE IF NOT EXISTS wujie_ecom_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT DEFAULT '',
        description TEXT DEFAULT '',
        prompt_template TEXT NOT NULL,
        negative_prompt TEXT DEFAULT '',
        aspect_ratio TEXT DEFAULT '1:1',
        category TEXT DEFAULT 'general',
        fidelity_anchor TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        is_enabled BOOLEAN DEFAULT true,
        is_builtin BOOLEAN DEFAULT false,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await execSql(`CREATE INDEX IF NOT EXISTS idx_ecom_templates_enabled_order ON wujie_ecom_templates(is_enabled, sort_order)`);

    // 充值订单表
    await execSql(`
      CREATE TABLE IF NOT EXISTS wujie_recharge_orders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        price_cny NUMERIC(10,2) NOT NULL,
        bonus INTEGER DEFAULT 0,
        payment_method TEXT NOT NULL,
        payment_status TEXT NOT NULL DEFAULT 'pending',
        payment_note TEXT DEFAULT '',
        transaction_id TEXT DEFAULT '',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        expires_at BIGINT,
        submitted_at BIGINT,
        paid_at BIGINT
      )
    `);
    await execSql(`CREATE INDEX IF NOT EXISTS idx_recharge_orders_user ON wujie_recharge_orders(user_id)`);
    await execSql(`CREATE INDEX IF NOT EXISTS idx_recharge_orders_status ON wujie_recharge_orders(payment_status)`);

    // 品牌资产表
    await execSql(`
      CREATE TABLE IF NOT EXISTS wujie_brand_assets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        brand_name TEXT DEFAULT '',
        brand_colors JSONB DEFAULT '[]',
        style_extra JSONB DEFAULT '{}',
        scene_desc TEXT DEFAULT '',
        reference_image_url TEXT DEFAULT '',
        product_image_url TEXT DEFAULT '',
        product_desc TEXT DEFAULT '',
        main_text TEXT DEFAULT '',
        secondary_text TEXT DEFAULT '',
        accent_symbol TEXT DEFAULT '',
        selected_model TEXT DEFAULT '',
        is_default BOOLEAN DEFAULT false,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await execSql(`CREATE INDEX IF NOT EXISTS idx_brand_assets_user ON wujie_brand_assets(user_id)`);

    // 用户分组表
    await execSql(`
      CREATE TABLE IF NOT EXISTS wujie_user_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        product_types JSONB DEFAULT '[]',
        credit_quota INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);

    // 用户积分表
    await execSql(`
      CREATE TABLE IF NOT EXISTS wujie_credits (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        balance INTEGER NOT NULL DEFAULT 0,
        total_recharged INTEGER NOT NULL DEFAULT 0,
        total_used INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await execSql(`CREATE INDEX IF NOT EXISTS idx_credits_user ON wujie_credits(user_id)`);

    // 积分交易记录表
    await execSql(`
      CREATE TABLE IF NOT EXISTS wujie_credit_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        balance_after INTEGER DEFAULT 0,
        description TEXT DEFAULT '',
        model TEXT DEFAULT '',
        task_id TEXT DEFAULT '',
        reference_id TEXT DEFAULT '',
        created_at BIGINT NOT NULL
      )
    `);
    await execSql(`CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON wujie_credit_transactions(user_id)`);
    await execSql(`CREATE INDEX IF NOT EXISTS idx_credit_tx_type ON wujie_credit_transactions(type)`);
    await execSql(`CREATE INDEX IF NOT EXISTS idx_credit_tx_created ON wujie_credit_transactions(created_at)`);

    // Existing deployments may have an older audit schema, so the migrations
    // below still add any columns that are missing.
    await execSql(`
      CREATE TABLE IF NOT EXISTS wujie_audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        user_name TEXT,
        action TEXT NOT NULL DEFAULT '',
        target_type TEXT,
        target_id TEXT,
        detail TEXT,
        ip_address TEXT,
        created_at BIGINT NOT NULL,
        level TEXT DEFAULT 'info',
        error_message TEXT DEFAULT '',
        stack_trace TEXT DEFAULT '',
        request_data JSONB DEFAULT '{}',
        response_status INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        model TEXT DEFAULT '',
        provider_id TEXT DEFAULT '',
        resolution_status TEXT DEFAULT 'none',
        resolution_detail TEXT DEFAULT '',
        resolved_at BIGINT,
        resolved_by TEXT DEFAULT ''
      )
    `);

    // ─── 安全迁移：给已有表补充缺失列 ────────────────────────────────
    // CREATE TABLE IF NOT EXISTS 不会添加新列，需要单独 ALTER TABLE
    const migrations: [string, string, string][] = [
      ['wujie_users', 'credits', 'INTEGER DEFAULT 0'],
      ['wujie_users', 'email', 'TEXT DEFAULT \'\''],
      ['wujie_users', 'credential_hash', 'TEXT DEFAULT NULL'],
      ['wujie_users', 'group_id', 'TEXT DEFAULT NULL'],
      ['wujie_users', 'product_type', 'TEXT DEFAULT NULL'],
      ['wujie_users', 'chat_models', 'TEXT[] DEFAULT NULL'],
      ['wujie_users', 'image_models', 'TEXT[] DEFAULT NULL'],
      ['wujie_users', 'daily_token_limit', 'INTEGER DEFAULT NULL'],
      ['wujie_users', 'monthly_token_limit', 'INTEGER DEFAULT NULL'],
      ['wujie_users', 'daily_image_limit', 'INTEGER DEFAULT NULL'],
      ['wujie_users', 'avatar', 'TEXT DEFAULT NULL'],
      ['wujie_users', 'nickname', 'TEXT DEFAULT NULL'],
      ['wujie_recharge_orders', 'bonus', 'INTEGER DEFAULT 0'],
      ['wujie_recharge_orders', 'transaction_id', 'TEXT DEFAULT \'\''],
      ['wujie_recharge_orders', 'expires_at', 'BIGINT'],
      ['wujie_recharge_orders', 'submitted_at', 'BIGINT'],
      ['wujie_recharge_orders', 'paid_at', 'BIGINT'],
      ['wujie_api_providers', 'balance_username', 'TEXT DEFAULT \'\''],
      ['wujie_api_providers', 'balance_password', 'TEXT DEFAULT \'\''],
      ['wujie_credit_transactions', 'task_id', 'TEXT DEFAULT \'\''],
      ['wujie_credit_transactions', 'reference_id', 'TEXT DEFAULT \'\''],
      // 操作日志扩展列
      ['wujie_audit_log', 'level', 'TEXT DEFAULT \'info\''],
      ['wujie_audit_log', 'error_message', 'TEXT DEFAULT \'\''],
      ['wujie_audit_log', 'stack_trace', 'TEXT DEFAULT \'\''],
      ['wujie_audit_log', 'request_data', 'JSONB DEFAULT \'{}\''],
      ['wujie_audit_log', 'response_status', 'INTEGER DEFAULT 0'],
      ['wujie_audit_log', 'duration_ms', 'INTEGER DEFAULT 0'],
      ['wujie_audit_log', 'model', 'TEXT DEFAULT \'\''],
      ['wujie_audit_log', 'provider_id', 'TEXT DEFAULT \'\''],
      ['wujie_audit_log', 'resolution_status', 'TEXT DEFAULT \'none\''],
      ['wujie_audit_log', 'resolution_detail', 'TEXT DEFAULT \'\''],
      ['wujie_audit_log', 'resolved_at', 'BIGINT'],
      ['wujie_audit_log', 'resolved_by', 'TEXT DEFAULT \'\''],
    ];
    for (const [table, col, type] of migrations) {
      try {
        await execSql(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      } catch {
        // Column already exists or table doesn't exist — ignore
      }
    }

    // 操作日志索引
    try { await execSql(`CREATE INDEX IF NOT EXISTS idx_audit_level ON wujie_audit_log(level)`); } catch {}
    try { await execSql(`CREATE INDEX IF NOT EXISTS idx_audit_action ON wujie_audit_log(action)`); } catch {}
    try { await execSql(`CREATE INDEX IF NOT EXISTS idx_audit_created ON wujie_audit_log(created_at)`); } catch {}
    try { await execSql(`CREATE INDEX IF NOT EXISTS idx_audit_user_id ON wujie_audit_log(user_id)`); } catch {}
    try { await execSql(`CREATE INDEX IF NOT EXISTS idx_audit_resolution ON wujie_audit_log(resolution_status)`); } catch {}
    await execSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_tx_task_type_once
       ON wujie_credit_transactions(task_id, type)
       WHERE task_id <> ''
         AND (
           (type = 'consume' AND id LIKE 'ctx_charge_%')
           OR (type = 'refund' AND id LIKE 'ctx_refund_%')
         )`,
    );

    console.log('[db-storage] Core tables ensured');
  } catch (e) {
    console.error('[db-storage] ensureCoreTables error:', e);
    throw e;
  }
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function dbGetUsers(): Promise<DbUser[]> {
  try {
    const result = await execSql('SELECT * FROM wujie_users ORDER BY created_at ASC');
    return result.rows as unknown as DbUser[];
  } catch (e) {
    console.error('[db-storage] dbGetUsers error:', e);
    return [];
  }
}

export async function dbGetUserById(id: string): Promise<DbUser | null> {
  try {
    const result = await execSql('SELECT * FROM wujie_users WHERE id = $1', [id]);
    return (result.rows as unknown as DbUser[])[0] || null;
  } catch (e) {
    console.error('[db-storage] dbGetUserById error:', e);
    return null;
  }
}

export async function dbUpsertUser(user: DbUserUpsert): Promise<boolean> {
  try {
    await execSql(`
      INSERT INTO wujie_users (id, name, password_hash, credential_hash, role, status, api_permissions, storage_folder, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        password_hash = EXCLUDED.password_hash,
        credential_hash = COALESCE(EXCLUDED.credential_hash, wujie_users.credential_hash),
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        api_permissions = EXCLUDED.api_permissions,
        storage_folder = EXCLUDED.storage_folder,
        updated_at = EXCLUDED.updated_at
    `, [
      user.id, user.name, user.password_hash, user.credential_hash ?? null, user.role, user.status,
      JSON.stringify(user.api_permissions), user.storage_folder,
      user.created_at, user.updated_at
    ]);
    return true;
  } catch (e) {
    console.error('[db-storage] dbUpsertUser error:', e);
    return false;
  }
}

export async function dbDeleteUser(id: string): Promise<boolean> {
  try {
    await execSql('DELETE FROM wujie_users WHERE id = $1', [id]);
    return true;
  } catch (e) {
    console.error('[db-storage] dbDeleteUser error:', e);
    return false;
  }
}

// ─── API Providers ───────────────────────────────────────────────────────────

export async function dbGetApiProviders(): Promise<DbApiProvider[]> {
  try {
    const result = await execSql('SELECT * FROM wujie_api_providers ORDER BY COALESCE(sort_order, 999999) ASC, created_at ASC');
    return result.rows as unknown as DbApiProvider[];
  } catch (e) {
    console.error('[db-storage] dbGetApiProviders error:', e);
    return [];
  }
}

export async function dbGetApiProviderById(id: string): Promise<DbApiProvider | null> {
  try {
    const result = await execSql('SELECT * FROM wujie_api_providers WHERE id = $1', [id]);
    return (result.rows as unknown as DbApiProvider[])[0] || null;
  } catch (e) {
    console.error('[db-storage] dbGetApiProviderById error:', e);
    return null;
  }
}

export async function dbUpsertApiProvider(provider: DbApiProvider): Promise<boolean> {
  try {
    await execSql(`
      INSERT INTO wujie_api_providers (id, name, display_name, base_url, api_key, is_enabled, type, model_type, request_style, selected_models, advanced_params, is_default, created_at, updated_at, connection_status, discovered_models, sort_order, balance_username, balance_password)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        display_name = EXCLUDED.display_name,
        base_url = EXCLUDED.base_url,
        api_key = EXCLUDED.api_key,
        is_enabled = EXCLUDED.is_enabled,
        type = EXCLUDED.type,
        model_type = EXCLUDED.model_type,
        request_style = EXCLUDED.request_style,
        selected_models = EXCLUDED.selected_models,
        advanced_params = EXCLUDED.advanced_params,
        is_default = EXCLUDED.is_default,
        updated_at = EXCLUDED.updated_at,
        connection_status = EXCLUDED.connection_status,
        discovered_models = EXCLUDED.discovered_models,
        sort_order = EXCLUDED.sort_order,
        balance_username = EXCLUDED.balance_username,
        balance_password = EXCLUDED.balance_password
    `, [
      provider.id, provider.name, provider.display_name, provider.base_url,
      provider.api_key, provider.is_enabled, provider.type, provider.model_type,
      provider.request_style, JSON.stringify(provider.selected_models),
      JSON.stringify(provider.advanced_params), provider.is_default,
      provider.created_at, provider.updated_at,
      provider.connection_status || null,
      JSON.stringify(provider.discovered_models || []),
      provider.sort_order ?? null,
      provider.balance_username || '',
      provider.balance_password || '',
    ]);
    return true;
  } catch (e) {
    console.error('[db-storage] dbUpsertApiProvider error:', e);
    return false;
  }
}

export async function dbDeleteApiProvider(id: string): Promise<boolean> {
  try {
    await execSql('DELETE FROM wujie_api_providers WHERE id = $1', [id]);
    return true;
  } catch (e) {
    console.error('[db-storage] dbDeleteApiProvider error:', e);
    return false;
  }
}

/** Delete providers from DB that are not in the given activeIdList */
export async function dbDeleteStaleProviders(activeIdList: string[]): Promise<void> {
  if (activeIdList.length === 0) return;
  try {
    const placeholders = activeIdList.map((_, i) => `$${i + 1}`).join(',');
    await execSql(
      `DELETE FROM wujie_api_providers WHERE id NOT IN (${placeholders})`,
      activeIdList
    );
  } catch (e) {
    console.error('[db-storage] dbDeleteStaleProviders error:', e);
  }
}

export async function dbBatchUpdateProviderOrder(orders: Array<{ id: string; sortOrder: number }>): Promise<boolean> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    // 使用单连接事务保证原子性，避免部分更新
    await client.query('BEGIN');
    for (const { id, sortOrder } of orders) {
      await client.query('UPDATE wujie_api_providers SET sort_order = $1, updated_at = $2 WHERE id = $3', [sortOrder, Date.now(), id]);
    }
    await client.query('COMMIT');
    return true;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore rollback error */ }
    console.error('[db-storage] dbBatchUpdateProviderOrder error:', e);
    return false;
  } finally {
    client.release();
  }
}

export async function dbEnsureSortOrderColumn(): Promise<void> {
  try {
    await execSql(`ALTER TABLE wujie_api_providers ADD COLUMN IF NOT EXISTS sort_order INTEGER`);
  } catch {
    // Column may already exist
  }
}

export async function dbEnsureBalanceColumns(): Promise<void> {
  try {
    await execSql(`ALTER TABLE wujie_api_providers ADD COLUMN IF NOT EXISTS balance_username TEXT DEFAULT ''`);
    await execSql(`ALTER TABLE wujie_api_providers ADD COLUMN IF NOT EXISTS balance_password TEXT DEFAULT ''`);
  } catch {
    // Columns may already exist
  }
}

// ─── User Data (projects, images, etc.) ──────────────────────────────────────

export async function dbGetUserData(userId: string, key: string): Promise<unknown> {
  try {
    const result = await execSql(
      'SELECT data_value FROM wujie_user_data WHERE user_id = $1 AND data_key = $2',
      [userId, key]
    );
    return (result.rows as { data_value: unknown }[])[0]?.data_value || null;
  } catch (e) {
    console.error('[db-storage] dbGetUserData error:', e);
    return null;
  }
}

export async function dbSetUserData(userId: string, key: string, value: unknown): Promise<boolean> {
  try {
    await execSql(`
      INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, data_key) DO UPDATE SET
        data_value = EXCLUDED.data_value,
        updated_at = EXCLUDED.updated_at
    `, [userId, key, JSON.stringify(value), Date.now()]);
    return true;
  } catch (e) {
    console.error('[db-storage] dbSetUserData error:', e);
    return false;
  }
}

export async function dbListUserData(userId: string): Promise<{ dataKey: string; updatedAt: number }[]> {
  try {
    const result = await execSql(
      'SELECT data_key, updated_at FROM wujie_user_data WHERE user_id = $1 ORDER BY data_key ASC',
      [userId]
    );
    return (result.rows as { data_key: string; updated_at: number }[]).map(r => ({
      dataKey: r.data_key,
      updatedAt: r.updated_at,
    }));
  } catch (e) {
    console.error('[db-storage] dbListUserData error:', e);
    return [];
  }
}

export async function dbDeleteUserData(userId: string, key?: string): Promise<boolean> {
  try {
    if (key) {
      await execSql('DELETE FROM wujie_user_data WHERE user_id = $1 AND data_key = $2', [userId, key]);
    } else {
      await execSql('DELETE FROM wujie_user_data WHERE user_id = $1', [userId]);
    }
    return true;
  } catch (e) {
    console.error('[db-storage] dbDeleteUserData error:', e);
    return false;
  }
}

// ─── System Settings ─────────────────────────────────────────────────────────

export async function dbGetSystemSetting(key: string): Promise<unknown> {
  try {
    const result = await execSql(
      'SELECT value FROM wujie_system_settings WHERE key = $1',
      [key]
    );
    return (result.rows as { value: unknown }[])[0]?.value || null;
  } catch (e) {
    console.error('[db-storage] dbGetSystemSetting error:', e);
    return null;
  }
}

export async function dbSetSystemSetting(key: string, value: unknown): Promise<boolean> {
  try {
    await execSql(`
      INSERT INTO wujie_system_settings (key, value, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at
    `, [key, JSON.stringify(value), Date.now()]);
    return true;
  } catch (e) {
    console.error('[db-storage] dbSetSystemSetting error:', e);
    return false;
  }
}

// ─── Convenience wrappers for server-auth.ts ─────────────────────────────────

interface DbUserReadRow {
  id: string;
  name: string;
  password_hash: string;
  credential_hash: string | null;
  role: string;
  status: string;
  product_type?: string | null;
  chat_models?: string[] | string | null;
  image_models?: string[] | string | null;
  daily_token_limit?: number | null;
  monthly_token_limit?: number | null;
  daily_image_limit?: number | null;
  avatar?: string | null;
  nickname?: string | null;
  api_permissions: Record<string, boolean> | string;
  storage_folder: string;
  email?: string;
  group_id?: string | null;
  created_at: string | number;
  updated_at: string | number;
}

type DbUserRecord = Omit<DbUserReadRow, 'created_at' | 'updated_at'> & {
  created_at: number;
  updated_at: number;
};

function parseDatabaseUserTimestamp(value: string | number): number {
  const parsed = typeof value === 'number'
    ? value
    : /^-?(?:0|[1-9]\d*)$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('Invalid database user timestamp.');
  }
  return parsed;
}

function parseJsonField(val: unknown): Record<string, boolean> {
  if (!val) return {};
  if (typeof val === 'object' && !Array.isArray(val)) return val as Record<string, boolean>;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return {}; }
  }
  return {};
}

function parseJsonArrayField(val: unknown): string[] | undefined {
  if (!val) return undefined;
  if (Array.isArray(val)) return val as string[];
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch { /* ignore */ }
  }
  return undefined;
}

export async function dbReadUsers(): Promise<DbUserRecord[]> {
  try {
    const result = await execSql('SELECT * FROM wujie_users ORDER BY created_at ASC');
    return (result.rows as unknown as DbUserReadRow[]).map(row => ({
      ...row,
      credential_hash: row.credential_hash ?? null,
      product_type: row.product_type || undefined,
      chat_models: parseJsonArrayField(row.chat_models),
      image_models: parseJsonArrayField(row.image_models),
      api_permissions: parseJsonField(row.api_permissions),
      group_id: row.group_id || null,
      created_at: parseDatabaseUserTimestamp(row.created_at),
      updated_at: parseDatabaseUserTimestamp(row.updated_at),
    }));
  } catch (e) {
    console.error({ code: 'DB_READ_USERS_FAILED' });
    throw e;
  }
}

export async function dbWriteUsers(users: Array<{
  id: string;
  name: string;
  passwordHash: string;
  credentialHash?: string | null;
  role: string;
  status: string;
  productType?: string | null;
  chatModels?: string[] | null;
  imageModels?: string[] | null;
  dailyTokenLimit?: number | null;
  monthlyTokenLimit?: number | null;
  dailyImageLimit?: number | null;
  avatar?: string | null;
  nickname?: string | null;
  apiPermissions: Record<string, boolean>;
  storageFolder: string;
  email?: string | null;
  groupId?: string | null;
  createdAt: number;
  updatedAt: number;
}>): Promise<boolean> {
  try {
    for (const u of users) {
      await execSql(`
        INSERT INTO wujie_users (id, name, password_hash, credential_hash, role, status, product_type, chat_models, image_models, daily_token_limit, monthly_token_limit, daily_image_limit, avatar, nickname, api_permissions, storage_folder, email, group_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          password_hash = EXCLUDED.password_hash,
          credential_hash = COALESCE(EXCLUDED.credential_hash, wujie_users.credential_hash),
          role = EXCLUDED.role,
          status = EXCLUDED.status,
          product_type = EXCLUDED.product_type,
          chat_models = EXCLUDED.chat_models,
          image_models = EXCLUDED.image_models,
          daily_token_limit = EXCLUDED.daily_token_limit,
          monthly_token_limit = EXCLUDED.monthly_token_limit,
          daily_image_limit = EXCLUDED.daily_image_limit,
          avatar = EXCLUDED.avatar,
          nickname = EXCLUDED.nickname,
          api_permissions = EXCLUDED.api_permissions,
          storage_folder = EXCLUDED.storage_folder,
          email = EXCLUDED.email,
          group_id = EXCLUDED.group_id,
          updated_at = EXCLUDED.updated_at
      `, [
        u.id, u.name, u.passwordHash, u.credentialHash ?? null, u.role, u.status,
        u.productType || null,
        u.chatModels ? JSON.stringify(u.chatModels) : null,
        u.imageModels ? JSON.stringify(u.imageModels) : null,
        u.dailyTokenLimit ?? null,
        u.monthlyTokenLimit ?? null,
        u.dailyImageLimit ?? null,
        u.avatar || null,
        u.nickname || null,
        JSON.stringify(u.apiPermissions), u.storageFolder,
        u.email || null,
        u.groupId || null,
        u.createdAt, u.updatedAt
      ]);
    }
    return true;
  } catch {
    console.error({ code: 'DB_WRITE_USERS_FAILED' });
    return false;
  }
}

// ─── User Groups ─────────────────────────────────────────────────────────────

export interface DbUserGroup {
  id: string;
  name: string;
  product_types: string[];
  credit_quota: number;
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export async function dbReadGroups(): Promise<DbUserGroup[]> {
  try {
    const result = await execSql('SELECT * FROM wujie_user_groups ORDER BY created_at ASC');
    return (result.rows as unknown as Record<string, unknown>[]).map(row => ({
      id: row.id as string,
      name: row.name as string,
      product_types: (Array.isArray(row.product_types) ? row.product_types : []) as string[],
      credit_quota: (row.credit_quota as number) || 0,
      is_active: row.is_active !== false,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    }));
  } catch (e) {
    console.error('[db-storage] dbReadGroups error:', e);
    return [];
  }
}

export async function dbWriteGroup(group: DbUserGroup): Promise<boolean> {
  try {
    await execSql(`
      INSERT INTO wujie_user_groups (id, name, product_types, credit_quota, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        product_types = EXCLUDED.product_types,
        credit_quota = EXCLUDED.credit_quota,
        is_active = EXCLUDED.is_active,
        updated_at = EXCLUDED.updated_at
    `, [
      group.id, group.name, JSON.stringify(group.product_types),
      group.credit_quota, group.is_active,
      group.created_at, group.updated_at
    ]);
    return true;
  } catch (e) {
    console.error('[db-storage] dbWriteGroup error:', e);
    return false;
  }
}

export async function dbDeleteGroup(groupId: string): Promise<boolean> {
  try {
    await execSql('DELETE FROM wujie_user_groups WHERE id = $1', [groupId]);
    // 清除该分组用户的 group_id
    await execSql('UPDATE wujie_users SET group_id = NULL WHERE group_id = $1', [groupId]);
    return true;
  } catch (e) {
    console.error('[db-storage] dbDeleteGroup error:', e);
    return false;
  }
}

// ─── Migration: file data → database ─────────────────────────────────────────

export async function migrateFileDataToDb(): Promise<void> {
  console.log('[db-storage] Starting file→DB migration...');
  console.log('[db-storage] Safety: Migration only adds missing records, never overwrites existing DB data');
  console.log('[db-storage] wujie_user_data is NOT touched by migration — it is managed by runtime dbSetUserData only');

  // Import file-based storage functions
  const { getServerSystemDir } = await import('./server-data-root');
  const fs = await import('fs/promises');
  const path = await import('path');

  // Migrate users
  try {
    const usersFile = path.join(getServerSystemDir(), 'users.json');
    const usersContent = await fs.readFile(usersFile, 'utf-8');
    const usersData = JSON.parse(usersContent);
    const users = usersData.users || usersData;

    if (Array.isArray(users)) {
      // Only migrate users that don't already exist in DB
      // (prevent stale file data from overwriting newer DB records)
      const existingDbUsers = await dbGetUsers();
      const existingIds = new Set(existingDbUsers.map(u => u.id));
      
      let migrated = 0;
      for (const user of users) {
        if (!existingIds.has(user.id)) {
          const result = await execSql(`
            INSERT INTO wujie_users (
              id, name, password_hash, credential_hash, role, status,
              product_type, chat_models, image_models,
              daily_token_limit, monthly_token_limit, daily_image_limit,
              avatar, nickname, api_permissions, storage_folder, email, group_id,
              created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9,
              $10, $11, $12,
              $13, $14, $15, $16, $17, $18,
              $19, $20
            )
            ON CONFLICT (id) DO NOTHING
          `, [
            user.id,
            user.name,
            user.passwordHash ?? user.password_hash ?? '',
            user.credentialHash ?? user.credential_hash ?? null,
            user.role || 'user',
            user.status || 'active',
            user.productType ?? user.product_type ?? null,
            parseJsonArrayField(user.chatModels ?? user.chat_models) ?? null,
            parseJsonArrayField(user.imageModels ?? user.image_models) ?? null,
            user.dailyTokenLimit ?? user.daily_token_limit ?? null,
            user.monthlyTokenLimit ?? user.monthly_token_limit ?? null,
            user.dailyImageLimit ?? user.daily_image_limit ?? null,
            user.avatar ?? null,
            user.nickname ?? null,
            JSON.stringify(parseJsonField(user.apiPermissions ?? user.api_permissions)),
            user.storageFolder ?? user.storage_folder ?? `data/users/${user.id}`,
            user.email ?? null,
            user.groupId ?? user.group_id ?? null,
            user.createdAt ?? user.created_at ?? Date.now(),
            user.updatedAt ?? user.updated_at ?? Date.now(),
          ]);
          if (result.rowCount > 0) migrated++;
        }
      }
      console.log(`[db-storage] Migrated ${migrated} new users (${existingDbUsers.length} already in DB)`);
    }
  } catch {
    // File may not exist, that's OK
  }


  // Reverse sync: write DB users back to persistent file if file is missing any
  try {
    const allDbUsers = await dbGetUsers();
    if (allDbUsers.length > 0) {
      const usersFilePath = path.join(getServerSystemDir(), 'users.json');
      let fileUsersData: { users: Record<string, unknown>[] } = { users: [] };
      try {
        const existingContent = await fs.readFile(usersFilePath, 'utf-8');
        fileUsersData = JSON.parse(existingContent);
      } catch { /* file may not exist yet */ }
      const fileUsers = fileUsersData.users || [];
      const fileUserIds = new Set(fileUsers.map((u) => String(u.id)));
      const missingInFile = allDbUsers.filter((u) => !fileUserIds.has(String(u.id)));
      if (missingInFile.length > 0) {
        console.log(`[Migration] Syncing ${missingInFile.length} DB users back to file: ${usersFilePath}`);
        for (const dbu of missingInFile) {
          fileUsers.push({
            id: dbu.id,
            name: dbu.name,
            passwordHash: dbu.password_hash,
            credentialHash: dbu.credential_hash ?? undefined,
            role: dbu.role,
            status: dbu.status,
            productType: dbu.product_type || undefined,
            groupId: dbu.group_id || undefined,
            chatModels: parseJsonArrayField(dbu.chat_models),
            imageModels: parseJsonArrayField(dbu.image_models),
            dailyTokenLimit: dbu.daily_token_limit ?? undefined,
            monthlyTokenLimit: dbu.monthly_token_limit ?? undefined,
            dailyImageLimit: dbu.daily_image_limit ?? undefined,
            avatar: dbu.avatar || undefined,
            nickname: dbu.nickname || undefined,
            apiPermissions: parseJsonField(dbu.api_permissions),
            storageFolder: dbu.storage_folder,
            email: dbu.email || undefined,
            createdAt: parseDatabaseUserTimestamp(dbu.created_at),
            updatedAt: parseDatabaseUserTimestamp(dbu.updated_at),
          });
        }
        fileUsersData.users = fileUsers;
        const fsSync = await import('fs');
        fsSync.writeFileSync(usersFilePath, JSON.stringify(fileUsersData, null, 2));
      }
    }
  } catch (revErr) {
    console.warn('[Migration] Reverse sync users DB→file failed:', (revErr as Error).message);
  }

  // Migrate API providers
  try {
    const providersFile = path.join(getServerSystemDir(), 'api-providers.json');
    const providersContent = await fs.readFile(providersFile, 'utf-8');
    const providers = JSON.parse(providersContent);

    if (Array.isArray(providers)) {
      // Only migrate providers that don't already exist in DB
      // (prevent stale file data from overwriting newer DB records, e.g. updated selectedModels)
      const existingDbProviders = await dbGetApiProviders();
      const existingIds = new Set(existingDbProviders.map(p => p.id));

      let migrated = 0;
      for (const p of providers) {
        if (!existingIds.has(p.id)) {
          await dbUpsertApiProvider({
            id: p.id,
            name: p.name,
            display_name: p.displayName || p.display_name || p.name,
            base_url: p.baseUrl || p.base_url || '',
            api_key: p.apiKey || p.api_key || '',
            is_enabled: p.isEnabled ?? p.is_enabled ?? true,
            type: p.type || 'image',
            model_type: p.modelType || p.model_type || p.type || 'image',
            request_style: p.requestStyle || p.request_style || 'images-generations',
            selected_models: p.selectedModels || p.selected_models || [],
            advanced_params: p.advancedParams || p.advanced_params || {},
            is_default: p.isDefault ?? p.is_default ?? false,
            created_at: p.createdAt || p.created_at || Date.now(),
            updated_at: p.updatedAt || p.updated_at || Date.now(),
            connection_status: p.connectionStatus || p.connection_status,
            discovered_models: p.discoveredModels || p.discovered_models || [],
          });
          migrated++;
        }
      }
      console.log(`[db-storage] Migrated ${migrated} new API providers (${existingDbProviders.length} already in DB)`);
    }
  } catch {
    // File may not exist, that's OK
  }

  // Reverse sync: write DB API providers back to persistent file if file is missing any
  try {
    const allDbProviders = await dbGetApiProviders();
    if (allDbProviders.length > 0) {
      const providersFilePath = path.join(getServerSystemDir(), 'api-providers.json');
      let fileProvidersData: unknown[] = [];
      let providersFileObj: Record<string, unknown> = {};
      try {
        const existingContent = await fs.readFile(providersFilePath, 'utf-8');
        const parsed = JSON.parse(existingContent);
        if (Array.isArray(parsed)) {
          fileProvidersData = parsed;
          providersFileObj = { providers: parsed };
        } else {
          fileProvidersData = (parsed as Record<string, unknown[]>).providers || [];
          providersFileObj = parsed;
        }
      } catch { /* file may not exist yet */ }
      const fileProviderIds = new Set(fileProvidersData.map((p: unknown) => String(((p as Record<string, unknown>)?.id) ?? '')));
      const missingInFile = allDbProviders.filter((p) => !fileProviderIds.has(String(p.id)));
      if (missingInFile.length > 0) {
        console.log(`[Migration] Syncing ${missingInFile.length} DB API providers back to file`);
        for (const dbp of missingInFile) {
          fileProvidersData.push(dbp as unknown as Record<string, unknown>);
        }
        (providersFileObj as Record<string, unknown>).providers = fileProvidersData;
        const fsSync = await import('fs');
        fsSync.writeFileSync(providersFilePath, JSON.stringify(providersFileObj, null, 2));
      }
    }
  } catch (revErr) {
    console.warn('[Migration] Reverse sync API providers DB→file failed:', (revErr as Error).message);
  }

  console.log('[db-storage] Migration complete');
}

// ─── Orphaned User Recovery (孤立用户恢复) ────────────────────────────────────
// Detects users that have data in wujie_user_data but no record in wujie_users
// This can happen if: (1) user records were accidentally deleted, (2) DB table was reset

export interface OrphanedUser {
  userId: string;
  dataKeys: string[];
  recovered: boolean;
}

export async function detectAndRecoverOrphanedUsers(): Promise<OrphanedUser[]> {
  try {
    // Find all distinct user_ids in wujie_user_data that don't exist in wujie_users
    const orphans = await execSql(
      `SELECT DISTINCT ud.user_id, 
              array_agg(ud.data_key) as data_keys,
              MAX(ud.updated_at) as last_active
       FROM wujie_user_data ud
       LEFT JOIN wujie_users u ON ud.user_id = u.id
       WHERE u.id IS NULL
       GROUP BY ud.user_id
       ORDER BY last_active DESC`,
      []
    );

    if (!orphans.rows || orphans.rows.length === 0) {
      return [];
    }

    console.warn(`[db-storage] Found ${orphans.rows.length} orphaned user(s) with data but no account record`);

    const results: OrphanedUser[] = [];

    for (const row of orphans.rows) {
      const userId = String(row.user_id ?? '');
      const dataKeys = Array.isArray(row.data_keys) ? row.data_keys.map(String) : [];
      let recovered = false;

      // Try to extract username from user_id (format: user_{timestamp}_{random})
      const userName = userId.replace(/^user_\d+_/, '') || userId;

      // Keep recovered accounts disabled with a random, unrecoverable password.
      // An administrator must reset the password before re-enabling the account.
      try {
        const crypto = await import('crypto');
        const secret = process.env.WUJIE_AUTH_SECRET || process.env.NEXTAUTH_SECRET || crypto.randomBytes(32).toString('base64url');
        const tempPassword = crypto.randomBytes(48).toString('base64url');
        const tempPasswordHash = crypto.createHash('sha256')
          .update(`${secret}:${tempPassword}`)
          .digest('hex');

        const now = Date.now();
        await execSql(
          `INSERT INTO wujie_users (id, name, password_hash, role, status, api_permissions, storage_folder, created_at, updated_at)
           VALUES ($1, $2, $3, 'user', 'disabled', '[]', $4, $5, $5)
           ON CONFLICT (id) DO NOTHING`,
          [userId, userName, tempPasswordHash, `user_${userName}`, now]
        );
        recovered = true;
        console.warn(`[db-storage] Recovered orphaned user as disabled: ${userId} (name: ${userName})`);
      } catch (err) {
        console.error(`[db-storage] Failed to recover orphaned user ${userId}:`, err);
      }

      results.push({ userId, dataKeys, recovered });
    }

    return results;
  } catch (err) {
    console.error('[db-storage] Error detecting orphaned users:', err);
    return [];
  }
}

// ─── Brand Assets (品牌资产持久化) ────────────────────────────────────────────

export interface DbBrandAsset {
  id: string;
  user_id: string;
  name: string;
  brand_name: string;
  brand_colors: string[];
  style_extra: string;
  scene_desc: string;
  reference_image_url: string;
  product_image_url: string;
  product_desc: string;
  main_text: string;
  secondary_text: string;
  accent_symbol: string;
  selected_model: string;
  is_default: boolean;
  created_at: number;
  updated_at: number;
}

export async function dbGetBrandAssets(userId: string): Promise<DbBrandAsset[]> {
  try {
    const result = await execSql(
      'SELECT * FROM wujie_brand_assets WHERE user_id = $1 ORDER BY is_default DESC, updated_at DESC',
      [userId]
    );
    return (result.rows as unknown as DbBrandAsset[]).map(row => ({
      ...row,
      brand_colors: typeof row.brand_colors === 'string' ? JSON.parse(row.brand_colors as string) : (row.brand_colors || []),
    }));
  } catch (e) {
    console.error('[db-storage] dbGetBrandAssets error:', e);
    return [];
  }
}

export async function dbGetBrandAsset(id: string): Promise<DbBrandAsset | null> {
  try {
    const result = await execSql('SELECT * FROM wujie_brand_assets WHERE id = $1', [id]);
    const row = (result.rows as unknown as DbBrandAsset[])[0];
    if (!row) return null;
    return {
      ...row,
      brand_colors: typeof row.brand_colors === 'string' ? JSON.parse(row.brand_colors as string) : (row.brand_colors || []),
    };
  } catch (e) {
    console.error('[db-storage] dbGetBrandAsset error:', e);
    return null;
  }
}

export async function dbUpsertBrandAsset(asset: DbBrandAsset): Promise<boolean> {
  try {
    await execSql(`
      INSERT INTO wujie_brand_assets (id, user_id, name, brand_name, brand_colors, style_extra, scene_desc, reference_image_url, product_image_url, product_desc, main_text, secondary_text, accent_symbol, selected_model, is_default, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        brand_name = EXCLUDED.brand_name,
        brand_colors = EXCLUDED.brand_colors,
        style_extra = EXCLUDED.style_extra,
        scene_desc = EXCLUDED.scene_desc,
        reference_image_url = EXCLUDED.reference_image_url,
        product_image_url = EXCLUDED.product_image_url,
        product_desc = EXCLUDED.product_desc,
        main_text = EXCLUDED.main_text,
        secondary_text = EXCLUDED.secondary_text,
        accent_symbol = EXCLUDED.accent_symbol,
        selected_model = EXCLUDED.selected_model,
        is_default = EXCLUDED.is_default,
        updated_at = EXCLUDED.updated_at
    `, [
      asset.id, asset.user_id, asset.name, asset.brand_name,
      JSON.stringify(asset.brand_colors || []),
      asset.style_extra, asset.scene_desc,
      asset.reference_image_url, asset.product_image_url,
      asset.product_desc, asset.main_text, asset.secondary_text,
      asset.accent_symbol, asset.selected_model,
      asset.is_default, asset.created_at, asset.updated_at,
    ]);
    return true;
  } catch (e) {
    console.error('[db-storage] dbUpsertBrandAsset error:', e);
    return false;
  }
}

export async function dbDeleteBrandAsset(id: string): Promise<boolean> {
  try {
    await execSql('DELETE FROM wujie_brand_assets WHERE id = $1', [id]);
    return true;
  } catch (e) {
    console.error('[db-storage] dbDeleteBrandAsset error:', e);
    return false;
  }
}

export async function dbSetDefaultBrandAsset(userId: string, id: string): Promise<boolean> {
  try {
    // Use a transaction to ensure atomicity — if the second UPDATE fails,
    // the first UPDATE (unsetting all defaults) gets rolled back too
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE wujie_brand_assets SET is_default = FALSE, updated_at = $1 WHERE user_id = $2', [Date.now(), userId]);
      await client.query('UPDATE wujie_brand_assets SET is_default = TRUE, updated_at = $1 WHERE id = $2 AND user_id = $3', [Date.now(), id, userId]);
      await client.query('COMMIT');
      return true;
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('[db-storage] dbSetDefaultBrandAsset error:', e);
    return false;
  }
}

// ─── Brand Kits (品牌构件) ──────────────────────────────────────────────────

export interface DbBrandKit {
  id: string;
  name: string;
  description: string;
  brand_dna: string; // JSON string of BrandDNAType
  colors: string; // JSON string of { primary, secondary[], accent, neutral }
  font_style: string;
  style_keywords: string; // JSON string of string[]
  reference_images: string; // JSON string of string[]
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export async function dbListBrandKits(): Promise<DbBrandKit[]> {
  try {
    const { rows } = await execSql(
      'SELECT * FROM wujie_brand_kits ORDER BY is_default DESC, updated_at DESC'
    );
    return rows as unknown as DbBrandKit[];
  } catch (e) {
    console.error('[db-storage] dbListBrandKits error:', e);
    return [];
  }
}

export async function dbGetBrandKit(id: string): Promise<DbBrandKit | null> {
  try {
    const { rows } = await execSql('SELECT * FROM wujie_brand_kits WHERE id = $1', [id]);
    return (rows[0] as unknown as DbBrandKit) || null;
  } catch (e) {
    console.error('[db-storage] dbGetBrandKit error:', e);
    return null;
  }
}

export async function dbUpsertBrandKit(kit: Partial<DbBrandKit> & { id: string }): Promise<DbBrandKit | null> {
  try {
    const now = Date.now();
    const existing = await dbGetBrandKit(kit.id);
    if (existing) {
      const { rows } = await execSql(
        `UPDATE wujie_brand_kits SET name = $1, description = $2, brand_dna = $3, colors = $4, font_style = $5, style_keywords = $6, reference_images = $7, is_default = $8, updated_at = $9 WHERE id = $10 RETURNING *`,
        [
          kit.name ?? existing.name,
          kit.description ?? existing.description,
          kit.brand_dna ?? existing.brand_dna,
          kit.colors ?? existing.colors,
          kit.font_style ?? existing.font_style,
          kit.style_keywords ?? existing.style_keywords,
          kit.reference_images ?? existing.reference_images,
          kit.is_default ?? existing.is_default,
          now,
          kit.id,
        ]
      );
      return (rows[0] as unknown as DbBrandKit) || null;
    } else {
      const { rows } = await execSql(
        `INSERT INTO wujie_brand_kits (id, name, description, brand_dna, colors, font_style, style_keywords, reference_images, is_default, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          kit.id,
          kit.name || '',
          kit.description || '',
          kit.brand_dna || '{}',
          kit.colors || '{}',
          kit.font_style || 'sans-serif',
          kit.style_keywords || '[]',
          kit.reference_images || '[]',
          kit.is_default || false,
          now,
          now,
        ]
      );
      return (rows[0] as unknown as DbBrandKit) || null;
    }
  } catch (e) {
    console.error('[db-storage] dbUpsertBrandKit error:', e);
    return null;
  }
}

export async function dbDeleteBrandKit(id: string): Promise<boolean> {
  try {
    const { rowCount } = await execSql('DELETE FROM wujie_brand_kits WHERE id = $1', [id]);
    return rowCount > 0;
  } catch (e) {
    console.error('[db-storage] dbDeleteBrandKit error:', e);
    return false;
  }
}

// ─── E-commerce Templates (动态模板管理) ──────────────────────────────────────

export interface DbEcomTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  prompt_template: string;
  negative_prompt: string;
  aspect_ratio: string;
  category: string;
  fidelity_anchor: string;
  sort_order: number;
  is_enabled: boolean;
  is_builtin: boolean;
  created_at: number;
  updated_at: number;
}

export async function dbGetEcomTemplates(enabledOnly = false): Promise<DbEcomTemplate[]> {
  try {
    const sql = enabledOnly
      ? 'SELECT * FROM wujie_ecom_templates WHERE is_enabled = TRUE ORDER BY sort_order ASC, created_at ASC'
      : 'SELECT * FROM wujie_ecom_templates ORDER BY sort_order ASC, created_at ASC';
    const result = await execSql(sql);
    return result.rows as unknown as DbEcomTemplate[];
  } catch (e) {
    console.error('[db-storage] dbGetEcomTemplates error:', e);
    return [];
  }
}

export async function dbGetEcomTemplate(id: string): Promise<DbEcomTemplate | null> {
  try {
    const result = await execSql('SELECT * FROM wujie_ecom_templates WHERE id = $1', [id]);
    return (result.rows as unknown as DbEcomTemplate[])[0] || null;
  } catch (e) {
    console.error('[db-storage] dbGetEcomTemplate error:', e);
    return null;
  }
}

export async function dbUpsertEcomTemplate(tpl: DbEcomTemplate): Promise<boolean> {
  try {
    await execSql(`
      INSERT INTO wujie_ecom_templates (id, name, icon, description, prompt_template, negative_prompt, aspect_ratio, category, fidelity_anchor, sort_order, is_enabled, is_builtin, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        icon = EXCLUDED.icon,
        description = EXCLUDED.description,
        prompt_template = EXCLUDED.prompt_template,
        negative_prompt = EXCLUDED.negative_prompt,
        aspect_ratio = EXCLUDED.aspect_ratio,
        category = EXCLUDED.category,
        fidelity_anchor = EXCLUDED.fidelity_anchor,
        sort_order = EXCLUDED.sort_order,
        is_enabled = EXCLUDED.is_enabled,
        updated_at = EXCLUDED.updated_at
    `, [
      tpl.id, tpl.name, tpl.icon, tpl.description,
      tpl.prompt_template, tpl.negative_prompt,
      tpl.aspect_ratio, tpl.category, tpl.fidelity_anchor,
      tpl.sort_order, tpl.is_enabled, tpl.is_builtin,
      tpl.created_at, tpl.updated_at,
    ]);
    return true;
  } catch (e) {
    console.error('[db-storage] dbUpsertEcomTemplate error:', e);
    return false;
  }
}

export async function dbDeleteEcomTemplate(id: string): Promise<boolean> {
  try {
    // Don't allow deleting built-in templates
    const tpl = await dbGetEcomTemplate(id);
    if (tpl?.is_builtin) {
      console.warn('[db-storage] Cannot delete built-in template:', id);
      return false;
    }
    await execSql('DELETE FROM wujie_ecom_templates WHERE id = $1', [id]);
    return true;
  } catch (e) {
    console.error('[db-storage] dbDeleteEcomTemplate error:', e);
    return false;
  }
}

export async function dbBatchUpdateEcomTemplateOrder(orders: Array<{ id: string; sortOrder: number }>): Promise<boolean> {
  try {
    for (const { id, sortOrder } of orders) {
      await execSql('UPDATE wujie_ecom_templates SET sort_order = $1, updated_at = $2 WHERE id = $3', [sortOrder, Date.now(), id]);
    }
    return true;
  } catch (e) {
    console.error('[db-storage] dbBatchUpdateEcomTemplateOrder error:', e);
    return false;
  }
}

// ═══ Brand Factory (品牌工厂) ═══

export interface DbBrandProject {
  id: string;
  project_name: string;
  brand_name: string;
  industry: string;
  project_type: string;
  keywords: string;    // JSON array
  target_audience: string;
  tone: string;
  description: string;
  logo_url: string;
  product_url: string;
  ip_url: string;
  reference_urls: string;  // JSON array
  brand_dna: string;       // JSON object
  creative_directions: string; // JSON array
  status: string;
  is_archived: boolean;
  created_at: number;
  updated_at: number;
}

export interface DbBrandMaterial {
  id: string;
  project_id: string;
  direction_id: string;
  material_type: string;
  title: string;
  ratio: string;
  image_url: string;
  prompt: string;
  score: number;
  status: string;
  created_at: number;
}

/** Allowed columns for brand_projects table (SQL injection prevention) */
const BRAND_PROJECT_COLUMNS = new Set([
  'id', 'project_name', 'brand_name', 'industry', 'project_type',
  'keywords', 'target_audience', 'tone', 'description',
  'logo_url', 'product_url', 'ip_url', 'reference_urls',
  'brand_dna', 'creative_directions', 'status', 'is_archived',
  'created_at', 'updated_at',
]);

/** Allowed columns for brand_materials table (SQL injection prevention) */
const BRAND_MATERIAL_COLUMNS = new Set([
  'id', 'project_id', 'direction_id', 'material_type', 'title', 'ratio',
  'image_url', 'prompt', 'score', 'status', 'created_at',
]);

export async function dbListBrandProjects(): Promise<DbBrandProject[]> {
  try {
    const { rows } = await execSql('SELECT * FROM wujie_brand_projects WHERE is_archived = false ORDER BY updated_at DESC');
    return rows as unknown as DbBrandProject[];
  } catch (e) {
    console.error('[db-storage] dbListBrandProjects error:', e);
    return [];
  }
}

export async function dbGetBrandProject(id: string): Promise<DbBrandProject | null> {
  try {
    const { rows } = await execSql('SELECT * FROM wujie_brand_projects WHERE id = $1', [id]);
    return rows.length > 0 ? rows[0] as unknown as DbBrandProject : null;
  } catch (e) {
    console.error('[db-storage] dbGetBrandProject error:', e);
    return null;
  }
}

export async function dbUpsertBrandProject(project: Partial<DbBrandProject> & { id: string }): Promise<DbBrandProject | null> {
  try {
    const now = Date.now();
    const existing = await dbGetBrandProject(project.id);
    if (existing) {
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      for (const [k, v] of Object.entries(project)) {
        if (k === 'id' || k === 'created_at' || k === 'updated_at' || !BRAND_PROJECT_COLUMNS.has(k)) continue;
        fields.push(`${k} = $${idx}`);
        values.push(v);
        idx++;
      }
      fields.push(`updated_at = $${idx}`);
      values.push(now);
      values.push(project.id);
      await execSql(`UPDATE wujie_brand_projects SET ${fields.join(', ')} WHERE id = $${idx + 1}`, values);
    } else {
      const cols = ['id', 'created_at', 'updated_at'];
      const vals: unknown[] = [project.id, now, now];
      for (const [k, v] of Object.entries(project)) {
        if (k === 'id' || k === 'created_at' || k === 'updated_at' || !BRAND_PROJECT_COLUMNS.has(k)) continue;
        cols.push(k);
        vals.push(v);
    }
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      await execSql(`INSERT INTO wujie_brand_projects (${cols.join(', ')}) VALUES (${placeholders})`, vals);
    }
    return await dbGetBrandProject(project.id);
  } catch (e) {
    console.error('[db-storage] dbUpsertBrandProject error:', e);
    return null;
  }
}

export async function dbDeleteBrandProject(id: string): Promise<boolean> {
  try {
    await execSql('DELETE FROM wujie_brand_materials WHERE project_id = $1', [id]);
    await execSql('DELETE FROM wujie_brand_projects WHERE id = $1', [id]);
    return true;
  } catch (e) {
    console.error('[db-storage] dbDeleteBrandProject error:', e);
    return false;
  }
}

export async function dbListBrandMaterials(projectId: string): Promise<DbBrandMaterial[]> {
  try {
    const { rows } = await execSql('SELECT * FROM wujie_brand_materials WHERE project_id = $1 ORDER BY created_at DESC', [projectId]);
    return rows as unknown as DbBrandMaterial[];
  } catch (e) {
    console.error('[db-storage] dbListBrandMaterials error:', e);
    return [];
  }
}

export async function dbUpsertBrandMaterial(material: Partial<DbBrandMaterial> & { id: string; project_id: string }): Promise<DbBrandMaterial | null> {
  try {
    const now = Date.now();
    const existing = await execSql('SELECT id FROM wujie_brand_materials WHERE id = $1', [material.id]);
    if (existing.rowCount && existing.rowCount > 0) {
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      for (const [k, v] of Object.entries(material)) {
        if (k === 'id' || !BRAND_MATERIAL_COLUMNS.has(k)) continue;
        fields.push(`${k} = $${idx}`);
        values.push(v);
        idx++;
      }
      values.push(material.id);
      await execSql(`UPDATE wujie_brand_materials SET ${fields.join(', ')} WHERE id = $${idx}`, values);
    } else {
      const cols = ['id', 'created_at'];
      const vals: unknown[] = [material.id, now];
      for (const [k, v] of Object.entries(material)) {
        if (k === 'id' || !BRAND_MATERIAL_COLUMNS.has(k)) continue;
        cols.push(k);
        vals.push(v);
      }
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      await execSql(`INSERT INTO wujie_brand_materials (${cols.join(', ')}) VALUES (${placeholders})`, vals);
    }
    const { rows } = await execSql('SELECT * FROM wujie_brand_materials WHERE id = $1', [material.id]);
    return rows.length > 0 ? rows[0] as unknown as DbBrandMaterial : null;
  } catch (e) {
    console.error('[db-storage] dbUpsertBrandMaterial error:', e);
    return null;
  }
}

export async function dbDeleteBrandMaterial(id: string): Promise<boolean> {
  try {
    await execSql('DELETE FROM wujie_brand_materials WHERE id = $1', [id]);
    return true;
  } catch (e) {
    console.error('[db-storage] dbDeleteBrandMaterial error:', e);
    return false;
  }
}

// ─── Credits ────────────────────────────────────────────────────────────────

interface DbCredits {
  id: string;
  user_id: string;
  balance: number;
  total_recharged: number;
  total_used: number;
  created_at: number;
  updated_at: number;
}

interface DbCreditTransaction {
  id: string;
  user_id: string;
  type: 'recharge' | 'consume' | 'refund' | 'admin_adjust';
  amount: number;
  balance_after: number;
  description: string | null;
  reference_id: string | null;
  created_at: number;
}

export async function dbGetCredits(userId: string): Promise<DbCredits | null> {
  try {
    const result = await execSql('SELECT * FROM wujie_credits WHERE user_id = $1', [userId]);
    return (result.rows as unknown as DbCredits[])[0] || null;
  } catch (e) {
    console.error('[db-storage] dbGetCredits error:', e);
    return null;
  }
}

export async function dbInitCredits(userId: string, initialBalance = 0): Promise<DbCredits | null> {
  try {
    const id = `credits_${userId}_${Date.now()}`;
    const now = Date.now();
    const result = await execSql(
      `INSERT INTO wujie_credits (id, user_id, balance, total_recharged, total_used, created_at, updated_at)
       VALUES ($1, $2, $3, $3, 0, $4, $4)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [id, userId, Math.max(0, Math.floor(initialBalance)), now]
    );
    return (result.rows as unknown as DbCredits[])[0] || null;
  } catch (e) {
    console.error('[db-storage] dbInitCredits error:', e);
    return null;
  }
}

export async function dbAdjustCredits(
  userId: string,
  amount: number,
  type: 'recharge' | 'consume' | 'refund' | 'admin_adjust',
  description?: string,
  referenceId?: string
): Promise<{ success: boolean; balance: number; message?: string }> {
  try {
    // Ensure credits row exists first
    let credits = await dbGetCredits(userId);
    if (!credits) {
      credits = await dbInitCredits(userId);
      if (!credits) return { success: false, balance: 0, message: 'Failed to initialize credits' };
    }

    // Use atomic SQL to prevent race conditions (same pattern as consumeCredits)
    // For negative amounts (deductions), check balance sufficiency
    if (amount < 0) {
      const checkResult = await execSql(
        `UPDATE wujie_credits SET balance = balance + $1, updated_at = $2
         WHERE user_id = $3 AND balance + $1 >= 0
         RETURNING balance`,
        [amount, Date.now(), userId]
      );
      if (checkResult.rows.length === 0) {
        return { success: false, balance: (await dbGetCredits(userId))?.balance ?? 0, message: 'Insufficient credits' };
      }
      const newBalance = Number(checkResult.rows[0].balance);

      // Update total_used
      await execSql(
        `UPDATE wujie_credits SET total_used = total_used + $1 WHERE user_id = $2`,
        [Math.abs(amount), userId]
      );

      // Insert transaction record
      const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await execSql(
        `INSERT INTO wujie_credit_transactions (id, user_id, type, amount, balance_after, description, reference_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [txId, userId, type, amount, newBalance, description || null, referenceId || null, Date.now()]
      );

      return { success: true, balance: newBalance };
    }

    // For positive amounts (recharges/refunds), no balance check needed
    const updateResult = await execSql(
      `UPDATE wujie_credits SET balance = balance + $1, updated_at = $2 WHERE user_id = $3 RETURNING balance`,
      [amount, Date.now(), userId]
    );
    if (updateResult.rows.length === 0) {
      return { success: false, balance: 0, message: 'Failed to update credits' };
    }
    const newBalance = Number(updateResult.rows[0].balance);

    // Update total_recharged for positive admin/recharge adjustments
    if (type === 'recharge' || (type === 'admin_adjust' && amount > 0)) {
      await execSql(
        `UPDATE wujie_credits SET total_recharged = total_recharged + $1 WHERE user_id = $2`,
        [amount, userId]
      );
    }

    // Insert transaction record
    const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await execSql(
      `INSERT INTO wujie_credit_transactions (id, user_id, type, amount, balance_after, description, reference_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [txId, userId, type, amount, newBalance, description || null, referenceId || null, Date.now()]
    );

    return { success: true, balance: newBalance };
  } catch (e) {
    console.error('[db-storage] dbAdjustCredits error:', e);
    return { success: false, balance: 0, message: 'Database error' };
  }
}

/**
 * Record a credit transaction WITHOUT modifying the balance.
 * Used after atomic SQL deductions (consumeCredits) to avoid TOCTOU race.
 */
export async function dbRecordCreditTransaction(
  userId: string,
  amount: number,
  type: 'recharge' | 'consume' | 'refund' | 'admin_adjust',
  balanceAfter: number,
  description?: string,
  referenceId?: string
): Promise<void> {
  try {
    const now = Date.now();
    const txId = `tx_${now}_${Math.random().toString(36).slice(2, 8)}`;
    await execSql(
      `INSERT INTO wujie_credit_transactions (id, user_id, type, amount, balance_after, description, reference_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [txId, userId, type, amount, balanceAfter, description || null, referenceId || null, now]
    );
  } catch (e) {
    console.error('[db-storage] dbRecordCreditTransaction error:', e);
  }
}

export async function dbGetCreditTransactions(
  userId: string,
  options?: { type?: string; limit?: number; offset?: number }
): Promise<DbCreditTransaction[]> {
  try {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    let query = 'SELECT * FROM wujie_credit_transactions WHERE user_id = $1';
    const params: unknown[] = [userId];

    if (options?.type) {
      params.push(options.type);
      query += ` AND type = $${params.length}`;
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await execSql(query, params);
    return result.rows as unknown as DbCreditTransaction[];
  } catch (e) {
    console.error('[db-storage] dbGetCreditTransactions error:', e);
    return [];
  }
}

export async function dbGetAllCredits(): Promise<DbCredits[]> {
  try {
    const result = await execSql('SELECT c.*, u.name as user_name FROM wujie_credits c LEFT JOIN wujie_users u ON c.user_id = u.id ORDER BY c.updated_at DESC');
    return result.rows as unknown as DbCredits[];
  } catch (e) {
    console.error('[db-storage] dbGetAllCredits error:', e);
    return [];
  }
}

export async function dbGetRecentTransactions(limit: number = 100): Promise<DbCreditTransaction[]> {
  try {
    const result = await execSql(
      `SELECT t.*, u.name as user_name FROM wujie_credit_transactions t LEFT JOIN wujie_users u ON t.user_id = u.id ORDER BY t.created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows as unknown as DbCreditTransaction[];
  } catch (e) {
    console.error('[db-storage] dbGetRecentTransactions error:', e);
    return [];
  }
}

export async function dbGetUserTransactions(userId: string, limit: number = 100): Promise<DbCreditTransaction[]> {
  try {
    const result = await execSql(
      `SELECT * FROM wujie_credit_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return result.rows as unknown as DbCreditTransaction[];
  } catch (e) {
    console.error('[db-storage] dbGetUserTransactions error:', e);
    return [];
  }
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export interface DbAuditLog {
  id: string;
  user_id: string;
  user_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  ip_address: string | null;
  created_at: number;
  // 扩展字段（可选，向后兼容旧调用方）
  level?: string; // 'info' | 'warn' | 'error' | 'critical'
  error_message?: string | null;
  stack_trace?: string | null;
  request_data?: Record<string, unknown> | null;
  response_status?: number;
  duration_ms?: number;
  model?: string | null;
  provider_id?: string | null;
  resolution_status?: string; // 'none' | 'analyzing' | 'fixing' | 'resolved' | 'wontfix'
  resolution_detail?: string | null;
  resolved_at?: number | null;
  resolved_by?: string | null;
}

function truncateAuditField(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  return value.slice(0, maxLength);
}

export async function dbAddAuditLog(entry: Omit<DbAuditLog, 'id'>): Promise<string> {
  try {
    const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await execSql(
      `INSERT INTO wujie_audit_log (id, user_id, user_name, action, target_type, target_id, detail, ip_address, created_at,
        level, error_message, stack_trace, request_data, response_status, duration_ms, model, provider_id,
        resolution_status, resolution_detail, resolved_at, resolved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [id, truncateAuditField(entry.user_id, 64), truncateAuditField(entry.user_name, 128),
       truncateAuditField(entry.action, 64), truncateAuditField(entry.target_type, 64),
       truncateAuditField(entry.target_id, 128), entry.detail || null,
       truncateAuditField(entry.ip_address, 64), entry.created_at || Date.now(),
       entry.level || 'info', entry.error_message || null, entry.stack_trace || null,
       entry.request_data ? JSON.stringify(entry.request_data) : null,
       entry.response_status || 0, entry.duration_ms || 0,
       entry.model || null, entry.provider_id || null,
       entry.resolution_status || 'none', entry.resolution_detail || null,
       entry.resolved_at || null, entry.resolved_by || null]
    );
    return id;
  } catch (e) {
    console.error('[db-storage] dbAddAuditLog error:', e);
    return '';
  }
}

export async function dbGetAuditLogs(options?: {
  action?: string;
  userId?: string;
  startTime?: number;
  endTime?: number;
  level?: string;
  resolutionStatus?: string;
  model?: string;
  providerId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: DbAuditLog[]; total: number }> {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (options?.action) {
      conditions.push(`action = $${paramIdx++}`);
      params.push(options.action);
    }
    if (options?.userId) {
      conditions.push(`user_id = $${paramIdx++}`);
      params.push(options.userId);
    }
    if (options?.startTime) {
      conditions.push(`created_at >= $${paramIdx++}`);
      params.push(options.startTime);
    }
    if (options?.endTime) {
      conditions.push(`created_at <= $${paramIdx++}`);
      params.push(options.endTime);
    }
    if (options?.level) {
      conditions.push(`level = $${paramIdx++}`);
      params.push(options.level);
    }
    if (options?.resolutionStatus) {
      conditions.push(`resolution_status = $${paramIdx++}`);
      params.push(options.resolutionStatus);
    }
    if (options?.model) {
      conditions.push(`model = $${paramIdx++}`);
      params.push(options.model);
    }
    if (options?.providerId) {
      conditions.push(`provider_id = $${paramIdx++}`);
      params.push(options.providerId);
    }
    if (options?.search) {
      conditions.push(`(detail ILIKE $${paramIdx} OR error_message ILIKE $${paramIdx} OR action ILIKE $${paramIdx} OR user_name ILIKE $${paramIdx})`);
      params.push(`%${options.search}%`);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    // Get total count
    const countResult = await execSql(`SELECT COUNT(*) as count FROM wujie_audit_log ${whereClause}`, params);
    const total = (countResult.rows as { count: number }[])[0]?.count || 0;

    // Get logs
    const result = await execSql(
      `SELECT * FROM wujie_audit_log ${whereClause} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );
    return { logs: result.rows as unknown as DbAuditLog[], total };
  } catch (e) {
    console.error('[db-storage] dbGetAuditLogs error:', e);
    return { logs: [], total: 0 };
  }
}

export async function dbGetAuditStats(): Promise<{
  totalActions: number;
  todayActions: number;
  uniqueUsers: number;
  actionBreakdown: Record<string, number>;
  levelBreakdown: Record<string, number>;
  errorCount: number;
  unresolvedErrorCount: number;
  avgDurationMs: number;
}> {
  try {
    const now = Date.now();
    const todayStart = now - (now % 86400000);

    const [totalRes, todayRes, usersRes, breakdownRes, levelRes, errorRes, unresolvedRes, avgDurRes] = await Promise.all([
      execSql('SELECT COUNT(*) as count FROM wujie_audit_log'),
      execSql('SELECT COUNT(*) as count FROM wujie_audit_log WHERE created_at >= $1', [todayStart]),
      execSql('SELECT COUNT(DISTINCT user_id) as count FROM wujie_audit_log'),
      execSql('SELECT action, COUNT(*) as count FROM wujie_audit_log GROUP BY action ORDER BY count DESC LIMIT 20'),
      execSql('SELECT level, COUNT(*) as count FROM wujie_audit_log GROUP BY level'),
      execSql('SELECT COUNT(*) as count FROM wujie_audit_log WHERE level IN ($1, $2)', ['error', 'critical']),
      execSql('SELECT COUNT(*) as count FROM wujie_audit_log WHERE level IN ($1, $2) AND resolution_status = $3', ['error', 'critical', 'none']),
      execSql('SELECT AVG(duration_ms) as avg FROM wujie_audit_log WHERE duration_ms > 0'),
    ]);

    const breakdown: Record<string, number> = {};
    for (const row of breakdownRes.rows as { action: string; count: number }[]) {
      breakdown[row.action] = row.count;
    }

    const levelBreakdown: Record<string, number> = {};
    for (const row of levelRes.rows as { level: string; count: number }[]) {
      levelBreakdown[row.level] = row.count;
    }

    return {
      totalActions: (totalRes.rows as { count: number }[])[0]?.count || 0,
      todayActions: (todayRes.rows as { count: number }[])[0]?.count || 0,
      uniqueUsers: (usersRes.rows as { count: number }[])[0]?.count || 0,
      actionBreakdown: breakdown,
      levelBreakdown,
      errorCount: (errorRes.rows as { count: number }[])[0]?.count || 0,
      unresolvedErrorCount: (unresolvedRes.rows as { count: number }[])[0]?.count || 0,
      avgDurationMs: Math.round((avgDurRes.rows as { avg: number }[])[0]?.avg || 0),
    };
  } catch (e) {
    console.error('[db-storage] dbGetAuditStats error:', e);
    return { totalActions: 0, todayActions: 0, uniqueUsers: 0, actionBreakdown: {}, levelBreakdown: {}, errorCount: 0, unresolvedErrorCount: 0, avgDurationMs: 0 };
  }
}

/** 更新日志的解决状态 */
export async function dbUpdateAuditLogResolution(
  logId: string,
  resolutionStatus: string,
  resolutionDetail: string,
  resolvedBy: string
): Promise<boolean> {
  try {
    await execSql(
      `UPDATE wujie_audit_log SET resolution_status = $1, resolution_detail = $2, resolved_by = $3, resolved_at = $4 WHERE id = $5`,
      [resolutionStatus, resolutionDetail, resolvedBy, Date.now(), logId]
    );
    return true;
  } catch (e) {
    console.error('[db-storage] dbUpdateAuditLogResolution error:', e);
    return false;
  }
}

/** 批量标记日志解决状态 */
export async function dbBatchUpdateResolution(
  logIds: string[],
  resolutionStatus: string,
  resolutionDetail: string,
  resolvedBy: string
): Promise<number> {
  try {
    const result = await execSql(
      `UPDATE wujie_audit_log SET resolution_status = $1, resolution_detail = $2, resolved_by = $3, resolved_at = $4 WHERE id = ANY($5)`,
      [resolutionStatus, resolutionDetail, resolvedBy, Date.now(), logIds]
    );
    return (result as { rowCount?: number }).rowCount || 0;
  } catch (e) {
    console.error('[db-storage] dbBatchUpdateResolution error:', e);
    return 0;
  }
}

/** 清理指定天数前的旧日志 */
export async function dbCleanOldAuditLogs(olderThanDays: number): Promise<number> {
  try {
    const cutoff = Date.now() - olderThanDays * 86400000;
    const result = await execSql(`DELETE FROM wujie_audit_log WHERE created_at < $1`, [cutoff]);
    return (result as { rowCount?: number }).rowCount || 0;
  } catch (e) {
    console.error('[db-storage] dbCleanOldAuditLogs error:', e);
    return 0;
  }
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

export async function dbGetDashboardStats(periodDays = 7) {
  try {
    const now = Date.now();
    const todayStart = now - (now % 86400000);
    const safePeriod = Number.isFinite(periodDays) && periodDays > 0 ? periodDays : 7;
    const periodStart = now - safePeriod * 86400000;
    const weekStart = now - 7 * 86400000;
    const monthStart = now - 30 * 86400000;

    const [usersRes, creditsRes, todayRes, weekRes, monthRes] = await Promise.all([
      execSql('SELECT COUNT(*) as count FROM wujie_users'),
      execSql('SELECT COALESCE(SUM(total_recharged), 0) as recharged, COALESCE(SUM(total_used), 0) as consumed FROM wujie_credits'),
      execSql('SELECT COUNT(*) as count FROM wujie_users WHERE created_at >= $1', [todayStart]),
      execSql('SELECT COUNT(*) as count FROM wujie_users WHERE created_at >= $1', [weekStart]),
      execSql('SELECT COUNT(*) as count FROM wujie_users WHERE created_at >= $1', [monthStart]),
    ]);

    const [activeTodayRes, activeWeekRes, activeMonthRes] = await Promise.all([
      execSql('SELECT COUNT(DISTINCT user_id) as count FROM wujie_credit_transactions WHERE created_at >= $1', [todayStart]),
      execSql('SELECT COUNT(DISTINCT user_id) as count FROM wujie_credit_transactions WHERE created_at >= $1', [weekStart]),
      execSql('SELECT COUNT(DISTINCT user_id) as count FROM wujie_credit_transactions WHERE created_at >= $1', [monthStart]),
    ]);

    // User trend for the selected period
    const userTrendRes = await execSql(
      `SELECT DATE(TO_TIMESTAMP(created_at / 1000.0)) as day, COUNT(*) as count FROM wujie_users WHERE created_at >= $1 GROUP BY day ORDER BY day`,
      [periodStart]
    );
    const userTrend = (userTrendRes.rows as { day: string; count: number }[]).map(r => ({
      date: r.day,
      count: r.count,
    }));

    // Credit trend for the selected period
    const creditTrendRes = await execSql(
      `SELECT DATE(TO_TIMESTAMP(created_at / 1000.0)) as day, SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income, SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as expense FROM wujie_credit_transactions WHERE created_at >= $1 GROUP BY day ORDER BY day`,
      [periodStart]
    );
    const creditTrend = (creditTrendRes.rows as { day: string; income: number; expense: number }[]).map(r => ({
      date: r.day,
      income: Number(r.income) || 0,
      expense: Number(r.expense) || 0,
    }));

    // Total API calls (from credit transactions in period)
    const apiCallsRes = await execSql(
      `SELECT COUNT(*) as count FROM wujie_credit_transactions WHERE created_at >= $1`,
      [periodStart]
    );
    const totalApiCalls = (apiCallsRes.rows as { count: number }[])[0]?.count || 0;

    // Model usage rank (top 10 by call count) — extract model name from description
    // description format: "图像生成 [model-name] 扣除 N 积分" or operation label
    const modelRankRes = await execSql(
      `SELECT
         CASE
           WHEN reference_id ~ '\\[.+\\]' THEN substring(reference_id FROM '\\[(.+)\\]')
           WHEN description ~ '\\[.+\\]' THEN substring(description FROM '\\[(.+)\\]')
           ELSE COALESCE(split_part(description, ' ', 1), '未知')
         END as model_name,
         COUNT(*) as calls
       FROM wujie_credit_transactions
       WHERE created_at >= $1 AND amount < 0
       GROUP BY model_name
       ORDER BY calls DESC
       LIMIT 10`,
      [periodStart]
    );
    const modelRank = (modelRankRes.rows as { model_name: string; calls: number }[]).map(r => ({
      name: r.model_name || '未知',
      calls: r.calls,
      successRate: 100,
    }));

    // Recent users (last 5)
    const recentUsersRes = await execSql(
      `SELECT name, email, created_at FROM wujie_users ORDER BY created_at DESC LIMIT 5`
    );
    const recentUsers = (recentUsersRes.rows as { name: string; email: string; created_at: number | string }[]).map(r => ({
      name: r.name,
      email: r.email || '-',
      date: (() => { const t = new Date(Number(r.created_at)); return Number.isNaN(t.getTime()) ? '-' : t.toISOString().slice(0, 10); })(),
    }));

    // Provider status from admin API providers
    const providersRes = await execSql(
      `SELECT name, model_type, is_enabled FROM wujie_api_providers ORDER BY name`
    );
    const providerStatus = (providersRes.rows as { name: string; model_type: string; is_enabled: boolean }[]).map(r => ({
      name: r.name,
      type: r.model_type,
      isEnabled: r.is_enabled,
    }));

    // Alerts: disabled providers, no API keys, etc.
    const alerts: { type: string; severity: string; items: { name: string; value: string }[] }[] = [];
    const disabledProviders = providerStatus.filter(p => !p.isEnabled);
    if (disabledProviders.length > 0) {
      alerts.push({ type: 'provider_disabled', severity: 'warning', items: disabledProviders.map(p => ({ name: p.name, value: `${p.type} - 已禁用` })) });
    }
    if (modelRank.length === 0) {
      alerts.push({ type: 'no_usage', severity: 'info', items: [{ name: '模型使用', value: `近${periodDays}天无模型调用记录` }] });
    }

    const creditsRecharged = Number((creditsRes.rows as { recharged: number }[])[0]?.recharged || 0);
    const creditsConsumed = Number((creditsRes.rows as { consumed: number }[])[0]?.consumed || 0);

    // Today's generations count (credit transactions with negative amount in last 24h)
    const todayGenRes = await execSql(
      `SELECT COUNT(*) as count FROM wujie_credit_transactions WHERE created_at >= $1 AND amount < 0`,
      [todayStart]
    );
    const todayGenerations = (todayGenRes.rows as { count: number }[])[0]?.count || 0;

    // Total credits balance
    const creditsBalanceRes = await execSql(
      'SELECT COALESCE(SUM(balance), 0) as total FROM wujie_credits'
    );
    const totalCredits = Number((creditsBalanceRes.rows as { total: number }[])[0]?.total || 0);

    return {
      totalUsers: (usersRes.rows as { count: number }[])[0]?.count || 0,
      weekActive: (activeWeekRes.rows as { count: number }[])[0]?.count || 0,
      totalCredits,
      creditsRecharged,
      creditsConsumed,
      todayGenerations,
      totalApiCalls,
      userTrend,
      creditTrend,
      modelRank,
      providerStatus,
      alerts,
      recentUsers,
    };
  } catch (e) {
    console.error('[db-storage] dbGetDashboardStats error:', e);
    return {
      totalUsers: 0, weekActive: 0, totalCredits: 0, totalApiCalls: 0,
      userTrend: [], creditTrend: [], modelRank: [], providerStatus: [], alerts: [], recentUsers: [],
    };
  }
}
