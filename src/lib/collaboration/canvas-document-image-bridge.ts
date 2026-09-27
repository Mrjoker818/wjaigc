import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';
import type { ImageGroupData } from '@/lib/user-types';
import type { CanvasDocumentProjection, CanvasImagePatch, CanvasPlacement } from './canvas-document';

interface CanvasBridgeImage {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  zIndex?: number;
  groupId?: string;
  placementId?: string;
  assetVersionId?: string;
  isProcessingPlaceholder?: boolean;
}

const TRANSFORM_FIELDS = ['x', 'y', 'width', 'height', 'rotation', 'zIndex'] as const;

export interface CanvasWorkspaceAuthority {
  projectId: string | null;
  authority: 'unknown' | 'legacy' | 'document';
  status: string;
  images: Record<string, CanvasPlacement>;
}

export function commitAcceptedCanvasImageChange<T>(
  current: T[],
  next: T[],
  onChange: (images: T[]) => boolean | void,
): { accepted: boolean; images: T[] } {
  const accepted = onChange(next) !== false;
  return { accepted, images: accepted ? next : current };
}

export function commitCanvasImageRefChange<T>(
  ref: { current: T[] },
  next: T[],
  onChange: (images: T[]) => boolean | void,
): boolean {
  const result = commitAcceptedCanvasImageChange(ref.current, next, onChange);
  ref.current = result.images;
  return result.accepted;
}

export function canUseLegacyCanvasPersistence(
  projectId: string | null,
  state: CanvasWorkspaceAuthority | null,
): boolean {
  return projectId === null || (
    state?.projectId === projectId && state.authority === 'legacy'
  );
}

export function shouldKeepDirtyCanvasAnnotations(input: {
  projectChanged: boolean;
  documentMode: boolean;
  dirty: boolean;
}): boolean {
  return !input.projectChanged && !input.documentMode && input.dirty;
}

export function routeCanvasWorkspaceChange<T extends CanvasBridgeImage>(
  projectId: string | null,
  state: CanvasWorkspaceAuthority | null,
  before: readonly T[],
  after: readonly T[],
  source?: 'hydration',
): { kind: 'legacy' } | { kind: 'document'; patches: CanvasImagePatch[] } | { kind: 'blocked'; reason: string } {
  if (projectId === null) return { kind: 'legacy' };
  if (source === 'hydration') {
    return state?.projectId === projectId && state.authority === 'document'
      ? { kind: 'blocked', reason: '协作文档已接管项目，旧快照不可覆盖' }
      : { kind: 'legacy' };
  }
  if (!state || state.projectId !== projectId || state.authority === 'unknown') {
    return { kind: 'blocked', reason: '正在确认项目保存方式，请稍后重试' };
  }
  if (state.authority === 'legacy') return { kind: 'legacy' };
  if (state.status !== 'saved' && state.status !== 'pending') {
    return { kind: 'blocked', reason: '协作文档暂不可编辑，请检查同步状态' };
  }
  try {
    return {
      kind: 'document',
      patches: collectCanvasDocumentPatches(before, after, state.images),
    };
  } catch (error) {
    return {
      kind: 'blocked',
      reason: error instanceof Error ? error.message : '协作画布更改无效',
    };
  }
}

function managedImages<T extends CanvasBridgeImage>(images: readonly T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const image of images) {
    if (image.isProcessingPlaceholder) continue;
    if (!image.placementId || !image.assetVersionId || result.has(image.placementId)) {
      throw new Error('协作媒体命令尚未处理此画布素材');
    }
    result.set(image.placementId, image);
  }
  return result;
}

export function collectCanvasDocumentPatches<T extends CanvasBridgeImage>(
  before: readonly T[],
  after: readonly T[],
  placements: Record<string, CanvasPlacement>,
): CanvasImagePatch[] {
  const previous = managedImages(before);
  const next = managedImages(after);
  if (previous.size !== next.size) throw new Error('协作媒体命令尚未处理素材增删');
  const patches: CanvasImagePatch[] = [];
  for (const [placementId, image] of next) {
    const prior = previous.get(placementId);
    const placement = Object.hasOwn(placements, placementId) ? placements[placementId] : undefined;
    if (!prior || !placement || placement.deleted ||
        prior.assetVersionId !== image.assetVersionId ||
        placement.assetVersionId !== image.assetVersionId) {
      throw new Error('协作媒体命令尚未处理素材版本或摆放变更');
    }
    const transformChanged = TRANSFORM_FIELDS.some(field => prior[field] !== image[field]);
    const groupChanged = (prior.groupId || null) !== (image.groupId || null);
    if (prior.url !== image.url) {
      throw new Error('协作媒体命令尚未处理素材地址变更');
    }
    if (!transformChanged && !groupChanged) continue;
    patches.push({
      placementId,
      ...(transformChanged ? {
        x: image.x, y: image.y, width: image.width, height: image.height,
        rotation: image.rotation ?? placement.rotation, zIndex: image.zIndex ?? placement.zIndex,
      } : {}),
      ...(groupChanged ? { groupId: image.groupId || null } : {}),
    });
  }
  return patches;
}

export function projectDocumentPlacementsOntoImages<T extends CanvasBridgeImage>(
  images: readonly T[],
  placements: Record<string, CanvasPlacement>,
): { images: T[]; unresolvedPlacementIds: string[] } {
  const resolved = new Set<string>();
  const projected: T[] = [];
  for (const image of images) {
    if (!image.placementId || image.isProcessingPlaceholder) {
      projected.push(image);
      continue;
    }
    const placement = Object.hasOwn(placements, image.placementId)
      ? placements[image.placementId] : undefined;
    if (!placement || placement.assetVersionId !== image.assetVersionId) {
      projected.push(image);
      continue;
    }
    resolved.add(image.placementId);
    if (placement.deleted) continue;
    const { groupId: _oldGroupId, ...base } = image;
    projected.push({
      ...base,
      x: placement.x, y: placement.y,
      width: placement.width, height: placement.height,
      rotation: placement.rotation, zIndex: placement.zIndex,
      ...(placement.groupId ? { groupId: placement.groupId } : {}),
    } as T);
  }
  return {
    images: projected,
    unresolvedPlacementIds: Object.keys(placements).filter(id => (
      placements[id].deleted !== true && !resolved.has(id)
    )),
  };
}

function canvasImageIdentityMaps<T extends CanvasBridgeImage>(images: readonly T[]): {
  placementByImage: Map<string, string>;
  imageByPlacement: Map<string, string>;
} {
  const placementByImage = new Map<string, string>();
  const imageByPlacement = new Map<string, string>();
  for (const image of images) {
    if (!image.placementId || image.isProcessingPlaceholder) continue;
    if (placementByImage.has(image.id) || imageByPlacement.has(image.placementId)) {
      throw new Error('协作素材身份重复');
    }
    placementByImage.set(image.id, image.placementId);
    imageByPlacement.set(image.placementId, image.id);
  }
  return { placementByImage, imageByPlacement };
}

function requiredCanvasIdentity(mapping: Map<string, string>, id: string): string {
  const resolved = mapping.get(id);
  if (!resolved) throw new Error('协作素材引用无法解析');
  return resolved;
}

export function toCanvasDocumentGroupRecords<T extends CanvasBridgeImage>(
  groups: readonly ImageGroupData[],
  images: readonly T[],
): Record<string, ImageGroupData> {
  const { placementByImage } = canvasImageIdentityMaps(images);
  const records = Object.create(null) as Record<string, ImageGroupData>;
  for (const group of groups) {
    if (Object.hasOwn(records, group.id)) throw new Error('协作分组身份重复');
    records[group.id] = {
      ...group,
      imageIds: group.imageIds.map(id => requiredCanvasIdentity(placementByImage, id)),
    };
  }
  return records;
}

export function toCanvasDocumentAnnotationRecords<T extends CanvasBridgeImage>(
  annotations: readonly CanvasAnnotationV2[],
  images: readonly T[],
): Record<string, CanvasAnnotationV2> {
  const { placementByImage } = canvasImageIdentityMaps(images);
  const records = Object.create(null) as Record<string, CanvasAnnotationV2>;
  for (const annotation of annotations) {
    if (Object.hasOwn(records, annotation.id)) throw new Error('协作标注身份重复');
    records[annotation.id] = {
      ...annotation,
      sourceImageId: requiredCanvasIdentity(placementByImage, annotation.sourceImageId),
    };
  }
  return records;
}

export function projectCanvasDocumentMetadata<T extends CanvasBridgeImage>(
  projection: CanvasDocumentProjection,
  images: readonly T[],
): { groups: ImageGroupData[]; annotations: CanvasAnnotationV2[] } {
  const { imageByPlacement } = canvasImageIdentityMaps(images);
  return {
    groups: Object.values(projection.groupDefinitions ?? {}).filter(group => (
      projection.groupTombstones?.[group.id] !== true
    )).map(group => ({
      ...group,
      imageIds: group.imageIds.map(id => requiredCanvasIdentity(imageByPlacement, id)),
    })),
    annotations: Object.values(projection.annotationRecords ?? {}).filter(annotation => (
      projection.annotationTombstones?.[annotation.id] !== true
    )).map(annotation => ({
      ...annotation,
      sourceImageId: requiredCanvasIdentity(imageByPlacement, annotation.sourceImageId),
    })),
  };
}
