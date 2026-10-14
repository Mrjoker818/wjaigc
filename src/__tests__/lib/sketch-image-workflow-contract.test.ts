import { describe, expect, it } from 'vitest';
import { WORKFLOW_RENDER_NODE_ICONS } from '@/lib/workflow-renderer/presentation';
import {
  buildNodeExecutionRequest, createWorkflowNode, getNodePropertyFields, NODE_TEMPLATES,
  parseWorkflowSketchImageReference, type NodeType,
} from '@/lib/workflow-engine';

const type = 'ai-sketch-to-image' as NodeType;
const png = 'data:image/png;base64,iVBORw0KGgo=';
const context = { projectId: 'project-a', idempotencyKey: 'root:node:attempt:0' };
const bindings = { visionProviderId: 'vision-a', visionModel: 'vision-model', imageProviderId: 'image-a', imageModel: 'image-model' };
const reference = { kind: 'sketch-image-reference', taskId: 'skimg_a', projectId: 'project-a',
  visionProviderId: 'vision-a', visionModelId: 'vision-model', imageProviderId: 'image-a', imageModelId: 'image-model',
  previewAssetId: 'sketch-asset', previewAssetVersionId: 'sketch-version', imageAssetId: 'generated-asset', imageAssetVersionId: 'generated-version' };

describe('independent sketch image workflow contract', () => {
  it('adds an image node without a document port or redefining the old code node', () => {
    const node = createWorkflowNode(type, 10, 20);
    expect(node.label).toBe('草图生图');
    expect(NODE_TEMPLATES.find(item => item.type === type)).toMatchObject({ category: 'ai', label: '草图生图' });
    expect(WORKFLOW_RENDER_NODE_ICONS[type]).toBe('Pencil');
    expect(node.ports.map(port => [port.id, port.type, port.direction])).toEqual([
      ['in-image', 'image', 'in'], ['in-prompt', 'prompt', 'in'], ['out-image', 'image', 'out'],
    ]);
    expect(node.ports.find(port => port.id === 'out-image')?.label).toBe('生成图片');
    expect(createWorkflowNode('ai-sketch-to-code', 0, 0).ports.map(port => port.id)).toContain('out-document');
  });
  it('exposes two explicit role fields and no inferred common model', () => {
    const fields = getNodePropertyFields(type);
    expect(fields.find(field => field.key === 'visionModel')).toMatchObject({ type: 'model-select', modelFilter: 'chat' });
    expect(fields.find(field => field.key === 'imageModel')).toMatchObject({ type: 'model-select', modelFilter: 'image' });
    expect(fields.some(field => field.key === 'model')).toBe(false);
    expect(fields.find(field => field.key === 'instruction')?.type).toBe('textarea');
    expect(fields.find(field => field.key === 'aspectRatio')?.defaultValue).toBe('4:3');
  });
  it('builds exactly the image contract from original scope, configured roles and source PNG', () => {
    const node = createWorkflowNode(type, 0, 0);
    node.config = { ...bindings, projectId: 'forged-config', instruction: '原关键词', aspectRatio: '16:9' };
    expect(buildNodeExecutionRequest(node, { imageUrl: png, prompt: '青绿小屋', projectId: 'forged-upstream',
      idempotencyKey: 'forged-nonce', visionProviderId: 'other-vision', visionModel: 'other', imageModel: 'other',
      imageProviderId: 'other-image', model: 'other', providerId: 'other', apiKey: 'secret', skipBilling: true }, context))
      .toEqual({ endpoint: '/api/sketch-to-image', method: 'POST', body: { ...context, imageDataUrl: png, instruction: '青绿小屋',
        visionProviderId: 'vision-a', visionModelId: 'vision-model', imageProviderId: 'image-a', imageModelId: 'image-model', aspectRatio: '16:9' } });
  });
  it('keeps composite providers separate, optional settings explicit and defaults only the aspect', () => {
    const node = createWorkflowNode(type, 0, 0);
    node.config = { visionModel: 'vision-b::same-name', imageModel: 'image-c::same-name', instruction: '构图', size: '1024x768', quality: 'high' };
    expect(buildNodeExecutionRequest(node, { imageDataUrl: png, size: 'forged', quality: 'forged' }, context)?.body)
      .toEqual({ ...context, imageDataUrl: png, instruction: '构图', visionProviderId: 'vision-b', visionModelId: 'same-name',
        imageProviderId: 'image-c', imageModelId: 'same-name', aspectRatio: '4:3', size: '1024x768', quality: 'high' });
  });
  it.each([{}, { projectId: 'project-a' }, { idempotencyKey: 'nonce' }])('rejects missing server execution scope %j', supplied => {
    const node = createWorkflowNode(type, 0, 0); node.config = { ...bindings, projectId: 'forged', idempotencyKey: 'forged' };
    expect(() => Reflect.apply(buildNodeExecutionRequest, undefined, [node, { imageUrl: png }, supplied])).toThrow('WORKFLOW_SKETCH_SCOPE_REQUIRED');
  });
  it.each([
    { visionProviderId: '', visionModel: 'vision-model' }, { imageProviderId: '', imageModel: 'image-model' },
    { visionModel: '' }, { imageModel: '' },
    { visionModel: 'other::vision-model' }, { imageModel: 'other::image-model' },
  ])('rejects a missing or contradictory role %j without ordinary request fallback', patch => {
    const node = createWorkflowNode(type, 0, 0); node.config = { ...bindings, ...patch };
    expect(() => buildNodeExecutionRequest(node, { imageUrl: png, model: 'generic' }, context)).toThrow('WORKFLOW_SKETCH_MODEL_REQUIRED');
  });
  it('projects only immutable bound asset references and never HTML, URLs or source data', () => {
    const parsed = parseWorkflowSketchImageReference({ ...reference, html: '<script>', imageUrl: 'https://untrusted.invalid', apiKey: 'secret', imageDataUrl: png });
    expect(parsed).toEqual(reference); expect(Object.isFrozen(parsed)).toBe(true);
    expect(parseWorkflowSketchImageReference({ ...reference, kind: 'document-reference' })).toBeNull();
  });
  it.each(['taskId', 'projectId', 'visionProviderId', 'visionModelId', 'imageProviderId', 'imageModelId',
    'previewAssetId', 'previewAssetVersionId', 'imageAssetId', 'imageAssetVersionId'])('rejects missing or unsafe %s', key => {
    const missing = { ...reference } as Record<string, unknown>; delete missing[key];
    expect(parseWorkflowSketchImageReference(missing)).toBeNull();
    expect(parseWorkflowSketchImageReference({ ...reference, [key]: 'invalid\nvalue' })).toBeNull();
  });
  it('does not invoke getters or accept inherited bindings and rejects source/result aliasing', () => {
    let reads = 0; const accessor = { ...reference };
    Object.defineProperty(accessor, 'imageAssetId', { get: () => { reads++; return 'hidden'; } });
    expect(parseWorkflowSketchImageReference(accessor)).toBeNull(); expect(reads).toBe(0);
    expect(parseWorkflowSketchImageReference(Object.create(reference))).toBeNull();
    expect(parseWorkflowSketchImageReference({ ...reference, imageAssetId: reference.previewAssetId })).toBeNull();
    expect(parseWorkflowSketchImageReference({ ...reference, imageAssetVersionId: reference.previewAssetVersionId })).toBeNull();
  });
  it.each(['black-forest-labs/FLUX.1-dev', '模型-甲'])('retains a legitimate exact Task7 model label %s without ASCII alias inference', modelId => {
    const expected = { ...reference, visionModelId: modelId, imageModelId: modelId };
    expect(parseWorkflowSketchImageReference(expected)).toEqual(expected);
  });
  it('matches the original 256-character label bound and still rejects whitespace and controls', () => {
    expect(parseWorkflowSketchImageReference({ ...reference, imageModelId: 'm'.repeat(256) })?.imageModelId).toBe('m'.repeat(256));
    expect(parseWorkflowSketchImageReference({ ...reference, imageModelId: 'm'.repeat(257) })).toBeNull();
    expect(parseWorkflowSketchImageReference({ ...reference, imageModelId: ' model ' })).toBeNull();
    expect(parseWorkflowSketchImageReference({ ...reference, imageModelId: 'model\u0000' })).toBeNull();
  });
});
