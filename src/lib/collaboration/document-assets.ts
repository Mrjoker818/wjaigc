import 'server-only';

import type { PoolClient } from 'pg';

import { getManagedAssetMediaDescriptor } from '@/lib/asset-core/managed-media-read';
import type { AssetKind, AssetVersion } from '@/lib/asset-core/types';

interface DocumentAssetRow {
  id: string;
  asset_id: string;
  kind: AssetKind;
  file_url: string;
  storage_key: string | null;
  checksum: string | null;
  mime_type: string | null;
  byte_size: string | null;
  width: number | null;
  height: number | null;
}

export class DocumentAssetError extends Error {
  readonly code = 'DOCUMENT_ASSET_FORBIDDEN';

  constructor() {
    super('项目文档不能引用此资产版本');
    this.name = 'DocumentAssetError';
  }
}

export async function assertProjectAssetVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
  client: PoolClient,
): Promise<void> {
  if (![ownerId, projectId, versionId].every(
    value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256,
  )) throw new DocumentAssetError();
  const result = await client.query<DocumentAssetRow>(
    `SELECT version.id, version.asset_id, version.file_url, version.storage_key,
            version.checksum, version.mime_type, version.byte_size,
            version.width, version.height, asset.kind
       FROM wujie_asset_versions version
       JOIN wujie_assets asset
         ON asset.id = version.asset_id
        AND asset.owner_id = version.owner_id
        AND asset.project_id = version.project_id
       JOIN wujie_projects project
         ON project.id = asset.project_id AND project.owner_id = asset.owner_id
      WHERE version.id = $1
        AND version.owner_id = $2 AND version.project_id = $3
        AND version.availability = 'ready'
        AND asset.status = 'active' AND asset.kind IN ('image', 'video')
        AND project.status = 'active'
      FOR SHARE OF version, asset, project`,
    [versionId, ownerId, projectId],
  );
  const row = result.rows[0];
  if (result.rowCount !== 1 || !row) throw new DocumentAssetError();
  const version: AssetVersion = {
    id: row.id,
    assetId: row.asset_id,
    ownerId,
    projectId,
    file: {
      url: row.file_url,
      availability: 'ready',
      ...(row.storage_key ? { storageKey: row.storage_key } : {}),
      ...(row.checksum ? { checksum: row.checksum } : {}),
      ...(row.mime_type ? { mimeType: row.mime_type } : {}),
      ...(row.byte_size !== null ? { byteSize: Number(row.byte_size) } : {}),
      ...(row.width !== null ? { width: row.width } : {}),
      ...(row.height !== null ? { height: row.height } : {}),
    },
    parentVersionIds: [],
    createdAt: new Date(0).toISOString(),
  };
  try {
    await getManagedAssetMediaDescriptor(version, row.kind);
  } catch {
    throw new DocumentAssetError();
  }
}
