'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Background,
  BaseEdge,
  ReactFlow,
  getBezierPath,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeProps,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  WorkflowNodeCard,
  type WorkflowFlowNode,
  type WorkflowProductCardProps,
} from './WorkflowNodeCard';
import {
  DEFAULT_WORKFLOW_NODE_THEME,
  type WorkflowLegacyCardCallbacks,
} from './WorkflowLegacySurface';
import type {
  WorkflowLegacyCanvasImageRef,
  WorkflowLegacyModelOption,
  WorkflowLegacyPromptTemplate,
  WorkflowLegacyNodeTheme,
} from './WorkflowLegacyNodeCard';
import type { WorkflowInteractionCommand, WorkflowNodePosition } from '@/lib/workflow-renderer/commands';
import { WORKFLOW_RENDER_PORT_COLORS as PORT_COLORS } from '@/lib/workflow-renderer/presentation';
import type { WorkflowRenderEdge, WorkflowRenderModel, WorkflowRenderNode } from '@/lib/workflow-renderer/view-model';

interface WorkflowReactFlowSurfaceProps {
  model: WorkflowRenderModel;
  onCommand: (command: WorkflowInteractionCommand) => void;
  onNodeDragStart?: (positions: WorkflowNodePosition[]) => void;
  onNodeDragEnd?: (positions: WorkflowNodePosition[]) => void;
  onViewportChange?: (viewport: WorkflowRenderModel['viewport']) => void;
  readOnly?: boolean;
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
  visibleNodeIds?: ReadonlySet<string>;
}

type WorkflowReactFlowPresentation = Omit<WorkflowReactFlowSurfaceProps, 'model' | 'readOnly'>;

interface WorkflowFlowEdgeData extends Record<string, unknown> {
  portType: WorkflowRenderEdge['type'];
  color: string;
  running: boolean;
  blocked: boolean;
}

type WorkflowFlowEdge = Edge<WorkflowFlowEdgeData, 'workflow'>;

const nodeTypes = { workflow: WorkflowNodeCard };
const noop = () => undefined;

function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<WorkflowFlowEdge>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const color = data?.blocked ? '#666666' : data?.color ?? '#7d8590';
  return (
    <BaseEdge
      id={id}
      path={path}
      label={data?.blocked ? 'blocked' : data?.portType}
      style={{
        stroke: color,
        strokeWidth: data?.running ? 3 : 2,
        strokeDasharray: data?.blocked ? '4 4' : undefined,
        opacity: data?.blocked ? 0.35 : data?.running ? 0.95 : 0.65,
      }}
    />
  );
}

const edgeTypes = { workflow: WorkflowEdge };

function createCardProps(
  renderNode: WorkflowRenderNode,
  readOnly: boolean,
  presentation: Partial<WorkflowReactFlowPresentation>,
): WorkflowProductCardProps {
  const callbacks = presentation.cardCallbacks;
  const invoke = <Args extends unknown[]>(callback: ((...args: Args) => void) | undefined, ...args: Args): void => {
    if (!readOnly) callback?.(...args);
  };
  return {
    isSelected: renderNode.selected,
    isHighlighted: presentation.highlightedNodeIds?.has(renderNode.id) ?? false,
    isHovered: presentation.hoveredNodeId === renderNode.id,
    execResult: presentation.execResults?.[renderNode.id] ?? renderNode.workflowNode.execResult,
    isRunning: presentation.execStatus === 'running' && (presentation.executionNodeIds?.includes(renderNode.id) ?? true),
    theme: presentation.theme ?? DEFAULT_WORKFLOW_NODE_THEME,
    canvasImages: presentation.canvasImages,
    llmModels: presentation.llmModels,
    imageModels: presentation.imageModels,
    promptTemplates: presentation.promptTemplates,
    promptPresets: callbacks?.promptPresets,
    upstreamImageUrl: presentation.upstreamImageUrls?.get(renderNode.id),
    onNodeFieldChange: (...args) => invoke(callbacks?.onNodeFieldChange, ...args),
    onLlmOptimize: (...args) => invoke(callbacks?.onLlmOptimize, ...args),
    onCascadeRun: (...args) => invoke(callbacks?.onCascadeRun, ...args),
    onExtractToSource: (...args) => invoke(callbacks?.onExtractToSource, ...args),
    onGridSplit: (...args) => invoke(callbacks?.onGridSplit, ...args),
    onCompare: (...args) => invoke(callbacks?.onCompare, ...args),
    onSendToChat: (...args) => invoke(callbacks?.onSendToChat, ...args),
    onTriggerImageUpload: (...args) => invoke(callbacks?.onTriggerImageUpload, ...args),
    onImageFileDrop: (...args) => invoke(callbacks?.onImageFileDrop, ...args),
    onSavePromptPreset: (...args) => invoke(callbacks?.onSavePromptPreset, ...args),
    onDeletePromptPreset: (...args) => invoke(callbacks?.onDeletePromptPreset, ...args),
    // React Flow owns selection gestures in this surface. Publishing here as
    // well would toggle Ctrl/Command selection twice for one pointer gesture.
    onSelect: noop,
    onHover: id => invoke(callbacks?.onHover, id),
    onDragStart: noop,
    onPortMouseDown: noop,
    onPortMouseUp: noop,
    onDelete: noop,
    onDeselect: () => invoke(callbacks?.onDeselect),
    onPreviewImage: url => invoke(callbacks?.onPreviewImage, url),
    onResizeNode: (...args) => invoke(callbacks?.onResizeNode, ...args),
    onUpdateNodeSize: (...args) => invoke(callbacks?.onUpdateNodeSize, ...args),
    collapsedNodes: callbacks?.collapsedNodes,
    onToggleCollapse: (...args) => invoke(callbacks?.onToggleCollapse, ...args),
    onContextMenu: event => invoke(callbacks?.onContextMenu, renderNode.id, event),
    onDoubleClickAnnotation: () => invoke(callbacks?.onDoubleClickAnnotation, renderNode.id),
  };
}

export function createReactFlowNodes(
  model: WorkflowRenderModel,
  readOnly: boolean,
  presentation: Partial<WorkflowReactFlowPresentation> = {},
  visibleNodeIds: ReadonlySet<string> = new Set(model.nodes.map(node => node.id)),
): WorkflowFlowNode[] {
  return model.nodes.filter(node => visibleNodeIds.has(node.id)).map(node => ({
    id: node.id,
    type: 'workflow',
    position: node.position,
    width: node.size.width,
    height: node.size.height,
    selected: node.selected,
    data: {
      node,
      readOnly,
      cardProps: createCardProps(node, readOnly, presentation),
    },
    selectable: !readOnly,
    draggable: !readOnly,
    connectable: !readOnly,
  }));
}

export function createReactFlowEdges(
  model: WorkflowRenderModel,
  execResults: Record<string, { status: string }> = {},
  execStatus = 'idle',
  visibleNodeIds: ReadonlySet<string> = new Set(model.nodes.map(node => node.id)),
): WorkflowFlowEdge[] {
  return model.edges.filter(edge => (
    visibleNodeIds.has(edge.source.nodeId) && visibleNodeIds.has(edge.target.nodeId)
  )).map(edge => {
    const targetNode = model.nodes.find(node => node.id === edge.target.nodeId);
    const blockedInputs = Array.isArray(targetNode?.workflowNode.config.blockedInputs)
      ? targetNode.workflowNode.config.blockedInputs as string[]
      : [];
    const sourceResult = execResults[edge.source.nodeId]
      ?? model.nodes.find(node => node.id === edge.source.nodeId)?.workflowNode.execResult;
    return {
      id: edge.id,
      source: edge.source.nodeId,
      sourceHandle: edge.source.portId,
      target: edge.target.nodeId,
      targetHandle: edge.target.portId,
      type: 'workflow',
      data: {
        portType: edge.type,
        color: PORT_COLORS[edge.type],
        running: execStatus === 'running' && sourceResult?.status === 'success',
        blocked: blockedInputs.includes(edge.id),
      },
      animated: execStatus === 'running' && sourceResult?.status === 'success',
      selectable: false,
      focusable: false,
    };
  });
}

export function createReactFlowCommandHandlers(
  model: WorkflowRenderModel,
  onCommand: (command: WorkflowInteractionCommand) => void,
  onViewportChange?: (viewport: WorkflowRenderModel['viewport']) => void,
) {
  return {
    commitNodeDrag(
      nodes: ReadonlyArray<{ id: string; position: { x: number; y: number } }>,
      transactionId: string,
      dragInitialPositions?: ReadonlyArray<WorkflowNodePosition>,
    ): void {
      const positions = nodes.flatMap(node => model.nodes.some(candidate => candidate.id === node.id)
        ? [{ nodeId: node.id, position: { ...node.position } }]
        : []);
      const initialPositions = (dragInitialPositions ?? positions.flatMap(item => {
        const node = model.nodes.find(candidate => candidate.id === item.nodeId);
        return node ? [{ nodeId: node.id, position: { ...node.position } }] : [];
      })).map(item => ({ nodeId: item.nodeId, position: { ...item.position } }));
      if (positions.length === 0) return;
      onCommand({ type: 'nodes.drag.commit', initialPositions, positions, transactionId });
    },
    updateViewport(viewport: WorkflowRenderModel['viewport']): void {
      onViewportChange?.({ ...viewport });
    },
    createConnection(connection: Connection, transactionId: string): void {
      if (!connection.source || !connection.sourceHandle || !connection.target || !connection.targetHandle) return;
      const source = model.nodes.find(node => node.id === connection.source);
      const sourcePort = source?.ports.find(port => port.id === connection.sourceHandle);
      if (!sourcePort || sourcePort.direction !== 'out') return;
      onCommand({
        type: 'connection.create',
        transactionId,
        connection: {
          id: `react-flow:${transactionId}`,
          fromNodeId: connection.source,
          fromPortId: connection.sourceHandle,
          toNodeId: connection.target,
          toPortId: connection.targetHandle,
          type: sourcePort.type,
        },
      });
    },
  };
}

export function resolveReactFlowSelection(
  model: WorkflowRenderModel,
  nodeId: string,
  additive: boolean,
): string[] {
  const selectedNodeIds = new Set(
    model.nodes.filter(candidate => candidate.selected).map(candidate => candidate.id),
  );
  if (additive) {
    if (selectedNodeIds.has(nodeId)) selectedNodeIds.delete(nodeId);
    else selectedNodeIds.add(nodeId);
  } else {
    selectedNodeIds.clear();
    selectedNodeIds.add(nodeId);
  }
  return [...selectedNodeIds];
}

/** Controlled surface: React Flow owns interaction mechanics, never workflow state. */
export function WorkflowReactFlowSurface({
  model,
  onCommand,
  onNodeDragStart,
  onNodeDragEnd,
  onViewportChange,
  visibleNodeIds,
  readOnly = true,
  theme,
  execResults,
  execStatus,
  executionNodeIds,
  highlightedNodeIds,
  hoveredNodeId,
  canvasImages,
  llmModels,
  imageModels,
  promptTemplates,
  upstreamImageUrls,
  cardCallbacks,
}: WorkflowReactFlowSurfaceProps) {
  const transactionCounterRef = useRef(0);
  const dragInitialPositionsRef = useRef<WorkflowNodePosition[]>([]);
  const dragActiveRef = useRef(false);
  const commandHandlers = createReactFlowCommandHandlers(model, onCommand, onViewportChange);
  const nextTransactionId = useCallback((prefix: string): string => `${prefix}:${++transactionCounterRef.current}`, []);
  // A fresh onNodeClick invalidates every mounted React Flow node wrapper on
  // each local position update, even when the domain model has not changed.
  const handleNodeClick = useCallback<NodeMouseHandler<WorkflowFlowNode>>((event, node): void => {
    onCommand({
      type: 'selection.set',
      nodeIds: resolveReactFlowSelection(model, node.id, event.ctrlKey || event.metaKey),
      transactionId: nextTransactionId(`react-flow-select:${node.id}`),
    });
  }, [model, onCommand, nextTransactionId]);
  const presentation = useMemo<Partial<WorkflowReactFlowPresentation>>(() => ({
    onCommand,
    theme,
    execResults,
    execStatus,
    executionNodeIds,
    highlightedNodeIds,
    hoveredNodeId,
    canvasImages,
    llmModels,
    imageModels,
    promptTemplates,
    upstreamImageUrls,
    cardCallbacks,
  }), [
    onCommand,
    theme,
    execResults,
    execStatus,
    executionNodeIds,
    highlightedNodeIds,
    hoveredNodeId,
    canvasImages,
    llmModels,
    imageModels,
    promptTemplates,
    upstreamImageUrls,
    cardCallbacks,
  ]);
  const projectedNodes = useMemo(() => createReactFlowNodes(
    model,
    readOnly,
    presentation,
    visibleNodeIds,
  ), [model, presentation, readOnly, visibleNodeIds]);
  const projectedEdges = useMemo(() => createReactFlowEdges(
    model,
    presentation.execResults,
    presentation.execStatus,
    visibleNodeIds,
  ), [model, presentation.execResults, presentation.execStatus, visibleNodeIds]);
  const [flowNodes, setFlowNodes, onFlowNodesChange] = useNodesState(projectedNodes);

  useEffect(() => {
    if (!dragActiveRef.current) setFlowNodes(projectedNodes);
  }, [projectedNodes, setFlowNodes]);

  return (
    <div data-workflow-react-flow-surface aria-hidden={readOnly ? 'true' : 'false'} className="absolute inset-0">
      <ReactFlow<WorkflowFlowNode, WorkflowFlowEdge>
        nodes={flowNodes}
        onNodesChange={readOnly ? undefined : onFlowNodesChange}
        edges={projectedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        viewport={model.viewport}
        onViewportChange={readOnly ? undefined : commandHandlers.updateViewport}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        onNodeClick={readOnly ? undefined : handleNodeClick}
        onPaneClick={readOnly ? undefined : () => {
          onCommand({
            type: 'selection.set',
            nodeIds: [],
            transactionId: nextTransactionId('react-flow-select-clear'),
          });
        }}
        panOnDrag={!readOnly}
        zoomOnScroll={!readOnly}
        zoomOnPinch={!readOnly}
        zoomOnDoubleClick={!readOnly}
        onNodeDragStart={readOnly ? undefined : (_event, node, selectedNodes) => {
          dragActiveRef.current = true;
          const draggedNodes = selectedNodes.length > 0 ? selectedNodes : [node];
          dragInitialPositionsRef.current = draggedNodes.flatMap(draggedNode => {
            const initialNode = model.nodes.find(candidate => candidate.id === draggedNode.id);
            return initialNode
              ? [{ nodeId: initialNode.id, position: { ...initialNode.position } }]
              : [];
          });
          onNodeDragStart?.(dragInitialPositionsRef.current.map(item => ({
            nodeId: item.nodeId,
            position: { ...item.position },
          })));
        }}
        onNodeDragStop={readOnly ? undefined : (_event, node, selectedNodes) => {
          dragActiveRef.current = false;
          const draggedNodes = selectedNodes.length > 0 ? selectedNodes : [node];
          const finalPositions = draggedNodes.map(draggedNode => ({
            nodeId: draggedNode.id,
            position: { ...draggedNode.position },
          }));
          commandHandlers.commitNodeDrag(
            draggedNodes,
            nextTransactionId(`react-flow-drag:${node.id}`),
            dragInitialPositionsRef.current,
          );
          dragInitialPositionsRef.current = [];
          onNodeDragEnd?.(finalPositions);
        }}
        onConnect={readOnly ? undefined : connection => {
          commandHandlers.createConnection(connection, nextTransactionId('react-flow-connect'));
        }}
        onNodesDelete={readOnly ? undefined : nodes => {
          const nodeIds = nodes.map(node => node.id);
          if (nodeIds.length > 0) {
            onCommand({ type: 'nodes.delete', nodeIds, transactionId: nextTransactionId('react-flow-delete') });
          }
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
      </ReactFlow>
    </div>
  );
}
