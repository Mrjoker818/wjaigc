import { createHash } from 'node:crypto';

import { AuthServiceError } from './auth-errors';

const MIN_SECRET_LENGTH = 32;
const MILLISECONDS_PER_SECOND = 1_000;

export interface AuthSecretEntry {
  kid: string;
  secret: string;
  activatedAt: number;
  retiredAt?: number;
}

export interface AuthSecretRingV1 {
  version: 1;
  active: AuthSecretEntry;
  previous?: AuthSecretEntry;
  updatedAt: number;
}

type StrictRecord = Record<string, unknown>;

function isPositiveTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function readStrictRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): StrictRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return null;
  }

  const permittedKeys = new Set([...requiredKeys, ...optionalKeys]);
  const keys = Reflect.ownKeys(value);
  if (keys.length < requiredKeys.length || keys.length > permittedKeys.size) {
    return null;
  }

  const normalized: StrictRecord = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !permittedKeys.has(key)) {
      return null;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      return null;
    }

    normalized[key] = descriptor.value;
  }

  if (!requiredKeys.every((key) => Object.hasOwn(normalized, key))) {
    return null;
  }

  return normalized;
}

function parseSecretEntry(value: unknown, kind: 'active' | 'previous'): AuthSecretEntry | null {
  const entry = readStrictRecord(
    value,
    kind === 'active'
      ? ['kid', 'secret', 'activatedAt']
      : ['kid', 'secret', 'activatedAt', 'retiredAt'],
  );
  if (!entry || typeof entry.kid !== 'string' || typeof entry.secret !== 'string') {
    return null;
  }

  if (entry.secret.length < MIN_SECRET_LENGTH || !isPositiveTimestamp(entry.activatedAt)) {
    return null;
  }

  if (entry.kid !== deriveAuthSecretKid(entry.secret)) {
    return null;
  }

  if (kind === 'previous') {
    if (!isPositiveTimestamp(entry.retiredAt)) {
      return null;
    }

    return {
      kid: entry.kid,
      secret: entry.secret,
      activatedAt: entry.activatedAt,
      retiredAt: entry.retiredAt,
    };
  }

  return {
    kid: entry.kid,
    secret: entry.secret,
    activatedAt: entry.activatedAt,
  };
}

function assertRotationInput(condition: boolean): void {
  if (!condition) {
    throw new TypeError('Authentication rotation input is invalid.');
  }
}

export function deriveAuthSecretKid(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url').slice(0, 16);
}

export function parseAuthSecretRing(value: unknown): AuthSecretRingV1 | null {
  try {
    const ring = readStrictRecord(value, ['version', 'active', 'updatedAt'], ['previous']);
    if (!ring || ring.version !== 1 || !isPositiveTimestamp(ring.updatedAt)) {
      return null;
    }

    const active = parseSecretEntry(ring.active, 'active');
    if (!active || active.activatedAt > ring.updatedAt) {
      return null;
    }

    if (!Object.hasOwn(ring, 'previous')) {
      return { version: 1, active, updatedAt: ring.updatedAt };
    }

    const previous = parseSecretEntry(ring.previous, 'previous');
    if (!previous) {
      return null;
    }
    const previousRetiredAt = previous.retiredAt;
    if (previousRetiredAt === undefined
      || previous.kid === active.kid
      || previousRetiredAt < previous.activatedAt
      || previousRetiredAt > ring.updatedAt) {
      return null;
    }

    return { version: 1, active, previous, updatedAt: ring.updatedAt };
  } catch {
    return null;
  }
}

export function planSecretRingRotation(
  ring: AuthSecretRingV1,
  nextSecret: string,
  now: number,
  previousNeededByLegacyCredentials: boolean,
): AuthSecretRingV1 {
  if (nextSecret === ring.active.secret) {
    return ring;
  }

  assertRotationInput(typeof nextSecret === 'string' && nextSecret.length >= MIN_SECRET_LENGTH);
  assertRotationInput(isPositiveTimestamp(now));

  const normalizedRing = parseAuthSecretRing(ring);
  if (!normalizedRing) {
    throw new TypeError('Authentication rotation input is invalid.');
  }
  assertRotationInput(now >= normalizedRing.updatedAt);

  if (normalizedRing.previous && previousNeededByLegacyCredentials) {
    throw new AuthServiceError(
      'AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS',
      'Authentication rotation cannot safely proceed.',
      409,
      false,
    );
  }

  return {
    version: 1,
    active: {
      kid: deriveAuthSecretKid(nextSecret),
      secret: nextSecret,
      activatedAt: now,
    },
    previous: {
      ...normalizedRing.active,
      retiredAt: now,
    },
    updatedAt: now,
  };
}

export function sessionVerificationEntries(
  ring: AuthSecretRingV1,
  input: { now: number; acceptPrevious: boolean; ttlSeconds: number },
): AuthSecretEntry[] {
  const activeOnly = [ring.active];
  if (input.acceptPrevious !== true
    || !isPositiveTimestamp(input.now)
    || !isPositiveTimestamp(input.ttlSeconds)) {
    return activeOnly;
  }

  const ttlMilliseconds = input.ttlSeconds * MILLISECONDS_PER_SECOND;
  const previous = ring.previous;
  if (!Number.isSafeInteger(ttlMilliseconds) || !previous) {
    return activeOnly;
  }
  const retiredAt = previous.retiredAt;
  if (!isPositiveTimestamp(retiredAt) || input.now < retiredAt) {
    return activeOnly;
  }

  return input.now - retiredAt <= ttlMilliseconds
    ? [ring.active, previous]
    : activeOnly;
}
