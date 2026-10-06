import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NextRequest } from 'next/server';
import sharp from 'sharp';

import { afterEach, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

import { completeCloudTask, createBillableCloudTask, ensureCloudTaskTables, getCloudTaskForUser,
  updateCloudTask, type CreateBillableCloudTaskInput } from '@/lib/cloud-task-storage';
import { ensureCoreTables } from '@/lib/db-storage';
import { getPool } from '@/lib/db-client';
import { getServerDataRoot } from '@/lib/server-data-root';
import { createBillableTask, type CreateBillableTaskInput } from '@/lib/task-core/billing-service';
import { persistAssetBytes } from '@/lib/asset-core/binary-persistence';
import { drainPendingAssetCleanup, recordAssetCleanupFailure } from '@/lib/asset-core/cleanup-outbox';
import { grantDocumentEditor, revokeDocumentEditor } from '@/lib/collaboration/document-access';
import { deleteEditTask } from '@/lib/edit-task-store';
import { projectPersistedCompletedTask } from '@/lib/cloud-task-persistence';
import { projectWorkflowEditTaskResult, settleAcceptedWorkflowEditTask } from '@/lib/collaboration/workflow-edit-output';
import { acceptWorkflowEditResult } from '@/lib/collaboration/workflow-edit-acceptance';
import { completeWorkflowEditTask } from '@/lib/collaboration/workflow-edit-terminal';
import { createConnection, createWorkflowNode } from '@/lib/workflow-engine';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';

const routeBoundary = vi.hoisted(() => ({ callbacks: [] as Array<() => Promise<void>> }));
const sharedProbe = vi.hoisted(() => ({ available: true }));
vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(),
  after: (callback: () => Promise<void>): void => { routeBoundary.callbacks.push(callback); } }));
vi.mock('@/lib/api-auth', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api-auth')>(),
  getRequestUser: async (): Promise<unknown> => ({ user: {
    id: 'editor', name: 'Editor', role: 'user', status: 'active',
  }, source: 'cookie' }),
  requireApiAuthOrReject: async (): Promise<unknown> => ({
    userId: 'editor', userRole: 'user', source: 'session',
    user: { id: 'editor', name: 'Editor', role: 'user', status: 'active' },
  }),
  getInternalRequestHeaders: async (): Promise<Record<string, string>> => ({}),
}));
vi.mock('@/lib/server-api-config', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/server-api-config')>(),
  findProviderById: async (): Promise<unknown> => ({ id: 'provider-a', isEnabled: true, apiKey: 'test-only',
    baseUrl: 'https://provider.invalid', selectedModels: ['model-a'] }),
}));
vi.mock('@/lib/s3-storage', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/s3-storage')>(),
  probeWorkflowEditAcceptanceStorage: async (): Promise<boolean> => sharedProbe.available,
}));
import { POST as postEdit } from '@/app/api/edit/route';
import { POST as postPoll } from '@/app/api/poll-task/route';
import { POST as postCancel } from '@/app/api/cancel-task/route';
import { POST as postWorkflow } from '@/app/api/workflow/execute/route';

vi.mock('server-only', () => ({}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  routeBoundary.callbacks = []; sharedProbe.available = true; });

function installWorkflowAcceptanceS3(options?: { failMediaWrite?: boolean; failExportDelete?: () => boolean }): Map<string, { bytes: Buffer; contentType: string }> {
  vi.stubEnv('COZE_BUCKET_ENDPOINT_URL', 'http://127.0.0.1:1');
  vi.stubEnv('COZE_BUCKET_NAME', 'isolated-workflow-edit');
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: unknown): Promise<unknown> => {
    const input = (command as { input: { Key: string; Body?: Uint8Array; ContentType?: string;
      IfNoneMatch?: string; IfMatch?: string; Range?: string } }).input;
    if (command instanceof PutObjectCommand) {
      if (options?.failMediaWrite && input.Key.startsWith('private/workflow-edit/media/')) {
        throw new Error('simulated private media write failure');
      }
      if (input.IfNoneMatch !== '*') throw new Error('mutable workflow acceptance write');
      if (objects.has(input.Key)) throw Object.assign(new Error('exists'), { name: 'PreconditionFailed' });
      objects.set(input.Key, { bytes: Buffer.from(input.Body!), contentType: input.ContentType! });
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      if (input.Key.startsWith('exports/') && options?.failExportDelete?.()) {
        throw new Error('simulated export deletion failure');
      }
      objects.delete(input.Key);
      return {};
    }
    const stored = objects.get(input.Key);
    if (!stored) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
    if (command instanceof HeadObjectCommand) return {
      ContentLength: stored.bytes.length, ContentType: stored.contentType, ETag: '"accepted"', VersionId: 'v1',
    };
    if (!(command instanceof GetObjectCommand) || input.IfMatch !== '"accepted"'
      || input.Range !== `bytes=0-${stored.bytes.length - 1}`) throw new Error('non-exact acceptance read');
    return { ContentLength: stored.bytes.length, ContentType: stored.contentType,
      ETag: '"accepted"', VersionId: 'v1',
      ContentRange: `bytes 0-${stored.bytes.length - 1}/${stored.bytes.length}`,
      Body: Readable.from([stored.bytes]) };
  }) as never);
  return objects;
}

const configuredTestDatabase = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
if (configuredTestDatabase) {
  requireOfflineBridgeTestDatabaseUrl(process.env);
}
const postgresIt = configuredTestDatabase ? it : it.skip;

postgresIt('completed workflow edit publishes a managed owner version without replacing its source', async () => {
  await withIsolatedPostgres('workflow-edit-output', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
    await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
    await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
    await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-1','source','owner','shared','/api/serve-upload/canonical.png','image/png')`);
    await query("UPDATE wujie_assets SET current_version_id='version-1' WHERE id='source'");
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-1','owner','shared','source','version-1','workflow','workflow-a','workflow-input','input-a')`);
    await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES ('credits_editor','editor',100,100,0,1,1)");

    await createBillableTask({ userId: 'editor', idempotencyKey: 'workflow:run-a:edit-a:attempt:0',
      requestDigest: 'request-a', creditCost: 5,
      workflowPublication: { access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner',
        projectId: 'shared', grantGeneration: '1' }, workflowId: 'workflow-a', nodeId: 'edit-a',
        sourceEntityId: 'input-a', sourceVersionId: 'version-1', sourcePlacementId: 'placement-1',
        imageUrl: '/api/serve-upload/canonical.png', origin: 'https://app.example' },
      task: { id: 'edit-publish', projectId: 'shared', sessionId: 'workflow:shared', messageId: 'run-a:edit-a',
        type: 'edit', status: 'processing', providerId: 'provider-a', model: 'model-a', progress: 0,
        createdAt: 1, updatedAt: 1 },
    });
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 4,
      background: { r: 15, g: 40, b: 90, alpha: 1 } } }).png().toBuffer();
    const file = await persistAssetBytes({ bytes, filename: 'workflow-result.png', mimeType: 'image/png' });
    expect(await completeCloudTask('edit-publish', { image: { url: file.url } })).toBe(true);
    await query("UPDATE wujie_workspace_placements SET status='trashed',deleted_at=now() WHERE id='placement-1'");
    const pendingPoll = await postPoll(new NextRequest('https://app.example/api/poll-task', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: 'edit-publish', model: 'model-a', providerId: 'provider-a' }),
    }));
    const pendingBody = await pendingPoll.json() as Record<string, unknown>;
    expect(pendingPoll.status).toBe(202);
    expect(pendingBody).toMatchObject({ status: 'publication-pending', taskId: 'edit-publish' });
    expect(JSON.stringify(pendingBody)).not.toContain(file.url);
    await query("UPDATE wujie_workspace_placements SET status='active',deleted_at=NULL WHERE id='placement-1'");
    const pool = getPool();
    const originalConnect = pool.connect.bind(pool);
    const connectWithCallback = originalConnect as unknown as (callback: unknown) => void;
    let lostCommitReply = false;
    let instrumented = false;
    const connectSpy = vi.spyOn(pool, 'connect').mockImplementation(((callback?: unknown) => {
      if (typeof callback === 'function') return connectWithCallback(callback);
      return (async (): Promise<PoolClient> => {
        const client = await originalConnect() as PoolClient;
        if (instrumented) return client;
        instrumented = true;
        const queryClient = client as unknown as { query: (sql: string, ...args: unknown[]) => Promise<unknown> };
        const originalQuery = queryClient.query.bind(client);
        let armed = false;
        queryClient.query = async (sql, ...args) => {
          const result = await originalQuery(sql, ...args);
          if (sql.includes('INSERT INTO wujie_workflow_edit_outputs')) armed = true;
          if (sql === 'COMMIT' && armed && !lostCommitReply) {
            lostCommitReply = true;
            throw new Error('simulated lost workflow-output COMMIT acknowledgement');
          }
          return result;
        };
        return client;
      })();
    }) as typeof pool.connect);
    try {
      const references = await projectWorkflowEditTaskResult('editor', 'edit-publish');
      expect(lostCommitReply).toBe(true);
      expect(references).toHaveLength(1);
    } finally { connectSpy.mockRestore(); }
    await projectPersistedCompletedTask('edit-publish', 'editor');
    const completedPoll = await postPoll(new NextRequest('https://app.example/api/poll-task', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: 'edit-publish', model: 'model-a', providerId: 'provider-a' }),
    }));
    expect(completedPoll.status).toBe(200);
    const completedBody = await completedPoll.json() as { status: string; result?: { image?: { url?: string } } };
    expect(completedBody.status).toBe('completed');
    expect(completedBody.result?.image?.url).toMatch(/^\/api\/serve-upload\/exports\//);
    expect(JSON.stringify(completedBody)).not.toContain(file.url);

    const output = (await query(`SELECT p.workspace_kind,p.workspace_id,p.entity_type,p.entity_id,
      v.id AS version_id,v.owner_id,v.project_id,v.file_url,v.checksum,v.task_id
      FROM wujie_workspace_placements p JOIN wujie_asset_versions v ON v.id=p.asset_version_id
      WHERE p.entity_type='workflow-output' AND v.task_id='edit-publish'`)).rows;
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ workspace_kind: 'workflow', workspace_id: 'workflow-a',
      entity_type: 'workflow-output', entity_id: 'edit-a', owner_id: 'owner', project_id: 'shared',
      task_id: 'edit-publish' });
    expect(output[0].file_url).toMatch(/^\/api\/serve-upload\/exports\//);
    expect(output[0].checksum).toMatch(/^[a-f0-9]{64}$/);
    expect((await query("SELECT current_version_id FROM wujie_assets WHERE id='source'")).rows)
      .toEqual([{ current_version_id: 'version-1' }]);
  });
}, 60_000);

postgresIt('real workflow edit route freezes source intent with its charged child task', async () => {
  await withIsolatedPostgres('workflow-edit-route', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
    await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
    await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
    await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-1','source','owner','shared','/api/serve-upload/canonical.png','image/png')`);
    await query("UPDATE wujie_assets SET current_version_id='version-1' WHERE id='source'");
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-1','owner','shared','source','version-1','workflow','workflow-a','workflow-input','input-a')`);
    await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES ('credits_editor','editor',100,100,0,1,1)");

    sharedProbe.available = false;
    const unavailable = await postEdit(new NextRequest('https://app.example/api/edit', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'workflow:probe-unavailable' },
      body: JSON.stringify({ projectId: 'shared', assetWorkspace: 'workflow', workflowId: 'workflow-a',
        nodeId: 'edit-a', sourceEntityId: 'input-a', assetParentVersionIds: ['version-1'],
        assetSourcePlacementId: 'placement-1', image: '/api/serve-upload/canonical.png',
        prompt: 'Change the sky to blue', model: 'model-a', providerId: 'provider-a' }),
    }));
    expect(unavailable.status).toBe(503);
    expect((await query("SELECT count(*)::int AS count FROM cloud_tasks WHERE type='edit'")).rows[0].count).toBe(0);
    expect((await query("SELECT count(*)::int AS count FROM wujie_credit_transactions WHERE type='consume'")).rows[0].count).toBe(0);
    expect(routeBoundary.callbacks).toHaveLength(0);
    sharedProbe.available = true;

    const response = await postEdit(new NextRequest('https://app.example/api/edit', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'workflow:run-a:edit-a:attempt:0' },
      body: JSON.stringify({ projectId: 'shared', assetWorkspace: 'workflow', workflowId: 'workflow-a',
        nodeId: 'edit-a', sourceEntityId: 'input-a', assetParentVersionIds: ['version-1'],
        assetSourcePlacementId: 'placement-1', image: '/api/serve-upload/canonical.png',
        prompt: 'Change the sky to blue', model: 'model-a', providerId: 'provider-a' }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { taskId: string };
    expect((await query('SELECT id,user_id,project_id FROM cloud_tasks WHERE id=$1', [body.taskId])).rows)
      .toEqual([{ id: body.taskId, user_id: 'editor', project_id: 'shared' }]);
    expect((await query("SELECT user_id,type FROM wujie_credit_transactions WHERE task_id=$1", [body.taskId])).rows)
      .toEqual([{ user_id: 'editor', type: 'consume' }]);
    expect((await query('SELECT actor_id,owner_id,source_version_id,source_placement_id FROM wujie_workflow_edit_publications WHERE task_id=$1', [body.taskId])).rows)
      .toEqual([{ actor_id: 'editor', owner_id: 'owner', source_version_id: 'version-1', source_placement_id: 'placement-1' }]);
    expect(routeBoundary.callbacks).toHaveLength(1);
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 4,
      background: { r: 80, g: 30, b: 120, alpha: 1 } } }).png().toBuffer();
    const file = await persistAssetBytes({ bytes, filename: 'real-route-edit.png', mimeType: 'image/png' });
    expect(await completeCloudTask(body.taskId, { image: { url: file.url } })).toBe(true);
    await projectPersistedCompletedTask(body.taskId, 'editor');
    expect((await query(`SELECT v.owner_id,v.project_id,p.workspace_id,p.entity_id
      FROM wujie_workflow_edit_outputs o
      JOIN wujie_asset_versions v ON v.id=o.version_id
      JOIN wujie_workspace_placements p ON p.id=o.placement_id
      WHERE o.task_id=$1`, [body.taskId])).rows).toEqual([{
      owner_id: 'owner', project_id: 'shared', workspace_id: 'workflow-a', entity_id: 'edit-a',
    }]);
    await query('DELETE FROM wujie_workflow_edit_publications WHERE task_id=$1', [body.taskId]);
    const lostIntentPoll = await postPoll(new NextRequest('https://app.example/api/poll-task', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: body.taskId, model: 'model-a', providerId: 'provider-a' }),
    }));
    const lostIntentBody = await lostIntentPoll.json() as Record<string, unknown>;
    expect(lostIntentPoll.status).toBe(202);
    expect(lostIntentBody).toMatchObject({ status: 'publication-pending', taskId: body.taskId });
    expect(JSON.stringify(lostIntentBody)).not.toContain(file.url);
  });
}, 60_000);

postgresIt('legacy workflow edit resolves one authorized source before charging and publishes its result', async () => {
  await withIsolatedPostgres('workflow-edit-legacy-unique', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
    await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
    await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
    await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-1','source','owner','shared','/api/serve-upload/canonical.png','image/png')`);
    await query("UPDATE wujie_assets SET current_version_id='version-1' WHERE id='source'");
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-1','owner','shared','source','version-1','workflow','workflow-a','workflow-input','input-a')`);
    await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES ('credits_editor','editor',100,100,0,1,1)");

    const response = await postEdit(new NextRequest('https://app.example/api/edit', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'legacy-workflow-unique' },
      body: JSON.stringify({ projectId: 'shared', assetWorkspace: 'workflow', assetParentVersionIds: [],
        image: '/api/serve-upload/canonical.png', prompt: 'Change the sky to blue',
        model: 'model-a', providerId: 'provider-a' }),
    }));
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json() as { taskId: string };
    expect((await query('SELECT source_version_id,source_placement_id FROM wujie_workflow_edit_publications WHERE task_id=$1', [body.taskId])).rows)
      .toEqual([{ source_version_id: 'version-1', source_placement_id: 'placement-1' }]);
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 4,
      background: { r: 80, g: 30, b: 120, alpha: 1 } } }).png().toBuffer();
    const file = await persistAssetBytes({ bytes, filename: 'legacy-route-edit.png', mimeType: 'image/png' });
    expect(await completeCloudTask(body.taskId, { image: { url: file.url } })).toBe(true);
    const poll = await postPoll(new NextRequest('https://app.example/api/poll-task', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: body.taskId, model: 'model-a', providerId: 'provider-a' }),
    }));
    expect(poll.status).toBe(200);
    const pollBody = await poll.json() as Record<string, unknown>;
    expect(JSON.stringify(pollBody)).not.toContain(file.url);
    expect((await query(`SELECT v.owner_id,p.workspace_id,p.entity_type FROM wujie_workflow_edit_outputs o
      JOIN wujie_asset_versions v ON v.id=o.version_id
      JOIN wujie_workspace_placements p ON p.id=o.placement_id WHERE o.task_id=$1`, [body.taskId])).rows)
      .toEqual([{ owner_id: 'owner', workspace_id: 'workflow-a', entity_type: 'workflow-output' }]);
    expect((await query("SELECT user_id,type FROM wujie_credit_transactions WHERE task_id=$1", [body.taskId])).rows)
      .toEqual([{ user_id: 'editor', type: 'consume' }]);

    const oldRequest = (key: string, extra: Record<string, unknown> = {}): Promise<Response> => postEdit(
      new NextRequest('https://app.example/api/edit', { method: 'POST', headers: {
        'content-type': 'application/json', 'idempotency-key': key,
      }, body: JSON.stringify({ projectId: 'shared', assetWorkspace: 'workflow',
        image: '/api/serve-upload/canonical.png', prompt: 'Change the sky to blue',
        model: 'model-a', providerId: 'provider-a', ...extra }) }),
    );
    const wrongHint = await oldRequest('legacy-workflow-wrong-version', { assetParentVersionIds: ['other-version'] });
    expect(wrongHint.status).toBe(400);
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-2','owner','shared','source','version-1','workflow','workflow-b','workflow-input','input-b')`);
    const ambiguous = await oldRequest('legacy-workflow-ambiguous');
    expect(ambiguous.status).toBe(400);
    const missing = await oldRequest('legacy-workflow-missing', { image: '/api/serve-upload/unknown.png' });
    expect(missing.status).toBe(400);
    expect((await query("SELECT id FROM cloud_tasks WHERE type='edit' AND user_id='editor'")).rows)
      .toHaveLength(1);
    expect((await query("SELECT id FROM wujie_credit_transactions WHERE user_id='editor' AND type='consume'")).rows)
      .toHaveLength(1);
  });
}, 60_000);

postgresIt('settles direct and remote workflow edit results against current source permissions', async () => {
  await withIsolatedPostgres('workflow-edit-revoked-before-complete', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
    await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
    await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
    await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
    const sourceBytes = await sharp({ create: { width: 8, height: 8, channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
    const source = await persistAssetBytes({ bytes: sourceBytes, filename: 'revoke-source.png', mimeType: 'image/png' });
    const resultBytes = await sharp({ create: { width: 8, height: 8, channels: 4,
      background: { r: 30, g: 20, b: 10, alpha: 1 } } }).png().toBuffer();
    const result = await persistAssetBytes({ bytes: resultBytes, filename: 'revoke-result.png', mimeType: 'image/png' });
    installWorkflowAcceptanceS3();
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-1','source','owner','shared',$1,'image/png')`, [source.url]);
    await query("UPDATE wujie_assets SET current_version_id='version-1' WHERE id='source'");
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-1','owner','shared','source','version-1','workflow','workflow-a','workflow-input','input-a')`);
    await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES ('credits_editor','editor',100,100,0,1,1)");
    const submitted = await postEdit(new NextRequest('https://app.example/api/edit', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'workflow-revoke-before-complete' },
      body: JSON.stringify({ projectId: 'shared', assetWorkspace: 'workflow', workflowId: 'workflow-a',
        nodeId: 'edit-a', sourceEntityId: 'input-a', assetParentVersionIds: ['version-1'],
        assetSourcePlacementId: 'placement-1', image: source.url,
        prompt: 'Change the sky to blue', model: 'model-a', providerId: 'provider-a' }),
    }));
    expect(submitted.status, await submitted.clone().text()).toBe(200);
    const { taskId } = await submitted.json() as { taskId: string };
    expect(routeBoundary.callbacks).toHaveLength(1);
    let signalProvider!: () => void;
    let releaseProvider!: () => void;
    const providerReached = new Promise<void>(resolve => { signalProvider = resolve; });
    const providerReleased = new Promise<void>(resolve => { releaseProvider = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
      expect(target.hostname).toBe('provider.invalid');
      signalProvider();
      await providerReleased;
      return Response.json({ data: [{ url: result.url }] });
    }));
    const running = routeBoundary.callbacks.shift()!();
    await providerReached;
    try {
      await revokeDocumentEditor('owner', 'shared', 'editor');
    } finally { releaseProvider(); await running; }
    const task = await getCloudTaskForUser(taskId, 'editor');
    expect(task?.status).toBe('failed');
    expect(task?.creditStatus).toBe('refunded');
    expect((await query("SELECT type FROM wujie_credit_transactions WHERE task_id=$1 ORDER BY type", [taskId])).rows)
      .toEqual([{ type: 'consume' }, { type: 'refund' }]);
    expect((await query('SELECT task_id FROM wujie_workflow_edit_outputs WHERE task_id=$1', [taskId])).rows).toEqual([]);

    await grantDocumentEditor('owner', 'shared', 'editor');
    const asyncSubmitted = await postEdit(new NextRequest('https://app.example/api/edit', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'workflow-revoke-before-remote-poll' },
      body: JSON.stringify({ projectId: 'shared', assetWorkspace: 'workflow', workflowId: 'workflow-a',
        nodeId: 'edit-a', sourceEntityId: 'input-a', assetParentVersionIds: ['version-1'],
        assetSourcePlacementId: 'placement-1', image: source.url,
        prompt: 'Change the sky to blue', model: 'model-a', providerId: 'provider-a' }),
    }));
    expect(asyncSubmitted.status).toBe(200);
    const asyncTaskId = (await asyncSubmitted.json() as { taskId: string }).taskId;
    routeBoundary.callbacks = [];
    expect(await updateCloudTask(asyncTaskId, { remoteTaskId: 'remote-edit-2',
      result: { remotePollInfo: { taskId: 'remote-edit-2', providerId: 'provider-a',
        model: 'model-a', apiBaseUrl: 'https://provider.invalid' } }, mergeResult: true })).toBe(true);
    deleteEditTask(asyncTaskId);
    await revokeDocumentEditor('owner', 'shared', 'editor');
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => Response.json({
      data: { status: 'succeeded', images: [{ url: result.url }] },
    })));
    const remotePoll = await postPoll(new NextRequest('https://app.example/api/poll-task', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: asyncTaskId, model: 'model-a', providerId: 'provider-a' }),
    }));
    const remoteBody = await remotePoll.json() as Record<string, unknown>;
    expect(JSON.stringify(remoteBody)).not.toContain(result.url);
    const asyncTask = await getCloudTaskForUser(asyncTaskId, 'editor');
    expect(asyncTask?.status).toBe('failed');
    expect(asyncTask?.creditStatus).toBe('refunded');
    expect((await query("SELECT type FROM wujie_credit_transactions WHERE task_id=$1 ORDER BY type", [asyncTaskId])).rows)
      .toEqual([{ type: 'consume' }, { type: 'refund' }]);
    expect((await query('SELECT task_id FROM wujie_workflow_edit_outputs WHERE task_id=$1', [asyncTaskId])).rows).toEqual([]);
    const repeatPoll = await postPoll(new NextRequest('https://app.example/api/poll-task', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: asyncTaskId, model: 'model-a', providerId: 'provider-a' }),
    }));
    expect(JSON.stringify(await repeatPoll.json())).not.toContain(result.url);
    expect((await query("SELECT type FROM wujie_credit_transactions WHERE task_id=$1 ORDER BY type", [asyncTaskId])).rows)
      .toEqual([{ type: 'consume' }, { type: 'refund' }]);

    await grantDocumentEditor('owner', 'shared', 'editor');
    const allowed = await postEdit(new NextRequest('https://app.example/api/edit', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'workflow-allowed-direct-complete' },
      body: JSON.stringify({ projectId: 'shared', assetWorkspace: 'workflow', workflowId: 'workflow-a',
        nodeId: 'edit-a', sourceEntityId: 'input-a', assetParentVersionIds: ['version-1'],
        assetSourcePlacementId: 'placement-1', image: source.url,
        prompt: 'Change the sky to blue', model: 'model-a', providerId: 'provider-a' }),
    }));
    expect(allowed.status).toBe(200);
    const allowedTaskId = (await allowed.json() as { taskId: string }).taskId;
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => Response.json({ data: [{ url: result.url }] })));
    await routeBoundary.callbacks.shift()!();
    const allowedTask = await getCloudTaskForUser(allowedTaskId, 'editor');
    expect(allowedTask?.status).toBe('completed');
    expect((await query(`SELECT v.owner_id FROM wujie_workflow_edit_outputs o
      JOIN wujie_asset_versions v ON v.id=o.version_id WHERE o.task_id=$1`, [allowedTaskId])).rows)
      .toEqual([{ owner_id: 'owner' }]);
  });
}, 60_000);

postgresIt('recovers an accepted direct workflow edit after terminal DB outage and worker loss', async () => {
  await withIsolatedPostgres('workflow-edit-direct-result-outage', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
    await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
    await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
    await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
    const sourceBytes = await sharp({ create: { width: 8, height: 8, channels: 4,
      background: { r: 9, g: 18, b: 27, alpha: 1 } } }).png().toBuffer();
    const outputBytes = await sharp({ create: { width: 8, height: 8, channels: 4,
      background: { r: 27, g: 18, b: 9, alpha: 1 } } }).png().toBuffer();
    const secondOutputBytes = await sharp({ create: { width: 8, height: 8, channels: 4,
      background: { r: 3, g: 90, b: 40, alpha: 1 } } }).png().toBuffer();
    const source = await persistAssetBytes({ bytes: sourceBytes, filename: 'direct-outage-source.png', mimeType: 'image/png' });
    const output = await persistAssetBytes({ bytes: outputBytes, filename: 'direct-outage-output.png', mimeType: 'image/png' });
    const secondOutput = await persistAssetBytes({ bytes: secondOutputBytes,
      filename: 'direct-outage-output-two.png', mimeType: 'image/png' });
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-1','source','owner','shared',$1,'image/png')`, [source.url]);
    await query("UPDATE wujie_assets SET current_version_id='version-1' WHERE id='source'");
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-1','owner','shared','source','version-1','workflow','workflow-a','workflow-input','input-a')`);
    await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES ('credits_editor','editor',100,100,0,1,1)");
    const requestDigest = 'a'.repeat(64);
    await createBillableTask({ userId: 'editor', idempotencyKey: 'workflow:outage:edit-a:attempt:0',
      requestDigest, creditCost: 5,
      workflowPublication: { access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner',
        projectId: 'shared', grantGeneration: '1' }, workflowId: 'workflow-a', nodeId: 'edit-a',
        sourceEntityId: 'input-a', sourceVersionId: 'version-1', sourcePlacementId: 'placement-1',
        imageUrl: source.url, origin: 'https://app.example' },
      task: { id: 'edit-direct-outage', projectId: 'shared', sessionId: 'workflow:shared',
        messageId: 'outage:edit-a', type: 'edit', status: 'processing', providerId: 'provider-a',
        model: 'model-a', progress: 0, createdAt: 1, updatedAt: 1 },
    });
    const acceptedObjects = installWorkflowAcceptanceS3();
    const pool = getPool();
    const connectSpy = vi.spyOn(pool, 'connect').mockRejectedValueOnce(new Error('simulated terminal DB outage'));
    try {
      expect(await completeWorkflowEditTask({ actorId: 'editor', taskId: 'edit-direct-outage',
        requestDigest, providerId: 'provider-a', modelId: 'model-a',
        result: { success: true, image: { url: output.url },
          images: [{ url: output.url }, { url: secondOutput.url }] } })).toBe('pending');
      expect(acceptedObjects.has('private/workflow-edit/accepted/edit-direct-outage.json')).toBe(true);
    } finally { connectSpy.mockRestore(); }
    deleteEditTask('edit-direct-outage');
    const providerFetch = vi.fn(async (): Promise<Response> => { throw new Error('unexpected provider replay'); });
    vi.stubGlobal('fetch', providerFetch);
    const recovered = await postPoll(new NextRequest('https://app.example/api/poll-task', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: 'edit-direct-outage', model: 'model-a', providerId: 'provider-a' }),
    }));
    const body = await recovered.json() as Record<string, unknown>;
    expect(providerFetch).not.toHaveBeenCalled();
    expect(recovered.status).toBe(200);
    expect(body.status).toBe('completed');
    expect(JSON.stringify(body)).not.toContain(output.url);
    expect(JSON.stringify(body)).not.toContain(secondOutput.url);
    expect((body.result as { images: unknown[] }).images).toHaveLength(2);
    const task = await getCloudTaskForUser('edit-direct-outage', 'editor');
    expect(task?.creditStatus).toBe('charged');
    expect(JSON.stringify(task?.result)).not.toContain(output.url);
    expect(JSON.stringify(task?.result)).not.toContain(secondOutput.url);
    expect((await query("SELECT type FROM wujie_credit_transactions WHERE task_id='edit-direct-outage' ORDER BY type")).rows)
      .toEqual([{ type: 'consume' }]);
    expect((await query("SELECT count(*)::int AS count FROM wujie_workflow_edit_outputs WHERE task_id='edit-direct-outage'")).rows)
      .toEqual([{ count: 2 }]);
  });
}, 60_000);

postgresIt('reads back one managed output when final workflow edit COMMIT succeeds but its acknowledgement is lost', async () => {
  await withIsolatedPostgres('workflow-edit-output-commit-unknown', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
    await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
    await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
    await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-1','source','owner','shared','/api/serve-upload/canonical.png','image/png')`);
    await query("UPDATE wujie_assets SET current_version_id='version-1' WHERE id='source'");
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-1','owner','shared','source','version-1','workflow','workflow-a','workflow-input','input-a')`);
    await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES ('credits_editor','editor',100,100,0,1,1)");
    const requestDigest = 'd'.repeat(64);
    await createBillableTask({ userId: 'editor', idempotencyKey: 'workflow:commit-unknown:edit-a:attempt:0',
      requestDigest, creditCost: 5,
      workflowPublication: { access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner',
        projectId: 'shared', grantGeneration: '1' }, workflowId: 'workflow-a', nodeId: 'edit-a',
        sourceEntityId: 'input-a', sourceVersionId: 'version-1', sourcePlacementId: 'placement-1',
        imageUrl: '/api/serve-upload/canonical.png', origin: 'https://app.example' },
      task: { id: 'edit-commit-unknown', projectId: 'shared', sessionId: 'workflow:shared',
        messageId: 'commit-unknown:edit-a', type: 'edit', status: 'processing', providerId: 'provider-a',
        model: 'model-a', progress: 0, createdAt: 1, updatedAt: 1 },
    });
    const objects = installWorkflowAcceptanceS3();
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 4,
      background: { r: 30, g: 60, b: 90, alpha: 1 } } }).png().toBuffer();
    const raw = `data:image/png;base64,${bytes.toString('base64')}`;
    const pool = getPool();
    const originalConnect = pool.connect.bind(pool);
    const connectWithCallback = originalConnect as unknown as (callback: unknown) => void;
    let lostAck = false;
    const connectSpy = vi.spyOn(pool, 'connect').mockImplementation(((callback?: unknown) => {
      if (typeof callback === 'function') return connectWithCallback(callback);
      return (async (): Promise<PoolClient> => {
        const client = await originalConnect() as PoolClient;
        const queryClient = client as unknown as { query: (sql: string, ...args: unknown[]) => Promise<unknown> };
        const originalQuery = queryClient.query.bind(client);
        let outputInserted = false;
        queryClient.query = async (sql, ...args) => {
          const result = await originalQuery(sql, ...args);
          if (sql.includes('INSERT INTO wujie_workflow_edit_outputs')) outputInserted = true;
          if (sql === 'COMMIT' && outputInserted && !lostAck) {
            lostAck = true;
            throw new Error('simulated lost final workflow edit COMMIT acknowledgement');
          }
          return result;
        };
        return client;
      })();
    }) as typeof pool.connect);
    try {
      expect(await completeWorkflowEditTask({ actorId: 'editor', taskId: 'edit-commit-unknown',
        requestDigest, providerId: 'provider-a', modelId: 'model-a',
        result: { image: { url: raw } } })).toBe('completed');
      expect(lostAck).toBe(true);
    } finally { connectSpy.mockRestore(); }
    const task = await getCloudTaskForUser('edit-commit-unknown', 'editor');
    expect(task?.status).toBe('completed');
    expect(task?.creditStatus).toBe('charged');
    expect(JSON.stringify(task?.result)).not.toContain(raw);
    expect((await query("SELECT count(*)::int AS count FROM wujie_workflow_edit_outputs WHERE task_id='edit-commit-unknown'")).rows)
      .toEqual([{ count: 1 }]);
    const persisted = (await query("SELECT storage_key FROM wujie_asset_versions WHERE task_id='edit-commit-unknown'")).rows;
    expect(persisted).toHaveLength(1);
    const storageKey = String(persisted[0].storage_key);
    expect(storageKey).toMatch(/^exports\/[A-Za-z0-9._-]+$/u);
    expect(objects.has(storageKey)).toBe(true);
    expect(existsSync(resolve(getServerDataRoot(), storageKey))).toBe(true);
    expect((await query("SELECT type FROM wujie_credit_transactions WHERE task_id='edit-commit-unknown' ORDER BY type")).rows)
      .toEqual([{ type: 'consume' }]);
  });
}, 60_000);

postgresIt('reads back one refund when revoked workflow edit COMMIT succeeds but its acknowledgement is lost', async () => {
  await withIsolatedPostgres('workflow-edit-refund-commit-unknown', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
    await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
    await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
    await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-1','source','owner','shared','/api/serve-upload/canonical.png','image/png')`);
    await query("UPDATE wujie_assets SET current_version_id='version-1' WHERE id='source'");
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-1','owner','shared','source','version-1','workflow','workflow-a','workflow-input','input-a')`);
    await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES ('credits_editor','editor',100,100,0,1,1)");
    const requestDigest = 'e'.repeat(64);
    await createBillableTask({ userId: 'editor', idempotencyKey: 'workflow:refund-unknown:edit-a:attempt:0',
      requestDigest, creditCost: 5,
      workflowPublication: { access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner',
        projectId: 'shared', grantGeneration: '1' }, workflowId: 'workflow-a', nodeId: 'edit-a',
        sourceEntityId: 'input-a', sourceVersionId: 'version-1', sourcePlacementId: 'placement-1',
        imageUrl: '/api/serve-upload/canonical.png', origin: 'https://app.example' },
      task: { id: 'edit-refund-unknown', projectId: 'shared', sessionId: 'workflow:shared',
        messageId: 'refund-unknown:edit-a', type: 'edit', status: 'processing', providerId: 'provider-a',
        model: 'model-a', progress: 0, createdAt: 1, updatedAt: 1 },
    });
    installWorkflowAcceptanceS3();
    await revokeDocumentEditor('owner', 'shared', 'editor');
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 4,
      background: { r: 35, g: 65, b: 95, alpha: 1 } } }).png().toBuffer();
    const raw = `data:image/png;base64,${bytes.toString('base64')}`;
    const pool = getPool();
    const originalConnect = pool.connect.bind(pool);
    const connectWithCallback = originalConnect as unknown as (callback: unknown) => void;
    let lostAck = false;
    const connectSpy = vi.spyOn(pool, 'connect').mockImplementation(((callback?: unknown) => {
      if (typeof callback === 'function') return connectWithCallback(callback);
      return (async (): Promise<PoolClient> => {
        const client = await originalConnect() as PoolClient;
        const queryClient = client as unknown as { query: (sql: string, ...args: unknown[]) => Promise<unknown> };
        const originalQuery = queryClient.query.bind(client);
        let refundSettled = false;
        queryClient.query = async (sql, ...args) => {
          const result = await originalQuery(sql, ...args);
          if (sql.includes('settled_task AS (')) refundSettled = true;
          if (sql === 'COMMIT' && refundSettled && !lostAck) {
            lostAck = true;
            throw new Error('simulated lost refunded workflow edit COMMIT acknowledgement');
          }
          return result;
        };
        return client;
      })();
    }) as typeof pool.connect);
    try {
      expect(await completeWorkflowEditTask({ actorId: 'editor', taskId: 'edit-refund-unknown',
        requestDigest, providerId: 'provider-a', modelId: 'model-a',
        result: { image: { url: raw } } })).toBe('denied');
      expect(lostAck).toBe(true);
    } finally { connectSpy.mockRestore(); }
    const task = await getCloudTaskForUser('edit-refund-unknown', 'editor');
    expect(task?.status).toBe('failed');
    expect(task?.creditStatus).toBe('refunded');
    expect((await query("SELECT type FROM wujie_credit_transactions WHERE task_id='edit-refund-unknown' ORDER BY type")).rows)
      .toEqual([{ type: 'consume' }, { type: 'refund' }]);
    expect((await query("SELECT task_id FROM wujie_workflow_edit_outputs WHERE task_id='edit-refund-unknown'")).rows)
      .toEqual([]);
  });
}, 60_000);

postgresIt('serializes accepted workflow edit completion and cancellation in either order', async () => {
  await withIsolatedPostgres('workflow-edit-accepted-cancel-race', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
    await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
    await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
    await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-1','source','owner','shared','/api/serve-upload/canonical.png','image/png')`);
    await query("UPDATE wujie_assets SET current_version_id='version-1' WHERE id='source'");
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-1','owner','shared','source','version-1','workflow','workflow-a','workflow-input','input-a')`);
    await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES ('credits_editor','editor',100,100,0,1,1)");
    const taskId = 'edit-cancel-accepted';
    const requestDigest = 'd'.repeat(64);
    await createBillableTask({ userId: 'editor', idempotencyKey: 'workflow:cancel-accepted:edit-a:attempt:0',
      requestDigest, creditCost: 5,
      workflowPublication: { access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner',
        projectId: 'shared', grantGeneration: '1' }, workflowId: 'workflow-a', nodeId: 'edit-a',
        sourceEntityId: 'input-a', sourceVersionId: 'version-1', sourcePlacementId: 'placement-1',
        imageUrl: '/api/serve-upload/canonical.png', origin: 'https://app.example' },
      task: { id: taskId, projectId: 'shared', sessionId: 'workflow:shared',
        messageId: 'cancel-accepted:edit-a', type: 'edit', status: 'processing', providerId: 'provider-a',
        model: 'model-a', progress: 0, createdAt: 1, updatedAt: 1 },
    });
    const deleteFault = { fail: false };
    const objects = installWorkflowAcceptanceS3({ failExportDelete: () => deleteFault.fail });
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 4,
      background: { r: 30, g: 60, b: 90, alpha: 1 } } }).png().toBuffer();
    const raw = `data:image/png;base64,${bytes.toString('base64')}`;
    await acceptWorkflowEditResult({ actorId: 'editor', taskId, requestDigest,
      providerId: 'provider-a', modelId: 'model-a', result: { image: { url: raw } } });

    const cancel = (): Promise<Response> => postCancel(new NextRequest('https://app.example/api/cancel-task', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId }),
    }));
    expect((await cancel()).status).toBe(200);
    expect(await settleAcceptedWorkflowEditTask('editor', taskId)).toBe('terminal');
    expect(await completeWorkflowEditTask({ actorId: 'editor', taskId, requestDigest,
      providerId: 'provider-a', modelId: 'model-a', result: { image: { url: raw } } })).toBe('terminal');
    expect((await cancel()).status).toBe(200);
    const poll = await postPoll(new NextRequest('https://app.example/api/poll-task', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId, model: 'model-a', providerId: 'provider-a' }),
    }));
    const body = await poll.json() as Record<string, unknown>;
    expect(body).toMatchObject({ success: false, status: 'cancelled' });
    expect(JSON.stringify(body)).not.toContain(raw);
    const task = await getCloudTaskForUser(taskId, 'editor');
    expect(task?.status).toBe('cancelled');
    expect(task?.creditStatus).toBe('refunded');
    expect((await query('SELECT type FROM wujie_credit_transactions WHERE task_id=$1 ORDER BY type', [taskId])).rows)
      .toEqual([{ type: 'consume' }, { type: 'refund' }]);
    expect((await query('SELECT task_id FROM wujie_workflow_edit_outputs WHERE task_id=$1', [taskId])).rows)
      .toEqual([]);

    const winnerTaskId = 'edit-completion-wins';
    const winnerDigest = 'f'.repeat(64);
    await createBillableTask({ userId: 'editor', idempotencyKey: 'workflow:completion-wins:edit-a:attempt:0',
      requestDigest: winnerDigest, creditCost: 5,
      workflowPublication: { access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner',
        projectId: 'shared', grantGeneration: '1' }, workflowId: 'workflow-a', nodeId: 'edit-a',
        sourceEntityId: 'input-a', sourceVersionId: 'version-1', sourcePlacementId: 'placement-1',
        imageUrl: '/api/serve-upload/canonical.png', origin: 'https://app.example' },
      task: { id: winnerTaskId, projectId: 'shared', sessionId: 'workflow:shared',
        messageId: 'completion-wins:edit-a', type: 'edit', status: 'processing', providerId: 'provider-a',
        model: 'model-a', progress: 0, createdAt: 2, updatedAt: 2 },
    });
    await acceptWorkflowEditResult({ actorId: 'editor', taskId: winnerTaskId,
      requestDigest: winnerDigest, providerId: 'provider-a', modelId: 'model-a',
      result: { image: { url: raw } } });
    const pool = getPool();
    const originalConnect = pool.connect.bind(pool);
    const connectWithCallback = originalConnect as unknown as (callback: unknown) => void;
    const originalPoolQuery = pool.query.bind(pool) as (sql: string, values?: unknown[]) => Promise<unknown>;
    let resumeOutput!: () => void;
    let signalOutput!: () => void;
    let signalCancel!: () => void;
    const outputGate = new Promise<void>(resolve => { resumeOutput = resolve; });
    const outputReached = new Promise<void>(resolve => { signalOutput = resolve; });
    const cancelEntered = new Promise<void>(resolve => { signalCancel = resolve; });
    let pausedOutput = false;
    const connectSpy = vi.spyOn(pool, 'connect').mockImplementation(((callback?: unknown) => {
      if (typeof callback === 'function') return connectWithCallback(callback);
      return (async (): Promise<PoolClient> => {
        const client = await originalConnect() as PoolClient;
        const queryClient = client as unknown as { query: (sql: string, ...args: unknown[]) => Promise<unknown> };
        const originalQuery = queryClient.query.bind(client);
        queryClient.query = async (sql, ...args) => {
          const result = await originalQuery(sql, ...args);
          if (sql.includes('INSERT INTO wujie_workflow_edit_outputs') && !pausedOutput) {
            pausedOutput = true;
            signalOutput();
            await outputGate;
          }
          return result;
        };
        return client;
      })();
    }) as typeof pool.connect);
    const querySpy = vi.spyOn(pool, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
      if (values?.[0] === winnerTaskId
        && sql.includes('WITH candidate AS (') && sql.includes('settled_task AS (')) signalCancel();
      return originalPoolQuery(sql, values);
    }) as typeof pool.query);
    try {
      const settling = settleAcceptedWorkflowEditTask('editor', winnerTaskId);
      const reached = await Promise.race([
        outputReached.then(() => 'output'),
        settling.then(result => `settled:${result}`),
        new Promise<string>(resolve => setTimeout(() => resolve('timeout-before-output'), 5000)),
      ]);
      expect(reached).toBe('output');
      let cancelResolved = false;
      const cancelling = postCancel(new NextRequest('https://app.example/api/cancel-task', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: winnerTaskId }),
      })).then(response => { cancelResolved = true; return response; });
      const entered = await Promise.race([
        cancelEntered.then(() => 'entered'),
        cancelling.then(response => `resolved:${response.status}`),
        new Promise<string>(resolve => setTimeout(() => resolve('timeout-before-cancel'), 5000)),
      ]);
      expect(entered).toBe('entered');
      expect(cancelResolved).toBe(false);
      resumeOutput();
      expect(await settling).toBe('completed');
      expect((await cancelling).status).toBe(409);
    } finally { resumeOutput(); querySpy.mockRestore(); connectSpy.mockRestore(); }
    const winner = await getCloudTaskForUser(winnerTaskId, 'editor');
    expect(winner?.status).toBe('completed');
    expect(winner?.creditStatus).toBe('charged');
    expect((await query('SELECT type FROM wujie_credit_transactions WHERE task_id=$1', [winnerTaskId])).rows)
      .toEqual([{ type: 'consume' }]);
    expect((await query('SELECT task_id FROM wujie_workflow_edit_outputs WHERE task_id=$1', [winnerTaskId])).rows)
      .toEqual([{ task_id: winnerTaskId }]);

    const preparedScenarios = [
      { taskId: 'edit-cancel-after-prepare', digest: 'e', outcome: 'terminal', failDelete: false },
      { taskId: 'edit-cancel-delete-failed', digest: 'f', outcome: 'terminal', failDelete: true },
      { taskId: 'edit-revoke-after-prepare', digest: 'c', outcome: 'denied', failDelete: false },
    ] as const;
    for (const scenario of preparedScenarios) {
      const preparedTaskId = scenario.taskId;
      const preparedDigest = scenario.digest.repeat(64);
      await createBillableTask({ userId: 'editor', idempotencyKey: `workflow:${preparedTaskId}:edit-a:attempt:0`,
        requestDigest: preparedDigest, creditCost: 5,
        workflowPublication: { access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner',
          projectId: 'shared', grantGeneration: '1' }, workflowId: 'workflow-a', nodeId: 'edit-a',
          sourceEntityId: 'input-a', sourceVersionId: 'version-1', sourcePlacementId: 'placement-1',
          imageUrl: '/api/serve-upload/canonical.png', origin: 'https://app.example' },
        task: { id: preparedTaskId, projectId: 'shared', sessionId: 'workflow:shared',
          messageId: `${preparedTaskId}:edit-a`, type: 'edit', status: 'processing', providerId: 'provider-a',
          model: 'model-a', progress: 0, createdAt: 3, updatedAt: 3 },
      });
      await acceptWorkflowEditResult({ actorId: 'editor', taskId: preparedTaskId,
        requestDigest: preparedDigest, providerId: 'provider-a', modelId: 'model-a',
        result: { image: { url: raw } } });
      const priorExports = new Set([...objects.keys()].filter(key => key.startsWith('exports/')));
      let releaseWriter!: () => void;
      let signalPrepared!: () => void;
      const writerGate = new Promise<void>(resolve => { releaseWriter = resolve; });
      const prepared = new Promise<void>(resolve => { signalPrepared = resolve; });
      let directConnections = 0;
      let stagedKey: string | undefined;
      let noOutputConfirmed = false;
      let preparedSettlement: ReturnType<typeof settleAcceptedWorkflowEditTask> | undefined;
      const prepareSpy = vi.spyOn(pool, 'connect').mockImplementation(((callback?: unknown) => {
        if (typeof callback === 'function') return connectWithCallback(callback);
        directConnections += 1;
        if (directConnections === 2) return (async (): Promise<PoolClient> => {
          signalPrepared();
          await writerGate;
          return originalConnect() as Promise<PoolClient>;
        })();
        return originalConnect();
      }) as typeof pool.connect);
      try {
        preparedSettlement = settleAcceptedWorkflowEditTask('editor', preparedTaskId);
        const reached = await Promise.race([
          prepared.then(() => 'prepared'),
          preparedSettlement.then(result => `settled:${result}`),
          new Promise<string>(resolve => setTimeout(() => resolve('timeout-before-prepared'), 5000)),
        ]);
        expect(reached).toBe('prepared');
        const staged = [...objects.keys()].filter(key => key.startsWith('exports/') && !priorExports.has(key));
        expect(staged).toHaveLength(1);
        stagedKey = staged[0];
        expect(existsSync(resolve(getServerDataRoot(), stagedKey))).toBe(true);
        if (scenario.outcome === 'denied') {
          await revokeDocumentEditor('owner', 'shared', 'editor');
        } else {
          const cancellation = await postCancel(new NextRequest('https://app.example/api/cancel-task', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ taskId: preparedTaskId }),
          }));
          expect(cancellation.status).toBe(200);
        }
        deleteFault.fail = scenario.failDelete;
        releaseWriter();
        expect(await preparedSettlement).toBe(scenario.outcome);
        const terminalTask = await getCloudTaskForUser(preparedTaskId, 'editor');
        expect(terminalTask?.status).toBe(scenario.outcome === 'denied' ? 'failed' : 'cancelled');
        expect(terminalTask?.creditStatus).toBe('refunded');
        expect((await query('SELECT type FROM wujie_credit_transactions WHERE task_id=$1 ORDER BY type', [preparedTaskId])).rows)
          .toEqual([{ type: 'consume' }, { type: 'refund' }]);
        expect((await query('SELECT task_id FROM wujie_workflow_edit_outputs WHERE task_id=$1', [preparedTaskId])).rows)
          .toEqual([]);
        noOutputConfirmed = true;
        expect(existsSync(resolve(getServerDataRoot(), stagedKey))).toBe(false);
        if (scenario.failDelete) {
          expect(objects.has(stagedKey)).toBe(true);
          expect((await query('SELECT status FROM wujie_asset_cleanup_outbox WHERE storage_key=$1', [stagedKey])).rows)
            .toEqual([{ status: 'pending' }]);
          deleteFault.fail = false;
          expect(await drainPendingAssetCleanup({ now: new Date(Date.now() + 60_000) }))
            .toEqual({ completed: 1, failed: 0 });
          expect((await query('SELECT status FROM wujie_asset_cleanup_outbox WHERE storage_key=$1', [stagedKey])).rows)
            .toEqual([{ status: 'completed' }]);
        }
        expect(objects.has(stagedKey)).toBe(false);
      } finally {
        deleteFault.fail = false;
        releaseWriter();
        prepareSpy.mockRestore();
        await preparedSettlement?.catch(() => undefined);
        if (noOutputConfirmed && stagedKey) await rm(resolve(getServerDataRoot(), stagedKey), { force: true });
      }
    }
    const referenced = (await query('SELECT storage_key FROM wujie_asset_versions WHERE task_id=$1', [winnerTaskId])).rows;
    expect(referenced).toHaveLength(1);
    const referencedKey = String(referenced[0].storage_key);
    expect(objects.has(referencedKey)).toBe(true);
    await recordAssetCleanupFailure({ rootId: 'server-data', storageKey: referencedKey,
      lastError: 'simulated delayed cleanup after committed publication' });
    expect(await drainPendingAssetCleanup()).toEqual({ completed: 1, failed: 0 });
    expect(objects.has(referencedKey)).toBe(true);
  });
}, 60_000);

postgresIt.each(['refund-before-commit', 'checkpoint-ack-lost'] as const)(
  'recovers an invalid workflow edit refund after %s', async (fault) => {
  await withIsolatedPostgres(`workflow-edit-invalid-result-${fault}`, async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
    await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
    await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
    await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-1','source','owner','shared','/api/serve-upload/canonical.png','image/png')`);
    await query("UPDATE wujie_assets SET current_version_id='version-1' WHERE id='source'");
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-1','owner','shared','source','version-1','workflow','workflow-a','workflow-input','input-a')`);
    await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES ('credits_editor','editor',100,100,0,1,1)");
    const requestDigest = 'b'.repeat(64);
    await createBillableTask({ userId: 'editor', idempotencyKey: 'workflow:invalid:edit-a:attempt:0',
      requestDigest, creditCost: 5,
      workflowPublication: { access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner',
        projectId: 'shared', grantGeneration: '1' }, workflowId: 'workflow-a', nodeId: 'edit-a',
        sourceEntityId: 'input-a', sourceVersionId: 'version-1', sourcePlacementId: 'placement-1',
        imageUrl: '/api/serve-upload/canonical.png', origin: 'https://app.example' },
      task: { id: 'edit-invalid-result', projectId: 'shared', sessionId: 'workflow:shared',
        messageId: 'invalid:edit-a', type: 'edit', status: 'processing', providerId: 'provider-a',
        model: 'model-a', progress: 0, createdAt: 1, updatedAt: 1 },
    });
    const complete = (): Promise<string> => completeWorkflowEditTask({ actorId: 'editor',
      taskId: 'edit-invalid-result', requestDigest, providerId: 'provider-a', modelId: 'model-a',
      result: { image: { url: 'data:image/png;base64,bm90LWFuLWltYWdl' } },
    });
    const pool = getPool();
    const originalConnect = pool.connect.bind(pool);
    const connectWithCallback = originalConnect as unknown as (callback: unknown) => void;
    let faultInjected = false;
    let discardedUntrustedConnection = false;
    const connectSpy = vi.spyOn(pool, 'connect').mockImplementation(((callback?: unknown) => {
      if (typeof callback === 'function') return connectWithCallback(callback);
      return (async (): Promise<PoolClient> => {
        const client = await originalConnect() as PoolClient;
        const queryClient = client as unknown as { query: (sql: string, ...args: unknown[]) => Promise<unknown> };
        const originalQuery = queryClient.query.bind(client);
        const releaseClient = client as unknown as { release: (discard?: boolean | Error) => void };
        const originalRelease = releaseClient.release.bind(client);
        let checkpointWritten = false;
        let refundSettled = false;
        releaseClient.release = (discard) => {
          if (faultInjected && (checkpointWritten || refundSettled)) {
            discardedUntrustedConnection = discard === true;
          }
          originalRelease(discard);
        };
        queryClient.query = async (sql, ...args) => {
          if (sql === 'COMMIT' && refundSettled && fault === 'refund-before-commit' && !faultInjected) {
            faultInjected = true;
            throw new Error('simulated failure before rejected workflow edit COMMIT');
          }
          const result = await originalQuery(sql, ...args);
          if (sql.includes("SET rejection_reason='WORKFLOW_EDIT_ACCEPTANCE_REJECTED'")) {
            checkpointWritten = true;
          }
          if (sql.includes('settled_task AS (')) refundSettled = true;
          if (sql === 'COMMIT' && checkpointWritten && fault === 'checkpoint-ack-lost' && !faultInjected) {
            faultInjected = true;
            throw new Error('simulated lost rejection checkpoint COMMIT acknowledgement');
          }
          return result;
        };
        return client;
      })();
    }) as typeof pool.connect);
    try {
      expect(await complete()).toBe('pending');
      expect(faultInjected).toBe(true);
      expect(discardedUntrustedConnection).toBe(true);
    } finally { connectSpy.mockRestore(); }
    expect((await getCloudTaskForUser('edit-invalid-result', 'editor'))?.status).toBe('processing');
    deleteEditTask('edit-invalid-result');
    const recoveredPoll = await postPoll(new NextRequest('https://app.example/api/poll-task', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: 'edit-invalid-result', model: 'model-a', providerId: 'provider-a' }),
    }));
    expect(recoveredPoll.status).toBe(200);
    expect(await recoveredPoll.json()).toMatchObject({ success: false, status: 'failed' });
    expect((await getCloudTaskForUser('edit-invalid-result', 'editor'))?.status).toBe('failed');
    expect(await complete()).toBe('terminal');
    const task = await getCloudTaskForUser('edit-invalid-result', 'editor');
    expect(task?.status).toBe('failed');
    expect(task?.creditStatus).toBe('refunded');
    expect((await query("SELECT type FROM wujie_credit_transactions WHERE task_id='edit-invalid-result' ORDER BY type")).rows)
      .toEqual([{ type: 'consume' }, { type: 'refund' }]);
    expect((await query("SELECT task_id FROM wujie_workflow_edit_outputs WHERE task_id='edit-invalid-result'")).rows)
      .toEqual([]);
  });
}, 60_000);

postgresIt('reads back one refund when acceptance media fails without a manifest and the COMMIT acknowledgement is lost', async () => {
  await withIsolatedPostgres('workflow-edit-acceptance-write-refund', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
    await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
    await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
    await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-1','source','owner','shared','/api/serve-upload/canonical.png','image/png')`);
    await query("UPDATE wujie_assets SET current_version_id='version-1' WHERE id='source'");
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-1','owner','shared','source','version-1','workflow','workflow-a','workflow-input','input-a')`);
    await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES ('credits_editor','editor',100,100,0,1,1)");
    const requestDigest = 'c'.repeat(64);
    await createBillableTask({ userId: 'editor', idempotencyKey: 'workflow:write-fail:edit-a:attempt:0',
      requestDigest, creditCost: 5,
      workflowPublication: { access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner',
        projectId: 'shared', grantGeneration: '1' }, workflowId: 'workflow-a', nodeId: 'edit-a',
        sourceEntityId: 'input-a', sourceVersionId: 'version-1', sourcePlacementId: 'placement-1',
        imageUrl: '/api/serve-upload/canonical.png', origin: 'https://app.example' },
      task: { id: 'edit-write-fail', projectId: 'shared', sessionId: 'workflow:shared',
        messageId: 'write-fail:edit-a', type: 'edit', status: 'processing', providerId: 'provider-a',
        model: 'model-a', progress: 0, createdAt: 1, updatedAt: 1 },
    });
    const objects = installWorkflowAcceptanceS3({ failMediaWrite: true });
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 4,
      background: { r: 12, g: 34, b: 56, alpha: 1 } } }).png().toBuffer();
    const complete = (): Promise<string> => completeWorkflowEditTask({ actorId: 'editor',
      taskId: 'edit-write-fail', requestDigest, providerId: 'provider-a', modelId: 'model-a',
      result: { image: { url: `data:image/png;base64,${bytes.toString('base64')}` } },
    });
    const pool = getPool();
    const originalConnect = pool.connect.bind(pool);
    const connectWithCallback = originalConnect as unknown as (callback: unknown) => void;
    let lostAck = false;
    const connectSpy = vi.spyOn(pool, 'connect').mockImplementation(((callback?: unknown) => {
      if (typeof callback === 'function') return connectWithCallback(callback);
      return (async (): Promise<PoolClient> => {
        const client = await originalConnect() as PoolClient;
        const queryClient = client as unknown as { query: (sql: string, ...args: unknown[]) => Promise<unknown> };
        const originalQuery = queryClient.query.bind(client);
        let refundSettled = false;
        queryClient.query = async (sql, ...args) => {
          const result = await originalQuery(sql, ...args);
          if (sql.includes('settled_task AS (')) refundSettled = true;
          if (sql === 'COMMIT' && refundSettled && !lostAck) {
            lostAck = true;
            throw new Error('simulated lost rejected workflow edit COMMIT acknowledgement');
          }
          return result;
        };
        return client;
      })();
    }) as typeof pool.connect);
    try {
      expect(await complete()).toBe('rejected');
      expect(lostAck).toBe(true);
    } finally { connectSpy.mockRestore(); }
    expect(await complete()).toBe('terminal');
    expect(objects.has('private/workflow-edit/accepted/edit-write-fail.json')).toBe(false);
    const task = await getCloudTaskForUser('edit-write-fail', 'editor');
    expect(task?.status).toBe('failed');
    expect(task?.creditStatus).toBe('refunded');
    expect((await query("SELECT type FROM wujie_credit_transactions WHERE task_id='edit-write-fail' ORDER BY type")).rows)
      .toEqual([{ type: 'consume' }, { type: 'refund' }]);
    expect((await query("SELECT task_id FROM wujie_workflow_edit_outputs WHERE task_id='edit-write-fail'")).rows)
      .toEqual([]);
  });
}, 60_000);

postgresIt('runs a real parent edit through charged child, pending poll, and managed workflow output', async () => {
  await withIsolatedPostgres('workflow-edit-parent-output-chain', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
    await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
    await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
    await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-1','source','owner','shared','/api/serve-upload/canonical.png','image/png')`);
    await query("UPDATE wujie_assets SET current_version_id='version-1' WHERE id='source'");
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('canvas-source','owner','shared','source','version-1','canvas','shared','canvas-image','source-image')`);
    await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES ('credits_editor','editor',100,100,0,1,1)");

    const input = createWorkflowNode('input-image', 0, 0);
    input.id = 'input-a';
    input.config = { projectId: 'shared', assetVersionId: 'version-1', placementId: 'canvas-source',
      imageUrl: 'https://attacker.invalid/not-the-source.png' };
    const edit = createWorkflowNode('ai-edit', 300, 0);
    edit.id = 'edit-a';
    edit.config = { ...edit.config, action: 'edit', prompt: 'Change the sky to blue',
      model: 'model-a', providerId: 'provider-a' };
    const dispatches: string[] = [];
    const pollStatuses: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (inputUrl: string | URL | Request, init?: RequestInit) => {
      const url = String(inputUrl);
      const request = new NextRequest(url, { method: init?.method || 'POST',
        headers: new Headers(init?.headers), body: init?.body as BodyInit });
      if (url.includes('/api/edit')) {
        dispatches.push('edit');
        return postEdit(request);
      }
      if (url.includes('/api/poll-task')) {
        dispatches.push('poll');
        const response = await postPoll(request);
        pollStatuses.push(response.status);
        return response;
      }
      throw new Error(`unexpected internal fetch: ${url}`);
    }));
    const workflow = (body: Record<string, unknown>): Promise<Response> => postWorkflow(
      new NextRequest('https://app.example/api/workflow/execute', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }),
    );
    const started = await workflow({ action: 'start', projectId: 'shared', workflowId: 'workflow-a',
      nodes: [input, edit], connections: [createConnection('input-a', 'out-image', 'edit-a', 'in-image', 'image')] });
    expect(started.status, await started.clone().text()).toBe(200);
    const { executionId } = await started.json() as { executionId: string };
    expect(executionId).toMatch(/^exec-/);
    let childId = '';
    await vi.waitFor(async () => {
      const children = (await query("SELECT id FROM cloud_tasks WHERE type='edit' AND user_id='editor'")).rows;
      const currentParent = await getCloudTaskForUser(executionId, 'editor');
      expect(children, JSON.stringify({ dispatches, parentStatus: currentParent?.status,
        parentError: currentParent?.error, results: currentParent?.result?.results })).toHaveLength(1);
      childId = children[0].id as string;
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.result?.activeChildTasks).toMatchObject({ [`${executionId}:edit-a`]: childId });
      expect((await query('SELECT source_version_id,source_placement_id FROM wujie_workflow_edit_publications WHERE task_id=$1', [childId])).rows)
        .toMatchObject([{ source_version_id: 'version-1' }]);
    }, { timeout: 10_000 });
    const workflowPlacement = (await query("SELECT id FROM wujie_workspace_placements WHERE workspace_kind='workflow' AND workspace_id='workflow-a' AND entity_type='workflow-input' AND entity_id='input-a' AND status='active'")).rows;
    expect(workflowPlacement).toHaveLength(1);
    expect((await query('SELECT source_version_id,source_placement_id FROM wujie_workflow_edit_publications WHERE task_id=$1', [childId])).rows)
      .toEqual([{ source_version_id: 'version-1', source_placement_id: workflowPlacement[0].id }]);
    await query("UPDATE wujie_workspace_placements SET status='trashed',deleted_at=now() WHERE id=$1", [workflowPlacement[0].id]);
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 4,
      background: { r: 20, g: 70, b: 110, alpha: 1 } } }).png().toBuffer();
    const raw = await persistAssetBytes({ bytes, filename: 'parent-edit-result.png', mimeType: 'image/png' });
    expect(await completeCloudTask(childId, { image: { url: raw.url } })).toBe(true);
    await vi.waitFor(async () => {
      const parent = await getCloudTaskForUser(executionId, 'editor');
      const results = parent?.result?.results as Record<string, { status?: string; output?: Record<string, unknown> }> | undefined;
      expect(parent?.status).toBe('processing');
      expect(results?.['edit-a']).toMatchObject({ status: 'running',
        output: { status: 'publication-pending', taskId: childId } });
      expect(JSON.stringify(results)).not.toContain(raw.url);
    }, { timeout: 10_000 });
    await query("UPDATE wujie_workspace_placements SET status='active',deleted_at=NULL WHERE id=$1", [workflowPlacement[0].id]);
    await vi.waitFor(async () => {
      await workflow({ action: 'status', executionId });
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.status).toBe('completed');
      const results = parent?.result?.results as Record<string, { output?: Record<string, unknown> }>;
      expect(results['edit-a']?.output).toMatchObject({ taskId: childId });
      expect(results['edit-a']?.output?.imageUrl).toMatch(/^\/api\/serve-upload\/exports\//);
      expect(JSON.stringify(results)).not.toContain(raw.url);
    }, { timeout: 15_000 });
    expect(dispatches.filter(value => value === 'edit')).toHaveLength(1);
    expect(dispatches.filter(value => value === 'poll').length).toBeGreaterThanOrEqual(2);
    expect(pollStatuses).toContain(202);
    expect(pollStatuses).toContain(200);
    expect((await query("SELECT user_id,type FROM wujie_credit_transactions WHERE task_id=$1", [childId])).rows)
      .toEqual([{ user_id: 'editor', type: 'consume' }]);
    expect((await query("SELECT v.owner_id,v.project_id,p.workspace_id,p.entity_id FROM wujie_workflow_edit_outputs o JOIN wujie_asset_versions v ON v.id=o.version_id JOIN wujie_workspace_placements p ON p.id=o.placement_id WHERE o.task_id=$1", [childId])).rows)
      .toEqual([{ owner_id: 'owner', project_id: 'shared', workspace_id: 'workflow-a', entity_id: 'edit-a' }]);
    expect((await query("SELECT current_version_id FROM wujie_assets WHERE id='source'")).rows)
      .toEqual([{ current_version_id: 'version-1' }]);
  });
}, 60_000);

postgresIt('rejects a forged workflow edit source inside the charging transaction', async () => {
  await withIsolatedPostgres('workflow-edit-source', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
    await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
    await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
    await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-1','source','owner','shared','/api/serve-upload/canonical.png','image/png')`);
    await query("UPDATE wujie_assets SET current_version_id='version-1' WHERE id='source'");
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-1','owner','shared','source','version-1','workflow','workflow-a','workflow-input','input-a')`);
    await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES ('credits_editor','editor',100,100,0,1,1)");

    const input: CreateBillableCloudTaskInput = {
      userId: 'editor', idempotencyKey: 'workflow:run-a:edit-a:attempt:0', requestDigest: 'request-a', creditCost: 5,
      workflowPublication: {
        access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner', projectId: 'shared', grantGeneration: '1' },
        workflowId: 'workflow-a', nodeId: 'edit-a', sourceEntityId: 'input-a',
        sourceVersionId: 'version-1', sourcePlacementId: 'placement-1',
        imageUrl: 'https://attacker.invalid/api/serve-upload/canonical.png', origin: 'https://attacker.invalid',
      },
      task: { id: 'edit-forged', userId: 'editor', projectId: 'shared', type: 'edit', status: 'processing', progress: 0,
        providerId: 'provider-a', model: 'model-a', createdAt: 1, updatedAt: 1 },
    };

    await expect(createBillableCloudTask(input)).rejects.toMatchObject({ code: 'WORKFLOW_EDIT_SOURCE_MISMATCH' });
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='editor'")).rows[0]?.balance).toBe(100);
    expect((await query("SELECT id FROM cloud_tasks WHERE id='edit-forged'")).rows).toEqual([]);
    expect((await query("SELECT id FROM wujie_credit_transactions WHERE task_id='edit-forged'")).rows).toEqual([]);
  });
}, 60_000);

postgresIt('freezes workflow node identity with the charged edit task and rejects a conflicting replay', async () => {
  await withIsolatedPostgres('workflow-edit-intent', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
    await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
    await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
    await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-1','source','owner','shared','/api/serve-upload/canonical.png','image/png')`);
    await query("UPDATE wujie_assets SET current_version_id='version-1' WHERE id='source'");
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-1','owner','shared','source','version-1','workflow','workflow-a','workflow-input','input-a')`);
    await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES ('credits_editor','editor',100,100,0,1,1)");
    const input: CreateBillableTaskInput = {
      userId: 'editor', idempotencyKey: 'workflow:run-a:edit-a:attempt:0', requestDigest: 'request-a', creditCost: 5,
      workflowPublication: {
        access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner', projectId: 'shared', grantGeneration: '1' },
        workflowId: 'workflow-a', nodeId: 'edit-a', sourceEntityId: 'input-a',
        sourceVersionId: 'version-1', sourcePlacementId: 'placement-1',
        imageUrl: '/api/serve-upload/canonical.png', origin: 'https://app.example',
      },
      task: { id: 'edit-valid', projectId: 'shared', type: 'edit', status: 'processing', progress: 0,
        providerId: 'provider-a', model: 'model-a', createdAt: 1, updatedAt: 1 },
    };
    const created = await createBillableTask(input);
    expect(created).toMatchObject({ reused: false, charged: true, task: { id: 'edit-valid' } });
    const replayed = await createBillableTask({ ...input, task: { ...input.task, id: 'edit-replay-candidate' } });
    expect(replayed).toMatchObject({ reused: true, charged: false, task: { id: 'edit-valid' } });
    await expect(createBillableTask({ ...input, workflowPublication: {
      ...input.workflowPublication!, nodeId: 'different-edit-node',
    } })).rejects.toMatchObject({ code: 'WORKFLOW_EDIT_INTENT_CONFLICT' });
    await expect(createBillableTask({ ...input, workflowPublication: {
      ...input.workflowPublication!, sourceEntityId: 'other-input',
    } })).rejects.toMatchObject({ code: 'WORKFLOW_EDIT_SOURCE_FORBIDDEN' });
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='editor'")).rows[0]?.balance).toBe(95);
    expect((await query("SELECT id FROM wujie_credit_transactions WHERE task_id='edit-valid'")).rows).toHaveLength(1);
    expect((await query("SELECT actor_id,owner_id,project_id,workflow_id,node_id,source_entity_id,source_version_id,source_placement_id,request_digest FROM wujie_workflow_edit_publications WHERE task_id='edit-valid'")).rows).toEqual([{
      actor_id: 'editor', owner_id: 'owner', project_id: 'shared', workflow_id: 'workflow-a', node_id: 'edit-a',
      source_entity_id: 'input-a', source_version_id: 'version-1', source_placement_id: 'placement-1', request_digest: 'request-a',
    }]);

    const pool = getPool();
    const originalConnect = pool.connect.bind(pool);
    let lostReply = false;
    const connectSpy = vi.spyOn(pool, 'connect').mockImplementation(async () => {
      const client = await originalConnect() as PoolClient;
      const queryClient = client as unknown as { query: (sql: string, ...args: unknown[]) => Promise<unknown> };
      const originalQuery = queryClient.query.bind(client);
      let armed = false;
      queryClient.query = async (sql, ...args) => {
        const result = await originalQuery(sql, ...args);
        if (sql.includes('INSERT INTO wujie_workflow_edit_publications')) armed = true;
        if (sql === 'COMMIT' && armed) {
          lostReply = true;
          throw new Error('simulated lost COMMIT acknowledgement after PostgreSQL accepted it');
        }
        return result;
      };
      return client;
    });
    try {
      await expect(createBillableTask({ ...input,
        idempotencyKey: 'workflow:run-a:edit-a:attempt:1',
        task: { ...input.task, id: 'edit-commit-unknown' },
      })).rejects.toMatchObject({ code: 'WORKFLOW_EDIT_COMMIT_UNKNOWN' });
      expect(lostReply).toBe(true);
    } finally { connectSpy.mockRestore(); }
    expect((await query("SELECT id FROM cloud_tasks WHERE id='edit-commit-unknown'")).rows).toHaveLength(1);
    expect((await query("SELECT task_id FROM wujie_workflow_edit_publications WHERE task_id='edit-commit-unknown'")).rows).toHaveLength(1);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='editor'")).rows[0]?.balance).toBe(90);

    const legacy: CreateBillableTaskInput = { ...input, workflowPublication: undefined,
      idempotencyKey: 'legacy-edit', requestDigest: 'legacy-edit', creditCost: 0,
      task: { ...input.task, id: 'edit-legacy' } };
    await createBillableTask(legacy);
    await query('DROP TABLE wujie_workflow_edit_outputs');
    await query('DROP TABLE wujie_workflow_edit_publications');
    const legacyReplay = await createBillableTask({ ...legacy, task: { ...legacy.task, id: 'edit-legacy-replay' } });
    expect(legacyReplay).toMatchObject({ reused: true, charged: false, task: { id: 'edit-legacy' } });
  });
}, 60_000);
