/** Persisted checkpoints describe known work. Loading a checkpoint never submits paid work. */
import { z } from 'zod';
import type { DramaProjectV1 } from './types';

export const productionRunSchema = z.object({
  id: z.string().min(1).max(128), episodeId: z.string().min(1).max(128),
  stage: z.enum(['bible', 'keyframes', 'shots', 'voiceover', 'render']),
  status: z.enum(['running', 'paused', 'completed']), updatedAt: z.number().finite(),
});
export type DramaProductionRun = z.infer<typeof productionRunSchema>;

export const productionImageSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  target: z.object({ kind: z.enum(['keyframe', 'cast', 'location', 'prop']), entityId: z.string().min(1).max(128), view: z.enum(['first', 'last', 'front', 'side', 'back', 'face', 'plate', 'sheet']).optional() }),
  providerId: z.string().min(1).max(128), modelId: z.string().min(1).max(256),
  state: z.enum(['submitting', 'generating', 'retrieving', 'stored', 'failed', 'unknown']),
  taskId: z.string().max(256).optional(), sourceUrl: z.string().max(4096).optional(), url: z.string().max(4096).optional(),
  error: z.string().max(2000).optional(), createdAt: z.number().finite(), updatedAt: z.number().finite(),
  applied: z.boolean().optional(),
});
export type DramaProductionImage = z.infer<typeof productionImageSchema>;

export function checkpointProduction(doc: DramaProjectV1, run: DramaProductionRun): DramaProjectV1 {
  return { ...doc, productionRun: productionRunSchema.parse(run) };
}

export function upsertProductionImage(doc: DramaProjectV1, operation: DramaProductionImage): DramaProjectV1 {
  const image = productionImageSchema.parse(operation);
  const existing = doc.productionImages ?? [];
  // Never evict an unsettled receipt to make room for a new paid operation.
  if (!existing.some(item => item.id === image.id) && existing.length >= 500) throw new Error('生成回执已达上限，请先归档项目后继续');
  return { ...doc, productionImages: existing.some(item => item.id === image.id) ? existing.map(item => item.id === image.id ? image : item) : [...existing, image] };
}

export function pendingProductionImages(doc: DramaProjectV1): DramaProductionImage[] {
  return (doc.productionImages ?? []).filter(item => item.state !== 'failed' && (item.state !== 'stored' || item.applied === false));
}
