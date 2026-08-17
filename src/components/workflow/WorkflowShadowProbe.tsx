import { useMemo } from 'react';

import { compareWorkflowRenderers } from '@/lib/workflow-renderer/shadow';
import type { WorkflowRenderModel } from '@/lib/workflow-renderer/view-model';

interface WorkflowShadowProbeProps {
  legacyModel: WorkflowRenderModel;
  shadowModel: WorkflowRenderModel;
}

/** Computes an invisible parity diagnostic; it intentionally has no effects or commands. */
export function WorkflowShadowProbe({ legacyModel, shadowModel }: WorkflowShadowProbeProps) {
  const diff = useMemo(
    () => compareWorkflowRenderers(legacyModel, shadowModel),
    [legacyModel, shadowModel],
  );
  const isInSync = diff.missingNodeIds.length === 0
    && diff.extraNodeIds.length === 0
    && diff.mismatchedNodeIds.length === 0
    && diff.mismatchedPortIds.length === 0
    && diff.mismatchedEdgeIds.length === 0
    && diff.mismatchedSelectionNodeIds.length === 0
    && diff.mismatchedGeometryNodeIds.length === 0
    && !diff.viewportMismatch;

  return <output data-workflow-shadow-probe hidden aria-hidden="true" data-in-sync={isInSync ? 'true' : 'false'} />;
}
