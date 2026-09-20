import { NextRequest, NextResponse } from 'next/server';

import {
  LegacyMigrationError,
  migrateLegacyProjectOnWrite,
  prepareVerifiedLegacyProjectMedia,
  type LegacyMediaPersistenceInput,
  type LegacyMediaPersistenceResult,
} from '@/lib/asset-core/legacy-migration';
import {
  inspectCompletedImage,
  inspectManagedImageMetadata,
} from '@/lib/asset-core/image-result-metadata';
import { persistResultImage } from '@/lib/persist-result-image';
import { getSessionUser } from '@/lib/server-auth';

const REQUEST_FIELDS = new Set(['projectId', 'imageId']);

function parseBody(value: unknown): { projectId: string; imageId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !REQUEST_FIELDS.has(key))) return null;
  const projectId = typeof record.projectId === 'string' ? record.projectId.trim() : '';
  const imageId = typeof record.imageId === 'string' ? record.imageId.trim() : '';
  if (!projectId || !imageId || projectId.length > 200 || imageId.length > 200) return null;
  return { projectId, imageId };
}

async function persistLegacyMedia(
  input: LegacyMediaPersistenceInput,
): Promise<LegacyMediaPersistenceResult> {
  if (!input.dataUrl.startsWith('data:image/')) {
    throw new Error('LEGACY_MEDIA_PERSIST_FAILED');
  }
  const url = await persistResultImage(input.dataUrl);
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) {
    throw new Error('LEGACY_MEDIA_PERSIST_FAILED');
  }
  return { url, ...await inspectCompletedImage(url) };
}

function migrationErrorResponse(error: unknown): NextResponse {
  if (error instanceof LegacyMigrationError) {
    if (error.code === 'LEGACY_PROJECT_NOT_FOUND') {
      return NextResponse.json({ error: error.code }, { status: 404 });
    }
    if (error.code === 'LEGACY_PROJECT_QUARANTINED') {
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
    return NextResponse.json({ error: error.code }, { status: 500 });
  }
  return NextResponse.json({ error: 'LEGACY_MIGRATION_FAILED' }, { status: 500 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  }
  const body = parseBody(rawBody);
  if (!body) return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });

  try {
    const verifiedMediaByImageId = await prepareVerifiedLegacyProjectMedia({
      actorUserId: sessionUser.id,
      projectId: body.projectId,
      inspectManagedMedia: async ({ url, kind }) => kind === 'image'
        ? { url, ...await inspectManagedImageMetadata(url) }
        : null,
    });
    const result = await migrateLegacyProjectOnWrite({
      actorUserId: sessionUser.id,
      projectId: body.projectId,
      persistMedia: persistLegacyMedia,
      verifiedMediaByImageId,
    });
    const mapping = result.mappings[body.imageId];
    const image = result.project.canvasImages.find(candidate => candidate.id === body.imageId);
    if (!mapping || !image) {
      return NextResponse.json({ error: 'ASSET_NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({
      assetId: mapping.assetId,
      assetVersionId: mapping.versionId,
      placementId: mapping.placementId,
      url: image.url,
      reused: result.reused,
    });
  } catch (error) {
    return migrationErrorResponse(error);
  }
}
