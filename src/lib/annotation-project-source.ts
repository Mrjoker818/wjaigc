import { buildAnnotationSourceVersionId } from '@/features/annotations/annotation-source-version';
import { dbGetUserData } from '@/lib/db-storage';
import { isDatabaseConfigured } from '@/lib/db-client';

type JsonRecord = Record<string, unknown>;

export interface OwnedAnnotationSource {
  projectId: string;
  imageId: string;
  imageUrl: string;
  versionId: string;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function normalizeProjects(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.map(asRecord).filter((item): item is JsonRecord => Boolean(item));
  }
  if (typeof value !== 'string') return [];
  try {
    return normalizeProjects(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

function projectImages(project: JsonRecord): JsonRecord[] {
  const value = Array.isArray(project.canvasImages)
    ? project.canvasImages
    : Array.isArray(project.images)
      ? project.images
      : [];
  return value.map(asRecord).filter((item): item is JsonRecord => Boolean(item));
}

export async function findOwnedAnnotationSource(
  userId: string,
  projectId: string,
  imageId: string,
): Promise<OwnedAnnotationSource | null> {
  // There is no authoritative file-backed project reader here. Without PG,
  // retain the unavailable result and never query a cached/unconfigured pool.
  if (!isDatabaseConfigured()) return null;
  const projects = normalizeProjects(await dbGetUserData(userId, 'projects'));
  const project = projects.find((candidate) =>
    String(candidate.id || '') === projectId
    && (!candidate.userId || String(candidate.userId) === userId)
  );
  if (!project) return null;

  const image = projectImages(project).find(
    (candidate) => String(candidate.id || '') === imageId,
  );
  if (!image) return null;

  const imageUrl = String(image.url || image.sourceUrl || '').trim();
  if (!imageUrl) return null;
  const explicitVersion = typeof image.annotationVersionId === 'string'
    ? image.annotationVersionId.trim()
    : '';
  const createdAt = typeof image.createdAt === 'number'
    ? image.createdAt
    : undefined;

  return {
    projectId,
    imageId,
    imageUrl,
    versionId: explicitVersion || buildAnnotationSourceVersionId(
      imageId,
      createdAt,
      imageUrl,
    ),
  };
}
