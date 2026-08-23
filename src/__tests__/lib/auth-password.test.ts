import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

type ScryptExecutorInput = {
  password: string;
  salt: Buffer;
  keyLength: number;
  cost: number;
  blockSize: number;
  parallelization: number;
  maxmem: number;
};

type AuthPasswordContract = {
  createScryptCredential(password: string): Promise<string>;
  verifyScryptCredential(password: string, credential: string): Promise<boolean>;
  isValidScryptCredential(credential: string): boolean;
  createLegacyPasswordHash(password: string, secret: string): string;
  verifyLegacyCredential(
    password: string,
    storedHash: string,
    secrets: readonly string[],
  ): { matched: boolean; matchedIndex?: number };
  setScryptExecutorForTests(executor: (input: ScryptExecutorInput) => Promise<Buffer>): void;
  resetScryptConcurrencyForTests(): void;
};

async function loadAuthPassword(): Promise<AuthPasswordContract> {
  return await import('@/lib/auth/auth-password') as AuthPasswordContract;
}

afterEach(async () => {
  try {
    (await loadAuthPassword()).resetScryptConcurrencyForTests();
  } catch {
    // The RED baseline deliberately has no auth-password module yet.
  }
});

describe('versioned scrypt credentials', () => {
  it('creates the fixed v1 format with a 16-byte salt and 32-byte derived key', async () => {
    const { createScryptCredential } = await loadAuthPassword();

    const credential = await createScryptCredential('contract-password');
    const [version, cost, blockSize, parallelization, encodedSalt, encodedKey] = credential.split('$');

    expect([version, cost, blockSize, parallelization]).toEqual(['scrypt-v1', '32768', '8', '1']);
    expect(Buffer.from(encodedSalt, 'base64url')).toHaveLength(16);
    expect(Buffer.from(encodedKey, 'base64url')).toHaveLength(32);
  });

  it('accepts only the password from which a scrypt credential was created', async () => {
    const { createScryptCredential, verifyScryptCredential } = await loadAuthPassword();
    const credential = await createScryptCredential('correct-contract-password');

    await expect(verifyScryptCredential('correct-contract-password', credential)).resolves.toBe(true);
    await expect(verifyScryptCredential('wrong-contract-password', credential)).resolves.toBe(false);
  });

  it('uses a fresh random salt for every credential', async () => {
    const { createScryptCredential } = await loadAuthPassword();

    await expect(createScryptCredential('same-contract-password')).resolves.not.toBe(
      await createScryptCredential('same-contract-password'),
    );
  });

  it('fails closed for malformed, unknown-version, and out-of-bound credentials', async () => {
    const { verifyScryptCredential } = await loadAuthPassword();

    await expect(verifyScryptCredential('x', 'scrypt-v1$1$1$1$bad$bad')).resolves.toBe(false);
    await expect(verifyScryptCredential('x', 'scrypt-v2$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).resolves.toBe(false);
    await expect(verifyScryptCredential('x', 'scrypt-v1$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).resolves.toBe(false);
  });

  it('compares legacy hashes only against the caller-provided secret ring', async () => {
    const { createLegacyPasswordHash, verifyLegacyCredential } = await loadAuthPassword();
    const active = 'active-contract-secret-0123456789abcdef';
    const previous = 'previous-contract-secret-0123456789abcd';
    const storedHash = createLegacyPasswordHash('legacy-contract-password', active);

    expect(verifyLegacyCredential('wrong-contract-password', storedHash, [active, previous])).toEqual({ matched: false });
    expect(verifyLegacyCredential('legacy-contract-password', storedHash, [active, previous])).toEqual({
      matched: true,
      matchedIndex: 0,
    });
    expect(verifyLegacyCredential(
      'legacy-contract-password',
      storedHash,
      ['unrelated-contract-secret-0123456789ab'],
    )).toEqual({ matched: false });
  });

  it('keeps no more than four injected scrypt executions active at once', async () => {
    const {
      resetScryptConcurrencyForTests,
      setScryptExecutorForTests,
      verifyScryptCredential,
    } = await loadAuthPassword();
    let active = 0;
    let peak = 0;
    const salt = Buffer.alloc(16, 9);
    const derivedKey = Buffer.alloc(32, 7);
    const credential = `scrypt-v1$32768$8$1$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;

    resetScryptConcurrencyForTests();
    setScryptExecutorForTests(async ({ keyLength }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active -= 1;
      return Buffer.alloc(keyLength, 7);
    });

    await expect(Promise.all(Array.from({ length: 12 }, () => (
      verifyScryptCredential('bounded-contract-password', credential)
    )))).resolves.toEqual(Array.from({ length: 12 }, () => true));
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('keeps the legacy SHA-256 representation deterministic for stable rollback data', async () => {
    const { createLegacyPasswordHash } = await loadAuthPassword();
    const secret = 'rollback-contract-secret-0123456789abcdef';

    expect(createLegacyPasswordHash('legacy-contract-password', secret)).toBe(
      createHash('sha256').update(`${secret}:legacy-contract-password`).digest('hex'),
    );
  });
});
