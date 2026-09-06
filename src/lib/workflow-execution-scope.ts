import type { WorkflowConnection, WorkflowNode } from '@/lib/workflow-engine';

export interface WorkflowExecutionScope {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  startNodeId?: string;
  tailNodeId?: string;
}

export function resolveWorkflowExecutionScope(input: WorkflowExecutionScope): WorkflowExecutionScope {
  if (input.startNodeId === undefined) return input;
  const ids = new Set(input.nodes.map(node => node.id));
  if (!ids.has(input.startNodeId)) throw new Error('运行起点不存在，请重新选择节点');
  const downstream = new Map<string, string[]>();
  const upstream = new Map<string, string[]>();
  for (const edge of input.connections) {
    if (!ids.has(edge.fromNodeId) || !ids.has(edge.toNodeId)) {
      throw new Error('工作流连线引用了不存在的节点');
    }
    downstream.set(edge.fromNodeId, [...(downstream.get(edge.fromNodeId) ?? []), edge.toNodeId]);
    upstream.set(edge.toNodeId, [...(upstream.get(edge.toNodeId) ?? []), edge.fromNodeId]);
  }
  const reachable = new Set<string>();
  const visit = (seeds: string[], edges: Map<string, string[]>): void => {
    const pending = [...seeds];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      reachable.add(id);
      pending.push(...(edges.get(id) ?? []));
    }
  };
  visit([input.startNodeId], downstream);
  if (input.tailNodeId !== undefined && !reachable.has(input.tailNodeId)) {
    throw new Error('运行终点不在所选节点的下游链路中');
  }
  // Include dependencies of every downstream branch, but not unrelated siblings.
  visit([...reachable], upstream);
  // Controllers execute branches that are not graph ancestors of their completion output.
  let previousSize = -1;
  while (previousSize !== reachable.size) {
    previousSize = reachable.size;
    for (const node of input.nodes) {
      if (!reachable.has(node.id)) continue;
      const isLoop = node.type === 'loop-for' || node.type === 'loop-each' || node.type === 'loop-while';
      if (!isLoop && node.type !== 'parallel') continue;
      const outgoing = input.connections.filter(edge => edge.fromNodeId === node.id);
      const explicitBody = outgoing.filter(edge => edge.fromPortId === 'out-loop');
      const branches = !isLoop ? outgoing : explicitBody.length > 0
        ? explicitBody : outgoing.filter(edge => edge.fromPortId !== 'out-done');
      visit(branches.map(edge => edge.toNodeId), downstream);
    }
    visit([...reachable], upstream);
  }
  return {
    ...input,
    nodes: input.nodes.filter(node => reachable.has(node.id)),
    connections: input.connections.filter(edge => reachable.has(edge.fromNodeId) && reachable.has(edge.toNodeId)),
  };
}

export function isWorkflowExecutionScopeCurrent(
  quotedScope: WorkflowExecutionScope,
  currentNodes: WorkflowNode[],
  currentConnections: WorkflowConnection[],
): boolean {
  try {
    const currentScope = resolveWorkflowExecutionScope({
      nodes: currentNodes,
      connections: currentConnections,
      ...(quotedScope.startNodeId === undefined ? {} : { startNodeId: quotedScope.startNodeId }),
      ...(quotedScope.tailNodeId === undefined ? {} : { tailNodeId: quotedScope.tailNodeId }),
    });
    return JSON.stringify(currentScope) === JSON.stringify(quotedScope);
  } catch {
    return false;
  }
}
