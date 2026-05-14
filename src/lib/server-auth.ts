import 'server-only';

import crypto from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { User } from './user-types';
import { ensureUserDataDirs, getUserDataDir } from './server-user-storage';
import { getServerSystemDir, getServerUsersDir } from './server-data-root';
import { dbReadUsers, dbWriteUsers } from './db-storage';

const SYSTEM_DIR = getServerSystemDir();
const USERS_PATH = path.join(SYSTEM_DIR, 'users.json');

export const WUJIE_SESSION_COOKIE = 'wujie_session';
export const WUJIE_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const DEFAULT_ADMIN_NAME = process.env.WUJIE_ADMIN_USERNAME || 'Mr.joker';
const DEFAULT_ADMIN_PASSWORD = process.env.WUJIE_ADMIN_PASSWORD || 'dongdong851212';

type StoredUser = Omit<User, 'password'> & {
  passwordHash: string;
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
    layer: true,
  };
}

function authSecret(): string {
  return process.env.WUJIE_AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'wujie-local-session-secret';
}

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(`${authSecret()}:${password}`).digest('hex');
}

function hmac(value: string): string {
  return crypto.createHmac('sha256', authSecret()).update(value).digest('base64url');
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
  // Write to database (persistent) - uses UPSERT to prevent data loss
  // Only users in the current list will be upserted; DB users not in
  // this list are preserved (never auto-deleted).
  await dbWriteUsers(data.users.map(u => ({
    id: u.id,
    name: u.name,
    passwordHash: u.passwordHash,
    role: u.role || 'user',
    status: u.status || 'active',
    apiPermissions: u.apiPermissions || defaultApiPermissions(),
    storageFolder: u.storageFolder || storageFolder(u.id),
    email: u.email || null,
    createdAt: u.createdAt || Date.now(),
    updatedAt: u.updatedAt || Date.now(),
  })));
}

async function readStore(): Promise<StoredUsersFile> {
  let file: StoredUsersFile;

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
          apiPermissions: u.api_permissions && typeof u.api_permissions === 'object' ? u.api_permissions as User['apiPermissions'] : defaultApiPermissions(),
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
  } catch {
    // Fallback to file system
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
  }

  const now = Date.now();
  const adminIndex = file.users.findIndex(user => user.name === DEFAULT_ADMIN_NAME);
  if (adminIndex === -1) {
    file.users.unshift({
      id: 'admin_mr_joker',
      name: DEFAULT_ADMIN_NAME,
      passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD),
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
      passwordHash: hashPassword(password),
      role,
      status: input.profile?.status || 'active',
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
  const passwordMatches = user.passwordHash === hashPassword(password);
  const adminBootstrapMatches = isDefaultAdmin && password === DEFAULT_ADMIN_PASSWORD;
  if (!passwordMatches && !adminBootstrapMatches) return null;

  const next: StoredUser = {
    ...user,
    name,
    role: isDefaultAdmin ? 'admin' : user.role || 'user',
    status: input.profile?.status || user.status || 'active',
    apiPermissions: input.profile?.apiPermissions || user.apiPermissions || defaultApiPermissions(),
    storageFolder: storageFolder(user.id),
    email: input.profile?.email ?? user.email,
    passwordHash: passwordMatches ? user.passwordHash : hashPassword(password),
    updatedAt: now,
  };
  file.users[index] = next;
  await writeStore(file);
  return publicUser(next);
}

type ManagedUserUpdates = Partial<Pick<User, 'name' | 'email' | 'status' | 'apiPermissions'>> & {
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
    passwordHash: hashPassword(password),
    role: 'user',
    status: 'active',
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
    ...(updates.apiPermissions ? { apiPermissions: updates.apiPermissions } : {}),
    ...(updates.password ? { passwordHash: hashPassword(updates.password) } : {}),
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

  const userDir = path.resolve(getUserDataDir(userId));
  const rootDir = path.resolve(getServerUsersDir());
  const relative = path.relative(rootDir, userDir);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    await rm(userDir, { recursive: true, force: true });
  }

  return true;
}

export function createSessionToken(user: User): string {
  const payload: SessionPayload = {
    sub: user.id,
    role: user.role === 'admin' ? 'admin' : 'user',
    name: user.name,
    exp: Date.now() + WUJIE_SESSION_TTL_SECONDS * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${hmac(encoded)}`;
}

export async function getSessionUser(request: NextRequest): Promise<User | null> {
  const token = request.cookies.get(WUJIE_SESSION_COOKIE)?.value;
  if (!token) return null;

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature || hmac(encoded) !== signature) return null;

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
