import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createLayerDocument,
  ensureLayerDocumentTables,
  updateLayerDocument,
} from '@/lib/layer-documents/storage';
import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; '
    + 'layer document PostgreSQL concurrency test skipped.',
  );
}

function content(title: string) {
  return {
    schemaVersion: 1 as const,
    title,
    width: 1280,
    height: 1280,
    exportMode: 'pro' as const,
    layers: [{
      id: 'layer-1',
      name: '背景',
      role: 'background',
      imageUrl: '/api/serve-upload/layers/background.png',
      width: 1280,
      height: 1280,
      offsetX: 0,
      offsetY: 0,
      opacity: 1,
      blendMode: 'normal',
      visible: true,
      locked: false,
      order: 0,
      source: 'pear-psd' as const,
    }],
  };
}

describe('layer document storage on isolated PostgreSQL', () => {
  postgresIt('allows one revision winner and rejects the concurrent stale writer', async () => {
    await withIsolatedPostgres('layer-document-revision', async ({ query }) => {
      await ensureLayerDocumentTables();
      const suffix = randomUUID();
      const created = await createLayerDocument({
        id: `doc-${suffix}`,
        userId: `user-${suffix}`,
        projectId: `project-${suffix}`,
        sourceImageId: `image-${suffix}`,
        sourceVersionId: `version-${suffix}`,
        taskId: `task-${suffix}`,
        engine: 'pear',
        content: content('初始文档'),
      });

      const results = await Promise.allSettled([
        updateLayerDocument({
          documentId: created.id,
          userId: created.userId,
          expectedRevision: created.revision,
          content: content('窗口 A'),
        }),
        updateLayerDocument({
          documentId: created.id,
          userId: created.userId,
          expectedRevision: created.revision,
          content: content('窗口 B'),
        }),
      ]);

      const fulfilled = results.filter(result => result.status === 'fulfilled');
      const rejected = results.filter(result => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        reason: {
          code: 'LAYER_DOCUMENT_REVISION_CONFLICT',
          status: 409,
          retryable: false,
        },
      });

      const persisted = await query<{
        revision: number;
        title: string;
      }>(
        `SELECT revision, content->>'title' AS title
         FROM wujie_layer_documents
         WHERE id = $1 AND user_id = $2`,
        [created.id, created.userId],
      );
      expect(persisted.rows).toHaveLength(1);
      expect(persisted.rows[0]).toMatchObject({ revision: 1 });
      expect(['窗口 A', '窗口 B']).toContain(persisted.rows[0]?.title);
    });
  });
});
