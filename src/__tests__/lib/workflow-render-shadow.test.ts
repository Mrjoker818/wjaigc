import { describe, expect, it } from 'vitest';

import { createEmptyWorkflow, createWorkflowNode } from '@/lib/workflow-engine';
import {
  projectLegacyRenderModel,
  projectReactFlowRenderModel,
} from '@/lib/workflow-renderer/view-model';
import { compareWorkflowRenderers } from '@/lib/workflow-renderer/shadow';

describe('workflow renderer shadow comparison', () => {
  it('reports no render drift for the legacy and React Flow projections', () => {
    const workflow = createEmptyWorkflow('shadow');
    const source = createWorkflowNode('input-text', 0, 0);
    const target = createWorkflowNode('ai-generate', 260, 0);
    workflow.nodes = [source, target];
    workflow.connections = [{
      id: 'prompt-edge', fromNodeId: source.id, fromPortId: 'out-prompt',
      toNodeId: target.id, toPortId: 'in-prompt', type: 'prompt',
    }];
    const viewport = { x: 0, y: 0, zoom: 1 };

    const diff = compareWorkflowRenderers(
      projectLegacyRenderModel(workflow, viewport),
      projectReactFlowRenderModel(workflow, viewport),
    );

    expect(diff.missingNodeIds).toEqual([]);
    expect(diff.extraNodeIds).toEqual([]);
    expect(diff.mismatchedPortIds).toEqual([]);
    expect(diff.mismatchedEdgeIds).toEqual([]);
  });
});
