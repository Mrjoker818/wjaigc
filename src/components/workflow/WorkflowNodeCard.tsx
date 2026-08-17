import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import type { WorkflowRenderNode } from '@/lib/workflow-renderer/view-model';

export interface WorkflowFlowNodeData extends Record<string, unknown> {
  node: WorkflowRenderNode;
}

export type WorkflowFlowNode = Node<WorkflowFlowNodeData, 'workflow'>;

/** Read-only React Flow node that mirrors labels and declared port IDs. */
export function WorkflowNodeCard({ data }: NodeProps<WorkflowFlowNode>) {
  const { node } = data;
  const inputPorts = node.ports.filter(port => port.direction === 'in');
  const outputPorts = node.ports.filter(port => port.direction === 'out');
  return (
    <div data-workflow-node-id={node.id} className="node-card" aria-label={node.label}>
      <div className="node-header"><span className="node-header-title">{node.label}</span></div>
      <div className="node-body">
        {inputPorts.map(port => (
          <Handle key={port.id} id={port.id} type="target" position={Position.Left} isConnectable={false}>
            <span data-workflow-port-id={port.id}>{port.label}</span>
          </Handle>
        ))}
        {outputPorts.map(port => (
          <Handle key={port.id} id={port.id} type="source" position={Position.Right} isConnectable={false}>
            <span data-workflow-port-id={port.id}>{port.label}</span>
          </Handle>
        ))}
      </div>
    </div>
  );
}
