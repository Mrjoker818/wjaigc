/** Persisted checkpoints describe known work. Loading a checkpoint never submits paid work. */
import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { DramaCastMember, DramaProjectV1 } from './types';
import { findShot, updateShot } from './workbench-state';
import { shotInputSnapshot } from './production-version';
import { castViewImage } from './bible-images';
import type { CastView } from './reference-prompts';

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
  // Optional only for reading old receipts. Absence never proves current inputs match.
  inputSnapshot: z.string().max(200).optional(),
  targetSnapshot: z.string().max(200).optional(),
});
export type DramaProductionImage = z.infer<typeof productionImageSchema>;

export interface ProductionImageInput { prompt: string; aspectRatio: string; referenceImages?: string[] }

/** Fixed-size canonical versions, matching the take/voice approach without copying large references into every receipt. */
function imageVersion(kind: string, value: unknown): string {
  const canonical = JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
  });
  return `${kind}:v1:${bytesToHex(sha256(new TextEncoder().encode(canonical)))}`;
}

export function productionImageInputSnapshot(input: ProductionImageInput): string {
  return imageVersion('image-input', { prompt: input.prompt, aspectRatio: input.aspectRatio, referenceImages: input.referenceImages ?? [] });
}

/** Bind both source inputs and the selected image; a late result must not replace a manual choice. */
export function productionImageTargetSnapshot(doc: DramaProjectV1, target: DramaProductionImage['target']): string | undefined {
  let input: unknown;
  if (target.kind === 'keyframe') {
    const found = findShot(doc, target.entityId);
    if (!found || (target.view !== undefined && target.view !== 'first' && target.view !== 'last')) return undefined;
    // A closing image is not an input to the opening image. The reverse is a real reference dependency.
    const scoped = updateShot(doc, found.shot.id, target.view === 'last'
      ? { firstFramePrompt: undefined } : { lastFramePrompt: undefined, lastFrameUrl: undefined });
    input = shotInputSnapshot(scoped, found.episode.id, found.shot.id);
  } else {
    const entity = target.kind === 'cast' ? doc.cast.find(item => item.id === target.entityId)
      : target.kind === 'location' ? doc.locations.find(item => item.id === target.entityId) : doc.props.find(item => item.id === target.entityId);
    const validView = target.kind === 'cast' ? ['front', 'side', 'back', 'face'].includes(target.view ?? '')
      : target.view === (target.kind === 'location' ? 'plate' : 'sheet');
    if (!entity || !validView) return undefined;
    // History and voice settings do not change a bible image's visual inputs or selection.
    input = Object.fromEntries(Object.entries(entity).filter(([key]) => !['imageHistory', 'voice', 'voiceSampleUrl', 'voiceSampleName', 'voiceSampleSec'].includes(key)));
    if (target.kind === 'cast') {
      const member = entity as DramaCastMember;
      // Other angles are parallel outputs, not inputs; non-front views only reference the locked/front image.
      const imageFields = ['imageUrlFront', 'imageUrlSide', 'imageUrlBack', 'imageUrlFace', 'imageUrlFull',
        'frontUrl', 'sideUrl', 'frontImageUrl', 'sideImageUrl', 'lockedImageUrl'];
      input = {
        visual: Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([key]) => !imageFields.includes(key))),
        selectedImage: castViewImage(member, target.view as CastView),
        referenceImage: target.view === 'front' ? undefined : member.lockedImageUrl || castViewImage(member, 'front'),
      };
    }
  }
  return imageVersion('image-target', { target, style: doc.style, aspectRatio: doc.aspectRatio, input });
}

export function checkpointProduction(doc: DramaProjectV1, run: DramaProductionRun): DramaProjectV1 {
  return { ...doc, productionRun: productionRunSchema.parse(run) };
}

export function upsertProductionImage(doc: DramaProjectV1, operation: DramaProductionImage): DramaProjectV1 {
  const image = productionImageSchema.parse(operation);
  const existing = doc.productionImages ?? [];
  // Adoption settles this operation. An older polling/storage writer cannot undo the user's decision.
  if (existing.some(item => item.id === image.id && item.applied === true)) return doc;
  // Never evict an unsettled receipt to make room for a new paid operation.
  if (!existing.some(item => item.id === image.id) && existing.length >= 500) throw new Error('生成回执已达上限，请先归档项目后继续');
  return { ...doc, productionImages: existing.some(item => item.id === image.id) ? existing.map(item => item.id === image.id ? image : item) : [...existing, image] };
}

export function pendingProductionImages(doc: DramaProjectV1): DramaProductionImage[] {
  return (doc.productionImages ?? []).filter(item => item.state !== 'failed' && (item.state !== 'stored' || item.applied !== true));
}
