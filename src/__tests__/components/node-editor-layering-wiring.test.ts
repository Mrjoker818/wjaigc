import { describe, expect, it } from 'vitest';

import {
  buildNodeExecutionRequest,
  getNodePropertyFields,
  type WorkflowNode,
} from '@/lib/workflow-engine';

const segmentNode: WorkflowNode = {
  id: 'segment-1',
  type: 'ai-segment',
  label: '元素分层',
  x: 0,
  y: 0,
  width: 240,
  height: 180,
  ports: [],
  config: {
    engine: 'smart',
    model: 'pear-provider::Image-Layered',
  },
};

describe('node editor hybrid layering wiring', () => {
  it('offers smart, cloud, and local engines while keeping the layer model filter', () => {
    const fields = getNodePropertyFields('ai-segment');
    const engine = fields.find((field) => field.key === 'engine');
    const model = fields.find((field) => field.key === 'model');

    expect(engine).toMatchObject({
      type: 'select',
      defaultValue: 'smart',
      options: [
        { label: '智能', value: 'smart' },
        { label: '云端', value: 'cloud' },
        { label: '本地', value: 'local' },
      ],
    });
    expect(model).toMatchObject({ type: 'model-select', modelFilter: 'layer' });
  });

  it('sends the precise layer provider, model, and engine to the unified endpoint', () => {
    expect(buildNodeExecutionRequest(segmentNode, { imageUrl: '/source.png' })).toMatchObject({
      endpoint: '/api/layered-decompose',
      method: 'POST',
      body: {
        imageUrl: '/source.png',
        providerId: 'pear-provider',
        modelId: 'Image-Layered',
        engine: 'smart',
      },
    });
  });

  it('omits provider and model only in explicit local mode', () => {
    const request = buildNodeExecutionRequest({
      ...segmentNode,
      config: { ...segmentNode.config, engine: 'local' },
    }, { imageUrl: '/source.png' });

    expect(request).toMatchObject({
      endpoint: '/api/layered-decompose',
      body: { imageUrl: '/source.png', engine: 'local' },
    });
    expect(request?.body).not.toHaveProperty('providerId');
    expect(request?.body).not.toHaveProperty('modelId');
  });
});
