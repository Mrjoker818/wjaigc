/**
 * Database-backed persistent storage for Wujie AI
 * Uses PostgreSQL (Supabase) to persist data across deployments
 * Falls back to file-based storage if database is unavailable
 */

import { execSql } from './db-client';

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

export async function dbBatchUpdateProviderOrder(orders: Array<{ id: string; sortOrder: number }>): Promise<boolean> {
  try {
    for (const { id, sortOrder } of orders) {
      await execSql('UPDATE wujie_api_providers SET sort_order = $1, updated_at = $2 WHERE id = $3', [sortOrder, Date.now(), id]);
    }
    return true;
  } catch (e) {
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
            api_permissions: user.apiPermissions || user.api_permissions || { image: true, chat: true, threeD: true, imageEdit: true, vectorize: true, layer: true },
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

  // Migrate API providers
  try {
    const providersFile = path.join(getServerSystemDir(), 'api-providers.json');
    const providersContent = await fs.readFile(providersFile, 'utf-8');
    const providers = JSON.parse(providersContent);

    if (Array.isArray(providers)) {
      for (const p of providers) {
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
      }
      console.log(`[db-storage] Migrated ${providers.length} API providers`);
    }
  } catch {
    // File may not exist, that's OK
  }

  console.log('[db-storage] Migration complete');
}
