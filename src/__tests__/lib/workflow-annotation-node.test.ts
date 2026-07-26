import { describe, expect, it } from 'vitest';

import type { EditIntentBundle } from '@/features/annotations/annotation-types';
import {
  buildNodeExecutionRequest,
  createWorkflowNode,
  getNodeInputs,
  getNodePropertyFields,
  NODE_TYPE_LABELS,
} from '@/lib/workflow-engine';

const annotationBundle: EditIntentBundle = {
  id: 'bundle-1',
  projectId: 'project-1',
  sourceImageId: 'image-1',
  sourceVersionId: 'version-1',
  annotationIds: ['annotation-1'],
  annotations: [{
    id: 'annotation-1',
    projectId: 'project-1',
    sourceImageId: 'image-1',
    sourceVersionId: 'version-1',
    type: 'region',
    geometry: {
      kind: 'region',
      region: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 },
    },
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }],
  prompt: 'Replace the selected area',
  modelId: 'gpt-image-1',
  providerId: 'provider-1',
  idempotencyKey: 'request-1',
  createdAt: 1,
};

describe('ai-annotation-edit workflow node', () => {
  it('has image and optional reference inputs with an image output', () => {
    const node = createWorkflowNode('ai-annotation-edit', 100, 200);

    expect(NODE_TYPE_LABELS['ai-annotation-edit']).toBe('批注修改');
    expect(node.ports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'in-image',
        type: 'image',
        direction: 'in',
      }),
      expect.objectContaining({
        id: 'in-reference',
        type: 'image',
        direction: 'in',
      }),
      expect.objectContaining({
        id: 'out-image',
        type: 'image',
        direction: 'out',
      }),
    ]));
  });

  it('exposes bundle, model, provider, and source version properties', () => {
    const fields = getNodePropertyFields('ai-annotation-edit');
    const keys = fields.map((field) => field.key);

    expect(keys).toEqual(expect.arrayContaining([
      'annotationBundle',
      'model',
      'providerId',
      'sourceVersionId',
    ]));
    expect(fields.find((field) => field.key === 'annotationBundle'))
      .toMatchObject({ readOnly: true });
    expect(fields.find((field) => field.key === 'providerId'))
      .toMatchObject({ readOnly: true });
    expect(fields.find((field) => field.key === 'sourceVersionId'))
      .toMatchObject({ readOnly: true });
  });

  it('builds the authenticated annotation execution request', () => {
    const node = createWorkflowNode('ai-annotation-edit', 100, 200);
    node.config = {
      ...node.config,
      annotationBundle,
      sourceVersionId: 'version-1',
    };

    expect(buildNodeExecutionRequest(node, {
      imageUrl: 'https://example.com/source.png',
      sourceVersionId: 'version-1',
    })).toEqual({
      endpoint: '/api/annotations/execute',
      method: 'POST',
      body: { bundle: annotationBundle },
    });
  });

  it('blocks execution when the upstream source version changed', () => {
    const node = createWorkflowNode('ai-annotation-edit', 100, 200);
    node.config = {
      ...node.config,
      annotationBundle,
      sourceVersionId: 'version-1',
      sourceImageUrl: 'https://example.com/source.png',
    };

    expect(() => buildNodeExecutionRequest(node, {
      imageUrl: 'https://example.com/replaced.png',
      sourceVersionId: 'version-2',
    })).toThrow('ANNOTATION_SOURCE_STALE');
  });

  it('blocks execution when the upstream URL changed without a version field', () => {
    const node = createWorkflowNode('ai-annotation-edit', 100, 200);
    node.config = {
      ...node.config,
      annotationBundle,
      sourceVersionId: 'version-1',
      sourceImageUrl: 'https://example.com/source.png',
    };

    expect(() => buildNodeExecutionRequest(node, {
      imageUrl: 'https://example.com/replaced.png',
    })).toThrow('ANNOTATION_SOURCE_STALE');
  });

  it('propagates the current upstream image version into annotation inputs', () => {
    const node = createWorkflowNode('ai-annotation-edit', 100, 200);
    node.id = 'annotation-node';
    node.config = {
      ...node.config,
      annotationBundle,
      sourceVersionId: 'version-1',
    };

    const inputs = getNodeInputs(
      node,
      [{
        id: 'connection-1',
        fromNodeId: 'source-node',
        fromPortId: 'out-image',
        toNodeId: 'annotation-node',
        toPortId: 'in-image',
        type: 'image',
      }],
      new Map([[
        'source-node',
        {
          nodeId: 'source-node',
          status: 'success',
          output: {
            imageUrl: 'https://example.com/replaced.png',
            annotationVersionId: 'version-2',
          },
          durationMs: 1,
        },
      ]]),
    );

    expect(inputs.sourceVersionId).toBe('version-2');
    expect(() => buildNodeExecutionRequest(node, inputs))
      .toThrow('ANNOTATION_SOURCE_STALE');
  });
});
