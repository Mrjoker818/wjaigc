import type { CanvasImage } from '@/lib/user-types';
import { parseDocumentMediaBatchRequest, type DocumentMediaBatchRequest, type DocumentMediaBatchResult } from './document-media-batch-request';

/** One intent is retained by the caller until authorized directory confirmation. */
export async function importDocumentMediaBatch(input: DocumentMediaBatchRequest, expectedActorId: string,
  signal: AbortSignal | undefined, assertScope: () => void): Promise<DocumentMediaBatchResult> {
  const parsed = parseDocumentMediaBatchRequest(input);
  assertScope();
  const response = await fetch('/api/collaboration/document-assets/import-batch', { method: 'POST',
    credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-wujie-expected-actor-id': expectedActorId },
    body: JSON.stringify(parsed), signal });
  assertScope();
  const data: unknown = await response.json();
  assertScope();
  if (!response.ok) throw new Error('协作素材转入未确认 (' + response.status + ')');
  if (!data || typeof data !== 'object') throw new Error('协作素材收据不完整');
  const result = data as DocumentMediaBatchResult & { success?: boolean };
  if (result.success !== true || result.projectId !== input.projectId
    || !Number.isSafeInteger(result.documentSequence) || result.documentSequence < 0
    || !Array.isArray(result.items) || result.items.length !== input.items.length) throw new Error('协作素材收据不完整');
  const placements = new Set<string>();
  for (const [index, item] of result.items.entries()) {
    const reference = item.assetReference;
    if (!item || item.sourceVersionId !== input.items[index].sourceVersionId
      || (!['confirm',...(input.skillRunId?['attach','restore']:['import'])].includes(item.mode))
      || (item.mode === 'confirm' ? item.childKey !== null : typeof item.childKey !== 'string' || !item.childKey)
      || !Number.isSafeInteger(item.documentSequence) || item.documentSequence < 0 || item.documentSequence > result.documentSequence
      || !item.placementId || !item.assetVersionId || placements.has(item.placementId)
      || !reference || reference.assetVersionId !== item.assetVersionId || reference.placementId !== item.placementId
      || !reference.assetId || !reference.entityId || !reference.url || typeof reference.kind !== 'string'
      || !['image', 'video'].includes(reference.kind)
      || (item.mode === 'confirm' && (item.assetVersionId !== item.sourceVersionId
        || (input.items[index].placementId && input.items[index].placementId !== item.placementId)))
      || (input.skillRunId && (item.assetVersionId !== item.sourceVersionId
        || (item.mode === 'restore') !== !!input.items[index].restore))) {
      throw new Error('协作素材收据不完整');
    }
    placements.add(item.placementId);
  }
  return result;
}
export function assertDocumentMediaBatchProjection(result: DocumentMediaBatchResult, images: readonly CanvasImage[]): void {
  for (const item of result.items) {
    const matches = images.filter(image => image.placementId === item.placementId && image.assetVersionId === item.assetVersionId);
    const image = matches[0];
    const mediaUrl = item.assetReference.kind === 'video' ? image?.videoUrl : image?.url;
    if (matches.length !== 1 || image.assetId !== item.assetReference.assetId || image.id !== item.assetReference.entityId
      || mediaUrl !== item.assetReference.url || !mediaUrl
      || ![image.width, image.height, image.originalWidth, image.originalHeight].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0)
      || (item.assetReference.kind === 'video' && image.mediaType !== 'video')
      || (item.assetReference.kind === 'image' && image.mediaType === 'video')) throw new Error('协作媒体目录尚未确认整批结果');
  }
}
