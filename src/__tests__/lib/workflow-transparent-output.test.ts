import { describe, expect, it } from 'vitest';
import {
  buildNodeExecutionRequest,
  getNodePropertyFields,
  type WorkflowNode,
} from '@/lib/workflow-engine';

function makeGenerateNode(background: 'auto' | 'transparent' | 'opaque'): WorkflowNode {
  return {
    id: 'generate-transparent',
    type: 'ai-generate',
    label: '透明生图',
    x: 0,
    y: 0,
    width: 220,
    height: 140,
    ports: [],
    config: {
      prompt: 'isolated product',
      model: 'gpt-image-2',
      background,
    },
  };
}

describe('workflow transparent output', () => {
  it('exposes background mode on image generation nodes', () => {
    const backgroundField = getNodePropertyFields('ai-generate')
      .find((field) => field.key === 'background');

    expect(backgroundField).toMatchObject({
      type: 'select',
      defaultValue: 'auto',
    });
    expect(backgroundField?.options).toEqual(expect.arrayContaining([
      { label: '透明 PNG', value: 'transparent' },
    ]));
  });

  it('passes transparent PNG output to the generation API', () => {
    expect(buildNodeExecutionRequest(makeGenerateNode('transparent'), {})).toMatchObject({
      endpoint: '/api/generate',
      body: {
        background: 'transparent',
        output_format: 'png',
      },
    });
  });

  it('does not add output fields in automatic mode', () => {
    const request = buildNodeExecutionRequest(makeGenerateNode('auto'), {});
    expect(request?.body).not.toHaveProperty('background');
    expect(request?.body).not.toHaveProperty('output_format');
  });
});
