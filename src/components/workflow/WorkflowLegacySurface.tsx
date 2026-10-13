'use client';

import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';

import type { NodePort, PortType, WorkflowConnection, WorkflowNode } from '@/lib/workflow-engine';
import type { WorkflowInteractionCommand } from '@/lib/workflow-renderer/commands';
import { WORKFLOW_RENDER_PORT_COLORS as PORT_COLORS } from '@/lib/workflow-renderer/presentation';
import type { WorkflowRenderModel } from '@/lib/workflow-renderer/view-model';
import { getLegacyPortWorldPosition } from '@/lib/workflow-renderer/legacy-port-position';
import {
  WorkflowLegacyNodeCard,
  type WorkflowLegacyCanvasImageRef,
  type WorkflowLegacyModelOption,
  type WorkflowLegacyNodeCardProps,
  type WorkflowLegacyPromptTemplate,
  type WorkflowLegacyNodeTheme,
} from './WorkflowLegacyNodeCard';

interface LegacyDraggingConnection {
  fromNodeId: string;
  fromPortId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  portType: PortType;
}

interface LegacyBoxSelect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export type WorkflowLegacyCardCallbacks = Omit<WorkflowLegacyNodeCardProps,
  'node' | 'isSelected' | 'isHighlighted' | 'isHovered' | 'execResult' | 'isRunning' | 'theme' |
  'canvasImages' | 'llmModels' | 'imageModels' | 'promptTemplates' | 'upstreamImageUrl' |
  'onSelect' | 'onHover' | 'onDragStart' | 'onContextMenu' | 'onDoubleClickAnnotation'> & {
  onSelect: (nodeId: string, event?: MouseEvent) => void;
  onHover: (nodeId: string | null) => void;
  onDragStart: (nodeId: string, event: MouseEvent) => void;
  onContextMenu?: (nodeId: string, event: MouseEvent) => void;
  onDoubleClickAnnotation?: (nodeId: string) => void;
};

export interface WorkflowLegacySurfaceProps {
  model: WorkflowRenderModel;
  onCommand: (command: WorkflowInteractionCommand) => void;
  visibleNodeIds?: ReadonlySet<string>;
  theme?: WorkflowLegacyNodeTheme;
  execResults?: Record<string, { status: string; output?: Record<string, unknown>; error?: string }>;
  execStatus?: string;
  executionNodeIds?: readonly string[];
  highlightedNodeIds?: Set<string>;
  hoveredNodeId?: string | null;
  canvasImages?: WorkflowLegacyCanvasImageRef[];
  llmModels?: WorkflowLegacyModelOption[];
  imageModels?: WorkflowLegacyModelOption[];
  promptTemplates?: WorkflowLegacyPromptTemplate[];
  upstreamImageUrls?: Map<string, string>;
  cardCallbacks?: WorkflowLegacyCardCallbacks;
  draggingConnection?: LegacyDraggingConnection | null;
  boxSelect?: LegacyBoxSelect | null;
  svgViewportTransformRef?: RefObject<SVGGElement | null>;
  nodeViewportTransformRef?: RefObject<HTMLDivElement | null>;
  getConnectionPath?: (fromX: number, fromY: number, toX: number, toY: number) => string;
  getPortPosition?: (node: WorkflowNode, port: NodePort) => { x: number; y: number } | null;
  isConnectionHighlighted?: (connection: WorkflowConnection) => boolean;
  onToggleConnectionBlocked?: (connection: WorkflowConnection, targetNode: WorkflowNode) => void;
}

export const DEFAULT_WORKFLOW_NODE_THEME: WorkflowLegacyNodeTheme = {
  accent: '#d4af37', badgeText: '#ffffff', border: '#30363d', btnBg: '#30363d', btnText: '#ffffff',
  cardBorder: '#30363d', connColor: '#d4af37', gridDot: '#30363d', inputBg: '#161b22', nodeBg: '#161b22',
  nodeBody: '#161b22', nodePortText: '#8b949e', nodeTitle: '#f0f6fc', optionBg: '#161b22', optionText: '#f0f6fc',
  statusError: '#ef4444', statusSuccess: '#22c55e', text: '#f0f6fc', textMuted: '#8b949e',
};

const noop = () => undefined;

function defaultConnectionPath(fromX: number, fromY: number, toX: number, toY: number): string {
  const dx = Math.abs(toX - fromX) * 0.5;
  return `M ${fromX} ${fromY} C ${fromX + dx} ${fromY}, ${toX - dx} ${toY}, ${toX} ${toY}`;
}

/** Legacy SVG/HTML composition with all state and side effects held by its host. */
export function WorkflowLegacySurface({
  model, onCommand, visibleNodeIds = new Set(model.nodes.map(node => node.id)), theme = DEFAULT_WORKFLOW_NODE_THEME,
  execResults = {}, execStatus = 'idle', executionNodeIds, highlightedNodeIds = new Set<string>(),
  hoveredNodeId = null, canvasImages, llmModels, imageModels, promptTemplates, upstreamImageUrls, cardCallbacks,
  draggingConnection, boxSelect, svgViewportTransformRef, nodeViewportTransformRef,
  getConnectionPath = defaultConnectionPath, getPortPosition, isConnectionHighlighted = () => false,
  onToggleConnectionBlocked,
}: WorkflowLegacySurfaceProps) {
  const nodeLayerRef = useRef<HTMLDivElement | null>(null);
  const [portPositions, setPortPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const setNodeLayerRef = useCallback((element: HTMLDivElement | null): void => {
    nodeLayerRef.current = element;
    if (nodeViewportTransformRef) nodeViewportTransformRef.current = element;
  }, [nodeViewportTransformRef]);

  const visibleNodes = model.nodes.filter(node => visibleNodeIds.has(node.id));
  // Track rendered membership, not Set identity (including the default Set).
  const visibleNodeKey = JSON.stringify(visibleNodes.map(node => node.id));

  useLayoutEffect(() => {
    const layer = nodeLayerRef.current;
    if (!layer) return;
    const measure = (): void => {
      const next = new Map<string, { x: number; y: number }>();
      for (const element of layer.querySelectorAll<HTMLElement>('[data-port-id]')) {
        const position = getLegacyPortWorldPosition(element, layer);
        if (position) next.set(element.dataset.portId!, position);
      }
      setPortPositions(previous => (
        previous.size === next.size && [...next].every(([id, position]) => {
          const old = previous.get(id);
          return old?.x === position.x && old.y === position.y;
        }) ? previous : next
      ));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const element of layer.querySelectorAll('[data-node-id], .node-body, .port-row, .input-card')) {
      observer?.observe(element);
    }
    layer.addEventListener('load', measure, true);
    layer.addEventListener('animationend', measure, true);
    return () => {
      observer?.disconnect();
      layer.removeEventListener('load', measure, true);
      layer.removeEventListener('animationend', measure, true);
    };
  }, [model.nodes, model.viewport, execResults, cardCallbacks?.collapsedNodes, visibleNodeKey]);

  const resolvePortPosition = (node: WorkflowNode, port: NodePort): { x: number; y: number } | null => {
    const measured = portPositions.get(`${node.id}-${port.direction}-${port.id}`);
    if (measured) return measured;
    const local = getPortPosition?.(node, port);
    return local ? { x: node.x + local.x, y: node.y + local.y } : null;
  };
  const projectedNodes = model.nodes.map(renderNode => ({
    ...renderNode.workflowNode,
    id: renderNode.id,
    type: renderNode.type,
    label: renderNode.label,
    x: renderNode.position.x,
    y: renderNode.position.y,
    width: renderNode.size.width,
    height: renderNode.size.height,
    ports: renderNode.ports.map(port => ({ ...port })),
  }));
  const nodeById = new Map(projectedNodes.map(node => [node.id, node]));
  const visibleEdges = model.edges.filter(edge => (
    visibleNodeIds.has(edge.source.nodeId) && visibleNodeIds.has(edge.target.nodeId)
  ));
  const cardProps = cardCallbacks ?? {
    onSelect: noop, onHover: noop, onDragStart: noop, onPortMouseDown: noop, onPortMouseUp: noop,
    onDelete: noop, onDeselect: noop, onPreviewImage: noop,
  };

  return (
    <div
      data-workflow-legacy-surface
      data-domain-node-count={model.nodes.length}
      data-domain-node-ids={model.nodes.map(node => node.id).join(' ')}
      className="absolute inset-0"
    >
      <svg data-workflow-legacy-edge-layer className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }} aria-hidden="true">
        <defs>
          <marker id="arrow-image" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill={PORT_COLORS.image} /></marker>
          <marker id="arrow-prompt" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill={PORT_COLORS.prompt} /></marker>
          <marker id="arrow-mask" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill={PORT_COLORS.mask} /></marker>
          <marker id="arrow-condition" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill={PORT_COLORS.condition} /></marker>
          <marker id="arrow-data" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill={PORT_COLORS.data} /></marker>
          <marker id="arrow-default" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill={theme.connColor} /></marker>
        </defs>
        <g ref={svgViewportTransformRef} transform={`translate(${model.viewport.x}, ${model.viewport.y}) scale(${model.viewport.zoom})`}>
          {visibleEdges.map(renderEdge => {
            const connection: WorkflowConnection = {
              ...renderEdge.workflowConnection,
              id: renderEdge.id,
              fromNodeId: renderEdge.source.nodeId,
              fromPortId: renderEdge.source.portId,
              toNodeId: renderEdge.target.nodeId,
              toPortId: renderEdge.target.portId,
              type: renderEdge.type,
            };
            const fromNode = nodeById.get(connection.fromNodeId);
            const toNode = nodeById.get(connection.toNodeId);
            const fromPort = fromNode?.ports.find(port => port.id === connection.fromPortId);
            const toPort = toNode?.ports.find(port => port.id === connection.toPortId);
            const from = fromNode && fromPort ? resolvePortPosition(fromNode, fromPort) : null;
            const to = toNode && toPort ? resolvePortPosition(toNode, toPort) : null;
            if (!fromNode || !toNode || !fromPort || !toPort || !from || !to) return null;

            const color = PORT_COLORS[connection.type] || theme.connColor;
            const highlighted = isConnectionHighlighted(connection);
            const running = execStatus === 'running' && execResults[connection.fromNodeId]?.status === 'success';
            const blockedInputs = Array.isArray(toNode.config?.blockedInputs) ? toNode.config.blockedInputs as string[] : [];
            const blocked = blockedInputs.includes(connection.id);
            const markerId = connection.type === 'image' ? 'arrow-image' : connection.type === 'prompt' ? 'arrow-prompt' : connection.type === 'mask' ? 'arrow-mask' : connection.type === 'condition' ? 'arrow-condition' : connection.type === 'data' ? 'arrow-data' : 'arrow-default';
            const path = getConnectionPath(from.x, from.y, to.x, to.y);

            return <g key={connection.id} data-edge-id={connection.id}>
              {highlighted && !blocked && <path d={path} fill="none" stroke={color} strokeWidth={6} strokeOpacity={0.15} />}
              <path d={path} fill="none" stroke={blocked ? '#666' : color} strokeWidth={highlighted ? 3 : 2} strokeOpacity={blocked ? 0.3 : highlighted ? 1 : running ? 0.9 : 0.5} strokeLinecap="round" strokeDasharray={blocked ? '4 4' : undefined} markerEnd={blocked ? undefined : `url(#${markerId})`} className={running && !blocked ? 'animate-pulse' : 'transition-all duration-200'} />
              {running && !blocked && <><path d={path} fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.5} strokeDasharray="10 5" className="ne-conn-flowing" /><circle r={3} fill={color}><animateMotion dur="1.2s" repeatCount="indefinite" path={path} /></circle></>}
              {(connection.type !== 'any' && (highlighted || model.viewport.zoom > 0.6)) && <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 6} textAnchor="middle" fill={blocked ? '#666' : color} fontSize={10} fillOpacity={blocked ? 0.4 : 0.7} className="pointer-events-none">{blocked ? 'blocked' : connection.type}</text>}
              <g className="cursor-pointer" style={{ pointerEvents: 'stroke' }} onClick={event => { event.stopPropagation(); onToggleConnectionBlocked?.(connection, toNode); }}>
                <circle cx={(from.x + to.x) / 2} cy={(from.y + to.y) / 2} r={6} fill={blocked ? '#ef4444' : 'transparent'} stroke={blocked ? '#ef4444' : 'transparent'} strokeWidth={1} opacity={highlighted || blocked ? 1 : 0} className="transition-opacity" />
                {blocked && <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 + 3.5} textAnchor="middle" fill="white" fontSize={8} fontWeight="bold">✕</text>}
              </g>
              <path d={path} fill="none" stroke="transparent" strokeWidth={16} style={{ pointerEvents: 'stroke' }} onClick={() => onCommand({ type: 'connection.delete', connectionId: connection.id, transactionId: `legacy-connection-delete:${connection.id}` })} className="cursor-pointer" />
            </g>;
          })}
          {draggingConnection && <path d={getConnectionPath(draggingConnection.fromX, draggingConnection.fromY, draggingConnection.toX, draggingConnection.toY)} fill="none" stroke={PORT_COLORS[draggingConnection.portType]} strokeWidth={2} strokeDasharray="6 4" strokeOpacity={0.7} />}
          {boxSelect && (() => {
            const minX = Math.min(boxSelect.startX, boxSelect.endX);
            const minY = Math.min(boxSelect.startY, boxSelect.endY);
            const width = Math.abs(boxSelect.endX - boxSelect.startX);
            const height = Math.abs(boxSelect.endY - boxSelect.startY);
            return width < 5 && height < 5 ? null : <rect x={minX} y={minY} width={width} height={height} fill="rgba(212, 175, 55, 0.08)" stroke="rgba(212, 175, 55, 0.4)" strokeWidth={1} strokeDasharray="4 2" rx={2} />;
          })()}
        </g>
      </svg>

      <div data-workflow-legacy-node-layer ref={setNodeLayerRef} className="absolute inset-0" style={{ zIndex: 2, transform: `translate(${model.viewport.x}px, ${model.viewport.y}px) scale(${model.viewport.zoom})`, transformOrigin: '0 0', willChange: 'transform', contain: 'layout style' }}>
        {visibleNodes.map(renderNode => {
          const node = nodeById.get(renderNode.id)!;
          return <WorkflowLegacyNodeCard
          key={node.id} node={node} isSelected={renderNode.selected} isHighlighted={highlightedNodeIds.has(node.id)} isHovered={hoveredNodeId === node.id}
          execResult={execResults[node.id]} isRunning={execStatus === 'running' && (executionNodeIds?.includes(node.id) ?? true)} theme={theme} canvasImages={canvasImages} llmModels={llmModels} imageModels={imageModels} upstreamImageUrl={upstreamImageUrls?.get(node.id)}
          {...cardProps}
          promptTemplates={promptTemplates}
          onSelect={event => cardProps.onSelect(node.id, event)}
          onHover={id => cardProps.onHover(id)}
          onDragStart={event => cardProps.onDragStart(node.id, event)}
          onContextMenu={event => cardProps.onContextMenu?.(node.id, event)}
          onDoubleClickAnnotation={() => cardProps.onDoubleClickAnnotation?.(node.id)}
        />;
        })}
      </div>
    </div>
  );
}
