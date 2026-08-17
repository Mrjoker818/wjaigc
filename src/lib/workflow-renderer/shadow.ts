import type { WorkflowRenderModel } from './view-model';

export interface WorkflowShadowDiff {
  missingNodeIds: string[];
  extraNodeIds: string[];
  mismatchedPortIds: string[];
  mismatchedEdgeIds: string[];
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
  const mismatchedPortIds: string[] = [];
  for (const [id, legacyNode] of legacyNodes) {
    const shadowNode = shadowNodes.get(id);
    if (!shadowNode) continue;
    if (legacyNode.ports.map(port => `${port.id}:${port.type}:${port.direction}`).join('|')
      !== shadowNode.ports.map(port => `${port.id}:${port.type}:${port.direction}`).join('|')) {
      mismatchedPortIds.push(id);
    }
  }
  const mismatchedEdgeIds: string[] = [];
  for (const [id, legacyEdge] of legacyEdges) {
    const shadowEdge = shadowEdges.get(id);
    if (!shadowEdge || legacyEdge.source.nodeId !== shadowEdge.source.nodeId
      || legacyEdge.source.portId !== shadowEdge.source.portId
      || legacyEdge.target.nodeId !== shadowEdge.target.nodeId
      || legacyEdge.target.portId !== shadowEdge.target.portId
      || legacyEdge.type !== shadowEdge.type) {
      mismatchedEdgeIds.push(id);
    }
  }
  for (const id of shadowEdges.keys()) {
    if (!legacyEdges.has(id)) mismatchedEdgeIds.push(id);
  }
  return { missingNodeIds, extraNodeIds, mismatchedPortIds, mismatchedEdgeIds };
}
