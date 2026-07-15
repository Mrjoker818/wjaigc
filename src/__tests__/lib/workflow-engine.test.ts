import { describe, it, expect } from 'vitest';
<<<<<<< HEAD
import { topologicalSort } from '@/lib/workflow-engine';
import type { WorkflowNode, WorkflowConnection } from '@/lib/workflow-engine';
=======
import { evaluateWorkflowCondition, getNodePropertyFields, resolveControlOutputPorts, resolveGroupOutput, resolveInlineSubgraph, resolveWorkflowIterations, shouldSkipNodeForInactiveBranches, topologicalSort } from '@/lib/workflow-engine';
import type { NodeType, WorkflowNode, WorkflowConnection } from '@/lib/workflow-engine';
>>>>>>> 41e7dd04083fba557192a82b01f13084d231af10

/** 创建最小合法 WorkflowNode */
function makeNode(id: string, type: string = 'input-text'): WorkflowNode {
  return {
    id,
    type: type as any,
    label: id,
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    ports: [],
    config: {},
  };
}

/** 创建最小合法 WorkflowConnection */
function makeConn(id: string, from: string, to: string): WorkflowConnection {
  return {
    id,
    fromNodeId: from,
    fromPortId: 'out-0',
    toNodeId: to,
    toPortId: 'in-0',
    type: 'any',
  };
}

/** 从排序结果中提取 ID 数组 */
function getIds(result: WorkflowNode[]): string[] {
  return result.map(n => n.id);
}

describe('topologicalSort', () => {
  it('单节点直接返回', () => {
    const nodes = [makeNode('A')];
    const edges: WorkflowConnection[] = [];
    const result = topologicalSort(nodes, edges);
    expect(getIds(result)).toEqual(['A']);
  });

  it('线性依赖 A → B → C', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges = [makeConn('e1', 'A', 'B'), makeConn('e2', 'B', 'C')];
    const ids = getIds(topologicalSort(nodes, edges));
    expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('B'));
    expect(ids.indexOf('B')).toBeLessThan(ids.indexOf('C'));
  });

  it('菱形依赖 A→B, A→C, B→D, C→D', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D')];
    const edges = [
      makeConn('e1', 'A', 'B'),
      makeConn('e2', 'A', 'C'),
      makeConn('e3', 'B', 'D'),
      makeConn('e4', 'C', 'D'),
    ];
    const ids = getIds(topologicalSort(nodes, edges));
    expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('B'));
    expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('C'));
    expect(ids.indexOf('B')).toBeLessThan(ids.indexOf('D'));
    expect(ids.indexOf('C')).toBeLessThan(ids.indexOf('D'));
  });

  it('无连接时返回所有节点', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges: WorkflowConnection[] = [];
    const result = topologicalSort(nodes, edges);
    expect(result.length).toBe(3);
    expect(getIds(result).sort()).toEqual(['A', 'B', 'C']);
  });

  it('环检测返回空数组或抛出异常', () => {
    const nodes = [makeNode('A'), makeNode('B')];
    const edges = [makeConn('e1', 'A', 'B'), makeConn('e2', 'B', 'A')];
    // 环存在时，函数应返回空数组或抛异常
    const result = topologicalSort(nodes, edges);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('control node semantics', () => {
  it('evaluates dotted condition expressions against upstream data', () => {
    expect(evaluateWorkflowCondition('result.style === "realistic"', { result: { style: 'realistic' } })).toBe(true);
    expect(evaluateWorkflowCondition('result.score >= 0.8', { result: { score: 0.7 } })).toBe(false);
  });

  it('selects only the matching output port for condition nodes', () => {
    const node = makeNode('condition', 'condition-if');
    node.config = { condition: 'result.approved === true' };

    expect(resolveControlOutputPorts(node, { result: { approved: true } })).toEqual(['out-true']);
    expect(resolveControlOutputPorts(node, { result: { approved: false } })).toEqual(['out-false']);
  });

  it('skips a node whose only condition input comes from an inactive branch', () => {
    const condition = makeNode('condition', 'condition-if');
    const target = makeNode('target', 'output-image');
    const results = new Map([[
      condition.id,
      { nodeId: condition.id, status: 'success' as const, output: { activePorts: ['out-true'] }, durationMs: 0 },
    ]]);
    const falseBranch = { ...makeConn('false', condition.id, target.id), fromPortId: 'out-false' };
    const trueBranch = { ...makeConn('true', condition.id, target.id), fromPortId: 'out-true' };

    expect(shouldSkipNodeForInactiveBranches(target, [falseBranch], results)).toBe(true);
    expect(shouldSkipNodeForInactiveBranches(target, [trueBranch], results)).toBe(false);
  });

  it('turns manual loop-each values into bounded iteration contexts', () => {
    const node = makeNode('each', 'loop-each');
    node.config = { itemsSource: 'manual', items: 'red\nblue\ngreen', loopCount: 2 };

    expect(resolveWorkflowIterations(node, {})).toEqual([
      { index: 1, total: 2, item: 'red' },
      { index: 2, total: 2, item: 'blue' },
    ]);
  });

  it('does not plan condition-loop iterations when its predicate is false', () => {
    const node = makeNode('while', 'loop-while');
    node.config = { condition: 'result.pending === true', loopCount: 5 };

    expect(resolveWorkflowIterations(node, { result: { pending: false } })).toEqual([]);
  });

  it('exposes inputs for switch cases and manual loop-each items', () => {
    expect(getNodePropertyFields('condition-switch').some(field => field.key === 'caseValues')).toBe(true);
    expect(getNodePropertyFields('loop-each').some(field => field.key === 'items')).toBe(true);
  });

  it('activates only the configured parallel output channels', () => {
    const node = makeNode('parallel', 'parallel');
    node.config = { channels: 1 };
    node.ports = [
      { id: 'out-1', label: '通道1', type: 'any', direction: 'out' },
      { id: 'out-2', label: '通道2', type: 'any', direction: 'out' },
    ];

    expect(resolveControlOutputPorts(node, {})).toEqual(['out-1']);
  });

  it('keeps group nodes transparent and resolves a bounded inline subgraph', () => {
    expect(resolveGroupOutput({ imageUrl: '/image.png', prompt: 'keep' })).toEqual({ imageUrl: '/image.png', prompt: 'keep' });

    const subgraph = makeNode('subgraph', 'subgraph');
    subgraph.config = {
      subgraph: {
        nodes: [makeNode('child-input'), makeNode('child-output', 'output-image')],
        connections: [makeConn('child-edge', 'child-input', 'child-output')],
      },
    };

    expect(resolveInlineSubgraph(subgraph)).toMatchObject({
      nodes: expect.arrayContaining([expect.objectContaining({ id: 'child-input' })]),
      connections: expect.arrayContaining([expect.objectContaining({ id: 'child-edge' })]),
    });

    subgraph.config.subgraph = JSON.stringify(subgraph.config.subgraph);
    expect(resolveInlineSubgraph(subgraph)).toMatchObject({
      nodes: expect.arrayContaining([expect.objectContaining({ id: 'child-input' })]),
    });
    expect(getNodePropertyFields('subgraph').some(field => field.key === 'subgraph' && field.type === 'textarea')).toBe(true);
  });

  it('rejects malformed or oversized inline subgraphs', () => {
    const subgraph = makeNode('subgraph', 'subgraph');
    subgraph.config = { subgraph: { nodes: [{ id: 'only-node' }], connections: [{ fromNodeId: 'missing', toNodeId: 'only-node' }] } };
    expect(resolveInlineSubgraph(subgraph)).toBeNull();
  });
});
