'use client';

import { useRef } from 'react';
import {
  Background,
  BaseEdge,
  ReactFlow,
  getBezierPath,
  type Connection,
  type Edge,
  type EdgeProps,
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
import type { WorkflowInteractionCommand } from '@/lib/workflow-renderer/commands';
import { WORKFLOW_RENDER_PORT_COLORS as PORT_COLORS } from '@/lib/workflow-renderer/presentation';
import type { WorkflowRenderEdge, WorkflowRenderModel, WorkflowRenderNode } from '@/lib/workflow-renderer/view-model';

interface WorkflowReactFlowSurfaceProps {
  model: WorkflowRenderModel;
  onCommand: (command: WorkflowInteractionCommand) => void;
  onViewportChange?: (viewport: WorkflowRenderModel['viewport']) => void;
  readOnly?: boolean;
  theme?: WorkflowLegacyNodeTheme;
  execResults?: Record<string, { status: string; output?: Record<string, unknown>; error?: string }>;
  execStatus?: string;
  highlightedNodeIds?: Set<string>;
  hoveredNodeId?: string | null;
  canvasImages?: WorkflowLegacyCanvasImageRef[];
  llmModels?: WorkflowLegacyModelOption[];
  imageModels?: WorkflowLegacyModelOption[];
  promptTemplates?: WorkflowLegacyPromptTemplate[];
  upstreamImageUrls?: Map<string, string>;
  cardCallbacks?: WorkflowLegacyCardCallbacks;
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
  selectedNodeIds: ReadonlySet<string>,
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
    isRunning: presentation.execStatus === 'running',
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
    onTriggerImageUpload: (...args) => invoke(callbacks?.onTriggerImageUpload, ...args),
    onImageFileDrop: (...args) => invoke(callbacks?.onImageFileDrop, ...args),
    onSavePromptPreset: (...args) => invoke(callbacks?.onSavePromptPreset, ...args),
    onDeletePromptPreset: (...args) => invoke(callbacks?.onDeletePromptPreset, ...args),
    onSelect: event => {
      if (readOnly) return;
      const nextSelectedNodeIds = new Set(selectedNodeIds);
      if (event?.ctrlKey || event?.metaKey) {
        if (nextSelectedNodeIds.has(renderNode.id)) nextSelectedNodeIds.delete(renderNode.id);
        else nextSelectedNodeIds.add(renderNode.id);
      } else {
        nextSelectedNodeIds.clear();
        nextSelectedNodeIds.add(renderNode.id);
      }
      presentation.onCommand?.({
        type: 'selection.set',
        nodeIds: [...nextSelectedNodeIds],
        transactionId: `react-flow-select:${renderNode.id}`,
      });
    },
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
): WorkflowFlowNode[] {
  const selectedNodeIds = new Set(model.nodes.filter(node => node.selected).map(node => node.id));
  return model.nodes.map(node => ({
    id: node.id,
    type: 'workflow',
    position: node.position,
    width: node.size.width,
    height: node.size.height,
    selected: node.selected,
    data: {
      node,
      readOnly,
      cardProps: createCardProps(node, readOnly, presentation, selectedNodeIds),
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
): WorkflowFlowEdge[] {
  return model.edges.map(edge => {
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
    ): void {
      const positions = nodes.flatMap(node => model.nodes.some(candidate => candidate.id === node.id)
        ? [{ nodeId: node.id, position: { ...node.position } }]
        : []);
      const initialPositions = positions.flatMap(item => {
        const node = model.nodes.find(candidate => candidate.id === item.nodeId);
        return node ? [{ nodeId: node.id, position: { ...node.position } }] : [];
      });
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

/** Controlled surface: React Flow owns interaction mechanics, never workflow state. */
export function WorkflowReactFlowSurface({
  model,
  onCommand,
  onViewportChange,
  readOnly = true,
  ...presentation
}: WorkflowReactFlowSurfaceProps) {
  const transactionCounterRef = useRef(0);
  const commandHandlers = createReactFlowCommandHandlers(model, onCommand, onViewportChange);
  const nextTransactionId = (prefix: string): string => `${prefix}:${++transactionCounterRef.current}`;
  return (
    <div data-workflow-react-flow-surface aria-hidden={readOnly ? 'true' : undefined} className="absolute inset-0">
      <ReactFlow<WorkflowFlowNode, WorkflowFlowEdge>
        nodes={createReactFlowNodes(model, readOnly, { ...presentation, onCommand })}
        edges={createReactFlowEdges(model, presentation.execResults, presentation.execStatus)}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        viewport={model.viewport}
        onViewportChange={readOnly ? undefined : commandHandlers.updateViewport}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        panOnDrag={!readOnly}
        zoomOnScroll={!readOnly}
        zoomOnPinch={!readOnly}
        zoomOnDoubleClick={!readOnly}
        onNodeDragStop={readOnly ? undefined : (_event, node, selectedNodes) => {
          commandHandlers.commitNodeDrag(
            selectedNodes.length > 0 ? selectedNodes : [node],
            nextTransactionId(`react-flow-drag:${node.id}`),
          );
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
