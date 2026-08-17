import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import {
  WorkflowLegacyNodeCard,
  type WorkflowLegacyNodeCardProps,
  type WorkflowLegacyPortRenderProps,
} from './WorkflowLegacyNodeCard';
import type { WorkflowRenderNode } from '@/lib/workflow-renderer/view-model';

export type WorkflowProductCardProps = Omit<WorkflowLegacyNodeCardProps, 'node' | 'layout'>;

export interface WorkflowFlowNodeData extends Record<string, unknown> {
  node: WorkflowRenderNode;
  readOnly: boolean;
  cardProps: WorkflowProductCardProps;
}

export type WorkflowFlowNode = Node<WorkflowFlowNodeData, 'workflow'>;

/** React Flow adapter around the same complete product card used by the legacy surface. */
export function WorkflowNodeCard({ data }: NodeProps<WorkflowFlowNode>) {
  const { node, readOnly, cardProps } = data;
  const renderPortHandle = ({ nodeId, port, direction, className, style, title }: WorkflowLegacyPortRenderProps) => (
    <Handle
      id={port.id}
      type={direction === 'in' ? 'target' : 'source'}
      position={direction === 'in' ? Position.Left : Position.Right}
      isConnectable={!readOnly}
      aria-label={`${port.label} ${direction === 'in' ? '输入' : '输出'}端口`}
      data-port-id={`${nodeId}-${direction}-${port.id}`}
      className={className}
      style={{ ...style, position: 'relative', transform: 'none', top: 'auto', left: 'auto', right: 'auto' }}
      title={title}
    />
  );
  return (
    <div
      data-workflow-node-id={node.id}
      className="relative"
      style={{ width: node.size.width, minHeight: node.size.height }}
    >
      <WorkflowLegacyNodeCard {...cardProps} node={node.workflowNode} layout="embedded" renderPortHandle={renderPortHandle} />
    </div>
  );
}
