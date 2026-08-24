export interface ProviderRoutingDependencies<TProvider> {
  providerId?: string;
  findById: (providerId: string) => Promise<TProvider | null | undefined>;
  findByModel: () => Promise<TProvider | null | undefined>;
  findByFeature?: () => Promise<TProvider | null | undefined>;
}

/**
 * A provider chosen by the caller is an exact route, not a discovery hint.
 * Discovery is only permitted when the request omitted providerId entirely.
 */
export async function resolveProviderForTask<TProvider>(
  dependencies: ProviderRoutingDependencies<TProvider>,
): Promise<TProvider | null> {
  if (dependencies.providerId) {
    return (await dependencies.findById(dependencies.providerId)) || null;
  }

  const modelProvider = await dependencies.findByModel();
  if (modelProvider) return modelProvider;
  return (await dependencies.findByFeature?.()) || null;
}
