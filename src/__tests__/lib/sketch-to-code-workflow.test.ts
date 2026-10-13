import { describe, expect, it } from 'vitest';
import { WORKFLOW_RENDER_NODE_ICONS, WORKFLOW_RENDER_PORT_COLORS } from '@/lib/workflow-renderer/presentation';
import { projectWorkflowRenderModel } from '@/lib/workflow-renderer/view-model';
import { SketchClient, type SketchScope } from '@/lib/sketch-to-code/client';
import {
  buildNodeExecutionRequest, canConnectPorts, createConnection, createWorkflowNode, createEmptyWorkflow,
  getNodeInputs, getNodePropertyFields, NODE_TEMPLATES,
  type ExecutionResult, type NodeType, type PortType,
  parseWorkflowSketchDocumentReference,
} from '@/lib/workflow-engine';

const sketchType = 'ai-sketch-to-code' as NodeType;
const documentType = 'document-reference' as PortType;
const png = 'data:image/png;base64,iVBORw0KGgo=';

describe('workflow sketch node request and port behavior', () => {
  it('projects the sketch node pencil and safe document color through the original presentation maps', () => {
    const node = createWorkflowNode('ai-sketch-to-code', 0, 0);
    const model = projectWorkflowRenderModel({ ...createEmptyWorkflow('草图'), id: 'wf', nodes: [node], connections: [] }, { x: 0, y: 0, zoom: 1 });
    expect(model.nodes[0].type).toBe('ai-sketch-to-code');
    expect(WORKFLOW_RENDER_NODE_ICONS[model.nodes[0].type]).toBe('Pencil');
    expect(WORKFLOW_RENDER_PORT_COLORS[model.nodes[0].ports.find(port => port.id === 'out-document')!.type]).toBe('#22d3ee');
  });
  it('creates the catalog node with Chinese properties and separate PNG and document ports', () => {
    const node = createWorkflowNode(sketchType, 30, 40);
    expect(node.label).toBe('草图转代码');
    expect(NODE_TEMPLATES.find(item => item.type === sketchType)?.category).toBe('ai');
    expect(node.ports.map(port => [port.id, port.type, port.direction])).toEqual([
      ['in-image', 'image', 'in'], ['in-prompt', 'prompt', 'in'],
      ['out-image', 'image', 'out'], ['out-document', 'document-reference', 'out'],
    ]);
    expect(getNodePropertyFields(sketchType).find(field => field.key === 'model'))
      .toMatchObject({ type: 'model-select', modelFilter: 'chat' });
    expect(getNodePropertyFields(sketchType).find(field => field.key === 'instruction')?.type).toBe('textarea');
  });

  it('builds exactly six strings using execution scope and configured exact model despite upstream overrides', () => {
    const node = createWorkflowNode(sketchType, 0, 0);
    node.config = { projectId: 'forged-config', providerId: 'vision-a', model: 'vision-model', instruction: '原说明' };
    const request = Reflect.apply(buildNodeExecutionRequest, undefined, [node, {
      imageUrl: png, prompt: '还原上游布局', projectId: 'forged-input',
      providerId: 'vision-b', model: 'different', idempotencyKey: 'forged-nonce',
      apiKey: 'forbidden', skipBilling: true, messageId: 'forbidden',
    }, { projectId: 'project-a', idempotencyKey: 'workflow:execution-a:node-a:attempt:0' }]);
    expect(request).toEqual({ endpoint: '/api/sketch-to-code', method: 'POST', body: {
      projectId: 'project-a', imageDataUrl: png, instruction: '还原上游布局',
      providerId: 'vision-a', modelId: 'vision-model',
      idempotencyKey: 'workflow:execution-a:node-a:attempt:0',
    } });
  });

  it('fails closed without an execution context rather than accepting a graph project or nonce', () => {
    const node = createWorkflowNode(sketchType, 0, 0);
    node.config = { projectId: 'graph-project', providerId: 'vision-a', model: 'vision-model', idempotencyKey: 'graph-nonce' };
    expect(() => buildNodeExecutionRequest(node, { imageUrl: png })).toThrow('WORKFLOW_SKETCH_SCOPE_REQUIRED');
  });

  it('rejects a composite model whose provider contradicts the configured provider', () => {
    const node = createWorkflowNode(sketchType, 0, 0);
    node.config = { providerId: 'vision-a', model: 'vision-b::vision-model' };
    expect(() => Reflect.apply(buildNodeExecutionRequest, undefined, [node, { imageUrl: png },
      { projectId: 'project-a', idempotencyKey: 'nonce-a' }])).toThrow('WORKFLOW_SKETCH_MODEL_REQUIRED');
  });

  it('transfers connected PNG and prompt through the original input resolver into the strict builder', () => {
    const node = createWorkflowNode(sketchType, 0, 0);
    node.config = { providerId: 'vision-a', model: 'vision-model' };
    const connections = [createConnection('image-a', 'out-image', node.id, 'in-image', 'image'),
      createConnection('text-a', 'out-prompt', node.id, 'in-prompt', 'prompt')];
    const results = new Map<string, ExecutionResult>([
      ['image-a', { nodeId: 'image-a', status: 'success', output: { imageUrl: png }, durationMs: 1 }],
      ['text-a', { nodeId: 'text-a', status: 'success', output: { text: '还原上游布局' }, durationMs: 1 }],
    ]);
    const inputs = getNodeInputs(node, connections, results);
    const request = Reflect.apply(buildNodeExecutionRequest, undefined, [node, inputs,
      { projectId: 'project-a', idempotencyKey: 'nonce-a' }]);
    expect(request?.body).toEqual({ projectId: 'project-a', imageDataUrl: png, instruction: '还原上游布局',
      providerId: 'vision-a', modelId: 'vision-model', idempotencyKey: 'nonce-a' });
  });

  it('allows the document port only into a dedicated document consumer and never image, data or any', () => {
    expect(canConnectPorts(documentType, documentType)).toBe(true);
    for (const type of ['image', 'data', 'any'] as const) expect(canConnectPorts(documentType, type)).toBe(false);
    const output = createWorkflowNode('output-export', 0, 0);
    expect(output.ports.find(port => port.id === 'in-document')?.type).toBe('document-reference');
    expect(createWorkflowNode('output-image-group', 0, 0).ports.some(port => port.type === documentType)).toBe(false);
  });
  it('passes only the safe binding through document connections, never poll HTML or generic result', () => {
    const target = createWorkflowNode('output-export', 0, 0);
    const reference = { kind: 'document-reference', taskId: 'sketch_task', projectId: 'project-a', providerId: 'p1', modelId: 'm1', previewAssetId: 'png-asset', htmlAssetId: 'html-asset', previewAssetVersionId: 'png-version', htmlAssetVersionId: 'html-version' };
    const inputs = getNodeInputs(target, [createConnection('sketch-node', 'out-document', target.id, 'in-document', 'document-reference')],
      new Map([['sketch-node', { nodeId: 'sketch-node', status: 'success', durationMs: 1, output: { documentReference: { ...reference, html: 'RAW_HTML' }, html: 'RAW_HTML', imageUrl: '/not-html.png' } }]]));
    expect(inputs.documentReference).toEqual(reference); expect(JSON.stringify(inputs)).not.toContain('RAW_HTML'); expect(inputs.result).toBeUndefined(); expect(inputs.imageUrl).toBeUndefined();
    expect(parseWorkflowSketchDocumentReference({ ...reference, providerId: '' })).toBeNull();
  });
});

describe('workflow browser completed analysis uses the original canonical contract', () => {
  const scope: SketchScope = { actorId: 'u1', projectId: 'project-a', key: 'u1:project-a', authority: 'legacy', assertCurrent: () => undefined };
  const canonical = { summary: '页面摘要', layout: '左右布局', controls: ['按钮', '输入框'], text: ['标题', '中文'] };
  const completed = { success: true, type: 'sketch-to-code', taskId: 'sketch-task', projectId: 'project-a', providerId: 'p1', modelId: 'm1', status: 'completed', progress: 100,
    reserveCredits: 14, actualCredits: 12, previewAssetId: 'png-asset', htmlAssetId: 'html-asset', previewAssetVersionId: 'png-version', htmlAssetVersionId: 'html-version' };
  function poll(analysis: unknown, overrides: Record<string, unknown> = {}, nativeShape = false): Promise<unknown> {
    const body = { ...completed, analysis, ...overrides };
    const response = nativeShape ? new Response() : Response.json(body);
    // Non-JSON descriptors exercise the defensive boundary; the service-chain test uses real response JSON.
    if (nativeShape) Object.defineProperty(response, 'json', { value: async () => body });
    return new SketchClient(scope, async () => response).poll('sketch-task');
  }
  it('projects canonical four-field analysis deterministically while preserving bound result and net fee only', async () => {
    const task = await poll(canonical, { html: 'RAW_HTML', documentUrl: 'https://untrusted.invalid', apiKey: 'SECRET', pricing: { totalCredits: 1 } });
    expect(task).toEqual({ taskId: 'sketch-task', projectId: 'project-a', providerId: 'p1', modelId: 'm1', status: 'completed', progress: 100, reserveCredits: 14, actualCredits: 12,
      previewAssetId: 'png-asset', htmlAssetId: 'html-asset', previewAssetVersionId: 'png-version', htmlAssetVersionId: 'html-version',
      analysis: '摘要：页面摘要\n布局：左右布局\n控件：\n按钮\n输入框\n文字：\n标题\n中文' });
    expect(Object.isFrozen(task)).toBe(true);
  });
  it.each(['中', '😀'])('accepts the exact shared 64KiB UTF8 budget with %s without JSON escape expansion', async character => {
    const width = new TextEncoder().encode(character).length;
    const available = 65534; const count = Math.floor(available / width);
    const summary = character.repeat(count) + 'x'.repeat(available - width * count);
    expect(new TextEncoder().encode(summary + 'L' + 'T').length).toBe(65536);
    await expect(poll({ summary, layout: 'L', controls: [], text: ['T'] })).resolves.toMatchObject({ analysis: `摘要：${summary}\n布局：L\n控件：\n\n文字：\nT` });
    await expect(poll({ summary: summary + 'x', layout: 'L', controls: [], text: ['T'] })).rejects.toThrow('草图结果引用或净费用无效');
  });
  it.each(['\u0000', '"', '\\'])('preserves valid 64KiB content %j as plain text instead of rejecting expanded JSON', async character => {
    const summary = character.repeat(65535);
    const task = await poll({ summary, layout: 'L', controls: [], text: [] }) as { analysis: string };
    expect(task.analysis).toBe(`摘要：${summary}\n布局：L\n控件：\n\n文字：\n`);
    expect(task.analysis.length).toBeLessThan(100000);
  });
  it('accepts dense empty lists and both 200-item boundary lists', async () => {
    await expect(poll({ ...canonical, controls: [], text: [] })).resolves.toMatchObject({ status: 'completed' });
    await expect(poll({ ...canonical, controls: Array(200).fill('控件'), text: Array(200).fill('文字') })).resolves.toMatchObject({ status: 'completed' });
    await expect(poll({ ...canonical, controls: Array(201).fill('控件') })).rejects.toThrow('草图结果引用或净费用无效');
  });
  it('retains legacy string analysis at 100000 characters and rejects oversized strings', async () => {
    await expect(poll('旧'.repeat(100000))).resolves.toMatchObject({ analysis: '旧'.repeat(100000) });
    await expect(poll('旧'.repeat(100001))).rejects.toThrow('草图结果引用或净费用无效');
  });
  it.each([null, [], 1, true, {}, { ...canonical, summary: ' ' }, { ...canonical, layout: '' }, { ...canonical, controls: ['ok', 1] }, { ...canonical, text: [null] }, { ...canonical, html: '<script>' }])('rejects unknown or invalid canonical shape %j', async value => {
    await expect(poll(value)).rejects.toThrow('草图结果引用或净费用无效');
  });
  it('rejects prototypes, inherited/missing fields, symbols and accessors without invoking getters', async () => {
    let reads = 0;
    const accessor = { ...canonical }; Object.defineProperty(accessor, 'summary', { get: () => { reads++; return 'hidden'; }, enumerable: true });
    const inherited = Object.create({ summary: 'hidden' }) as Record<string, unknown>; Object.assign(inherited, { layout: 'L', controls: [], text: [] });
    const symbol = { ...canonical, [Symbol('hidden')]: 'hidden' };
    const prototype = Object.assign(Object.create({ custom: true }) as Record<string, unknown>, canonical);
    for (const value of [accessor, inherited, symbol, prototype]) await expect(poll(value, {}, true)).rejects.toThrow('草图结果引用或净费用无效');
    expect(reads).toBe(0);
  });
  it('rejects sparse or accessor arrays without invoking getters or accepting extra properties', async () => {
    let reads = 0; const accessor = ['button']; Object.defineProperty(accessor, '0', { get: () => { reads++; return 'hidden'; } });
    const extra = Object.assign(['button'], { hidden: 'value' }); const symbols = Object.assign(['button'], { [Symbol('hidden')]: 'value' });
    for (const controls of [Array(1), accessor, extra, symbols]) await expect(poll({ ...canonical, controls }, {}, true)).rejects.toThrow('草图结果引用或净费用无效');
    expect(reads).toBe(0);
  });
  it('accepts an authoritative token net fee of 20 after a reserve of 14', async () => {
    await expect(poll(canonical, { actualCredits: 20 })).resolves.toMatchObject({ status: 'completed', reserveCredits: 14, actualCredits: 20 });
  });
  it.each([{ actualCredits: -1 }, { actualCredits: Number.MAX_SAFE_INTEGER + 1 }, { actualCredits: 0.5 }, { previewAssetId: '' }, { htmlAssetId: '' }, { previewAssetVersionId: '' }, { htmlAssetVersionId: '' }])('canonical analysis never relaxes result or net fee validation %j', async override => {
    await expect(poll(canonical, override)).rejects.toThrow('草图结果引用或净费用无效');
  });
  it.each(['taskId', 'projectId', 'providerId', 'modelId'])('canonical completion cannot replace an already bound %s', async field => {
    let calls = 0;
    const client = new SketchClient(scope, async () => Response.json(calls++ === 0 ? { ...completed, status: 'processing', progress: 40 } : { ...completed, analysis: canonical, [field]: 'changed' }));
    await client.poll('sketch-task'); await expect(client.poll('sketch-task')).rejects.toThrow();
  });
});
