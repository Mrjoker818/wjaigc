import { describe, expect, it } from 'vitest';

import { collectNodeAnnotationCandidates } from '@/features/annotations/node-annotation-candidates';
import { createWorkflowNode, type ExecutionResult } from '@/lib/workflow-engine';

describe('node annotation candidate resolution', () => {
  it('keeps the exact upstream node and port for every image-group item', () => {
    const first = createWorkflowNode('input-image', 0, 0);
    first.id = 'source-a';
    first.config = {
      ...first.config,
      imageUrl: '/uploads/shared.png',
      sourceImageId: 'canvas-a',
      sourceVersionId: 'version-a',
    };
    const second = createWorkflowNode('input-image', 0, 200);
    second.id = 'source-b';
    second.config = {
      ...second.config,
      imageUrl: '/uploads/shared.png',
      sourceImageId: 'canvas-b',
      sourceVersionId: 'version-b',
    };
    const group = createWorkflowNode('output-image-group', 400, 100);
    group.id = 'group';

    const candidates = collectNodeAnnotationCandidates({
      node: group,
      nodes: [first, second, group],
      connections: [
        {
          id: 'conn-a',
          fromNodeId: first.id,
          fromPortId: 'out-image',
          toNodeId: group.id,
          toPortId: 'in-image',
          type: 'image',
        },
        {
          id: 'conn-b',
          fromNodeId: second.id,
          fromPortId: 'out-image',
          toNodeId: group.id,
          toPortId: 'in-image-2',
          type: 'image',
        },
      ],
      results: {} as Record<string, ExecutionResult>,
      canvasImages: [
        { id: 'canvas-a', url: '/uploads/shared.png', versionId: 'version-a' },
        { id: 'canvas-b', url: '/uploads/shared.png', versionId: 'version-b' },
      ],
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[1]).toMatchObject({
      sourceNodeId: 'source-b',
      sourcePortId: 'out-image',
      sourceImageId: 'canvas-b',
      sourceVersionId: 'version-b',
    });
  });

  it('preserves an input nodes explicit image identity instead of guessing by URL', () => {
    const source = createWorkflowNode('input-image', 0, 0);
    source.id = 'source-b';
    source.config = {
      ...source.config,
      imageUrl: '/uploads/shared.png',
      sourceImageId: 'canvas-b',
      sourceVersionId: 'version-b',
    };

    const [candidate] = collectNodeAnnotationCandidates({
      node: source,
      nodes: [source],
      connections: [],
      results: {},
      canvasImages: [
        { id: 'canvas-a', url: '/uploads/shared.png', versionId: 'version-a' },
        { id: 'canvas-b', url: '/uploads/shared.png', versionId: 'version-b' },
      ],
    });

    expect(candidate).toMatchObject({
      sourceImageId: 'canvas-b',
      sourceVersionId: 'version-b',
    });
  });
});
