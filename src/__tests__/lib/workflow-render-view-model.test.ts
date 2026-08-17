import { describe, expect, it } from 'vitest';

import {
  NODE_TYPE_LABELS,
  PORT_COMPATIBILITY,
  createEmptyWorkflow,
  createWorkflowNode,
  type NodeType,
} from '@/lib/workflow-engine';
import {
  projectWorkflowRenderModel,
  type WorkflowRenderViewport,
} from '@/lib/workflow-renderer/view-model';

const viewport: WorkflowRenderViewport = { x: 12, y: -8, zoom: 0.75 };

describe('workflow render view model', () => {
  it('projects every workflow node, edge, port, and viewport without changing the domain', () => {
    const workflow = createEmptyWorkflow('projection');
    const source = createWorkflowNode('input-image', 40, 64, 'source');
    const target = createWorkflowNode('ai-generate', 320, 64, 'target');
    workflow.nodes = [source, target];
    workflow.connections = [{
      id: 'edge-1',
      fromNodeId: source.id,
      fromPortId: 'out-image',
      toNodeId: target.id,
      toPortId: 'in-image',
      type: 'image',
    }];

    const model = projectWorkflowRenderModel(workflow, viewport);

    expect(model.nodes.map(node => node.id)).toEqual(workflow.nodes.map(node => node.id));
    expect(model.edges.map(edge => edge.id)).toEqual(workflow.connections.map(edge => edge.id));
    expect(model.nodes.find(node => node.id === source.id)?.ports).toEqual(source.ports);
    expect(model.viewport).toEqual(viewport);
    expect(workflow.nodes[0]).toBe(source);
  });

  it('projects every declared node type and leaves port compatibility semantics intact', () => {
    const workflow = createEmptyWorkflow('all node types');
    workflow.nodes = (Object.keys(NODE_TYPE_LABELS) as NodeType[]).map((type, index) => (
      createWorkflowNode(type, index * 24, index * 12)
    ));

    const model = projectWorkflowRenderModel(workflow, viewport);

    expect(model.nodes.map(node => node.type)).toEqual(workflow.nodes.map(node => node.type));
    for (const [output, inputs] of Object.entries(PORT_COMPATIBILITY)) {
      expect(PORT_COMPATIBILITY[output as keyof typeof PORT_COMPATIBILITY]).toEqual(inputs);
    }
  });
});
