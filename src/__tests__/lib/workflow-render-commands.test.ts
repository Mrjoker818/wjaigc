import { describe, expect, it } from 'vitest';

import {
  createEmptyWorkflow,
  createWorkflowNode,
  type Workflow,
} from '@/lib/workflow-engine';
import { applyWorkflowCommand } from '@/lib/workflow-renderer/commands';

function workflowFixture(): Workflow {
  const workflow = createEmptyWorkflow('commands');
  const source = createWorkflowNode('input-image', 10, 20, 'source');
  const target = createWorkflowNode('ai-generate', 180, 20, 'target');
  const text = createWorkflowNode('input-text', 10, 180, 'text');
  workflow.nodes = [source, target, text];
  workflow.connections = [{
    id: 'image-edge', fromNodeId: source.id, fromPortId: 'out-image',
    toNodeId: target.id, toPortId: 'in-image', type: 'image',
  }];
  return workflow;
}

describe('workflow render commands', () => {
  it('moves a drag transaction once for every selected node', () => {
    const workflow = workflowFixture();
    const moved = applyWorkflowCommand(workflow, {
      type: 'nodes.move', nodeIds: workflow.nodes.slice(0, 2).map(node => node.id),
      delta: { x: 24, y: -12 }, transactionId: 'drag-1',
    });

    expect(moved.historyEntries).toHaveLength(1);
    expect(moved.historyEntries[0]?.transactionId).toBe('drag-1');
    expect(moved.workflow.nodes[0]?.x).toBe(workflow.nodes[0]!.x + 24);
    expect(moved.workflow.nodes[1]?.y).toBe(workflow.nodes[1]!.y - 12);
  });

  it('rejects an invalid port connection without a history entry', () => {
    const workflow = workflowFixture();
    const invalid = applyWorkflowCommand(workflow, {
      type: 'connection.create',
      connection: {
        id: 'invalid-edge', fromNodeId: workflow.nodes[0]!.id, fromPortId: 'out-image',
        toNodeId: workflow.nodes[1]!.id, toPortId: 'in-prompt', type: 'image',
      },
      transactionId: 'invalid-connection',
    });

    expect(invalid.workflow).toBe(workflow);
    expect(invalid.historyEntries).toEqual([]);
  });

  it('deletes nodes with their connections in one reversible history transaction', () => {
    const workflow = workflowFixture();
    const deleted = applyWorkflowCommand(workflow, {
      type: 'nodes.delete', nodeIds: [workflow.nodes[0]!.id], transactionId: 'delete-source',
    });

    expect(deleted.workflow.nodes.map(node => node.id)).not.toContain(workflow.nodes[0]!.id);
    expect(deleted.workflow.connections).toEqual([]);
    expect(deleted.historyEntries[0]?.before).toBe(workflow);
  });

  it('copies selected nodes and preserves only their internal connections', () => {
    const workflow = workflowFixture();
    const copied = applyWorkflowCommand(workflow, {
      type: 'nodes.copy', nodeIds: workflow.nodes.slice(0, 2).map(node => node.id),
      offset: { x: 40, y: 40 }, transactionId: 'copy-pair',
    });

    expect(copied.workflow.nodes).toHaveLength(5);
    expect(copied.workflow.connections).toHaveLength(2);
    expect(copied.historyEntries).toHaveLength(1);
  });

  it('hydrates the server workflow without recording user history', () => {
    const workflow = workflowFixture();
    const hydrated = applyWorkflowCommand(workflow, {
      type: 'workflow.hydrate', workflow: { ...workflow, name: 'from server' }, transactionId: 'server-load',
    });

    expect(hydrated.workflow.name).toBe('from server');
    expect(hydrated.historyEntries).toEqual([]);
  });
});
