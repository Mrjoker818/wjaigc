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

const IDLE_OVERSCAN_FACTOR = 0;
const PAN_OVERSCAN_FACTOR = 0.5;

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
  const overscanFactor = isPanning ? PAN_OVERSCAN_FACTOR : IDLE_OVERSCAN_FACTOR;
  const overscanX = width * overscanFactor;
  const overscanY = height * overscanFactor;
  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);

  return {
    minX: overscanX === 0 ? (minX === 0 ? 0 : minX) : minX - overscanX,
    minY: overscanY === 0 ? (minY === 0 ? 0 : minY) : minY - overscanY,
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
