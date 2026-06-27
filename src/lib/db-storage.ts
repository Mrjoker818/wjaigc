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
  role: string;
  status: string;
  api_permissions: Record<string, boolean>;
  storage_folder: string;
  created_at: number;
  updated_at: number;
}

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

export async function dbUpsertUser(user: DbUser): Promise<boolean> {
  try {
    await execSql(`
      INSERT INTO wujie_users (id, name, password_hash, role, status, api_permissions, storage_folder, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        api_permissions = EXCLUDED.api_permissions,
        storage_folder = EXCLUDED.storage_folder,
        updated_at = EXCLUDED.updated_at
    `, [
      user.id, user.name, user.password_hash, user.role, user.status,
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
      INSERT INTO wujie_api_providers (id, name, display_name, base_url, api_key, is_enabled, type, model_type, request_style, selected_models, advanced_params, is_default, created_at, updated_at, connection_status, discovered_models, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
        sort_order = EXCLUDED.sort_order
    `, [
      provider.id, provider.name, provider.display_name, provider.base_url,
      provider.api_key, provider.is_enabled, provider.type, provider.model_type,
      provider.request_style, JSON.stringify(provider.selected_models),
      JSON.stringify(provider.advanced_params), provider.is_default,
      provider.created_at, provider.updated_at,
      provider.connection_status || null,
      JSON.stringify(provider.discovered_models || []),
      provider.sort_order ?? null,
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
  try {
    // 使用事务保证原子性，避免部分更新
    await execSql('BEGIN');
    for (const { id, sortOrder } of orders) {
      await execSql('UPDATE wujie_api_providers SET sort_order = $1, updated_at = $2 WHERE id = $3', [sortOrder, Date.now(), id]);
    }
    await execSql('COMMIT');
    return true;
  } catch (e) {
    try { await execSql('ROLLBACK'); } catch { /* ignore rollback error */ }
    console.error('[db-storage] dbBatchUpdateProviderOrder error:', e);
    return false;
  }
}

export async function dbEnsureSortOrderColumn(): Promise<void> {
  try {
    await execSql(`ALTER TABLE wujie_api_providers ADD COLUMN IF NOT EXISTS sort_order INTEGER`);
  } catch {
    // Column may already exist
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
  role: string;
  status: string;
  api_permissions: Record<string, boolean>;
  storage_folder: string;
  email?: string;
  created_at: number;
  updated_at: number;
}

export async function dbReadUsers(): Promise<DbUserReadRow[]> {
  try {
    const result = await execSql('SELECT * FROM wujie_users ORDER BY created_at ASC');
    return (result.rows as unknown as DbUserReadRow[]).map(row => ({
      ...row,
      api_permissions: typeof row.api_permissions === 'string' 
        ? JSON.parse(row.api_permissions as string) 
        : (row.api_permissions || {}),
    }));
  } catch (e) {
    console.error('[db-storage] dbReadUsers error:', e);
    throw e;
  }
}

export async function dbWriteUsers(users: Array<{
  id: string;
  name: string;
  passwordHash: string;
  role: string;
  status: string;
  apiPermissions: Record<string, boolean>;
  storageFolder: string;
  email?: string | null;
  createdAt: number;
  updatedAt: number;
}>): Promise<boolean> {
  try {
    // Use UPSERT instead of DELETE ALL + INSERT to prevent data loss.
    // When readStore() reads a partial user list (e.g., from stale file),
    // DELETE ALL would erase users that exist in DB but not in the list.
    for (const u of users) {
      await execSql(`
        INSERT INTO wujie_users (id, name, password_hash, role, status, api_permissions, storage_folder, email, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          password_hash = EXCLUDED.password_hash,
          role = EXCLUDED.role,
          status = EXCLUDED.status,
          api_permissions = EXCLUDED.api_permissions,
          storage_folder = EXCLUDED.storage_folder,
          email = EXCLUDED.email,
          updated_at = EXCLUDED.updated_at
      `, [
        u.id, u.name, u.passwordHash, u.role, u.status,
        JSON.stringify(u.apiPermissions), u.storageFolder,
        u.email || null, u.createdAt, u.updatedAt
      ]);
    }
    return true;
  } catch (e) {
    console.error('[db-storage] dbWriteUsers error:', e);
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
          await dbUpsertUser({
            id: user.id,
            name: user.name,
            password_hash: user.passwordHash || user.password_hash || '',
            role: user.role || 'user',
            status: user.status || 'active',
            api_permissions: user.apiPermissions || user.api_permissions || { image: true, chat: true, threeD: true, imageEdit: true, vectorize: true, layer: true, upscaler: true },
            storage_folder: user.storageFolder || user.storage_folder || `data/users/${user.id}`,
            created_at: user.createdAt || user.created_at || Date.now(),
            updated_at: user.updatedAt || user.updated_at || Date.now(),
          });
          migrated++;
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
          fileUsers.push(dbu as unknown as Record<string, unknown>);
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

      // Create a placeholder user record with known temporary password
      // Use the same authSecret logic as server-auth.ts (inlined to avoid circular dependency)
      try {
        const crypto = await import('crypto');
        const secret = process.env.WUJIE_AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'wujie-ai-stable-auth-secret-fallback-2024';
        const tempPassword = 'wujie_reset_2024';
        const tempPasswordHash = crypto.createHash('sha256')
          .update(`${secret}:${tempPassword}`)
          .digest('hex');

        const now = Date.now();
        await execSql(
          `INSERT INTO wujie_users (id, name, password_hash, role, status, api_permissions, storage_folder, created_at, updated_at)
           VALUES ($1, $2, $3, 'user', 'active', '[]', $4, $5, $5)
           ON CONFLICT (id) DO NOTHING`,
          [userId, userName, tempPasswordHash, `user_${userName}`, now]
        );
        recovered = true;
        console.warn(`[db-storage] Recovered orphaned user: ${userId} (name: ${userName})`);
        console.warn(`[db-storage] Temporary password: ${tempPassword} — User should change password after login`);
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

export async function dbInitCredits(userId: string): Promise<DbCredits | null> {
  try {
    const id = `credits_${userId}_${Date.now()}`;
    const now = Date.now();
    const result = await execSql(
      `INSERT INTO wujie_credits (id, user_id, balance, total_recharged, total_used, created_at, updated_at)
       VALUES ($1, $2, 0, 0, 0, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [id, userId, now, now]
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
    // Ensure credits row exists
    let credits = await dbGetCredits(userId);
    if (!credits) {
      credits = await dbInitCredits(userId);
      if (!credits) return { success: false, balance: 0, message: 'Failed to initialize credits' };
    }

    const newBalance = credits.balance + amount;
    if (newBalance < 0) {
      return { success: false, balance: credits.balance, message: 'Insufficient credits' };
    }

    const now = Date.now();
    // Update credits
    await execSql(
      `UPDATE wujie_credits SET balance = $1, total_recharged = total_recharged + $2, total_used = total_used + $3, updated_at = $4 WHERE user_id = $5`,
      [
        newBalance,
        amount > 0 && (type === 'recharge' || type === 'admin_adjust') ? amount : 0,
        amount < 0 && (type === 'consume' || type === 'admin_adjust') ? Math.abs(amount) : 0,
        now,
        userId,
      ]
    );

    // Insert transaction record
    const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await execSql(
      `INSERT INTO wujie_credit_transactions (id, user_id, type, amount, balance_after, description, reference_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [txId, userId, type, amount, newBalance, description || null, referenceId || null, now]
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
