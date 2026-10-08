import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import sharp from 'sharp';
import ts from 'typescript';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';
import { requireOfflineBridgeTestMediaRoot } from '../helpers/offline-bridge-media-guard';
import { createPostgresAssetStorage } from '../../src/lib/asset-core/storage';
import { enrichCompletedImageResult } from '../../src/lib/asset-core/image-result-metadata';
import { createProductionSkillStepRegistry } from '../../src/lib/skill-runtime/step-registry';
import { importDocumentMediaBatch } from '../../src/lib/collaboration/document-media-batch';
import { executeDocumentAssetCommand } from '../../src/lib/collaboration/document-asset-commands';
import type { ExecuteSkillStepInput } from '../../src/lib/skill-runtime/executor';
import { skillRunAssetReadStorage,resolveSkillRunAssets,resolveSkillRunSources,createSkillDocumentAssetScope } from '../../src/lib/skill-runtime/document-assets';
import { getPool } from '../../src/lib/db-client';
import { persistComplianceReportAsset } from '../../src/lib/platform-compliance/report-asset';
import { parsePlatformComplianceReport,canonicalComplianceReportJson } from '../../src/lib/platform-compliance/report-schema';
import { validReport } from '../../src/__tests__/helpers/platform-compliance-fixtures';
import JSZip from 'jszip';
import type { PoolClient } from 'pg';
import { validateMultiPlatformExportRetryLineage } from '../../src/lib/multi-platform-export/artifacts';
import * as Y from 'yjs';
import { loadDocument,commitDocumentUpdate } from '../../src/lib/collaboration/document-store';
import { readCanvasDocument } from '../../src/lib/collaboration/canvas-document';
import { NextRequest } from 'next/server';
import { prepareSkillRestoration } from '../../src/lib/collaboration/document-skill-restoration';
const auth=vi.hoisted(()=>({getSessionUser:vi.fn()}));
vi.mock('@/lib/server-auth',()=>({getSessionUser:auth.getSessionUser}));
import { GET as reportDownload } from '../../src/app/api/skill-reports/[runId]/[stepId]/route';
vi.mock('server-only', () => ({}));

let root: string, image: Buffer;
const previousRoot = process.env.WUJIE_DATA_DIR;
function admitSkillFixture(previous: string | undefined, environment: NodeJS.ProcessEnv): string {
  requireOfflineBridgeTestDatabaseUrl(environment);
  const admitted = requireOfflineBridgeTestMediaRoot(previous);
  const identity = (value: string): string => path.resolve(value).toLowerCase();
  for (const key of ['WUJIE_DATA_DIR', 'MEDIA_ROOT', 'WUJIE_SUITE_MEDIA_ROOT'] as const) {
    const value = environment[key];
    if (value !== undefined && (!path.isAbsolute(value) || identity(value) !== identity(admitted)))
      throw new Error('Current suite media identity required');
  }
  // This suite runs the current checkout, not a historical frozen build copy.
  for (const bound of [admitted]) {
    if (identity(realpathSync(bound)) !== identity(bound)) throw new Error('Canonical suite path required');
    for (let current = bound; ; current = path.dirname(current)) {
      const entry = lstatSync(current);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Non-linked suite path required');
      if (path.dirname(current) === current) break;
    }
  }
  return admitted;
}
beforeAll(async () => {
  // Production imports may cache DataRoot before beforeAll; use the same actual private root.
  root = admitSkillFixture(previousRoot, process.env);
  await mkdir(path.join(root, 'images'), { recursive: true });
  image = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#d4af37' } }).png().toBuffer();
  await writeFile(path.join(root, 'images/source.png'), image);
});
beforeEach(() => vi.stubEnv('WUJIE_YJS_ENABLED', 'true'));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => {
  if (root && previousRoot && path.resolve(root) === path.resolve(previousRoot))
    await rm(path.join(root, 'images/source.png'), { force: true });
  if (previousRoot === undefined) delete process.env.WUJIE_DATA_DIR; else process.env.WUJIE_DATA_DIR = previousRoot;
});

async function seed(query: QueryFn): Promise<void> {
  for (const name of ['20260809_wj_core_users.sql','20260810_wj_stable_s2_assets.sql',
    '20260811_wj_stable_s2_asset_transfer_idempotency.sql','20260811_wj_stable_s2_cross_project_transfer.sql',
    '20260815_wj_cloud_tasks.sql','20260816_wj_stable_s4_agent_events.sql',
    '20260817_wj_stable_s4_agent_execution_leases.sql','20260902_unified_skill_task4_agent_controls.sql',
    '20260817_wj_stable_s4_agent_downstream_operations.sql',
    '20260817_wj_stable_s4_agent_downstream_step_identity.sql',
    '20260902_unified_skill_task4_execution_fence.sql','20260903_unified_skill_task4_dispatch_lease.sql',
    '20260909_mpe_cross_asset_parents.sql','20260909_mpe_export_cleanup_outbox.sql',
    '20260910_mpe_export_cleanup_leases.sql','20260913_canvas_video_placements.sql',
    '20260925_yjs_canvas_editors.sql','20260925_yjs_canvas_documents.sql',
    '20260925_yjs_canvas_asset_adoptions.sql','20260927_yjs_canvas_asset_commands.sql',
    '20261004_yjs_canvas_removal_snapshots.sql','20260927_asset_cleanup_local_identity.sql',
    '20260927_yjs_canvas_media_imports.sql','20260927_yjs_canvas_task_publications.sql',
    '20260927_yjs_canvas_task_publications_intent.sql',
    '20260927_yjs_canvas_version_imports.sql','20261006_yjs_canvas_media_batch_receipts.sql']) {
    await query(await readFile(path.join('migrations', name), 'utf8'));
  }
  await query(`INSERT INTO wujie_users(id,name,password_hash,status,created_at,updated_at)
    VALUES ('owner','Owner','fixture','active',1,1),('editor','Editor','fixture','active',1,1);
    INSERT INTO wujie_projects(id,owner_id,name) VALUES ('target','owner','Shared');
    INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('target','owner',true);
    INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id,status)
      VALUES ('target','owner','editor','active');
    CREATE TABLE wujie_platform_export_presets(preset_id text,version integer,platform text,usage text,label text,
      width integer,height integer,recommended_format text,supports_transparency boolean,enabled boolean);
    INSERT INTO wujie_platform_export_presets VALUES ('fixture-square',1,'fixture','post','Square',2,2,'png',true,true),
      ('fixture-tall',1,'fixture','story','Tall',2,4,'png',true,true);`);
  await query(`INSERT INTO cloud_tasks(id,user_id,project_id,type,status,result,created_at,updated_at)
    VALUES ('run','editor','target','agent-run','processing','{}',1,1),
      ('child','editor','target','generate','completed',$1::jsonb,1,1)`,
    [JSON.stringify({ assetProjection: { versionIds: ['source-v'] } })]);
  await query(`INSERT INTO wujie_agent_events(event_id,task_id,owner_id,project_id,workspace,sequence,event_type,request_digest,payload,created_at)
    VALUES ('created','run','editor','target','canvas',1,'run.created','run-digest',$1::jsonb,1)`,
    [JSON.stringify({ workspace: 'canvas', workspaceId: 'target', sourceVersionIds: ['source-v'],
      skill: { skillId: 'preset-multi-platform-export', skillVersion: 1, inputValues: {}, modelBindings: {} },
      skillSnapshot:{id:'preset-multi-platform-export',version:1} })]);
  await query(`INSERT INTO wujie_agent_execution_leases(task_id,owner_id,project_id,tool_id,lease_owner,lease_expires_at,
    generation,updated_at) VALUES ('run','editor','target','skill','fixture-lease',9999999999999,1,1)`);
  await query(`INSERT INTO wujie_agent_downstream_operations(operation_key,owner_id,project_id,task_id,tool_id,
    request_digest,idempotency_key,status,created_at,updated_at,step_id) VALUES
    ('step-operation','editor','target','run','multi_platform_export','step-digest','step-key','prepared',1,1,'export')`);
  await query(`INSERT INTO wujie_canvas_task_publications(task_id,actor_id,owner_id,project_id,workspace_id,grant_generation)
    SELECT 'run','editor','owner','target','target',grant_generation FROM wujie_project_document_editors
      WHERE project_id='target' AND member_user_id='editor'`);
  await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source-a','owner','target','image')");
  await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,byte_size,checksum,availability,width,height)
    VALUES ('source-v','source-a','owner','target','/api/serve-upload/images/source.png','image/png',$1,$2,'ready',2,2)`,
    [image.length,createHash('sha256').update(image).digest('hex')]);
  await query("UPDATE wujie_assets SET current_version_id='source-v' WHERE id='source-a'");
}
const actor = { id: 'editor', name: 'Editor', role: 'user' as const, status: 'active' as const,
  productType: 'canvas', createdAt: 1, updatedAt: 1 };
const request = { skillId: 'preset-multi-platform-export', skillVersion: 1, surface: 'canvas' as const,
  projectId: 'target', workspaceId: 'target', inputValues: {}, sourceVersionIds: ['source-v'],
  modelBindings: {}, idempotencyKey: 'run-key' };
function step(): ExecuteSkillStepInput {
  const signal = new AbortController().signal;
  return { actorUserId: 'editor', projectId: 'target', runId: 'run', requestDigest: 'step-digest',
    definition: { id: request.skillId, version: 1, name: 'Export', category: 'image', description: '', systemPrompt: '',
      allowedSurfaces: ['canvas'], inputs: [], steps: [], enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0 },
    step: { id: 'export', label: 'Export', toolId: 'multi_platform_export', runtime: 'local', execution: 'sequential',
      promptTemplate: '', qualityGateIds: ['output-present'] },
    inputValues: { sourceAssetVersionIds: ['source-v'], targetPresetIds: ['fixture-square-v1','fixture-tall-v1'],
      fit: 'contain', background: 'transparent', namingTemplate: '{asset}-{usage}-{index}' },
    signal, operation: { idempotencyKey: 'step-key', operationKey: 'step-operation', recovery: false, signal,
      executionFence: { runId: 'run', leaseOwner: 'fixture-lease', generation: 1 },
      beginSubmission: async () => {}, recordAccepted: async () => {}, recordLocalAccepted: async () => {},
      executeOperation: async () => { throw new Error('No remote operation allowed in CPU fixture'); } } };
}
const command = { action: 'attach' as const, transform: { x: 1, y: 2, width: 20, height: 10, rotation: 0, zIndex: 1 } };
async function outputs(query:QueryFn,versions:readonly string[]):Promise<void> {
  for(const [index,version] of versions.entries())await query(`INSERT INTO wujie_agent_events
    (event_id,task_id,owner_id,project_id,workspace,sequence,event_type,request_digest,payload,created_at)
    VALUES($1,'run','editor','target','canvas',$2,'asset.created',$1,$3::jsonb,2)`,
    ['output-'+index,index+100,JSON.stringify({assetVersionId:version,stepId:'export',generation:1})]);
}
async function second(query:QueryFn):Promise<void> {
  await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('second-a','owner','target','image')");
  await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,byte_size,checksum,availability,width,height)
    SELECT 'second-v','second-a',owner_id,project_id,file_url,mime_type,byte_size,checksum,availability,width,height
    FROM wujie_asset_versions WHERE id='source-v'`);
  await query("UPDATE wujie_assets SET current_version_id='second-v' WHERE id='second-a'");
}
function batch(key='deliver',versions=['source-v','second-v']) {
  return {projectId:'target',idempotencyKey:key,skillRunId:'run',items:versions.map(sourceVersionId=>({sourceVersionId,command}))};
}
async function counts(query:QueryFn):Promise<unknown> {
  return (await query(`SELECT (SELECT count(*) FROM wujie_workspace_placements) AS placements,
    (SELECT count(*) FROM wujie_canvas_asset_commands) AS commands,
    (SELECT count(*) FROM wujie_project_canvas_updates) AS updates`)).rows;
}
function assetScope() {
  const input=step();return createSkillDocumentAssetScope({actorUserId:input.actorUserId,projectId:input.projectId,
    runId:input.runId,stepId:input.step.id,requestDigest:input.requestDigest,sourceVersionIds:request.sourceVersionIds,
    executionFence:input.operation.executionFence,toolId:input.step.toolId,operationKey:input.operation.operationKey,
    operationIdempotencyKey:input.operation.idempotencyKey,signal:input.signal});
}
describe('1397 fix1 real restoration deadline', () => {
  async function removal(query: QueryFn): Promise<{ placementId: string; expectedRemovalSequence: number }> {
    await seed(query); await outputs(query, ['source-v']);
    const attached = await executeDocumentAssetCommand({ actorId: 'editor', projectId: 'target', idempotencyKey: 'initial', command: { ...command, assetVersionId: 'source-v' } });
    const removed = await executeDocumentAssetCommand({ actorId: 'editor', projectId: 'target', idempotencyKey: 'remove', command: { action: 'remove', placementId: attached.placementId, expectedAssetVersionId: 'source-v' } });
    return { placementId: attached.placementId, expectedRemovalSequence: removed.documentSequence };
  }
  it('pre-aborted actual preparation must not mint a restoration capability', async () => {
    await withIsolatedPostgres('skill-fix1-abort', async ({ query }) => {
      const restore = await removal(query); const controller = new AbortController(); controller.abort(new Error('fixture abort'));
      const prepare = prepareSkillRestoration as (a: string, p: string, v: string, r: typeof restore, s: AbortSignal) => Promise<unknown>;
      await expect(prepare('editor', 'target', 'source-v', restore, controller.signal)).rejects.toThrow();
      expect(getPool().waitingCount).toBe(0);
    });
  }, 30_000);
  it.each([false, true])('actual batch snapshot lock wait is bounded and releases the root key (abort=%s)', async abort => {
    await withIsolatedPostgres('skill-fix1-lock', async ({ query }) => {
      const restore = await removal(query);
      await query('BEGIN'); await query('UPDATE wujie_workspace_placements SET updated_at=now() WHERE id=$1', [restore.placementId]);
      const controller = new AbortController();
      const cancel = abort ? setTimeout(() => controller.abort(new Error('fixture during lock')), 400) : undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unblock = new Promise<void>((resolve, reject) => { timer = setTimeout(() => { void query('ROLLBACK').then(() => resolve(), reject); }, 5000); });
      const started = Date.now(); let error: unknown; let elapsed = 0;
      try { await importDocumentMediaBatch('editor', { ...batch('bounded', ['source-v']), items: [{ sourceVersionId: 'source-v', command, restore }] }, controller.signal); }
      catch (cause) { error = cause; }
      finally { elapsed = Date.now() - started; await unblock; if (timer) clearTimeout(timer); if (cancel) clearTimeout(cancel); }
      // Measure the actual request, not delayed blocker cleanup.
      expect(error).toBeDefined();
      expect(elapsed).toBeLessThan(4000);
      expect((await query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND granted AND pid<>pg_backend_pid()")).rows[0].n).toBe(0);
      expect(getPool().waitingCount).toBe(0);
      expect(getPool().idleCount).toBe(getPool().totalCount);
      expect((await query('SELECT status FROM wujie_workspace_placements WHERE id=$1', [restore.placementId])).rows[0].status).toBe('trashed');
      const retry = await importDocumentMediaBatch('editor', { ...batch('bounded', ['source-v']), items: [{ sourceVersionId: 'source-v', command, restore }] });
      expect(retry.items[0].placementId).not.toBe(restore.placementId);
      expect(Date.now() - started).toBeLessThan(8000);
    });
  }, 30_000);
});

describe('1397 fix1 actual run-created source admission', () => {
  it('reads ordered ready created inputs while outputs still reject those inputs', async () => {
    await withIsolatedPostgres('skill-fix1-sources', async ({ query }) => {
      await seed(query); await second(query);
      await query("UPDATE wujie_agent_events SET payload=jsonb_set(payload,'{sourceVersionIds}','[\"source-v\",\"second-v\"]'::jsonb) WHERE event_id='created'");
      const input = { actorUserId: 'editor', projectId: 'target', runId: 'run', assetVersionIds: ['second-v', 'source-v'] };
      const result = await resolveSkillRunSources(input);
      expect(result).toMatchObject({ actorUserId: 'editor', projectId: 'target', runId: 'run' });
      expect(result.references.map(v => v.assetVersionId)).toEqual(input.assetVersionIds);
      expect(result.references.every(v => v.kind === 'image' && v.url === '/api/serve-upload/images/source.png')).toBe(true);
      await expect(resolveSkillRunAssets(input)).rejects.toThrow();
    });
  }, 30_000);
  it.each(['actor', 'project', 'run', 'not-created', 'revoked', 'closed', 'duplicate', 'limit', 'abort'] as const)('rejects %s without broadening source/output authority', async mode => {
    await withIsolatedPostgres('skill-fix1-source-deny', async ({ query }) => {
      await seed(query); await second(query); await outputs(query, ['second-v']);
      if (mode === 'revoked') await query("UPDATE wujie_project_document_editors SET status='revoked'");
      if (mode === 'closed') await query('UPDATE wujie_project_document_settings SET enabled=false');
      const controller = new AbortController(); if (mode === 'abort') controller.abort(new Error('fixture abort'));
      await expect(resolveSkillRunSources({ actorUserId: mode === 'actor' ? 'owner' : 'editor', projectId: mode === 'project' ? 'other' : 'target',
        runId: mode === 'run' ? 'child' : 'run', assetVersionIds: mode === 'not-created' ? ['second-v']
          : mode === 'duplicate' ? ['source-v', 'source-v'] : mode === 'limit' ? Array.from({ length: 101 }, (_, i) => 'v' + i) : ['source-v'], signal: controller.signal })).rejects.toThrow();
    });
  }, 30_000);
});

describe('1397 existing-entry business contract', () => {
  it('default production dimension resolver reads editor owner output as 2x2', async () => {
    await withIsolatedPostgres('skill-dimensions', async ({ query }) => {
      await seed(query);
      // Evaluate this existing private callback, keeping actual PostgreSQL storage and decoder.
      const source = ts.createSourceFile('registry.ts', readFileSync('src/lib/skill-runtime/step-registry.ts','utf8'),
        ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
      let expression: string | undefined;
      const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'resolveSkillMediaMetadata') expression = node.initializer?.getText(source);
        ts.forEachChild(node,visit);
      }; visit(source);
      if (!expression) throw new Error('Actual dimension callback missing');
      const js = ts.transpileModule('const resolver = '+expression+';',
        { compilerOptions: { target: ts.ScriptTarget.ES2022,module: ts.ModuleKind.None } }).outputText;
      const resolver = new Function('createPostgresAssetStorage','enrichCompletedImageResult','skillRunAssetReadStorage',js+';return resolver;')(
        createPostgresAssetStorage,enrichCompletedImageResult,skillRunAssetReadStorage) as (input: {actorUserId:string;projectId:string;runId:string;assetVersionIds:string[]}) => Promise<unknown[]>;
      const media = await resolver({actorUserId:'editor',projectId:'target',runId:'run',assetVersionIds:['source-v']});
      expect(media[0]).toMatchObject({width:2,height:2});
    });
  },30_000);
  it('actual MPE registry exports two editor-requested owner sources into owner namespace', async () => {
    await withIsolatedPostgres('skill-cpu-export', async ({ query }) => {
      await seed(query);
      const completed = await createProductionSkillStepRegistry({ actor, request }).stepAdapters.multi_platform_export(step());
      expect(completed.assetVersionIds.length).toBeGreaterThanOrEqual(2);
      const images = (await query(`SELECT id,owner_id FROM wujie_asset_versions WHERE id=ANY($1) AND mime_type='image/png'`,
        [completed.assetVersionIds])).rows;
      expect(images).toHaveLength(2);
      expect(images.map(item => item.owner_id)).toEqual(['owner','owner']);
      for (const item of images) expect((await query('SELECT parent_version_id FROM wujie_asset_version_parents WHERE version_id=$1',
        [item.id])).rows.map(row=>row.parent_version_id)).toEqual(['source-v']);
      const documents=(await query(`SELECT id,file_url,mime_type,checksum,byte_size,owner_id FROM wujie_asset_versions
        WHERE id=ANY($1) AND mime_type IN ('application/json','application/zip')`,[completed.assetVersionIds])).rows;
      expect(documents).toHaveLength(2);expect(documents.every(v=>v.owner_id==='owner')).toBe(true);
      for(const document of documents) {
        const name=decodeURIComponent(String(document.file_url).replace('/api/serve-upload/',''));
        const bytes=await readFile(path.join(root,name));
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(document.checksum);
        expect(bytes.length).toBe(Number(document.byte_size));
        if(document.mime_type==='application/zip')expect(Object.keys((await JSZip.loadAsync(bytes)).files)).toHaveLength(3);
        else expect(JSON.parse(bytes.toString()).runId).toBe('run');
      }
      await outputs(query,completed.assetVersionIds);
      const resolved=await resolveSkillRunAssets({actorUserId:'editor',projectId:'target',runId:'run',assetVersionIds:completed.assetVersionIds});
      expect(resolved.references.filter(v=>v.kind==='document')).toHaveLength(2);
      const delivered=await importDocumentMediaBatch('editor',batch('cpu',images.map(row=>String(row.id))));
      expect(delivered.items.every(item=>item.mode==='attach'&&item.assetVersionId===item.sourceVersionId)).toBe(true);
    });
  },30_000);
  it('actual batch restores an explicitly deleted Skill result without resurrecting the old placement', async () => {
    await withIsolatedPostgres('skill-explicit-restore', async ({ query }) => {
      await seed(query);
      await query(`INSERT INTO wujie_agent_events(event_id,task_id,owner_id,project_id,workspace,sequence,event_type,request_digest,payload,created_at)
        VALUES ('output','run','editor','target','canvas',2,'asset.created','output-digest','{"assetVersionId":"source-v"}',2)`);
      const attached = await executeDocumentAssetCommand({ actorId:'editor',projectId:'target',idempotencyKey:'initial',
        command:{...command,assetVersionId:'source-v'} });
      const removed = await executeDocumentAssetCommand({ actorId:'editor',projectId:'target',idempotencyKey:'delete',
        command:{action:'remove',placementId:attached.placementId,expectedAssetVersionId:'source-v'} });
      const restored = await importDocumentMediaBatch('editor',{projectId:'target',idempotencyKey:'explicit-restore',skillRunId:'run',
        items:[{sourceVersionId:'source-v',command,restore:{placementId:attached.placementId,expectedRemovalSequence:removed.documentSequence}}]});
      expect(restored.items).toHaveLength(1);
      expect(restored.items[0].placementId).not.toBe(attached.placementId);
      expect((await query('SELECT status FROM wujie_workspace_placements WHERE id=$1',[attached.placementId])).rows[0].status).toBe('trashed');
    });
  },30_000);
});

describe('1397 real scope / atomic delivery / restore controls',()=>{
  it('real scoped retry admission and CPU continuation reuse owner outputs without duplicating image versions',async()=>{
    await withIsolatedPostgres('skill-real-retry',async({query})=>{
      await seed(query);
      const first=await createProductionSkillStepRegistry({actor,request}).stepAdapters.multi_platform_export(step());
      const reused=(await query("SELECT id FROM wujie_asset_versions WHERE id=ANY($1) AND mime_type='image/png' ORDER BY id",[first.assetVersionIds])).rows.map(v=>String(v.id));
      await outputs(query,first.assetVersionIds);
      const lineage={kind:'multi-platform-export-retry-v1' as const,rootRunId:'run',retryOfRunId:'run',attempt:2,
        reusedImageAssetVersionIds:reused,failedItems:[{sourceAssetVersionId:'source-v',code:'EXPORT_ARCHIVE_FAILED',retryable:true}]};
      await validateMultiPlatformExportRetryLineage({actorUserId:'editor',projectId:'target',sourceAssetVersionIds:['source-v'],
        targetPresetIds:['fixture-square-v1','fixture-tall-v1'],lineage,storage:skillRunAssetReadStorage({actorUserId:'editor',projectId:'target',runId:'run'})});
      await query(`INSERT INTO cloud_tasks(id,user_id,project_id,type,status,result,created_at,updated_at)
        SELECT 'retry',user_id,project_id,type,'processing','{}',3,3 FROM cloud_tasks WHERE id='run';
        INSERT INTO wujie_canvas_task_publications(task_id,actor_id,owner_id,project_id,workspace_id,grant_generation)
        SELECT 'retry',actor_id,owner_id,project_id,workspace_id,grant_generation FROM wujie_canvas_task_publications WHERE task_id='run';
        INSERT INTO wujie_agent_execution_leases(task_id,owner_id,project_id,tool_id,lease_owner,lease_expires_at,generation,updated_at)
        VALUES('retry','editor','target','skill','fixture-lease',9999999999999,1,3);
        INSERT INTO wujie_agent_downstream_operations(operation_key,owner_id,project_id,task_id,tool_id,request_digest,idempotency_key,status,created_at,updated_at,step_id)
        VALUES('retry-operation','editor','target','retry','multi_platform_export','step-digest','retry-key','prepared',3,3,'export')`);
      await query(`INSERT INTO wujie_agent_events(event_id,task_id,owner_id,project_id,workspace,sequence,event_type,request_digest,payload,created_at)
        SELECT 'retry-created','retry',owner_id,project_id,workspace,1,event_type,'retry-digest',payload||jsonb_build_object('retryLineage',$1::jsonb),3
        FROM wujie_agent_events WHERE event_id='created'`,[JSON.stringify(lineage)]);
      const original=step();const retryInput={...original,runId:'retry',operation:{...original.operation,operationKey:'retry-operation',idempotencyKey:'retry-key',
        executionFence:{runId:'retry',leaseOwner:'fixture-lease',generation:1}}};
      const retried=await createProductionSkillStepRegistry({actor,request:{...request,retryLineage:lineage}}).stepAdapters.multi_platform_export(retryInput);
      expect(reused.every(id=>retried.assetVersionIds.includes(id))).toBe(true);
      expect((await query("SELECT count(*)::int AS n FROM wujie_asset_versions WHERE mime_type='image/png'")).rows[0].n).toBe(3);
      await query("UPDATE wujie_project_document_editors SET status='revoked'");
      await expect(validateMultiPlatformExportRetryLineage({actorUserId:'editor',projectId:'target',sourceAssetVersionIds:['source-v'],
        targetPresetIds:['fixture-square-v1','fixture-tall-v1'],lineage,storage:skillRunAssetReadStorage({actorUserId:'editor',projectId:'target',runId:'run'})})).rejects.toThrow();
    });
  },30_000);
  it('delivers ready owner versions once under 20 concurrent same-key calls, preserving actor tasks',async()=>{
    await withIsolatedPostgres('skill-batch-concurrency',async({query})=>{
      await seed(query);await second(query);await outputs(query,['source-v','second-v']);
      const before=(await query('SELECT id,user_id,status,result,credit_status FROM cloud_tasks ORDER BY id')).rows;
      const results=await Promise.all(Array.from({length:20},()=>importDocumentMediaBatch('editor',batch())));
      expect(results.every(result=>JSON.stringify(result)===JSON.stringify(results[0]))).toBe(true);
      expect(results[0].items).toHaveLength(2);
      expect((await query('SELECT count(*)::int AS n FROM wujie_workspace_placements')).rows[0].n).toBe(2);
      expect((await query('SELECT count(*)::int AS n FROM wujie_canvas_asset_commands')).rows[0].n).toBe(3);
      expect((await query('SELECT id,user_id,status,result,credit_status FROM cloud_tasks ORDER BY id')).rows).toEqual(before);
    });
  },30_000);
  it('last-child native SQL rejection rolls back first placement, Yjs and root receipt',async()=>{
    await withIsolatedPostgres('skill-batch-rollback',async({query})=>{
      await seed(query);await second(query);await outputs(query,['source-v','second-v']);
      await query(`ALTER TABLE wujie_workspace_placements ADD CONSTRAINT reject_last CHECK(asset_version_id<>'second-v')`);
      const before=await counts(query);
      await expect(importDocumentMediaBatch('editor',batch())).rejects.toThrow();expect(await counts(query)).toEqual(before);
    });
  },30_000);
  it('recovers only the complete authorized durable receipt after native COMMIT lost reply',async()=>{
    await withIsolatedPostgres('skill-batch-unknown-commit',async({query})=>{
      await seed(query);await second(query);await outputs(query,['source-v','second-v']);
      const pool=getPool(),connect=pool.connect.bind(pool);let lost=false;
      const originals=new Map<PoolClient,PoolClient['query']>();
      // Preserve the native callback overload used by pool.query, instrument only Promise acquisitions.
      const spy=vi.spyOn(pool,'connect').mockImplementation(((callback?:unknown)=>{
        if(typeof callback==='function')return connect(callback as Parameters<typeof pool.connect>[0]);
        return connect().then(client=>{
          if(originals.has(client))return client;
          originals.set(client,client.query);
          const native=client.query.bind(client);
          client.query=((sql:unknown,...args:unknown[])=>{
            if(typeof sql==='string'&&sql==='COMMIT'&&!lost) {
              return native('SELECT 1 FROM wujie_canvas_asset_commands WHERE batch_manifest IS NOT NULL').then(async rows=>{
                if(rows.rowCount){await native('COMMIT');lost=true;throw new Error('native commit reply lost');}
                return native('COMMIT');
              });
            }
            return Reflect.apply(native,client,[sql,...args]);
          }) as typeof client.query;
          return client;
        });
      }) as typeof pool.connect);
      try {
        const result=await importDocumentMediaBatch('editor',batch());expect(lost).toBe(true);expect(result.items).toHaveLength(2);
        expect(await importDocumentMediaBatch('editor',batch())).toEqual(result);
      }finally{spy.mockRestore();for(const [client,query] of originals)client.query=query;}
    });
  },30_000);
  it.each(['wrong actor','wrong run','wrong project','non-output','closed document','revoked'] as const)('rejects %s without private fallback or writes',async fault=>{
    await withIsolatedPostgres('skill-scope-reject',async({query})=>{
      await seed(query);await outputs(query,['source-v']);const before=await counts(query);
      if(fault==='closed document')await query('UPDATE wujie_project_document_settings SET enabled=false');
      if(fault==='revoked')await query("UPDATE wujie_project_document_editors SET status='revoked'");
      const input={actorUserId:fault==='wrong actor'?'owner':'editor',projectId:fault==='wrong project'?'other':'target',
        runId:fault==='wrong run'?'child':'run',assetVersionIds:[fault==='non-output'?'second-v':'source-v']};
      await expect(resolveSkillRunAssets(input)).rejects.toThrow();
      await expect(importDocumentMediaBatch(input.actorUserId,{...batch('rejected',[input.assetVersionIds[0]]),
        skillRunId:input.runId,projectId:input.projectId})).rejects.toThrow();
      expect(await counts(query)).toEqual(before);
    });
  },30_000);
  it.each(['paused fence','new generation','source metadata','source current head','new grant'] as const)('writer rejects frozen %s after CPU read',async fault=>{
    await withIsolatedPostgres('skill-writer-fence',async({query})=>{
      await seed(query);const scope=await assetScope();const reference=await scope.assetService.resolveAssetReference({actorUserId:'editor',projectId:'target',assetVersionId:'source-v'});
      expect(reference.url).toContain('source.png');
      if(fault==='paused fence')await query('UPDATE wujie_agent_execution_leases SET paused_at=1');
      if(fault==='new generation')await query('UPDATE wujie_agent_execution_leases SET generation=2');
      if(fault==='source metadata')await query(`UPDATE wujie_asset_versions SET metadata='{"changed":true}'`);
      if(fault==='source current head'){await second(query);await query("UPDATE wujie_assets SET current_version_id=NULL WHERE id='source-a'");}
      if(fault==='new grant')await query('UPDATE wujie_project_document_editors SET grant_generation=grant_generation+1');
      const before=(await query('SELECT count(*)::int AS n FROM wujie_asset_versions')).rows[0].n;
      await expect(scope.assetService.createAssetVersion({actorUserId:'editor',projectId:'target',kind:'image',parentVersionIds:['source-v'],
        file:{url:reference.url,availability:'ready',checksum:createHash('sha256').update(image).digest('hex'),mimeType:'image/png',byteSize:image.length,width:2,height:2},
        idempotencyKey:'skill:run:export:source-v:fixture:v1',requestDigest:'artifact-digest',
        metadata:{schemaId:'multi-platform-export-v1',runId:'run',sourceAssetVersionId:'source-v',presetId:'fixture',presetVersion:1}})).rejects.toThrow();
      expect((await query('SELECT count(*)::int AS n FROM wujie_asset_versions')).rows[0].n).toBe(before);
    });
  },30_000);
  it('current regrant allows historical read/delivery but does not restore old writer lease/grant',async()=>{
    await withIsolatedPostgres('skill-current-regrant',async({query})=>{
      await seed(query);await outputs(query,['source-v']);const writer=await assetScope();
      await query('UPDATE wujie_project_document_editors SET grant_generation=grant_generation+1');
      expect((await resolveSkillRunAssets({actorUserId:'editor',projectId:'target',runId:'run',assetVersionIds:['source-v']})).references).toHaveLength(1);
      expect((await importDocumentMediaBatch('editor',batch('historical',['source-v']))).items[0].mode).toBe('attach');
      await query('UPDATE wujie_agent_execution_leases SET paused_at=1');
      await expect(writer.assetService.createAssetVersion({actorUserId:'editor',projectId:'target',kind:'image',parentVersionIds:['source-v'],
        file:{url:'/api/serve-upload/images/source.png',availability:'ready',checksum:createHash('sha256').update(image).digest('hex'),mimeType:'image/png',byteSize:image.length,width:2,height:2},
        idempotencyKey:'skill:run:export:source-v:fixture:v1',requestDigest:'artifact-digest',
        metadata:{schemaId:'multi-platform-export-v1',runId:'run',sourceAssetVersionId:'source-v',presetId:'fixture',presetVersion:1}})).rejects.toThrow();
    });
  },30_000);
  it('ordinary attach rejects deletion; fresh process explicit restore uses another editor durable snapshot and never reattaches later deleted ACK',async()=>{
    await withIsolatedPostgres('skill-fresh-restore',async({query,databaseUrl})=>{
      await seed(query);await outputs(query,['source-v']);
      const initial=await importDocumentMediaBatch('editor',batch('initial',['source-v']));
      const removed=await executeDocumentAssetCommand({actorId:'owner',projectId:'target',idempotencyKey:'owner-delete',
        command:{action:'remove',placementId:initial.items[0].placementId,expectedAssetVersionId:'source-v'}});
      await expect(importDocumentMediaBatch('editor',batch('implicit',['source-v']))).rejects.toThrow();
      const input={...batch('restore',['source-v']),items:[{sourceVersionId:'source-v',command,
        restore:{placementId:removed.placementId,expectedRemovalSequence:removed.documentSequence}}]};
      const env:NodeJS.ProcessEnv={NODE_ENV:'test'};
      for(const key of ['SystemRoot','WINDIR','SystemDrive','COMSPEC','PATHEXT','NUMBER_OF_PROCESSORS','OS','PATH','TEMP','TMP',
        'NODE_OPTIONS','WUJIE_DATA_DIR','MEDIA_ROOT','WUJIE_SUITE_COPY_ROOT','WUJIE_SUITE_MEDIA_ROOT'])if(process.env[key])env[key]=process.env[key];
      Object.assign(env,{DATABASE_URL:databaseUrl,PGDATABASE_URL:databaseUrl,NODE_ENV:'test',LOCAL_AI_ENABLED:'false',WUJIE_YJS_ENABLED:'true',WUJIE_PRESENCE_ENABLED:'false'});
      const code=`const m=await import('./src/lib/collaboration/document-media-batch.ts');const db=await import('./src/lib/db-client.ts');
        try{console.log(JSON.stringify(await (m.importDocumentMediaBatch??m.default.importDocumentMediaBatch)('editor',${JSON.stringify(input)})))}
        finally{await (db.closePool??db.default.closePool)()}`;
      const output=execFileSync(process.execPath,['--conditions=react-server','--import','tsx','--input-type=module','-e',code],
        {cwd:process.cwd(),env,windowsHide:true,timeout:15000,encoding:'utf8'});
      const restored=JSON.parse(output.trim().split(/\r?\n/).at(-1)!);
      expect(restored.items[0].placementId).not.toBe(removed.placementId);
      expect((await query('SELECT status FROM wujie_workspace_placements WHERE id=$1',[removed.placementId])).rows[0].status).toBe('trashed');
      const restoredId=restored.items[0].placementId;
      await executeDocumentAssetCommand({actorId:'owner',projectId:'target',idempotencyKey:'owner-delete-again',
        command:{action:'remove',placementId:restoredId,expectedAssetVersionId:'source-v'}});
      const before=await counts(query);await expect(importDocumentMediaBatch('editor',input)).rejects.toThrow();expect(await counts(query)).toEqual(before);
    });
  },30_000);
  it('scoped compliance writer uses owner namespace while retaining canonical content/checksum/source trace',async()=>{
    await withIsolatedPostgres('skill-compliance',async({query})=>{
      await seed(query);
      await query(`UPDATE wujie_agent_events SET payload=jsonb_set(payload,'{skillSnapshot,id}','"preset-platform-compliance-audit"') WHERE event_type='run.created'`);
      const scope=await assetScope();
      const report=parsePlatformComplianceReport(validReport({runId:'run',sourceVersionId:'source-v',reportId:'compliance:run:export'}));
      const canonical=canonicalComplianceReportJson(report);
      const version=await persistComplianceReportAsset({actorUserId:'editor',projectId:'target',runId:'run',stepId:'export',report,
        sourceVersionIds:['source-v'],sourceTrace:{source:'canvas-skill',runId:'run',skillId:'preset-platform-compliance-audit',skillVersion:1,
          sourceVersionIds:['source-v'],createdAt:new Date().toISOString()},idempotencyKey:'step-key:report-asset:completed',requestDigest:'step-digest',assetService:scope.assetService});
      expect(version.ownerId).toBe('owner');expect(version.metadata?.reportContent).toBe(canonical);
      expect(version.file.checksum).toBe(createHash('sha256').update(canonical).digest('hex'));
      await outputs(query,[version.id]);expect((await resolveSkillRunAssets({actorUserId:'editor',projectId:'target',runId:'run',assetVersionIds:[version.id]})).references[0].kind).toBe('document');
      auth.getSessionUser.mockResolvedValue(actor);
      const download=()=>reportDownload(new NextRequest('http://localhost'+version.file.url),{params:Promise.resolve({runId:'run',stepId:'export'})});
      expect(await (await download()).text()).toBe(canonical);
      await query("UPDATE wujie_project_document_editors SET status='revoked'");
      await expect(download()).rejects.toThrow();
    });
  },30_000);
  it('restores owner-deleted geometry, live groups and new annotation identities with real mask/overlay preparation',async()=>{
    await withIsolatedPostgres('skill-restore-metadata',async({query})=>{
      await seed(query);await outputs(query,['source-v']);
      const initial=await importDocumentMediaBatch('editor',batch('initial',['source-v']));
      const placementId=initial.items[0].placementId;
      const loaded=await loadDocument('target'),vector=Y.encodeStateVector(loaded.doc);
      loaded.doc.transact(()=>{
        loaded.doc.getMap('transforms').set(placementId,{x:12,y:24,width:50,height:40,rotation:15,zIndex:4});
        loaded.doc.getMap('groups').set(placementId,'group');
        loaded.doc.getMap('annotations').set(placementId,'owner-note');
        loaded.doc.getMap('groupDefinitions').set('group',{id:'group',name:'Owner group',note:'note',imageIds:[placementId]});
        loaded.doc.getMap('annotationRecords').set('annotation',{id:'annotation',projectId:'target',sourceImageId:placementId,
          sourceVersionId:'source-v',type:'region',geometry:{kind:'region',region:{x:0,y:0,w:1,h:1}},status:'ready',
          createdAt:1,updatedAt:1,maskAssetId:'source-a',overlayAssetId:'source-a',label:'region'});
      });
      const bytes=Y.encodeStateAsUpdate(loaded.doc,vector);loaded.doc.destroy();
      await commitDocumentUpdate({actorId:'owner',projectId:'target',bytes});
      const removed=await executeDocumentAssetCommand({actorId:'owner',projectId:'target',idempotencyKey:'owner-remove-meta',
        command:{action:'remove',placementId,expectedAssetVersionId:'source-v'}});
      const input={...batch('restore-meta',['source-v']),items:[{sourceVersionId:'source-v',command,
        restore:{placementId,expectedRemovalSequence:removed.documentSequence}}]};
      const before=await counts(query);
      await expect(importDocumentMediaBatch('editor',{...input,items:[{...input.items[0],restore:{placementId,expectedRemovalSequence:removed.documentSequence+1}}]})).rejects.toThrow();
      expect(await counts(query)).toEqual(before);
      const result=await importDocumentMediaBatch('editor',input),current=await loadDocument('target');
      try {
        const state=readCanvasDocument(current.doc),newId=result.items[0].placementId;
        expect(state.placements[newId]).toMatchObject({x:12,y:24,width:50,height:40,rotation:15,zIndex:4,groupId:'group',annotation:'owner-note'});
        expect(state.placements[placementId].deleted).toBe(true);
        expect(state.groupDefinitions?.group.imageIds).toContain(newId);
        const annotation=Object.values(state.annotationRecords??{}).find(a=>a.sourceImageId===newId);
        expect(annotation).toMatchObject({sourceVersionId:'source-v',maskAssetId:'source-a',overlayAssetId:'source-a',label:'region'});
        expect(annotation?.id).not.toBe('annotation');expect(state.annotationTombstones?.annotation).toBe(true);
      }finally{current.doc.destroy();}
    });
  },30_000);
  it('keeps ready video output in the same atomic delivery without copying versions',async()=>{
    await withIsolatedPostgres('skill-ready-video',async({query})=>{
      await seed(query);await second(query);
      const video=Buffer.from(await readFile('tests/fixtures/yjs-task8b1-tiny-valid.mp4.base64','utf8'),'base64');
      const filename=path.join(root,'images/skill-video.mp4');await writeFile(filename,video);
      try {
        await query("UPDATE wujie_assets SET kind='video' WHERE id='second-a'");
        await query(`UPDATE wujie_asset_versions SET file_url='/api/serve-upload/images/skill-video.mp4',mime_type='video/mp4',
          byte_size=$1,checksum=$2,width=16,height=16 WHERE id='second-v'`,[video.length,createHash('sha256').update(video).digest('hex')]);
        await outputs(query,['source-v','second-v']);const result=await importDocumentMediaBatch('editor',batch('video'));
        expect(result.items.map(item=>item.assetReference.kind)).toEqual(['image','video']);
        expect((await query('SELECT count(*)::int AS n FROM wujie_asset_versions')).rows[0].n).toBe(2);
      }finally{await rm(filename,{force:true});}
    });
  },30_000);
  it('genuine personal run retains actor namespace and rejects a foreign project without document fallback',async()=>{
    await withIsolatedPostgres('skill-private-compat',async({query})=>{
      await seed(query);await query('DELETE FROM wujie_canvas_task_publications');
      await query('UPDATE wujie_project_document_settings SET enabled=false');
      await query("UPDATE cloud_tasks SET user_id='owner';UPDATE wujie_agent_events SET owner_id='owner';UPDATE wujie_agent_execution_leases SET owner_id='owner';UPDATE wujie_agent_downstream_operations SET owner_id='owner'");
      await query(`INSERT INTO wujie_agent_events(event_id,task_id,owner_id,project_id,workspace,sequence,event_type,request_digest,payload,created_at)
        VALUES('private-output','run','owner','target','canvas',10,'asset.created','private','{"assetVersionId":"source-v"}',2)`);
      expect((await resolveSkillRunAssets({actorUserId:'owner',projectId:'target',runId:'run',assetVersionIds:['source-v']})).references[0].placementState).toBeUndefined();
      expect((await createProductionSkillStepRegistry({actor:{...actor,id:'owner'},request}).stepAdapters.multi_platform_export({...step(),actorUserId:'owner'})).assetVersionIds.length).toBeGreaterThanOrEqual(2);
      await expect(resolveSkillRunAssets({actorUserId:'editor',projectId:'target',runId:'run',assetVersionIds:['source-v']})).rejects.toThrow();
    });
  },30_000);
});
