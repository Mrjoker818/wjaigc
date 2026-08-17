import type { WorkflowRenderModel } from './view-model';

export interface WorkflowShadowDiff {
  missingNodeIds: string[];
  extraNodeIds: string[];
  mismatchedNodeIds: string[];
  mismatchedPortIds: string[];
  mismatchedEdgeIds: string[];
  mismatchedSelectionNodeIds: string[];
  mismatchedGeometryNodeIds: string[];
  viewportMismatch: boolean;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Compares two render projections without invoking either renderer. */
export function compareWorkflowRenderers(
  legacy: WorkflowRenderModel,
  shadow: WorkflowRenderModel,
): WorkflowShadowDiff {
  const legacyNodes = new Map(legacy.nodes.map(node => [node.id, node]));
  const shadowNodes = new Map(shadow.nodes.map(node => [node.id, node]));
  const legacyEdges = new Map(legacy.edges.map(edge => [edge.id, edge]));
  const shadowEdges = new Map(shadow.edges.map(edge => [edge.id, edge]));
  const missingNodeIds = [...legacyNodes.keys()].filter(id => !shadowNodes.has(id));
  const extraNodeIds = [...shadowNodes.keys()].filter(id => !legacyNodes.has(id));
  const mismatchedNodeIds: string[] = [];
  const mismatchedPortIds: string[] = [];
  const mismatchedSelectionNodeIds: string[] = [];
  const mismatchedGeometryNodeIds: string[] = [];
  for (const [id, legacyNode] of legacyNodes) {
    const shadowNode = shadowNodes.get(id);
    if (!shadowNode) continue;
    if (legacyNode.type !== shadowNode.type
      || legacyNode.label !== shadowNode.label
      || !sameValue(legacyNode.workflowNode, shadowNode.workflowNode)) mismatchedNodeIds.push(id);
    if (!sameValue(legacyNode.ports, shadowNode.ports)) mismatchedPortIds.push(id);
    if (legacyNode.selected !== shadowNode.selected) mismatchedSelectionNodeIds.push(id);
    if (!sameValue(legacyNode.position, shadowNode.position)
      || !sameValue(legacyNode.size, shadowNode.size)) mismatchedGeometryNodeIds.push(id);
  }
  const mismatchedEdgeIds: string[] = [];
  for (const [id, legacyEdge] of legacyEdges) {
    const shadowEdge = shadowEdges.get(id);
    if (!shadowEdge || legacyEdge.source.nodeId !== shadowEdge.source.nodeId
      || legacyEdge.source.portId !== shadowEdge.source.portId
      || legacyEdge.target.nodeId !== shadowEdge.target.nodeId
      || legacyEdge.target.portId !== shadowEdge.target.portId
      || legacyEdge.type !== shadowEdge.type
      || !sameValue(legacyEdge.workflowConnection, shadowEdge.workflowConnection)) {
      mismatchedEdgeIds.push(id);
    }
  }
  for (const id of shadowEdges.keys()) {
    if (!legacyEdges.has(id)) mismatchedEdgeIds.push(id);
  }
  return {
    missingNodeIds,
    extraNodeIds,
    mismatchedNodeIds,
    mismatchedPortIds,
    mismatchedEdgeIds,
    mismatchedSelectionNodeIds,
    mismatchedGeometryNodeIds,
    viewportMismatch: !sameValue(legacy.viewport, shadow.viewport),
  };
}
