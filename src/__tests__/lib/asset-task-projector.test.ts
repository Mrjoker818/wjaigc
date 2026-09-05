import { describe, expect, it } from 'vitest';

import {
  createTaskAssetProjector,
  type ProjectionTask,
  type TaskProjectionCreateInput,
  type TaskProjectionRepository,
  type TaskProjectionTransaction,
} from '@/lib/asset-core/task-projector';
import type { AssetVersion } from '@/lib/asset-core/types';

function task(overrides: Partial<ProjectionTask> = {}): ProjectionTask {
  return {
    id: 'task-1',
    userId: 'user-1',
    projectId: 'project-1',
    status: 'completed',
    providerId: 'provider-1',
    modelId: 'model-1',
    result: {
      imageUrl: '/api/serve-upload/uploads/result-1.png',
      submissionPayload: {
        prompt: 'blue geometric mark',
        referenceImages: ['source-a', 'source-b'],
      },
    },
    billingTransactionId: 'charge-1',
    ...overrides,
  };
}

class MemoryProjectionRepository implements TaskProjectionRepository {
  readonly versions: AssetVersion[] = [];
  readonly creates: TaskProjectionCreateInput[] = [];
  readonly lateAudits: Array<{ taskId: string; urls: string[]; terminalStatus: string }> = [];
  readonly tasks = new Map<string, ProjectionTask>();

  constructor(initialTask: ProjectionTask) {
    this.tasks.set(initialTask.id, initialTask);
  }

  async transaction<T>(callback: (transaction: TaskProjectionTransaction) => Promise<T>): Promise<T> {
    const transaction: TaskProjectionTransaction = {
      findTaskForUpdate: async (actorUserId, taskId) => {
        const current = this.tasks.get(taskId);
        return current?.userId === actorUserId ? structuredClone(current) : null;
      },
      findProject: async (actorUserId, projectId) => (
        actorUserId === 'user-1' && projectId === 'project-1'
      ),
      findSourceVersions: async (_actorUserId, _projectId, versionIds) => (
        versionIds.map((id) => ({ id, assetId: `asset-${id}` }))
      ),
      createProjection: async (input) => {
        const existing = this.versions.find(version => version.idempotencyKey === input.idempotencyKey);
        if (existing) return {
          version: existing,
          placement: { id: `placement-${existing.id}`, entityId: input.entityId },
          reused: true,
        };
        this.creates.push(structuredClone(input));
        const version: AssetVersion = {
          id: `version-${this.versions.length + 1}`,
          assetId: `asset-${this.versions.length + 1}`,
          ownerId: input.actorUserId,
          projectId: input.projectId,
          file: input.file,
          parentVersionIds: [...input.parentVersionIds],
          taskId: input.taskId,
          idempotencyKey: input.idempotencyKey,
          createdAt: '2026-08-11T00:00:00.000Z',
        };
        this.versions.push(version);
        return {
          version,
          placement: { id: `placement-${version.id}`, entityId: input.entityId },
          reused: false,
        };
      },
      recordLateResultAudit: async (input) => {
        this.lateAudits.push({
          taskId: input.taskId,
          urls: [...input.urls],
          terminalStatus: input.terminalStatus,
        });
      },
    };
    return callback(transaction);
  }
}

function projector(repository: TaskProjectionRepository) {
  return createTaskAssetProjector(repository);
}

describe('completed task asset projection', () => {
  it('projects only an authoritative completed task into an immutable version and placement', async () => {
    const repository = new MemoryProjectionRepository(task());

    const result = await projector(repository).projectCompletedTaskToAssets({
      actorUserId: 'user-1',
      taskId: 'task-1',
      targetProjectId: 'project-1',
      workspace: 'canvas',
      sourceEntityId: 'canvas-result-1',
      parentVersionIds: [],
    });

    expect(result.reused).toBe(false);
    expect(result.versions).toHaveLength(1);
    expect(result.placements).toEqual([{
      id: 'placement-version-1',
      entityId: 'canvas-result-1:0',
    }]);
    expect(repository.creates[0]).toMatchObject({
      taskId: 'task-1',
      outputIndex: 0,
      projectId: 'project-1',
      workspace: 'canvas',
      workspaceId: 'project-1',
      entityType: 'canvas-image',
      entityId: 'canvas-result-1:0',
      file: { url: '/api/serve-upload/uploads/result-1.png', availability: 'ready' },
    });
  });

  it('preserves authoritative per-image dimensions in the projected AssetVersion file', async () => {
    const repository = new MemoryProjectionRepository(task({
      result: {
        imageUrl: '/api/serve-upload/uploads/result-1.png',
        imageUrls: ['/api/serve-upload/uploads/result-1.png'],
        images: [{
          url: '/api/serve-upload/uploads/result-1.png',
          width: 1254,
          height: 1254,
          mimeType: 'image/png',
          byteSize: 456789,
        }],
      },
    }));

    const result = await projector(repository).projectCompletedTaskToAssets({
      actorUserId: 'user-1',
      taskId: 'task-1',
      targetProjectId: 'project-1',
      workspace: 'workflow',
      workspaceId: 'workflow:workflow-1',
      sourceEntityId: 'skill-node-1',
      parentVersionIds: [],
    });

    expect(result.versions[0]?.file).toMatchObject({
      url: '/api/serve-upload/uploads/result-1.png',
      width: 1254,
      height: 1254,
      mimeType: 'image/png',
      byteSize: 456789,
    });
  });

  it('carries Canvas Skill trace into authoritative version and placement creation', async () => {
    const repository = new MemoryProjectionRepository(task());
    const sourceTrace = {
      source: 'canvas-skill' as const, runId: 'run-1', skillId: 'preset-concept-art',
      skillVersion: 1, sourceVersionIds: ['source-a'], createdAt: '2026-09-02T00:00:00.000Z',
    };
    await projector(repository).projectCompletedTaskToAssets({
      actorUserId: 'user-1', taskId: 'task-1', targetProjectId: 'project-1', workspace: 'canvas',
      parentVersionIds: ['source-a'], sourceTrace,
    });
    expect(repository.creates[0]).toMatchObject({ parentVersionIds: ['source-a'], sourceTrace });
  });

  it.each(['failed', 'cancelled', 'timeout'] as const)(
    'does not create assets for %s and records a late-result audit when a URL exists',
    async (status) => {
      const repository = new MemoryProjectionRepository(task({ status }));

      const result = await projector(repository).projectCompletedTaskToAssets({
        actorUserId: 'user-1',
        taskId: 'task-1',
        targetProjectId: 'project-1',
        workspace: 'canvas',
        parentVersionIds: [],
      });

      expect(result).toEqual({ versions: [], placements: [], reused: false });
      expect(repository.creates).toHaveLength(0);
      expect(repository.lateAudits).toEqual([{
        taskId: 'task-1',
        urls: ['/api/serve-upload/uploads/result-1.png'],
        terminalStatus: status,
      }]);
    },
  );

  it('reuses the same task output projection on replay', async () => {
    const repository = new MemoryProjectionRepository(task());
    const input = {
      actorUserId: 'user-1',
      taskId: 'task-1',
      targetProjectId: 'project-1',
      workspace: 'canvas' as const,
      parentVersionIds: [],
    };

    const first = await projector(repository).projectCompletedTaskToAssets(input);
    const replay = await projector(repository).projectCompletedTaskToAssets(input);

    expect(first.reused).toBe(false);
    expect(replay.reused).toBe(true);
    expect(replay.versions.map(version => version.id)).toEqual(
      first.versions.map(version => version.id),
    );
    expect(repository.creates).toHaveLength(1);
  });

  it('keeps the immutable version identity stable across workspace placements', async () => {
    const canvasRepository = new MemoryProjectionRepository(task());
    const chatRepository = new MemoryProjectionRepository(task());

    await projector(canvasRepository).projectCompletedTaskToAssets({
      actorUserId: 'user-1',
      taskId: 'task-1',
      targetProjectId: 'project-1',
      workspace: 'canvas',
      sourceEntityId: 'canvas-result-1',
      parentVersionIds: [],
    });
    await projector(chatRepository).projectCompletedTaskToAssets({
      actorUserId: 'user-1',
      taskId: 'task-1',
      targetProjectId: 'project-1',
      workspace: 'chat',
      workspaceId: 'standalone-chat:conversation-1',
      sourceEntityId: 'message-1',
      parentVersionIds: [],
    });

    expect(chatRepository.creates[0].idempotencyKey).toBe(
      canvasRepository.creates[0].idempotencyKey,
    );
    expect(chatRepository.creates[0].requestDigest).toBe(
      canvasRepository.creates[0].requestDigest,
    );
  });

  it('creates one immutable version per output and preserves output order', async () => {
    const repository = new MemoryProjectionRepository(task({
      result: {
        imageUrl: '/api/serve-upload/uploads/result-1.png',
        imageUrls: [
          '/api/serve-upload/uploads/result-1.png',
          '/api/serve-upload/uploads/result-2.png',
          '/api/serve-upload/uploads/result-3.png',
        ],
      },
    }));

    const result = await projector(repository).projectCompletedTaskToAssets({
      actorUserId: 'user-1',
      taskId: 'task-1',
      targetProjectId: 'project-1',
      workspace: 'workflow',
      workspaceId: 'workflow:project-1',
      sourceEntityId: 'node-output-1',
      parentVersionIds: [],
    });

    expect(result.versions).toHaveLength(3);
    expect(repository.creates.map(item => [item.outputIndex, item.file.url, item.entityId])).toEqual([
      [0, '/api/serve-upload/uploads/result-1.png', 'node-output-1:0'],
      [1, '/api/serve-upload/uploads/result-2.png', 'node-output-1:1'],
      [2, '/api/serve-upload/uploads/result-3.png', 'node-output-1:2'],
    ]);
  });

  it.each([
    ['video', { videoUrl: '/uploads/result.mp4', imageUrl: '/uploads/cover.png' }, '/uploads/result.mp4'],
    ['3d-model', { assetUrl: '/uploads/result.glb', imageUrl: '/uploads/cover.png' }, '/uploads/result.glb'],
  ] as const)('projects the primary %s artifact instead of its preview image', async (
    type,
    result,
    expectedUrl,
  ) => {
    const repository = new MemoryProjectionRepository(task({ type, result }));

    await projector(repository).projectCompletedTaskToAssets({
      actorUserId: 'user-1',
      taskId: 'task-1',
      targetProjectId: 'project-1',
      workspace: 'canvas',
      parentVersionIds: [],
    });

    expect(repository.creates[0].file.url).toBe(expectedUrl);
  });

  it('projects nested image-edit result objects in their returned order', async () => {
    const repository = new MemoryProjectionRepository(task({
      type: 'edit',
      result: {
        image: { url: '/uploads/edit-1.png' },
        images: [
          { url: '/uploads/edit-1.png' },
          { url: '/uploads/edit-2.png' },
        ],
      },
    }));

    await projector(repository).projectCompletedTaskToAssets({
      actorUserId: 'user-1',
      taskId: 'task-1',
      targetProjectId: 'project-1',
      workspace: 'workflow',
      parentVersionIds: [],
    });

    expect(repository.creates.map(item => item.file.url)).toEqual([
      '/uploads/edit-1.png',
      '/uploads/edit-2.png',
    ]);
  });

  it('records provider, model, parameters, billing transaction, and ordered source versions', async () => {
    const repository = new MemoryProjectionRepository(task());

    await projector(repository).projectCompletedTaskToAssets({
      actorUserId: 'user-1',
      taskId: 'task-1',
      targetProjectId: 'project-1',
      workspace: 'chat',
      workspaceId: 'standalone-chat:conversation-1',
      sourceEntityId: 'message-1',
      parentVersionIds: ['source-version-b', 'source-version-a'],
    });

    expect(repository.creates[0]).toMatchObject({
      providerId: 'provider-1',
      modelId: 'model-1',
      billingTransactionId: 'charge-1',
      parameters: {
        prompt: 'blue geometric mark',
        referenceImages: ['source-a', 'source-b'],
      },
      parentVersionIds: ['source-version-b', 'source-version-a'],
      projectionMode: 'derived',
      entityType: 'chat-result',
    });
  });

  it('keeps a single reference version as lineage without revising the source asset by default', async () => {
    const repository = new MemoryProjectionRepository(task());

    await projector(repository).projectCompletedTaskToAssets({
      actorUserId: 'user-1',
      taskId: 'task-1',
      targetProjectId: 'project-1',
      workspace: 'canvas',
      parentVersionIds: ['source-version-a'],
    });

    expect(repository.creates[0]).toMatchObject({
      projectionMode: 'derived',
      parentVersionIds: ['source-version-a'],
    });
  });

  it('allows an explicit single-output revision to update its source asset', async () => {
    const repository = new MemoryProjectionRepository(task());

    await projector(repository).projectCompletedTaskToAssets({
      actorUserId: 'user-1',
      taskId: 'task-1',
      targetProjectId: 'project-1',
      workspace: 'canvas',
      parentVersionIds: ['source-version-a'],
      projectionMode: 'revision',
    });

    expect(repository.creates[0].projectionMode).toBe('revision');
  });

  it('uses a different projection digest for derived and revision semantics', async () => {
    const derivedRepository = new MemoryProjectionRepository(task());
    const revisionRepository = new MemoryProjectionRepository(task());
    const common = {
      actorUserId: 'user-1',
      taskId: 'task-1',
      targetProjectId: 'project-1',
      workspace: 'canvas' as const,
      parentVersionIds: ['source-version-a'],
    };

    await projector(derivedRepository).projectCompletedTaskToAssets({
      ...common,
      projectionMode: 'derived',
    });
    await projector(revisionRepository).projectCompletedTaskToAssets({
      ...common,
      projectionMode: 'revision',
    });

    expect(derivedRepository.creates[0].idempotencyKey).toBe(
      revisionRepository.creates[0].idempotencyKey,
    );
    expect(derivedRepository.creates[0].requestDigest).not.toBe(
      revisionRepository.creates[0].requestDigest,
    );
  });

  it('rejects completed tasks without a projectable result instead of silently succeeding', async () => {
    const repository = new MemoryProjectionRepository(task({ result: { submissionPayload: {} } }));

    await expect(projector(repository).projectCompletedTaskToAssets({
      actorUserId: 'user-1',
      taskId: 'task-1',
      targetProjectId: 'project-1',
      workspace: 'canvas',
      parentVersionIds: [],
    })).rejects.toThrow('TASK_PROJECTION_MISSING_RESULT');
  });

  it('fails closed when the task or target project is not owned by the actor', async () => {
    const repository = new MemoryProjectionRepository(task({ userId: 'user-2' }));

    await expect(projector(repository).projectCompletedTaskToAssets({
      actorUserId: 'user-1',
      taskId: 'task-1',
      targetProjectId: 'project-1',
      workspace: 'canvas',
      parentVersionIds: [],
    })).rejects.toThrow('TASK_PROJECTION_NOT_FOUND');
    expect(repository.creates).toHaveLength(0);
  });
});
