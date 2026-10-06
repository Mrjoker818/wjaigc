import type { CanvasCommandNode } from '@/lib/canvas-kernel/commands';
import type { ImageGenerationSlot } from '@/lib/image-generation-session';
import { applyCanvasTaskEventToProcessingPlaceholders } from '@/lib/canvas-task-placeholders';
import { parseOrdinaryGenerationOutputGroup } from '@/lib/task-core/ordinary-generation-output-group';
import { createCanvasTaskEventError } from '@/lib/canvas-kernel/task-projection';

export interface OrdinaryGenerationProjectionContext {
  projectId: string;
  placeholderId: string;
  params: { providerId?: string; model?: string; prompt?: string; quality?: string; aspectRatio?: string; stylePreset?: string; size?: string };
}

/** Session-to-projector boundary, extracted from the workspace subscription. */
export function projectOrdinaryGenerationSlots<T extends CanvasCommandNode>(
  images: readonly T[], slots: readonly ImageGenerationSlot[], currentProjectId: string | undefined,
  contexts: ReadonlyMap<string, OrdinaryGenerationProjectionContext>,
): T[] {
  if (!currentProjectId) return images as T[];
  let next = images as T[];
  // Deduplicate this group's document entities before building the unique-ID snapshot.
  for (const slot of slots) {
    if (!slot.taskId || slot.projectId !== currentProjectId || slot.status !== 'completed' || !slot.placementId
      || !parseOrdinaryGenerationOutputGroup(slot.outputGroup, slot.taskId)
      || !slots.some(value => value.taskId === slot.taskId && value.projectId === currentProjectId
        && contexts.get(value.id)?.projectId === currentProjectId)) continue;
    const canonical = [...next].reverse().find(node => node.placementId === slot.placementId && node.id === slot.entityId)
      || next.find(node => node.placementId === slot.placementId);
    const context = contexts.get(slot.id);
    if (canonical) next = next.filter(node => node === canonical || (node.placementId !== slot.placementId
      && !(context?.projectId === currentProjectId && node.id === context.placeholderId && node.isProcessingPlaceholder)));
  }
  for (const slot of slots) {
    if (!slot.taskId || slot.projectId !== currentProjectId
      || !parseOrdinaryGenerationOutputGroup(slot.outputGroup, slot.taskId)
      || !Number.isInteger(slot.outputIndex) || slot.outputIndex! < 0) continue;
    const anchorSlot = slots.find(value => value.taskId === slot.taskId && value.projectId === currentProjectId
      && contexts.get(value.id)?.projectId === currentProjectId);
    const anchor = anchorSlot && contexts.get(anchorSlot.id);
    if (!anchor) continue;
    const ownContext = contexts.get(slot.id);
    if (ownContext && ownContext.projectId !== currentProjectId) continue;
    const context = ownContext || anchor;
    const outputIndex = slot.outputIndex!;
    const complete = slot.status === 'completed' && Boolean(slot.url && slot.assetVersionId && slot.placementId);
    if (slot.status === 'completed' && !complete) continue;
    if (complete) {
      const canonical = next.find(node => node.placementId === slot.placementId && node.id === slot.entityId)
        || next.find(node => node.placementId === slot.placementId);
      if (canonical) {
        next = next.filter(node => node === canonical || (node.placementId !== slot.placementId
          && !(ownContext && node.id === ownContext.placeholderId && node.isProcessingPlaceholder)));
      } else if (ownContext && next.some(node => node.id === ownContext.placeholderId)) {
        next = next.map(node => node.id === ownContext.placeholderId ? { ...node, id: slot.entityId || slot.placementId! } : node);
      } else {
        const template = images.find(node => node.id === anchor.placeholderId)
          || next.find(node => node.taskProjection?.taskId === slot.taskId);
        if (!template) continue;
        next = [...next, { ...template, id: slot.entityId || slot.placementId!,
          x: template.x + (template.width + 24) * outputIndex,
          processing: { taskId: slot.taskId, outputIndex, status: 'processing', progress: 0 },
          taskProjection: undefined, isProcessingPlaceholder: true,
          assetId: undefined, assetVersionId: undefined, placementId: undefined, url: undefined,
        } as T];
      }
    }
    const boundId = complete ? (next.find(node => node.placementId === slot.placementId)?.id || slot.entityId || slot.placementId)
      : ownContext?.placeholderId;
    next = next.map(node => node.id === boundId && node.isProcessingPlaceholder ? {
      ...node, processing: { ...(node.processing as Record<string, unknown>), taskId: slot.taskId, outputIndex },
    } : node);
    next = applyCanvasTaskEventToProcessingPlaceholders(next, {
      taskId: slot.taskId, outputIndex, status: slot.status, progress: slot.progress, source: 'sse',
      providerId: context.params.providerId, modelId: context.params.model,
      ...(complete ? { result: { url: slot.url!, assetId: slot.assetId, assetVersionId: slot.assetVersionId,
        placementId: slot.placementId, metadata: { ...context.params } } } : {}),
      ...(['failed', 'cancelled', 'timeout'].includes(slot.status) ? { error: createCanvasTaskEventError(slot.error, {
        code: slot.error?.code || 'TASK_FAILED', message: slot.error?.message || '生成任务已结束',
        source: 'provider', retryable: slot.error?.retryable === true,
      }) } : {}),
    });
  }
  return next;
}
