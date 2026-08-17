import type { ReactNode } from 'react';

import type { WorkflowInteractionCommand } from '@/lib/workflow-renderer/commands';
import type { WorkflowRenderModel } from '@/lib/workflow-renderer/view-model';

interface WorkflowLegacySurfaceProps {
  model: WorkflowRenderModel;
  onCommand: (command: WorkflowInteractionCommand) => void;
  children: (model: WorkflowRenderModel, onCommand: (command: WorkflowInteractionCommand) => void) => ReactNode;
}

/** Hosts the existing renderer without taking ownership of workflow state. */
export function WorkflowLegacySurface({ model, onCommand, children }: WorkflowLegacySurfaceProps) {
  return <div data-workflow-legacy-surface className="absolute inset-0">{children(model, onCommand)}</div>;
}
