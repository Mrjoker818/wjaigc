import 'server-only';

import { isDeepStrictEqual } from 'node:util';

import type { PoolClient } from 'pg';

import { migrateLegacyAnnotation } from '@/features/annotations/annotation-bundle';
import { buildAnnotationSourceVersionId } from '@/features/annotations/annotation-source-version';
import type { LegacyCanvasAnnotation } from '@/features/annotations/annotation-types';
import { lockAssetGraphWriteGate } from '@/lib/asset-core/storage';
import { PROJECT_REVISION_DATA_KEY } from '@/lib/asset-core/canvas-project-sync';
import { inspectManagedImageMetadata } from '@/lib/asset-core/image-result-metadata';
import { migrateLegacyProjectOnWriteInTransaction, prepareVerifiedLegacyProjectMedia, selectCanvasImagesForAssetGraph } from '@/lib/asset-core/legacy-migration';
import { readProjectSnapshot } from '@/lib/asset-core/project-readers';
import { applyCanvasImagePatch, createCanvasDocument, readCanvasDocument, type CanvasDocumentProjection } from '@/lib/collaboration/canvas-document';
import { assertDocumentEditor } from '@/lib/collaboration/document-access';
import { assertProjectAnnotationAsset, assertProjectAssetVersion } from '@/lib/collaboration/document-assets';
import { encodeCanonicalDocumentSnapshot, loadDocumentInTransaction } from '@/lib/collaboration/document-store';
import { getPool } from '@/lib/db-client';
import type { CanvasImage, Project } from '@/lib/user-types';

export class DocumentAuthorityConflictError extends Error {
  readonly code = 'DOCUMENT_AUTHORITY_CONFLICT';

  constructor() {
    super('Collaborative canvas is document-authoritative');
    this.name = 'DocumentAuthorityConflictError';
  }
}

export class DocumentProjectRevisionConflictError extends Error {
  readonly code = 'DOCUMENT_PROJECT_REVISION_CONFLICT';

  constructor(readonly currentRevision: number) {
    super('Canvas project snapshot is stale');
    this.name = 'DocumentProjectRevisionConflictError';
  }
}

export interface CollaborativeProjectRead {
  projectId: string;
  ownerId: string;
  sequence: number;
  projection: CanvasDocumentProjection;
  readOnly: boolean;
}

export async function readCollaborativeProject(actorId: string, projectId: string): Promise<CollaborativeProjectRead> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const { ownerId } = await assertDocumentEditor(actorId, projectId, client);
    const settings = await client.query<{ enabled: boolean }>(
      `SELECT enabled FROM wujie_project_document_settings
        WHERE project_id = $1 AND owner_id = $2 FOR SHARE`,
      [projectId, ownerId],
    );
    if (settings.rows[0]?.enabled !== true) throw new DocumentAuthorityConflictError();
    const document = await client.query(
      `SELECT 1 FROM wujie_project_canvas_documents
        WHERE project_id = $1 AND owner_id = $2 FOR SHARE`,
      [projectId, ownerId],
    );
    if (document.rowCount !== 1) throw new DocumentAuthorityConflictError();
    const loaded = await loadDocumentInTransaction(client, projectId);
    const projection = readCanvasDocument(loaded.doc);
    await client.query('COMMIT');
    return {
      projectId, ownerId, sequence: loaded.sequence, projection,
      readOnly: process.env.WUJIE_YJS_ENABLED !== 'true',
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Project-list reads must not revive coordinates from the frozen legacy snapshot. */
export async function readOwnerProjectsWithDocuments(
  ownerId: string,
  projects: Project[],
  transaction?: PoolClient,
): Promise<Project[]> {
  if (projects.length === 0) return projects;
  const client = transaction ?? await getPool().connect();
  try {
    if (!transaction) await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const enabled = await client.query<{ project_id: string }>(
      `SELECT project_id FROM wujie_project_document_settings
        WHERE owner_id = $1 AND enabled = true AND project_id = ANY($2::text[])`,
      [ownerId, projects.map(project => project.id)],
    );
    if (enabled.rows.length === 0) {
      if (!transaction) await client.query('COMMIT');
      return projects;
    }
    const enabledIds = new Set(enabled.rows.map(row => row.project_id));
    const { readAssetV3Projects } = await import('@/lib/asset-core/canvas-project-sync');
    const normalized = projects.filter(project => enabledIds.has(project.id)).map(project => {
      const readable = readProjectSnapshot(project);
      if (!readable.project || readable.unresolvedMedia.length > 0) {
        throw new DocumentAuthorityConflictError();
      }
      return readable.project;
    });
    const graphProjects = await readAssetV3Projects(
      ownerId, normalized, client,
    );
    const graphById = new Map(graphProjects.map(project => [project.id, project]));
    const result: Project[] = [];
    for (const project of projects) {
      if (!enabledIds.has(project.id)) {
        result.push(project);
        continue;
      }
      const document = await client.query(
        `SELECT 1 FROM wujie_project_canvas_documents
          WHERE project_id = $1 AND owner_id = $2`,
        [project.id, ownerId],
      );
      if (document.rowCount !== 1) throw new DocumentAuthorityConflictError();
      const { doc } = await loadDocumentInTransaction(client, project.id);
      const projection = readCanvasDocument(doc);
      const graphProject = graphById.get(project.id);
      if (!graphProject) throw new DocumentAuthorityConflictError();
      const imageByPlacement = new Map(graphProject.canvasImages.map(image => [image.placementId, image]));
      const imageIdByPlacement = new Map(graphProject.canvasImages.map(image => [image.placementId, image.id]));
      const canvasImages: CanvasImage[] = [];
      for (const [placementId, placement] of Object.entries(projection.placements)) {
        if (placement.deleted === true) continue;
        const image = imageByPlacement.get(placementId);
        if (!image || image.assetVersionId !== placement.assetVersionId) {
          throw new DocumentAuthorityConflictError();
        }
        const { groupId: _oldGroupId, ...base } = image;
        canvasImages.push({
          ...base,
          x: placement.x, y: placement.y,
          width: placement.width, height: placement.height,
          rotation: placement.rotation, zIndex: placement.zIndex,
          ...(placement.groupId ? { groupId: placement.groupId } : {}),
        });
      }
      const metadata = { ...graphProject.metadata };
      if (projection.groupDefinitions || graphProject.metadata?.groups !== undefined) {
        metadata.groups = Object.values(projection.groupDefinitions ?? {}).filter(group => (
          projection.groupTombstones?.[group.id] !== true
        )).map(group => ({
          ...group,
          imageIds: group.imageIds.map(placementId => {
            const imageId = imageIdByPlacement.get(placementId);
            if (!imageId) throw new DocumentAuthorityConflictError();
            return imageId;
          }),
        }));
      }
      if (projection.annotationRecords || graphProject.metadata?.annotationsV2 !== undefined) {
        metadata.annotationsV2 = Object.values(projection.annotationRecords ?? {}).filter(annotation => (
          projection.annotationTombstones?.[annotation.id] !== true
        )).map(annotation => {
          if (annotation.projectId !== project.id) throw new DocumentAuthorityConflictError();
          const sourceImageId = imageIdByPlacement.get(annotation.sourceImageId);
          if (!sourceImageId) throw new DocumentAuthorityConflictError();
          return { ...annotation, sourceImageId };
        });
      }
      result.push({
        ...graphProject, canvasImages,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      });
    }
    if (!transaction) await client.query('COMMIT');
    return result;
  } catch (error) {
    if (!transaction) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    if (!transaction) client.release();
  }
}

function parseProjects(value: unknown): Project[] {
  let parsed = value;
  if (typeof parsed === 'string') parsed = JSON.parse(parsed) as unknown;
  if (!Array.isArray(parsed)) throw new DocumentAuthorityConflictError();
  return parsed as Project[];
}

function parseRevision(value: unknown): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new DocumentAuthorityConflictError();
  }
  return parsed;
}

export async function enableCollaborativeProject(
  ownerId: string,
  projectId: string,
  expectedRevision: number,
): Promise<void> {
  if (!ownerId || !projectId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new DocumentAuthorityConflictError();
  }
  const verifiedMediaByImageId = await prepareVerifiedLegacyProjectMedia({
    actorUserId: ownerId,
    projectId,
    inspectManagedMedia: async ({ url, kind }) => kind === 'image'
      ? { url, ...await inspectManagedImageMetadata(url) }
      : null,
  });
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await lockAssetGraphWriteGate(client, 'shared');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [ownerId, PROJECT_REVISION_DATA_KEY]);
    const owner = await client.query(
      `SELECT 1 FROM wujie_users WHERE id = $1 AND status = 'active' FOR SHARE`,
      [ownerId],
    );
    if (owner.rowCount !== 1) throw new DocumentAuthorityConflictError();
    const snapshot = await client.query<{ data_value: unknown }>(
      `SELECT data_value FROM wujie_user_data
        WHERE user_id = $1 AND data_key = 'projects' FOR UPDATE`,
      [ownerId],
    );
    const projects = parseProjects(snapshot.rows[0]?.data_value);
    const matches = projects.filter(project => project.id === projectId && project.userId === ownerId);
    if (matches.length !== 1) throw new DocumentAuthorityConflictError();
    const project = matches[0];
    const readable = readProjectSnapshot(project);
    if (!readable.project || readable.unresolvedMedia.length > 0) {
      throw new DocumentAuthorityConflictError();
    }
    const canvasImages = readable.project.canvasImages;
    const revision = await client.query<{ data_value: unknown }>(
      `SELECT data_value FROM wujie_user_data WHERE user_id = $1 AND data_key = $2`,
      [ownerId, PROJECT_REVISION_DATA_KEY],
    );
    const currentRevision = revision.rows.length ? parseRevision(revision.rows[0].data_value) : 0;
    if (currentRevision !== expectedRevision) {
      throw new DocumentProjectRevisionConflictError(currentRevision);
    }
    const existingProject = await client.query<{ status: string }>(
      `SELECT status FROM wujie_projects WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
      [projectId, ownerId],
    );
    if (existingProject.rows.length && existingProject.rows[0].status !== 'active') {
      throw new DocumentAuthorityConflictError();
    }
    const setting = await client.query<{ enabled: boolean }>(
      `SELECT enabled FROM wujie_project_document_settings
        WHERE project_id = $1 AND owner_id = $2 FOR UPDATE`,
      [projectId, ownerId],
    );
    if (setting.rows[0]?.enabled) {
      await client.query('COMMIT');
      return;
    }
    if (selectCanvasImagesForAssetGraph(canvasImages).length !== canvasImages.length) {
      throw new DocumentAuthorityConflictError();
    }
    const migration = await migrateLegacyProjectOnWriteInTransaction(client, {
      actorUserId: ownerId, projectId,
      verifiedMediaByImageId,
    });
    const doc = createCanvasDocument();
    const placementByImageId = new Map<string, string>();
    for (const image of canvasImages) {
      const mapping = migration.mappings[image.id];
      if (!mapping) throw new DocumentAuthorityConflictError();
      placementByImageId.set(image.id, mapping.placementId);
      await assertProjectAssetVersion(ownerId, projectId, mapping.versionId, client);
      applyCanvasImagePatch(doc, {
        placementId: mapping.placementId,
        assetVersionId: mapping.versionId,
        x: image.x, y: image.y, width: image.width, height: image.height,
        rotation: image.rotation, zIndex: image.zIndex,
        ...(image.groupId ? { groupId: image.groupId } : {}),
      }, 'seed');
    }
    const legacyGroups = readable.project.metadata?.groups;
    if (legacyGroups !== undefined) {
      if (!Array.isArray(legacyGroups)) throw new DocumentAuthorityConflictError();
      for (const group of legacyGroups) {
        if (!Array.isArray(group.imageIds)) throw new DocumentAuthorityConflictError();
        const imageIds = group.imageIds.map(imageId => {
          const placementId = placementByImageId.get(imageId);
          if (!placementId) throw new DocumentAuthorityConflictError();
          return placementId;
        });
        doc.getMap('groupDefinitions').set(group.id, { ...group, imageIds });
      }
    }
    const legacyAnnotations = readable.project.metadata?.annotationsV2;
    if (legacyAnnotations !== undefined) {
      if (!Array.isArray(legacyAnnotations)) throw new DocumentAuthorityConflictError();
      for (const annotation of legacyAnnotations) {
        let normalized = annotation;
        if (annotation && typeof annotation === 'object' &&
            'targetImageId' in annotation && !('sourceImageId' in annotation)) {
          const old = annotation as unknown as LegacyCanvasAnnotation;
          if (typeof old.targetImageId !== 'string' || old.brushMaskDataUrl) {
            throw new DocumentAuthorityConflictError();
          }
          const source = canvasImages.find(image => image.id === old.targetImageId);
          if (!source) throw new DocumentAuthorityConflictError();
          normalized = migrateLegacyAnnotation(old, {
            projectId,
            sourceVersionId: buildAnnotationSourceVersionId(
              source.id, source.createdAt, source.url,
            ),
            sourceImageBounds: {
              x: source.x, y: source.y, width: source.width, height: source.height,
            },
          });
        }
        if (normalized.projectId !== projectId) throw new DocumentAuthorityConflictError();
        const sourceImageId = placementByImageId.get(normalized.sourceImageId);
        if (!sourceImageId) throw new DocumentAuthorityConflictError();
        for (const assetId of [normalized.maskAssetId, normalized.overlayAssetId]) {
          if (assetId) await assertProjectAnnotationAsset(ownerId, projectId, assetId, client);
        }
        doc.getMap('annotationRecords').set(normalized.id, { ...normalized, sourceImageId });
      }
    }
    const { bytes, projection } = encodeCanonicalDocumentSnapshot(doc);
    await client.query(
      `INSERT INTO wujie_project_canvas_documents
        (project_id, owner_id, sequence, snapshot_sequence, snapshot_bytes, projection)
       VALUES ($1, $2, 0, 0, $3, $4::jsonb)`,
      [projectId, ownerId, Buffer.from(bytes), JSON.stringify(projection)],
    );
    const nextRevision = currentRevision + 1;
    await client.query(
      `INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (user_id, data_key) DO UPDATE SET
         data_value = EXCLUDED.data_value, updated_at = EXCLUDED.updated_at`,
      [ownerId, PROJECT_REVISION_DATA_KEY, JSON.stringify(nextRevision), Date.now()],
    );
    await client.query(
      `INSERT INTO wujie_project_document_settings
        (project_id, owner_id, enabled, authority_revision, enabled_at)
       VALUES ($1, $2, true, $3, now())
       ON CONFLICT (project_id, owner_id) DO UPDATE SET
         enabled = true, authority_revision = EXCLUDED.authority_revision,
         enabled_at = EXCLUDED.enabled_at, updated_at = now()`,
      [projectId, ownerId, nextRevision],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Called under the owner project-revision transaction lock, before any snapshot write. */
export async function assertLegacyCanvasWriteAllowed(
  client: PoolClient,
  ownerId: string,
  projects: Project[],
  hydrateStored?: (stored: Project[]) => Promise<Project[]>,
): Promise<Project[]> {
  const snapshot = await client.query<{ data_value: unknown }>(
    `SELECT data_value FROM wujie_user_data
      WHERE user_id = $1 AND data_key = 'projects' FOR UPDATE`,
    [ownerId],
  );
  const enabled = await client.query<{ project_id: string }>(
    `SELECT project_id FROM wujie_project_document_settings
      WHERE owner_id = $1 AND enabled = true
      ORDER BY project_id FOR SHARE`,
    [ownerId],
  );
  if (enabled.rows.length === 0) return projects;
  const stored = snapshot.rows[0]?.data_value;
  if (!Array.isArray(stored)) throw new DocumentAuthorityConflictError();
  let hydrated: Project[] | undefined;
  const preserved = new Map<string, Project>();
  for (const { project_id: projectId } of enabled.rows) {
    const previous = stored.filter((project): project is Project =>
      !!project && typeof project === 'object' && project.id === projectId);
    const incoming = projects.filter(project => project.id === projectId);
    if (previous.length !== 1 || incoming.length !== 1) {
      throw new DocumentAuthorityConflictError();
    }
    const candidate = JSON.parse(JSON.stringify(incoming[0])) as Project;
    if (candidate.userId !== previous[0].userId || candidate.createdAt !== previous[0].createdAt) {
      throw new DocumentAuthorityConflictError();
    }
    if (!isDeepStrictEqual(documentOwnedState(previous[0]), documentOwnedState(candidate))) {
      hydrated ??= hydrateStored ? await hydrateStored(stored as Project[]) : undefined;
      const view = hydrated?.filter(project => project.id === projectId);
      if (!view || view.length !== 1 || !isDeepStrictEqual(
        documentOwnedState(view[0], true),
        documentOwnedState(candidate, true),
      )) throw new DocumentAuthorityConflictError();
    }
    const canonical: Project = { ...candidate, canvasImages: previous[0].canvasImages };
    if (previous[0].schemaVersion === undefined) delete canonical.schemaVersion;
    else canonical.schemaVersion = previous[0].schemaVersion;
    const previousLegacyImages = (previous[0] as Project & { images?: unknown }).images;
    if (previousLegacyImages === undefined) delete (canonical as Project & { images?: unknown }).images;
    else (canonical as Project & { images?: unknown }).images = previousLegacyImages;
    const metadata = { ...candidate.metadata };
    if (previous[0].metadata && Object.hasOwn(previous[0].metadata, 'groups')) {
      metadata.groups = previous[0].metadata.groups;
    } else {
      delete metadata.groups;
    }
    if (previous[0].metadata && Object.hasOwn(previous[0].metadata, 'annotationsV2')) {
      metadata.annotationsV2 = previous[0].metadata.annotationsV2;
    } else {
      delete metadata.annotationsV2;
    }
    if (Object.keys(metadata).length > 0) canonical.metadata = metadata;
    else delete canonical.metadata;
    preserved.set(projectId, canonical);
  }
  return projects.map(project => preserved.get(project.id) ?? project);
}

function documentOwnedState(project: Project, ignoreCreatedAt = false): unknown {
  const images = project.canvasImages;
  return JSON.parse(JSON.stringify({
    canvasImages: ignoreCreatedAt && Array.isArray(images)
      ? images.map(({ createdAt: _createdAt, ...image }) => image as CanvasImage)
      : images,
    legacyImages: (project as Project & { images?: unknown }).images,
    groups: project.metadata?.groups,
    annotationsV2: project.metadata?.annotationsV2,
  })) as unknown;
}
