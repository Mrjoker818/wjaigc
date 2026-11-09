import {
  toImageToolCapability,
  type ImageToolCapabilityIndex,
} from '@/lib/image-tool-model-options';
import { getPublicModelCatalogSnapshot } from '@/lib/server-api-config';

import { resolveTaskModelCatalogResultFromSnapshot, taskModelKey } from './model-catalog';

/** Exact image capabilities for the tool panels. Capability metadata only, no credentials. */
export async function loadImageToolCapabilities(): Promise<ImageToolCapabilityIndex> {
  const snapshot = await getPublicModelCatalogSnapshot();
  const { taskModelCatalog } = resolveTaskModelCatalogResultFromSnapshot(
    snapshot.models,
    null,
    snapshot.configuredProviders,
  );
  return Object.fromEntries(taskModelCatalog
    .filter(descriptor => descriptor.kind === 'image' || descriptor.kind === 'edit')
    .map(descriptor => [
      taskModelKey(descriptor.providerId, descriptor.modelId),
      toImageToolCapability(descriptor),
    ]));
}
