// @vitest-environment node
// Executes the shipped preset declaration and the exact shipped load callback.
// No mounted editor, model, request, database or persisted workflow is used.
import fs from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { buildNodeExecutionRequest, getNodeInputs, isWorkflowConnectionValid, type ExecutionResult, type Workflow } from '@/lib/workflow-engine';
import { importWorkflowFile } from '@/lib/workflow-file';
import { createWorkflowFromPreset, type WorkflowPreset } from '@/lib/workflow-presets';
interface CallbackCalls { update: number; selection: number; sidebar: string[]; directoryClose: number; requests: number; }
const calls: CallbackCalls = { update: 0, selection: 0, sidebar: [], directoryClose: 0, requests: 0 };
const file = path.resolve('src/components/node-editor.tsx');
const source = fs.readFileSync(file, 'utf8');
const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const presetFile = path.resolve('src/lib/workflow-presets.ts');
const presetSource = ts.createSourceFile(presetFile, fs.readFileSync(presetFile, 'utf8'), ts.ScriptTarget.Latest, true);
let presetsNode: ts.ArrayLiteralExpression | undefined, loaderNode: ts.ArrowFunction | undefined;
let importButton: ts.Expression | undefined;
function locate(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    if (node.name.text === 'WORKFLOW_PRESETS' && node.initializer && ts.isArrayLiteralExpression(node.initializer)) presetsNode = node.initializer;
    if (node.name.text === 'handleLoadPreset' && node.initializer && ts.isCallExpression(node.initializer)
      && node.initializer.arguments[0] && ts.isArrowFunction(node.initializer.arguments[0])) loaderNode = node.initializer.arguments[0];
  }
  if (ts.isJsxOpeningElement(node) && node.tagName.getText() === 'button') {
    const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
    if (attributes.some(attr => attr.name.getText() === 'aria-label'
      && attr.initializer && ts.isStringLiteral(attr.initializer) && attr.initializer.text === '导入工作流')) {
      const click = attributes.find(attr => attr.name.getText() === 'onClick')?.initializer;
      if (click && ts.isJsxExpression(click)) importButton = click.expression;
    }
  }
  ts.forEachChild(node, locate);
}
locate(sf);
locate(presetSource);
if (!presetsNode || !loaderNode) throw Error('QN_ACTUAL_PRESET_OR_CALLBACK_NOT_FOUND');
function literalOnly(node: ts.Node): void {
  if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isArrowFunction(node)
    || ts.isFunctionExpression(node) || ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) {
    throw Error('QN_PRESET_DECLARATION_IS_NOT_STATIC_DATA');
  }
  ts.forEachChild(node, literalOnly);
}
literalOnly(presetsNode);
function javascript(node: ts.Node): string {
  const result = ts.transpileModule('(' + node.getText() + ')', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true,
  });
  if (result.diagnostics?.length) throw Error('QN_ACTUAL_SOURCE_TRANSPILE_FAILURE');
  return result.outputText;
}
const presets = runInNewContext(javascript(presetsNode)) as WorkflowPreset[];
if (!Array.isArray(presets)) throw Error('QN_ACTUAL_PRESETS_NOT_ARRAY');
function load(id: string): Workflow {
  const matches = presets.filter(p => p.id === id);
  if (matches.length !== 1) throw Error('QN_EXACT_PRESET_NOT_UNIQUE ' + id);
  let workflow: Workflow | undefined;
  const execute: unknown = runInNewContext(javascript(loaderNode!), {
    createWorkflowFromPreset,
    updateWorkflow(value: Workflow): void { calls.update++; workflow = value; },
    setSelectedNodeIds(value: Set<string>): void { calls.selection++; expect(value.size).toBe(0); },
    setSidebarTab(value: string): void { calls.sidebar.push(value); },
    closeDirectoryOnMobile(): void { calls.directoryClose++; },
  });
  if (typeof execute !== 'function') throw Error('QN_ACTUAL_LOADER_NOT_FUNCTION');
  (execute as (preset: WorkflowPreset) => void)(matches[0]);
  if (!workflow) throw Error('QN_ACTUAL_LOADER_DID_NOT_PUBLISH_WORKFLOW');
  expect(calls.update).toBe(1); expect(calls.selection).toBe(1);
  expect(calls.sidebar).toEqual(['nodes']); expect(calls.directoryClose).toBe(1);
  return workflow;
}
function invalidEdges(workflow: Workflow): Array<Record<string, unknown>> {
  return workflow.connections.filter(edge => !isWorkflowConnectionValid(workflow, edge)).map(edge => {
    const from = workflow.nodes.find(n => n.id === edge.fromNodeId), to = workflow.nodes.find(n => n.id === edge.toNodeId);
    return { fromType: from?.type, fromLabel: from?.label, fromPort: edge.fromPortId,
      fromPortType: from?.ports.find(p => p.id === edge.fromPortId)?.type,
      toType: to?.type, toLabel: to?.label, toPort: edge.toPortId,
      toPortType: to?.ports.find(p => p.id === edge.toPortId)?.type, connectionType: edge.type };
  });
}
beforeEach((): void => {
  Object.assign(calls, { update: 0, selection: 0, sidebar: [], directoryClose: 0, requests: 0 });
  vi.stubGlobal('fetch', (): never => { calls.requests++; throw Error('QN_NO_REQUESTS_ALLOWED'); });
});
afterEach((): void => {
  try {
    expect(calls.requests, 'QN_NO_REQUESTS_ALLOWED').toBe(0);
    console.log('QN_PRESET_TEST_CLEANUP ' + JSON.stringify(calls));
  } finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
describe('QN shipped video preset graph', () => {
  it('loads the seven-scene advertising preset without incompatible graph edges', (): void => {
    const workflow = load('ecom-video-storyboard'), invalid = invalidEdges(workflow);
    console.log('QN_PRESET_GRAPH_OBSERVATION ' + JSON.stringify({ preset: 'ecom-video-storyboard', nodes: workflow.nodes.length, edges: workflow.connections.length, invalid, requests: calls.requests }));
    expect(invalid, 'QN_PRESET_GRAPH_CONNECTIONS_ARE_VALID').toEqual([]);
    const planners = workflow.nodes.filter(n => n.type === 'ai-llm');
    expect(planners).toHaveLength(1);
    const [script] = planners;
    const videos = workflow.nodes.filter(n => n.type === 'ai-video-generate');
    const audio = workflow.nodes.find(n => n.type === 'ai-audio')!;
    expect(videos).toHaveLength(7);
    const scenes = videos.map((_, index) => ({
      prompt: `单独的镜头 ${index + 1}`, narration: `第 ${index + 1} 段旁白`,
    }));
    const storyboard = '```json\n' + JSON.stringify({ scenes }) + '\n```';
    const output = parseApiOutput('ai-llm', { choices: [{ message: { content: storyboard } }] });
    expect(output.text).toBe(storyboard);
    for (const [index, target] of [...videos, audio].entries()) {
      const request = requestWithOutputs(workflow, target, [[script.id, output]]);
      expect(request?.body).toMatchObject(index < 7
        ? { prompt: scenes[index].prompt, duration: 5 }
        : { text: scenes.map(scene => scene.narration).join('\n') });
    }
    const concat = workflow.nodes.find(n => n.type === 'video-concat')!;
    expect(workflow.connections.filter(c => c.toNodeId === concat.id).map(c => c.toPortId))
      .toEqual(['in-video-1', 'in-video-2', 'in-video-3', 'in-video-1', 'in-video-2', 'in-video-3', 'in-video-1']);
    const videoUrls = videos.map((_, i) => `https://example.test/scene-${i + 1}.mp4`);
    expect(requestWithOutputs(workflow, concat, videos.map((n, i) => [n.id, { videoUrl: videoUrls[i] }]))?.body)
      .toMatchObject({ action: 'concat-videos', videoUrls });
  });
  it('retains the existing text-to-image graph and valid ports', (): void => {
    const workflow = load('txt2img');
    expect(workflow.nodes.map(n => n.type)).toEqual(['input-text', 'ai-generate', 'output-image']);
    expect(workflow.connections).toHaveLength(2); expect(invalidEdges(workflow)).toEqual([]);
  });
  it('retains the image-to-video and voice composition graph', (): void => {
    const workflow = load('img2video-with-audio');
    expect(workflow.nodes.map(n => n.type)).toEqual(['input-image', 'input-text', 'ai-video-i2v', 'ai-audio', 'video-compose', 'output-video']);
    expect(workflow.connections).toHaveLength(6); expect(invalidEdges(workflow)).toEqual([]);
  });
});

function requestWithOutputs(workflow: Workflow, node: Workflow['nodes'][number], outputs: [string, Record<string, unknown>][]) {
  const results = new Map<string, ExecutionResult>(
    outputs.map(([nodeId, output]) => [nodeId, { nodeId, output, status: 'success', durationMs: 0 }]),
  );
  return buildNodeExecutionRequest(node, getNodeInputs(node, workflow.connections, results));
}

describe('catalog request wiring', () => {
  it('rejects an undeclared port instead of substituting the first one', () => {
    const preset = presets.find(candidate => candidate.id === 'txt2img')!;
    expect(() => createWorkflowFromPreset({
      ...preset, connections: [{ ...preset.connections[0], toPort: 'in-missing' }],
    })).toThrow('in-missing');
  });

  it.each(presets.map(preset => preset.id))('loads %s with every declared port and edge intact', id => {
    const workflow = load(id);
    const preset = presets.find(candidate => candidate.id === id)!;
    expect(invalidEdges(workflow)).toEqual([]);
    expect(workflow.connections.map(edge => [edge.fromPortId, edge.toPortId])).toEqual(
      preset.connections.map(edge => [edge.fromPort, edge.toPort]),
    );
  });

  it.each([['ecom-product-grid', 6], ['social-9grid', 9]] as const)('%s plans from the supplied image and produces %i distinct requests', (id, count) => {
    const workflow = load(id);
    const imageUrl = 'https://example.test/product.png';
    const image = workflow.nodes.find(node => node.type === 'input-image')!;
    const planner = workflow.nodes.find(node => node.type === 'ai-llm')!;
    const brief = workflow.nodes.find(node => node.type === 'input-text')!;
    const request = requestWithOutputs(workflow, planner, [[image.id, { imageUrl }], [brief.id, { text: '新品上市' }]]);
    expect(request?.body.messages).toEqual([
      { role: 'system', content: expect.any(String) },
      { role: 'user', content: [{ type: 'text', text: '新品上市' }, { type: 'image_url', image_url: { url: imageUrl } }] },
    ]);
    const generators = workflow.nodes.filter(node => node.type === 'ai-generate');
    expect(generators).toHaveLength(count);
    for (const [index, node] of generators.entries()) {
      expect(requestWithOutputs(workflow, node, [[planner.id, { text: '编号策划' }], [image.id, { imageUrl }]])?.body)
        .toMatchObject({ prompt: expect.stringContaining(`第${index + 1}项`), imageUrl });
    }
  });

  it('retouches the removed-background result and upscales only the retouched image', () => {
    const workflow = load('full-pipeline');
    const [original, instruction, removebg, retouch, upscale] = workflow.nodes;
    const originalUrl = 'https://example.test/original.png';
    const removedUrl = 'https://example.test/transparent.png';
    const retouchedUrl = 'https://example.test/retouched.png';
    expect(requestWithOutputs(workflow, retouch, [[original.id, { imageUrl: originalUrl }],
      [removebg.id, { imageUrl: removedUrl }], [instruction.id, { text: '优化光影' }]])?.body)
      .toMatchObject({ image: removedUrl, prompt: '优化光影' });
    expect(requestWithOutputs(workflow, upscale, [[removebg.id, { imageUrl: removedUrl }],
      [retouch.id, { imageUrl: retouchedUrl }]])?.body).toMatchObject({ imageUrl: retouchedUrl });
  });
});

const executePath = path.resolve('src/app/api/workflow/execute/route.ts');
const executeSource = ts.createSourceFile(executePath, fs.readFileSync(executePath, 'utf8'), ts.ScriptTarget.Latest, true);
const outputParser = executeSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'parseApiOutput');
if (!outputParser) throw Error('WORKFLOW_API_OUTPUT_PARSER_NOT_FOUND');
const parseApiOutput = runInNewContext(javascript(outputParser)) as (
  nodeType: 'ai-llm', data: Record<string, unknown>
) => Record<string, unknown>;

it('maps chat-completions text for LLM nodes while preserving the existing direct text contract', () => {
  const choices = [{ message: { content: '一张产品主图' } }];
  expect(parseApiOutput('ai-llm', { choices })).toEqual({ text: '一张产品主图' });
  expect(parseApiOutput('ai-llm', { choices, text: '直接文本' })).toEqual({ text: '直接文本' });
  expect(parseApiOutput('ai-llm', { choices: [{ message: { content: null } }] })).toEqual({});
  expect(parseApiOutput('ai-llm', { choices: [{ message: { content: '   ' } }] })).toEqual({});
});

it.each([
  ['missing result', undefined],
  ['unstructured text', 'some story'],
  ['wrong scene count', JSON.stringify({ scenes: [{ prompt: 'scene', narration: 'voice' }] })],
  ['blank narration', JSON.stringify({ scenes: Array.from({ length: 7 }, () => ({ prompt: 'scene', narration: ' ' })) })],
])('rejects %s before creating video and narration requests', (_label, text) => {
  const workflow = load('ecom-video-storyboard');
  const script = workflow.nodes.find(node => node.type === 'ai-llm')!;
  for (const node of workflow.nodes.filter(n => n.type === 'ai-video-generate' || n.type === 'ai-audio')) {
    expect(() => requestWithOutputs(workflow, node, text === undefined ? [] : [[script.id, { text }]]))
      .toThrow('分镜脚本');
  }
});

it('appends a slot-aware ComfyUI import through the editor button and rejects invalid or colliding imports', async () => {
  if (!importButton) throw Error('WORKFLOW_IMPORT_BUTTON_NOT_FOUND');
  const workflow = load('txt2img');
  const current = { current: workflow };
  const alert = vi.fn();
  const updateWorkflow = vi.fn((next: Workflow | ((prev: Workflow) => Workflow)) => {
    current.current = typeof next === 'function' ? next(current.current) : next;
  });
  const input: { click: () => void; onchange?: (event: unknown) => Promise<void> } = { click: vi.fn() };
  const click = runInNewContext(javascript(importButton), {
    document: { createElement: () => input }, importWorkflowFile, alert, updateWorkflow, wfRef: current,
  }) as () => void;
  const upload = (data: unknown) => input.onchange!({ target: { files: [{ text: async () => JSON.stringify(data) }] } });
  click();
  const nodes = [{ id: 1, type: 'CLIPTextEncode' }, { id: 2, type: 'KSampler' }];
  await upload({ nodes, links: [[1, 1, 1, 2, 1, 'STRING']] });
  expect(current.current.nodes).toHaveLength(workflow.nodes.length + 2);
  expect(current.current.connections.at(-1)).toMatchObject({
    fromPortId: 'out-prompt', toPortId: 'in-prompt', type: 'prompt',
  });
  await upload({ nodes, links: [[1, 1, 4, 2, 1, 'STRING']] });
  await upload(workflow);
  expect(updateWorkflow).toHaveBeenCalledTimes(1);
  expect(alert).toHaveBeenCalledTimes(2);
});
