#!/usr/bin/env node
/**
 * Export deployment seed files from the current database into deploy-seed/system/.
 *
 * Purpose: veFaas deployments run with an isolated, initially-empty database and no
 * persistent volume. On boot, the file->DB migration reads deploy-seed/system (copied
 * into the ephemeral data root by server-data-root.seedBundledSystemFiles) and seeds
 * users + API providers so administrators can log in with their existing credentials.
 *
 * Security: users.json only includes accounts with scrypt credential hashes and strips
 * password_hash material entirely (scrypt verification is independent of it).
 *
 * Usage: node scripts/export-deploy-seed.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

import pg from 'pg';

const connectionString = process.env.PGDATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('PGDATABASE_URL/DATABASE_URL is not set; cannot export seed.');
  process.exit(1);
}

const OUT_DIR = path.join(process.cwd(), 'deploy-seed', 'system');

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    // Password hash material is deliberately stripped: authentication for seeded
    // accounts relies solely on the independent scrypt credential_hash sidecar.
    passwordHash: '',
    credentialHash: row.credential_hash || undefined,
    role: row.role || 'user',
    status: row.status || 'active',
    productType: row.product_type || undefined,
    groupId: row.group_id || undefined,
    chatModels: row.chat_models || undefined,
    imageModels: row.image_models || undefined,
    dailyTokenLimit: row.daily_token_limit ?? undefined,
    monthlyTokenLimit: row.monthly_token_limit ?? undefined,
    dailyImageLimit: row.daily_image_limit ?? undefined,
    avatar: row.avatar || undefined,
    nickname: row.nickname || undefined,
    apiPermissions: row.api_permissions || undefined,
    storageFolder: row.storage_folder || `data/users/${row.id}`,
    email: row.email || undefined,
    createdAt: row.created_at || Date.now(),
    updatedAt: row.updated_at || Date.now(),
  };
}

function mapProvider(row) {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name || row.name,
    baseUrl: row.base_url || '',
    apiKey: row.api_key || '',
    isEnabled: row.is_enabled ?? true,
    type: row.type || 'image',
    modelType: row.model_type || row.type || 'image',
    requestStyle: row.request_style || 'images-generations',
    selectedModels: row.selected_models || [],
    advancedParams: row.advanced_params || {},
    isDefault: row.is_default ?? false,
    createdAt: row.created_at || Date.now(),
    updatedAt: row.updated_at || Date.now(),
    connectionStatus: row.connection_status || undefined,
    discoveredModels: row.discovered_models || [],
  };
}

const client = new pg.Client({ connectionString });
await client.connect();

try {
  const usersResult = await client.query(`
    SELECT id, name, credential_hash, role, status, product_type, group_id,
           chat_models, image_models, daily_token_limit, monthly_token_limit,
           daily_image_limit, avatar, nickname, api_permissions, storage_folder,
           email, created_at, updated_at
    FROM wujie_users
    WHERE credential_hash LIKE 'scrypt-v1%' AND status = 'active'
    ORDER BY updated_at DESC
  `);
  const users = usersResult.rows.map(mapUser);

  const providersResult = await client.query(`
    SELECT id, name, display_name, base_url, api_key, is_enabled, type, model_type,
           request_style, selected_models, advanced_params, is_default, created_at,
           updated_at, connection_status, discovered_models
    FROM wujie_api_providers
    ORDER BY id
  `);
  const providers = providersResult.rows.map(mapProvider);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const usersPath = path.join(OUT_DIR, 'users.json');
  const usersPayload = { users, updatedAt: Date.now() };
  fs.writeFileSync(usersPath, `${JSON.stringify(usersPayload, null, 2)}\n`, { mode: 0o600 });

  const providersPath = path.join(OUT_DIR, 'api-providers.json');
  fs.writeFileSync(providersPath, `${JSON.stringify(providers, null, 2)}\n`, { mode: 0o600 });

  console.log(`[deploy-seed] users: ${users.length} (scrypt-credential active accounts, password hashes stripped)`);
  console.log(`[deploy-seed] providers: ${providers.length}`);
  console.log(`[deploy-seed] written to ${OUT_DIR}`);
} finally {
  await client.end();
}
