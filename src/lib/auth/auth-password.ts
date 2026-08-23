import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_VERSION = 'scrypt-v1';
const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_SALT_LENGTH = 16;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENCY = 4;
const MAX_SCRYPT_CONCURRENCY = 16;

export interface ScryptExecutorInput {
  password: string;
  salt: Buffer;
  keyLength: number;
  cost: number;
  blockSize: number;
  parallelization: number;
  maxmem: number;
}

type ScryptExecutor = (input: ScryptExecutorInput) => Promise<Buffer>;

export interface AuthPasswordService {
  createScryptCredential(password: string): Promise<string>;
  verifyScryptCredential(password: string, credential: string): Promise<boolean>;
}

interface ParsedScryptCredential {
  salt: Buffer;
  key: Buffer;
}

interface QueuedWork<T> {
  work: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

class FifoConcurrencyLimiter {
  private activeCount = 0;
  private readonly queue: QueuedWork<unknown>[] = [];

  constructor(private readonly maxConcurrency: number) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        work: work as () => Promise<unknown>,
        resolve: resolve as (value: unknown | PromiseLike<unknown>) => void,
        reject,
      });
      this.drain();
    });
  }

  private drain(): void {
    while (this.activeCount < this.maxConcurrency) {
      const queuedWork = this.queue.shift();
      if (!queuedWork) {
        return;
      }

      this.activeCount += 1;
      void this.execute(queuedWork);
    }
  }

  private async execute(queuedWork: QueuedWork<unknown>): Promise<void> {
    try {
      queuedWork.resolve(await queuedWork.work());
    } catch (error) {
      queuedWork.reject(error);
    } finally {
      this.activeCount -= 1;
      this.drain();
    }
  }
}

function executeScrypt(input: ScryptExecutorInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      input.password,
      input.salt,
      input.keyLength,
      {
        N: input.cost,
        r: input.blockSize,
        p: input.parallelization,
        maxmem: input.maxmem,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

function decodeBase64Url(value: string, expectedLength: number): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return undefined;
  }

  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== expectedLength || decoded.toString('base64url') !== value) {
    return undefined;
  }

  return decoded;
}

function parseScryptCredential(credential: string): ParsedScryptCredential | undefined {
  const segments = credential.split('$');
  if (segments.length !== 6) {
    return undefined;
  }

  const [version, cost, blockSize, parallelization, encodedSalt, encodedKey] = segments;
  if (
    version !== SCRYPT_VERSION
    || cost !== String(SCRYPT_COST)
    || blockSize !== String(SCRYPT_BLOCK_SIZE)
    || parallelization !== String(SCRYPT_PARALLELIZATION)
  ) {
    return undefined;
  }

  const salt = decodeBase64Url(encodedSalt, SCRYPT_SALT_LENGTH);
  const key = decodeBase64Url(encodedKey, SCRYPT_KEY_LENGTH);
  if (!salt || !key) {
    return undefined;
  }

  return { salt, key };
}

function isValidMaxConcurrency(maxConcurrency: number): boolean {
  return Number.isInteger(maxConcurrency)
    && maxConcurrency > 0
    && maxConcurrency <= MAX_SCRYPT_CONCURRENCY;
}

export function createAuthPasswordService(input: {
  scryptExecutor: ScryptExecutor;
  maxConcurrency: number;
}): AuthPasswordService {
  if (!isValidMaxConcurrency(input.maxConcurrency)) {
    throw new RangeError(`maxConcurrency must be an integer between 1 and ${MAX_SCRYPT_CONCURRENCY}`);
  }

  const limiter = new FifoConcurrencyLimiter(input.maxConcurrency);
  const deriveKey = (password: string, salt: Buffer): Promise<Buffer> => limiter.run(() => (
    input.scryptExecutor({
      password,
      salt,
      keyLength: SCRYPT_KEY_LENGTH,
      cost: SCRYPT_COST,
      blockSize: SCRYPT_BLOCK_SIZE,
      parallelization: SCRYPT_PARALLELIZATION,
      maxmem: SCRYPT_MAXMEM,
    })
  ));

  return {
    async createScryptCredential(password: string): Promise<string> {
      const salt = randomBytes(SCRYPT_SALT_LENGTH);
      const derivedKey = await deriveKey(password, salt);
      if (derivedKey.length !== SCRYPT_KEY_LENGTH) {
        throw new Error('Scrypt executor returned an unexpected key length.');
      }
      return [
        SCRYPT_VERSION,
        SCRYPT_COST,
        SCRYPT_BLOCK_SIZE,
        SCRYPT_PARALLELIZATION,
        salt.toString('base64url'),
        derivedKey.toString('base64url'),
      ].join('$');
    },

    async verifyScryptCredential(password: string, credential: string): Promise<boolean> {
      const parsedCredential = parseScryptCredential(credential);
      if (!parsedCredential) {
        return false;
      }

      const derivedKey = await deriveKey(password, parsedCredential.salt);
      return derivedKey.length === SCRYPT_KEY_LENGTH
        && timingSafeEqual(derivedKey, parsedCredential.key);
    },
  };
}

const defaultAuthPasswordService = createAuthPasswordService({
  scryptExecutor: executeScrypt,
  maxConcurrency: DEFAULT_MAX_CONCURRENCY,
});

export function createScryptCredential(password: string): Promise<string> {
  return defaultAuthPasswordService.createScryptCredential(password);
}

export function verifyScryptCredential(password: string, credential: string): Promise<boolean> {
  return defaultAuthPasswordService.verifyScryptCredential(password, credential);
}

export function isValidScryptCredential(credential: string): boolean {
  return parseScryptCredential(credential) !== undefined;
}

export function createLegacyPasswordHash(password: string, secret: string): string {
  return createHash('sha256').update(`${secret}:${password}`).digest('hex');
}

export function verifyLegacyCredential(
  password: string,
  storedHash: string,
  secrets: readonly string[],
): { matched: boolean; matchedIndex?: number } {
  if (!/^[a-f0-9]{64}$/i.test(storedHash)) {
    return { matched: false };
  }

  const storedHashBuffer = Buffer.from(storedHash, 'hex');
  for (const [index, secret] of secrets.entries()) {
    const candidateHash = createLegacyPasswordHash(password, secret);
    if (timingSafeEqual(Buffer.from(candidateHash, 'hex'), storedHashBuffer)) {
      return { matched: true, matchedIndex: index };
    }
  }

  return { matched: false };
}
