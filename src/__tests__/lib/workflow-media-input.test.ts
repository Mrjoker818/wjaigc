// @vitest-environment node
// Shipped engine functions and actual pure API-output parser only.
// No API handler import, HTTP, model, database, media files or processes.
import fs from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode, createConnection, createEmptyWorkflow, getNodeInputs, buildNodeExecutionRequest,
  isWorkflowConnectionValid, type WorkflowNode, type WorkflowConnection, type ExecutionResult, type NodeType } from '@/lib/workflow-engine';

const route = path.resolve('src/app/api/workflow/execute/route.ts');
const sf = ts.createSourceFile(route, fs.readFileSync(route, 'utf8'), ts.ScriptTarget.Latest, true);
const functions = sf.statements.filter((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'parseApiOutput');
if (functions.length !== 1) throw Error('QO_ACTUAL_OUTPUT_PARSER_NOT_UNIQUE');
const js = ts.transpileModule('(' + functions[0].getText(sf) + ')', {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
});
if (js.diagnostics?.length) throw Error('QO_OUTPUT_PARSER_TRANSPILE_ERROR');
const parsedFunction: unknown = runInNewContext(js.outputText);
if (typeof parsedFunction !== 'function') throw Error('QO_OUTPUT_PARSER_NOT_FUNCTION');
const parseOutput = parsedFunction as (type: NodeType, data: Record<string, unknown>) => Record<string, unknown>;
const CLIPS = Array.from({ length: 7 }, (_, i) => '/api/serve-upload/generated-videos/qo-owned-' + i + '.mp4');
const JOINED = '/api/serve-upload/generated-videos/qo-joined.mp4';
const AUDIO = '/generated-audio/qo-owned-voice.mp3';
const TEXT = 'QO 合成七段广告解说，禁止任何真实生成调用。';
let requests = 0;
function result(node: WorkflowNode, output: Record<string, unknown>): ExecutionResult {
  return { nodeId: node.id, status: 'success', output, durationMs: 0 };
}
function edge(from: WorkflowNode, to: WorkflowNode, type: 'video' | 'audio' | 'prompt', port: string): WorkflowConnection {
  const fromPort = from.ports.find(p => p.direction === 'out' && p.type === type);
  if (!fromPort) throw Error('QO_ACTUAL_SOURCE_PORT_MISSING');
  const value = createConnection(from.id, fromPort.id, to.id, port, type);
  const workflow = { ...createEmptyWorkflow('QO synthetic contract'), nodes: [from, to], connections: [value] };
  if (!isWorkflowConnectionValid(workflow, value)) throw Error('QO_SYNTHETIC_CONNECTION_INVALID');
  return value;
}
function concat(count: number): { node: WorkflowNode; sources: WorkflowNode[]; connections: WorkflowConnection[]; results: Map<string, ExecutionResult> } {
  const node = createWorkflowNode('video-concat', 0, 0);
  const sources = Array.from({ length: count }, (_, i) => createWorkflowNode('ai-video-generate', i * 200, 0));
  const connections = sources.map(source => edge(source, node, 'video', 'in-video-1'));
  const results = new Map(sources.map((source, i) => [source.id, result(source, parseOutput('ai-video-generate', { success: true, videoUrl: CLIPS[i] }))]));
  return { node, sources, connections, results };
}
function compose(): { node: WorkflowNode; connections: WorkflowConnection[]; results: Map<string, ExecutionResult> } {
  const video = createWorkflowNode('video-concat', 0, 0), audio = createWorkflowNode('ai-audio', 0, 100);
  const node = createWorkflowNode('video-compose', 300, 0);
  node.config = { ...node.config, volume: 0.4 };
  const connections = [edge(video, node, 'video', 'in-video'), edge(audio, node, 'audio', 'in-audio')];
  const results = new Map([
    [video.id, result(video, parseOutput('video-concat', { success: true, videoUrl: JOINED }))],
    [audio.id, result(audio, parseOutput('ai-audio', { success: true, audioUrl: AUDIO, duration: 7, format: 'mp3' }))],
  ]);
  return { node, connections, results };
}
beforeEach((): void => { requests = 0; vi.stubGlobal('fetch', (): never => { requests++; throw Error('QO_NO_REQUESTS_ALLOWED'); }); });
afterEach((): void => {
  try { expect(requests, 'QO_NO_REQUESTS_ALLOWED').toBe(0); console.log('QO_CONTRACT_CLEANUP ' + JSON.stringify({ requests })); }
  finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
describe('QO workflow media input contracts', (): void => {
  it('keeps every completed clip in connection order for the existing concat API', (): void => {
    const graph = concat(7), inputs = getNodeInputs(graph.node, graph.connections, graph.results);
    const request = buildNodeExecutionRequest(graph.node, inputs)!;
    console.log('QO_CONCAT_OBSERVATION ' + JSON.stringify({ clips: 7, actualUrls: request.body.videoUrls, action: request.body.action, requests }));
    expect(request.body.videoUrls, 'QO_CONCAT_PRESERVES_ALL_CLIPS').toEqual(CLIPS);
    expect(request.endpoint).toBe('/api/video/tools'); expect(request.body.action).toBe('concat-videos');
  });
  it('carries the real audio reply through parsing and the audio edge into composition', (): void => {
    const graph = compose(), inputs = getNodeInputs(graph.node, graph.connections, graph.results);
    const request = buildNodeExecutionRequest(graph.node, inputs)!;
    console.log('QO_AUDIO_OBSERVATION ' + JSON.stringify({ action: request.body.action, videoUrl: request.body.videoUrl, audioUrl: request.body.audioUrl, requests }));
    expect(request.body.action, 'QO_AUDIO_REACHES_COMPOSITOR').toBe('add-audio');
    expect(request.body).toMatchObject({ videoUrl: JOINED, audioUrl: AUDIO, volume: 0.4 });
  });
  it('uses connected narration as text when the audio node has no explicit text', (): void => {
    const script = createWorkflowNode('ai-llm', 0, 0), node = createWorkflowNode('ai-audio', 300, 0);
    const connection = edge(script, node, 'prompt', 'in-text');
    const inputs = getNodeInputs(node, [connection], new Map([[script.id, result(script, parseOutput('ai-llm', { text: TEXT }))]]));
    const request = buildNodeExecutionRequest(node, inputs)!;
    console.log('QO_NARRATION_OBSERVATION ' + JSON.stringify({ text: request.body.text, requests }));
    expect(request.body.text, 'QO_NARRATION_REACHES_AUDIO_API').toBe(TEXT);
    expect(request.endpoint).toBe('/api/audio/generate');
  });
  it('keeps blocked video and audio connections out of their destination inputs', (): void => {
    const graph = concat(3); graph.node.config.blockedInputs = [graph.connections[1].id];
    const request = buildNodeExecutionRequest(graph.node, getNodeInputs(graph.node, graph.connections, graph.results))!;
    expect(request.body.videoUrls).toEqual([CLIPS[0], CLIPS[2]]);
    const audio = compose(); audio.node.config.blockedInputs = [audio.connections[1].id];
    expect(getNodeInputs(audio.node, audio.connections, audio.results).audioUrl).toBeUndefined();
    expect(buildNodeExecutionRequest(audio.node, getNodeInputs(audio.node, audio.connections, audio.results))!.body.audioUrl).toBe('');
  });
  it('preserves an upstream group order and deliberate repeated clips without duplicating its primary alias', (): void => {
    const graph = concat(1);
    graph.results.set(graph.sources[0].id, result(graph.sources[0], { videoUrl: CLIPS[1], videoUrls: [CLIPS[1], null, '', '  ', 17, CLIPS[0], CLIPS[1]] }));
    const request = buildNodeExecutionRequest(graph.node, getNodeInputs(graph.node, graph.connections, graph.results))!;
    expect(request.body.videoUrls).toEqual([CLIPS[1], CLIPS[0], CLIPS[1]]);
  });
  it('retains explicit standalone collections and text while rejecting a malformed collection value', (): void => {
    const node = createWorkflowNode('video-concat', 0, 0); node.config.videoUrls = [CLIPS[2], CLIPS[0]];
    expect(buildNodeExecutionRequest(node, getNodeInputs(node, [], new Map()))!.body.videoUrls).toEqual([CLIPS[2], CLIPS[0]]);
    node.config.videoUrls = 'not-an-array';
    expect(buildNodeExecutionRequest(node, getNodeInputs(node, [], new Map()))!.body.videoUrls).toEqual([]);
    const audio = createWorkflowNode('ai-audio', 0, 0); audio.config.text = 'QO 手动配音';
    expect(buildNodeExecutionRequest(audio, { prompt: TEXT })!.body.text).toBe('QO 手动配音');
  });
  it('retains existing image and video output fields and ignores invalid audio URL values', (): void => {
    expect(parseOutput('ai-generate', { imageUrl: '/api/serve-upload/qo.png', videoUrl: JOINED })).toMatchObject({ imageUrl: '/api/serve-upload/qo.png', videoUrl: JOINED });
    for (const value of [null, 17, {}, '']) expect(parseOutput('ai-audio', { audioUrl: value }).audioUrl).toBeUndefined();
  });
  it('uses the existing concat action for a configured video-only composition collection', (): void => {
    const node = createWorkflowNode('video-compose', 0, 0); node.config.videoUrls = [CLIPS[0], CLIPS[1]];
    expect(buildNodeExecutionRequest(node, {})!.body).toMatchObject({ action: 'concat-videos', videoUrls: [CLIPS[0], CLIPS[1]], videoUrl: '' });
  });

  it('keeps inactive control outputs out of video and audio inputs', (): void => {
    const graph = concat(3);
    graph.results.set(graph.sources[1].id, result(graph.sources[1], { videoUrl: CLIPS[1], activePorts: [] }));
    expect(buildNodeExecutionRequest(graph.node, getNodeInputs(graph.node, graph.connections, graph.results))!.body.videoUrls).toEqual([CLIPS[0], CLIPS[2]]);
    const audio = compose();
    const connection = audio.connections[1], prior = audio.results.get(connection.fromNodeId)!;
    audio.results.set(connection.fromNodeId, { ...prior, output: { ...prior.output, activePorts: [] } });
    expect(getNodeInputs(audio.node, audio.connections, audio.results).audioUrl).toBeUndefined();
  });
});

