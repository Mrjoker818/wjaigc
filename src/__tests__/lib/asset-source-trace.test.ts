import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { AssetService } from '@/lib/asset-core/service';
import type { AssetStorage, AssetStorageTransaction } from '@/lib/asset-core/storage';
import type { WorkspaceSourceTrace } from '@/lib/asset-core/source-trace';

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

describe('asset source trace propagation', () => {
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

    expect(routeSource).toContain("parseWorkspaceSourceTrace(body.metadata?.sourceTrace)");
    expect(routeSource).toMatch(/\.\.\.\(sourceTrace\s*\?\s*\{ sourceTrace \}\s*:\s*\{\}\)/);
    const successResponse = routeSource.slice(
      routeSource.indexOf('const sourceTrace = parseWorkspaceSourceTrace'),
      routeSource.indexOf('\n  } catch (error)', routeSource.indexOf('const sourceTrace = parseWorkspaceSourceTrace')),
    );
    expect(successResponse).not.toMatch(/metadata\s*:/);
  });
});
