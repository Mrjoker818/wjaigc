import type {
  ManagedAssetMediaDescriptor,
} from '@/lib/asset-core/managed-media-read';
import type {
  Asset,
  AssetKind,
  AssetVersion,
  WorkspacePlacement,
} from '@/lib/asset-core/types';
import { CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM } from '@/lib/canvas-kernel/viewport';

import { hashCanonicalJson } from './canonical-json';
import { CanvasShareError } from './errors';
import type {
  CanvasShareSafeDisplayMetadata,
  CanvasShareTransform,
  CanvasShareViewport,
} from './types';

export interface CanvasShareSnapshotItem {
  placementId: string;
  assetId: string;
  assetVersionId: string;
  entityType: 'canvas-image' | 'canvas-video';
  assetKind: 'image' | 'video';
  transform: CanvasShareTransform;
  displayMetadata: CanvasShareSafeDisplayMetadata;
  mimeType: string;
  width: number | null;
  height: number | null;
  byteSize: number;
  checksum: string | null;
  availability: 'ready';
  sortOrder: number;
}

export interface CanvasShareSnapshot {
  projectRevision: number;
  viewport: CanvasShareViewport;
  items: readonly Readonly<CanvasShareSnapshotItem>[];
  snapshotDigest: string;
}

export type CanvasShareReadinessFailureCode =
  | 'CANVAS_SHARE_MEDIA_NOT_READY'
  | 'CANVAS_SHARE_MEDIA_UNAVAILABLE'
  | 'CANVAS_SHARE_UNSUPPORTED_ELEMENT';

export interface CanvasShareReadinessFailure {
  itemIndex: number;
  display?: CanvasShareSafeDisplayMetadata;
  code: CanvasShareReadinessFailureCode;
  message: string;
}

export interface CanvasShareReadinessInspection {
  projectRevision: number;
  itemCount: number;
  viewport: CanvasShareViewport;
  readiness: {
    ready: boolean;
    failures: readonly Readonly<CanvasShareReadinessFailure>[];
  };
}

export interface CanvasShareSnapshotSource {
  readProjectRevision(ownerId: string, projectId: string): Promise<number>;
  listActiveCanvasPlacements(ownerId: string, projectId: string): Promise<WorkspacePlacement[]>;
  findAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null>;
  findVersion(ownerId: string, projectId: string, versionId: string): Promise<AssetVersion | null>;
  getMediaDescriptor(
    version: AssetVersion,
    kind: AssetKind,
  ): Promise<ManagedAssetMediaDescriptor> | ManagedAssetMediaDescriptor;
}

export interface BuildCanvasShareSnapshotInput {
  ownerId: string;
  projectId: string;
  requestedViewport?: Partial<CanvasShareViewport> | null;
}

function projectConflict(): never {
  throw new CanvasShareError('CANVAS_SHARE_PROJECT_CONFLICT');
}

function unsupportedElement(): never {
  throw new CanvasShareError('CANVAS_SHARE_UNSUPPORTED_ELEMENT');
}

function finiteOr(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Object.is(value, -0) ? 0 : value;
}

function normalizeViewport(value: Partial<CanvasShareViewport> | null | undefined): CanvasShareViewport {
  return {
    offsetX: finiteOr(value?.offsetX, 0),
    offsetY: finiteOr(value?.offsetY, 0),
    zoom: Math.min(
      CANVAS_MAX_ZOOM,
      Math.max(CANVAS_MIN_ZOOM, finiteOr(value?.zoom, 1)),
    ),
  };
}

function normalizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || undefined;
}

function safeDisplayMetadata(
  metadata: Record<string, unknown> | undefined,
): CanvasShareSafeDisplayMetadata {
  const label = normalizeText(metadata?.label, 200);
  const altText = normalizeText(metadata?.altText, 1_000);
  return {
    ...(label ? { label } : {}),
    ...(altText ? { altText } : {}),
  };
}

function normalizeTransform(
  placement: WorkspacePlacement,
  descriptor: ManagedAssetMediaDescriptor,
  sortOrder: number,
): CanvasShareTransform {
  const transform = placement.transform ?? {};
  return {
    x: finiteOr(transform.x, 0),
    y: finiteOr(transform.y, 0),
    width: Math.max(0, finiteOr(transform.width, descriptor.width ?? 0)),
    height: Math.max(0, finiteOr(transform.height, descriptor.height ?? 0)),
    rotation: finiteOr(transform.rotation, 0),
    zIndex: Number.isSafeInteger(transform.zIndex) ? Number(transform.zIndex) : sortOrder,
  };
}

function expectedKind(
  placement: WorkspacePlacement,
): { entityType: 'canvas-image' | 'canvas-video'; assetKind: 'image' | 'video' } {
  if (placement.entityType === 'canvas-image') {
    return { entityType: 'canvas-image', assetKind: 'image' };
  }
  if (placement.entityType === 'canvas-video') {
    return { entityType: 'canvas-video', assetKind: 'video' };
  }
  return unsupportedElement();
}

function assertPlacementScope(
  placement: WorkspacePlacement,
  ownerId: string,
  projectId: string,
): void {
  if (
    placement.ownerId !== ownerId
    || placement.projectId !== projectId
    || placement.workspace !== 'canvas'
    || ![projectId, `canvas:${projectId}`].includes(placement.workspaceId)
    || placement.status !== 'active'
    || placement.deletedAt !== null
  ) {
    projectConflict();
  }
}

function assertAssetScope(
  asset: Asset | null,
  placement: WorkspacePlacement,
  ownerId: string,
  projectId: string,
  kind: 'image' | 'video',
): asserts asset is Asset {
  if (
    !asset
    || asset.id !== placement.assetId
    || asset.ownerId !== ownerId
    || asset.projectId !== projectId
    || asset.status !== 'active'
    || asset.kind !== kind
  ) {
    projectConflict();
  }
}

function assertVersionScope(
  version: AssetVersion | null,
  placement: WorkspacePlacement,
  ownerId: string,
  projectId: string,
): asserts version is AssetVersion {
  if (
    !version
    || version.id !== placement.assetVersionId
    || version.assetId !== placement.assetId
    || version.ownerId !== ownerId
    || version.projectId !== projectId
  ) {
    projectConflict();
  }
  if (version.file.availability !== 'ready') {
    throw new CanvasShareError('CANVAS_SHARE_MEDIA_NOT_READY');
  }
}

function digestInput(
  projectRevision: number,
  viewport: CanvasShareViewport,
  items: readonly CanvasShareSnapshotItem[],
): object {
  return {
    projectRevision,
    viewport,
    items: items.map(item => ({
      placementId: item.placementId,
      assetId: item.assetId,
      assetVersionId: item.assetVersionId,
      entityType: item.entityType,
      assetKind: item.assetKind,
      transform: item.transform,
      displayMetadata: item.displayMetadata,
      mimeType: item.mimeType,
      width: item.width,
      height: item.height,
      byteSize: item.byteSize,
      checksum: item.checksum,
      availability: item.availability,
      sortOrder: item.sortOrder,
    })),
  };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

async function readSnapshotScope(
  input: BuildCanvasShareSnapshotInput,
  source: CanvasShareSnapshotSource,
): Promise<{
  projectRevision: number;
  placements: WorkspacePlacement[];
  viewport: CanvasShareViewport;
}> {
  const projectRevision = await source.readProjectRevision(input.ownerId, input.projectId);
  if (!Number.isSafeInteger(projectRevision) || projectRevision < 0) projectConflict();
  const placements = await source.listActiveCanvasPlacements(input.ownerId, input.projectId);
  return {
    projectRevision,
    placements,
    viewport: normalizeViewport(input.requestedViewport),
  };
}

async function buildSnapshotItem(
  input: BuildCanvasShareSnapshotInput,
  source: CanvasShareSnapshotSource,
  placement: WorkspacePlacement,
  sortOrder: number,
): Promise<CanvasShareSnapshotItem> {
  assertPlacementScope(placement, input.ownerId, input.projectId);
  const { entityType, assetKind } = expectedKind(placement);
  const asset = await source.findAsset(input.ownerId, input.projectId, placement.assetId);
  assertAssetScope(asset, placement, input.ownerId, input.projectId, assetKind);
  const version = await source.findVersion(
    input.ownerId,
    input.projectId,
    placement.assetVersionId,
  );
  assertVersionScope(version, placement, input.ownerId, input.projectId);
  const descriptor = await source.getMediaDescriptor(version, assetKind);
  if (
    descriptor.assetVersionId !== version.id
    || descriptor.assetKind !== assetKind
  ) {
    projectConflict();
  }
  return {
    placementId: placement.id,
    assetId: asset.id,
    assetVersionId: version.id,
    entityType,
    assetKind,
    transform: normalizeTransform(placement, descriptor, sortOrder),
    displayMetadata: safeDisplayMetadata(placement.metadata),
    mimeType: descriptor.mimeType,
    width: descriptor.width,
    height: descriptor.height,
    byteSize: descriptor.byteSize,
    checksum: descriptor.checksum,
    availability: 'ready',
    sortOrder,
  };
}

function isReadinessFailure(
  error: unknown,
): error is CanvasShareError & { code: CanvasShareReadinessFailureCode } {
  return error instanceof CanvasShareError && [
    'CANVAS_SHARE_MEDIA_NOT_READY',
    'CANVAS_SHARE_MEDIA_UNAVAILABLE',
    'CANVAS_SHARE_UNSUPPORTED_ELEMENT',
  ].includes(error.code);
}

export async function inspectCanvasShareReadiness(
  input: BuildCanvasShareSnapshotInput,
  source: CanvasShareSnapshotSource,
): Promise<Readonly<CanvasShareReadinessInspection>> {
  const { projectRevision, placements, viewport } = await readSnapshotScope(input, source);
  const failures: CanvasShareReadinessFailure[] = [];
  for (const [itemIndex, placement] of placements.entries()) {
    try {
      await buildSnapshotItem(input, source, placement, itemIndex);
    } catch (error) {
      if (!isReadinessFailure(error)) throw error;
      const display = safeDisplayMetadata(placement.metadata);
      failures.push({
        itemIndex,
        ...(Object.keys(display).length > 0 ? { display } : {}),
        code: error.code,
        message: error.message,
      });
    }
  }
  return deepFreeze({
    projectRevision,
    itemCount: placements.length,
    viewport,
    readiness: {
      ready: failures.length === 0,
      failures,
    },
  });
}

export async function buildCanvasShareSnapshot(
  input: BuildCanvasShareSnapshotInput,
  source: CanvasShareSnapshotSource,
): Promise<Readonly<CanvasShareSnapshot>> {
  const { projectRevision, placements, viewport } = await readSnapshotScope(input, source);
  const items: CanvasShareSnapshotItem[] = [];

  for (const [sortOrder, placement] of placements.entries()) {
    items.push(await buildSnapshotItem(input, source, placement, sortOrder));
  }

  const snapshotDigest = hashCanonicalJson(digestInput(projectRevision, viewport, items));
  return deepFreeze({ projectRevision, viewport, items, snapshotDigest });
}
