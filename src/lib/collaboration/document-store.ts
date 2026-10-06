import 'server-only';

import { isDeepStrictEqual } from 'node:util';

import type { PoolClient } from 'pg';
import type * as YTypes from 'yjs';
// 服务端与原生协作入口统一加载 CJS；浏览器由构建配置统一解析。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Y: typeof YTypes = require('yjs');

import { getPool } from '@/lib/db-client';
import {
  assertCanvasDocumentTransition,
  createCanvasDocument,
  readCanvasDocument,
  type CanvasDocumentProjection,
} from '@/lib/collaboration/canvas-document';
import { assertDocumentEditor, assertDocumentProjectEnabled } from '@/lib/collaboration/document-access';
import { assertProjectAnnotationAsset, assertProjectAssetVersion, assertProjectCanvasPlacement } from '@/lib/collaboration/document-assets';
import { applyCanvasAssetCommand, captureDocumentPlacementRemovalSnapshot, type DocumentPlacementRemovalSnapshot, type CanvasAssetCommand } from './canvas-asset-command';
import { assertPreparedDocumentAssets, type PreparedDocumentAssets } from './document-asset-validation';

const MAX_INCOMING_UPDATE_BYTES = 1_048_576;
const MAX_PERSISTED_UPDATE_BYTES = 4_194_304;
const RECOVERY_LOG_LIMIT = 32;
const FORBIDDEN_HISTORY = /(?:data:|blob:|https?:\/\/|processing[:_-]|api[_-]?key)/i;

interface DocumentRow {
  owner_id: string;
  sequence: string;
  snapshot_sequence: string;
  snapshot_bytes: Buffer;
  projection: CanvasDocumentProjection;
}

interface UpdateRow {
  sequence: string;
  update_bytes: Buffer;
}

export interface DocumentUpdate {
  sequence: number;
  update: Uint8Array;
}

export interface DocumentUpdateInput {
  actorId: string;
  projectId: string;
  bytes: Uint8Array;
  expectedGrantGeneration?: string;
}

export interface LoadedDocument {
  doc: YTypes.Doc;
  sequence: number;
}

/** The submitted bytes cannot become a valid document update by retrying unchanged. */
export class DocumentUpdateRejectedError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : 'Invalid canvas document update', { cause: error });
    this.name = 'DocumentUpdateRejectedError';
  }
}

function sequenceNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Invalid canvas document sequence');
  return parsed;
}

function valueFingerprint(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return `boolean:${value}`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `number:${Object.is(value, -0) ? '-0' : value}`;
  }
  if (Array.isArray(value)) {
    return `array:${JSON.stringify(value.map(item => valueFingerprint(item)))}`;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Unsupported canvas document history value');
    }
    const fields = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, valueFingerprint(nested)]);
    return `object:${JSON.stringify(fields)}`;
  }
  throw new Error('Unsupported canvas document history value');
}

/** Reject values retained in Yjs history but absent from the materialized canvas. */
export function assertCanonicalDocumentPayload(
  bytes: Uint8Array,
  projection: CanvasDocumentProjection,
): void {
  const permitted = new Set<string>();
  const permittedKeys = new Set([
    ...Object.keys(projection.placements),
    ...Object.keys(projection.groupDefinitions ?? {}),
    ...Object.keys(projection.annotationRecords ?? {}),
  ]);
  for (const placement of Object.values(projection.placements)) {
    for (const value of [
      placement.assetVersionId,
      {
        x: placement.x, y: placement.y, width: placement.width,
        height: placement.height, rotation: placement.rotation, zIndex: placement.zIndex,
      },
    ]) permitted.add(valueFingerprint(value));
    if (Object.hasOwn(placement, 'groupId')) permitted.add(valueFingerprint(placement.groupId));
    if (Object.hasOwn(placement, 'annotation')) permitted.add(valueFingerprint(placement.annotation));
    if (placement.deleted === true) permitted.add(valueFingerprint(true));
  }
  for (const group of Object.values(projection.groupDefinitions ?? {})) {
    permitted.add(valueFingerprint(group));
  }
  for (const annotation of Object.values(projection.annotationRecords ?? {})) {
    permitted.add(valueFingerprint(annotation));
  }
  if (Object.keys(projection.groupTombstones ?? {}).length > 0 ||
      Object.keys(projection.annotationTombstones ?? {}).length > 0) {
    permitted.add(valueFingerprint(true));
  }
  for (const struct of Y.decodeUpdate(bytes).structs) {
    if (struct instanceof Y.GC) continue;
    if (!(struct instanceof Y.Item)) throw new Error('Unsupported canvas document history struct');
    if (struct.parentSub !== null && !permittedKeys.has(struct.parentSub)) {
      throw new Error('Canvas document history contains a key outside the current projection');
    }
    if (struct.content instanceof Y.ContentDeleted) continue;
    if (!(struct.content instanceof Y.ContentAny)) {
      throw new Error('Canvas document history contains unsupported content');
    }
    const values = struct.content.getContent();
    if (values.length !== 1 || !permitted.has(valueFingerprint(values[0]))) {
      throw new Error('Canvas document history contains a value outside the current projection');
    }
  }
}

function assertProjectId(projectId: string): void {
  if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 256) {
    throw new Error('Invalid canvas document projectId');
  }
}

async function readDocumentRow(client: Pick<PoolClient, 'query'>, projectId: string, lock = false): Promise<DocumentRow | undefined> {
  const result = await client.query<DocumentRow>(
    `SELECT owner_id, sequence, snapshot_sequence, snapshot_bytes, projection
       FROM wujie_project_canvas_documents
      WHERE project_id = $1${lock ? ' FOR UPDATE' : ''}`,
    [projectId],
  );
  return result.rows[0];
}

async function hydrateDocument(client: Pick<PoolClient, 'query'>, projectId: string, row?: DocumentRow): Promise<YTypes.Doc> {
  const doc = createCanvasDocument();
  if (!row) return doc;
  if (row.snapshot_bytes.length > 0) Y.applyUpdate(doc, row.snapshot_bytes);
  const updates = await client.query<UpdateRow>(
    `SELECT sequence, update_bytes FROM wujie_project_canvas_updates
      WHERE project_id = $1 AND sequence > $2 ORDER BY sequence`,
    [projectId, row.snapshot_sequence],
  );
  for (const update of updates.rows) Y.applyUpdate(doc, update.update_bytes);
  const projection = readCanvasDocument(doc);
  // PostgreSQL JSONB restores plain objects; the in-memory projection uses
  // null-prototype placement maps to reject prototype-key tricks.
  if (!isDeepStrictEqual(JSON.parse(JSON.stringify(projection)), row.projection)) {
    throw new Error('Canvas document projection does not match persisted Yjs state');
  }
  return doc;
}

function canonicalizeCandidate(candidate: YTypes.Doc, projection: CanvasDocumentProjection): Uint8Array {
  const canonical = Y.encodeStateAsUpdate(candidate);
  if (canonical.length > MAX_PERSISTED_UPDATE_BYTES) {
    throw new Error('Canvas document update exceeds persisted size limit');
  }
  // Never persist a raw client update. Yjs may retain overwritten content in its
  // update history, so a valid final projection alone is insufficient.
  if (FORBIDDEN_HISTORY.test(Buffer.from(canonical).toString('utf8'))) {
    throw new Error('Canvas document update retains forbidden history');
  }
  assertCanonicalDocumentPayload(canonical, projection);
  const decoded = createCanvasDocument();
  Y.applyUpdate(decoded, canonical);
  if (!isDeepStrictEqual(readCanvasDocument(decoded), projection) ||
      !Buffer.from(Y.encodeStateVector(decoded)).equals(Buffer.from(Y.encodeStateVector(candidate)))) {
    throw new Error('Canvas document canonical update failed independent verification');
  }
  return canonical;
}

/** Apply the same validation to an initial project seed as to later writes. */
export function encodeCanonicalDocumentSnapshot(doc: YTypes.Doc): {
  bytes: Uint8Array;
  projection: CanvasDocumentProjection;
} {
  const projection = readCanvasDocument(doc);
  return { bytes: canonicalizeCandidate(doc, projection), projection };
}

function deriveVerifiedIncrementalUpdate(
  previous: YTypes.Doc,
  candidate: YTypes.Doc,
  canonical: Uint8Array,
  projection: CanvasDocumentProjection,
): Uint8Array {
  const delta = Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(previous));
  if (delta.length > MAX_PERSISTED_UPDATE_BYTES ||
      FORBIDDEN_HISTORY.test(Buffer.from(delta).toString('utf8'))) {
    throw new Error('Canvas document incremental update retains forbidden history or exceeds size limit');
  }
  assertCanonicalDocumentPayload(delta, projection);
  const replay = createCanvasDocument();
  Y.applyUpdate(replay, Y.encodeStateAsUpdate(previous));
  Y.applyUpdate(replay, delta);
  if (!isDeepStrictEqual(readCanvasDocument(replay), projection) ||
      !Buffer.from(Y.encodeStateAsUpdate(replay)).equals(Buffer.from(canonical))) {
    throw new Error('Canvas document incremental update failed independent verification');
  }
  return delta;
}

export async function loadDocumentInTransaction(
  client: Pick<PoolClient, 'query'>, projectId: string,
): Promise<LoadedDocument> {
  assertProjectId(projectId);
  const row = await readDocumentRow(client, projectId);
  const doc = await hydrateDocument(client, projectId, row);
  return { doc, sequence: row ? sequenceNumber(row.sequence) : 0 };
}

export async function loadDocument(projectId: string): Promise<LoadedDocument> {
  assertProjectId(projectId);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const loaded = await loadDocumentInTransaction(client, projectId);
    await client.query('COMMIT');
    return loaded;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function assertDocumentUpdateInput(input: DocumentUpdateInput): void {
  assertProjectId(input.projectId);
  if (!(input.bytes instanceof Uint8Array) || input.bytes.length === 0 || input.bytes.length > MAX_INCOMING_UPDATE_BYTES) {
    throw new DocumentUpdateRejectedError(new Error('Invalid canvas document update size'));
  }
}

/**
 * Server-internal write using the caller's already-open transaction and client.
 * Acquires the same project and authorization locks as the standalone wrapper.
 * Does not open/end a transaction, acquire another connection, or release this one.
 * The returned sequence/update is pending COMMIT, NOT a client ACK. The caller
 * must commit all composed writes before acknowledging, or roll back on failure.
 * pg_notify stays inside this transaction and becomes observable only on COMMIT.
 */
export async function commitDocumentUpdateInTransaction(
  client: PoolClient,
  input: DocumentUpdateInput,
): Promise<DocumentUpdate> {
  assertDocumentUpdateInput(input);
  const { projectId, bytes } = input;
  const { row, previous, ownerId } = await lockDocumentForWrite(client, input);
  const candidate = createCanvasDocument();
  Y.applyUpdate(candidate, Y.encodeStateAsUpdate(previous));
  assertRawDocumentMutation(previous, candidate, bytes);
  return persistDocumentCandidate(client, projectId, ownerId, row, previous, candidate);
}

async function lockDocumentForWrite(
  client: PoolClient,
  input: Pick<DocumentUpdateInput, 'actorId' | 'projectId' | 'expectedGrantGeneration'>,
): Promise<{ row: DocumentRow | undefined; previous: YTypes.Doc; ownerId: string }> {
  const { actorId, projectId } = input;
  // This row lock serializes the first write as well as subsequent writes.
  const project = await client.query(
    'SELECT 1 FROM wujie_projects WHERE id = $1 FOR UPDATE', [projectId],
  );
  if (project.rowCount !== 1) throw new Error('Canvas document project not found');
  const { ownerId } = await assertDocumentEditor(
    actorId, projectId, client, input.expectedGrantGeneration,
  );
  await assertDocumentProjectEnabled(client, ownerId, projectId);
  const row = await readDocumentRow(client, projectId, true);
  if (row && row.owner_id !== ownerId) throw new Error('Canvas document owner mismatch');
  const previous = await hydrateDocument(client, projectId, row);
  return { row, previous, ownerId };
}

function assertRawDocumentMutation(previous: YTypes.Doc, candidate: YTypes.Doc, bytes: Uint8Array): void {
  const existingVersions = new Set(previous.getMap('assetVersions').keys());
  const existingTombstones = new Set(previous.getMap('tombstones').keys());
  const touchedGroups = new Set<string>();
  const touchedAnnotations = new Set<string>();
  let touchedImmutableKey = false;
  candidate.getMap('assetVersions').observe(event => {
    for (const key of event.changes.keys.keys()) {
      if (existingVersions.has(key)) touchedImmutableKey = true;
    }
  });
  candidate.getMap('tombstones').observe(event => {
    for (const key of event.changes.keys.keys()) {
      if (existingTombstones.has(key)) touchedImmutableKey = true;
    }
  });
  candidate.getMap('groupDefinitions').observe(event => {
    for (const key of event.changes.keys.keys()) touchedGroups.add(key);
  });
  candidate.getMap('annotationRecords').observe(event => {
    for (const key of event.changes.keys.keys()) touchedAnnotations.add(key);
  });
  try {
    Y.applyUpdate(candidate, bytes);
    if (touchedImmutableKey) {
      throw new Error('Canvas document immutable placement history cannot be rewritten');
    }
    if ([...touchedGroups].some(id => candidate.getMap('groupTombstones').get(id) === true) ||
        [...touchedAnnotations].some(id => candidate.getMap('annotationTombstones').get(id) === true)) {
      throw new Error('Canvas deleted metadata record cannot be rewritten');
    }
  } catch (error) {
    throw new DocumentUpdateRejectedError(error);
  }
}

/** Caller-owned transaction; only an exact typed command and a genuine server
 * preparation can reach this path. The caller must also update the graph and
 * commit its idempotency result before ACK. Never accepts raw bytes or callbacks. */
export async function commitDocumentAssetCommandInTransaction(
  client: PoolClient,
  input: { actorId: string; projectId: string; command: CanvasAssetCommand; placementId: string; prepared: PreparedDocumentAssets },
): Promise<DocumentUpdate & { removeSnapshot?: DocumentPlacementRemovalSnapshot }> {
  const { row, previous, ownerId } = await lockDocumentForWrite(client, input);
  const removeSnapshot = input.command.action === 'remove'
    ? captureDocumentPlacementRemovalSnapshot(readCanvasDocument(previous), input.projectId, input.command) : undefined;
  const candidate = createCanvasDocument();
  Y.applyUpdate(candidate, Y.encodeStateAsUpdate(previous));
  applyCanvasAssetCommand(candidate, input.command, input.placementId);
  const update = await persistDocumentCandidate(client, input.projectId, ownerId, row, previous, candidate, input.prepared);
  return removeSnapshot ? { ...update, removeSnapshot } : update;
}

async function persistDocumentCandidate(
  client: PoolClient, projectId: string, ownerId: string, row: DocumentRow | undefined,
  previous: YTypes.Doc, candidate: YTypes.Doc, prepared?: PreparedDocumentAssets,
): Promise<DocumentUpdate> {
  const beforeProjection = readCanvasDocument(previous);
  let projection: CanvasDocumentProjection;
  try {
    assertCanvasDocumentTransition(previous, candidate);
    projection = readCanvasDocument(candidate);
  } catch (error) { throw new DocumentUpdateRejectedError(error); }
  if (prepared) await assertPreparedDocumentAssets(client, ownerId, projectId, projection, prepared);
  for (const [annotationId, annotation] of Object.entries(projection.annotationRecords ?? {})) {
    if (projection.annotationTombstones?.[annotationId] === true) continue;
    if (annotation.projectId !== projectId) {
      throw new Error('Canvas annotation project does not match document project');
    }
    for (const assetId of [annotation.maskAssetId, annotation.overlayAssetId]) {
      if (assetId && !prepared) await assertProjectAnnotationAsset(ownerId, projectId, assetId, client);
    }
  }
  for (const [placementId, placement] of Object.entries(projection.placements)) {
    if (placement.deleted === true &&
        beforeProjection.placements[placementId]?.assetVersionId === placement.assetVersionId) {
      continue;
    }
    if (!prepared) await assertProjectAssetVersion(ownerId, projectId, placement.assetVersionId, client);
    await assertProjectCanvasPlacement(ownerId, projectId, placementId, placement.assetVersionId, client);
  }
  let canonical: Uint8Array;
  try {
    canonical = canonicalizeCandidate(candidate, projection);
  } catch (error) {
    throw new DocumentUpdateRejectedError(error);
  }
  const oldCanonical = Y.encodeStateAsUpdate(previous);
  const oldSequence = row ? sequenceNumber(row.sequence) : 0;
  if (Buffer.from(canonical).equals(Buffer.from(oldCanonical))) {
    return { sequence: oldSequence, update: canonical };
  }
  let incremental: Uint8Array;
  try {
    incremental = deriveVerifiedIncrementalUpdate(previous, candidate, canonical, projection);
  } catch (error) {
    throw new DocumentUpdateRejectedError(error);
  }
  const sequence = oldSequence + 1;
  if (!Number.isSafeInteger(sequence)) throw new Error('Canvas document sequence exhausted');
  if (!row) {
    await client.query(
      `INSERT INTO wujie_project_canvas_documents
         (project_id, owner_id, sequence, projection)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [projectId, ownerId, sequence, JSON.stringify(projection)],
    );
  } else {
    await client.query(
      `UPDATE wujie_project_canvas_documents
          SET sequence = $2, projection = $3::jsonb, updated_at = now()
        WHERE project_id = $1`,
      [projectId, sequence, JSON.stringify(projection)],
    );
  }
  await client.query(
    `INSERT INTO wujie_project_canvas_updates
       (project_id, owner_id, sequence, update_bytes)
     VALUES ($1, $2, $3, $4)`,
    [projectId, ownerId, sequence, Buffer.from(incremental)],
  );
  const snapshotSequence = row ? sequenceNumber(row.snapshot_sequence) : 0;
  if (sequence - snapshotSequence >= RECOVERY_LOG_LIMIT) {
    await client.query(
      `UPDATE wujie_project_canvas_documents
          SET snapshot_sequence = $2, snapshot_bytes = $3, updated_at = now()
        WHERE project_id = $1`,
      [projectId, sequence, Buffer.from(canonical)],
    );
  }
  await client.query(
    `DELETE FROM wujie_project_canvas_updates
      WHERE project_id = $1 AND sequence <= $2`,
    [projectId, Math.max(0, sequence - RECOVERY_LOG_LIMIT)],
  );
  await client.query("SELECT pg_notify('wujie_canvas_document_changed', $1)", [
    JSON.stringify({ projectId, sequence }),
  ]);
  return { sequence, update: incremental };
}

/** Return a client-acknowledgeable update only after the owned transaction commits. */
export async function commitDocumentUpdate(input: DocumentUpdateInput): Promise<DocumentUpdate> {
  // Preserve input rejection before pool acquisition, including its error type.
  assertDocumentUpdateInput(input);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const update = await commitDocumentUpdateInTransaction(client, input);
    await client.query('COMMIT');
    return update;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function readDocumentUpdatesAfterInTransaction(
  client: PoolClient, projectId: string, afterSequence: number,
): Promise<DocumentUpdate[]> {
  assertProjectId(projectId);
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    throw new Error('Invalid canvas document sequence');
  }
  const row = await readDocumentRow(client, projectId);
  if (!row) return [];
  const snapshotSequence = sequenceNumber(row.snapshot_sequence);
  const from = afterSequence < snapshotSequence ? snapshotSequence : afterSequence;
  const updates = await client.query<UpdateRow>(
    `SELECT sequence, update_bytes FROM wujie_project_canvas_updates
      WHERE project_id = $1 AND sequence > $2 ORDER BY sequence`,
    [projectId, from],
  );
  return [
    ...(afterSequence < snapshotSequence ? [{ sequence: snapshotSequence, update: row.snapshot_bytes }] : []),
    ...updates.rows.map(update => ({ sequence: sequenceNumber(update.sequence), update: update.update_bytes })),
  ];
}

export async function readDocumentUpdatesAfter(projectId: string, afterSequence: number): Promise<DocumentUpdate[]> {
  assertProjectId(projectId);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const updates = await readDocumentUpdatesAfterInTransaction(client, projectId, afterSequence);
    await client.query('COMMIT');
    return updates;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function compactDocument(projectId: string): Promise<void> {
  assertProjectId(projectId);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM wujie_projects WHERE id = $1 FOR UPDATE', [projectId]);
    const row = await readDocumentRow(client, projectId, true);
    if (row) {
      const doc = await hydrateDocument(client, projectId, row);
      const projection = readCanvasDocument(doc);
      const snapshot = canonicalizeCandidate(doc, projection);
      const sequence = sequenceNumber(row.sequence);
      await client.query(
        `UPDATE wujie_project_canvas_documents
            SET snapshot_sequence = $2, snapshot_bytes = $3, updated_at = now()
          WHERE project_id = $1`,
        [projectId, sequence, Buffer.from(snapshot)],
      );
      await client.query(
        `DELETE FROM wujie_project_canvas_updates
          WHERE project_id = $1 AND sequence <= $2`,
        [projectId, Math.max(0, sequence - RECOVERY_LOG_LIMIT)],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
