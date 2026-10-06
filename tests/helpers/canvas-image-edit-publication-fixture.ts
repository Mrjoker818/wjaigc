import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import * as Y from 'yjs';
import { ensureCoreTables } from '@/lib/db-storage';
import { createCanvasDocument, applyCanvasImagePatch, readCanvasDocument } from '@/lib/collaboration/canvas-document';
import { createBillableTask, type CreateBillableTaskInput } from '@/lib/task-core/billing-service';
import { transitionTask } from '@/lib/task-core/task-service';
import type { QueryFn } from './postgres-test-database';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';

export const roleDigest = 'a'.repeat(64);
export async function seedImageEditPublication(query: QueryFn, databaseUrl: string, schemaName: string): Promise<void> {
  const database = new URL(databaseUrl);
  if (!process.env.POSTGRES_TEST_DATABASE_URL || !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
    || !/^test_task_8cb3j4a_/.test(schemaName)
    || !process.env.WUJIE_DATA_DIR?.includes('task-8cb3j4a-')) throw new Error('Dedicated role publication isolation required');
  const start = new Date().toISOString();
  const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  const log = resolve('.superpowers/sdd/2026-09-25-v588-yjs-canvas-collaboration', `task-8cb3j4a-migrations-${schemaName}.log`);
  writeFileSync(log, `command=node scripts/run-migrations.mjs\nstart=${start}\nend=${new Date().toISOString()}\nexit=${migration.status}\n${migration.stdout}\n${migration.stderr}`, { flag: 'wx' });
  if (migration.status !== 0) throw new Error(`Migration failed: ${log}`);
  await ensureCoreTables();
  await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
  await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
  await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
  await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#d4af37' } }).png().toBuffer();
  for (const name of ['primary', 'mask', 'shared']) writeFileSync(join(process.env.WUJIE_DATA_DIR!, `${name}.png`), png);
  await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('asset-shared','owner','shared','image')");
  await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,byte_size,checksum,width,height)
    VALUES ('version-shared','asset-shared','owner','shared','/api/serve-upload/shared.png','image/png',$1,$2,2,2)`,
  [png.length, createHash('sha256').update(png).digest('hex')]);
  await query("UPDATE wujie_assets SET current_version_id='version-shared' WHERE id='asset-shared'");
  await query(`INSERT INTO wujie_workspace_placements
    (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
    VALUES ('placement-shared','owner','shared','asset-shared','version-shared','canvas','shared','canvas-image','image-shared')`);
  const doc = createCanvasDocument();
  applyCanvasImagePatch(doc, { placementId: 'placement-shared', assetVersionId: 'version-shared',
    x: 0, y: 10, width: 100, height: 80, rotation: 15, zIndex: 4 }, 'fixture');
  await query(`INSERT INTO wujie_project_canvas_documents(project_id,owner_id,projection,snapshot_bytes)
    VALUES ('shared','owner',$1,$2)`, [readCanvasDocument(doc), Buffer.from(Y.encodeStateAsUpdate(doc))]);
  doc.destroy();
  await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    SELECT 'credits_' || id,id,100,100,0,1,1 FROM wujie_users`);
}

export function roleAdmission(id: string = 'image_edit_roles'): CreateBillableTaskInput {
  return { userId: 'editor', idempotencyKey: id, requestDigest: roleDigest, creditCost: 7,
    task: { id, projectId: 'shared', type: 'image-edit', status: 'processing', progress: 0, createdAt: 1, updatedAt: 1 },
    canvasPublication: {
      singleAdmission: 'image-edit', imageEditOutputs: { version: 1, includeMask: true },
      access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner', projectId: 'shared', grantGeneration: '1' },
      workspace: 'canvas', workspaceId: 'shared',
      intent: { parentVersionIds: ['version-shared'], projectionMode: 'revision',
        placement: { action: 'append', selectedEntityIds: ['image-shared'] } },
    } };
}
export function roleResult(id: string = 'image_edit_roles', includeMask: boolean = true): Record<string, unknown> {
  return { imageUrl: '/api/serve-upload/primary.png', maskUrl: '/api/serve-upload/mask.png',
    imageEditPublicationCheckpoint: { version: 1, taskId: id, requestDigest: roleDigest, status: 'persisted',
      providerId: 'frozen-provider', modelId: 'frozen-model', outputs: [
        { outputIndex: 0, role: 'primary', url: '/api/serve-upload/primary.png' },
        ...(includeMask ? [{ outputIndex: 1, role: 'mask', url: '/api/serve-upload/mask.png' }] : []),
      ] } };
}
export async function completeRoleTask(input: CreateBillableTaskInput = roleAdmission(), result: Record<string, unknown> = roleResult(input.task.id)): Promise<void> {
  await createBillableTask(input);
  await transitionTask({ taskId: input.task.id, from: ['processing'], to: 'completed', creditStatus: 'charged', result });
}
export async function roleState(query: QueryFn): Promise<Record<string, unknown>> {
  const state: Record<string, unknown> = {};
  for (const table of ['cloud_tasks', 'wujie_canvas_task_publications', 'wujie_credit_transactions', 'wujie_credits',
    'wujie_assets', 'wujie_asset_versions', 'wujie_asset_version_parents', 'wujie_workspace_placements',
    'wujie_canvas_asset_commands', 'wujie_canvas_media_lineage', 'wujie_project_canvas_documents', 'wujie_project_canvas_updates']) {
    state[table] = (await query(`SELECT * FROM ${table} ORDER BY to_jsonb(${table})::text`)).rows;
  }
  return state;
}

/** A fresh Node process has no publication WeakMaps, task registry or pool cache. */
export function recoverRolesInFreshProcess(databaseUrl: string, schemaName: string): WorkspaceAssetReference[] {
  const database = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
    || !/^test_task_8cb3j4a_/.test(schemaName)
    || !database.searchParams.get('options')?.includes(`search_path=${schemaName}`)) throw new Error('Explicit isolated schema required');
  const script = `globalThis.fetch = async () => { throw new Error('Task8Cb3j4a denies fetch'); };
    const { projectCanvasTaskResult } = require('./src/lib/collaboration/task-result-publication.ts');
    const { closePool } = require('./src/lib/db-client.ts');
    (async () => { try { const result = await projectCanvasTaskResult({ actorUserId: 'editor', taskId: 'image_edit_roles',
      targetProjectId: 'shared', workspace: 'canvas', parentVersionIds: ['version-shared'] });
      console.log('ROLE_RESTART_RESULT=' + JSON.stringify(result));
    } finally { await closePool(); } })().catch(error => { console.error(error); process.exitCode = 1; });`;
  const start = new Date().toISOString();
  const result = spawnSync(process.execPath, ['--conditions=react-server', '--import=tsx', '-e', script], {
    encoding: 'utf8', timeout: 45_000, env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  const log = resolve('.superpowers/sdd/2026-09-25-v588-yjs-canvas-collaboration', `task-8cb3j4a-restart-${schemaName}.log`);
  writeFileSync(log, `command=node --conditions=react-server --import=tsx -e ${script}\nstart=${start}\nend=${new Date().toISOString()}\nexit=${result.status}\n${result.stdout}\n${result.stderr}\n${result.error ?? ''}`, { flag: 'wx' });
  if (result.status !== 0) throw new Error(`Fresh process recovery failed: ${log}`);
  const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('ROLE_RESTART_RESULT='));
  if (!line) throw new Error('Fresh process omitted results');
  return JSON.parse(line.slice('ROLE_RESTART_RESULT='.length)) as WorkspaceAssetReference[];
}
