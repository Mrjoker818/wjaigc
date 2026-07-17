export interface WorkflowViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface WorkflowViewportSize {
  width: number;
  height: number;
}

export interface WorkflowCullingBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface WorkflowNodeBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkflowConnectionBounds {
  fromNodeId: string;
  toNodeId: string;
}

const OVERSCAN_FACTOR = 0.5;

function toCanvasOrigin(viewport: WorkflowViewport): { x: number; y: number } {
  return {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
  };
}

/**
 * Covers the path between React's committed viewport and the compositor
 * preview so a fast pan never unmounts nodes under the pointer.
 */
export function resolveWorkflowCullingBounds(
  committed: WorkflowViewport,
  preview: WorkflowViewport,
  viewportSize: WorkflowViewportSize,
  isPanning: boolean,
): WorkflowCullingBounds {
  const start = toCanvasOrigin(committed);
  const end = toCanvasOrigin(isPanning ? preview : committed);
  const zoom = isPanning ? preview.zoom : committed.zoom;
  const width = viewportSize.width / zoom;
  const height = viewportSize.height / zoom;
  const overscanX = width * OVERSCAN_FACTOR;
  const overscanY = height * OVERSCAN_FACTOR;

  return {
    minX: Math.min(start.x, end.x) - overscanX,
    minY: Math.min(start.y, end.y) - overscanY,
    maxX: Math.max(start.x + width, end.x + width) + overscanX,
    maxY: Math.max(start.y + height, end.y + height) + overscanY,
  };
}

export function getVisibleWorkflowNodeIds(
  nodes: WorkflowNodeBounds[],
  bounds: WorkflowCullingBounds,
  pinnedIds: Set<string> = new Set(),
  draggingNodeId: string | null = null,
): Set<string> {
  const visibleIds = new Set(pinnedIds);
  if (draggingNodeId) visibleIds.add(draggingNodeId);

  for (const node of nodes) {
    const intersects = node.x + node.width >= bounds.minX
      && node.x <= bounds.maxX
      && node.y + node.height >= bounds.minY
      && node.y <= bounds.maxY;
    if (intersects) visibleIds.add(node.id);
  }

  return visibleIds;
}

export function selectVisibleWorkflowConnections<T extends WorkflowConnectionBounds>(
  connections: T[],
  visibleNodeIds: Set<string>,
): T[] {
  return connections.filter(connection => (
    visibleNodeIds.has(connection.fromNodeId)
    && visibleNodeIds.has(connection.toNodeId)
  ));
}
