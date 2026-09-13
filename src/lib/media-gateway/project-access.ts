import 'server-only';

import { createPostgresAssetStorage, type AssetStorage } from '@/lib/asset-core/storage';
import type { GatewayPrincipal } from '@/lib/media-gateway/key-service';
import { GatewayError } from '@/lib/media-gateway/types';

export async function assertGatewayProjectAccess(
  principal: GatewayPrincipal,
  projectId: string,
  storage: AssetStorage = createPostgresAssetStorage(),
): Promise<void> {
  const owned = await storage.read(transaction => (
    transaction.findProject(principal.userId, projectId)
  ));
  if (!owned) {
    throw new GatewayError('GATEWAY_INVALID_REQUEST', 400, 'Project is unavailable');
  }
}
