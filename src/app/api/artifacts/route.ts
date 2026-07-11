import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db-client';
import { requireApiAuthOrReject } from '@/lib/api-auth';

// GET /api/artifacts?projectId=xxx - list artifacts
// POST /api/artifacts - create/update artifact
// DELETE /api/artifacts?id=xxx - delete artifact

async function ensureTables(db: ReturnType<typeof getPool>) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS wujie_artifacts (
      id SERIAL PRIMARY KEY,
      project_id VARCHAR(64) NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      type VARCHAR(32) NOT NULL,
      title VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      version INT DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE wujie_artifacts ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT ''`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_wujie_artifacts_project ON wujie_artifacts(project_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_wujie_artifacts_user_project ON wujie_artifacts(user_id, project_id)`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS wujie_artifact_versions (
      id SERIAL PRIMARY KEY,
      artifact_id INT NOT NULL REFERENCES wujie_artifacts(id) ON DELETE CASCADE,
      version INT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_wujie_artifact_versions_artifact ON wujie_artifact_versions(artifact_id)`);
}

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireApiAuthOrReject(req);
    if (authResult instanceof NextResponse) return authResult;
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    const type = searchParams.get('type'); // optional filter

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const db = getPool();
    await ensureTables(db);

    let query = `SELECT id, project_id, type, title, content, version, created_at, updated_at
                 FROM wujie_artifacts WHERE project_id = $1 AND user_id = $2`;
    const params: (string | number)[] = [projectId, authResult.userId];

    if (type) {
      query += ` AND type = $3`;
      params.push(type);
    }

    query += ` ORDER BY updated_at DESC LIMIT 200`;

    const result = await db.query(query, params);
    const artifacts = result.rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      projectId: row.project_id,
      type: row.type,
      title: row.title,
      content: row.content,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return NextResponse.json({ artifacts });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Artifacts] GET error:', message);
    return NextResponse.json({ error: 'Failed to fetch artifacts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireApiAuthOrReject(req);
    if (authResult instanceof NextResponse) return authResult;
    const body = await req.json();
    const { id, projectId, type, title, content, version: inputVersion } = body;

    if (!projectId || !type || !title || content === undefined) {
      return NextResponse.json({ error: 'projectId, type, title, and content are required' }, { status: 400 });
    }

    const db = getPool();

    // Ensure tables exist
    await ensureTables(db);

    if (id) {
      // Update existing artifact
      const existing = await db.query(
        `SELECT id, version, content FROM wujie_artifacts WHERE id = $1 AND user_id = $2`,
        [id, authResult.userId]
      );

      if (existing.rows.length === 0) {
        return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
      }

      const oldVersion = existing.rows[0].version;
      const newVersion = inputVersion || (oldVersion + 1);

      // Save version history if content changed
      if (existing.rows[0].content !== content) {
        await db.query(
          `INSERT INTO wujie_artifact_versions (artifact_id, version, content) VALUES ($1, $2, $3)`,
          [id, oldVersion, existing.rows[0].content]
        );
      }

      await db.query(
        `UPDATE wujie_artifacts SET type = $1, title = $2, content = $3, version = $4, updated_at = NOW() WHERE id = $5 AND user_id = $6`,
        [type, title, content, newVersion, id, authResult.userId]
      );

      return NextResponse.json({ id, version: newVersion });
    } else {
      // Create new artifact
      const result = await db.query(
        `INSERT INTO wujie_artifacts (project_id, user_id, type, title, content, version) VALUES ($1, $2, $3, $4, $5, 1)
         RETURNING id`,
        [projectId, authResult.userId, type, title, content]
      );

      const newId = result.rows[0].id;
      return NextResponse.json({ id: newId, version: 1 }, { status: 201 });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Artifacts] POST error:', message);
    return NextResponse.json({ error: 'Failed to save artifact' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authResult = await requireApiAuthOrReject(req);
    if (authResult instanceof NextResponse) return authResult;
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const db = getPool();
    await ensureTables(db);
    const result = await db.query(
      `DELETE FROM wujie_artifacts WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, authResult.userId]
    );
    if ((result.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Artifacts] DELETE error:', message);
    return NextResponse.json({ error: 'Failed to delete artifact' }, { status: 500 });
  }
}
