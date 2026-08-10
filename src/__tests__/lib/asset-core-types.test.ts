import { describe, expect, it } from 'vitest';

import {
  assertWorkspaceEntityType,
  isTerminalMediaAvailability,
  type WorkspaceEntityTypeFor,
  type WorkspacePlacement,
} from '@/lib/asset-core/types';
import { resolveAssetGraphMode } from '@/lib/asset-core/mode';

describe('asset core domain invariants', () => {
  it('defaults the graph mode to legacy and accepts only staged modes', () => {
    expect(resolveAssetGraphMode(undefined)).toBe('legacy');
    expect(resolveAssetGraphMode('shadow')).toBe('shadow');
    expect(resolveAssetGraphMode('asset-v3')).toBe('asset-v3');
    expect(resolveAssetGraphMode('unexpected')).toBe('legacy');
  });

  it('keeps recoverable media availability states non-terminal', () => {
    expect(isTerminalMediaAvailability('missing')).toBe(false);
    expect(isTerminalMediaAvailability('ready')).toBe(true);
    expect(isTerminalMediaAvailability('unrecoverable')).toBe(true);
  });

  it('pairs each workspace with only its supported entity types', () => {
    expect(assertWorkspaceEntityType('canvas', 'canvas-image')).toBe('canvas-image');
    expect(assertWorkspaceEntityType('workflow', 'workflow-input')).toBe('workflow-input');
    expect(assertWorkspaceEntityType('workflow', 'workflow-output')).toBe('workflow-output');
    expect(assertWorkspaceEntityType('chat', 'chat-attachment')).toBe('chat-attachment');
    expect(assertWorkspaceEntityType('chat', 'chat-result')).toBe('chat-result');
    expect(() => assertWorkspaceEntityType('canvas', 'chat-result')).toThrow(
      'Unsupported workspace entity type',
    );
  });

  it('expresses legal workspace and entity pairs in the TypeScript contract', () => {
    const canvasEntity: WorkspaceEntityTypeFor<'canvas'> = 'canvas-image';
    const placement: WorkspacePlacement = {
      id: 'placement-1',
      ownerId: 'owner-1',
      projectId: 'project-1',
      assetId: 'asset-1',
      assetVersionId: 'version-1',
      workspace: 'canvas',
      workspaceId: 'canvas-1',
      entityType: canvasEntity,
      entityId: 'image-1',
      status: 'active',
      deletedAt: null,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };

    expect(placement.entityType).toBe('canvas-image');

    // @ts-expect-error canvas placements cannot be chat results.
    const invalidCanvasEntity: WorkspaceEntityTypeFor<'canvas'> = 'chat-result';
    expect(invalidCanvasEntity).toBe('chat-result');
  });
});
