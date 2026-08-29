import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execSql } = vi.hoisted(() => ({ execSql: vi.fn() }));
vi.mock('@/lib/db-client', () => ({ execSql }));

import {
  createLayerDocument,
  deleteLayerDocumentsForProject,
  ensureLayerDocumentTables,
  findLatestLayerDocument,
  updateLayerDocument,
} from '@/lib/layer-documents/storage';
import { LayerDocumentError } from '@/lib/layer-documents/validation';

const content = {
  schemaVersion: 1 as const,
  title: '分层文档',
  width: 1280,
  height: 1280,
  exportMode: 'pro' as const,
  layers: [{
    id: 'layer-1', name: '背景', role: 'background',
    imageUrl: '/api/serve-upload/layers/background.png',
    width: 1280, height: 1280, offsetX: 0, offsetY: 0,
    opacity: 1, blendMode: 'normal', visible: true, locked: false,
    order: 0, source: 'pear-psd' as const,
  }],
};

function row(revision = 0) {
  return {
    id: 'doc-1', user_id: 'user-a', project_id: 'project-a',
    source_image_id: 'image-a', source_version_id: 'version-a',
    task_id: 'task-a', engine: 'pear', schema_version: 1,
    revision, content, created_at: 100, updated_at: 200,
  };
}

describe('layer document storage', () => {
  beforeEach(() => {
    execSql.mockReset();
    execSql.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('creates the isolated table, ownership indexes and task idempotency key', async () => {
    await ensureLayerDocumentTables();
    const sql = execSql.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS wujie_layer_documents');
    expect(sql).toContain('UNIQUE (user_id, task_id)');
    expect(sql).toContain('CHECK (revision >= 0)');
    expect(sql).toContain('CHECK (schema_version = 1)');
    expect(sql).toContain('source_version_id, updated_at DESC');
  });

  it('returns the existing user task document on idempotent create', async () => {
    execSql.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO wujie_layer_documents')) return { rows: [], rowCount: 0 };
      if (sql.includes('WHERE user_id = $1 AND task_id = $2')) return { rows: [row()], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    await expect(createLayerDocument({
      id: 'new-doc', userId: 'user-a', projectId: 'project-a',
      sourceImageId: 'image-a', sourceVersionId: 'version-a', taskId: 'task-a',
      engine: 'pear', content,
    })).resolves.toMatchObject({ id: 'doc-1', revision: 0 });

    const insert = execSql.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO wujie_layer_documents'));
    expect(insert?.[0]).toContain('ON CONFLICT (user_id, task_id) DO NOTHING');
  });

  it('finds only the latest document for the exact user and source version', async () => {
    execSql.mockImplementation(async (sql: string) => (
      sql.includes('ORDER BY updated_at DESC')
        ? { rows: [row(3)], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    ));
    await expect(findLatestLayerDocument({
      userId: 'user-a', projectId: 'project-a', sourceImageId: 'image-a', sourceVersionId: 'version-a',
    })).resolves.toMatchObject({ id: 'doc-1', revision: 3 });
    const select = execSql.mock.calls.find(([sql]) => String(sql).includes('ORDER BY updated_at DESC'));
    expect(select?.[0]).toContain('user_id = $1');
    expect(select?.[0]).toContain('project_id = $2');
    expect(select?.[0]).toContain('source_image_id = $3');
    expect(select?.[0]).toContain('source_version_id = $4');
  });

  it('increments revision atomically for the owning user', async () => {
    execSql.mockImplementation(async (sql: string) => (
      sql.includes('UPDATE wujie_layer_documents')
        ? { rows: [row(5)], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    ));
    await expect(updateLayerDocument({
      documentId: 'doc-1', userId: 'user-a', expectedRevision: 4, content,
    })).resolves.toMatchObject({ revision: 5 });
    const update = execSql.mock.calls.find(([sql]) => String(sql).includes('UPDATE wujie_layer_documents'));
    expect(update?.[0]).toContain('revision = revision + 1');
    expect(update?.[0]).toContain('id = $1 AND user_id = $2 AND revision = $3');
  });

  it('returns a stable conflict when revision compare-and-swap loses', async () => {
    await ensureLayerDocumentTables();
    execSql.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(updateLayerDocument({
      documentId: 'doc-1', userId: 'user-a', expectedRevision: 4, content,
    })).rejects.toEqual(expect.objectContaining<Partial<LayerDocumentError>>({
      code: 'LAYER_DOCUMENT_REVISION_CONFLICT', status: 409, retryable: false,
    }));
  });

  it('deletes documents by both owner and project', async () => {
    await ensureLayerDocumentTables();
    execSql.mockResolvedValueOnce({ rows: [], rowCount: 2 });
    await expect(deleteLayerDocumentsForProject('user-a', 'project-a')).resolves.toBe(2);
    const deletion = execSql.mock.calls.at(-1);
    expect(deletion?.[0]).toContain('WHERE user_id = $1 AND project_id = $2');
    expect(deletion?.[1]).toEqual(['user-a', 'project-a']);
  });
});
