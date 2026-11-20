import { describe, expect, it } from 'vitest';
import { createEmptyDramaProject } from '@/lib/drama/types';
import { checkpointProduction, pendingProductionImages, upsertProductionImage } from '@/lib/drama/production-state';

describe('durable drama checkpoints', () => {
  it('keeps unfinished image receipts on reopen and preserves source URL when storage fails', () => {
    const doc = createEmptyDramaProject();
    const next = upsertProductionImage(doc, { id: 'image_1', target: { kind: 'keyframe', entityId: 's', view: 'first' }, providerId: 'p', modelId: 'm', state: 'retrieving', sourceUrl: 'https://example.com/result.png', createdAt: 1, updatedAt: 2 });
    expect(pendingProductionImages(JSON.parse(JSON.stringify(next)))).toHaveLength(1);
    const saved = upsertProductionImage(next, { ...next.productionImages![0], state: 'stored', url: '/stored.png' });
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
