import { describe, expect, it, vi } from 'vitest';

import {
  buildSimpleCreateCanvasUrl,
  buildSimpleCreateLoginUrl,
  clearSimpleCreateCanvasHandoff,
  consumeSimpleCreateCanvasHandoff,
  parseSimpleCreateCanvasHandoff,
} from '@/lib/simple-create-navigation';

describe('simple create navigation', () => {
  it('opens the managed result in the same project canvas', () => {
    expect(buildSimpleCreateCanvasUrl('project 1', {
      url: '/media/result.png',
      assetVersionId: 'version/1',
      placementId: 'placement 1',
    })).toBe('/?projectId=project+1&assetVersionId=version%2F1&placementId=placement+1');
  });

  it('preserves the exact simple-create return target for login', () => {
    expect(buildSimpleCreateLoginUrl('/simple-create?projectId=p1')).toBe(
      '/?returnTo=%2Fsimple-create%3FprojectId%3Dp1',
    );
  });

  it('parses and consumes a managed result handoff without losing the project target', () => {
    expect(parseSimpleCreateCanvasHandoff(
      '?projectId=project+1&assetVersionId=version%2F1&placementId=placement+1',
    )).toEqual({
      projectId: 'project 1',
      assetVersionId: 'version/1',
      placementId: 'placement 1',
    });

    expect(clearSimpleCreateCanvasHandoff(
      'https://example.com/?projectId=project+1&assetVersionId=version%2F1&placementId=placement+1',
    )).toBe('https://example.com/?projectId=project+1');
  });

  it('rejects partial or oversized managed result handoffs', () => {
    expect(parseSimpleCreateCanvasHandoff('?projectId=p1&assetVersionId=v1')).toBeNull();
    expect(parseSimpleCreateCanvasHandoff(
      `?projectId=p1&assetVersionId=${'v'.repeat(201)}&placementId=pl1`,
    )).toBeNull();
  });

  it('resolves the canonical managed reference before merging and cleaning the URL', async () => {
    const calls: string[] = [];
    const result = await consumeSimpleCreateCanvasHandoff({
      handoff: {
        projectId: 'p1',
        assetVersionId: 'v1',
        placementId: 'pl1',
      },
      currentProjectId: 'p1',
      resolveReference: async input => {
        calls.push(`resolve:${input.assetVersionId}`);
        return {
          url: '/canonical.png',
          assetVersionId: input.assetVersionId,
          placementId: input.placementId,
          entityId: 'canvas-result-1',
        };
      },
      merge: reference => { calls.push(`merge:${reference.url}`); },
      cleanUrl: () => { calls.push('clean'); },
    });

    expect(result).toEqual({
      status: 'consumed',
      reference: expect.objectContaining({
        url: '/canonical.png',
        assetVersionId: 'v1',
        placementId: 'pl1',
      }),
    });
    expect(calls).toEqual(['resolve:v1', 'merge:/canonical.png', 'clean']);
  });

  it('waits for the matching project and keeps the URL when merge fails', async () => {
    const resolveReference = vi.fn();
    const cleanUrl = vi.fn();
    await expect(consumeSimpleCreateCanvasHandoff({
      handoff: { projectId: 'p1', assetVersionId: 'v1', placementId: 'pl1' },
      currentProjectId: 'p2',
      resolveReference,
      merge: vi.fn(),
      cleanUrl,
    })).resolves.toEqual({ status: 'waiting', reference: null });
    expect(resolveReference).not.toHaveBeenCalled();

    await expect(consumeSimpleCreateCanvasHandoff({
      handoff: { projectId: 'p1', assetVersionId: 'v1', placementId: 'pl1' },
      currentProjectId: 'p1',
      resolveReference: async () => ({
        url: '/canonical.png', assetVersionId: 'v1', placementId: 'pl1',
      }),
      merge: () => { throw new Error('merge failed'); },
      cleanUrl,
    })).rejects.toThrow('merge failed');
    expect(cleanUrl).not.toHaveBeenCalled();
  });
});
