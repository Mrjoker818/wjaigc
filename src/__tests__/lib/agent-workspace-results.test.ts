import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createAgentWorkspaceResultProjector,
  type ProjectAgentResultToWorkspaceInput,
} from '@/lib/agent-runtime/workspace-results';
import type { ProjectCompletedTaskInput } from '@/lib/asset-core/task-projector';
import {
  applyWorkspaceResultToCurrentProject,
  isWorkspaceResultScopeCurrent,
} from '@/lib/asset-core/workspace-transfer';

const input: ProjectAgentResultToWorkspaceInput = {
  actorUserId: 'user-1',
  taskId: 'task-1',
  targetProjectId: 'project-1',
  workspace: 'workflow',
  workspaceId: 'workflow:project-1',
  sourceEntityId: 'chat-message-1',
  parentVersionIds: ['chat-version-1', 'canvas-version-2'],
  idempotencyKey: 'chat-canvas-workflow-1',
};

describe('Agent result workspace projection', () => {
  it('returns canonical asset and placement references from the completed task projection', async () => {
    const calls: ProjectCompletedTaskInput[] = [];
    const completed: Array<{
      actorUserId: string;
      taskId: string;
      versionIds: string[];
      references: Array<{ assetVersionId?: string; placementId?: string; url: string }>;
    }> = [];
    const project = createAgentWorkspaceResultProjector(async (request) => {
      calls.push(structuredClone(request));
      return {
        versions: [{
          id: 'version-result-1',
          assetId: 'asset-result-1',
          ownerId: request.actorUserId,
          projectId: request.targetProjectId,
          file: { url: '/uploads/result-1.png', availability: 'ready' },
          parentVersionIds: [...request.parentVersionIds],
          taskId: request.taskId,
          createdAt: '2026-08-18T00:00:00.000Z',
        }],
        placements: [{ id: 'placement-result-1', entityId: 'chat-message-1:0' }],
        reused: false,
      };
    }, async (record) => { completed.push(structuredClone(record)); });

    await expect(project(input)).resolves.toEqual([{
      assetId: 'asset-result-1',
      assetVersionId: 'version-result-1',
      placementId: 'placement-result-1',
      entityId: 'chat-message-1:0',
      url: '/uploads/result-1.png',
    }]);
    expect(calls).toEqual([input]);
    expect(completed).toEqual([{
      actorUserId: 'user-1',
      taskId: 'task-1',
      versionIds: ['version-result-1'],
      references: [{
        assetId: 'asset-result-1',
        assetVersionId: 'version-result-1',
        placementId: 'placement-result-1',
        entityId: 'chat-message-1:0',
        url: '/uploads/result-1.png',
      }],
    }]);
  });

  it('drops a late result after the active project changes', async () => {
    let activeProjectId = 'project-1';
    let complete!: (value: string) => void;
    const pending = new Promise<string>((resolvePending) => { complete = resolvePending; });
    const apply = vi.fn();
    const result = applyWorkspaceResultToCurrentProject({
      expectedProjectId: 'project-1',
      getCurrentProjectId: () => activeProjectId,
      load: () => pending,
      apply,
    });

    activeProjectId = 'project-2';
    complete('late-project-1-result');

    await expect(result).resolves.toBe('stale');
    expect(apply).not.toHaveBeenCalled();
    expect(isWorkspaceResultScopeCurrent('project-1', activeProjectId)).toBe(false);
  });

  it('wires the same project scope guard into all three result surfaces', () => {
    const paths = [
      'src/components/canvas-workspace.tsx',
      'src/components/node-editor.tsx',
      'src/components/simple-chat/chat-area.tsx',
    ];
    for (const path of paths) {
      const component = readFileSync(resolve(process.cwd(), path), 'utf8');
      expect(component).toContain('isWorkspaceResultScopeCurrent(');
    }
    const canvas = readFileSync(
      resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
      'utf8',
    );
    expect(canvas).toContain('extractTaskAssetReferences(resultRecord)');
  });
});
