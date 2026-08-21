import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationPath = path.join(root, 'migrations/20260821_v588_admin_thumbnail_variants.sql');
const servicePath = path.join(root, 'src/lib/asset-core/thumbnail-backfill.ts');
const routePath = path.join(root, 'src/app/api/admin/backfill-thumbnails/route.ts');

function sourceIfPresent(filePath: string): string {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

describe('administrator thumbnail backfill architecture', () => {
  it('stores one durable variant per asset version and size', () => {
    const migration = sourceIfPresent(migrationPath);
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS wujie_asset_thumbnail_variants');
    expect(migration).toContain('PRIMARY KEY (asset_version_id, size)');
    expect(migration).toContain("status IN ('pending', 'processing', 'ready', 'failed')");
  });

  it('uses a database lease that can be reclaimed after worker interruption', () => {
    const service = sourceIfPresent(servicePath);
    expect(service).toContain('FOR UPDATE SKIP LOCKED');
    expect(service).toContain('lease_expires_at');
    expect(service).toContain('lease_owner');
    expect(service).not.toContain('backfillInFlight');
  });

  it('guards every status and mutation handler with administrator authorization', () => {
    const route = sourceIfPresent(routePath);
    expect(route.match(/requireAdminUser\(/g) ?? []).toHaveLength(2);
    expect(route).toContain('export async function GET');
    expect(route).toContain('export async function POST');
  });

  it('discovers image versions from the asset graph instead of scanning uploads', () => {
    const service = sourceIfPresent(servicePath);
    expect(service).toContain('INSERT INTO wujie_asset_thumbnail_variants');
    expect(service).toContain('JOIN wujie_assets asset');
    expect(service).toContain("asset.kind = 'image'");
    expect(service).not.toContain('fsp.readdir');
  });

  it('settles only the worker that still owns the durable lease', () => {
    const service = sourceIfPresent(servicePath);
    expect(service).toContain("status = 'processing'");
    expect(service).toContain('lease_owner = $3');
    expect(service).toContain('RETURNING asset_version_id');
  });

  it('uses the existing safe image and durable storage boundaries', () => {
    const service = sourceIfPresent(servicePath);
    expect(service).toContain('loadSafeImageInput');
    expect(service).toContain('safeSharp');
    expect(service).toContain('uploadImageToS3');
    expect(service).toContain('isServerDataRootDurable');
  });

  it('stores the object under the same relative path served by the media gateway', () => {
    const service = sourceIfPresent(servicePath);
    expect(service).toContain('`${subdirectory}/${filename}`');
    expect(service).not.toContain('`thumbnail-${target.assetVersionId}-${filename}`');
  });
});
