export interface ProviderDisplaySource {
  id?: string;
  name?: string;
  displayName?: string;
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A persisted provider ID is authoritative. Old task payloads can contain an
 * outdated providerName when the same model exists under multiple providers.
 */
export function resolveTaskProviderDisplayName(
  providerId: unknown,
  provider: ProviderDisplaySource | null | undefined,
  legacyName: unknown,
): string {
  const normalizedProviderId = nonEmptyString(providerId);
  const providerMatchesTask = Boolean(
    normalizedProviderId
    && provider
    && nonEmptyString(provider.id) === normalizedProviderId,
  );

  if (providerMatchesTask) {
    return nonEmptyString(provider?.displayName)
      || nonEmptyString(provider?.name)
      || normalizedProviderId;
  }

  return nonEmptyString(legacyName) || normalizedProviderId;
}
