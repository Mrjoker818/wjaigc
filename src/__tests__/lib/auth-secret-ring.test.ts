import { describe, expect, it } from 'vitest';

import { AuthServiceError } from '@/lib/auth/auth-errors';

type AuthSecretEntry = {
  kid: string;
  secret: string;
  activatedAt: number;
  retiredAt?: number;
};

type AuthSecretRingV1 = {
  version: 1;
  active: AuthSecretEntry;
  previous?: AuthSecretEntry;
  updatedAt: number;
};

type AuthSecretRingContract = {
  deriveAuthSecretKid(secret: string): string;
  parseAuthSecretRing(value: unknown): AuthSecretRingV1 | null;
  planSecretRingRotation(
    ring: AuthSecretRingV1,
    nextSecret: string,
    now: number,
    previousNeededByLegacyCredentials: boolean,
  ): AuthSecretRingV1;
  sessionVerificationEntries(
    ring: AuthSecretRingV1,
    input: { now: number; acceptPrevious: boolean; ttlSeconds: number },
  ): AuthSecretEntry[];
};

async function loadAuthSecretRing(): Promise<AuthSecretRingContract> {
  return await import('@/lib/auth/auth-secret-ring') as AuthSecretRingContract;
}

const now = 1_724_601_600_000;
const activeSecret = 'active-ring-contract-secret-0123456789abcdef';
const nextSecret = 'next-ring-contract-secret-0123456789abcdef12';
const thirdSecret = 'third-ring-contract-secret-0123456789abcdef1';

describe('authentication secret ring', () => {
  it('derives a non-secret stable kid and strictly parses a valid v1 ring', async () => {
    const { deriveAuthSecretKid, parseAuthSecretRing } = await loadAuthSecretRing();
    const ring: AuthSecretRingV1 = {
      version: 1,
      active: {
        kid: deriveAuthSecretKid(activeSecret),
        secret: activeSecret,
        activatedAt: now,
      },
      updatedAt: now,
    };

    expect(deriveAuthSecretKid(activeSecret)).toHaveLength(16);
    expect(deriveAuthSecretKid(activeSecret)).not.toContain(activeSecret);
    const parsed = parseAuthSecretRing(ring);

    expect(parsed).toEqual(ring);
    expect(parsed).not.toBe(ring);
    expect(parsed?.active).not.toBe(ring.active);

    ring.active.secret = nextSecret;
    expect(parsed?.active.secret).toBe(activeSecret);
  });

  it('rejects malformed, unsafe, and internally inconsistent rings', async () => {
    const { deriveAuthSecretKid, parseAuthSecretRing } = await loadAuthSecretRing();
    const validActive = {
      kid: deriveAuthSecretKid(activeSecret),
      secret: activeSecret,
      activatedAt: now,
    };

    expect(parseAuthSecretRing(null)).toBeNull();
    expect(parseAuthSecretRing([])).toBeNull();
    expect(parseAuthSecretRing({
      version: 2,
      active: { kid: 'not-a-valid-kid', secret: activeSecret, activatedAt: now },
      updatedAt: now,
    })).toBeNull();
    expect(parseAuthSecretRing({
      version: 1,
      active: { kid: 'mismatched-kid', secret: activeSecret, activatedAt: now },
      updatedAt: now,
    })).toBeNull();
    expect(parseAuthSecretRing({
      version: 1,
      active: validActive,
      updatedAt: now,
      unexpected: true,
    })).toBeNull();
    expect(parseAuthSecretRing({
      version: 1,
      active: { ...validActive, unexpected: true },
      updatedAt: now,
    })).toBeNull();
    const accessorRing: Record<string, unknown> = { version: 1, active: validActive };
    Object.defineProperty(accessorRing, 'updatedAt', {
      enumerable: true,
      get: () => now,
    });
    expect(parseAuthSecretRing(accessorRing)).toBeNull();
    expect(parseAuthSecretRing({
      version: 1,
      active: { ...validActive, secret: 'too-short' },
      updatedAt: now,
    })).toBeNull();

    for (const invalidTimestamp of [NaN, Infinity, 1.5, 0, -1]) {
      expect(parseAuthSecretRing({
        version: 1,
        active: { ...validActive, activatedAt: invalidTimestamp },
        updatedAt: now,
      })).toBeNull();
    }
    expect(parseAuthSecretRing({
      version: 1,
      active: validActive,
      updatedAt: Number.POSITIVE_INFINITY,
    })).toBeNull();

    expect(parseAuthSecretRing({
      version: 1,
      active: { ...validActive, activatedAt: now + 1 },
      updatedAt: now,
    })).toBeNull();
    expect(parseAuthSecretRing({
      version: 1,
      active: validActive,
      previous: {
        kid: 'mismatched-kid',
        secret: nextSecret,
        activatedAt: now - 1,
        retiredAt: now,
      },
      updatedAt: now,
    })).toBeNull();
    expect(parseAuthSecretRing({
      version: 1,
      active: validActive,
      previous: {
        kid: deriveAuthSecretKid(nextSecret),
        secret: nextSecret,
        activatedAt: now - 1,
      },
      updatedAt: now,
    })).toBeNull();
    expect(parseAuthSecretRing({
      version: 1,
      active: validActive,
      previous: {
        kid: deriveAuthSecretKid(nextSecret),
        secret: nextSecret,
        activatedAt: now,
        retiredAt: now - 1,
      },
      updatedAt: now,
    })).toBeNull();
    expect(parseAuthSecretRing({
      version: 1,
      active: validActive,
      previous: {
        kid: deriveAuthSecretKid(nextSecret),
        secret: nextSecret,
        activatedAt: now - 1,
        retiredAt: now + 1,
      },
      updatedAt: now,
    })).toBeNull();
    expect(parseAuthSecretRing({
      version: 1,
      active: validActive,
      previous: {
        kid: validActive.kid,
        secret: activeSecret,
        activatedAt: now - 1,
        retiredAt: now,
      },
      updatedAt: now,
    })).toBeNull();
  });

  it('moves the active entry to previous on the first rotation', async () => {
    const { deriveAuthSecretKid, planSecretRingRotation } = await loadAuthSecretRing();
    const existingRing: AuthSecretRingV1 = {
      version: 1,
      active: { kid: deriveAuthSecretKid(activeSecret), secret: activeSecret, activatedAt: now },
      updatedAt: now,
    };

    const rotated = planSecretRingRotation(existingRing, nextSecret, now + 1, false);

    expect(rotated.active.secret).toBe(nextSecret);
    expect(rotated.previous?.secret).toBe(existingRing.active.secret);
    expect(rotated.previous?.retiredAt).toBe(now + 1);
    expect(rotated.active).toEqual({
      kid: deriveAuthSecretKid(nextSecret),
      secret: nextSecret,
      activatedAt: now + 1,
    });
    expect(rotated.updatedAt).toBe(now + 1);
  });

  it('returns the existing ring object unchanged when rotating to the active secret', async () => {
    const { deriveAuthSecretKid, planSecretRingRotation } = await loadAuthSecretRing();
    const existingRing: AuthSecretRingV1 = {
      version: 1,
      active: { kid: deriveAuthSecretKid(activeSecret), secret: activeSecret, activatedAt: now },
      updatedAt: now,
    };

    expect(planSecretRingRotation(existingRing, activeSecret, now + 1, false)).toBe(existingRing);
  });

  it('rejects a new secret that does not meet the minimum length', async () => {
    const { deriveAuthSecretKid, planSecretRingRotation } = await loadAuthSecretRing();
    const existingRing: AuthSecretRingV1 = {
      version: 1,
      active: { kid: deriveAuthSecretKid(activeSecret), secret: activeSecret, activatedAt: now },
      updatedAt: now,
    };

    expect(() => planSecretRingRotation(existingRing, 'too-short', now + 1, false)).toThrow();
  });

  it('blocks a second rotation that would discard an active legacy credential verifier', async () => {
    const { deriveAuthSecretKid, planSecretRingRotation } = await loadAuthSecretRing();
    const existingRing: AuthSecretRingV1 = {
      version: 1,
      active: { kid: deriveAuthSecretKid(activeSecret), secret: activeSecret, activatedAt: now },
      updatedAt: now,
    };
    const rotated = planSecretRingRotation(existingRing, nextSecret, now + 1, false);

    try {
      planSecretRingRotation(rotated, thirdSecret, now + 2, true);
      throw new Error('Expected rotation to be blocked.');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthServiceError);
      expect((error as AuthServiceError).code).toBe('AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS');
    }
  });

  it('uses the previous entry only during the configured seven-day session window', async () => {
    const { deriveAuthSecretKid, sessionVerificationEntries } = await loadAuthSecretRing();
    const ring: AuthSecretRingV1 = {
      version: 1,
      active: { kid: deriveAuthSecretKid(nextSecret), secret: nextSecret, activatedAt: now },
      previous: {
        kid: deriveAuthSecretKid(activeSecret),
        secret: activeSecret,
        activatedAt: now - 1,
        retiredAt: now,
      },
      updatedAt: now,
    };

    expect(sessionVerificationEntries(ring, {
      now: now + 6 * 24 * 60 * 60 * 1000,
      acceptPrevious: true,
      ttlSeconds: 7 * 24 * 60 * 60,
    })).toEqual([ring.active, ring.previous]);
    expect(sessionVerificationEntries(ring, {
      now: now + 8 * 24 * 60 * 60 * 1000,
      acceptPrevious: true,
      ttlSeconds: 7 * 24 * 60 * 60,
    })).toEqual([ring.active]);
    expect(sessionVerificationEntries(ring, {
      now: now + 60_000,
      acceptPrevious: false,
      ttlSeconds: 7 * 24 * 60 * 60,
    })).toEqual([ring.active]);
    expect(sessionVerificationEntries(ring, {
      now: now - 1,
      acceptPrevious: true,
      ttlSeconds: 7 * 24 * 60 * 60,
    })).toEqual([ring.active]);
    expect(sessionVerificationEntries(ring, {
      now: now + 60_000,
      acceptPrevious: true,
      ttlSeconds: 0,
    })).toEqual([ring.active]);
    expect(sessionVerificationEntries(ring, {
      now: Number.NaN,
      acceptPrevious: true,
      ttlSeconds: 7 * 24 * 60 * 60,
    })).toEqual([ring.active]);
    expect(sessionVerificationEntries({
      ...ring,
      previous: { ...ring.previous!, retiredAt: Number.POSITIVE_INFINITY },
    }, {
      now: now + 60_000,
      acceptPrevious: true,
      ttlSeconds: 7 * 24 * 60 * 60,
    })).toEqual([ring.active]);
  });
});
