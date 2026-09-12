import { describe, expect, it, vi } from 'vitest';

import { readProjectSnapshot } from '@/lib/asset-core/project-readers';
import { PostgresAssetStorage } from '@/lib/asset-core/storage';
import type { WorkspacePlacement } from '@/lib/asset-core/types';

function placement(entityType: 'canvas-image' | 'canvas-video', legacyImage: Record<string, unknown>): WorkspacePlacement {
  return {
    id: 'placement-1', ownerId: 'owner-1', projectId: 'project-1', assetId: 'asset-1',
    assetVersionId: 'version-1', workspace: 'canvas', workspaceId: 'canvas:project-1',
    entityType, entityId: 'media-1', status: 'active', deletedAt: null,
    metadata: { legacyImage }, createdAt: '2026-09-13T00:00:00.000Z', updatedAt: '2026-09-13T00:00:00.000Z',
  };
}

async function restore(entityType: 'canvas-image' | 'canvas-video', kind: 'image' | 'video', legacyImage: Record<string, unknown>) {
  let writtenProjects: unknown;
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock_shared')) return { rows: [], rowCount: 0 };
    if (sql.includes("data_key = 'projects'") && sql.includes('FOR UPDATE')) {
      return { rows: [{ data_value: [{ id: 'project-1', canvasImages: [] }] }], rowCount: 1 };
    }
    if (sql.includes('FROM wujie_asset_versions v')) return { rows: [{
      id: 'version-1', asset_id: 'asset-1', owner_id: 'owner-1', project_id: 'project-1',
      file_url: kind === 'video' ? '/media/final.mp4' : '/media/final.png', storage_key: null,
      checksum: null, mime_type: kind === 'video' ? 'video/mp4' : 'image/png', byte_size: '10',
      width: 1920, height: 1080, availability: 'ready', recovery_source_url: null,
      task_id: null, idempotency_key: null, metadata: {}, created_at: new Date('2026-09-13T00:00:00.000Z'),
      parent_version_ids: [],
    }], rowCount: 1 };
    if (sql.includes('SELECT * FROM wujie_assets')) return { rows: [{
      id: 'asset-1', owner_id: 'owner-1', project_id: 'project-1', kind, status: 'active',
      current_version_id: 'version-1', created_at: new Date('2026-09-13T00:00:00.000Z'),
      updated_at: new Date('2026-09-13T00:00:00.000Z'),
    }], rowCount: 1 };
    if (sql.includes("SET data_value = $2::jsonb")) {
      writtenProjects = JSON.parse(String(values?.[1]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("'__asset_graph_projects_revision'")) return { rows: [{ revision: '1' }], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const pool = { connect: vi.fn(async () => ({ query, release: vi.fn() })) };
  const storage = new PostgresAssetStorage(pool as never);
  await storage.transaction(transaction => transaction.restoreCanvasPlacementSnapshot(
    'owner-1', 'project-1', placement(entityType, legacyImage),
  ));
  const project = (writtenProjects as Array<Record<string, unknown>>)[0];
  return readProjectSnapshot(project).project?.canvasImages[0];
}

describe('canvas placement snapshot restore', () => {
  it('restores canvas-video as playable video and preserves its poster after a legacy refresh', async () => {
    const restored = await restore('canvas-video', 'video', {
      url: '/media/poster.jpg', thumbnailUrl: '/media/poster.jpg', videoThumbnailUrl: '/media/poster.jpg',
      videoUrl: '/media/old.mp4', mediaType: 'video', width: 640, height: 360,
    });

    expect(restored).toMatchObject({
      mediaType: 'video', videoUrl: '/media/final.mp4', url: '/media/poster.jpg',
      thumbnailUrl: '/media/poster.jpg', videoThumbnailUrl: '/media/poster.jpg',
      assetVersionId: 'version-1', placementId: 'placement-1',
    });
  });

  it('keeps the existing canvas-image restore shape unchanged', async () => {
    const restored = await restore('canvas-image', 'image', { url: '/media/old.png', width: 640, height: 360 });
    expect(restored).toMatchObject({
      url: '/media/final.png', assetVersionId: 'version-1', placementId: 'placement-1',
    });
    expect(restored?.mediaType).toBeUndefined();
    expect(restored?.videoUrl).toBeUndefined();
  });
});
