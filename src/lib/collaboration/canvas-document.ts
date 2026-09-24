import * as Y from 'yjs';

import { isAssetVersionId } from '@/lib/asset-core/asset-version-id';

export interface CanvasPlacement {
  assetVersionId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  groupId?: string | null;
  annotation?: string;
  deleted?: boolean;
}

export interface CanvasDocumentProjection {
  placements: Record<string, CanvasPlacement>;
}

export type CanvasImagePatch = { placementId: string } & Partial<CanvasPlacement>;

const PATCH_FIELDS = new Set([
  'placementId', 'assetVersionId', 'x', 'y', 'width', 'height',
  'rotation', 'zIndex', 'groupId', 'annotation', 'deleted',
]);
const PLACEMENT_FIELDS = new Set([...PATCH_FIELDS].filter((field) => field !== 'placementId'));
const REQUIRED_FIELDS = [
  'assetVersionId', 'x', 'y', 'width', 'height', 'rotation', 'zIndex',
] as const;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const TRANSIENT_ID_PATTERN = /^(?:data|blob|https?|processing)(?:[:_-]|$)/i;
const MAX_PLACEMENTS = 2000;
const MAX_COORDINATE = 1_000_000;
const TRANSFORM_FIELDS = ['x', 'y', 'width', 'height', 'rotation', 'zIndex'] as const;
const ROOT_FIELDS = new Set([
  'assetVersions', 'transforms', 'groups', 'annotations', 'tombstones',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || TRANSIENT_ID_PATTERN.test(value)) {
    throw new Error(`Invalid canvas ${field}`);
  }
}

function assertFiniteNumber(value: unknown, field: string, min: number, max: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid canvas ${field}`);
  }
}

function assertCanvasRootTypes(doc: Y.Doc): void {
  for (const rootName of doc.share.keys()) {
    if (!ROOT_FIELDS.has(rootName)) {
      throw new Error('Canvas document contains an unsupported root type');
    }
  }
}

function materializePlacement(doc: Y.Doc, placementId: string): CanvasPlacement {
  const transform = doc.getMap<unknown>('transforms').get(placementId);
  if (!isRecord(transform) || Object.keys(transform).length !== TRANSFORM_FIELDS.length ||
      TRANSFORM_FIELDS.some((field) => !Object.hasOwn(transform, field))) {
    throw new Error('Invalid canvas transform');
  }
  const groups = doc.getMap<unknown>('groups');
  const annotations = doc.getMap<unknown>('annotations');
  return validateCanvasDocumentProjection({
    placements: {
      [placementId]: {
        assetVersionId: doc.getMap<unknown>('assetVersions').get(placementId),
        ...transform,
        ...(groups.has(placementId) ? { groupId: groups.get(placementId) } : {}),
        ...(annotations.has(placementId) ? { annotation: annotations.get(placementId) } : {}),
      },
    },
  }).placements[placementId];
}

export function validateCanvasDocumentProjection(value: unknown): CanvasDocumentProjection {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isRecord(value.placements)) {
    throw new Error('Invalid canvas document projection');
  }
  const entries = Object.entries(value.placements);
  if (entries.length > MAX_PLACEMENTS) {
    throw new Error('Canvas document placement limit exceeded');
  }
  const placements: Array<[string, CanvasPlacement]> = [];
  for (const [placementId, raw] of entries) {
    assertSafeId(placementId, 'placementId');
    if (!isRecord(raw) || Object.keys(raw).some((field) => !PLACEMENT_FIELDS.has(field))) {
      throw new Error('Invalid canvas placement');
    }
    for (const field of REQUIRED_FIELDS) {
      if (!Object.hasOwn(raw, field)) throw new Error(`Missing canvas ${field}`);
    }
    if (!isAssetVersionId(raw.assetVersionId) || TRANSIENT_ID_PATTERN.test(raw.assetVersionId)) {
      throw new Error('Invalid canvas assetVersionId');
    }
    assertFiniteNumber(raw.x, 'x', -MAX_COORDINATE, MAX_COORDINATE);
    assertFiniteNumber(raw.y, 'y', -MAX_COORDINATE, MAX_COORDINATE);
    assertFiniteNumber(raw.width, 'width', Number.EPSILON, MAX_COORDINATE);
    assertFiniteNumber(raw.height, 'height', Number.EPSILON, MAX_COORDINATE);
    assertFiniteNumber(raw.rotation, 'rotation', -360, 360);
    assertFiniteNumber(raw.zIndex, 'zIndex', -MAX_COORDINATE, MAX_COORDINATE);
    if (!Number.isInteger(raw.zIndex)) throw new Error('Invalid canvas zIndex');
    if (Object.hasOwn(raw, 'groupId') && raw.groupId !== null) {
      assertSafeId(raw.groupId, 'groupId');
    }
    if (Object.hasOwn(raw, 'annotation') &&
        (typeof raw.annotation !== 'string' || raw.annotation.length > 1000)) {
      throw new Error('Invalid canvas annotation');
    }
    if (Object.hasOwn(raw, 'deleted') && raw.deleted !== true) {
      throw new Error('Invalid canvas tombstone');
    }
    placements.push([placementId, { ...raw } as unknown as CanvasPlacement]);
  }
  const safePlacements: Record<string, CanvasPlacement> = Object.create(null) as Record<string, CanvasPlacement>;
  for (const [placementId, placement] of placements) safePlacements[placementId] = placement;
  return { placements: safePlacements };
}

export function createCanvasDocument(): Y.Doc {
  return new Y.Doc();
}

export function applyCanvasImagePatch(doc: Y.Doc, patch: CanvasImagePatch, origin: unknown): void {
  if (!isRecord(patch)) throw new Error('Invalid canvas document patch');
  if (Object.keys(patch).some((field) => !PATCH_FIELDS.has(field))) {
    throw new Error('Canvas document patch contains an unsupported field');
  }
  const { placementId, ...fields } = patch;
  assertSafeId(placementId, 'placementId');
  assertCanvasRootTypes(doc);
  const assetVersions = doc.getMap<unknown>('assetVersions');
  const transforms = doc.getMap<unknown>('transforms');
  const groups = doc.getMap<unknown>('groups');
  const annotations = doc.getMap<unknown>('annotations');
  const tombstones = doc.getMap<unknown>('tombstones');
  const existing = assetVersions.has(placementId)
    ? materializePlacement(doc, placementId)
    : undefined;
  if (existing?.deleted === true || tombstones.has(placementId)) {
    if (Object.keys(fields).length === 1 && fields.deleted === true) return;
    throw new Error('Deleted canvas placement cannot be revived');
  }
  if (!existing && fields.deleted === true) {
    throw new Error('Unknown canvas placement cannot be deleted');
  }
  const next = { ...existing, ...fields };
  if (!existing && assetVersions.size >= MAX_PLACEMENTS) {
    throw new Error('Canvas document placement limit exceeded');
  }
  validateCanvasDocumentProjection({ placements: { [placementId]: next } });
  doc.transact(() => {
    if (!existing || Object.hasOwn(fields, 'assetVersionId')) {
      assetVersions.set(placementId, next.assetVersionId);
    }
    if (!existing || TRANSFORM_FIELDS.some((field) => Object.hasOwn(fields, field))) {
      transforms.set(placementId, Object.fromEntries(
        TRANSFORM_FIELDS.map((field) => [field, next[field]]),
      ));
    }
    if (Object.hasOwn(fields, 'groupId')) groups.set(placementId, next.groupId);
    if (Object.hasOwn(fields, 'annotation')) annotations.set(placementId, next.annotation);
    if (fields.deleted === true) tombstones.set(placementId, true);
  }, origin);
}

export function readCanvasDocument(doc: Y.Doc): CanvasDocumentProjection {
  assertCanvasRootTypes(doc);
  const placements: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const assetVersions = doc.getMap<unknown>('assetVersions');
  const transforms = doc.getMap<unknown>('transforms');
  const groups = doc.getMap<unknown>('groups');
  const annotations = doc.getMap<unknown>('annotations');
  for (const placementId of assetVersions.keys()) {
    placements[placementId] = materializePlacement(doc, placementId);
  }
  for (const fieldMap of [transforms, groups, annotations]) {
    for (const placementId of fieldMap.keys()) {
      if (!assetVersions.has(placementId)) throw new Error('Orphan canvas placement field');
    }
  }
  for (const [placementId, deleted] of doc.getMap<unknown>('tombstones').entries()) {
    if (deleted !== true || !isRecord(placements[placementId])) {
      throw new Error('Invalid canvas tombstone');
    }
    placements[placementId] = { ...placements[placementId], deleted: true };
  }
  return validateCanvasDocumentProjection({
    placements,
  });
}

/** Server-side precommit guard: compare the persisted document with the candidate update. */
export function assertCanvasDocumentTransition(previous: Y.Doc, candidate: Y.Doc): void {
  const before = readCanvasDocument(previous);
  const after = readCanvasDocument(candidate);
  const candidateTombstones = candidate.getMap<unknown>('tombstones');
  for (const [placementId, deleted] of previous.getMap<unknown>('tombstones').entries()) {
    if (deleted === true && candidateTombstones.get(placementId) !== true) {
      throw new Error('Canvas document tombstone cannot be removed');
    }
  }
  for (const [placementId, placement] of Object.entries(before.placements)) {
    if (!Object.hasOwn(after.placements, placementId) ||
        (placement.deleted === true && after.placements[placementId].deleted !== true)) {
      throw new Error('Canvas document placement cannot be revived or removed');
    }
  }
}
