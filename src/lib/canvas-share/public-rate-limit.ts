import { createHash } from 'node:crypto';

import type { Pool, QueryResultRow } from 'pg';

import { getPool } from '@/lib/db-client';

export type CanvasSharePublicRateBucket = 'metadata' | 'media' | 'download';

const RATE_LIMITS: Readonly<Record<CanvasSharePublicRateBucket, number>> = {
  metadata: 60,
  media: 180,
  download: 20,
};
const WINDOW_MS = 60_000;
const RETENTION_MS = 24 * 60 * 60 * 1_000;

interface RateWindowRow extends QueryResultRow {
  attempt_count: string | number;
}

export class CanvasSharePublicRateLimitError extends Error {
  readonly code = 'CANVAS_SHARE_RATE_LIMITED';
  readonly status = 429;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('请求过于频繁，请稍后重试');
    this.name = 'CanvasSharePublicRateLimitError';
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

function rateScopeDigest(tokenDigest: string, itemScope: string, ipAddress: string): string {
  if (!/^[a-f0-9]{64}$/u.test(tokenDigest)) {
    throw new TypeError('Canvas share token digest is invalid');
  }
  return createHash('sha256')
    .update('canvas-share-public-rate:v1\0', 'utf8')
    .update(tokenDigest, 'utf8')
    .update('\0', 'utf8')
    .update(itemScope.slice(0, 256), 'utf8')
    .update('\0', 'utf8')
    .update(ipAddress.slice(0, 128), 'utf8')
    .digest('hex');
}

export function getCanvasShareRequestIp(headers: Headers): string {
  if (process.env.WUJIE_TRUST_PROXY_IP_HEADERS !== 'true') return 'unknown';
  const candidates = [
    headers.get('cf-connecting-ip'),
    headers.get('x-real-ip'),
    headers.get('x-forwarded-for')?.split(',', 1)[0],
  ];
  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (normalized && /^[A-Fa-f0-9:.]{2,64}$/u.test(normalized)) return normalized;
  }
  return 'unknown';
}

export interface EnforceCanvasSharePublicRateLimitInput {
  tokenDigest: string;
  itemScope: string;
  ipAddress: string;
  routeBucket: CanvasSharePublicRateBucket;
  now?: Date;
  database?: Pick<Pool, 'query'>;
}

export async function enforceCanvasSharePublicRateLimit(
  input: EnforceCanvasSharePublicRateLimitInput,
): Promise<void> {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError('Canvas share rate time is invalid');
  const windowStart = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
  const retentionBoundary = new Date(now.getTime() - RETENTION_MS);
  const scopeDigest = rateScopeDigest(input.tokenDigest, input.itemScope, input.ipAddress);
  const database = input.database ?? getPool();
  const result = await database.query<RateWindowRow>(
    `WITH cleanup AS (
       DELETE FROM wujie_canvas_share_rate_windows
       WHERE window_start < $4::timestamptz
     ), counted AS (
       INSERT INTO wujie_canvas_share_rate_windows (
         scope_digest, route_bucket, window_start, attempt_count
       ) VALUES ($1, $2, $3::timestamptz, 1)
       ON CONFLICT (scope_digest, route_bucket, window_start)
       DO UPDATE SET attempt_count = wujie_canvas_share_rate_windows.attempt_count + 1
       RETURNING attempt_count
     )
     SELECT attempt_count FROM counted`,
    [
      scopeDigest,
      input.routeBucket,
      windowStart.toISOString(),
      retentionBoundary.toISOString(),
    ],
  );
  const attemptCount = Number(result.rows[0]?.attempt_count);
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new Error('CANVAS_SHARE_RATE_WINDOW_UNAVAILABLE');
  }
  if (attemptCount > RATE_LIMITS[input.routeBucket]) {
    const retryAfterSeconds = (windowStart.getTime() + WINDOW_MS - now.getTime()) / 1_000;
    throw new CanvasSharePublicRateLimitError(retryAfterSeconds);
  }
}
