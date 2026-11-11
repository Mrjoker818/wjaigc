import { describe, expect, it } from 'vitest';
import { createConnection, createWorkflowNode } from '@/lib/workflow-engine';
import { importWorkflowFile, isWorkflowGraph } from '@/lib/workflow-file';

function nativeGraph() {
  const source = createWorkflowNode('input-text', 0, 0);
  const target = createWorkflowNode('ai-generate', 200, 0);
  const edge = createConnection(source.id, 'out-prompt', target.id, 'in-prompt', 'prompt');
  return { id: 'old-id', projectId: 'old-project', name: 'Native', description: 'Example',
    nodes: [source, target], connections: [edge] };
}

describe('workflow file import', () => {
  it('round-trips native node data and legacy compatible edges with a fresh workflow identity', () => {
    const graph = nativeGraph();
    graph.connections[0].type = 'any';
    const json = JSON.stringify(graph);
    const imported = importWorkflowFile(json);
    const { name, description, nodes, connections } = JSON.parse(json);
    expect(imported).toMatchObject({ name, description, nodes, connections });
    expect(imported?.id).not.toBe(graph.id);
    expect(imported?.projectId).toBeUndefined();
  });

  it.each([
    ['unknown node type', (g: ReturnType<typeof nativeGraph>) => Object.assign(g.nodes[0], { type: 'constructor' })],
    ['unknown port type', (g: ReturnType<typeof nativeGraph>) => Object.assign(g.nodes[0].ports[0], { type: 'unknown' })],
    ['duplicate node ID', (g: ReturnType<typeof nativeGraph>) => g.nodes.push(g.nodes[0])],
    ['duplicate port ID', (g: ReturnType<typeof nativeGraph>) => g.nodes[0].ports.push(g.nodes[0].ports[0])],
    ['duplicate connection ID', (g: ReturnType<typeof nativeGraph>) => g.connections.push(g.connections[0])],
    ['missing node', (g: ReturnType<typeof nativeGraph>) => { g.connections[0].toNodeId = 'missing'; }],
    ['missing port', (g: ReturnType<typeof nativeGraph>) => { g.connections[0].toPortId = 'missing'; }],
    ['reversed port direction', (g: ReturnType<typeof nativeGraph>) => { g.connections[0].toPortId = 'out-image'; }],
    ['incompatible ports', (g: ReturnType<typeof nativeGraph>) => { g.connections[0].toPortId = 'in-image'; }],
    ['wrong connection type', (g: ReturnType<typeof nativeGraph>) => { g.connections[0].type = 'video'; }],
    ['self-edge', (g: ReturnType<typeof nativeGraph>) => {
      const node = g.nodes[1];
      g.connections.push(createConnection(node.id, 'out-image', node.id, 'in-image', 'image'));
    }],
    ['cycle', (g: ReturnType<typeof nativeGraph>) => {
      const node = g.nodes[1];
      const other = createWorkflowNode('ai-generate', 400, 0);
      g.nodes.push(other);
      g.connections.push(createConnection(node.id, 'out-image', other.id, 'in-image', 'image'),
        createConnection(other.id, 'out-image', node.id, 'in-image', 'image'));
    }],
  ] as const)('rejects %s at both native boundaries', (_label, mutate) => {
    const graph = nativeGraph();
    mutate(graph);
    expect(isWorkflowGraph(graph)).toBe(false);
    expect(importWorkflowFile(JSON.stringify(graph))).toBeNull();
  });

  it('binds nonzero ComfyUI frontend slots in each direction', () => {
    const nodes = [{ id: 1, type: 'CLIPTextEncode' }, { id: 2, type: 'KSampler' }];
    const imported = importWorkflowFile(JSON.stringify({ nodes, links: [[9, 1, 1, 2, 1, 'STRING']] }));
    expect(imported?.connections).toEqual([expect.objectContaining({
      fromPortId: 'out-prompt', toPortId: 'in-prompt', type: 'prompt',
    })]);
  });

  it.each([
    [9, 1, 5, 2, 0, 'IMAGE'], [9, 1, 0, 2, -1, 'IMAGE'],
    [9, 1, 0, 3, 0, 'IMAGE'], [9, 1, 0, 2, 1, 'IMAGE'],
    [9, 1, 0, 2, 0, 'MASK'],
  ])('rejects invalid ComfyUI frontend link %j %j %j %j %j %j', (...link) => {
    const nodes = [{ id: 1, type: 'LoadImage' }, { id: 2, type: 'KSampler' }];
    expect(importWorkflowFile(JSON.stringify({ nodes, links: [link] }))).toBeNull();
  });

  it('uses the names declared at a frontend slot and rejects duplicate link IDs', () => {
    const nodes = [
      { id: 1, type: 'CLIPTextEncode', outputs: [{ type: 'CONDITIONING' }] },
      { id: 2, type: 'KSampler', inputs: [{ name: 'positive' }, { name: 'image' }] },
      { id: 3, type: 'LoadImage', outputs: [{ type: 'IMAGE' }] },
    ];
    const links = [[1, 1, 0, 2, 0, 'CONDITIONING'], [2, 3, 0, 2, 1, 'IMAGE']];
    const imported = importWorkflowFile(JSON.stringify({ nodes, links }));
    expect(imported?.connections).toEqual([
      expect.objectContaining({ fromPortId: 'out-prompt', toPortId: 'in-prompt', type: 'prompt' }),
      expect.objectContaining({ fromPortId: 'out-image', toPortId: 'in-image', type: 'image' }),
    ]);
    links[1][0] = 1;
    expect(importWorkflowFile(JSON.stringify({ nodes, links }))).toBeNull();
  });

  it('keeps simple image imports working in both ComfyUI formats', () => {
    const nodes = [{ id: 1, type: 'LoadImage' }, { id: 2, type: 'PreviewImage' }];
    const frontend = { nodes, links: [[1, 1, 0, 2, 0, 'IMAGE']] };
    const api = { '1': { class_type: 'LoadImage', inputs: { image: 'product.png' } },
      '2': { class_type: 'PreviewImage', inputs: { images: ['1', 0] } } };
    for (const file of [frontend, api]) {
      const imported = importWorkflowFile(JSON.stringify(file));
      expect(imported?.nodes.map(node => node.type)).toEqual(['input-image', 'output-image']);
      expect(imported?.connections).toEqual([expect.objectContaining({
        fromPortId: 'out-image', toPortId: 'in-image', type: 'image',
      })]);
    }
  });

  it('keeps named image and prompt API bindings on the same sampler', () => {
    const api = {
      '1': { class_type: 'LoadImage', inputs: { image: 'product.png' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'product on a table' } },
      '3': { class_type: 'KSampler', inputs: { positive: ['2', 0], image: ['1', 0] } },
    };
    const imported = importWorkflowFile(JSON.stringify(api));
    expect(imported?.connections).toEqual([
      expect.objectContaining({ fromPortId: 'out-prompt', toPortId: 'in-prompt', type: 'prompt' }),
      expect.objectContaining({ fromPortId: 'out-image', toPortId: 'in-image', type: 'image' }),
    ]);
    expect(importWorkflowFile(JSON.stringify({
      ...api, '3': { ...api['3'], inputs: { negative: ['2', 0] } },
    }))).toBeNull();
  });
});
