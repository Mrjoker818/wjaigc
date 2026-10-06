import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';
import type { AgentEvent, AgentRunRequest } from '@/lib/agent-runtime/types';

vi.mock('server-only', () => ({}));

it('uses actual upload placement identity for owner/editor source, visible, selected and real service billing; rejects disguised orphan', async () => {
  const prefix = path.resolve(tmpdir(), 'wujie-context-upload-');
  const mediaRoot = await mkdtemp(prefix);
  vi.stubEnv('WUJIE_DATA_DIR', mediaRoot);
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
  try {
    // Runtime imports can cache the data root; bind the isolated root first.
    const { getServerDataRoot } = await import('@/lib/server-data-root');
    expect(path.resolve(getServerDataRoot())).toBe(path.resolve(mediaRoot));
    const { importDocumentUpload } = await import('@/lib/collaboration/document-media-import');
    const { authorizeAgentContext } = await import('@/lib/agent-runtime/context-adapters');
    const { createAgentRuntimeService } = await import('@/lib/agent-runtime/service');
    const { createBillableTask } = await import('@/lib/task-core/billing-service');
    const { ensureCoreTables } = await import('@/lib/db-storage');
    await withIsolatedPostgres('context-real-upload', async ({ query, databaseUrl }) => {
      const migration = spawnSync(process.execPath, [path.resolve('scripts/run-migrations.mjs')], {
        encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
      });
      console.info('Full migrations:', migration.status, migration.stdout, migration.stderr);
      expect(migration.status).toBe(0);
      await ensureCoreTables();
      await query(`INSERT INTO wujie_users(id,name,password_hash,status,created_at,updated_at)
        VALUES ('owner','Owner','test','active',1,1),('editor','Editor','test','active',1,1)`);
      await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
      await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
      await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
      await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
        VALUES ('credits-editor','editor',100,100,0,1,1),('credits-owner','owner',100,100,0,1,1)`);
      const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#d4af37' } }).png().toBuffer();
      const input = { projectId: 'shared', idempotencyKey: 'real-upload', filename: 'source.png',
        command: { action: 'attach', transform: { x: 10, y: 20, width: 32, height: 24, rotation: 0, zIndex: 1 } } };
      const imported = await importDocumentUpload('editor', new Request('http://localhost/upload', {
        method: 'POST', body: new Uint8Array(bytes), headers: { 'content-type': 'image/png',
          'x-wujie-asset-import': Buffer.from(JSON.stringify(input)).toString('base64url') },
      }));
      const placement = (await query<{ id: string; entity_id: string }>(
        'SELECT id,entity_id FROM wujie_workspace_placements WHERE id=$1', [imported.placementId])).rows[0];
      const document = (await query<{ projection: { placements: Record<string, { assetVersionId: string }> } }>(
        "SELECT projection FROM wujie_project_canvas_documents WHERE project_id='shared'")).rows[0];
      expect(placement.id).not.toBe(placement.entity_id);
      expect(document.projection.placements[placement.id]?.assetVersionId).toBe(imported.assetVersionId);
      expect(document.projection.placements[placement.entity_id]).toBeUndefined();
      const request: AgentRunRequest = {
        projectId: 'shared', workspace: 'canvas', workspaceId: 'canvas:shared', mode: 'agent',
        providerId: 'provider', modelId: 'model', prompt: 'Use uploaded image', idempotencyKey: 'upload-run',
        allowedToolIds: ['generate_image'], sourceVersionIds: [],
        context: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' },
      };
      const inputs: AgentRunRequest[] = [
        { ...request, sourceVersionIds: [imported.assetVersionId] },
        { ...request, context: { ...request.context, visibleVersionIds: [imported.assetVersionId] } },
        { ...request, sourceVersionIds: [imported.assetVersionId], context: { ...request.context, selectedEntityIds: [placement.entity_id] } },
      ];
      for (const actorUserId of ['owner', 'editor']) for (const candidate of inputs) {
        const authorized = await authorizeAgentContext({ actorUserId, request: candidate });
        expect(authorized.projectAccess).toEqual({ kind: 'document', actorUserId, ownerId: 'owner', projectId: 'shared',
          grantGeneration: actorUserId === 'owner' ? '0' : '1' });
        expect(authorized.mediaByVersionId[imported.assetVersionId]).toBeTruthy();
        if (candidate.context.selectedEntityIds.length) {
          expect(authorized.selectedEntityVersionIds[placement.entity_id]).toBe(imported.assetVersionId);
        }
      }
      for (const actorUserId of ['owner', 'editor']) {
        await expect(authorizeAgentContext({ actorUserId, request: {
          ...request, context: { ...request.context, selectedEntityIds: [placement.entity_id] },
        } })).rejects.toMatchObject({ code: 'AGENT_CONTEXT_NOT_FOUND', status: 404 });
      }
      const events: AgentEvent[] = [];
      const service = createAgentRuntimeService({
        authorizeContext: authorizeAgentContext, createBillableTask,
        randomUUID: () => 'upload-agent-task', now: () => 1, calculateCreditCost: async () => 7,
        resolveTaskModel: async () => ({ providerId: 'provider', modelId: 'model', kind: 'chat', sourceType: 'chat',
          protocol: 'chat-completions', executionMode: 'sync', allowedRatios: [], allowedSizes: [], qualityOptions: [],
          maxOutputs: 1, supportsReferenceImages: false, supportsMask: false, outputKinds: ['text'], capabilitySources: {} }),
        appendEvent: async event => {
          const saved: AgentEvent = { eventId: event.eventId, runId: event.runId, type: event.type,
            payload: event.payload, sequence: 1, timestamp: new Date(1).toISOString() };
          events.push(saved); return saved;
        },
        listEvents: async () => events, listRunEventStreams: async () => [],
        getTaskForUser: async () => { throw new Error('Unused boundary'); },
        transitionTask: async () => { throw new Error('Unused boundary'); },
        settleFailedTask: async () => { throw new Error('Unexpected event failure'); }, abortTaskExecution: () => false,
      });
      const outcome = await service.createRun({
        actor: { id: 'editor', name: 'Editor', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 },
        request: { ...inputs[2], sourceVersionIds: [imported.assetVersionId] },
      });
      expect(outcome.charged).toBe(true);
      expect((await query('SELECT task_id,actor_id,owner_id,grant_generation::text FROM wujie_canvas_task_publications')).rows)
        .toEqual([{ task_id: 'upload-agent-task', actor_id: 'editor', owner_id: 'owner', grant_generation: '1' }]);
      expect((await query('SELECT user_id,balance FROM wujie_credits ORDER BY user_id')).rows)
        .toEqual([{ user_id: 'editor', balance: 93 }, { user_id: 'owner', balance: 100 }]);
      expect((await query("SELECT projection FROM wujie_project_canvas_documents WHERE project_id='shared'")).rows[0]).toEqual(document);

      // Same version, but only an unshared placement remains; entity_id impersonates the canonical key.
      await query("UPDATE wujie_workspace_placements SET status='trashed',deleted_at=now() WHERE id=$1", [placement.id]);
      await query(`INSERT INTO wujie_workspace_placements
        (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
        SELECT 'disguised-orphan',owner_id,project_id,asset_id,asset_version_id,'canvas',workspace_id,'canvas-image',id
        FROM wujie_workspace_placements WHERE id=$1`, [placement.id]);
      for (const actorUserId of ['owner', 'editor']) for (const candidate of [inputs[0], inputs[1],
        { ...request, sourceVersionIds: [imported.assetVersionId], context: { ...request.context, selectedEntityIds: [placement.id] } }]) {
        await expect(authorizeAgentContext({ actorUserId, request: candidate })).rejects.toMatchObject({
          code: 'AGENT_CONTEXT_NOT_FOUND', status: 404,
        });
      }
    });
  } finally {
    vi.unstubAllEnvs();
    const target = path.resolve(mediaRoot);
    if (!path.isAbsolute(target) || !target.startsWith(prefix) || path.dirname(target) !== path.resolve(tmpdir())) {
      throw new Error('Refusing unexpected temporary directory cleanup');
    }
    await rm(target, { recursive: true, force: true });
  }
}, 60_000);
