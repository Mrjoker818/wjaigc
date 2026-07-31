import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cloud-task-storage', () => ({}));
vi.mock('@/lib/element-decomposition/source-snapshot', () => ({ freezeElementSource: vi.fn() }));
vi.mock('@/lib/layer-decomposition/service', () => ({
  submitLayerDecomposition: vi.fn(),
  getLayerTaskStatus: vi.fn(),
  cancelLayerTask: vi.fn(),
}));
vi.mock('@/lib/element-decomposition/board-executor', () => ({
  submitElementBoard: vi.fn(),
  pollElementBoard: vi.fn(),
  cancelElementBoard: vi.fn(),
}));

import {
  deriveElementParentState,
  makeElementBranchKey,
} from '@/lib/element-decomposition/service';

describe('element decomposition partial results', () => {
  it('reports partial completion without replacing the completed sibling', () => {
    const state = deriveElementParentState({
      board: { branch: 'board', taskId: 'board-1', idempotencyKey: 'board-key', status: 'failed', progress: 0 },
      layers: { branch: 'layers', taskId: 'layers-1', idempotencyKey: 'layers-key', status: 'completed', progress: 100 },
    });

    expect(state.status).toBe('completed');
    expect(state.overallStatus).toBe('partial');
    expect(state.progress).toBe(50);
  });

  it('uses branch-specific keys and leaves a completed sibling unchanged on retry', () => {
    const digest = 'd'.repeat(64);
    const sourceHash = 's'.repeat(64);
    expect(makeElementBranchKey('parent', 'board', sourceHash, digest)).toBe(
      `parent:board:${sourceHash}:${digest}`,
    );
    const branches = {
      board: { branch: 'board' as const, taskId: 'board-retry', status: 'processing' as const, progress: 5 },
      layers: { branch: 'layers' as const, taskId: 'layers-complete', status: 'completed' as const, progress: 100 },
    };
    expect(branches.layers.taskId).toBe('layers-complete');
  });

  it.each([
    ['completed', 'cancelled'],
    ['completed', 'timeout'],
    ['cancelled', 'completed'],
    ['timeout', 'completed'],
  ] as const)('maps %s + %s to partial completion', (boardStatus, layerStatus) => {
    const state = deriveElementParentState({
      board: { branch: 'board', taskId: 'board-1', idempotencyKey: 'board-key', status: boardStatus, progress: boardStatus === 'completed' ? 100 : 40 },
      layers: { branch: 'layers', taskId: 'layers-1', idempotencyKey: 'layers-key', status: layerStatus, progress: layerStatus === 'completed' ? 100 : 40 },
    });

    expect(state).toMatchObject({ status: 'completed', overallStatus: 'partial' });
  });

  it.each([
    ['failed', 'cancelled', 'failed'],
    ['cancelled', 'failed', 'failed'],
    ['timeout', 'cancelled', 'timeout'],
    ['cancelled', 'timeout', 'timeout'],
    ['timeout', 'timeout', 'timeout'],
  ] as const)('maps terminal %s + %s deterministically to %s', (boardStatus, layerStatus, expected) => {
    const state = deriveElementParentState({
      board: { branch: 'board', taskId: 'board-1', idempotencyKey: 'board-key', status: boardStatus, progress: 20 },
      layers: { branch: 'layers', taskId: 'layers-1', idempotencyKey: 'layers-key', status: layerStatus, progress: 20 },
    });

    expect(state.status).toBe(expected);
    expect(state.overallStatus).toBe(expected);
  });
});
