import { describe, expect, it } from 'vitest';
import { createEmptyDramaProject } from '@/lib/drama/types';
import { checkpointProduction, pendingProductionImages, upsertProductionImage } from '@/lib/drama/production-state';

describe('durable drama checkpoints', () => {
  it.each(['generating', 'retrieving', 'stored', 'failed', 'unknown'] as const)('does not let a late %s checkpoint reopen an adopted image', state => {
    const adopted = { id: 'image_adopted', target: { kind: 'cast' as const, entityId: 'c', view: 'side' as const },
      providerId: 'p', modelId: 'm', taskId: 'original', state: 'stored' as const, sourceUrl: 'https://provider.invalid/original.png',
      url: '/stored.png', applied: true, inputSnapshot: 'original-input', targetSnapshot: 'original-target', createdAt: 1, updatedAt: 3 };
    const doc = upsertProductionImage(createEmptyDramaProject(), adopted);
    const next = upsertProductionImage(doc, { ...adopted, state, applied: false, url: undefined, error: 'late reader', updatedAt: 9 });
    expect(next.productionImages).toEqual([adopted]);
    expect(pendingProductionImages(next)).toEqual([]);
  });

  it('keeps unfinished image receipts on reopen and preserves source URL when storage fails', () => {
    const doc = createEmptyDramaProject();
    const next = upsertProductionImage(doc, { id: 'image_1', target: { kind: 'keyframe', entityId: 's', view: 'first' }, providerId: 'p', modelId: 'm', state: 'retrieving', sourceUrl: 'https://example.com/result.png', createdAt: 1, updatedAt: 2 });
    expect(pendingProductionImages(JSON.parse(JSON.stringify(next)))).toHaveLength(1);
    const saved = upsertProductionImage(next, { ...next.productionImages![0], state: 'stored', url: '/stored.png', applied: true });
    expect(pendingProductionImages(saved)).toHaveLength(0);
    expect(saved.productionImages![0].sourceUrl).toBe('https://example.com/result.png');
  });
  it('persists the stage without mutating completed media or silently restarting a paused run', () => {
    const doc = createEmptyDramaProject();
    const running = checkpointProduction(doc, { id: 'r', episodeId: 'e', stage: 'shots', status: 'running', updatedAt: 10 });
    const paused = checkpointProduction(running, { ...running.productionRun!, status: 'paused', updatedAt: 11 });
    expect(paused.productionRun).toMatchObject({ id: 'r', stage: 'shots', status: 'paused' });
    expect(doc).not.toHaveProperty('productionRun');
  });
});
