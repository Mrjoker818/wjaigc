import { execSql, type SqlResult } from '@/lib/db-client';
import {
  LAYER_DOCUMENT_SCHEMA_VERSION,
  type LayerDocumentContent,
  type LayerDocumentRecord,
} from './types';
import { LayerDocumentError, readLayerDocumentContent } from './validation';

interface CreateLayerDocumentInput {
  id: string;
  userId: string;
  projectId: string;
  sourceImageId: string;
  sourceVersionId: string;
  taskId: string;
  engine: 'pear' | 'local';
  content: LayerDocumentContent;
}

interface FindLatestLayerDocumentInput {
  userId: string;
  projectId: string;
  sourceImageId: string;
  sourceVersionId: string;
}

interface UpdateLayerDocumentInput {
  documentId: string;
  userId: string;
  expectedRevision: number;
  content: LayerDocumentContent;
}

let ensureTablesPromise: Promise<void> | null = null;

function requireRow(result: SqlResult, message: string): Record<string, unknown> {
  const row = result.rows[0];
  if (!row) {
    throw new LayerDocumentError('LAYER_DOCUMENT_STORAGE_FAILED', message, 503, true);
  }
  return row;
}

function readTimestamp(value: unknown): number {
  const timestamp = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(timestamp)) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_STORAGE_INVALID',
      '图层文档时间字段无效',
      503,
      true,
    );
  }
  return timestamp;
}

function rowToLayerDocument(row: Record<string, unknown>): LayerDocumentRecord {
  const engine = row.engine;
  if (engine !== 'pear' && engine !== 'local') {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_STORAGE_INVALID',
      '图层文档引擎字段无效',
      503,
      true,
    );
  }
  const revision = Number(row.revision);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_STORAGE_INVALID',
      '图层文档修订号无效',
      503,
      true,
    );
  }
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: String(row.project_id),
    sourceImageId: String(row.source_image_id),
    sourceVersionId: String(row.source_version_id),
    taskId: String(row.task_id),
    engine,
    schemaVersion: LAYER_DOCUMENT_SCHEMA_VERSION,
    revision,
    content: readLayerDocumentContent(row.content),
    createdAt: readTimestamp(row.created_at),
    updatedAt: readTimestamp(row.updated_at),
  };
}

export function ensureLayerDocumentTables(): Promise<void> {
  if (ensureTablesPromise) return ensureTablesPromise;
  ensureTablesPromise = (async () => {
    await execSql(`
      CREATE TABLE IF NOT EXISTS wujie_layer_documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        source_image_id TEXT NOT NULL,
        source_version_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        engine TEXT NOT NULL CHECK (engine IN ('pear', 'local')),
        schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        content JSONB NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE (user_id, task_id)
      )
    `);
    await execSql(`
      CREATE INDEX IF NOT EXISTS idx_wujie_layer_documents_source
      ON wujie_layer_documents (
        user_id, project_id, source_image_id, source_version_id, updated_at DESC
      )
    `);
    await execSql(`
      CREATE INDEX IF NOT EXISTS idx_wujie_layer_documents_project
      ON wujie_layer_documents (user_id, project_id)
    `);
  })().catch((error: unknown) => {
    ensureTablesPromise = null;
    throw error;
  });
  return ensureTablesPromise;
}

export async function createLayerDocument(
  input: CreateLayerDocumentInput,
): Promise<LayerDocumentRecord> {
  await ensureLayerDocumentTables();
  const content = readLayerDocumentContent(input.content);
  const now = Date.now();
  const inserted = await execSql(
    `INSERT INTO wujie_layer_documents (
       id, user_id, project_id, source_image_id, source_version_id,
       task_id, engine, schema_version, revision, content, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9::jsonb, $10, $10)
     ON CONFLICT (user_id, task_id) DO NOTHING
     RETURNING *`,
    [
      input.id,
      input.userId,
      input.projectId,
      input.sourceImageId,
      input.sourceVersionId,
      input.taskId,
      input.engine,
      LAYER_DOCUMENT_SCHEMA_VERSION,
      JSON.stringify(content),
      now,
    ],
  );
  if (inserted.rows[0]) return rowToLayerDocument(inserted.rows[0]);

  const existing = await execSql(
    `SELECT * FROM wujie_layer_documents
     WHERE user_id = $1 AND task_id = $2
     LIMIT 1`,
    [input.userId, input.taskId],
  );
  return rowToLayerDocument(requireRow(
    existing,
    '无法读取已存在的图层文档',
  ));
}

export async function findLatestLayerDocument(
  input: FindLatestLayerDocumentInput,
): Promise<LayerDocumentRecord | null> {
  await ensureLayerDocumentTables();
  const result = await execSql(
    `SELECT * FROM wujie_layer_documents
     WHERE user_id = $1
       AND project_id = $2
       AND source_image_id = $3
       AND source_version_id = $4
     ORDER BY updated_at DESC
     LIMIT 1`,
    [input.userId, input.projectId, input.sourceImageId, input.sourceVersionId],
  );
  return result.rows[0] ? rowToLayerDocument(result.rows[0]) : null;
}

export async function updateLayerDocument(
  input: UpdateLayerDocumentInput,
): Promise<LayerDocumentRecord> {
  await ensureLayerDocumentTables();
  const content = readLayerDocumentContent(input.content);
  const result = await execSql(
    `UPDATE wujie_layer_documents
     SET content = $4::jsonb,
         schema_version = 1,
         revision = revision + 1,
         updated_at = $5
     WHERE id = $1 AND user_id = $2 AND revision = $3
     RETURNING *`,
    [
      input.documentId,
      input.userId,
      input.expectedRevision,
      JSON.stringify(content),
      Date.now(),
    ],
  );
  if (!result.rows[0]) {
    throw new LayerDocumentError(
      'LAYER_DOCUMENT_REVISION_CONFLICT',
      '图层文档已在其他窗口更新，请重新加载后继续',
      409,
      false,
    );
  }
  return rowToLayerDocument(result.rows[0]);
}

export async function deleteLayerDocumentsForProject(
  userId: string,
  projectId: string,
): Promise<number> {
  await ensureLayerDocumentTables();
  const result = await execSql(
    `DELETE FROM wujie_layer_documents
     WHERE user_id = $1 AND project_id = $2`,
    [userId, projectId],
  );
  return result.rowCount;
}
