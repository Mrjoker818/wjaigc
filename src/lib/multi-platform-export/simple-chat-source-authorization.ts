import { createPostgresAssetStorage } from '@/lib/asset-core/storage';

interface ExportSourceTransaction {
  findProject(ownerId: string, projectId: string): Promise<boolean>;
  findVersion(ownerId: string, projectId: string, versionId: string): Promise<{
    id: string;
    assetId?: string;
    file?: { url?: string; availability?: string; mimeType?: string };
  } | null>;
  findAsset(ownerId: string, projectId: string, assetId: string): Promise<{
    id: string;
    kind: string;
    status?: string;
  } | null>;
  findActivePlacement(
    ownerId: string,
    projectId: string,
    workspace: 'chat',
    workspaceId: string,
    entityType: 'chat-attachment',
    entityId: string,
  ): Promise<{ assetVersionId: string; entityId: string } | null>;
}

export interface SimpleChatExportSourceStorage {
  read<T>(callback: (transaction: ExportSourceTransaction) => Promise<T>): Promise<T>;
}

export interface SimpleChatExportSourceAuthorizationInput {
  actorUserId: string;
  projectId: string;
  workspaceId: string;
  taskId: string;
  messageId: string;
  sourceVersionIds: readonly string[];
  entityIds: readonly string[];
  messageImageUrls: readonly string[];
}

export class SimpleChatExportSourceAuthorizationError extends Error {
  readonly code = 'SIMPLE_CHAT_EXPORT_SOURCE_FORBIDDEN';
  readonly status = 404;

  constructor() {
    super('Simple Chat export source attachment was not found');
    this.name = 'SimpleChatExportSourceAuthorizationError';
  }
}

const TRUSTED_IMAGE_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif',
]);

function forbidden(): never {
  throw new SimpleChatExportSourceAuthorizationError();
}

function validIdentifier(value: string): boolean {
  return Boolean(value.trim()) && value.length <= 256;
}

export async function authorizeSimpleChatExportSources(
  input: SimpleChatExportSourceAuthorizationInput,
  storage: SimpleChatExportSourceStorage = createPostgresAssetStorage(),
): Promise<{ sourceVersionIds: string[]; mediaUrls: string[] }> {
  const sourceVersionIds = [...new Set(input.sourceVersionIds)];
  if (
    !validIdentifier(input.actorUserId)
    || !validIdentifier(input.projectId)
    || !validIdentifier(input.workspaceId)
    || !validIdentifier(input.taskId)
    || !validIdentifier(input.messageId)
    || sourceVersionIds.length === 0
    || sourceVersionIds.length !== input.sourceVersionIds.length
    || sourceVersionIds.length !== input.entityIds.length
    || sourceVersionIds.length !== input.messageImageUrls.length
    || sourceVersionIds.length > 64
  ) forbidden();

  return storage.read(async transaction => {
    if (!await transaction.findProject(input.actorUserId, input.projectId)) forbidden();
    const mediaUrls: string[] = [];
    for (let index = 0; index < sourceVersionIds.length; index += 1) {
      const versionId = sourceVersionIds[index];
      const entityId = input.entityIds[index];
      const expectedEntityId = `${input.taskId}:${input.messageId}:${index}`;
      if (!validIdentifier(versionId) || entityId !== expectedEntityId) forbidden();

      const placement = await transaction.findActivePlacement(
        input.actorUserId,
        input.projectId,
        'chat',
        input.workspaceId,
        'chat-attachment',
        entityId,
      );
      const version = await transaction.findVersion(input.actorUserId, input.projectId, versionId);
      if (!placement || placement.assetVersionId !== versionId || !version?.assetId || !version.file?.url) forbidden();
      const asset = await transaction.findAsset(input.actorUserId, input.projectId, version.assetId);
      const mimeType = version.file.mimeType?.trim().toLowerCase();
      if (
        asset?.kind !== 'image'
        || asset.status === 'trashed'
        || version.file.availability !== 'ready'
        || (mimeType && !TRUSTED_IMAGE_MIME_TYPES.has(mimeType))
        || version.file.url !== input.messageImageUrls[index]
      ) forbidden();
      mediaUrls.push(version.file.url);
    }
    return { sourceVersionIds, mediaUrls };
  });
}
