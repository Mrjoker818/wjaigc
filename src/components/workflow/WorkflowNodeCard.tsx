import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import {
  WorkflowLegacyNodeCard,
  type WorkflowLegacyNodeCardProps,
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
  const inputPorts = node.ports.filter(port => port.direction === 'in');
  const outputPorts = node.ports.filter(port => port.direction === 'out');
  return (
    <div
      data-workflow-node-id={node.id}
      className="relative"
      style={{ width: node.size.width, minHeight: node.size.height }}
    >
      <WorkflowLegacyNodeCard {...cardProps} node={node.workflowNode} layout="embedded" />
      {inputPorts.map((port, index) => (
        <Handle
          key={port.id}
          id={port.id}
          type="target"
          position={Position.Left}
          isConnectable={!readOnly}
          aria-label={`${port.label} 输入端口`}
          style={{ top: `${((index + 1) / (inputPorts.length + 1)) * 100}%` }}
        />
      ))}
      {outputPorts.map((port, index) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={Position.Right}
          isConnectable={!readOnly}
          aria-label={`${port.label} 输出端口`}
          style={{ top: `${((index + 1) / (outputPorts.length + 1)) * 100}%` }}
        />
      ))}
    </div>
  );
}
