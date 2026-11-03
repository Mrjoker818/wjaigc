// @vitest-environment node
// Executes the shipped preset declaration and the exact shipped load callback.
// No mounted editor, model, request, database or persisted workflow is used.
import fs from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyWorkflow, createWorkflowNode, createConnection, autoLayoutWorkflow, isWorkflowConnectionValid,
  type Workflow, type NodeType, type PortType } from '@/lib/workflow-engine';

interface Preset {
  id: string; name: string; description: string; icon: string; tags: string[];
  nodes: Array<{ type: NodeType; label: string; config?: Record<string, unknown> }>;
  connections: Array<{ from: number; to: number; fromPort: string; toPort: string; type: PortType }>;
}
interface CallbackCalls { update: number; selection: number; sidebar: string[]; directoryClose: number; requests: number; }
const calls: CallbackCalls = { update: 0, selection: 0, sidebar: [], directoryClose: 0, requests: 0 };
const file = path.resolve('src/components/node-editor.tsx');
const source = fs.readFileSync(file, 'utf8');
const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let presetsNode: ts.ArrayLiteralExpression | undefined, loaderNode: ts.ArrowFunction | undefined;
function locate(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    if (node.name.text === 'WORKFLOW_PRESETS' && node.initializer && ts.isArrayLiteralExpression(node.initializer)) presetsNode = node.initializer;
    if (node.name.text === 'handleLoadPreset' && node.initializer && ts.isCallExpression(node.initializer)
      && node.initializer.arguments[0] && ts.isArrowFunction(node.initializer.arguments[0])) loaderNode = node.initializer.arguments[0];
  }
  ts.forEachChild(node, locate);
}
locate(sf);
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
  const result = ts.transpileModule('(' + node.getText(sf) + ')', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true,
  });
  if (result.diagnostics?.length) throw Error('QN_ACTUAL_SOURCE_TRANSPILE_FAILURE');
  return result.outputText;
}
const presets = runInNewContext(javascript(presetsNode)) as Preset[];
if (!Array.isArray(presets)) throw Error('QN_ACTUAL_PRESETS_NOT_ARRAY');
function load(id: string): Workflow {
  const matches = presets.filter(p => p.id === id);
  if (matches.length !== 1) throw Error('QN_EXACT_PRESET_NOT_UNIQUE ' + id);
  let workflow: Workflow | undefined;
  const execute: unknown = runInNewContext(javascript(loaderNode!), {
    createEmptyWorkflow, createWorkflowNode, createConnection, autoLayoutWorkflow,
    updateWorkflow(value: Workflow): void { calls.update++; workflow = value; },
    setSelectedNodeIds(value: Set<string>): void { calls.selection++; expect(value.size).toBe(0); },
    setSidebarTab(value: string): void { calls.sidebar.push(value); },
    closeDirectoryOnMobile(): void { calls.directoryClose++; },
  });
  if (typeof execute !== 'function') throw Error('QN_ACTUAL_LOADER_NOT_FUNCTION');
  (execute as (preset: Preset) => void)(matches[0]);
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
    const script = workflow.nodes.find(n => n.type === 'ai-llm')!;
    const videos = workflow.nodes.filter(n => n.type === 'ai-video-generate');
    const audio = workflow.nodes.find(n => n.type === 'ai-audio')!;
    expect(videos).toHaveLength(7);
    for (const target of [...videos, audio]) {
      expect(workflow.connections.some(c => c.fromNodeId === script.id && c.toNodeId === target.id
        && c.fromPortId === 'out-text' && c.toPortId === (target.type === 'ai-audio' ? 'in-text' : 'in-prompt')
        && c.type === 'prompt'), 'QN_SCRIPT_REACHES_EACH_VIDEO_AND_VOICE').toBe(true);
    }
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
