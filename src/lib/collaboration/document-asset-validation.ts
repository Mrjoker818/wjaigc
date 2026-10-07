import 'server-only';

import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { getManagedAssetMediaDescriptor } from '@/lib/asset-core/managed-media-read';
import type { AssetVersion } from '@/lib/asset-core/types';
import { lockAssetGraphWriteGate } from '@/lib/asset-core/storage';
import { assertDocumentEditor, assertDocumentProjectEnabled } from './document-access';
import { DocumentAssetError } from './document-assets';
import { DocumentAssetCommandConflictError, type CanvasAssetCommand } from './canvas-asset-command';
import type { CanvasDocumentProjection } from './canvas-document';
import { importedMediaIdentity, importedMediaRevision, type PreparedImportedMedia } from './document-media-source';
import { assertMediaActive, type MediaImportCommand } from './document-media-request';
import { skillRestorationMediaTargets, type PreparedSkillRestoration } from './document-skill-restoration';

interface MediaIdentity {
  id: string; asset_id: string; owner_id: string; project_id: string;
  file_url: string; storage_key: string | null; checksum: string | null;
  mime_type: string | null; byte_size: string | null; width: number | null; height: number | null;
  kind: 'image' | 'video'; current_version_id: string | null;
  version_record: Record<string, unknown>; asset_record: Record<string, unknown>;
}
declare const validatedMedia: unique symbol;
/** Opaque, process-local authority. Object shape or a cast cannot manufacture it. */
export interface PreparedDocumentAssets { readonly [validatedMedia]: true }
interface Preparation {
  ownerId: string; projectId: string;
  versions: Map<string, MediaIdentity>;
  annotations: Map<string, string>;
}
const preparations = new WeakMap<PreparedDocumentAssets, Preparation>();

async function readIdentity(client: PoolClient, ownerId: string, projectId: string, versionId: string): Promise<MediaIdentity> {
  const result = await client.query<MediaIdentity>(`SELECT version.id, version.asset_id, version.owner_id, version.project_id,
      version.file_url, version.storage_key, version.checksum, version.mime_type,
      version.byte_size, version.width, version.height, asset.kind, asset.current_version_id,
      to_jsonb(version) AS version_record, to_jsonb(asset) AS asset_record
    FROM wujie_asset_versions version
    JOIN wujie_assets asset ON asset.id=version.asset_id AND asset.owner_id=version.owner_id AND asset.project_id=version.project_id
    JOIN wujie_projects project ON project.id=asset.project_id AND project.owner_id=asset.owner_id
    WHERE version.id=$1 AND version.owner_id=$2 AND version.project_id=$3
      AND version.availability='ready' AND asset.status='active' AND asset.kind IN ('image','video') AND project.status='active'
    FOR SHARE OF version, asset, project`, [versionId, ownerId, projectId]);
  if (!result.rows[0]) throw new DocumentAssetError();
  return result.rows[0];
}

function references(projection: CanvasDocumentProjection): { versions: Set<string>; annotations: Set<string> } {
  const versions = new Set(Object.values(projection.placements).filter(p => !p.deleted).map(p => p.assetVersionId));
  const annotations = new Set<string>();
  for (const [id, annotation] of Object.entries(projection.annotationRecords ?? {})) {
    if (projection.annotationTombstones?.[id]) continue;
    for (const assetId of [annotation.maskAssetId, annotation.overlayAssetId]) if (assetId) annotations.add(assetId);
  }
  return { versions, annotations };
}

/** Short database snapshot, then slow local/S3 validation with NO transaction held.
 * 8B2 can reuse this for committed ready media; uncommitted upload adoption needs
 * its own trusted media preparation contract, never a caller-supplied validator. */
export async function prepareDocumentAssets(
  actorId: string, projectId: string, command: CanvasAssetCommand,
): Promise<PreparedDocumentAssets> {
  return prepareCommandAssets(actorId, projectId, command);
}

export async function prepareDocumentAssetsForImport(
  actorId: string, projectId: string, command: MediaImportCommand, signal: AbortSignal,
): Promise<PreparedDocumentAssets> {
  return prepareCommandAssets(actorId, projectId, command, signal);
}

/** Targets are canonical version identities; restoration references are server-minted only. */
export async function prepareDocumentAssetsForSkillBatch(actorId: string, projectId: string,
  versionIds: readonly string[], restorations: readonly PreparedSkillRestoration[], signal: AbortSignal): Promise<PreparedDocumentAssets> {
  if (!versionIds.length || versionIds.length > 100 || new Set(versionIds).size !== versionIds.length) {
    throw new DocumentAssetCommandConflictError();
  }
  const annotations = restorations.flatMap(value => skillRestorationMediaTargets(value).annotationAssetIds);
  return prepareCommandAssets(actorId,projectId,{action:'attach',assetVersionId:versionIds[0],
    transform:{x:0,y:0,width:1,height:1,rotation:0,zIndex:0}},signal,versionIds,annotations);
}

async function prepareCommandAssets(
  actorId: string, projectId: string, command: CanvasAssetCommand | MediaImportCommand, signal?: AbortSignal,
  extraVersions: readonly string[] = [], extraAnnotations: readonly string[] = [],
): Promise<PreparedDocumentAssets> {
  if (signal) assertMediaActive(signal);
  const client = await getPool().connect();
  let discard = false;
  let preparation: Preparation;
  try {
    await client.query('BEGIN');
    if (signal) await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    await lockAssetGraphWriteGate(client, 'shared');
    await client.query('SELECT 1 FROM wujie_projects WHERE id=$1 FOR UPDATE', [projectId]);
    const { ownerId } = await assertDocumentEditor(actorId, projectId, client);
    await assertDocumentProjectEnabled(client, ownerId, projectId);
    const document = await client.query<{ projection: CanvasDocumentProjection }>(
      'SELECT projection FROM wujie_project_canvas_documents WHERE project_id=$1', [projectId]);
    const projection = document.rows[0]?.projection ?? { placements: {} };
    if (command.action !== 'attach') {
      const placement = projection.placements[command.placementId];
      if (!placement || placement.deleted || placement.assetVersionId !== command.expectedAssetVersionId) throw new DocumentAssetCommandConflictError();
    }
    const refs = references(projection);
    for (const version of extraVersions) refs.versions.add(version);
    for (const asset of extraAnnotations) refs.annotations.add(asset);
    if ('assetVersionId' in command) refs.versions.add(command.assetVersionId);
    if (command.action !== 'attach') refs.versions.add(command.expectedAssetVersionId);
    preparation = { ownerId, projectId, versions: new Map(), annotations: new Map() };
    for (const assetId of refs.annotations) {
      const result = await client.query<{ current_version_id: string }>(`SELECT current_version_id FROM wujie_assets
        WHERE id=$1 AND owner_id=$2 AND project_id=$3 AND status='active' AND kind='image' FOR SHARE`, [assetId, ownerId, projectId]);
      const versionId = result.rows[0]?.current_version_id;
      if (!versionId) throw new DocumentAssetError();
      refs.versions.add(versionId);
      preparation.annotations.set(assetId, versionId);
    }
    for (const versionId of [...refs.versions].sort()) {
      if (signal) assertMediaActive(signal);
      preparation.versions.set(versionId, await readIdentity(client, ownerId, projectId, versionId));
    }
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally { client.release(discard); }

  for (const row of preparation.versions.values()) {
    if (signal) assertMediaActive(signal);
    const version: AssetVersion = {
      id: row.id, assetId: row.asset_id, ownerId: row.owner_id, projectId: row.project_id,
      file: { url: row.file_url, availability: 'ready',
        ...(row.storage_key ? { storageKey: row.storage_key } : {}),
        ...(row.checksum ? { checksum: row.checksum } : {}),
        ...(row.mime_type ? { mimeType: row.mime_type } : {}),
        ...(row.byte_size !== null ? { byteSize: Number(row.byte_size) } : {}),
        ...(row.width !== null ? { width: row.width } : {}),
        ...(row.height !== null ? { height: row.height } : {}),
      }, parentVersionIds: [], createdAt: new Date(0).toISOString(),
    };
    try { await getManagedAssetMediaDescriptor(version, row.kind, signal ? { signal } : undefined); }
    catch { if (signal) assertMediaActive(signal); throw new DocumentAssetError(); }
  }
  if (signal) assertMediaActive(signal);
  const capability = Object.freeze({}) as PreparedDocumentAssets;
  preparations.set(capability, preparation);
  return capability;
}

/** Bind an uncommitted row only to a capability minted by actual media preparation.
 * No callback, structural object, prewritten version or HTTP flag grants authority. */
export async function bindImportedDocumentMedia(
  client: PoolClient, actorId: string, capability: PreparedDocumentAssets, media: PreparedImportedMedia,
): Promise<void> {
  const scope = preparations.get(capability);
  const identity = importedMediaIdentity(media);
  if (!scope || identity.actorId !== actorId || identity.ownerId !== scope.ownerId || identity.projectId !== scope.projectId) {
    throw new DocumentAssetCommandConflictError();
  }
  const row = await readIdentity(client, scope.ownerId, scope.projectId, identity.versionId);
  const revision = importedMediaRevision(media);
  if (revision && !isDeepStrictEqual(row.asset_record, revision)) throw new DocumentAssetCommandConflictError();
  if (row.asset_id !== identity.assetId || row.kind !== identity.kind
    || row.current_version_id !== (revision ? revision.current_version_id : identity.versionId)
    || row.file_url !== identity.file.url || row.storage_key !== (identity.file.storageKey ?? null)
    || row.checksum !== identity.file.checksum || row.mime_type !== identity.file.mimeType
    || Number(row.byte_size) !== identity.file.byteSize) throw new DocumentAssetCommandConflictError();
  scope.versions.set(row.id, row);
}

/** Only DB reads under the final authorization locks; no filesystem/network I/O. */
export async function assertPreparedDocumentAssets(
  client: PoolClient, ownerId: string, projectId: string, projection: CanvasDocumentProjection,
  capability: PreparedDocumentAssets,
): Promise<void> {
  const prepared = preparations.get(capability);
  if (!prepared || prepared.ownerId !== ownerId || prepared.projectId !== projectId) throw new DocumentAssetCommandConflictError();
  const refs = references(projection);
  for (const id of refs.versions) if (!prepared.versions.has(id)) throw new DocumentAssetCommandConflictError();
  for (const id of refs.annotations) if (!prepared.annotations.has(id)) throw new DocumentAssetCommandConflictError();
  for (const [id, old] of prepared.versions) {
    let current: MediaIdentity;
    try { current = await readIdentity(client, ownerId, projectId, id); }
    catch (error) { if (error instanceof DocumentAssetError) throw new DocumentAssetCommandConflictError(); throw error; }
    if (!isDeepStrictEqual(old, current)) throw new DocumentAssetCommandConflictError();
  }
  for (const [assetId, versionId] of prepared.annotations) {
    const row = prepared.versions.get(versionId);
    if (row?.asset_id !== assetId || row.kind !== 'image' || row.current_version_id !== versionId) throw new DocumentAssetCommandConflictError();
  }
}
