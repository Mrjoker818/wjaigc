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

    expect(diff).toEqual({
      missingNodeIds: [],
      extraNodeIds: [],
      mismatchedNodeIds: [],
      mismatchedPortIds: [],
      mismatchedEdgeIds: [],
      mismatchedSelectionNodeIds: [],
      mismatchedGeometryNodeIds: [],
      viewportMismatch: false,
    });
  });

  it.each([
    ['complete node data', (model: ReturnType<typeof projectReactFlowRenderModel>) => {
      model.nodes[0]!.workflowNode.config = { injected: true };
    }, 'mismatchedNodeIds'],
    ['node type', (model: ReturnType<typeof projectReactFlowRenderModel>) => {
      model.nodes[0]!.type = 'ai-generate';
    }, 'mismatchedNodeIds'],
    ['node label', (model: ReturnType<typeof projectReactFlowRenderModel>) => {
      model.nodes[0]!.label = 'drifted';
    }, 'mismatchedNodeIds'],
    ['port label', (model: ReturnType<typeof projectReactFlowRenderModel>) => {
      model.nodes[0]!.ports[0]!.label = 'drifted';
    }, 'mismatchedPortIds'],
    ['selection', (model: ReturnType<typeof projectReactFlowRenderModel>) => {
      model.nodes[0]!.selected = true;
    }, 'mismatchedSelectionNodeIds'],
    ['position', (model: ReturnType<typeof projectReactFlowRenderModel>) => {
      model.nodes[0]!.position.x += 1;
    }, 'mismatchedGeometryNodeIds'],
    ['size', (model: ReturnType<typeof projectReactFlowRenderModel>) => {
      model.nodes[0]!.size.height += 1;
    }, 'mismatchedGeometryNodeIds'],
    ['complete edge data', (model: ReturnType<typeof projectReactFlowRenderModel>) => {
      model.edges[0]!.workflowConnection.type = 'data';
    }, 'mismatchedEdgeIds'],
    ['edge endpoint', (model: ReturnType<typeof projectReactFlowRenderModel>) => {
      model.edges[0]!.target.portId = 'drifted';
    }, 'mismatchedEdgeIds'],
    ['viewport', (model: ReturnType<typeof projectReactFlowRenderModel>) => {
      model.viewport.zoom = 0.5;
    }, 'viewportMismatch'],
  ] as const)('detects injected %s drift', (_label, injectDrift, expectedField) => {
    const workflow = createEmptyWorkflow('drift');
    const source = createWorkflowNode('input-text', 10, 20, 'source');
    const target = createWorkflowNode('ai-generate', 260, 20, 'target');
    workflow.nodes = [source, target];
    workflow.connections = [{
      id: 'edge', fromNodeId: source.id, fromPortId: 'out-prompt',
      toNodeId: target.id, toPortId: 'in-prompt', type: 'prompt',
    }];
    const viewport = { x: 8, y: 12, zoom: 1 };
    const legacy = projectLegacyRenderModel(workflow, viewport);
    const shadow = projectReactFlowRenderModel(workflow, viewport);

    injectDrift(shadow);
    const diff = compareWorkflowRenderers(legacy, shadow);

    if (expectedField === 'viewportMismatch') {
      expect(diff.viewportMismatch).toBe(true);
    } else {
      expect(diff[expectedField]).toContain(expectedField === 'mismatchedEdgeIds' ? 'edge' : source.id);
    }
  });
});
