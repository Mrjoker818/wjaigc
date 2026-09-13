import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('media gateway migration contract', () => {
  it('defines the three gateway tables and concurrency constraints', async () => {
    const sql = await readFile(
      resolve(process.cwd(), 'migrations', '20260913_v588_media_gateway.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS wujie_gateway_keys');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS wujie_gateway_rate_windows');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS wujie_gateway_requests');
    expect(sql).toContain('UNIQUE (gateway_key_id, idempotency_key)');
    expect(sql).toContain("CHECK (media_type IN ('image', 'video'))");
    expect(sql).toContain(
      "CHECK (admission_status IN ('reserved', 'admitted', 'rejected'))",
    );
    expect(sql).not.toMatch(/api[_-]?key\s+TEXT/i);
  });

  it('is additive and indexes the required gateway lookup fields', async () => {
    const sql = await readFile(
      resolve(process.cwd(), 'migrations', '20260913_v588_media_gateway.sql'),
      'utf8',
    );

    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS\s+\S+\s+ON wujie_gateway_keys\s*\(user_id\)/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS\s+\S+\s+ON wujie_gateway_keys\s*\(created_at\)/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS\s+\S+\s+ON wujie_gateway_requests\s*\(user_id\)/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS\s+\S+\s+ON wujie_gateway_requests\s*\(created_at\)/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS\s+\S+\s+ON wujie_gateway_requests\s*\(admission_status\)/i);
    expect(sql).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE|DELETE|UPDATE)\b/i);
  });
});
