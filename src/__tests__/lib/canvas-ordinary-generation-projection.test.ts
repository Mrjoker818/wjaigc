import { describe, expect, it } from 'vitest';
import { projectOrdinaryGenerationSlots, type OrdinaryGenerationProjectionContext } from '@/lib/canvas-ordinary-generation-projection';
import type { CanvasCommandNode } from '@/lib/canvas-kernel/commands';
import type { ImageGenerationSlot } from '@/lib/image-generation-session';

const marker = { version: 1 as const, kind: 'ordinary-generation' as const, taskId: 'ordinary-root', requestedCount: 2 };
const contexts = new Map<string, OrdinaryGenerationProjectionContext>([
  ['s0', { projectId: 'p1', placeholderId: 's0', params: { model: 'gpt-image-1', prompt: 'cup' } }],
  ['s1', { projectId: 'p1', placeholderId: 's1', params: { model: 'gpt-image-1', prompt: 'cup' } }],
]);
function placeholder(id: string): CanvasCommandNode {
  return { id, x: 10, y: 20, width: 100, height: 80, isProcessingPlaceholder: true, processing: { status: 'submitting', progress: 0 } };
}
function slot(outputIndex: number): ImageGenerationSlot {
  return { id: outputIndex < 2 ? `s${outputIndex}` : `ordinary-root:output:${outputIndex}`, projectId: 'p1',
    taskId: 'ordinary-root', outputGroup: marker, outputIndex, status: 'completed', progress: 100,
    url: `/media/${outputIndex}.png`, assetId: `a${outputIndex}`, assetVersionId: `v${outputIndex}`,
    placementId: `pl${outputIndex}`, entityId: `entity${outputIndex}` };
}
describe('ordinary session canvas bridge', () => {
  it('binds every output index, projects extra canonical results and preserves unrelated placeholders', () => {
    const result = projectOrdinaryGenerationSlots([placeholder('s0'), placeholder('s1'), placeholder('other')], [slot(0), slot(1), slot(2)], 'p1', contexts);
    expect(result.filter(node => node.assetVersionId).map(node => [node.placementId, node.assetVersionId, node.taskProjection?.outputIndex])).toEqual([
      ['pl0', 'v0', 0], ['pl1', 'v1', 1], ['pl2', 'v2', 2],
    ]);
    expect(result.find(node => node.id === 'other')).toEqual(placeholder('other'));
    expect(result.filter(node => node.isProcessingPlaceholder)).toHaveLength(1);
  });
  it('deduplicates canonical document before or after group events and only removes matching group placeholders', () => {
    const canonical = { ...placeholder('entity1'), isProcessingPlaceholder: false, processing: undefined,
      placementId: 'pl1', assetVersionId: 'v1', url: '/media/1.png' };
    const before = projectOrdinaryGenerationSlots([placeholder('s0'), placeholder('s1'), placeholder('other'), canonical], [slot(0), slot(1)], 'p1', contexts);
    expect(before.filter(node => node.placementId === 'pl1')).toHaveLength(1);
    expect(before.some(node => node.id === 's1')).toBe(false);
    expect(before.some(node => node.id === 'other')).toBe(true);
    const early = projectOrdinaryGenerationSlots([placeholder('s0'), placeholder('s1')], [slot(0), slot(1)], 'p1', contexts);
    const after = projectOrdinaryGenerationSlots([...early, canonical], [slot(0), slot(1)], 'p1', contexts);
    expect(after.filter(node => node.placementId === 'pl1')).toHaveLength(1);
  });
  it.each([undefined, 'p2'])('rejects late groups without the matching current project: %s', projectId => {
    const images = [placeholder('s0'), placeholder('s1')];
    expect(projectOrdinaryGenerationSlots(images, [slot(0), slot(1)], projectId, contexts)).toEqual(images);
  });
  it('rejects absent or stale submission contexts and does not reinterpret a nongroup slot', () => {
    const images = [placeholder('s0')];
    expect(projectOrdinaryGenerationSlots(images, [slot(0)], 'p1', new Map())).toEqual(images);
    expect(projectOrdinaryGenerationSlots(images, [{ ...slot(0), outputGroup: undefined }], 'p1', contexts)).toEqual(images);
    expect(projectOrdinaryGenerationSlots(images, [slot(0)], 'p1', new Map([['s0', { ...contexts.get('s0')!, projectId: 'p2' }]]))).toEqual(images);
  });
});
