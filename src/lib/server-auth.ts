import 'server-only';

import crypto from 'crypto';
import { mkdir, readFile, rm } from 'fs/promises';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { PoolClient } from 'pg';
import { AuthServiceError } from './auth/auth-errors';
import {
  createLegacyPasswordHash,
  createScryptCredential,
  isValidScryptCredential,
  verifyLegacyCredential,
  verifyScryptCredential,
} from './auth/auth-password';
import {
  readAuthJsonFile,
  refreshAuthJsonFileAtomic,
  resolveAuthPersistenceMode,
  writeAuthJsonFileAtomic,
  type AuthPersistenceMode,
} from './auth/auth-persistence';
import {
  deriveAuthSecretKid,
  parseAuthSecretRing,
  planSecretRingRotation,
  sessionVerificationEntries,
  type AuthSecretEntry,
  type AuthSecretRingV1,
} from './auth/auth-secret-ring';
import {
  readDatabaseSecretRing,
  resolveDatabaseSecretRing,
  updateUserCredentials,
  updateUserCredentialSidecar,
  updateUserProfileFields,
  withDatabaseAuthReplicaLock,
  type AuthUserProfileFields,
} from './auth/auth-repository';
import type { User } from './user-types';
import { ensureUserDataDirs, getUserDataDir } from './server-user-storage';
import { getServerSystemDir, getServerUsersDir } from './server-data-root';
import { isDatabaseConfigured } from './db-client';
import { dbReadUsers, dbReadUsersWithClient, dbWriteUsers, dbDeleteUser, dbDeleteUserData, dbInitCredits } from './db-storage';
import { getRuntimeSettings } from './runtime-settings';

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
const AUTH_SECRET_PATH = path.join(SYSTEM_DIR, 'auth-secret');

export const WUJIE_SESSION_COOKIE = 'wujie_session';
export const WUJIE_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const DEFAULT_ADMIN_NAME = process.env.WUJIE_ADMIN_USERNAME || 'Mr.joker';
const LEGACY_STABLE_AUTH_SECRET = 'wujie-ai-stable-auth-secret-fallback-2024';

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigurationError';
  }
}

function isProductionRuntime(): boolean {
  return process.env.COZE_PROJECT_ENV?.trim().toUpperCase() === 'PROD'
    || process.env.NODE_ENV === 'production';
}

function configuredValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || normalized === 'change-me') return null;
  return normalized;
}

function configuredAuthSecret(): string | null {
  const secret = configuredValue(process.env.WUJIE_AUTH_SECRET)
    || configuredValue(process.env.NEXTAUTH_SECRET);
  return secret && secret.length >= 32 ? secret : null;
}

function configuredAdminBootstrapPassword(): string | null {
  return configuredValue(process.env.WUJIE_ADMIN_PASSWORD);
}

export function getProductionAuthConfigurationIssues(): string[] {
  if (!isProductionRuntime()) return [];

  const issues: string[] = [];
  if (!configuredAuthSecret()) issues.push('Missing WUJIE_AUTH_SECRET or NEXTAUTH_SECRET');
  if (!configuredAdminBootstrapPassword()) issues.push('Missing WUJIE_ADMIN_PASSWORD');
  return issues;
}

function requireAdminBootstrapPassword(): string {
  const password = configuredAdminBootstrapPassword();
  if (password) return password;

  const prefix = isProductionRuntime() ? 'Production administrator' : 'Administrator';
  throw new AuthConfigurationError(`${prefix} bootstrap password is not configured. Set WUJIE_ADMIN_PASSWORD before creating the initial administrator.`);
}

type StoredUser = Omit<User, 'password'> & {
  passwordHash: string;
  credentialHash?: string;
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
  kid?: string;
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

function configurationUnavailable(): AuthServiceError {
  return new AuthServiceError(
    'AUTH_CONFIGURATION_UNAVAILABLE',
    'Authentication configuration is unavailable.',
    503,
    true,
  );
}

function persistenceUnavailable(): AuthServiceError {
  return new AuthServiceError(
    'AUTH_PERSISTENCE_UNAVAILABLE',
    'Authentication persistence is unavailable.',
    503,
    true,
  );
}

function credentialFormatInvalid(): AuthServiceError {
  return new AuthServiceError(
    'AUTH_CREDENTIAL_FORMAT_INVALID',
    'Stored authentication credential is invalid.',
    503,
    false,
  );
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT';
}

function getAuthPersistenceMode(): AuthPersistenceMode {
  return resolveAuthPersistenceMode({
    databaseConfigured: isDatabaseConfigured(),
    rawMode: process.env.WUJIE_AUTH_PERSISTENCE_MODE,
    production: isProductionRuntime(),
  });
}

function createInitialSecretRing(secret: string, now: number): AuthSecretRingV1 {
  if (secret.length < 32 || !Number.isSafeInteger(now) || now <= 0) {
    throw configurationUnavailable();
  }
  return {
    version: 1,
    active: {
      kid: deriveAuthSecretKid(secret),
      secret,
      activatedAt: now,
    },
    updatedAt: now,
  };
}

async function writeAuthFile(filePath: string, value: unknown): Promise<void> {
  try {
    await mkdir(SYSTEM_DIR, { recursive: true });
    await writeAuthJsonFileAtomic(filePath, value);
  } catch (error) {
    throw error instanceof AuthServiceError ? error : persistenceUnavailable();
  }
}

async function readAuthSecretFileRaw(): Promise<string | null> {
  try {
    return await readFile(AUTH_SECRET_PATH, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw persistenceUnavailable();
  }
}

function parseFileSecretRing(raw: string, now: number): {
  ring: AuthSecretRingV1;
  migratedLegacySecret: boolean;
} {
  const trimmed = raw.trim();
  try {
    const ring = parseAuthSecretRing(JSON.parse(trimmed) as unknown);
    if (!ring) throw configurationUnavailable();
    return { ring, migratedLegacySecret: false };
  } catch (error) {
    if (error instanceof AuthServiceError) throw error;
    const looksLikeJson = trimmed.startsWith('{')
      || trimmed.startsWith('[')
      || trimmed.startsWith('"');
    if (looksLikeJson || trimmed.length < 32) {
      throw configurationUnavailable();
    }
    return {
      ring: createInitialSecretRing(trimmed, now),
      migratedLegacySecret: true,
    };
  }
}

async function countFileLegacyCredentialUsers(): Promise<number> {
  const file = await readAuthJsonFile<StoredUsersFile>(USERS_PATH);
  if (!file || !Array.isArray(file.users)) return 0;
  return file.users.filter(user => (
    user.credentialHash === undefined
    && typeof user.passwordHash === 'string'
    && user.passwordHash.trim().length > 0
  )).length;
}

let _authSecretRingCache: AuthSecretRingV1 | null = null;
let _authSecretRingPromise: Promise<AuthSecretRingV1> | null = null;
const emittedReplicaWarnings = new Set<string>();

function warnReplicaWriteOnce(code: string): void {
  if (emittedReplicaWarnings.has(code)) return;
  emittedReplicaWarnings.add(code);
  console.warn({ code });
}

async function writeSecretRingReplicaBestEffort(ring: AuthSecretRingV1): Promise<void> {
  try {
    await writeAuthFile(AUTH_SECRET_PATH, ring);
  } catch {
    warnReplicaWriteOnce('AUTH_SECRET_RING_FILE_REPLICA_DEFERRED');
  }
}

async function resolveFileSecretRing(
  configuredSecret: string | null,
  now: number,
): Promise<AuthSecretRingV1> {
  const raw = await readAuthSecretFileRaw();
  if (raw === null) {
    if (!configuredSecret && isProductionRuntime()) {
      throw configurationUnavailable();
    }
    const initialSecret = configuredSecret ?? crypto.randomBytes(48).toString('base64url');
    const ring = createInitialSecretRing(initialSecret, now);
    await writeAuthFile(AUTH_SECRET_PATH, ring);
    return ring;
  }

  const parsed = parseFileSecretRing(raw, now);
  let ring = parsed.ring;
  let shouldWrite = parsed.migratedLegacySecret;
  if (configuredSecret && configuredSecret !== ring.active.secret) {
    const legacyCredentialCount = await countFileLegacyCredentialUsers();
    try {
      ring = planSecretRingRotation(
        ring,
        configuredSecret,
        now,
        legacyCredentialCount > 0,
      );
    } catch (error) {
      if (error instanceof AuthServiceError) throw error;
      throw configurationUnavailable();
    }
    shouldWrite = true;
  }
  if (shouldWrite) {
    await writeAuthFile(AUTH_SECRET_PATH, ring);
  }
  return ring;
}

async function readFileSecretRingForSession(now: number): Promise<AuthSecretRingV1 | null> {
  const configuredSecret = configuredAuthSecret();
  const raw = await readAuthSecretFileRaw();
  if (raw === null) {
    return configuredSecret ? createInitialSecretRing(configuredSecret, now) : null;
  }

  const parsed = parseFileSecretRing(raw, now);
  if (configuredSecret && configuredSecret !== parsed.ring.active.secret) {
    return null;
  }
  return parsed.ring;
}

async function readSessionSecretRing(now: number): Promise<AuthSecretRingV1 | null> {
  const mode = getAuthPersistenceMode();
  const ring = mode === 'FILE_ONLY'
    ? await readFileSecretRingForSession(now)
    : await readDatabaseSecretRing(now);
  if (ring === null) return null;

  const parsed = parseAuthSecretRing(ring);
  if (!parsed) throw configurationUnavailable();
  return parsed;
}

async function resolveAuthSecretRing(): Promise<AuthSecretRingV1> {
  const mode = getAuthPersistenceMode();
  const now = Date.now();
  const envSecret = configuredAuthSecret();
  const ring = mode === 'FILE_ONLY'
    ? await resolveFileSecretRing(envSecret, now)
    : await resolveDatabaseSecretRing({ configuredSecret: envSecret, now });

  if (mode === 'DB_PLUS_FILE') {
    await writeSecretRingReplicaBestEffort(ring);
  }
  return ring;
}

async function authSecretRing(): Promise<AuthSecretRingV1> {
  if (_authSecretRingCache) return _authSecretRingCache;
  if (_authSecretRingPromise) return _authSecretRingPromise;

  _authSecretRingPromise = resolveAuthSecretRing().then(
    ring => {
      _authSecretRingCache = ring;
      _authSecretRingPromise = null;
      return ring;
    },
    error => {
      _authSecretRingPromise = null;
      throw error;
    },
  );
  return _authSecretRingPromise;
}

/**
 * Returns the same secret used to sign sessions so internal API calls remain
 * authenticated when a preview deployment restores its secret from storage.
 */
export async function getAuthSecretForInternalRequests(): Promise<string> {
  return (await authSecretRing()).active.secret;
}

/**
 * Fixed legacy candidates remain verification-only inputs while a successful
 * legacy login adds the independent scrypt sidecar.
 */
const LEGACY_AUTH_SECRETS = [
  'wujie-local-session-secret', // Original fallback (pre-v3.0)
  LEGACY_STABLE_AUTH_SECRET,
];

function legacyCredentialSecrets(ring: AuthSecretRingV1): string[] {
  return [...new Set([
    ring.active.secret,
    ...(ring.previous ? [ring.previous.secret] : []),
    ...LEGACY_AUTH_SECRETS,
  ])];
}

function hmac(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function parseSessionPayload(encoded: string): SessionPayload | null {
  try {
    const decoded = Buffer.from(encoded, 'base64url');
    if (decoded.length === 0 || decoded.toString('base64url') !== encoded) return null;

    const value: unknown = JSON.parse(decoded.toString('utf8'));
    if (value === null
      || typeof value !== 'object'
      || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) {
      return null;
    }

    const requiredKeys = ['sub', 'role', 'name', 'exp'] as const;
    const allowedKeys = new Set<string>([...requiredKeys, 'kid']);
    const keys = Reflect.ownKeys(value);
    if (keys.length < requiredKeys.length || keys.length > allowedKeys.size) return null;

    const payload: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== 'string' || !allowedKeys.has(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
      payload[key] = descriptor.value;
    }
    if (!requiredKeys.every(key => Object.hasOwn(payload, key))) return null;

    if (typeof payload.sub !== 'string'
      || payload.sub.length === 0
      || (payload.role !== 'admin' && payload.role !== 'user')
      || typeof payload.name !== 'string'
      || payload.name.length === 0
      || !Number.isSafeInteger(payload.exp)
      || (payload.exp as number) <= 0) {
      return null;
    }

    const hasKid = Object.hasOwn(payload, 'kid');
    if (hasKid && (
      typeof payload.kid !== 'string'
      || !/^[A-Za-z0-9_-]{16}$/.test(payload.kid)
    )) {
      return null;
    }

    return {
      sub: payload.sub,
      role: payload.role,
      name: payload.name,
      exp: payload.exp as number,
      ...(hasKid ? { kid: payload.kid as string } : {}),
    };
  } catch {
    return null;
  }
}

function signaturesMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (actualBytes.length !== expectedBytes.length) return false;
  return crypto.timingSafeEqual(actualBytes, expectedBytes);
}

function verifySessionSignature(
  encoded: string,
  signature: string,
  entries: AuthSecretEntry[],
): boolean {
  let verified = false;
  for (const entry of entries) {
    const matches = signaturesMatch(signature, hmac(encoded, entry.secret));
    verified = matches || verified;
  }
  return verified;
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
  return normalizeStoredUserAt(user, Date.now());
}

function normalizeStoredUserAt(user: StoredUser, now: number): StoredUser {
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
    updatedAt: user.updatedAt || now,
  };
}

type DbStoredUserRow = Awaited<ReturnType<typeof dbReadUsers>>[number];

function storedUserFromDatabase(user: DbStoredUserRow): StoredUser {
  return storedUserFromDatabaseAt(user, Date.now());
}

function storedUserFromDatabaseAt(user: DbStoredUserRow, now: number): StoredUser {
  return normalizeStoredUserAt({
    id: user.id,
    name: user.name,
    passwordHash: user.password_hash,
    credentialHash: user.credential_hash === null ? undefined : user.credential_hash,
    role: (user.role || 'user') as 'admin' | 'user',
    status: (user.status || 'active') as 'active' | 'disabled',
    productType: user.product_type || undefined,
    groupId: user.group_id || undefined,
    chatModels: user.chat_models
      ? (Array.isArray(user.chat_models) ? user.chat_models : parseJsonArray(user.chat_models))
      : undefined,
    imageModels: user.image_models
      ? (Array.isArray(user.image_models) ? user.image_models : parseJsonArray(user.image_models))
      : undefined,
    dailyTokenLimit: user.daily_token_limit ?? undefined,
    monthlyTokenLimit: user.monthly_token_limit ?? undefined,
    dailyImageLimit: user.daily_image_limit ?? undefined,
    avatar: user.avatar || undefined,
    nickname: user.nickname || undefined,
    apiPermissions: normalizeApiPermissions(user.api_permissions),
    storageFolder: user.storage_folder || storageFolder(user.id),
    email: user.email || undefined,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  }, now);
}

function userForDatabase(user: StoredUser): Parameters<typeof dbWriteUsers>[0][number] {
  return {
    id: user.id,
    name: user.name,
    passwordHash: user.passwordHash,
    credentialHash: user.credentialHash,
    role: user.role || 'user',
    status: user.status || 'active',
    productType: user.productType || null,
    groupId: user.groupId || null,
    chatModels: user.chatModels || null,
    imageModels: user.imageModels || null,
    dailyTokenLimit: user.dailyTokenLimit ?? null,
    monthlyTokenLimit: user.monthlyTokenLimit ?? null,
    dailyImageLimit: user.dailyImageLimit ?? null,
    avatar: user.avatar || null,
    nickname: user.nickname || null,
    apiPermissions: user.apiPermissions || defaultApiPermissions(),
    storageFolder: user.storageFolder || storageFolder(user.id),
    email: user.email || null,
    createdAt: user.createdAt || Date.now(),
    updatedAt: user.updatedAt || Date.now(),
  };
}

function profileFields(user: StoredUser): AuthUserProfileFields {
  return {
    name: user.name,
    role: user.role === 'admin' ? 'admin' : 'user',
    status: user.status === 'disabled' ? 'disabled' : 'active',
    productType: user.productType || null,
    groupId: user.groupId || null,
    chatModels: user.chatModels || null,
    imageModels: user.imageModels || null,
    dailyTokenLimit: user.dailyTokenLimit ?? null,
    monthlyTokenLimit: user.monthlyTokenLimit ?? null,
    dailyImageLimit: user.dailyImageLimit ?? null,
    avatar: user.avatar || null,
    nickname: user.nickname || null,
    apiPermissions: user.apiPermissions || defaultApiPermissions(),
    storageFolder: user.storageFolder || storageFolder(user.id),
    email: user.email || null,
  };
}

function nextUpdatedAt(previous: number): number {
  return Math.max(Date.now(), previous + 1);
}

async function writeUsersFile(data: StoredUsersFile): Promise<void> {
  await writeAuthFile(USERS_PATH, data);
}

async function writeDatabaseUsers(users: StoredUser[]): Promise<void> {
  try {
    const written = await dbWriteUsers(users.map(userForDatabase));
    if (written !== true) throw persistenceUnavailable();
  } catch (error) {
    throw error instanceof AuthServiceError ? error : persistenceUnavailable();
  }
}

async function readFileStore(): Promise<StoredUsersFile> {
  try {
    const parsed = await readAuthJsonFile<StoredUsersFile>(USERS_PATH);
    if (parsed === null) {
      return { users: [], updatedAt: Date.now() };
    }
    if (typeof parsed !== 'object' || !Array.isArray(parsed.users)) {
      throw persistenceUnavailable();
    }
    return {
      users: parsed.users.map(normalizeStoredUser),
      updatedAt: parsed.updatedAt || Date.now(),
    };
  } catch (error) {
    throw error instanceof AuthServiceError ? error : persistenceUnavailable();
  }
}

async function readDatabaseStore(client?: PoolClient): Promise<StoredUsersFile> {
  try {
    const dbUsers = client ? await dbReadUsersWithClient(client) : await dbReadUsers();
    return {
      users: dbUsers.map(storedUserFromDatabase),
      updatedAt: Date.now(),
    };
  } catch (error) {
    throw error instanceof AuthServiceError ? error : persistenceUnavailable();
  }
}

function isStoredUserRecord(value: unknown): value is StoredUser {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;

  const record = value as Record<string, unknown>;
  return Object.hasOwn(record, 'id')
    && typeof record.id === 'string'
    && Object.hasOwn(record, 'name')
    && typeof record.name === 'string'
    && Object.hasOwn(record, 'passwordHash')
    && typeof record.passwordHash === 'string';
}

async function readSessionUser(userId: string, now: number): Promise<StoredUser | null> {
  const mode = getAuthPersistenceMode();
  if (mode === 'FILE_ONLY') {
    try {
      const parsed = await readAuthJsonFile<unknown>(USERS_PATH);
      if (parsed === null) return null;
      if (typeof parsed !== 'object'
        || Array.isArray(parsed)
        || !Object.hasOwn(parsed, 'users')) {
        throw persistenceUnavailable();
      }

      const users = (parsed as { users?: unknown }).users;
      if (!Array.isArray(users)) throw persistenceUnavailable();
      const candidate = users.find(value => (
        isStoredUserRecord(value) && value.id === userId
      ));
      return candidate ? normalizeStoredUserAt(candidate, now) : null;
    } catch (error) {
      throw error instanceof AuthServiceError ? error : persistenceUnavailable();
    }
  }

  try {
    const candidate = (await dbReadUsers()).find(user => user.id === userId);
    return candidate ? storedUserFromDatabaseAt(candidate, now) : null;
  } catch (error) {
    throw error instanceof AuthServiceError ? error : persistenceUnavailable();
  }
}

let userFileMutationTail: Promise<void> = Promise.resolve();

async function withUserFileMutationLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = userFileMutationTail;
  let release!: () => void;
  userFileMutationTail = new Promise<void>(resolve => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

async function writeFileStoreLocked(file: StoredUsersFile): Promise<void> {
  try {
    await writeUsersFile({ ...file, updatedAt: Date.now() });
  } catch (error) {
    throw error instanceof AuthServiceError ? error : persistenceUnavailable();
  }
}

async function createDefaultAdministrator(): Promise<StoredUser> {
  const now = Date.now();
  const password = requireAdminBootstrapPassword();
  const ring = await authSecretRing();
  return {
    id: 'admin_mr_joker',
    name: DEFAULT_ADMIN_NAME,
    passwordHash: createLegacyPasswordHash(password, ring.active.secret),
    credentialHash: await createScryptCredential(password),
    role: 'admin',
    status: 'active',
    productType: 'canvas,chat',
    apiPermissions: defaultApiPermissions(),
    storageFolder: storageFolder('admin_mr_joker'),
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeDefaultAdministrator(file: StoredUsersFile): void {
  const adminIndex = file.users.findIndex(user => user.name === DEFAULT_ADMIN_NAME);
  if (adminIndex === -1) return;
  const admin = file.users[adminIndex];
  file.users[adminIndex] = {
    ...admin,
    role: 'admin',
    status: admin.status || 'active',
    productType: admin.productType || 'canvas,chat',
    apiPermissions: admin.apiPermissions || defaultApiPermissions(),
    storageFolder: storageFolder(admin.id),
  };
}

async function refreshUserFileReplicaBestEffort(): Promise<void> {
  if (getAuthPersistenceMode() !== 'DB_PLUS_FILE') return;
  try {
    await withDatabaseAuthReplicaLock(async client => {
      await refreshAuthJsonFileAtomic(USERS_PATH, async () => {
        const file = await readDatabaseStore(client);
        return { ...file, updatedAt: Date.now() };
      });
    });
  } catch {
    warnReplicaWriteOnce('AUTH_USER_STORE_FILE_REPLICA_DEFERRED');
  }
}

async function readStore(): Promise<StoredUsersFile> {
  const mode = getAuthPersistenceMode();
  if (mode === 'FILE_ONLY') {
    return await withUserFileMutationLock(async () => {
      const file = await readFileStore();
      if (!file.users.some(user => user.name === DEFAULT_ADMIN_NAME)) {
        file.users.unshift(await createDefaultAdministrator());
        await writeFileStoreLocked(file);
      } else {
        normalizeDefaultAdministrator(file);
      }
      return file;
    });
  }

  const file = await readDatabaseStore();
  const adminIndex = file.users.findIndex(user => user.name === DEFAULT_ADMIN_NAME);
  if (adminIndex === -1) {
    const admin = await createDefaultAdministrator();
    await writeDatabaseUsers([admin]);
    file.users.unshift(admin);
    await refreshUserFileReplicaBestEffort();
  } else {
    normalizeDefaultAdministrator(file);
  }

  return file;
}

async function persistCredentialMigration(
  user: StoredUser,
  credentialHash: string,
): Promise<StoredUser> {
  const mode = getAuthPersistenceMode();
  if (mode === 'FILE_ONLY') {
    return await withUserFileMutationLock(async () => {
      const file = await readFileStore();
      const index = file.users.findIndex(storedUser => storedUser.id === user.id);
      if (index === -1) throw persistenceUnavailable();
      const current = file.users[index];
      if (current.credentialHash !== undefined) return current;
      if (current.passwordHash !== user.passwordHash) throw persistenceUnavailable();
      const nextUser: StoredUser = {
        ...current,
        credentialHash,
        updatedAt: nextUpdatedAt(current.updatedAt),
      };
      file.users[index] = nextUser;
      await writeFileStoreLocked(file);
      return nextUser;
    });
  }

  const status = await updateUserCredentialSidecar(user.id, credentialHash);
  if (status === 'user-missing') throw persistenceUnavailable();
  await refreshUserFileReplicaBestEffort();
  return status === 'updated'
    ? { ...user, credentialHash, updatedAt: nextUpdatedAt(user.updatedAt) }
    : user;
}

type StoredUserProfilePatch = Partial<Pick<StoredUser,
  'name'
  | 'role'
  | 'status'
  | 'productType'
  | 'groupId'
  | 'chatModels'
  | 'imageModels'
  | 'dailyTokenLimit'
  | 'monthlyTokenLimit'
  | 'dailyImageLimit'
  | 'avatar'
  | 'nickname'
  | 'apiPermissions'
  | 'storageFolder'
  | 'email'
>>;

function mergeUserProfile(current: StoredUser, patch: StoredUserProfilePatch): StoredUser {
  return {
    ...current,
    ...patch,
    storageFolder: patch.storageFolder ?? storageFolder(current.id),
    updatedAt: nextUpdatedAt(current.updatedAt),
  };
}

async function readDatabaseUser(userId: string): Promise<StoredUser | null> {
  const file = await readDatabaseStore();
  return file.users.find(user => user.id === userId) || null;
}

async function persistUserProfile(
  currentUser: StoredUser,
  patch: StoredUserProfilePatch,
): Promise<StoredUser> {
  if (getAuthPersistenceMode() === 'FILE_ONLY') {
    return await withUserFileMutationLock(async () => {
      const file = await readFileStore();
      const index = file.users.findIndex(user => user.id === currentUser.id);
      if (index === -1) throw persistenceUnavailable();
      const next = mergeUserProfile(file.users[index], patch);
      file.users[index] = next;
      await writeFileStoreLocked(file);
      return next;
    });
  }

  let expected = currentUser;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = mergeUserProfile(expected, patch);
    const status = await updateUserProfileFields({
      userId: expected.id,
      expectedUpdatedAt: expected.updatedAt,
      updatedAt: next.updatedAt,
      profile: profileFields(next),
    });
    if (status === 'updated') {
      await refreshUserFileReplicaBestEffort();
      return next;
    }
    if (status === 'user-missing') throw persistenceUnavailable();
    const latest = await readDatabaseUser(expected.id);
    if (!latest) throw persistenceUnavailable();
    expected = latest;
  }
  throw persistenceUnavailable();
}

async function persistUserCredentials(
  currentUser: StoredUser,
  patch: StoredUserProfilePatch,
  credentials: { passwordHash: string; credentialHash: string },
): Promise<StoredUser> {
  if (getAuthPersistenceMode() === 'FILE_ONLY') {
    return await withUserFileMutationLock(async () => {
      const file = await readFileStore();
      const index = file.users.findIndex(user => user.id === currentUser.id);
      if (index === -1) throw persistenceUnavailable();
      const latest = file.users[index];
      if (latest.passwordHash !== currentUser.passwordHash) throw persistenceUnavailable();
      const next = {
        ...mergeUserProfile(latest, patch),
        ...credentials,
      };
      file.users[index] = next;
      await writeFileStoreLocked(file);
      return next;
    });
  }

  const expectedPasswordHash = currentUser.passwordHash;
  let expected = currentUser;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (expected.passwordHash !== expectedPasswordHash) throw persistenceUnavailable();
    const next = {
      ...mergeUserProfile(expected, patch),
      ...credentials,
    };
    const status = await updateUserCredentials({
      userId: expected.id,
      expectedUpdatedAt: expected.updatedAt,
      expectedPasswordHash,
      passwordHash: credentials.passwordHash,
      credentialHash: credentials.credentialHash,
      updatedAt: next.updatedAt,
      profile: profileFields(next),
    });
    if (status === 'updated') {
      await refreshUserFileReplicaBestEffort();
      return next;
    }
    if (status === 'user-missing') throw persistenceUnavailable();
    const latest = await readDatabaseUser(expected.id);
    if (!latest || latest.passwordHash !== expectedPasswordHash) {
      throw persistenceUnavailable();
    }
    expected = latest;
  }
  throw persistenceUnavailable();
}

async function persistNewUser(user: StoredUser): Promise<void> {
  if (getAuthPersistenceMode() === 'FILE_ONLY') {
    await withUserFileMutationLock(async () => {
      const file = await readFileStore();
      if (file.users.some(existing => existing.name === user.name)) {
        throw new Error('User already exists');
      }
      file.users.unshift(user);
      await writeFileStoreLocked(file);
    });
    return;
  }
  await writeDatabaseUsers([user]);
  await refreshUserFileReplicaBestEffort();
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
    if (!isDefaultAdmin || password !== requireAdminBootstrapPassword()) return null;

    const ring = await authSecretRing();
    const id = safeId(input.profile?.id, 'admin_mr_joker');
    const user: StoredUser = {
      id,
      name,
      passwordHash: createLegacyPasswordHash(password, ring.active.secret),
      credentialHash: await createScryptCredential(password),
      role: 'admin',
      status: input.profile?.status || 'active',
      productType: 'canvas,chat', // default admin has all access
      apiPermissions: input.profile?.apiPermissions || defaultApiPermissions(),
      storageFolder: storageFolder(id),
      email: input.profile?.email,
      createdAt: input.profile?.createdAt || now,
      updatedAt: now,
    };
    await persistNewUser(user);
    return publicUser(user);
  }

  const user = file.users[index];
  if (user.status === 'disabled') return null;

  // Check product_type authorization
  if (input.productType) {
    const userProductTypes = (user.productType || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!userProductTypes.includes(input.productType)) {
      return null;
    }
  }

  const ring = await authSecretRing();
  let passwordMatches = false;
  let migrationCredential: string | undefined;
  if (user.credentialHash !== undefined) {
    if (typeof user.credentialHash !== 'string'
      || !isValidScryptCredential(user.credentialHash)) {
      throw credentialFormatInvalid();
    }
    passwordMatches = await verifyScryptCredential(password, user.credentialHash);
  } else {
    const legacy = verifyLegacyCredential(
      password,
      user.passwordHash,
      legacyCredentialSecrets(ring),
    );
    passwordMatches = legacy.matched;
    if (legacy.matched) {
      migrationCredential = await createScryptCredential(password);
    }
  }

  if (!passwordMatches) {
    const recoveryPassword = configuredAdminBootstrapPassword();
    if (!isDefaultAdmin || !recoveryPassword || password !== recoveryPassword) return null;

    const recovered = await persistUserCredentials(user, {
      name,
      role: 'admin',
      status: user.status || 'active',
      productType: user.productType || 'canvas,chat',
      apiPermissions: user.apiPermissions || defaultApiPermissions(),
      storageFolder: storageFolder(user.id),
    }, {
      passwordHash: createLegacyPasswordHash(password, ring.active.secret),
      credentialHash: await createScryptCredential(password),
    });
    return publicUser(recovered);
  }

  let authenticatedUser = user;
  if (migrationCredential) {
    try {
      authenticatedUser = await persistCredentialMigration(user, migrationCredential);
    } catch {
      console.warn({
        code: 'AUTH_CREDENTIAL_MIGRATION_DEFERRED',
        userId: user.id,
      });
    }
  }

  const nextRole = isDefaultAdmin ? 'admin' : authenticatedUser.role || 'user';
  const nextStatus = input.profile?.status || authenticatedUser.status || 'active';
  const nextApiPermissions = input.profile?.apiPermissions
    || authenticatedUser.apiPermissions
    || defaultApiPermissions();
  const nextStorageFolder = storageFolder(authenticatedUser.id);
  const nextEmail = input.profile?.email ?? authenticatedUser.email;
  const shouldPersist = nextRole !== authenticatedUser.role
    || nextStatus !== authenticatedUser.status
    || nextApiPermissions !== authenticatedUser.apiPermissions
    || nextStorageFolder !== authenticatedUser.storageFolder
    || nextEmail !== authenticatedUser.email;

  if (!shouldPersist) return publicUser(authenticatedUser);

  const next = await persistUserProfile(authenticatedUser, {
    name,
    role: nextRole,
    status: nextStatus,
    apiPermissions: nextApiPermissions,
    storageFolder: nextStorageFolder,
    email: nextEmail,
  });
  return publicUser(next);
}

type ManagedUserUpdates = Partial<Pick<User, 'name' | 'email' | 'status' | 'apiPermissions' | 'productType' | 'groupId' | 'chatModels' | 'imageModels' | 'dailyTokenLimit' | 'monthlyTokenLimit' | 'dailyImageLimit' | 'avatar' | 'nickname'>> & {
  password?: string;
};

export async function listManagedUsers(): Promise<User[]> {
  const file = await readStore();
  return file.users.map(publicUser);
}

export async function repairDuplicateUserIds(): Promise<{ repaired: number; users: User[] }> {
  const repair = (file: StoredUsersFile): {
    repaired: number;
    duplicateIds: string[];
    affectedUsers: StoredUser[];
  } => {
    const usersById = new Map<string, StoredUser[]>();
    for (const user of file.users) {
      const users = usersById.get(user.id) || [];
      users.push(user);
      usersById.set(user.id, users);
    }
    const duplicateIds = [...usersById.entries()]
      .filter(([, users]) => users.length > 1)
      .map(([id]) => id);
    const affectedUsers = duplicateIds.flatMap(id => usersById.get(id) || []);
    const assignedIds = new Set(file.users.map(user => user.id));
    const now = Date.now();
    let sequence = 0;
    let repaired = 0;
    for (const duplicateId of duplicateIds) {
      const users = usersById.get(duplicateId) || [];
      const retained = users.find(user => user.name === DEFAULT_ADMIN_NAME) || users[0];
      for (const user of users) {
        if (user === retained) continue;
        let nextId = safeId(`repaired_${user.name}_${now}_${++sequence}`, user.name);
        while (assignedIds.has(nextId)) {
          nextId = safeId(`repaired_${user.name}_${now}_${++sequence}`, user.name);
        }
        assignedIds.add(nextId);
        user.id = nextId;
        user.storageFolder = storageFolder(nextId);
        user.updatedAt = nextUpdatedAt(user.updatedAt);
        repaired += 1;
      }
    }
    return { repaired, duplicateIds, affectedUsers };
  };

  if (getAuthPersistenceMode() === 'FILE_ONLY') {
    await readStore();
    return await withUserFileMutationLock(async () => {
      const file = await readFileStore();
      const result = repair(file);
      if (result.repaired > 0) await writeFileStoreLocked(file);
      return { repaired: result.repaired, users: file.users.map(publicUser) };
    });
  }

  const file = await readStore();
  const result = repair(file);
  if (result.repaired === 0) return { repaired: 0, users: file.users.map(publicUser) };
  for (const duplicateId of result.duplicateIds) {
    if (!await dbDeleteUser(duplicateId)) {
      throw new Error(`Failed to remove duplicate user ID: ${duplicateId}`);
    }
  }
  await writeDatabaseUsers(result.affectedUsers);
  await refreshUserFileReplicaBestEffort();
  return { repaired: result.repaired, users: file.users.map(publicUser) };
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
  const ring = await authSecretRing();
  const id = safeId(`user_${now}_${Math.random().toString(36).slice(2, 8)}`, name);
  const user: StoredUser = {
    id,
    name,
    passwordHash: createLegacyPasswordHash(password, ring.active.secret),
    credentialHash: await createScryptCredential(password),
    role: 'user',
    status: 'active',
    productType: input.productType === undefined ? 'canvas,chat' : input.productType || undefined,
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

  await persistNewUser(user);
  await ensureUserDataDirs(user.id);
  const runtimeSettings = await getRuntimeSettings();
  await dbInitCredits(user.id, runtimeSettings.initialCredits);
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

  let credentialUpdates: { passwordHash: string; credentialHash: string } | null = null;
  if (updates.password) {
    const ring = await authSecretRing();
    credentialUpdates = {
      passwordHash: createLegacyPasswordHash(updates.password, ring.active.secret),
      credentialHash: await createScryptCredential(updates.password),
    };
  }

  const profilePatch: StoredUserProfilePatch = {
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
    storageFolder: storageFolder(current.id),
  };

  const next = credentialUpdates
    ? await persistUserCredentials(current, profilePatch, credentialUpdates)
    : await persistUserProfile(current, profilePatch);
  await ensureUserDataDirs(next.id);
  return publicUser(next);
}

export async function deleteManagedUsers(userIds: string[]): Promise<{
  deletedIds: string[];
  skippedIds: string[];
}> {
  const requestedIds = [...new Set(userIds.map(id => id.trim()).filter(Boolean))];
  const classify = (file: StoredUsersFile): {
    deletableIds: string[];
    skippedIds: string[];
  } => {
    const usersById = new Map(file.users.map(user => [user.id, user]));
    const skippedIds: string[] = [];
    const deletableIds = requestedIds.filter(userId => {
      const user = usersById.get(userId);
      if (!user || user.role === 'admin' || user.name === DEFAULT_ADMIN_NAME) {
        skippedIds.push(userId);
        return false;
      }
      return true;
    });
    return { deletableIds, skippedIds };
  };

  const persistenceMode = getAuthPersistenceMode();
  const deletedIds: string[] = [];
  let skippedIds: string[] = [];
  if (persistenceMode === 'FILE_ONLY') {
    await readStore();
    const result = await withUserFileMutationLock(async () => {
      const file = await readFileStore();
      const classified = classify(file);
      if (classified.deletableIds.length === 0) return classified;
      const deletedSet = new Set(classified.deletableIds);
      file.users = file.users.filter(user => !deletedSet.has(user.id));
      await writeFileStoreLocked(file);
      return classified;
    });
    deletedIds.push(...result.deletableIds);
    skippedIds = result.skippedIds;
  } else {
    const file = await readStore();
    const classified = classify(file);
    skippedIds = classified.skippedIds;
    for (const userId of classified.deletableIds) {
      if (await dbDeleteUser(userId)) {
        deletedIds.push(userId);
      } else {
        skippedIds.push(userId);
      }
    }
    if (deletedIds.length > 0) await refreshUserFileReplicaBestEffort();
  }

  await Promise.all(deletedIds.map(async userId => {
    if (persistenceMode !== 'FILE_ONLY') {
      await dbDeleteUserData(userId);
    }

    const userDir = path.resolve(getUserDataDir(userId));
    const rootDir = path.resolve(getServerUsersDir());
    const relative = path.relative(rootDir, userDir);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      await rm(userDir, { recursive: true, force: true });
    }
  }));

  return { deletedIds, skippedIds };
}

export async function deleteManagedUser(userId: string): Promise<boolean> {
  const result = await deleteManagedUsers([userId]);
  return result.deletedIds.includes(userId);
}

export async function createSessionToken(user: User): Promise<string> {
  const ring = parseAuthSecretRing(await authSecretRing());
  if (!ring) throw configurationUnavailable();
  const payload: SessionPayload = {
    sub: user.id,
    role: user.role === 'admin' ? 'admin' : 'user',
    name: user.name,
    exp: Date.now() + WUJIE_SESSION_TTL_SECONDS * 1000,
    kid: ring.active.kid,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${hmac(encoded, ring.active.secret)}`;
}

export async function getSessionUser(request: NextRequest): Promise<User | null> {
  const token = request.cookies.get(WUJIE_SESSION_COOKIE)?.value;
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  if (!encoded || !signature) return null;

  const payload = parseSessionPayload(encoded);
  const now = Date.now();
  if (!payload || payload.exp <= now) return null;

  const ring = await readSessionSecretRing(now);
  if (!ring) return null;
  const entries = sessionVerificationEntries(ring, {
    now,
    acceptPrevious: process.env.WUJIE_AUTH_ACCEPT_PREVIOUS_SESSIONS !== 'false',
    ttlSeconds: WUJIE_SESSION_TTL_SECONDS,
    kid: payload.kid,
  });
  if (!verifySessionSignature(encoded, signature, entries)) return null;

  const user = await readSessionUser(payload.sub, now);
  if (!user || user.status === 'disabled') return null;
  return publicUser(user);
}

export async function requireAdminUser(request: NextRequest): Promise<User | null> {
  const user = await getSessionUser(request);
  return user?.role === 'admin' ? user : null;
}
