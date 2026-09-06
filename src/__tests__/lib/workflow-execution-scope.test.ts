import { describe, expect, it } from 'vitest';
import { createWorkflowNode, type WorkflowConnection } from '@/lib/workflow-engine';
import {
  isWorkflowExecutionScopeCurrent,
  resolveWorkflowExecutionScope,
} from '@/lib/workflow-execution-scope';

function graph() {
  const nodes = ['source', 'selected', 'left', 'right', 'dependency', 'sibling', 'isolated']
    .map(id => ({ ...createWorkflowNode('input-text', 0, 0), id }));
  const connections: WorkflowConnection[] = [
    ['source', 'selected'], ['selected', 'left'], ['selected', 'right'],
    ['dependency', 'right'], ['source', 'sibling'],
  ].map(([fromNodeId, toNodeId], index) => ({
    id: `edge-${index}`, fromNodeId, toNodeId, fromPortId: 'out-prompt', toPortId: 'in-prompt', type: 'prompt',
  }));
  return { nodes, connections };
}

describe('workflow execution scope', () => {
  it.each(['loop-for', 'loop-each', 'loop-while'] as const)('retains the %s body when running its completion chain', type => {
    const loop = { ...createWorkflowNode(type, 0, 0), id: 'loop' };
    const body = { ...createWorkflowNode('ai-skill', 0, 0), id: 'body' };
    const done = { ...createWorkflowNode('input-text', 0, 0), id: 'done' };
    const connections: WorkflowConnection[] = [
      { id: 'body-edge', fromNodeId: 'loop', toNodeId: 'body', fromPortId: 'out-loop', toPortId: 'in-prompt', type: 'prompt' },
      { id: 'done-edge', fromNodeId: 'loop', toNodeId: 'done', fromPortId: 'out-done', toPortId: 'in-prompt', type: 'prompt' },
    ];
    expect(resolveWorkflowExecutionScope({ nodes: [loop, body, done], connections, startNodeId: 'done' }).nodes.map(node => node.id))
      .toEqual(['loop', 'body', 'done']);
  });

  it('retains parallel siblings required by the upstream parallel controller', () => {
    const parallel = { ...createWorkflowNode('parallel', 0, 0), id: 'parallel' };
    const left = { ...createWorkflowNode('input-text', 0, 0), id: 'left' };
    const right = { ...createWorkflowNode('input-text', 0, 0), id: 'right' };
    const connections: WorkflowConnection[] = ['left', 'right'].map((id, index) => ({
      id, fromNodeId: 'parallel', toNodeId: id, fromPortId: `out-${index + 1}`, toPortId: 'in-prompt', type: 'prompt',
    }));
    expect(resolveWorkflowExecutionScope({ nodes: [parallel, left, right], connections, startNodeId: 'left' }).nodes.map(node => node.id))
      .toEqual(['parallel', 'left', 'right']);
  });

  it('preserves whole-workflow execution when no start is supplied', () => {
    const input = graph();
    expect(resolveWorkflowExecutionScope(input)).toBe(input);
  });

  it('includes all downstream branches and their dependencies, not upstream siblings', () => {
    const input = graph();
    const scope = resolveWorkflowExecutionScope({ ...input, startNodeId: 'selected', tailNodeId: 'left' });
    expect(scope.nodes.map(node => node.id)).toEqual(['source', 'selected', 'left', 'right', 'dependency']);
    expect(scope.connections).toHaveLength(4);
    expect(input.nodes).toHaveLength(7);
    expect(input.connections).toHaveLength(5);
  });

  it('rejects a stale start rather than silently running all nodes', () => {
    expect(() => resolveWorkflowExecutionScope({ ...graph(), startNodeId: 'deleted' })).toThrow('运行起点不存在');
  });

  it('rejects an unrelated tail', () => {
    expect(() => resolveWorkflowExecutionScope({ ...graph(), startNodeId: 'selected', tailNodeId: 'isolated' })).toThrow('运行终点');
  });

  it('bounds traversal in a cycle and leaves cycle rejection to the executor', () => {
    const input = graph();
    input.connections.push({ id: 'cycle', fromNodeId: 'right', toNodeId: 'selected', fromPortId: 'out-prompt', toPortId: 'in-prompt', type: 'prompt' });
    expect(resolveWorkflowExecutionScope({ ...input, startNodeId: 'selected' }).nodes).toHaveLength(5);
  });

  it('keeps a pending estimate valid across an equivalent workflow hydration', () => {
    const input = graph();
    const scope = resolveWorkflowExecutionScope(input);
    const hydrated = structuredClone(input);

    expect(isWorkflowExecutionScopeCurrent(scope, hydrated.nodes, hydrated.connections)).toBe(true);
  });

  it('invalidates a pending estimate when execution-relevant configuration changes', () => {
    const input = graph();
    const scope = resolveWorkflowExecutionScope(input);
    const changed = structuredClone(input);
    changed.nodes[0].config = { ...changed.nodes[0].config, prompt: 'changed after quote' };

    expect(isWorkflowExecutionScopeCurrent(scope, changed.nodes, changed.connections)).toBe(false);
  });

  it('ignores disconnected changes outside a cascade execution scope', () => {
    const input = graph();
    const scope = resolveWorkflowExecutionScope({ ...input, startNodeId: 'selected', tailNodeId: 'left' });
    const changed = structuredClone(input);
    changed.nodes.find(node => node.id === 'isolated')!.config = { prompt: 'unrelated change' };

    expect(isWorkflowExecutionScopeCurrent(scope, changed.nodes, changed.connections)).toBe(true);
  });
});
