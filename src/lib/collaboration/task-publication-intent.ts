import 'server-only';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { mediaImportCommandSchema } from './canvas-asset-command';
import { validateCanvasDocumentProjection, type CanvasDocumentProjection } from './canvas-document';

const id = mediaImportCommandSchema.options[1].shape.placementId;
const ids = z.array(id).refine(values => new Set(values).size === values.length);
const parents = { parentVersionIds: ids.max(32), projectionMode: z.enum(['derived', 'revision']) };
const selectionSnapshot = z.array(z.object({ entityId: id, placementId: id, assetVersionId: id }).strict())
  .refine(values => new Set(values.map(value => value.entityId)).size === values.length
    && new Set(values.map(value => value.placementId)).size === values.length);
const attachPlacement = mediaImportCommandSchema.options[0].extend({ strideX: z.number().finite() })
  .refine(value => value.strideX === value.transform.width + 32);
const mediaSourceSnapshotSchema = z.array(z.object({ versionId: id, fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  assetId: id, assetCurrentVersionId: id.nullable() }).strict()).min(1).max(32);
const annotationImageByteProofSchema = z.object({
  version: z.literal(1), actorUserId: id, ownerId: id, projectId: id,
  grantGeneration: z.string().regex(/^(0|[1-9][0-9]*)$/).max(19),
  imageId: id, versionId: id, assetId: id, assetVersionId: id, placementId: id,
  urlDigest: z.string().regex(/^[a-f0-9]{64}$/), sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']),
  byteSize: z.number().int().min(1).max(32 * 1024 * 1024),
  width: z.number().int().positive().safe(), height: z.number().int().positive().safe(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type AnnotationImageByteProof = Readonly<z.infer<typeof annotationImageByteProofSchema>>;
const annotationEditSourceSchema = z.object({ version: z.literal(1), requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceSnapshot: mediaSourceSnapshotSchema.length(1), byteProof: annotationImageByteProofSchema.optional() }).strict();
const imageEditOutputsSchema = z.object({
  version: z.literal(1), includeMask: z.boolean(), requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceSnapshot: mediaSourceSnapshotSchema,
  maskPlacement: attachPlacement.optional(),
}).strict().refine(value => value.includeMask === (value.maskPlacement !== undefined));
const proposalSchema = z.object({ ...parents, placement: z.discriminatedUnion('action', [
  z.object({ action: z.literal('append'), selectedEntityIds: ids }).strict(),
  mediaImportCommandSchema.options[1],
]) }).strict().refine(value => value.projectionMode !== 'revision' || value.parentVersionIds.length === 1);
const intentSchema = z.object({ version: z.literal(1), ...parents, imageEditOutputs: imageEditOutputsSchema.optional(),
  annotationEditSource: annotationEditSourceSchema.optional(), selectionSnapshot: selectionSnapshot.optional(), placement: z.discriminatedUnion('action', [
  attachPlacement,
  mediaImportCommandSchema.options[1],
]) }).strict().refine(value => value.projectionMode !== 'revision' || value.parentVersionIds.length === 1)
  .refine(value => !value.imageEditOutputs || (value.imageEditOutputs.sourceSnapshot.length === value.parentVersionIds.length
    && value.imageEditOutputs.sourceSnapshot.every((source, index) => source.versionId === value.parentVersionIds[index])))
  .refine(value => !value.annotationEditSource || (!value.imageEditOutputs && value.projectionMode === 'derived'
    && value.placement.action === 'attach' && value.parentVersionIds.length === 1 && value.selectionSnapshot?.length === 1
    && value.annotationEditSource.sourceSnapshot[0].versionId === value.parentVersionIds[0]
    && value.selectionSnapshot[0].assetVersionId === value.parentVersionIds[0]))
  .refine(value => !value.annotationEditSource?.byteProof || (
    value.annotationEditSource.byteProof.assetVersionId === value.parentVersionIds[0]
    && value.annotationEditSource.byteProof.assetId === value.annotationEditSource.sourceSnapshot[0].assetId
    && value.annotationEditSource.byteProof.sourceFingerprint === value.annotationEditSource.sourceSnapshot[0].fingerprint
    && value.annotationEditSource.byteProof.imageId === value.selectionSnapshot?.[0].entityId
    && value.annotationEditSource.byteProof.placementId === value.selectionSnapshot?.[0].placementId));

export type CanvasPublicationIntentProposal = z.infer<typeof proposalSchema>;
type CanonicalIntent = z.infer<typeof intentSchema>;
export type CanvasTaskPublicationIntent = Readonly<{
  version: 1;
  parentVersionIds: readonly string[];
  projectionMode: 'derived' | 'revision';
  /** Server-minted under billing locks; never part of the client proposal schema. */
  annotationEditSource?: Readonly<{
    version: 1; requestDigest: string;
    sourceSnapshot: readonly Readonly<z.infer<typeof mediaSourceSnapshotSchema>[number]>[];
    byteProof?: AnnotationImageByteProof;
  }>;
  imageEditOutputs?: Readonly<{
    version: 1; includeMask: boolean; requestDigest: string;
    sourceSnapshot: readonly Readonly<{ versionId: string; fingerprint: string; assetId: string; assetCurrentVersionId: string | null }>[];
    maskPlacement?: Readonly<{ action: 'attach'; transform: Readonly<z.infer<typeof attachPlacement>['transform']>; strideX: number }>;
  }>;
  selectionSnapshot?: readonly Readonly<{ entityId: string; placementId: string; assetVersionId: string }>[];
  placement: Readonly<{ action: 'attach'; transform: Readonly<Extract<CanonicalIntent['placement'], { action: 'attach' }>['transform']>; strideX: number }>
    | Readonly<{ action: 'replace'; placementId: string; expectedAssetVersionId: string }>;
}>;

/** Classified by the caller; this module never imports publication/access. */
export class CanvasPublicationIntentError extends Error {
  constructor() { super('Invalid canvas publication intent'); }
}

/** Zod copies every nested input before the caller starts waiting for SQL. */
export function parseCanvasPublicationIntentProposal(value: unknown): CanvasPublicationIntentProposal {
  const parsed = proposalSchema.safeParse(value);
  if (!parsed.success) throw new CanvasPublicationIntentError();
  return parsed.data;
}

export function parseCanvasTaskPublicationIntent(value: unknown): CanvasTaskPublicationIntent {
  const parsed = intentSchema.safeParse(value);
  if (!parsed.success) throw new CanvasPublicationIntentError();
  const result = parsed.data;
  Object.freeze(result.parentVersionIds);
  if (result.selectionSnapshot) {
    result.selectionSnapshot.forEach(value => Object.freeze(value));
    Object.freeze(result.selectionSnapshot);
  }
  if (result.placement.action === 'attach') Object.freeze(result.placement.transform);
  Object.freeze(result.placement);
  if (result.annotationEditSource) {
    if (result.annotationEditSource.byteProof) Object.freeze(result.annotationEditSource.byteProof);
    result.annotationEditSource.sourceSnapshot.forEach(source => Object.freeze(source));
    Object.freeze(result.annotationEditSource.sourceSnapshot);
    Object.freeze(result.annotationEditSource);
  }
  if (result.imageEditOutputs) {
    result.imageEditOutputs.sourceSnapshot.forEach(source => Object.freeze(source));
    Object.freeze(result.imageEditOutputs.sourceSnapshot);
    if (result.imageEditOutputs.maskPlacement) {
      Object.freeze(result.imageEditOutputs.maskPlacement.transform);
      Object.freeze(result.imageEditOutputs.maskPlacement);
    }
    Object.freeze(result.imageEditOutputs);
  }
  return Object.freeze(result);
}

/** Called only under admission's document lock; geometry is never recomputed on replay. */
export async function freezeImageEditOutputs(client: PoolClient, ownerId: string, projectId: string,
  intent: CanvasTaskPublicationIntent, policy: Omit<NonNullable<CanvasTaskPublicationIntent['imageEditOutputs']>, 'maskPlacement'>,
): Promise<CanvasTaskPublicationIntent> {
  let maskPlacement: z.infer<typeof attachPlacement> | undefined;
  if (policy.includeMask) {
    const document = (await client.query('SELECT projection FROM wujie_project_canvas_documents WHERE owner_id=$1 AND project_id=$2 FOR SHARE',
      [ownerId, projectId])).rows[0];
    const projection = validateCanvasDocumentProjection(document?.projection);
    const anchor = intent.placement.action === 'attach' ? intent.placement.transform : projection.placements[intent.placement.placementId];
    if (!anchor || ('deleted' in anchor && anchor.deleted)) throw new CanvasPublicationIntentError();
    maskPlacement = { action: 'attach', strideX: anchor.width + 32, transform: {
      x: anchor.x + anchor.width + 32, y: anchor.y, width: anchor.width, height: anchor.height,
      rotation: 0, zIndex: Math.min(anchor.zIndex + 1, 1_000_000),
    } };
  }
  return parseCanvasTaskPublicationIntent({ ...intent, imageEditOutputs: { ...policy, ...(maskPlacement ? { maskPlacement } : {}) } });
}

interface CanonicalPlacementRow {
  id: string; entity_id: string; asset_version_id: string; kind: string; mime_type: string | null;
}

async function readCanonicalSources(
  client: PoolClient, ownerId: string, projectId: string,
): Promise<{ projection: CanvasDocumentProjection; canonical: CanonicalPlacementRow[] }> {
  const document = await client.query<{ projection: unknown }>(
    'SELECT projection FROM wujie_project_canvas_documents WHERE project_id=$1 AND owner_id=$2 FOR SHARE',
    [projectId, ownerId],
  );
  let projection: CanvasDocumentProjection;
  try { projection = validateCanvasDocumentProjection(document.rows[0]?.projection); }
  catch { throw new CanvasPublicationIntentError(); }
  const rows = await client.query<CanonicalPlacementRow>(`SELECT p.id,p.entity_id,p.asset_version_id,a.kind,v.mime_type
    FROM wujie_workspace_placements p
    JOIN wujie_asset_versions v ON v.id=p.asset_version_id AND v.asset_id=p.asset_id
      AND v.owner_id=p.owner_id AND v.project_id=p.project_id
    JOIN wujie_assets a ON a.id=v.asset_id AND a.owner_id=v.owner_id AND a.project_id=v.project_id
    WHERE p.owner_id=$1 AND p.project_id=$2 AND p.workspace_kind='canvas'
      AND p.workspace_id IN ($2,$3) AND p.deleted_at IS NULL
      AND ((p.entity_type='canvas-image' AND a.kind IN ('image','video'))
        OR (p.entity_type='canvas-video' AND a.kind='video'))
      AND v.availability='ready' AND a.status='active'
    ORDER BY p.id FOR SHARE OF p,v,a`, [ownerId, projectId, `canvas:${projectId}`]);
  const canonical = rows.rows.filter(row => {
    const placement = projection.placements[row.id];
    // This freezes metadata, not export bytes. Preserve historical empty MIME;
    // source format policy is owned by the existing Agent authorization layer.
    const mime = row.mime_type?.trim().toLowerCase();
    return placement && !placement.deleted && placement.assetVersionId === row.asset_version_id
      && (!mime || mime.startsWith(`${row.kind}/`));
  });
  return { projection, canonical };
}

function assertParents(canonical: CanonicalPlacementRow[], parentVersionIds: readonly string[]): void {
  for (const parent of parentVersionIds) {
    if (!canonical.some(row => row.asset_version_id === parent)) throw new CanvasPublicationIntentError();
  }
}

/** Recheck identities without computing a new layout from the current coordinates. */
export async function validateCanvasBatchSources(
  client: PoolClient, ownerId: string, projectId: string, intent: CanvasTaskPublicationIntent,
): Promise<void> {
  const { canonical } = await readCanonicalSources(client, ownerId, projectId);
  assertParents(canonical, intent.parentVersionIds);
  if (!intent.selectionSnapshot) throw new CanvasPublicationIntentError();
  for (const source of intent.selectionSnapshot) {
    if (!canonical.some(row => row.id === source.placementId && row.entity_id === source.entityId
      && row.asset_version_id === source.assetVersionId)) throw new CanvasPublicationIntentError();
  }
}

/** Typed image edits keep canonical source identity as well as byte/asset identity.
 * Only the caller's joint durable primary proof can substitute a replaced target.
 * Coordinates deliberately do not participate in this comparison. */
export async function validateImageEditPublicationPlacements(
  client: PoolClient, ownerId: string, projectId: string, intent: CanvasTaskPublicationIntent,
  ownReplacement?: { placementId: string; assetVersionId: string },
): Promise<void> {
  if (!intent.imageEditOutputs) throw new CanvasPublicationIntentError();
  const { canonical } = await readCanonicalSources(client, ownerId, projectId);
  let sources = canonical;
  if (intent.placement.action === 'replace') {
    const target = intent.placement;
    if (ownReplacement && ownReplacement.placementId !== target.placementId) throw new CanvasPublicationIntentError();
    const expected = ownReplacement?.assetVersionId ?? target.expectedAssetVersionId;
    const current = canonical.find(row => row.id === target.placementId && row.asset_version_id === expected);
    if (!current) throw new CanvasPublicationIntentError();
    if (ownReplacement) sources = canonical.map(row => row.id === current.id
      ? { ...row, asset_version_id: target.expectedAssetVersionId } : row);
  } else if (ownReplacement || !intent.selectionSnapshot) throw new CanvasPublicationIntentError();
  assertParents(sources, intent.parentVersionIds);
  for (const source of intent.selectionSnapshot ?? []) {
    if (!sources.some(row => row.id === source.placementId && row.entity_id === source.entityId
      && row.asset_version_id === source.assetVersionId)) throw new CanvasPublicationIntentError();
  }
}

/** Authorization and document locks belong to prepareCanvasTaskPublication. */
export async function resolveCanvasPublicationIntent(
  client: PoolClient, ownerId: string, projectId: string, proposal: CanvasPublicationIntentProposal,
  options?: { freezeSelectionSnapshot: true },
): Promise<CanvasTaskPublicationIntent> {
  const { projection, canonical } = await readCanonicalSources(client, ownerId, projectId);
  assertParents(canonical, proposal.parentVersionIds);
  if (proposal.placement.action === 'replace') {
    const target = proposal.placement;
    if (!canonical.some(row => row.id === target.placementId && row.asset_version_id === target.expectedAssetVersionId)) {
      throw new CanvasPublicationIntentError();
    }
    return parseCanvasTaskPublicationIntent({ version: 1, ...proposal });
  }
  const selectedSources = proposal.placement.selectedEntityIds.map(entityId => {
    const matches = canonical.filter(row => row.entity_id === entityId);
    if (matches.length !== 1) throw new CanvasPublicationIntentError();
    return { entityId, placementId: matches[0].id, assetVersionId: matches[0].asset_version_id };
  });
  const anchor = selectedSources[0] ? projection.placements[selectedSources[0].placementId] : undefined;
  const live = Object.values(projection.placements).filter(placement => !placement.deleted);
  const transform = anchor
    ? { x: anchor.x + anchor.width + 32, y: anchor.y, width: anchor.width, height: anchor.height,
        rotation: 0, zIndex: Math.min(anchor.zIndex + 1, 1_000_000) }
    : { x: live.length ? Math.max(...live.map(placement => placement.x + placement.width)) + 32 : 0,
        y: 0, width: 512, height: 512, rotation: 0, zIndex: 0 };
  return parseCanvasTaskPublicationIntent({ version: 1, parentVersionIds: proposal.parentVersionIds,
    ...(options?.freezeSelectionSnapshot ? { selectionSnapshot: selectedSources } : {}),
    projectionMode: proposal.projectionMode, placement: { action: 'attach', transform, strideX: transform.width + 32 } });
}

/** A single-image edit must anchor its output to the exact live source version. */
export async function assertCanvasImageEditSourceSelection(
  client: PoolClient, ownerId: string, projectId: string, proposal: CanvasPublicationIntentProposal,
): Promise<void> {
  if (proposal.parentVersionIds.length !== 1 || proposal.placement.action !== 'append'
    || proposal.placement.selectedEntityIds.length !== 1) throw new CanvasPublicationIntentError();
  const intent = await resolveCanvasPublicationIntent(client, ownerId, projectId, proposal,
    { freezeSelectionSnapshot: true });
  if (intent.selectionSnapshot?.length !== 1
    || intent.selectionSnapshot[0].assetVersionId !== proposal.parentVersionIds[0]) {
    throw new CanvasPublicationIntentError();
  }
}
