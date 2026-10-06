import type * as YTypes from 'yjs';
import { z } from 'zod';
import type { RegisteredWorkspaceAssetReference } from '@/lib/asset-core/types';
import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';

import { applyCanvasImagePatch, readCanvasDocument, validateCanvasDocumentProjection, type CanvasPlacement, type CanvasDocumentProjection } from './canvas-document';

export type CanvasAssetCommand =
  | { action: 'attach'; assetVersionId: string; transform: { x: number; y: number; width: number; height: number; rotation: number; zIndex: number } }
  | { action: 'remove'; placementId: string; expectedAssetVersionId: string }
  | { action: 'replace'; placementId: string; expectedAssetVersionId: string; assetVersionId: string };
export interface DocumentAssetCommandInput {
  actorId: string;
  projectId: string;
  idempotencyKey: string;
  command: CanvasAssetCommand;
}
export interface DocumentAssetCommandResult {
  placementId: string;
  assetVersionId: string;
  documentSequence: number;
  removeSnapshot?: DocumentPlacementRemovalSnapshot;
}
export interface DocumentPlacementRemovalSnapshot {
  version: 1;
  projectId: string;
  placementId: string;
  placement: Omit<CanvasPlacement, 'deleted'>;
  groupIds: string[];
  annotationRecords: Record<string, CanvasAnnotationV2>;
}
export interface DocumentMediaImportResult extends DocumentAssetCommandResult {
  assetReference: RegisteredWorkspaceAssetReference;
}
export class DocumentAssetCommandInvalidError extends Error {
  readonly code = 'DOCUMENT_ASSET_COMMAND_INVALID';
  constructor() { super('Invalid document asset command'); }
}
export class DocumentAssetCommandConflictError extends Error {
  readonly code = 'DOCUMENT_ASSET_COMMAND_CONFLICT';
  constructor() { super('Document asset command conflicts with current state'); }
}
const scopeId = z.string().min(1).max(256).refine(value => !!value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
const safeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/)
  .refine(value => !/^(?:data|blob|https?|processing)(?:[:_-]|$)/i.test(value));
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('attach'), assetVersionId: safeId, transform: z.object({
    x: coordinate, y: coordinate, width: z.number().min(Number.EPSILON).max(1_000_000),
    height: z.number().min(Number.EPSILON).max(1_000_000), rotation: z.number().min(-360).max(360), zIndex: coordinate.int(),
  }).strict() }).strict(),
  z.object({ action: z.literal('remove'), placementId: safeId, expectedAssetVersionId: safeId }).strict(),
  z.object({ action: z.literal('replace'), placementId: safeId, expectedAssetVersionId: safeId, assetVersionId: safeId }).strict(),
]);
const requestSchema = z.object({ projectId: scopeId, idempotencyKey: scopeId, command: commandSchema }).strict();
const removalSnapshotSchema = z.object({ version: z.literal(1), projectId: scopeId, placementId: safeId,
  placement: z.unknown(), groupIds: z.array(safeId).max(2000), annotationRecords: z.unknown() }).strict();
const commandResultSchema = z.object({ placementId: safeId, assetVersionId: safeId,
  documentSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), removeSnapshot: z.unknown().optional() }).strict();
export const mediaImportCommandSchema = z.discriminatedUnion('action', [
  commandSchema.options[0].omit({ assetVersionId: true }),
  commandSchema.options[2].omit({ assetVersionId: true }),
]);

/** Zod emits fields in schema order, giving the server one stable digest representation. */
export function parseDocumentAssetCommandRequest(value: unknown): Omit<DocumentAssetCommandInput, 'actorId'> {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw new DocumentAssetCommandInvalidError();
  return parsed.data;
}

/** Shared HTTP/JSONB normalization: key order cannot make a durable replay drift. */
export function parseDocumentPlacementRemovalSnapshot(value: unknown): DocumentPlacementRemovalSnapshot {
  try {
    const snapshot = removalSnapshotSchema.parse(value);
    if (new Set(snapshot.groupIds).size !== snapshot.groupIds.length ||
        !snapshot.placement || typeof snapshot.placement !== 'object' || Object.hasOwn(snapshot.placement, 'deleted')) {
      throw new DocumentAssetCommandInvalidError();
    }
    const projection = validateCanvasDocumentProjection({ placements: { [snapshot.placementId]: snapshot.placement },
      annotationRecords: snapshot.annotationRecords });
    for (const annotation of Object.values(projection.annotationRecords ?? {})) {
      if (annotation.projectId !== snapshot.projectId || annotation.sourceImageId !== snapshot.placementId) {
        throw new DocumentAssetCommandInvalidError();
      }
    }
    // JSONB reorders nested keys. Sort every object, not just the envelope, and
    // detach all data from the live Y.Doc before it is changed by the command.
    const normalized = { ...snapshot, placement: projection.placements[snapshot.placementId],
      groupIds: [...snapshot.groupIds].sort(), annotationRecords: projection.annotationRecords ?? {} };
    return JSON.parse(JSON.stringify(normalized, (_key: string, item: unknown): unknown => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
      }
      return item;
    })) as DocumentPlacementRemovalSnapshot;
  } catch { throw new DocumentAssetCommandInvalidError(); }
}

/** Called only on the actual locked pre-command document, never a UI snapshot. */
export function captureDocumentPlacementRemovalSnapshot(
  projection: CanvasDocumentProjection, projectId: string, command: Extract<CanvasAssetCommand, { action: 'remove' }>,
): DocumentPlacementRemovalSnapshot {
  const placement = projection.placements[command.placementId];
  if (!placement || placement.deleted || placement.assetVersionId !== command.expectedAssetVersionId) {
    throw new DocumentAssetCommandConflictError();
  }
  const livePlacement = { ...placement };
  delete livePlacement.deleted;
  return parseDocumentPlacementRemovalSnapshot({ version: 1, projectId, placementId: command.placementId, placement: livePlacement,
    groupIds: Object.entries(projection.groupDefinitions ?? {}).filter(([id, group]) =>
      !projection.groupTombstones?.[id] && group.imageIds.includes(command.placementId)).map(([id]) => id),
    annotationRecords: Object.fromEntries(Object.entries(projection.annotationRecords ?? {}).filter(([id, annotation]) =>
      !projection.annotationTombstones?.[id] && annotation.sourceImageId === command.placementId)),
  });
}

/** A snapshot is only meaningful for this exact remove identity and project. */
export function parseDocumentAssetCommandResult(
  value: unknown, input: Pick<DocumentAssetCommandInput, 'projectId' | 'command'>,
): DocumentAssetCommandResult {
  const parsed = commandResultSchema.safeParse(value);
  if (!parsed.success) throw new DocumentAssetCommandInvalidError();
  const result = parsed.data;
  const version = input.command.action === 'remove' ? input.command.expectedAssetVersionId : input.command.assetVersionId;
  if (result.assetVersionId !== version || (input.command.action !== 'attach' && result.placementId !== input.command.placementId)) {
    throw new DocumentAssetCommandInvalidError();
  }
  const receipt: DocumentAssetCommandResult = { placementId: result.placementId, assetVersionId: result.assetVersionId,
    documentSequence: result.documentSequence };
  if (result.removeSnapshot !== undefined) {
    const snapshot = parseDocumentPlacementRemovalSnapshot(result.removeSnapshot);
    if (input.command.action !== 'remove' || snapshot.projectId !== input.projectId || snapshot.placementId !== receipt.placementId ||
        snapshot.placement.assetVersionId !== receipt.assetVersionId) throw new DocumentAssetCommandInvalidError();
    receipt.removeSnapshot = snapshot;
  }
  return receipt;
}

/** Only exact server commands can rewrite a live version; no arbitrary Yjs bytes. */
export function applyCanvasAssetCommand(doc: YTypes.Doc, command: CanvasAssetCommand, placementId: string): void {
  const parsed = commandSchema.safeParse(command);
  if (!parsed.success || !safeId.safeParse(placementId).success) throw new DocumentAssetCommandInvalidError();
  const before = readCanvasDocument(doc);
  if (command.action === 'attach') {
    if (Object.hasOwn(before.placements, placementId)) throw new DocumentAssetCommandConflictError();
    try {
      validateCanvasDocumentProjection({ ...before, placements: {
        ...before.placements, [placementId]: { assetVersionId: command.assetVersionId, ...command.transform },
      } });
    } catch { throw new DocumentAssetCommandInvalidError(); }
    applyCanvasImagePatch(doc, { placementId, assetVersionId: command.assetVersionId, ...command.transform }, 'asset-command');
    return;
  }
  const current = before.placements[placementId];
  if (placementId !== command.placementId || !current || current.deleted || current.assetVersionId !== command.expectedAssetVersionId) {
    throw new DocumentAssetCommandConflictError();
  }
  if (command.action === 'replace' && command.assetVersionId === current.assetVersionId) return;
  doc.transact(() => {
    if (command.action === 'replace') doc.getMap('assetVersions').set(placementId, command.assetVersionId);
    else {
      doc.getMap('tombstones').set(placementId, true);
      for (const [id, group] of Object.entries(before.groupDefinitions ?? {})) {
        if (before.groupTombstones?.[id] || !group.imageIds.includes(placementId)) continue;
        doc.getMap('groupDefinitions').set(id, { ...group, imageIds: group.imageIds.filter(member => member !== placementId) });
      }
    }
    for (const [id, annotation] of Object.entries(before.annotationRecords ?? {})) {
      if (before.annotationTombstones?.[id] || annotation.sourceImageId !== placementId) continue;
      if (command.action === 'remove') doc.getMap('annotationTombstones').set(id, true);
      else if (annotation.status !== 'stale') doc.getMap('annotationRecords').set(id, { ...annotation, status: 'stale' });
    }
  }, 'asset-command');
}
