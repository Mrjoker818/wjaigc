import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { AssetService } from '@/lib/asset-core/service';
import type { AssetStorage, AssetStorageTransaction } from '@/lib/asset-core/storage';
import type { WorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import { parseWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';

const sourceTraceFixture: WorkspaceSourceTrace = {
  source: 'simple-chat',
  chatProjectId: 'chat-project-1',
  chatTaskId: 'chat-task-1',
  messageId: 'message-1',
  modelId: 'image-model-1',
  providerId: 'image-provider-1',
  generationTaskIds: ['generation-task-1'],
  createdAt: '2026-08-27T08:00:00.000Z',
};

const canvasSkillTraceFixture: WorkspaceSourceTrace = {
  source: 'canvas-skill', runId: 'run-1', skillId: 'skill-000000000000000000000001',
  skillVersion: 3, sourceVersionIds: ['source-a', 'source-b'],
  modelBindings: {
    orchestrator: { providerId: 'provider-chat', modelId: 'model-chat' },
    image: { providerId: 'provider-image', modelId: 'model-image' },
  },
  createdAt: '2026-09-02T00:00:00.000Z',
};

describe('asset source trace propagation', () => {
  it('retains only bounded sketch paired-version provenance and freezes the local received-time hint', () => {
    const trace = { source: 'sketch-to-code', taskId: 'sketch-1', projectId: 'project-1',
      previewAssetVersionId: 'preview-1', htmlAssetVersionId: 'html-1', createdAt: '2026-10-09T00:00:00.000Z' };
    const parsed = parseWorkspaceSourceTrace({ ...trace, html: '<script>secret</script>', apiKey: 'secret' });
    expect(parsed).toEqual(trace);
    expect(Object.isFrozen(parsed)).toBe(true);
    for (const key of ['taskId', 'projectId', 'previewAssetVersionId', 'htmlAssetVersionId']) {
      expect(parseWorkspaceSourceTrace({ ...trace, [key]: 'bad id' })).toBeUndefined();
      expect(parseWorkspaceSourceTrace({ ...trace, [key]: 'x'.repeat(201) })).toBeUndefined();
    }
    expect(parseWorkspaceSourceTrace({ ...trace, createdAt: 'invalid' })).toBeUndefined();
  });
  it('strictly validates and freezes Canvas Skill traces while retaining simple-chat compatibility', () => {
    const parsed = parseWorkspaceSourceTrace({
      ...canvasSkillTraceFixture,
      sourceVersionIds: ['source-a', 'source-a', 'source-b'],
      privateValue: 'drop-me',
    });
    expect(parsed).toEqual(canvasSkillTraceFixture);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed && 'sourceVersionIds' in parsed ? parsed.sourceVersionIds : [])).toBe(true);
    expect(parseWorkspaceSourceTrace({ ...canvasSkillTraceFixture, skillVersion: 0 })).toBeUndefined();
    expect(parseWorkspaceSourceTrace({ ...canvasSkillTraceFixture, sourceVersionIds: ['bad id'] })).toBeUndefined();
    expect(parseWorkspaceSourceTrace(sourceTraceFixture)).toEqual(sourceTraceFixture);
  });

  it('resolves Canvas Skill trace from authoritative version metadata without a placement id', async () => {
    const transaction = {
      findProject: vi.fn().mockResolvedValue(true),
      findVersion: vi.fn().mockResolvedValue({
        id: 'version-output', assetId: 'asset-output', ownerId: 'user-1', projectId: 'project-1',
        file: { url: '/result.png', availability: 'ready' }, parentVersionIds: ['source-a', 'source-b'],
        metadata: { sourceTrace: { ...canvasSkillTraceFixture, privateValue: 'drop-me' } },
        createdAt: '2026-09-02T00:00:00.000Z',
      }),
      findAsset: vi.fn().mockResolvedValue({
        id: 'asset-output', ownerId: 'user-1', projectId: 'project-1', kind: 'image', status: 'active',
        currentVersionId: 'version-output', createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
      }),
    };
    const storage = { read: async <T>(callback: (tx: typeof transaction) => Promise<T>) => callback(transaction) };
    const service = new AssetService(storage as unknown as AssetStorage);
    await expect(service.resolveAssetReference({
      actorUserId: 'user-1', projectId: 'project-1', assetVersionId: 'version-output',
    })).resolves.toMatchObject({ sourceTrace: canvasSkillTraceFixture });
  });
  it('accepts bounded slash model IDs and rejects control characters', () => {
    const parsed = parseWorkspaceSourceTrace({
      ...sourceTraceFixture,
      modelId: 'vendor/image/model-v2',
      providerId: 'provider\rforged',
    });
    expect(parsed).toMatchObject({
      source: 'simple-chat',
      chatProjectId: sourceTraceFixture.chatProjectId,
      chatTaskId: sourceTraceFixture.chatTaskId,
      messageId: sourceTraceFixture.messageId,
      modelId: 'vendor/image/model-v2',
    });
    expect(parsed).not.toHaveProperty('providerId');
    expect(parseWorkspaceSourceTrace({
      ...sourceTraceFixture,
      modelId: 'x'.repeat(201),
    })).not.toHaveProperty('modelId');
  });

  it('returns only a validated sourceTrace from placement metadata', async () => {
    const transaction = {
      findProject: vi.fn().mockResolvedValue(true),
      findVersion: vi.fn().mockResolvedValue({
        id: 'version-1',
        assetId: 'asset-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        file: { url: '/managed.png', availability: 'ready' },
        parentVersionIds: [],
        createdAt: '2026-08-27T08:00:00.000Z',
      }),
      findAsset: vi.fn().mockResolvedValue({
        id: 'asset-1', ownerId: 'user-1', projectId: 'project-1', kind: 'image', status: 'active',
        currentVersionId: 'version-1', createdAt: '2026-08-27T08:00:00.000Z', updatedAt: '2026-08-27T08:00:00.000Z',
      }),
      findPlacement: vi.fn().mockResolvedValue({
        id: 'placement-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        assetId: 'asset-1',
        assetVersionId: 'version-1',
        workspace: 'chat',
        workspaceId: 'chat-project-1',
        entityType: 'chat-result',
        entityId: 'message-1:0',
        status: 'active',
        deletedAt: null,
        metadata: {
          name: 'Managed image',
          sourceTrace: { ...sourceTraceFixture, privatePlacementValue: 'do-not-return' },
          privatePlacementValue: 'do-not-return',
        },
        createdAt: '2026-08-27T08:00:00.000Z',
        updatedAt: '2026-08-27T08:00:00.000Z',
      }),
    } as unknown as AssetStorageTransaction;
    const storage = {
      read: <T>(callback: (value: AssetStorageTransaction) => Promise<T>) => callback(transaction),
      transaction: vi.fn(),
    } as unknown as AssetStorage;
    const service = new AssetService(storage);

    const reference = await service.resolveAssetReference({
      actorUserId: 'user-1',
      projectId: 'project-1',
      assetVersionId: 'version-1',
      placementId: 'placement-1',
    });

    expect(reference.sourceTrace).toEqual(sourceTraceFixture);
    expect(reference).not.toHaveProperty('metadata');
    expect(reference.sourceTrace).not.toHaveProperty('privatePlacementValue');
  });

  it('sanitizes transfer response provenance without exposing placement metadata', () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), 'src/app/api/assets/transfer/route.ts'),
      'utf8',
    );

    expect(routeSource).toContain('parseWorkspaceSourceTrace(metadata.sourceTrace)');
    expect(routeSource).toMatch(/sendVersionToWorkspace\([\s\S]*?\.\.\.\(metadata\s*\?\s*\{ metadata \}\s*:\s*\{\}\)/);
    expect(routeSource).toMatch(/\.\.\.\(sourceTrace\s*\?\s*\{ sourceTrace \}\s*:\s*\{\}\)/);
    const responseTraceIndex = routeSource.lastIndexOf('const sourceTrace = parseWorkspaceSourceTrace');
    const successResponse = routeSource.slice(
      responseTraceIndex,
      routeSource.indexOf('\n  } catch (error)', responseTraceIndex),
    );
    expect(successResponse).not.toMatch(/metadata\s*:/);
  });
});
