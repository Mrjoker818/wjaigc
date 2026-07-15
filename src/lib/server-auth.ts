import 'server-only';

import crypto from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { User } from './user-types';
import { ensureUserDataDirs, getUserDataDir } from './server-user-storage';
import { getServerSystemDir, getServerUsersDir } from './server-data-root';
import { dbReadUsers, dbWriteUsers, dbDeleteUser, dbDeleteUserData } from './db-storage';

/** Normalize api_permissions: PostgreSQL JSONB may return as string or object */
function normalizeApiPermissions(val: unknown): User['apiPermissions'] {
  const defaultPerms = defaultApiPermissions();
  if (!val) return defaultPerms;
  if (typeof val === 'object' && !Array.isArray(val)) {
    // Merge with defaults to ensure all required keys exist
    return { ...defaultPerms, ...(val as Record<string, boolean>) };
  }
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...defaultPerms, ...(parsed as Record<string, boolean>) };
      }
    } catch { /* ignore */ }
  }
  return defaultPerms;
}

function parseJsonArray(val: unknown): string[] | undefined {
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

const SYSTEM_DIR = getServerSystemDir();
const USERS_PATH = path.join(SYSTEM_DIR, 'users.json');

export const WUJIE_SESSION_COOKIE = 'wujie_session';
export const WUJIE_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const DEFAULT_ADMIN_NAME = process.env.WUJIE_ADMIN_USERNAME || 'Mr.joker';
let _defaultAdminPasswordWarned = false;
const DEFAULT_ADMIN_PASSWORD = process.env.WUJIE_ADMIN_PASSWORD || (() => {
  // Security warning: using hardcoded default password. Set WUJIE_ADMIN_PASSWORD env var for production!
  if (process.env.COZE_PROJECT_ENV === 'PROD' && !_defaultAdminPasswordWarned) {
    _defaultAdminPasswordWarned = true;
    console.warn('[SECURITY] WUJIE_ADMIN_PASSWORD not set! Using default password in production. (This warning is logged once)');
  }
  return 'dongdong851212';
})();

type StoredUser = Omit<User, 'password'> & {
  passwordHash: string;
  productType?: string;
  groupId?: string;
  chatModels?: string[];
  imageModels?: string[];
  dailyTokenLimit?: number;
  monthlyTokenLimit?: number;
  dailyImageLimit?: number;
  avatar?: string;
  nickname?: string;
};

interface StoredUsersFile {
  users: StoredUser[];
  updatedAt: number;
}

interface SessionPayload {
  sub: string;
  role: 'admin' | 'user';
  name: string;
  exp: number;
}

function defaultApiPermissions() {
  return {
    image: true,
    chat: true,
    threeD: true,
    imageEdit: true,
    vectorize: true,
    vlm: true,
    layer: true,
    video: true,
    upscaler: true,
    removebg: true,
    audio: true,
  };
}

let _authSecretCache: { value: string; warned: boolean } | null = null;

async function authSecret(): Promise<string> {
  if (_authSecretCache) return _authSecretCache.value;

  // Priority: env var → DB stored secret → hardcoded fallback
  const envSecret = process.env.WUJIE_AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (envSecret) {
    _authSecretCache = { value: envSecret, warned: false };
    // Persist to DB so future deployments can recover even without env var
    try {
      const { dbGetSystemSetting, dbSetSystemSetting } = await import('./db-storage');
      const dbSecret = await dbGetSystemSetting('auth_secret') as string | null;
      if (!dbSecret) {
        await dbSetSystemSetting('auth_secret', envSecret);
      }
    } catch { /* non-critical */ }
    return envSecret;
  }

  // Try to recover from DB (persists across redeployments)
  try {
    const { dbGetSystemSetting, dbSetSystemSetting } = await import('./db-storage');
    const dbSecret = await dbGetSystemSetting('auth_secret') as string | null;
    if (dbSecret) {
      _authSecretCache = { value: dbSecret, warned: false };
      return dbSecret;
    }
    // No env var and no DB secret → first deployment with fallback, persist it
    const fallback = 'wujie-ai-stable-auth-secret-fallback-2024';
    await dbSetSystemSetting('auth_secret', fallback);
    _authSecretCache = { value: fallback, warned: false };
    if (process.env.COZE_PROJECT_ENV === 'PROD' && !_authSecretCache.warned) {
      _authSecretCache.warned = true;
      console.warn('[SECURITY] WUJIE_AUTH_SECRET/NEXTAUTH_SECRET not set! Using default secret. Set env var for production. (This warning is logged once per process)');
    }
    return fallback;
  } catch {
    // DB not available, use fallback
  }

  const fallback = 'wujie-ai-stable-auth-secret-fallback-2024';
  _authSecretCache = { value: fallback, warned: false };

  if (process.env.COZE_PROJECT_ENV === 'PROD' && !_authSecretCache.warned) {
    _authSecretCache.warned = true;
    console.warn('[SECURITY] WUJIE_AUTH_SECRET/NEXTAUTH_SECRET not set! Using default secret. Set env var for production. (This warning is logged once per process)');
  }
  return fallback;
}

/**
 * Legacy auth secrets used in previous deployments.
 * When a user's password hash doesn't match the current secret,
 * we try these legacy secrets. If matched, the hash is auto-migrated
 * to the current secret so subsequent logins use the fast path.
 */
const LEGACY_AUTH_SECRETS = [
  'wujie-local-session-secret', // Original fallback (pre-v3.0)
];

function hashPasswordWithSecret(password: string, secret: string): string {
  return crypto.createHash('sha256').update(`${secret}:${password}`).digest('hex');
}

async function hashPassword(password: string): Promise<string> {
  return hashPasswordWithSecret(password, await authSecret());
}

/**
 * Verify a password against a stored hash, trying the current secret first
 * and then falling back to legacy secrets.
 * Returns { matched, needsMigration } - if needsMigration is true,
 * the password hash should be re-hashed with the current secret.
 * Must be called after authSecret() has been called at least once (cache populated).
 */
function verifyPassword(password: string, storedHash: string, currentSecret: string): { matched: boolean; needsMigration: boolean } {
  // Fast path: current secret
  if (hashPasswordWithSecret(password, currentSecret) === storedHash) {
    return { matched: true, needsMigration: false };
  }
  // Legacy secrets: try each one
  for (const legacySecret of LEGACY_AUTH_SECRETS) {
    if (hashPasswordWithSecret(password, legacySecret) === storedHash) {
      return { matched: true, needsMigration: true };
    }
  }
  return { matched: false, needsMigration: false };
}

async function hmac(value: string): Promise<string> {
  return crypto.createHmac('sha256', await authSecret()).update(value).digest('base64url');
}

function storageFolder(userId: string): string {
  return `data/users/${userId}`;
}

export function isRootAdminUser(user: User | null | undefined): boolean {
  return Boolean(user && user.role === 'admin' && user.name === DEFAULT_ADMIN_NAME);
}

function safeId(value: string | undefined, fallbackName: string): string {
  const raw = value || fallbackName.toLowerCase().replace(/[^a-z0-9_-]+/gi, '_');
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return cleaned || `user_${Date.now()}`;
}

function publicUser(user: StoredUser): User {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    status: user.status,
    productType: user.productType,
    groupId: user.groupId,
    chatModels: user.chatModels,
    imageModels: user.imageModels,
    dailyTokenLimit: user.dailyTokenLimit,
    monthlyTokenLimit: user.monthlyTokenLimit,
    dailyImageLimit: user.dailyImageLimit,
    avatar: user.avatar,
    nickname: user.nickname,
    apiPermissions: user.apiPermissions || defaultApiPermissions(),
    storageFolder: storageFolder(user.id),
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function normalizeStoredUser(user: StoredUser): StoredUser {
  return {
    ...user,
    role: user.role || 'user',
    status: user.status || 'active',
    productType: user.productType || undefined,
    groupId: user.groupId || undefined,
    chatModels: user.chatModels || undefined,
    imageModels: user.imageModels || undefined,
    dailyTokenLimit: user.dailyTokenLimit ?? undefined,
    monthlyTokenLimit: user.monthlyTokenLimit ?? undefined,
    dailyImageLimit: user.dailyImageLimit ?? undefined,
    avatar: user.avatar || undefined,
    nickname: user.nickname || undefined,
    apiPermissions: user.apiPermissions || defaultApiPermissions(),
    storageFolder: storageFolder(user.id),
    updatedAt: user.updatedAt || Date.now(),
  };
}

async function writeStore(file: StoredUsersFile): Promise<void> {
  const data = { ...file, updatedAt: Date.now() };
  // Write to file (backward compatible)
  await mkdir(SYSTEM_DIR, { recursive: true });
  await writeFile(USERS_PATH, JSON.stringify(data, null, 2), 'utf8');
  // Safety: ensure we don't lose DB users that aren't in the current write list
  try {
    const dbUsers = await dbReadUsers();
    const writeUserIds = new Set(data.users.map(u => u.id));
    const missingFromWrite = (dbUsers || []).filter(u => !writeUserIds.has(u.id) && u.name !== DEFAULT_ADMIN_NAME);
    if (missingFromWrite.length > 0) {
      console.warn(`[auth] ⚠️ writeStore: ${missingFromWrite.length} DB user(s) not in write list, preserving:`,
        missingFromWrite.map(u => `${u.id}(${u.name})`).join(', '));
      for (const u of missingFromWrite) {
        data.users.push(normalizeStoredUser({
          id: u.id, name: u.name, passwordHash: u.password_hash,
          role: (u.role || 'user') as 'admin' | 'user',
          status: (u.status || 'active') as 'active' | 'disabled',
          productType: u.product_type || undefined,
          groupId: u.group_id || undefined,
          chatModels: u.chat_models ? (Array.isArray(u.chat_models) ? u.chat_models : parseJsonArray(u.chat_models)) : undefined,
          imageModels: u.image_models ? (Array.isArray(u.image_models) ? u.image_models : parseJsonArray(u.image_models)) : undefined,
          dailyTokenLimit: u.daily_token_limit ?? undefined,
          monthlyTokenLimit: u.monthly_token_limit ?? undefined,
          dailyImageLimit: u.daily_image_limit ?? undefined,
          avatar: u.avatar || undefined,
          nickname: u.nickname || undefined,
          apiPermissions: normalizeApiPermissions(u.api_permissions),
          storageFolder: u.storage_folder || storageFolder(u.id),
          email: u.email || undefined,
          createdAt: u.created_at, updatedAt: u.updated_at,
        }));
      }
      // Re-write file with supplemented users to keep persistent storage in sync
      try {
        await writeFile(USERS_PATH, JSON.stringify(data, null, 2), 'utf8');
      } catch (rewriteErr) {
        console.error('[auth] Failed to re-write users file after DB supplement:', rewriteErr);
      }
    }
  } catch {
    // DB check failed, proceed with write (UPSERT is safe)
  }
  // Write to database (persistent) - uses UPSERT to prevent data loss
  await dbWriteUsers(data.users.map(u => ({
    id: u.id,
    name: u.name,
    passwordHash: u.passwordHash,
    role: u.role || 'user',
    status: u.status || 'active',
    productType: u.productType || null,
    groupId: u.groupId || null,
    chatModels: u.chatModels || null,
    imageModels: u.imageModels || null,
    dailyTokenLimit: u.dailyTokenLimit ?? null,
    monthlyTokenLimit: u.monthlyTokenLimit ?? null,
    dailyImageLimit: u.dailyImageLimit ?? null,
    avatar: u.avatar || null,
    nickname: u.nickname || null,
    apiPermissions: u.apiPermissions || defaultApiPermissions(),
    storageFolder: u.storageFolder || storageFolder(u.id),
    email: u.email || null,
    createdAt: u.createdAt || Date.now(),
    updatedAt: u.updatedAt || Date.now(),
  })));
}

async function readStore(): Promise<StoredUsersFile> {
  let file: StoredUsersFile;
  let usedFallback = false;

  // Try database first (persistent across deployments)
  try {
    const dbUsers = await dbReadUsers();
    if (dbUsers && dbUsers.length > 0) {
      file = {
        users: dbUsers.map(u => normalizeStoredUser({
          id: u.id,
          name: u.name,
          passwordHash: u.password_hash,
          role: (u.role || 'user') as 'admin' | 'user',
          status: (u.status || 'active') as 'active' | 'disabled',
          productType: u.product_type || undefined,
          chatModels: u.chat_models ? (Array.isArray(u.chat_models) ? u.chat_models : parseJsonArray(u.chat_models)) : undefined,
          imageModels: u.image_models ? (Array.isArray(u.image_models) ? u.image_models : parseJsonArray(u.image_models)) : undefined,
          dailyTokenLimit: u.daily_token_limit ?? undefined,
          monthlyTokenLimit: u.monthly_token_limit ?? undefined,
          dailyImageLimit: u.daily_image_limit ?? undefined,
          avatar: u.avatar || undefined,
          nickname: u.nickname || undefined,
          apiPermissions: normalizeApiPermissions(u.api_permissions),
          storageFolder: u.storage_folder || storageFolder(u.id),
          email: u.email || undefined,
          createdAt: u.created_at,
          updatedAt: u.updated_at,
        })),
        updatedAt: Date.now(),
      };
    } else {
      throw new Error('No users in DB');
    }
  } catch (dbError) {
    // Fallback to file system
    usedFallback = true;
    console.warn('[auth] DB read failed, falling back to file system:', dbError instanceof Error ? dbError.message : dbError);
    try {
      const raw = await readFile(USERS_PATH, 'utf8');
      const parsed = JSON.parse(raw) as StoredUsersFile;
      file = {
        users: Array.isArray(parsed.users) ? parsed.users.map(normalizeStoredUser) : [],
        updatedAt: parsed.updatedAt || Date.now(),
      };
    } catch {
      file = { users: [], updatedAt: Date.now() };
    }

    // Critical safety: merge DB users into file users to prevent data loss
    // When we fall back to file system, the file may have fewer users than the DB
    // We should NOT lose DB users just because we couldn't read from DB this time
    try {
      const dbUsers = await dbReadUsers();
      if (dbUsers && dbUsers.length > 0) {
        const fileUserIds = new Set(file.users.map(u => u.id));
        for (const dbUser of dbUsers) {
          if (!fileUserIds.has(dbUser.id)) {
            file.users.push(normalizeStoredUser({
              id: dbUser.id,
              name: dbUser.name,
              passwordHash: dbUser.password_hash,
              role: (dbUser.role || 'user') as 'admin' | 'user',
              status: (dbUser.status || 'active') as 'active' | 'disabled',
              productType: dbUser.product_type || undefined,
              chatModels: dbUser.chat_models ? (Array.isArray(dbUser.chat_models) ? dbUser.chat_models : parseJsonArray(dbUser.chat_models)) : undefined,
              imageModels: dbUser.image_models ? (Array.isArray(dbUser.image_models) ? dbUser.image_models : parseJsonArray(dbUser.image_models)) : undefined,
              dailyTokenLimit: dbUser.daily_token_limit ?? undefined,
              monthlyTokenLimit: dbUser.monthly_token_limit ?? undefined,
              dailyImageLimit: dbUser.daily_image_limit ?? undefined,
              avatar: dbUser.avatar || undefined,
              nickname: dbUser.nickname || undefined,
              apiPermissions: normalizeApiPermissions(dbUser.api_permissions),
              storageFolder: dbUser.storage_folder || storageFolder(dbUser.id),
              email: dbUser.email || undefined,
              createdAt: dbUser.created_at,
              updatedAt: dbUser.updated_at,
            }));
          }
        }
      }
    } catch {
      // DB retry also failed, proceed with file system data only
    }
  }

  const now = Date.now();
  const adminIndex = file.users.findIndex(user => user.name === DEFAULT_ADMIN_NAME);
  if (adminIndex === -1) {
    file.users.unshift({
      id: 'admin_mr_joker',
      name: DEFAULT_ADMIN_NAME,
      passwordHash: await hashPassword(DEFAULT_ADMIN_PASSWORD),
      role: 'admin',
      status: 'active',
      apiPermissions: defaultApiPermissions(),
      storageFolder: storageFolder('admin_mr_joker'),
      createdAt: now,
      updatedAt: now,
    });
    await writeStore(file);
  } else {
    const admin = file.users[adminIndex];
    file.users[adminIndex] = {
      ...admin,
      role: 'admin',
      status: admin.status || 'active',
      apiPermissions: admin.apiPermissions || defaultApiPermissions(),
      storageFolder: storageFolder(admin.id),
    };
  }

  return file;
}

export async function authenticateUser(input: {
  name: string;
  password: string;
  profile?: Partial<User>;
  productType?: string; // the mode user selected on login
}): Promise<User | null> {
  const name = input.name.trim();
  const password = input.password;
  if (!name || !password) return null;

  const file = await readStore();
  const now = Date.now();
  const index = file.users.findIndex(user => user.name === name);
  const isDefaultAdmin = name === DEFAULT_ADMIN_NAME;

  if (index === -1) {
    if (!isDefaultAdmin || password !== DEFAULT_ADMIN_PASSWORD) return null;

    const role: 'admin' | 'user' = isDefaultAdmin ? 'admin' : 'user';
    const id = safeId(input.profile?.id, isDefaultAdmin ? 'admin_mr_joker' : name);
    const user: StoredUser = {
      id,
      name,
      passwordHash: await hashPassword(password),
      role,
      status: input.profile?.status || 'active',
      productType: 'canvas,chat', // default admin has all access
      apiPermissions: input.profile?.apiPermissions || defaultApiPermissions(),
      storageFolder: storageFolder(id),
      email: input.profile?.email,
      createdAt: input.profile?.createdAt || now,
      updatedAt: now,
    };
    file.users.unshift(user);
    await writeStore(file);
    return publicUser(user);
  }

  const user = file.users[index];
  if (user.status === 'disabled') return null;

  // Check product_type authorization
  if (input.productType) {
    const userProductTypes = (user.productType || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!userProductTypes.includes(input.productType)) {
      console.log(`[auth] User "${name}" tried to login as "${input.productType}" but only has [${userProductTypes.join(',')}]`);
      return null;
    }
  }

  const currentSecret = await authSecret();
  const { matched: passwordMatches, needsMigration } = verifyPassword(password, user.passwordHash, currentSecret);
  const adminBootstrapMatches = isDefaultAdmin && password === DEFAULT_ADMIN_PASSWORD;
  if (!passwordMatches && !adminBootstrapMatches) return null;

  // If password matched via a legacy secret, re-hash with current secret (auto-migration)
  const newPasswordHash = needsMigration ? await hashPassword(password) : (passwordMatches ? user.passwordHash : await hashPassword(password));

  const next: StoredUser = {
    ...user,
    name,
    role: isDefaultAdmin ? 'admin' : user.role || 'user',
    status: input.profile?.status || user.status || 'active',
    apiPermissions: input.profile?.apiPermissions || user.apiPermissions || defaultApiPermissions(),
    storageFolder: storageFolder(user.id),
    email: input.profile?.email ?? user.email,
    passwordHash: newPasswordHash,
    updatedAt: now,
  };
  file.users[index] = next;
  await writeStore(file);
  if (needsMigration) {
    console.log(`[auth] Auto-migrated password hash for user "${name}" from legacy secret to current secret`);
  }
  return publicUser(next);
}

type ManagedUserUpdates = Partial<Pick<User, 'name' | 'email' | 'status' | 'apiPermissions' | 'productType' | 'groupId' | 'chatModels' | 'imageModels' | 'dailyTokenLimit' | 'monthlyTokenLimit' | 'dailyImageLimit' | 'avatar' | 'nickname'>> & {
  password?: string;
};

export async function listManagedUsers(): Promise<User[]> {
  const file = await readStore();
  return file.users.map(publicUser);
}

export async function createManagedUser(input: {
  name: string;
  password: string;
  email?: string;
  productType?: string;
  groupId?: string;
  chatModels?: string[];
  imageModels?: string[];
  dailyTokenLimit?: number;
  monthlyTokenLimit?: number;
  dailyImageLimit?: number;
  avatar?: string;
  nickname?: string;
  apiPermissions?: User['apiPermissions'];
}): Promise<User> {
  const name = input.name.trim();
  const password = input.password.trim();
  if (!name || !password) {
    throw new Error('Missing username or password');
  }

  const file = await readStore();
  if (file.users.some(user => user.name === name)) {
    throw new Error('User already exists');
  }

  const now = Date.now();
  const id = safeId(`user_${now}_${Math.random().toString(36).slice(2, 8)}`, name);
  const user: StoredUser = {
    id,
    name,
    passwordHash: await hashPassword(password),
    role: 'user',
    status: 'active',
    productType: input.productType || undefined,
    groupId: input.groupId || undefined,
    chatModels: input.chatModels || undefined,
    imageModels: input.imageModels || undefined,
    dailyTokenLimit: input.dailyTokenLimit ?? undefined,
    monthlyTokenLimit: input.monthlyTokenLimit ?? undefined,
    dailyImageLimit: input.dailyImageLimit ?? undefined,
    avatar: input.avatar || undefined,
    nickname: input.nickname || undefined,
    apiPermissions: input.apiPermissions || defaultApiPermissions(),
    storageFolder: storageFolder(id),
    email: input.email?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };

  file.users.unshift(user);
  await writeStore(file);
  await ensureUserDataDirs(user.id);
  return publicUser(user);
}

export async function updateManagedUser(userId: string, updates: ManagedUserUpdates): Promise<User | null> {
  const file = await readStore();
  const index = file.users.findIndex(user => user.id === userId);
  if (index === -1) return null;

  const current = file.users[index];
  if (current.name === DEFAULT_ADMIN_NAME && updates.status === 'disabled') {
    throw new Error('Default administrator cannot be disabled');
  }
  if (current.name === DEFAULT_ADMIN_NAME && updates.name && updates.name.trim() !== DEFAULT_ADMIN_NAME) {
    throw new Error('Default administrator username cannot be changed');
  }

  if (updates.name && file.users.some(user => user.id !== userId && user.name === updates.name)) {
    throw new Error('User already exists');
  }

  const next: StoredUser = {
    ...current,
    ...(updates.name ? { name: updates.name.trim() } : {}),
    ...(updates.email !== undefined ? { email: updates.email.trim() || undefined } : {}),
    ...(updates.status ? { status: updates.status } : {}),
    ...(updates.productType !== undefined ? { productType: updates.productType } : {}),
    ...(updates.groupId !== undefined ? { groupId: updates.groupId } : {}),
    ...(updates.chatModels !== undefined ? { chatModels: updates.chatModels } : {}),
    ...(updates.imageModels !== undefined ? { imageModels: updates.imageModels } : {}),
    ...(updates.dailyTokenLimit !== undefined ? { dailyTokenLimit: updates.dailyTokenLimit } : {}),
    ...(updates.monthlyTokenLimit !== undefined ? { monthlyTokenLimit: updates.monthlyTokenLimit } : {}),
    ...(updates.dailyImageLimit !== undefined ? { dailyImageLimit: updates.dailyImageLimit } : {}),
    ...(updates.avatar !== undefined ? { avatar: updates.avatar } : {}),
    ...(updates.nickname !== undefined ? { nickname: updates.nickname } : {}),
    ...(updates.apiPermissions ? { apiPermissions: updates.apiPermissions } : {}),
    ...(updates.password ? { passwordHash: await hashPassword(updates.password) } : {}),
    storageFolder: storageFolder(current.id),
    updatedAt: Date.now(),
  };

  file.users[index] = next;
  await writeStore(file);
  await ensureUserDataDirs(next.id);
  return publicUser(next);
}

export async function deleteManagedUser(userId: string): Promise<boolean> {
  const file = await readStore();
  const index = file.users.findIndex(user => user.id === userId);
  if (index === -1) return false;

  const current = file.users[index];
  if (current.name === DEFAULT_ADMIN_NAME) {
    return false;
  }

  file.users.splice(index, 1);
  await writeStore(file);

  // Also delete from database directly (writeStore only upserts, never deletes)
  await dbDeleteUser(userId);
  await dbDeleteUserData(userId);

  const userDir = path.resolve(getUserDataDir(userId));
  const rootDir = path.resolve(getServerUsersDir());
  const relative = path.relative(rootDir, userDir);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    await rm(userDir, { recursive: true, force: true });
  }

  return true;
}

export async function createSessionToken(user: User): Promise<string> {
  const payload: SessionPayload = {
    sub: user.id,
    role: user.role === 'admin' ? 'admin' : 'user',
    name: user.name,
    exp: Date.now() + WUJIE_SESSION_TTL_SECONDS * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${await hmac(encoded)}`;
}

export async function getSessionUser(request: NextRequest): Promise<User | null> {
  const token = request.cookies.get(WUJIE_SESSION_COOKIE)?.value;
  if (!token) return null;

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature || await hmac(encoded) !== signature) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }
  if (!payload.sub || payload.exp < Date.now()) return null;

  const file = await readStore();
  const user = file.users.find(item => item.id === payload.sub);
  if (!user || user.status === 'disabled') return null;
  return publicUser(user);
}

export async function requireAdminUser(request: NextRequest): Promise<User | null> {
  const user = await getSessionUser(request);
  return user?.role === 'admin' ? user : null;
}
