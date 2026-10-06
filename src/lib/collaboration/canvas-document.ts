import type * as YTypes from 'yjs';
// 服务端与原生协作入口统一加载 CJS；浏览器由构建配置统一解析。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Y: typeof YTypes = require('yjs');

import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';
import { isAssetVersionId } from '@/lib/asset-core/asset-version-id';
import type { ImageGroupData } from '@/lib/user-types';

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
  groupDefinitions?: Record<string, ImageGroupData>;
  annotationRecords?: Record<string, CanvasAnnotationV2>;
  groupTombstones?: Record<string, true>;
  annotationTombstones?: Record<string, true>;
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
  'groupDefinitions', 'annotationRecords', 'groupTombstones', 'annotationTombstones',
]);
const MAX_METADATA_RECORDS = 2000;
const ANNOTATION_TYPES = new Set(['semantic-object', 'region', 'brush', 'arrow', 'text']);
const ANNOTATION_STATUSES = new Set(['draft', 'ready', 'stale', 'running', 'done', 'failed']);

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

function assertRecordFields(value: unknown, required: string[], optional: string[], field: string): asserts value is Record<string, unknown> {
  if (!isRecord(value) || required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new Error(`Invalid canvas ${field}`);
  }
}

function assertText(value: unknown, field: string, limit: number): asserts value is string {
  if (typeof value !== 'string' || value.length > limit) throw new Error(`Invalid canvas ${field}`);
}

function assertNormalizedPoint(value: unknown): void {
  assertRecordFields(value, ['x', 'y'], [], 'annotation point');
  assertFiniteNumber(value.x, 'annotation point x', 0, 1);
  assertFiniteNumber(value.y, 'annotation point y', 0, 1);
}

function assertNormalizedRegion(value: unknown): void {
  assertRecordFields(value, ['x', 'y', 'w', 'h'], [], 'annotation region');
  for (const field of ['x', 'y', 'w', 'h']) {
    assertFiniteNumber(value[field], `annotation region ${field}`, 0, 1);
  }
  if ((value.w as number) <= 0 || (value.h as number) <= 0 ||
      (value.x as number) + (value.w as number) > 1 ||
      (value.y as number) + (value.h as number) > 1) {
    throw new Error('Invalid canvas annotation region');
  }
}

function assertAnnotationGeometry(value: unknown): void {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new Error('Invalid canvas annotation geometry');
  }
  switch (value.kind) {
    case 'semantic-object':
      assertRecordFields(value, ['kind', 'region'], ['polygon'], 'annotation geometry');
      assertNormalizedRegion(value.region);
      if (Object.hasOwn(value, 'polygon')) {
        if (!Array.isArray(value.polygon) || value.polygon.length > 2000) {
          throw new Error('Invalid canvas annotation polygon');
        }
        value.polygon.forEach(assertNormalizedPoint);
      }
      return;
    case 'region':
      assertRecordFields(value, ['kind', 'region'], [], 'annotation geometry');
      assertNormalizedRegion(value.region);
      return;
    case 'brush':
      assertRecordFields(value, ['kind', 'points', 'width'], [], 'annotation geometry');
      if (!Array.isArray(value.points) || value.points.length > 2000) {
        throw new Error('Invalid canvas annotation points');
      }
      value.points.forEach(assertNormalizedPoint);
      assertFiniteNumber(value.width, 'annotation brush width', 0, 1);
      return;
    case 'arrow':
      assertRecordFields(value, ['kind', 'start', 'end'], [], 'annotation geometry');
      assertNormalizedPoint(value.start);
      assertNormalizedPoint(value.end);
      return;
    case 'text':
      assertRecordFields(value, ['kind', 'point'], [], 'annotation geometry');
      assertNormalizedPoint(value.point);
      return;
    default:
      throw new Error('Invalid canvas annotation geometry');
  }
}

function validateMetadataTombstones(value: unknown, records: unknown): Record<string, true> {
  if (!isRecord(value) || !isRecord(records) || Object.keys(value).length > MAX_METADATA_RECORDS) {
    throw new Error('Invalid canvas metadata tombstones');
  }
  const safe: Record<string, true> = Object.create(null) as Record<string, true>;
  for (const [id, deleted] of Object.entries(value)) {
    assertSafeId(id, 'metadata tombstone id');
    if (deleted !== true || !Object.hasOwn(records, id)) {
      throw new Error('Invalid canvas metadata tombstone');
    }
    safe[id] = true;
  }
  return safe;
}

function validateGroupDefinitions(
  value: unknown, placements: Record<string, CanvasPlacement>, tombstones: Record<string, true>,
): Record<string, ImageGroupData> {
  if (!isRecord(value) || Object.keys(value).length > MAX_METADATA_RECORDS) {
    throw new Error('Invalid canvas group definitions');
  }
  const safe: Record<string, ImageGroupData> = Object.create(null) as Record<string, ImageGroupData>;
  for (const [id, raw] of Object.entries(value)) {
    assertSafeId(id, 'group id');
    assertRecordFields(raw, ['id', 'name', 'note', 'imageIds'], ['x', 'y', 'collapsed'], 'group definition');
    if (raw.id !== id) throw new Error('Invalid canvas group id');
    assertText(raw.name, 'group name', 200);
    assertText(raw.note, 'group note', 1000);
    if (!Array.isArray(raw.imageIds) || raw.imageIds.length > MAX_PLACEMENTS ||
        new Set(raw.imageIds).size !== raw.imageIds.length) {
      throw new Error('Invalid canvas group imageIds');
    }
    for (const imageId of raw.imageIds) {
      assertSafeId(imageId, 'group imageId');
      if (!Object.hasOwn(tombstones, id) &&
          (!Object.hasOwn(placements, imageId) || placements[imageId].deleted === true)) {
        throw new Error('Canvas group references an unknown placement');
      }
    }
    if (Object.hasOwn(raw, 'x')) assertFiniteNumber(raw.x, 'group x', -MAX_COORDINATE, MAX_COORDINATE);
    if (Object.hasOwn(raw, 'y')) assertFiniteNumber(raw.y, 'group y', -MAX_COORDINATE, MAX_COORDINATE);
    if (Object.hasOwn(raw, 'collapsed') && typeof raw.collapsed !== 'boolean') {
      throw new Error('Invalid canvas group collapsed');
    }
    safe[id] = raw as unknown as ImageGroupData;
  }
  return safe;
}

function validateAnnotationRecords(
  value: unknown, placements: Record<string, CanvasPlacement>, tombstones: Record<string, true>,
): Record<string, CanvasAnnotationV2> {
  if (!isRecord(value) || Object.keys(value).length > MAX_METADATA_RECORDS) {
    throw new Error('Invalid canvas annotation records');
  }
  const safe: Record<string, CanvasAnnotationV2> = Object.create(null) as Record<string, CanvasAnnotationV2>;
  for (const [id, raw] of Object.entries(value)) {
    assertSafeId(id, 'annotation id');
    assertRecordFields(raw,
      ['id', 'projectId', 'sourceImageId', 'sourceVersionId', 'type', 'geometry', 'status', 'createdAt', 'updatedAt'],
      ['label', 'instruction', 'confidence', 'maskAssetId', 'overlayAssetId', 'orderKey'], 'annotation record');
    if (raw.id !== id) throw new Error('Invalid canvas annotation id');
    assertSafeId(raw.projectId, 'annotation projectId');
    assertSafeId(raw.sourceImageId, 'annotation sourceImageId');
    assertSafeId(raw.sourceVersionId, 'annotation sourceVersionId');
    if (Object.hasOwn(raw, 'orderKey')) assertSafeId(raw.orderKey, 'annotation orderKey');
    if (!Object.hasOwn(tombstones, id) &&
        (!Object.hasOwn(placements, raw.sourceImageId) || placements[raw.sourceImageId as string].deleted === true)) {
      throw new Error('Canvas annotation references an unknown placement');
    }
    if (!ANNOTATION_TYPES.has(raw.type as string) || !ANNOTATION_STATUSES.has(raw.status as string)) {
      throw new Error('Invalid canvas annotation type or status');
    }
    assertAnnotationGeometry(raw.geometry);
    for (const field of ['label', 'instruction']) {
      if (Object.hasOwn(raw, field)) assertText(raw[field], `annotation ${field}`, 1000);
    }
    for (const field of ['maskAssetId', 'overlayAssetId']) {
      if (Object.hasOwn(raw, field)) assertSafeId(raw[field], `annotation ${field}`);
    }
    if (Object.hasOwn(raw, 'confidence')) {
      assertFiniteNumber(raw.confidence, 'annotation confidence', 0, 1);
    }
    for (const field of ['createdAt', 'updatedAt']) {
      if (typeof raw[field] !== 'number' || !Number.isSafeInteger(raw[field]) || (raw[field] as number) < 0) {
        throw new Error(`Invalid canvas annotation ${field}`);
      }
    }
    safe[id] = raw as unknown as CanvasAnnotationV2;
  }
  return safe;
}

function assertCanvasRootTypes(doc: YTypes.Doc): void {
  for (const rootName of doc.share.keys()) {
    if (!ROOT_FIELDS.has(rootName)) {
      throw new Error('Canvas document contains an unsupported root type');
    }
  }
}

function materializePlacement(doc: YTypes.Doc, placementId: string): CanvasPlacement {
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
  if (!isRecord(value) || !isRecord(value.placements) ||
      Object.keys(value).some(key => ![
        'placements', 'groupDefinitions', 'annotationRecords',
        'groupTombstones', 'annotationTombstones',
      ].includes(key))) {
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
  const groupTombstones = Object.hasOwn(value, 'groupTombstones')
    ? validateMetadataTombstones(value.groupTombstones, value.groupDefinitions)
    : Object.create(null) as Record<string, true>;
  const annotationTombstones = Object.hasOwn(value, 'annotationTombstones')
    ? validateMetadataTombstones(value.annotationTombstones, value.annotationRecords)
    : Object.create(null) as Record<string, true>;
  const groupDefinitions = Object.hasOwn(value, 'groupDefinitions')
    ? validateGroupDefinitions(value.groupDefinitions, safePlacements, groupTombstones)
    : undefined;
  const annotationRecords = Object.hasOwn(value, 'annotationRecords')
    ? validateAnnotationRecords(value.annotationRecords, safePlacements, annotationTombstones)
    : undefined;
  for (const placement of Object.values(safePlacements)) {
    if (placement.groupId && Object.hasOwn(groupTombstones, placement.groupId)) {
      throw new Error('Canvas placement references a deleted group');
    }
  }
  return {
    placements: safePlacements,
    ...(groupDefinitions && Object.keys(groupDefinitions).length > 0 ? { groupDefinitions } : {}),
    ...(annotationRecords && Object.keys(annotationRecords).length > 0 ? { annotationRecords } : {}),
    ...(Object.keys(groupTombstones).length > 0 ? { groupTombstones } : {}),
    ...(Object.keys(annotationTombstones).length > 0 ? { annotationTombstones } : {}),
  };
}

export function createCanvasDocument(): YTypes.Doc {
  return new Y.Doc();
}

export function applyCanvasImagePatch(doc: YTypes.Doc, patch: CanvasImagePatch, origin: unknown): void {
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
  if (typeof fields.groupId === 'string' && doc.getMap('groupTombstones').get(fields.groupId) === true) {
    throw new Error('Canvas placement references a deleted group');
  }
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

export function tombstoneCanvasGroup(doc: YTypes.Doc, groupId: string, origin: unknown): void {
  assertSafeId(groupId, 'group id');
  assertCanvasRootTypes(doc);
  if (!doc.getMap('groupDefinitions').has(groupId)) throw new Error('Unknown canvas group');
  if (doc.getMap('groupTombstones').get(groupId) === true) return;
  doc.transact(() => {
    const groups = doc.getMap<unknown>('groups');
    for (const [placementId, currentGroupId] of groups.entries()) {
      if (currentGroupId === groupId) groups.set(placementId, null);
    }
    doc.getMap('groupTombstones').set(groupId, true);
  }, origin);
}

export function tombstoneCanvasAnnotation(doc: YTypes.Doc, annotationId: string, origin: unknown): void {
  assertSafeId(annotationId, 'annotation id');
  assertCanvasRootTypes(doc);
  if (!doc.getMap('annotationRecords').has(annotationId)) throw new Error('Unknown canvas annotation');
  if (doc.getMap('annotationTombstones').get(annotationId) === true) return;
  doc.transact(() => doc.getMap('annotationTombstones').set(annotationId, true), origin);
}

export function readCanvasDocument(doc: YTypes.Doc): CanvasDocumentProjection {
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
  const groupDefinitions = Object.fromEntries(doc.getMap<unknown>('groupDefinitions').entries());
  const annotationRecords = Object.fromEntries(doc.getMap<unknown>('annotationRecords').entries());
  const groupTombstones = Object.fromEntries(doc.getMap<unknown>('groupTombstones').entries());
  const annotationTombstones = Object.fromEntries(doc.getMap<unknown>('annotationTombstones').entries());
  return validateCanvasDocumentProjection({
    placements, groupDefinitions, annotationRecords, groupTombstones, annotationTombstones,
  });
}

/** Server-side precommit guard: compare the persisted document with the candidate update. */
export function assertCanvasDocumentTransition(previous: YTypes.Doc, candidate: YTypes.Doc): void {
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
  for (const field of ['groupDefinitions', 'annotationRecords'] as const) {
    for (const id of Object.keys(before[field] ?? {})) {
      if (!Object.hasOwn(after[field] ?? {}, id)) {
        throw new Error('Canvas document metadata record cannot be removed');
      }
    }
  }
  for (const field of ['groupTombstones', 'annotationTombstones'] as const) {
    for (const id of Object.keys(before[field] ?? {})) {
      if (candidate.getMap(field).get(id) !== true) {
        throw new Error('Canvas document metadata tombstone cannot be removed');
      }
    }
  }
}
